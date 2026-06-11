import 'dotenv/config';
import { z } from 'zod';

// Parse booleans from env strings safely. `z.coerce.boolean()` uses Boolean(v),
// so the string "false" becomes `true` — a footgun that silently enabled SSE.
// Treat only explicit truthy tokens as true; everything else (incl. "false") is false.
const boolFromEnv = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v),
  z.boolean(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8081),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),

  JWT_PUBLIC_KEY_PATH: z.string().default('/app/.tools/keys/jwt_public_dev.pem'),
  // Production injects the public key as a PEM string (preferred over the file
  // path) so it can match the Go core's production signing key.
  JWT_PUBLIC_KEY_PEM: z.string().optional(),
  JWT_ISSUER: z.string().default('ficct-go'),
  JWT_AUDIENCE: z.string().default('ficct-express'),
  JWT_KEY_ID: z.string().default('dev-1'),

  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:4200'),

  S3_ENDPOINT: z.string().url(),
  // Browser-facing endpoint used to generate presigned URLs. When set,
  // presign uses this; the server-side S3 client keeps using S3_ENDPOINT
  // for HeadObject/GetObject. Falls back to S3_ENDPOINT if absent.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: boolFromEnv.default(true),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_PRESIGN_EXPIRY_SECONDS: z.coerce.number().default(900),
  // Set to "true" in environments where the bucket is backed by KMS (AWS S3
  // or MinIO+KMS). Local MinIO without KMS will reject SSE-AES256.
  S3_SERVER_SIDE_ENCRYPTION: boolFromEnv.default(false),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  jwt: {
    publicKeyPath: env.JWT_PUBLIC_KEY_PATH,
    publicKeyPem: env.JWT_PUBLIC_KEY_PEM,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    keyId: env.JWT_KEY_ID,
  },
  corsOrigins: env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  s3: {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    presignExpirySeconds: env.S3_PRESIGN_EXPIRY_SECONDS,
    serverSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },
} as const;

export type AppConfig = typeof config;
