import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../../config';

/**
 * Server-side S3/MinIO client used for in-network operations (HeadObject,
 * GetObject). Targets the docker-internal endpoint (config.s3.endpoint).
 */
// Server-side S3 client — uses the docker-internal endpoint so HeadObject and
// GetObject reach MinIO over the compose network.
export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

/**
 * Browser-facing S3/MinIO client used to sign presigned URLs whose host matches
 * the publicly published MinIO endpoint (config.s3.publicEndpoint).
 */
// Browser-facing client — generates presigned URLs that resolve to the host's
// published MinIO port (e.g. http://localhost:9010). The actual sig is the same
// because the credentials and region match; only the host header differs.
export const s3Public = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.publicEndpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

/** Name of the bucket all document objects are stored under (config.s3.bucket). */
export const bucket = config.s3.bucket;
