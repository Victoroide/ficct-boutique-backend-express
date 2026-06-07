/**
 * Regression test for the env boolean-parsing footgun.
 *
 * `z.coerce.boolean()` uses Boolean(value), so the string "false" coerced to
 * `true` — which silently enabled S3 server-side encryption and broke presigned
 * uploads against KMS-less MinIO (HTTP 501). config now uses a string-aware
 * `boolFromEnv` preprocessor; these tests pin the corrected behavior.
 */
describe('env boolean parsing (SSE footgun fix)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function loadConfig(): typeof import('./index').config {
    let cfg!: typeof import('./index').config;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cfg = require('./index').config;
    });
    return cfg;
  }

  it('treats S3_SERVER_SIDE_ENCRYPTION="false" as false (was the bug)', () => {
    process.env.S3_SERVER_SIDE_ENCRYPTION = 'false';
    expect(loadConfig().s3.serverSideEncryption).toBe(false);
  });

  it('treats S3_SERVER_SIDE_ENCRYPTION="true" as true', () => {
    process.env.S3_SERVER_SIDE_ENCRYPTION = 'true';
    expect(loadConfig().s3.serverSideEncryption).toBe(true);
  });

  it('defaults S3_SERVER_SIDE_ENCRYPTION to false when unset', () => {
    delete process.env.S3_SERVER_SIDE_ENCRYPTION;
    expect(loadConfig().s3.serverSideEncryption).toBe(false);
  });

  it('parses S3_FORCE_PATH_STYLE="false" as false and defaults to true', () => {
    delete process.env.S3_FORCE_PATH_STYLE;
    expect(loadConfig().s3.forcePathStyle).toBe(true);
    process.env.S3_FORCE_PATH_STYLE = 'false';
    expect(loadConfig().s3.forcePathStyle).toBe(false);
  });
});
