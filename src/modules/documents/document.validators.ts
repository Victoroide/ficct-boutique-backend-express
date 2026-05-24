import { z } from 'zod';

const categoryEnum = z.enum(['word', 'excel', 'pdf', 'image', 'other']);

export const createUploadRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: categoryEnum,
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  metadata: z.record(z.unknown()).optional(),
});

export const confirmUploadSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const listDocumentsSchema = z.object({
  category: categoryEnum.optional(),
  status: z.enum(['pending', 'active', 'deleted']).optional(),
  ownerUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const verifyDocumentSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const ALLOWED_MIMES: Record<z.infer<typeof categoryEnum>, string[]> = {
  word: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  other: ['application/octet-stream'],
};
