import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { auditService } from './audit.service';

export const auditRouter = Router();

const listSchema = z.object({
  documentId: z.string().uuid().optional(),
  action: z.enum(['upload', 'read', 'download', 'edit', 'delete', 'verify']).optional(),
  actorUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

auditRouter.use(requireAuth, requireRoles('admin'));

auditRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listSchema.parse(req.query);
    const entries = await auditService.list(q);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});
