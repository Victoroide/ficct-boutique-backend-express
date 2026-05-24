# System Overview — Document Service (MS3)

This service stores **files**, nothing more. It is one of three backends in the FICCT Boutique system:

```
+----------------+      +------------------+      +-----------------+
|  Go (MS1)      |      |  Express (MS3)   |      |  Django (MS2)   |
|  GraphQL core  |      |  this service    |      |  AI                  |
|  Postgres      |      |  Postgres + S3   |      |  DynamoDB Local |
+----------------+      +------------------+      +-----------------+
       ^                        ^                          ^
       | RS256 issuer           | RS256 verifier           | RS256 verifier
       +------------------------+--------------------------+
                          (public key shared)
```

## Why a separate document service?

Two reasons:

1. **Different storage shape.** Catalog + sales data is highly relational and lives happily in Postgres. Document blobs are big binary objects best handled by S3/MinIO and best kept off the primary OLTP database to avoid bloating its backups.
2. **Audit / chain of custody.** This service exists to give the lab an honest, tamper-evident document trail. The hash ledger is the centerpiece — see [HASH_LEDGER.md](HASH_LEDGER.md).

## What it owns

| Resource | Owner | Notes |
|----------|-------|-------|
| `documents` table | this service | metadata, `storage_key`, content `sha256`, `status` |
| `document_versions` table | this service | schema-only today; no controller wired |
| `hash_ledger` table | this service | append-only chain per document |
| `audit_logs` table | this service | every state-changing operation + reads on confirm |
| `ficct-documents` bucket (MinIO/S3) | this service | private, presigned-only access |

## What it does not own

- Users, sessions, roles — defined by Go. This service only receives them via the JWT claims.
- Product image storage decisions — the Go catalog stores `image_document_id` referring to one of *our* documents; we do not know or care about products.
- Audit policy / retention — there is no scheduled cleanup; document deletion is logical only.

## How clients talk to it

1. Sign in against Go (`mutation login`). Receive the RS256 access token.
2. Call this service with `Authorization: Bearer <token>`. The verifier requires:
   - `alg = RS256`
   - `iss = JWT_ISSUER` (default `ficct-go`)
   - audience includes `JWT_AUDIENCE` (default `ficct-express`)
   - `exp` not in the past
3. For uploads, follow the three-step flow in the [REST API reference](REST_API.md#upload-flow): request → PUT to S3 → confirm.

The Angular admin UI is the only frontend that uses the write endpoints today. Both Angular and the React Native customer app use read endpoints to display attached documents (invoices, evidence, product images).

## Image attachment integration (Go ↔ Express)

The Go catalog stores `image_document_id` on `products`. When an admin uploads a real product image:

1. Angular calls `POST /api/v1/documents/upload-request` here with `category='image'`.
2. Angular uploads the bytes to the presigned PUT URL.
3. Angular calls `POST /api/v1/documents/:id/confirm` here.
4. Angular calls `mutation replaceProductImage(id, newImageDocumentId)` on Go, passing the document ID this service returned.
5. When customers browse the catalog, the Angular admin app or React Native app calls `GET /api/v1/documents/:id/download-url` on this service to obtain a fresh presigned GET URL, which is what the `<img>` tag finally points at.

Seeded products (the four demo SKUs in `cmd/seed`) bypass this entirely and reference `imageUrl='/static/products/<sku>.svg'` — those SVG placeholders are served by Go itself, not by this service.

## Network topology (full-system compose)

| Container | Inside hostname | Container port | Host port |
|-----------|-----------------|----------------|-----------|
| `ficct-full-docs-pg` | `docs-postgres` | 5432 | (internal only) |
| `ficct-full-minio` | `minio` | 9000 / 9001 | 9010 / 9011 |
| `ficct-full-docs` | `express-docs` | 8081 | 8091 |

`S3_PUBLIC_ENDPOINT` is set to `http://localhost:9010` in the meta-compose so the presigned URLs returned to the browser point at the host-reachable MinIO. `S3_ENDPOINT` (used by Node) stays at `http://minio:9000` for in-cluster traffic.
