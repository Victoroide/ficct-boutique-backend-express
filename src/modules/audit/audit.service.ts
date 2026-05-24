import type { Request } from 'express';
import { auditRepository, type AuditAction, type AuditEntry, type InsertAuditInput } from './audit.repository';

export class AuditService {
  async record(req: Request, input: Omit<InsertAuditInput, 'actorUserId' | 'actorEmail' | 'actorRole' | 'requestId' | 'ipAddress' | 'userAgent'>): Promise<AuditEntry> {
    return auditRepository.insert({
      ...input,
      actorUserId: req.auth?.sub ?? null,
      actorEmail: req.auth?.email ?? null,
      actorRole: req.auth?.role ?? null,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
  }

  async list(filters: {
    documentId?: string;
    action?: AuditAction;
    actorUserId?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditEntry[]> {
    return auditRepository.list({
      ...filters,
      limit: filters.limit ?? 100,
      offset: filters.offset ?? 0,
    });
  }
}

export const auditService = new AuditService();
