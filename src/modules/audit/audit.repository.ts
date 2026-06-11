import { pool } from '../../database/pool';

export type AuditAction = 'upload' | 'read' | 'download' | 'edit' | 'delete' | 'verify';

export interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  document_id: string | null;
  action: AuditAction;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface InsertAuditInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  documentId?: string | null;
  action: AuditAction;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Postgres data-access layer for the `audit_logs` table. */
export class AuditRepository {
  /** Insert an audit-log row and return the persisted entry. */
  async insert(input: InsertAuditInput): Promise<AuditEntry> {
    const result = await pool.query<AuditEntry>(
      `INSERT INTO audit_logs (actor_user_id, actor_email, actor_role, document_id, action, request_id, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        input.actorRole ?? null,
        input.documentId ?? null,
        input.action,
        input.requestId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0];
  }

  /**
   * Query audit entries by optional document/action/actor filters with
   * limit/offset paging, newest first.
   */
  async list(filters: {
    documentId?: string;
    action?: AuditAction;
    actorUserId?: string;
    limit: number;
    offset: number;
  }): Promise<AuditEntry[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    let idx = 1;
    if (filters.documentId) {
      where.push(`document_id = $${idx++}`);
      args.push(filters.documentId);
    }
    if (filters.action) {
      where.push(`action = $${idx++}`);
      args.push(filters.action);
    }
    if (filters.actorUserId) {
      where.push(`actor_user_id = $${idx++}`);
      args.push(filters.actorUserId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    args.push(filters.limit, filters.offset);
    const sql = `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    const result = await pool.query<AuditEntry>(sql, args);
    return result.rows;
  }
}

export const auditRepository = new AuditRepository();
