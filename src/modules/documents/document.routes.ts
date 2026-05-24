import { Router } from 'express';
import { requireAuth, requireRoles } from '../../middleware/auth';
import {
  confirmUpload,
  createUploadRequest,
  deleteDocument,
  downloadUrl,
  getDocument,
  getLedger,
  listDocuments,
  restoreDocument,
  verifyDocument,
} from './document.controller';

export const documentRouter = Router();

documentRouter.use(requireAuth);

documentRouter.get('/', listDocuments);
documentRouter.post('/upload-request', requireRoles('admin', 'staff'), createUploadRequest);
documentRouter.post('/:id/confirm', requireRoles('admin', 'staff'), confirmUpload);
documentRouter.get('/:id', getDocument);
documentRouter.get('/:id/download-url', downloadUrl);
documentRouter.get('/:id/verify', requireRoles('admin', 'staff'), verifyDocument);
documentRouter.get('/:id/ledger', requireRoles('admin', 'staff'), getLedger);
documentRouter.delete('/:id', requireRoles('admin'), deleteDocument);
documentRouter.post('/:id/restore', requireRoles('admin'), restoreDocument);
