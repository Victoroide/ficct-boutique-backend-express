# MS3 — AWS Deployment

MS3 (document service) runs on **AWS Lambda** behind an **API Gateway HTTP API**.
Storage is **private AWS S3**; metadata/audit/hash-ledger live in **NeonDB
PostgreSQL**. It is the same Express app used locally — `src/lambda.ts` wraps it
with `serverless-http`; `src/server.ts` still runs it as a normal Node server for
local/Docker.

## Live resources (us-east-1)

- Lambda function: `ficct-ms3-docs` (nodejs20.x, handler `dist/lambda.handler`)
- API Gateway HTTP API → public base URL: `https://bptu80mcbk.execute-api.us-east-1.amazonaws.com`
- S3 bucket: `ficct-boutique-documents` (block-all-public-access, SSE-S3, lifecycle)
- DB: NeonDB (`DATABASE_URL`)

A Lambda **Function URL** was attempted first but is denied by an Organization SCP
(`AccessDeniedException` on the public URL), so API Gateway HTTP API is the public
entrypoint.

## CI/CD

`.github/workflows/deploy-ms3-aws.yml` runs on push to `main`: install → lint →
typecheck → test → build → run NeonDB migrations → package production bundle →
`aws lambda update-function-code`.

### Required GitHub Secrets

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | deploy credentials (see IAM policy) |
| `AWS_REGION` | `us-east-1` |
| `DATABASE_URL` | NeonDB connection string (migrations) |
| `S3_BUCKET_NAME` | `ficct-boutique-documents` |
| `LAMBDA_FUNCTION_NAME` | `ficct-ms3-docs` |
| `LAMBDA_ARTIFACT_BUCKET` | bucket for the deploy zip (e.g. `ficct-boutique-documents`) |

Never printed; never committed.

### Lambda function environment variables (set on the function, not in CI)

`NODE_ENV=production`, `DATABASE_URL`, `JWT_PUBLIC_KEY_PEM` (Go core **prod** public
key), `JWT_ISSUER=ficct-go`, `JWT_AUDIENCE=ficct-express`, `JWT_KEY_ID=prod-1`,
`S3_ENDPOINT=https://s3.us-east-1.amazonaws.com`, `S3_REGION=us-east-1`,
`S3_FORCE_PATH_STYLE=false`, `S3_BUCKET=ficct-boutique-documents`,
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, `S3_SERVER_SIDE_ENCRYPTION=true`,
`S3_PRESIGN_EXPIRY_SECONDS=900`, `CORS_ALLOWED_ORIGINS`.

## Least-privilege IAM

### CI deploy policy (attach to the deploy user used in GitHub Secrets)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "Artifact", "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::ficct-boutique-documents/lambda-deploy/*" },
    { "Sid": "DeployFn", "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode","lambda:GetFunction","lambda:PublishVersion","lambda:UpdateFunctionConfiguration"],
      "Resource": "arn:aws:lambda:us-east-1:654654410319:function:ficct-ms3-docs" }
  ]
}
```

### Runtime S3 policy (used by the app's S3 credentials / or the Lambda role)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject","s3:HeadObject"],
      "Resource": "arn:aws:s3:::ficct-boutique-documents/*" }
  ]
}
```

The Lambda execution role (`ficct-ms3-lambda-role`) only needs
`AWSLambdaBasicExecutionRole` (CloudWatch logs); S3 is reached via the app's
`S3_ACCESS_KEY_ID/SECRET` env credentials.

## Verified

`/health` 200; with a Go-issued JWT: upload-request → presigned S3 PUT (200) →
confirm (active) → verify (`intact=true`, `chainIntact=true`).
