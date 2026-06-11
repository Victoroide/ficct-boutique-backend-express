import { createHash } from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { bucket, s3 } from '../storage/s3.client';
import { headObject, presignDownload, presignUpload } from '../storage/presign.service';
import { documentRepository, type DocumentCategory, type DocumentRow } from './document.repository';
import { ledgerService } from '../ledger/ledger.service';
import { AppError } from '../../shared/errors';
import { ALLOWED_MIMES } from './document.validators';

export interface CreateUploadInput {
  ownerUserId: string;
  title: string;
  description?: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface CreateUploadResult {
  document: DocumentRow;
  upload: Awaited<ReturnType<typeof presignUpload>>;
}

/**
 * Application service for the document lifecycle: presigned upload requests,
 * upload confirmation with SHA-256 integrity checks, download URLs, listing,
 * soft-delete/restore, and integrity verification against the hash ledger.
 */
export class DocumentService {
  /**
   * Ensure the given MIME type is permitted for the document category.
   * @throws AppError('UNSUPPORTED_MEDIA_TYPE') when the MIME is not allowed.
   */
  validateMime(category: DocumentCategory, mime: string): void {
    const allowed = ALLOWED_MIMES[category];
    if (!allowed.includes(mime)) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        `mime '${mime}' is not allowed for category '${category}'`,
      );
    }
  }

  /**
   * Validate the MIME, derive a storage key, insert a pending document row, and
   * presign the upload URL.
   * @returns the new `document` row and the `upload` presign result.
   */
  async createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
    this.validateMime(input.category, input.mimeType);
    const ext = this.extensionFor(input.mimeType);
    const key = `${input.category}/${new Date().toISOString().slice(0, 10)}/${uuidv4()}${ext}`;

    const document = await documentRepository.insert({
      ownerUserId: input.ownerUserId,
      title: input.title,
      description: input.description,
      category: input.category,
      storageKey: key,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      metadata: input.metadata,
    });

    const upload = await presignUpload({ key, contentType: input.mimeType });
    return { document, upload };
  }

  /**
   * Confirm a pending upload: verify the stored object's SHA-256 against the
   * claimed hash, mark the document active, and append a ledger entry.
   * @param documentId - the pending document to confirm.
   * @param recordedBy - user id credited as the ledger recorder.
   * @param claimedSha256 - the SHA-256 the client claims for the uploaded file.
   * @throws AppError NOT_FOUND/CONFLICT/BAD_REQUEST/INTEGRITY_FAILED/INTERNAL on failure.
   */
  async confirmUpload(
    documentId: string,
    recordedBy: string,
    claimedSha256: string,
  ): Promise<DocumentRow> {
    const doc = await documentRepository.findById(documentId);
    if (!doc) throw new AppError('NOT_FOUND', 'document not found');
    if (doc.status !== 'pending') {
      throw new AppError('CONFLICT', `document is already in status '${doc.status}'`);
    }

    const head = await headObject(doc.storage_key);
    if (!head.exists) {
      throw new AppError('BAD_REQUEST', 'object not found in storage; upload was not completed');
    }

    const actualSha = await this.computeSha256(doc.storage_key);
    if (actualSha.toLowerCase() !== claimedSha256.toLowerCase()) {
      throw new AppError('INTEGRITY_FAILED', 'claimed sha256 does not match storage');
    }

    const updated = await documentRepository.markActiveWithHash(
      documentId,
      actualSha,
      head.size,
      head.contentType ?? doc.mime_type,
    );
    if (!updated) throw new AppError('INTERNAL', 'failed to mark document active');

    await ledgerService.append({
      documentId: updated.id,
      sha256: actualSha,
      recordedBy,
    });

    return updated;
  }

  /**
   * Issue a presigned download URL for an active document.
   * @returns `{ url, expiresIn, document }`.
   * @throws AppError NOT_FOUND when missing/deleted, CONFLICT when not yet active.
   */
  async download(
    documentId: string,
  ): Promise<{ url: string; expiresIn: number; document: DocumentRow }> {
    const doc = await documentRepository.findById(documentId);
    if (!doc) throw new AppError('NOT_FOUND', 'document not found');
    if (doc.status === 'deleted') throw new AppError('NOT_FOUND', 'document has been deleted');
    if (doc.status !== 'active') throw new AppError('CONFLICT', 'document is not yet active');

    const { url, expiresIn } = await presignDownload(doc.storage_key);
    return { url, expiresIn, document: doc };
  }

  /** List documents matching the given owner/category/status/pagination filters. */
  async list(filters: Parameters<typeof documentRepository.list>[0]): Promise<DocumentRow[]> {
    return documentRepository.list(filters);
  }

  /**
   * Fetch a document by id.
   * @throws AppError('NOT_FOUND') when no document exists for the id.
   */
  async findById(id: string): Promise<DocumentRow> {
    const doc = await documentRepository.findById(id);
    if (!doc) throw new AppError('NOT_FOUND', 'document not found');
    return doc;
  }

  /**
   * Soft-delete a document (status -> deleted).
   * @throws AppError('NOT_FOUND') when missing or already deleted.
   */
  async softDelete(id: string): Promise<DocumentRow> {
    const doc = await documentRepository.softDelete(id);
    if (!doc) throw new AppError('NOT_FOUND', 'document not found or already deleted');
    return doc;
  }

  /**
   * Restore a previously-active, soft-deleted document back to active.
   * @throws AppError('CONFLICT') when the document is not in a restorable state.
   */
  async restore(id: string): Promise<DocumentRow> {
    const doc = await documentRepository.restore(id);
    if (!doc) throw new AppError('CONFLICT', 'document is not in a restorable state');
    return doc;
  }

  /**
   * Verify an active document's integrity: recompute the stored object's SHA-256
   * and validate the hash ledger chain.
   * @returns the document plus `intact` (file matches stored hash), `chainIntact`,
   * `storedSha`, `currentSha`, and `brokenAt` (first bad ledger index, -1 if none).
   * @throws AppError NOT_FOUND when missing, CONFLICT when not active.
   */
  async verify(id: string): Promise<{
    document: DocumentRow;
    intact: boolean;
    chainIntact: boolean;
    storedSha: string;
    currentSha: string;
    brokenAt: number;
  }> {
    const doc = await documentRepository.findById(id);
    if (!doc) throw new AppError('NOT_FOUND', 'document not found');
    if (doc.status !== 'active') {
      throw new AppError('CONFLICT', 'document is not active');
    }
    const currentSha = await this.computeSha256(doc.storage_key);
    const chain = await ledgerService.verifyChain(doc.id);
    return {
      document: doc,
      intact: currentSha === (doc.sha256 ?? ''),
      chainIntact: chain.intact,
      storedSha: doc.sha256 ?? '',
      currentSha,
      brokenAt: chain.brokenAt,
    };
  }

  private async computeSha256(key: string): Promise<string> {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const hash = createHash('sha256');
    const stream = out.Body as NodeJS.ReadableStream | undefined;
    if (!stream) throw new AppError('INTERNAL', 'empty object stream');
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  private extensionFor(mime: string): string {
    switch (mime) {
      case 'application/pdf':
        return '.pdf';
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return '.docx';
      case 'application/msword':
        return '.doc';
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return '.xlsx';
      case 'application/vnd.ms-excel':
        return '.xls';
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '';
    }
  }
}

export const documentService = new DocumentService();
