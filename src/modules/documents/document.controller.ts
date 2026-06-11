import type { Request, Response, NextFunction } from 'express';
import { documentService } from './document.service';
import {
  confirmUploadSchema,
  createUploadRequestSchema,
  listDocumentsSchema,
} from './document.validators';
import { auditService } from '../audit/audit.service';
import { ledgerService } from '../ledger/ledger.service';
import { AppError } from '../../shared/errors';

/**
 * POST /api/v1/documents/upload-request — create a pending document record and
 * return a presigned PUT URL the client uses to upload the file to storage.
 * Roles: admin, staff. Records an `upload` (stage: requested) audit entry.
 * @returns 201 with `{ document, upload }`; forwards validation/auth errors to next().
 */
export async function createUploadRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createUploadRequestSchema.parse(req.body);
    const userId = req.auth!.sub;
    const result = await documentService.createUpload({
      ownerUserId: userId,
      title: body.title,
      description: body.description,
      category: body.category,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      metadata: body.metadata,
    });
    await auditService.record(req, {
      action: 'upload',
      documentId: result.document.id,
      metadata: { stage: 'requested', category: body.category },
    });
    res.status(201).json({
      document: result.document,
      upload: result.upload,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/documents/:id/confirm — verify the uploaded object's SHA-256,
 * mark the document active, and append a ledger entry. Roles: admin, staff.
 * Records an `upload` (stage: confirmed) audit entry.
 * @returns 200 with `{ document }`; errors (NOT_FOUND, CONFLICT, INTEGRITY_FAILED) go to next().
 */
export async function confirmUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = confirmUploadSchema.parse(req.body);
    const id = req.params.id;
    const doc = await documentService.confirmUpload(id, req.auth!.sub, body.sha256);
    await auditService.record(req, {
      action: 'upload',
      documentId: doc.id,
      metadata: { stage: 'confirmed', sha256: doc.sha256 },
    });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents — list documents filtered by owner/category/status with
 * pagination. Roles: any authenticated user (requireAuth on the router).
 * @returns 200 with `{ documents, limit, offset }`; validation errors go to next().
 */
export async function listDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const q = listDocumentsSchema.parse(req.query);
    const docs = await documentService.list({
      ownerUserId: q.ownerUserId,
      category: q.category,
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({ documents: docs, limit: q.limit, offset: q.offset });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:id — fetch a single document's metadata. Roles: any
 * authenticated user. Records a `read` audit entry.
 * @returns 200 with `{ document }`; NOT_FOUND goes to next().
 */
export async function getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await documentService.findById(req.params.id);
    await auditService.record(req, { action: 'read', documentId: doc.id, metadata: {} });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:id/download-url — return a short-lived presigned GET
 * URL for an active document. Roles: any authenticated user. Records a
 * `download` audit entry with the URL TTL.
 * @returns 200 with `{ url, expiresIn, document }`; NOT_FOUND/CONFLICT go to next().
 */
export async function downloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url, expiresIn, document } = await documentService.download(req.params.id);
    await auditService.record(req, {
      action: 'download',
      documentId: document.id,
      metadata: { expiresIn },
    });
    res.json({ url, expiresIn, document });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/documents/:id — soft-delete a document (status -> deleted).
 * Roles: admin. Records a `delete` audit entry.
 * @returns 200 with `{ document }`; NOT_FOUND (or already deleted) goes to next().
 */
export async function deleteDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const doc = await documentService.softDelete(req.params.id);
    await auditService.record(req, { action: 'delete', documentId: doc.id, metadata: {} });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/documents/:id/restore — restore a soft-deleted document back to
 * active. Roles: admin. Records an `edit` (stage: restored) audit entry.
 * @returns 200 with `{ document }`; CONFLICT (not restorable) goes to next().
 */
export async function restoreDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const doc = await documentService.restore(req.params.id);
    await auditService.record(req, {
      action: 'edit',
      documentId: doc.id,
      metadata: { stage: 'restored' },
    });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:id/verify — recompute the stored object's SHA-256 and
 * validate the hash ledger chain. Roles: admin, staff. Records a `verify` audit
 * entry; throws INTEGRITY_FAILED if the file or chain is not intact.
 * @returns 200 with the verification result; integrity/NOT_FOUND/CONFLICT errors go to next().
 */
export async function verifyDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await documentService.verify(req.params.id);
    await auditService.record(req, {
      action: 'verify',
      documentId: result.document.id,
      metadata: {
        intact: result.intact,
        chainIntact: result.chainIntact,
        brokenAt: result.brokenAt,
      },
    });
    if (!result.intact || !result.chainIntact) {
      throw new AppError('INTEGRITY_FAILED', 'document integrity check failed', result);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/documents/:id/ledger — return the append-only hash ledger entries
 * for a document in chronological order. Roles: admin, staff.
 * @returns 200 with `{ entries }`; errors go to next().
 */
export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entries = await ledgerService.listByDocument(req.params.id);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
}
