import type { Request, Response, NextFunction } from 'express';
import { documentService } from './document.service';
import { confirmUploadSchema, createUploadRequestSchema, listDocumentsSchema } from './document.validators';
import { auditService } from '../audit/audit.service';
import { ledgerService } from '../ledger/ledger.service';
import { AppError } from '../../shared/errors';

export async function createUploadRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
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

export async function confirmUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
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

export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
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

export async function getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await documentService.findById(req.params.id);
    await auditService.record(req, { action: 'read', documentId: doc.id, metadata: {} });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

export async function downloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { url, expiresIn, document } = await documentService.download(req.params.id);
    await auditService.record(req, { action: 'download', documentId: document.id, metadata: { expiresIn } });
    res.json({ url, expiresIn, document });
  } catch (err) {
    next(err);
  }
}

export async function deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await documentService.softDelete(req.params.id);
    await auditService.record(req, { action: 'delete', documentId: doc.id, metadata: {} });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

export async function restoreDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await documentService.restore(req.params.id);
    await auditService.record(req, { action: 'edit', documentId: doc.id, metadata: { stage: 'restored' } });
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
}

export async function verifyDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
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

export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entries = await ledgerService.listByDocument(req.params.id);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
}
