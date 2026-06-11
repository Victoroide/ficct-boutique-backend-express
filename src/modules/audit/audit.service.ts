import type { Request } from 'express';
import {
  auditRepository,
  type AuditAction,
  type AuditEntry,
  type InsertAuditInput,
} from './audit.repository';

/** Service that writes and queries immutable audit-log entries. */
export class AuditService {
  /**
   * Persist an audit entry, enriching the caller-supplied fields with actor
   * (sub/email/role), request id, IP, and user-agent derived from the request.
   * @returns the stored audit entry.
   */
  async record(
    req: Request,
    input: Omit<
      InsertAuditInput,
      'actorUserId' | 'actorEmail' | 'actorRole' | 'requestId' | 'ipAddress' | 'userAgent'
    >,
  ): Promise<AuditEntry> {
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

  /**
   * List audit entries matching the optional document/action/actor filters,
   * defaulting limit to 100 and offset to 0.
   */
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
