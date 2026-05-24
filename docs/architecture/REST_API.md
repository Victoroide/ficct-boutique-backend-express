# REST API Reference

Base path: `/api/v1`. All routes (except `/health`) require an RS256 bearer token issued by the Go service.

The route definitions are in:

- [src/modules/documents/document.routes.ts](../../src/modules/documents/document.routes.ts)
- [src/modules/audit/audit.routes.ts](../../src/modules/audit/audit.routes.ts)

## Auth header

```
Authorization: Bearer <accessToken>
```

The verifier (in [src/middleware/auth.ts](../../src/middleware/auth.ts)) checks `iss`, `aud`, `exp`, and the RS256 signature against the public key loaded at startup. On any failure, the route returns `401`.

`req.auth` is populated with the decoded claims: `{ sub, email, role, iss, aud, exp, iat }`.

## Roles

The middleware exposes `requireRoles('admin', 'staff', ...)`. The token's `role` claim is checked against the allow list. `customer` accounts can read but cannot create/confirm/delete documents.

---

## Endpoints

### `GET /health`

Public. Returns `200 { "status": "ok", "service": "ficct-docs" }`. No auth required.

### `POST /api/v1/documents/upload-request`

**Roles:** `admin`, `staff`.

```jsonc
// request
{
  "title": "Invoice 2026-05-23",
  "description": "...",                              // optional
  "category": "pdf",                                 // word | excel | pdf | image | other
  "mimeType": "application/pdf",
  "sizeBytes": 124850,
  "metadata": { "saleId": "..." }                    // optional, free-form
}
```

Server:

1. Validates the body with `createUploadRequestSchema`.
2. Verifies the `mimeType` is allowed for the chosen `category` (`ALLOWED_MIMES`).
3. Inserts a `pending` document row.
4. Returns a presigned PUT URL plus the row.

```jsonc
// 201 response
{
  "document": {
    "id": "<uuid>",
    "owner_user_id": "<uuid>",
    "title": "...",
    "category": "pdf",
    "storage_key": "pdf/2026-05-23/<uuid>.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 124850,
    "status": "pending",
    "sha256": null,
    "metadata": { ... },
    "created_at": "...",
    "updated_at": "..."
  },
  "upload": {
    "url": "http://localhost:9010/ficct-documents/...",
    "method": "PUT",
    "headers": { "Content-Type": "application/pdf" },
    "expiresIn": 900,
    "key": "pdf/2026-05-23/<uuid>.pdf"
  }
}
```

Audit row written: `action='upload'`, `metadata.stage='requested'`.

### `POST /api/v1/documents/:id/confirm`

**Roles:** `admin`, `staff`.

```jsonc
// request
{ "sha256": "<64 hex characters>" }
```

Server:

1. Loads the document. Must be `status='pending'`.
2. `HeadObject` on storage — must exist.
3. `GetObject` + stream SHA-256 hash. Must equal the claimed `sha256`.
4. `UPDATE documents SET status='active', sha256=..., size_bytes=..., mime_type=...`.
5. `ledger.append({ documentId, sha256, recordedBy })`.

Returns `200 { "document": {...} }` with `status='active'`. Audit row: `action='upload'`, `metadata.stage='confirmed'`.

Failure modes:

| Condition | Error code | HTTP |
|-----------|------------|------|
| Document not found | `NOT_FOUND` | 404 |
| Document not `pending` | `CONFLICT` | 409 |
| Object missing in storage | `BAD_REQUEST` | 400 |
| Hash mismatch | `INTEGRITY_FAILED` | 422 |

### `GET /api/v1/documents`

**Roles:** any authenticated.

Query parameters (all optional):

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `ownerUserId` | uuid | — | exact match |
| `category` | enum | — | one of the five categories |
| `status` | enum | — | `pending` \| `active` \| `deleted` |
| `limit` | int | 50 | clamped to 1..200 |
| `offset` | int | 0 | |

Returns `{ "documents": [...], "limit": ..., "offset": ... }`.

### `GET /api/v1/documents/:id`

**Roles:** any authenticated.

Returns `{ "document": {...} }`. Audit row: `action='read'`.

### `GET /api/v1/documents/:id/download-url`

**Roles:** any authenticated.

Requires the document to be `active`. Returns a freshly-signed GET URL.

```jsonc
{
  "url": "http://localhost:9010/ficct-documents/...",
  "expiresIn": 900,
  "document": { ... }
}
```

Audit row: `action='download'`, `metadata.expiresIn=...`. The actual bytes never traverse Node — the browser fetches them directly from S3/MinIO.

### `GET /api/v1/documents/:id/verify`

**Roles:** `admin`, `staff`.

Returns:

```jsonc
{
  "document": { ... },
  "intact": true,           // current SHA-256 == documents.sha256
  "chainIntact": true,      // every ledger chain_hash recomputed correctly
  "storedSha": "<hex>",
  "currentSha": "<hex>",
  "brokenAt": -1            // index of first bad ledger row, or -1 if intact
}
```

If either flag is false the controller **also** throws `INTEGRITY_FAILED` (HTTP 422), so naive clients that ignore the body still see a non-2xx. Audit row: `action='verify'`.

### `GET /api/v1/documents/:id/ledger`

**Roles:** any authenticated.

Returns `{ "entries": [...] }`. Useful for showing a per-document timeline in the admin UI.

### `DELETE /api/v1/documents/:id`

**Roles:** `admin`.

Soft delete: `UPDATE documents SET status='deleted', updated_at=NOW()`. The S3 object is **not** removed (intentional — see the README). Audit row: `action='delete'`.

### `POST /api/v1/documents/:id/restore`

**Roles:** `admin`.

Inverse of delete: `UPDATE documents SET status='active'` (only valid if the current status is `deleted`). Audit row: `action='edit'`, `metadata.stage='restored'`.

### `GET /api/v1/audit`

**Roles:** `admin`.

Query parameters (all optional):

| Param | Type | Notes |
|-------|------|-------|
| `documentId` | uuid | filter to one document |
| `action` | enum | `upload \| read \| download \| edit \| delete \| verify` |
| `actorUserId` | uuid | |
| `limit` | int | clamped 1..500 |
| `offset` | int | |

Returns `{ "entries": [...] }`.

---

## Error envelope

The error handler in [src/middleware/error.ts](../../src/middleware/error.ts) emits:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "document not found",
    "details": { ... }       // optional, for INTEGRITY_FAILED etc.
  }
}
```

Codes used today: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNSUPPORTED_MEDIA_TYPE` (415), `INTEGRITY_FAILED` (422), `INTERNAL` (500).
