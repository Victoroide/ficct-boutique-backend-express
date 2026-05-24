# FICCT Boutique — Document Service (MS3)

Express + TypeScript service responsible for secure document storage. It owns:

- The PostgreSQL `documents` / `document_versions` / `hash_ledger` / `audit_logs` tables.
- A private S3-compatible bucket (MinIO in dev, real S3 in prod).
- Short-lived presigned PUT/GET URLs so files never proxy through Node.
- An append-only SHA-256 hash ledger that can detect tampering of either the stored bytes or the ledger itself.

It does **not** own users, sessions, catalog, sales, or inventory — those live in the Go core (MS1). All routes here require a Bearer token issued by Go and verified locally with the public key.

---

## What is real in this repo

What this service **does**:

- Verifies RS256 bearer tokens (`jsonwebtoken`) against the public PEM at `JWT_PUBLIC_KEY_PATH`.
- Issues presigned PUT URLs so the client uploads bytes directly to S3/MinIO.
- On confirm, fetches the object back, computes the SHA-256, validates it against the client-claimed hash, marks the row `active`, and appends a chain entry to `hash_ledger`.
- Lists, fetches, soft-deletes, and restores documents.
- Verifies integrity (re-hashes stored bytes + re-walks the chain).
- Records every state-changing call into `audit_logs` and exposes a `GET /api/v1/audit` query (admin-only).

What this service **does not do**:

- It does not bypass S3 — bytes never traverse Node, even for download.
- It does not allow public bucket access. Every read is through a presigned GET URL (default 15-minute expiry).
- It does not delete S3 objects when a document is soft-deleted. The DB row goes to `status='deleted'` and the object remains in S3 (so audit + chain remain intact). Restore is therefore lossless.
- It does not enforce server-side encryption by default. SSE is only added to presigned PUTs when `S3_SERVER_SIDE_ENCRYPTION=true` (set this only when the bucket actually supports KMS — local MinIO without KMS will reject SSE-AES256).
- It does not have a virus-scan step. ClamAV integration is on the future-work list and is not implemented.
- It does not have document versioning routes (`/versions`). The `document_versions` table is in the schema but no controller is wired to it.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js 20, Express 4, TypeScript 5 |
| Database | PostgreSQL 16 via `pg` Pool |
| Object store | AWS SDK v3 (`@aws-sdk/client-s3` + `s3-request-presigner`), MinIO in dev, path-style |
| Auth | `jsonwebtoken` (RS256 verify only) |
| Validation | `zod` |
| Logging | `pino` + `pino-http` |
| Security middleware | `helmet`, allow-list `cors`, `express-rate-limit` |
| Test | Jest (unit only) |

---

## Directory layout

```
src/
  app.ts                  Express composition (helmet, cors, rate-limit, routers, error handler)
  server.ts               HTTP server + graceful shutdown
  config/                 zod-validated env loader
  database/
    migrate.ts            applies migrations/*.sql in lexicographic order
    pool.ts               singleton pg Pool
  middleware/
    auth.ts               requireAuth (RS256 verify) + requireRoles
    error.ts              errorHandler + notFoundHandler
  modules/
    storage/
      s3.client.ts        two S3Clients: internal (S3_ENDPOINT) + public (S3_PUBLIC_ENDPOINT)
      presign.service.ts  presignUpload, presignDownload, headObject
    documents/
      document.controller.ts
      document.repository.ts
      document.routes.ts
      document.service.ts
      document.validators.ts (zod schemas + ALLOWED_MIMES per category)
    audit/
      audit.repository.ts
      audit.service.ts    .record() + .list()
      audit.routes.ts     GET /api/v1/audit (admin)
    ledger/
      ledger.service.ts   SHA-256 chain (append + verifyChain)
  shared/
    errors.ts             AppError with code + status
    logger.ts             pino logger instance
migrations/
  0001_init.sql
  0002_audit_actor_email.sql
```

---

## Running it

### Standalone

```powershell
copy .env.example .env
docker compose up -d --build
# API: http://localhost:8081 (host) → 8081 (container)
# MinIO console: http://localhost:9001 (login minio-access / minio-secret-change-me)
# Health: http://localhost:8081/health
```

The compose file brings up Postgres, MinIO, an `mc`-based bootstrap container (creates the `ficct-documents` bucket and forces it to private), and the Express app. The app container runs `node dist/database/migrate.js && node dist/server.js`, so migrations apply on every start.

### As part of the full system

The full meta-compose lives in the Go repo: `D:\Repositories\go\ficct-boutique-backend-go\docker-compose.full.yml`. From there, this service is reached at host port **8091**.

---

## Scripts

```
npm run build       # tsc -p tsconfig.build.json
npm run start       # node dist/server.js
npm run dev         # ts-node-dev --respawn --transpile-only src/server.ts
npm run lint        # ESLint --max-warnings=0
npm run lint:fix
npm run test        # Jest, --runInBand
npm run typecheck   # tsc --noEmit
npm run migrate     # ts-node src/database/migrate.ts
```

---

## REST surface

Base path: `/api/v1`. All routes require `Authorization: Bearer <accessToken>`. The token must have `iss=ficct-go`, audience including `ficct-express`, and the matching `kid`.

| Method | Path | Roles | Purpose |
|--------|------|-------|---------|
| GET | `/health` | (public) | liveness |
| GET | `/api/v1/documents` | any auth | list documents (filters: `ownerUserId`, `category`, `status`, `limit`, `offset`) |
| POST | `/api/v1/documents/upload-request` | admin, staff | create the DB row + presigned PUT URL |
| POST | `/api/v1/documents/:id/confirm` | admin, staff | re-hash the stored object, mark active, append ledger entry |
| GET | `/api/v1/documents/:id` | any auth | metadata |
| GET | `/api/v1/documents/:id/download-url` | any auth | presigned GET URL (default 15-minute TTL) |
| GET | `/api/v1/documents/:id/verify` | admin, staff | recompute hash + walk chain |
| GET | `/api/v1/documents/:id/ledger` | any auth | per-document ledger entries |
| DELETE | `/api/v1/documents/:id` | admin | soft delete (`status = 'deleted'`) |
| POST | `/api/v1/documents/:id/restore` | admin | bring a deleted document back to `active` |
| GET | `/api/v1/audit` | admin | audit log query (`documentId`, `action`, `actorUserId`, `limit`, `offset`) |

The MIME allow-list lives in [src/modules/documents/document.validators.ts](src/modules/documents/document.validators.ts):

| Category | Accepted MIME types |
|----------|---------------------|
| `word` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/msword` |
| `excel` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` |
| `pdf` | `application/pdf` |
| `image` | `image/jpeg`, `image/png`, `image/webp` |
| `other` | `application/octet-stream` |

Hard size cap: **50 MiB** per upload (validated by `zod` before the presign).

---

## Upload flow

```
1. client          POST /upload-request   { title, category, mimeType, sizeBytes }
   express         → INSERT documents (status='pending')
                   → presign PUT for storage_key=<category>/<yyyy-mm-dd>/<uuid>.<ext>
                   ← { document, upload: { url, method:'PUT', headers, expiresIn, key } }

2. client          PUT <upload.url>  with the bytes (Content-Type must match)
   minio/s3        stores the object

3. client          POST /:id/confirm     { sha256: '<hex>' }
   express         → HeadObject (must exist)
                   → GetObject + SHA-256 stream hash
                   → compare claimedSha256 vs actual; mismatch → INTEGRITY_FAILED
                   → UPDATE documents SET status='active', sha256=..., size_bytes=...
                   → ledger.append (per-document chain)
                   ← { document }
```

Audit rows are written at each stage (`stage='requested'`, `stage='confirmed'`).

---

## Hash ledger

`hash_ledger` is append-only. Each row stores:

| Column | Meaning |
|--------|---------|
| `sha256` | the document content hash that was just observed |
| `prev_chain_hash` | the previous row's `chain_hash` for this `document_id` (or NULL on first row) |
| `chain_hash` | `SHA-256(prev_chain_hash ?? '' \|\| '\|' \|\| sha256)` |
| `recorded_by` | user UUID from the bearer token |

To verify integrity, `documentService.verify(id)` does two things:

1. Streams the current object from S3 and computes its SHA-256. Compares to `documents.sha256`. If they differ, **the bytes were tampered with**.
2. Re-walks every ledger entry for this document, recomputing each `chain_hash` from the previous row's `chain_hash` and that row's `sha256`. If any row's computed `chain_hash` disagrees with what's stored, **the ledger itself was tampered with**. `brokenAt` is the index of the first bad row.

A 200 response from `/verify` carries the structured result; a non-intact verification still returns 200 with `intact=false` and is also surfaced as a `INTEGRITY_FAILED` error so callers cannot ignore it.

---

## Security posture

- **Bucket is private** — `minio-bootstrap` runs `mc anonymous set none local/ficct-documents` so the only way to read an object is through a freshly-signed GET URL with the access keys held by this server.
- **Presigned URLs** default to 15 minutes (`S3_PRESIGN_EXPIRY_SECONDS=900`).
- **Two S3 endpoints**: `S3_ENDPOINT` is used by Node for server-side calls (HeadObject, GetObject); `S3_PUBLIC_ENDPOINT` is used to sign URLs handed back to the browser. This avoids the "URL host doesn't match where the browser can reach the bucket" bug when the same MinIO is reached as `minio:9000` from inside the network and `localhost:9010` from outside.
- **RS256 only** — the verifier explicitly pins `algorithms: ['RS256']`. Other algorithms are rejected.
- **`helmet`** is applied with defaults.
- **CORS** is a strict allow-list parsed from `CORS_ALLOWED_ORIGINS`. No wildcard.
- **Rate limit** is in-process: `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS` per IP. For multi-replica deployments, externalize it.
- **MIME and size** are validated server-side via `zod`. The presigned PUT also pins `Content-Type` so a client can't smuggle a different MIME after the presign.

---

## Known limitations

- No virus scanning. Add ClamAV between presign-confirm and ledger-append if this serves untrusted users.
- Soft-delete keeps the S3 object. There is no GC sweeper for deleted documents — that needs a deliberate retention policy and was left out on purpose.
- Single hashing pass over object storage on confirm. Multipart uploads are not implemented.
- In-process rate limiter is not shared across replicas.
- No `/:id/versions` endpoint despite `document_versions` existing in the schema. Adding a version replaces the storage key and appends to the ledger; the controller for it has not been written.

---

## Documentation index

- [docs/architecture/SYSTEM_OVERVIEW.md](docs/architecture/SYSTEM_OVERVIEW.md) — where this service fits in the FICCT Boutique stack.
- [docs/architecture/REST_API.md](docs/architecture/REST_API.md) — full route reference with request/response shapes.
- [docs/architecture/HASH_LEDGER.md](docs/architecture/HASH_LEDGER.md) — how the tamper-evident chain works.
- [docs/development/RUNNING_LOCALLY.md](docs/development/RUNNING_LOCALLY.md) — bring-up + smoke tests.
- [docs/development/ENVIRONMENT.md](docs/development/ENVIRONMENT.md) — env variable reference.
