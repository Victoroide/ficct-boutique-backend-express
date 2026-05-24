import { pool } from '../../database/pool';

export type DocumentCategory = 'word' | 'excel' | 'pdf' | 'image' | 'other';
export type DocumentStatus = 'pending' | 'active' | 'deleted';

export interface DocumentRow {
  id: string;
  owner_user_id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  storage_key: string;
  mime_type: string;
  size_bytes: string; // BIGINT comes back as string
  sha256: string | null;
  status: DocumentStatus;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface InsertDocumentInput {
  ownerUserId: string;
  title: string;
  description?: string | null;
  category: DocumentCategory;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export class DocumentRepository {
  async insert(input: InsertDocumentInput): Promise<DocumentRow> {
    const result = await pool.query<DocumentRow>(
      `INSERT INTO documents (owner_user_id, title, description, category, storage_key, mime_type, size_bytes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING *`,
      [
        input.ownerUserId,
        input.title,
        input.description ?? null,
        input.category,
        input.storageKey,
        input.mimeType,
        input.sizeBytes,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<DocumentRow | null> {
    const result = await pool.query<DocumentRow>(`SELECT * FROM documents WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async findByStorageKey(key: string): Promise<DocumentRow | null> {
    const result = await pool.query<DocumentRow>(`SELECT * FROM documents WHERE storage_key = $1`, [key]);
    return result.rows[0] ?? null;
  }

  async list(filters: {
    ownerUserId?: string;
    category?: DocumentCategory;
    status?: DocumentStatus;
    limit: number;
    offset: number;
  }): Promise<DocumentRow[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    let idx = 1;
    if (filters.ownerUserId) {
      where.push(`owner_user_id = $${idx++}`);
      args.push(filters.ownerUserId);
    }
    if (filters.category) {
      where.push(`category = $${idx++}`);
      args.push(filters.category);
    }
    if (filters.status) {
      where.push(`status = $${idx++}`);
      args.push(filters.status);
    } else {
      where.push(`status <> 'deleted'`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    args.push(filters.limit, filters.offset);
    const sql = `SELECT * FROM documents ${whereSql} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    const result = await pool.query<DocumentRow>(sql, args);
    return result.rows;
  }

  async markActiveWithHash(id: string, sha256: string, sizeBytes: number, mimeType: string): Promise<DocumentRow | null> {
    const result = await pool.query<DocumentRow>(
      `UPDATE documents SET status='active', sha256=$2, size_bytes=$3, mime_type=$4, updated_at=NOW() WHERE id = $1 RETURNING *`,
      [id, sha256, sizeBytes, mimeType],
    );
    return result.rows[0] ?? null;
  }

  async softDelete(id: string): Promise<DocumentRow | null> {
    const result = await pool.query<DocumentRow>(
      `UPDATE documents SET status='deleted', updated_at=NOW() WHERE id = $1 AND status <> 'deleted' RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async restore(id: string): Promise<DocumentRow | null> {
    // Only documents that were previously active can be restored; pending
    // uploads that never completed stay pending.
    const result = await pool.query<DocumentRow>(
      `UPDATE documents SET status='active', updated_at=NOW()
       WHERE id = $1 AND status = 'deleted' AND sha256 IS NOT NULL
       RETURNING *`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}

export const documentRepository = new DocumentRepository();
