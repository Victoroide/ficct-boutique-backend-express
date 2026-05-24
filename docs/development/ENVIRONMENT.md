# Environment variables

Source of truth: [src/config/index.ts](../../src/config/index.ts) (a `zod` schema that fails fast on invalid values).

## Server

| Variable | Default | Effect |
|----------|---------|--------|
| `NODE_ENV` | `development` | `pino` logger preset (pretty in dev, JSON in prod). |
| `PORT` | `8081` | HTTP port inside the container. |
| `LOG_LEVEL` | `info` | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |

## Database

| Variable | Required | Effect |
|----------|----------|--------|
| `DATABASE_URL` | yes | `postgres://user:pass@host:port/db` — `pg` reads `sslmode` from the connection string. |

## JWT (verifier only)

This service does not issue tokens. It only verifies them.

| Variable | Default | Effect |
|----------|---------|--------|
| `JWT_PUBLIC_KEY_PATH` | — (required by zod) | Path to the RSA public PEM produced by the Go core. |
| `JWT_ISSUER` | `ficct-go` | Required `iss` claim. |
| `JWT_AUDIENCE` | `ficct-express` | Token's `aud` must include this value. |
| `JWT_KEY_ID` | `dev-1` | Documentation only (the verifier does not currently switch keys by `kid`). |

## CORS

| Variable | Default | Effect |
|----------|---------|--------|
| `CORS_ALLOWED_ORIGINS` | `http://localhost:4200` | Comma-separated allow-list. Requests with no `Origin` header are allowed (server-to-server). |

## S3 / MinIO

| Variable | Default | Effect |
|----------|---------|--------|
| `S3_ENDPOINT` | — (required) | Server-side endpoint. The S3 client uses this for HeadObject/GetObject. |
| `S3_PUBLIC_ENDPOINT` | falls back to `S3_ENDPOINT` | Used only when generating presigned URLs returned to the browser. |
| `S3_REGION` | `us-east-1` | |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO; safe for AWS S3 too. |
| `S3_BUCKET` | — (required) | `ficct-documents` in dev. Must already exist (the meta-compose's `minio-bootstrap` creates it). |
| `S3_ACCESS_KEY_ID` | — (required) | |
| `S3_SECRET_ACCESS_KEY` | — (required) | |
| `S3_PRESIGN_EXPIRY_SECONDS` | `900` | TTL for presigned PUT and GET URLs. |
| `S3_SERVER_SIDE_ENCRYPTION` | `false` | When `true`, presigned PUTs require `x-amz-server-side-encryption: AES256`. Leave off for local MinIO without KMS. |

## Rate limit

| Variable | Default | Effect |
|----------|---------|--------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window length in ms. |
| `RATE_LIMIT_MAX` | `120` | Max requests per window per IP. |

## Reading these in code

```typescript
import { config } from './config';
config.jwt.publicKeyPath  // string
config.s3.serverSideEncryption  // boolean
config.corsOrigins  // string[]
```

`config` is frozen by TypeScript's `as const`. If you add a variable, also add it to [.env.example](../../.env.example) so it shows up in every dev's `.env`.
