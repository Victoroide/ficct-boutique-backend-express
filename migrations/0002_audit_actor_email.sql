-- Store the actor's email at the time of the action so the audit UI can show
-- a readable label without cross-service lookups.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_actor_email ON audit_logs(actor_email);
