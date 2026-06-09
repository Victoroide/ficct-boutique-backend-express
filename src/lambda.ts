// AWS Lambda entrypoint. Wraps the same Express app used locally/in Docker with
// serverless-http so MS3 runs behind a Lambda Function URL / API Gateway without
// changing the HTTP API contract. Local execution still uses src/server.ts.
import serverless from 'serverless-http';
import { createApp } from './app';

export const handler = serverless(createApp());
