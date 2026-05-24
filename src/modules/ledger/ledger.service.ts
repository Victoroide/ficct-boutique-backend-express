import { createHash } from 'crypto';
import { type PoolClient } from 'pg';
import { pool } from '../../database/pool';

export interface LedgerEntry {
  id: string;
  document_id: string;
  version_id: string | null;
  sha256: string;
  prev_chain_hash: string | null;
  chain_hash: string;
  recorded_by: string;
  recorded_at: Date;
}

export class LedgerService {
  /**
   * Append a hash entry to the per-document ledger. The chain_hash is computed
   * as SHA-256(prev_chain_hash || sha256). This makes the ledger tamper-evident:
   * altering any past sha256 invalidates every chain_hash after it.
   */
  async append(input: {
    documentId: string;
    versionId?: string | null;
    sha256: string;
    recordedBy: string;
    client?: PoolClient;
  }): Promise<LedgerEntry> {
    const exec = input.client ?? pool;
    const prev = await exec.query<{ chain_hash: string }>(
      `SELECT chain_hash FROM hash_ledger WHERE document_id = $1 ORDER BY id DESC LIMIT 1`,
      [input.documentId],
    );
    const prevChain = prev.rows[0]?.chain_hash ?? null;

    const chain = createHash('sha256')
      .update(prevChain ?? '')
      .update('|')
      .update(input.sha256)
      .digest('hex');

    const result = await exec.query<LedgerEntry>(
      `INSERT INTO hash_ledger (document_id, version_id, sha256, prev_chain_hash, chain_hash, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [input.documentId, input.versionId ?? null, input.sha256, prevChain, chain, input.recordedBy],
    );
    return result.rows[0];
  }

  async listByDocument(documentId: string): Promise<LedgerEntry[]> {
    const result = await pool.query<LedgerEntry>(
      `SELECT * FROM hash_ledger WHERE document_id = $1 ORDER BY id ASC`,
      [documentId],
    );
    return result.rows;
  }

  /**
   * Verify that the chain has not been tampered with by recomputing chain_hash
   * for every entry from the genesis. Returns the index of the first bad row, or -1 if intact.
   */
  async verifyChain(documentId: string): Promise<{ intact: boolean; brokenAt: number; entries: LedgerEntry[] }> {
    const entries = await this.listByDocument(documentId);
    let prevChain: string | null = null;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const expected: string = createHash('sha256')
        .update(prevChain ?? '')
        .update('|')
        .update(e.sha256)
        .digest('hex');
      if (expected !== e.chain_hash || (prevChain ?? null) !== (e.prev_chain_hash ?? null)) {
        return { intact: false, brokenAt: i, entries };
      }
      prevChain = e.chain_hash;
    }
    return { intact: true, brokenAt: -1, entries };
  }
}

export const ledgerService = new LedgerService();
