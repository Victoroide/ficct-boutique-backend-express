import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bucket, s3, s3Public } from './s3.client';
import { config } from '../../config';

export interface PresignUploadInput {
  key: string;
  contentType: string;
  contentLengthMax?: number;
}

export interface PresignUploadResult {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
  key: string;
}

/**
 * Generate a presigned S3/MinIO PUT URL for uploading an object.
 * @param input - target `key`, `contentType`, and optional `contentLengthMax`.
 * @returns the signed `url`, `method` ('PUT'), required `headers` (incl. SSE when
 * enabled), `key`, and `expiresIn` (TTL in seconds from config.s3.presignExpirySeconds).
 */
export async function presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
  const sse = config.s3.serverSideEncryption;
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType,
    ...(sse ? { ServerSideEncryption: 'AES256' } : {}),
  });
  // Use the public-endpoint client so the URL host matches what the browser will hit.
  const url = await getSignedUrl(s3Public, cmd, { expiresIn: config.s3.presignExpirySeconds });
  const headers: Record<string, string> = { 'Content-Type': input.contentType };
  if (sse) {
    // SSE header is part of the signature; the client must send it on PUT.
    headers['x-amz-server-side-encryption'] = 'AES256';
  }
  return {
    url,
    method: 'PUT',
    headers,
    expiresIn: config.s3.presignExpirySeconds,
    key: input.key,
  };
}

/**
 * Generate a presigned S3/MinIO GET URL for downloading an object.
 * @param key - the storage key to fetch.
 * @returns the signed `url` and `expiresIn` (TTL in seconds from config.s3.presignExpirySeconds).
 */
export async function presignDownload(key: string): Promise<{ url: string; expiresIn: number }> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3Public, cmd, { expiresIn: config.s3.presignExpirySeconds });
  return { url, expiresIn: config.s3.presignExpirySeconds };
}

export interface HeadObjectInfo {
  exists: boolean;
  size: number;
  contentType?: string;
  etag?: string;
}

/**
 * Issue a HeadObject request to check whether an object exists and read its metadata.
 * @param key - the storage key to inspect.
 * @returns `{ exists, size, contentType?, etag? }`; `exists: false` when the object
 * is missing (NotFound/NoSuchKey). Other errors are rethrown.
 */
export async function headObject(key: string): Promise<HeadObjectInfo> {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      exists: true,
      size: Number(out.ContentLength ?? 0),
      contentType: out.ContentType,
      etag: out.ETag?.replace(/"/g, ''),
    };
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === 'NotFound' || code === 'NoSuchKey') {
      return { exists: false, size: 0 };
    }
    throw err;
  }
}
