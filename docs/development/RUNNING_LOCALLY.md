# Running the document service locally

## Standalone (this repo only)

```powershell
copy .env.example .env
docker compose up -d --build
```

This brings up three containers:

| Container | Image | Port |
|-----------|-------|------|
| `postgres` | `postgres:16-alpine` | (internal) |
| `minio` | `minio/minio:RELEASE.2024-09-13T20-26-02Z` | host 9000 (API), 9001 (console) |
| `app` | this Dockerfile | host **8081** |

The app's command runs `node dist/database/migrate.js && node dist/server.js`, so the schema is brought to head on every restart.

## Required setup

The Dockerfile copies `.tools/keys/` into the image (`COPY .tools/keys /app/.tools/keys`). Before the first build, place the **public** RSA key (from the Go core) at:

```
.tools/keys/jwt_public_dev.pem
```

Without it, the verifier in `src/middleware/auth.ts` cannot start and every request will return `500` with `code='INTERNAL'`.

See [../../go/ficct-boutique-backend-go/docs/development/JWT_KEYS.md](../../../../go/ficct-boutique-backend-go/docs/development/JWT_KEYS.md) for the key-generation procedure.

## Smoke tests

```powershell
# 1. Health
curl http://localhost:8081/health
# {"status":"ok","service":"ficct-docs"}

# 2. Anonymous read — must be denied
curl -i http://localhost:8081/api/v1/documents
# HTTP/1.1 401 Unauthorized
```

Authenticated calls require a token from the Go service:

```powershell
$resp = curl -s -X POST http://localhost:8093/graphql `
  -H "Content-Type: application/json" `
  -d '{\"query\":\"mutation { login(input:{email:\\\"<admin-email>\\\",password:\\\"<admin-password>\\\"}) { accessToken } }\"}'
$token = ($resp | ConvertFrom-Json).data.login.accessToken

curl http://localhost:8081/api/v1/documents -H "Authorization: Bearer $token"
# {"documents":[],"limit":50,"offset":0}
```

## Full system

When running under `docker-compose.full.yml` in the Go repo:

- This service is reachable at `http://localhost:8091` (not `8081`).
- The MinIO API moves to `http://localhost:9010` and the console to `http://localhost:9011`.
- `S3_PUBLIC_ENDPOINT=http://localhost:9010` is set explicitly so presigned URLs point at the right host from a browser running on the developer's machine.

## Inspecting MinIO

Console: `http://localhost:9001` (standalone) or `http://localhost:9011` (full system).

Credentials match the env: `minio-access` / `minio-secret-change-me`.

Bucket: `ficct-documents`. Policy: `none` (private). Listing the bucket through the console shows uploaded files; clicking a file gives you a *console-signed* URL that is unrelated to the URLs this service issues.

## Resetting

```powershell
docker compose down -v
# blows away both the Postgres data volume AND the MinIO data volume.
```

If the JWT public key is rotated, restart the `app` container — the verifier loads the file at startup and does not watch it.
