import {
  ALLOWED_MIMES,
  confirmUploadSchema,
  createUploadRequestSchema,
} from './document.validators';

describe('document validators', () => {
  it('accepts a valid pdf upload request', () => {
    const result = createUploadRequestSchema.parse({
      title: 'Q3 invoice batch',
      category: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100_000,
    });
    expect(result.title).toBe('Q3 invoice batch');
    expect(ALLOWED_MIMES.pdf).toContain(result.mimeType);
  });

  it('rejects oversize files (50 MiB limit)', () => {
    const safe = createUploadRequestSchema.safeParse({
      title: 'huge',
      category: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 60 * 1024 * 1024,
    });
    expect(safe.success).toBe(false);
  });

  it('rejects malformed sha256 in confirm', () => {
    const safe = confirmUploadSchema.safeParse({ sha256: 'notahex' });
    expect(safe.success).toBe(false);
  });

  it('accepts a 64-char hex sha256', () => {
    const safe = confirmUploadSchema.safeParse({ sha256: 'a'.repeat(64) });
    expect(safe.success).toBe(true);
  });
});
