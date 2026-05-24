import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { config } from '../config';
import { logger } from '../shared/logger';

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version BIGINT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function applied(client: Client): Promise<Set<number>> {
  const result = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((r) => Number(r.version)));
}

async function main(): Promise<void> {
  const dir = path.resolve(__dirname, '../../migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const done = await applied(client);

    for (const file of files) {
      const match = file.match(/^(\d+)_/);
      if (!match) continue;
      const version = Number(match[1]);
      if (done.has(version)) continue;

      const sql = readFileSync(path.join(dir, file), 'utf8');
      logger.info({ version, file }, 'applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    logger.info('migrations complete');
  } finally {
    await client.end();
  }
}

main().catch((err: Error) => {
  logger.error({ err: err.message }, 'migration failed');
  process.exit(1);
});
