# monorepo-express Compatibility & Docker Verification

**Service under test:** `ficct-boutique-backend-express` (FICCT Boutique MS3 — Document Management & Audit)
**Reference/template repo:** `D:\Repositories\typescript\monorepo-express`
**Date:** 2026-06-07
**Method:** Docker-only / project-local containerized verification. No global installs, no git init/commit/push, no Windows configuration changes.

> One report, as required. This file is the only artifact added to the FICCT repo (plus a temporary, git-ignored `.env` used only to run the stack, which is removed at the end of the run).

---

## 1. What `monorepo-express` actually is

`monorepo-express` is **not a generic Express template**. It is **this exact service** (the FICCT Boutique document service) **repackaged as a Turborepo monorepo with an AWS-Lambda deployment layer added**.

Structure:

```
monorepo-express/
├── package.json            # npm workspaces + turbo (root)
├── turbo.json              # turbo task graph (build/test/lint/typecheck/migrate)
├── apps/
│   └── docs-api/           # === the FICCT docs service, Lambda-adapted ===
│       ├── src/            # near-identical to ficct-boutique-backend-express/src
│       │   └── index.ts    # NEW: AWS Lambda handler (@vendia/serverless-express)
│       ├── esbuild.config.js  # NEW: bundles lambda (src/index.ts) + server (src/server.ts)
│       ├── migrations/     # identical SQL to FICCT
│       ├── Dockerfile      # copied from FICCT (vestigial — see §6)
│       └── docker-compose.yml
├── infra/                  # === AWS CDK app (the real deployment mechanism) ===
│   ├── bin/infra.ts
│   ├── lib/base-stack.ts          # Lambda + API Gateway v2 + private S3 + Secrets Manager
│   ├── lib/shared-resources-stack.ts
│   └── lib/validation-aspects.ts  # CDK aspects (tagging, IAM wildcard guard)
├── packages/               # empty (.gitkeep)
└── .github/workflows/      # CI/CD: cdk deploy + lambda update + health check + release
```

**Proof that `apps/docs-api` ≈ FICCT Express:** a recursive diff of the two `src/` trees (normalizing CRLF/whitespace) shows that **only 5 source files differ in content**, the migrations are byte-identical, and `Dockerfile`/`docker-compose.yml`/`tsconfig*`/`jest.config.js` differ **only by line endings (CRLF vs LF)**. The 5 real differences are precisely the changes needed to make the service Lambda-deployable, and they are **backward-compatible supersets** (see §5).

| File | Difference in `monorepo-express` |
|---|---|
| `src/index.ts` | **New file.** `serverlessExpress({ app: createApp() })` — the Lambda handler. |
| `src/config/index.ts` | `JWT_PUBLIC_KEY` (base64 PEM, for Lambda) **or** `JWT_PUBLIC_KEY_PATH` (file, for local); `S3_ACCESS_KEY_ID/SECRET` made **optional** (Lambda uses the IAM role); adds `useStaticCredentials` flag. |
| `src/middleware/auth.ts` | Reads the public key from base64 env var **or** falls back to the file path. |
| `src/modules/storage/s3.client.ts` | Passes `credentials` only when static keys exist; otherwise `undefined` so the SDK uses the Lambda IAM role. |
| `src/database/migrate.ts` | Standalone migrator: reads `DATABASE_URL` directly + `dotenv`, own pino logger (so it runs in CI without the full app config). |
| `src/app.ts` | Health string says `ficct-docs-help` instead of `ficct-docs` — a **divergence/typo**, do **not** copy. |

---

## 2. Deployment approach

**Target = AWS Lambda + API Gateway v2 (HTTP API), provisioned and deployed with AWS CDK.** It is **not** Serverless Framework, **not** SAM, **not** SST.

`infra/lib/base-stack.ts` defines (verified by `cdk synth`, see §8):

- **`lambda-nodejs.NodejsFunction`** — `nodejs20.x`, handler `index.handler`, entry `apps/docs-api/src/index.ts`, esbuild-bundled, 512 MB, 29 s timeout.
- **API Gateway v2 HTTP API** — `AWS_PROXY` integration (payload format 2.0), routes `ANY /` and `ANY /{proxy+}`, `$default` auto-deploy stage with JSON access logs.
- **Private S3 bucket** — `BlockPublicAccess.BLOCK_ALL`, `enforceSSL`, `S3_MANAGED` encryption, lifecycle rule expiring the `deleted/` prefix after 30 days, `RETAIN` in prod.
- **Secrets Manager** — reads `ficct-boutique/{env}/app` (keys `DATABASE_URL`, `JWT_PUBLIC_KEY`); CI/CD populates it before deploy.
- **IAM exec role**, **CloudWatch log groups** (Lambda + API GW).

Build pipeline: `esbuild.config.js` → `dist/index.js` (Lambda) and `dist/server.js` (container/local). CI/CD (`.github/workflows/cicd.yml`): on `main`/tags, `npm ci` → lint/test → `build:lambda:prod` → `npm run migrate` → zip `dist/index.js` → `aws lambda update-function-code`, with `cdk deploy` for infra changes/drift, then a post-deploy `GET /health` gate and (prod) GitHub release.

---

## 3. Required variables

### 3a. monorepo Lambda runtime (set by CDK on the Lambda)
`NODE_ENV`, `DATABASE_URL` (secret), `JWT_PUBLIC_KEY` (secret, base64 PEM), `CORS_ALLOWED_ORIGINS` (`*`), `LOG_LEVEL`, `S3_ENDPOINT` (`https://s3.<region>.amazonaws.com`), `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=false`, `S3_SERVER_SIDE_ENCRYPTION=true`, `S3_PRESIGN_EXPIRY_SECONDS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`. **No** `S3_ACCESS_KEY_ID/SECRET` (IAM role), **no** `JWT_PUBLIC_KEY_PATH`.

### 3b. CI/CD secrets actually required to deploy the monorepo
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (deploy credentials), `DATABASE_URL`, **`JWT_PUBLIC_KEY`** (base64 PEM). That is **4 GitHub Secrets, not 3** — see §3c.

> **The "3 variables" claim (`DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) is incomplete.** It omits `JWT_PUBLIC_KEY`. The auth middleware loads the key at module init; without it the Lambda fails on cold start (`config/index.ts` requires `JWT_PUBLIC_KEY` **or** `JWT_PUBLIC_KEY_PATH`, and the CDK stack only injects `JWT_PUBLIC_KEY`).

### 3c. GitHub Secrets vs Variables (for the Lambda deployment)
| Name | Where | Why |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | **Secret** | Deploy credential (CDK / `aws lambda update-function-code`). |
| `AWS_SECRET_ACCESS_KEY` | **Secret** | Deploy credential. |
| `DATABASE_URL` | **Secret** | Stored into Secrets Manager + used for `npm run migrate`. |
| `JWT_PUBLIC_KEY` | **Secret** | Base64 PEM, stored into Secrets Manager → Lambda env. **Mandatory.** |
| `AWS_DEFAULT_REGION` (`us-east-1`) | **Variable** | Currently hard-coded in the workflow `env:`; safe to externalize as a repo/org Variable. |
| `NODE_VERSION` (`20`) | **Variable** | Hard-coded in the workflow; non-sensitive. |
| dev/prod selection | GitHub **Environment** | Resolved by workflow logic (tag → prod, else dev). |

### 3d. Real FICCT Express service (this repo) — authoritative from `src/config/index.ts`
**Required (no default — boot fails if missing):**
`DATABASE_URL`, `JWT_PUBLIC_KEY_PATH`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — **6 variables, not 3.**
**Optional (defaulted):** `NODE_ENV`, `PORT`, `LOG_LEVEL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_KEY_ID`, `CORS_ALLOWED_ORIGINS`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_PRESIGN_EXPIRY_SECONDS`, `S3_SERVER_SIDE_ENCRYPTION`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`.

> The real service is **not Lambda-aware**: it requires `JWT_PUBLIC_KEY_PATH` (a file) and static S3 keys. It cannot consume the Lambda-only variables (`JWT_PUBLIC_KEY` base64, IAM-role credentials) without the §5 source adaptation.

---

## 4. Compatibility matrix

| Area | monorepo-express (`apps/docs-api` + `infra`) | FICCT Express (this repo) | Compatible? | Action |
|---|---|---|---|---|
| Express app structure | `createApp()` in `app.ts`; identical routers/modules | `createApp()` in `app.ts` | ✅ Identical (1 health-string typo) | Reuse as-is; ignore the `ficct-docs-help` typo |
| Lambda handler | `src/index.ts` (`@vendia/serverless-express`) | **absent** | ➕ Additive | Optional: port `index.ts` + dep (§7) |
| Docker support | Dockerfile present but **build-broken** (no `.tools/keys`) | Dockerfile + compose **working** (verified) | ⚠️ FICCT is better | Keep FICCT's; do not copy monorepo's |
| TypeScript build | esbuild (`build:lambda` + `build:server`) | `tsc -p tsconfig.build.json` | ✅ Both build | Keep FICCT's `tsc`; add esbuild only if going Lambda |
| PostgreSQL | identical schema/migrations; standalone migrator | identical schema/migrations | ✅ Identical | None |
| Migrations | byte-identical SQL | byte-identical SQL | ✅ Identical | None |
| S3 | private bucket; IAM-role creds in Lambda | private bucket; static MinIO creds | ✅ Same model | Adopt optional-creds pattern only if Lambda |
| JWT auth (RS256) | base64 env **or** file; same issuer/audience contract | file path only; pins RS256 | ✅ Contract identical | Adopt env/base64 fallback only if Lambda |
| Env vars | Lambda set (no S3 keys/no key-path) | 6 required (key-path + S3 keys) | ⚠️ Different shapes | See §3 — not interchangeable |
| Tests | jest, 6/6 pass (Docker) | jest, 6/6 pass (Docker) | ✅ Both green | None |
| Deployment target | **AWS Lambda + API GW + S3 via CDK** | **Docker / container** | ➕ Complementary | Use monorepo `infra/` as the Lambda layer |

Legend: ✅ compatible · ➕ additive (monorepo adds a capability) · ⚠️ differs, needs care.

---

## 5. What can be reused (and how, safely)

The monorepo is the **canonical Lambda-deployment template for this exact service**. The reusable, low-risk pieces are:

1. **`infra/` (AWS CDK app)** — drop-in deployment layer. It already references `apps/docs-api/src/index.ts`; if porting into this repo, repoint `entry` to this repo's `src/index.ts`. Verified to `cdk synth` cleanly.
2. **`src/index.ts` Lambda handler** + `@vendia/serverless-express` dependency + `@types/aws-lambda`.
3. **`esbuild.config.js`** (adds `build:lambda` / `build:server` without removing `tsc`).
4. **The 5-file backward-compatible superset** (`config/index.ts`, `middleware/auth.ts`, `s3.client.ts`, `migrate.ts` — **not** `app.ts`). These are supersets: when `JWT_PUBLIC_KEY_PATH` and static S3 keys are present (today's Docker config) they behave **exactly** as the current FICCT code; they merely *also* accept the Lambda style.
5. **`.github/workflows/cicd.yml`** as the CI/CD blueprint (adjust paths from `apps/docs-api` → repo root).

These are **additive**: adopting them gives an *optional* Lambda deployment path **without removing** Docker/local. They were not applied in this pass (see §7).

---

## 6. What must NOT be reused

- ❌ **Do not replace the FICCT service with the monorepo demo.** It is the same code; replacement gains nothing and risks regressions.
- ❌ **Do not copy the monorepo `apps/docs-api/Dockerfile` as-is.** Its build **fails** (`COPY .tools/keys` — the directory was deliberately removed because Lambda injects the key via `JWT_PUBLIC_KEY`). The FICCT Dockerfile is the working one.
- ❌ **Do not copy `app.ts`** — the `ficct-docs-help` health string is a divergence/typo.
- ❌ **Do not adopt the monorepo's older `apps/docs-api/.env.example`** — it lacks the `S3_PUBLIC_ENDPOINT` documentation this repo already has.
- ❌ **Do not move the other 4 repos into the monorepo / convert this repo into a monorepo** (out of scope, explicitly disallowed).
- ❌ **Do not flip `S3_FORCE_PATH_STYLE=false` / `S3_SERVER_SIDE_ENCRYPTION=true` for local MinIO** — those are AWS-only settings.

---

## 7. Safe changes made to FICCT Express

**None to source code.** No file under `src/`, no `Dockerfile`, `docker-compose.yml`, `package.json`, migrations, or workflows were modified. The only additions/temporaries:

- ✅ **Added:** this report (`docs/MONOREPO_EXPRESS_COMPATIBILITY_AND_DOCKER_VERIFICATION.md`) — the required output artifact.
- 🧪 **Temporary:** a git-ignored `.env` (copied from `.env.example`) needed to run `docker compose`. Removed during cleanup.
- 🧪 **Temporary:** an E2E script under `D:\Repositories\typescript\_verify_tmp\` (outside both repos). Removed during cleanup.

The Lambda adaptation in §5 was deliberately **not applied** to avoid touching security-critical config/auth/storage code on a working service without explicit approval. Its viability was instead proven directly in the monorepo (esbuild Lambda build + `cdk synth`, §8). The exact recipe is in §5 and can be applied on request.

### 7a. Bug discovered during verification (action recommended, not yet applied)

`src/config/index.ts` uses `z.coerce.boolean()` for `S3_SERVER_SIDE_ENCRYPTION` (and `S3_FORCE_PATH_STYLE`). In JavaScript `Boolean("false") === true`, so the value `S3_SERVER_SIDE_ENCRYPTION=false` shipped in `.env.example` **actually enables SSE**. Against KMS-less MinIO this breaks every presigned upload with:

```
HTTP 501 NotImplemented — Server side encryption specified but KMS is not configured
```

i.e. the documented quickstart (`cp .env.example .env && docker compose up`) cannot upload a document. **Reproduced empirically** in this run (the E2E went 13/26 → 26/26 only after removing the line so the `default(false)` applied).

Recommended minimal fix (string-aware coercion), e.g.:
```ts
const boolFromEnv = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v),
  z.boolean(),
);
// S3_FORCE_PATH_STYLE: boolFromEnv.default(true),
// S3_SERVER_SIDE_ENCRYPTION: boolFromEnv.default(false),
```
This is independent of the monorepo question; the monorepo `apps/docs-api/config` has the **same** footgun.

---

## 8. Docker commands executed

All work ran in containers or against Docker; nothing was installed on the Windows host. (Git-Bash path mangling was disabled with `MSYS_NO_PATHCONV=1`.)

**monorepo-express — full verification (copied into a `node:20-bullseye` container; host untouched):**
```bash
docker run --rm -v "<monorepo>:/src:ro" -w /work node:20-bullseye bash -lc '
  cp -r /src /work/app && cd /work/app
  npm ci
  npm run lint -w apps/docs-api
  (cd apps/docs-api && npx tsc --noEmit)
  npm run test -w apps/docs-api
  npm run build -w apps/docs-api                 # esbuild → dist/index.js + dist/server.js
  (cd infra && npm ci && npx tsc --noEmit)
  (cd infra && AWS_ACCOUNT_ID=123456789012 CDK_DEFAULT_REGION=us-east-1 \
     npx cdk synth FicctBoutiqueStack-Dev -c environment=dev)
'
```

**monorepo-express — Docker image build (evidence of vestigial Dockerfile):**
```bash
docker build -t monorepo-docs-api:test "<monorepo>/apps/docs-api"
```

**FICCT Express — build/test (copied into container, excluding host node_modules/dist):**
```bash
docker run --rm -v "<ficct>:/src:ro" -w /work node:20-bullseye bash -lc '
  ...tar copy without node_modules/dist...
  npm ci && npm run lint && npm run typecheck && npm test && npm run build
'
```

**FICCT Express — full stack + E2E:**
```bash
cp .env.example .env                                   # then removed the buggy SSE line
docker compose -p ficct-docs-e2e up -d --build         # postgres + minio + bootstrap + app(migrate→serve)
curl http://localhost:8081/health
# E2E runs inside the compose network so presigned minio:9000 URLs resolve:
docker run --rm --network ficct-docs-e2e_default \
  -v "<tmp>:/e2e:ro" \
  -v "<go-repo>/.tools/keys/jwt_private_dev.pem:/keys/priv.pem:ro" \
  -e BASE_URL=http://app:8081 -e PRIV_KEY=/keys/priv.pem \
  node:20-bullseye node /e2e/e2e.js
# Supplementary evidence:
docker run --rm --network ficct-docs-e2e_default curlimages/curl \
  -s -o /dev/null -w '%{http_code}' http://minio:9000/ficct-documents/?list-type=2   # → 403 (private)
docker exec ficct-docs-postgres psql -U ficct -d ficct_documents -c '<row counts>'
docker compose -p ficct-docs-e2e down -v               # cleanup
```

---

## 9. Test / build results

| Check | monorepo-express | FICCT Express |
|---|---|---|
| `npm ci` | ✅ | ✅ |
| Lint (eslint, `--max-warnings=0`) | ✅ | ✅ |
| Typecheck (`tsc --noEmit`) | ✅ app **and** infra | ✅ |
| Unit tests (jest) | ✅ **6/6** (ledger + validators) | ✅ **6/6** |
| Build | ✅ esbuild → `dist/index.js` (1.93 MB Lambda) + `dist/server.js` | ✅ `tsc` → `dist/**` |
| `cdk synth` | ✅ **433 lines CloudFormation** | n/a |
| Docker image build | ❌ **fails** at `COPY .tools/keys` (vestigial) | ✅ image `ficct-boutique-backend-express:dev` builds |
| Compose stack (pg + minio + app) | n/a | ✅ all healthy, migrations applied on start |

**`cdk synth` resource inventory (proves Lambda + API GW + private S3 deployment):**
```
1 AWS::ApiGatewayV2::Api        2 AWS::ApiGatewayV2::Route     1 AWS::ApiGatewayV2::Stage
1 AWS::ApiGatewayV2::Integration
2 AWS::Lambda::Function         1 AWS::Lambda::Permission
2 AWS::IAM::Role                1 AWS::IAM::Policy
2 AWS::Logs::LogGroup
1 AWS::S3::Bucket               1 AWS::S3::BucketPolicy        (private — BlockPublicAccess + enforceSSL)
```

---

## 10. E2E verification results (FICCT Express, Dockerized)

JWTs were minted with the **Go core's RS256 private key** (`ficct-boutique-backend-go/.tools/keys/jwt_private_dev.pem`), which was verified to be the exact pair of this repo's `jwt_public_dev.pem` (`openssl rsa -pubout` matches byte-for-byte). Claims: `iss=ficct-go`, `aud=ficct-express`, roles `admin`/`staff`/`customer`.

**Result: 26 / 26 checks PASS** (after disabling the buggy SSE coercion — see §7a):

| # | Step | Result |
|---|---|---|
| 1–5 | Postgres, MinIO, Express up; migrations applied; JWTs minted | ✅ |
| 6 | `GET /health` → 200 `{status:ok}` | ✅ |
| 7 | `POST /documents/upload-request` (admin) → 201 + presigned PUT, status `pending` | ✅ |
| 8 | `PUT` bytes to presigned URL (MinIO) → 2xx | ✅ |
| 9 | `POST /:id/confirm` (admin) → 200 `active`, server SHA-256 == uploaded | ✅ |
| 9c | confirm with **wrong** SHA-256 → 4xx `INTEGRITY_FAILED` (tamper detection) | ✅ |
| 10 | `GET /documents` lists the doc | ✅ |
| 11 | `GET /:id/download-url` → 200 presigned GET | ✅ |
| 12 | Download bytes; **SHA-256 of downloaded bytes == original** | ✅ |
| 13 | `GET /:id/verify` → `intact=true && chainIntact=true` | ✅ |
| 13b | `GET /:id/ledger` → ≥1 chain entry | ✅ |
| 14 | `GET /audit` (admin) contains `upload`/`download`/`verify` for the doc | ✅ |
| 15 | `DELETE /:id` (admin) → soft-delete, status `deleted` | ✅ |
| 16 | `GET /:id/download-url` on deleted → **404** | ✅ |
| 17 | `POST /:id/restore` (admin) → status `active` | ✅ |
| 18 | Download after restore → 200, bytes hash still matches | ✅ |
| 19a | List with **no token** → 401 | ✅ |
| 19b | Customer **can** list (any-auth route) → 200 | ✅ |
| 19c | Customer `upload-request` → **403** | ✅ |
| 15b | Staff `DELETE` (admin-only) → **403** | ✅ |
| 14b | Customer `GET /audit` → **403** | ✅ |
| 19d | **Forged-signature** token → 401 | ✅ |
| 20 | App logs: **no error/fatal entries, no crashes** | ✅ |

**Supplementary evidence:** unauthenticated `GET` to the MinIO bucket → **HTTP 403** (bucket is private). Postgres after the run: `documents=6`, `hash_ledger=1` (the single confirmed doc), `audit_logs=14` across `upload/download/verify/delete/edit`.

All functional requirements that must not break were exercised and **hold**: Express+TS, PostgreSQL, S3/MinIO private bucket, presigned PUT/GET, document metadata, audit logs, SHA-256 hashing, hash-ledger integrity chain, soft-delete, restore, RS256 JWT verification, RBAC, file/MIME validation, Docker support, existing tests, README accuracy.

---

## 11. Remaining risks

1. **`z.coerce.boolean()` env footgun (§7a)** — present in **both** repos. `S3_SERVER_SIDE_ENCRYPTION=false` enables SSE → 501 on KMS-less MinIO. The shipped `.env.example` triggers it. Recommend the string-aware coercion fix.
2. **The "3 variables" deployment claim is wrong** — the monorepo Lambda needs **4** GitHub Secrets (adds `JWT_PUBLIC_KEY`); the real Docker service needs **6** runtime vars.
3. **monorepo `apps/docs-api/Dockerfile` is broken** — copying it into a container deploy without restoring `.tools/keys` (or removing the COPY) will fail the build.
4. **Adopting the Lambda wrapper edits security-critical files** (`config`, `auth`, `s3.client`). Backward-compatible, but should land behind tests + review (the monorepo already passes lint/typecheck/tests, lowering this risk).
5. **Lambda runtime caveats** (documented, not blocking): in-memory rate-limiter resets per cold start; presign + IAM-role creds differ from MinIO static keys; bundle is ~1.9 MB.
6. **Not deploy-tested on real AWS** — verification stopped at `cdk synth` (no live AWS account, by design / non-negotiables). Synthesis is valid; an actual `cdk deploy` was not performed.
7. **Node 20 vs AWS SDK v3** — SDK warns it will require Node ≥22 after early 2027; both repos pin Node 20. Cosmetic today.

---

## 12. Final recommendation

**Adapt only the deployment wrapper — use the monorepo as the reference/template for an *optional, additive* AWS Lambda path. Do NOT use it as a replacement for this service.**

- The real FICCT Express service is **fully functional and verified** in Docker (build, tests, full document/storage/hash/audit/RBAC E2E: 26/26). Keep it as the source of truth.
- `monorepo-express` is valuable specifically as the **Lambda + API Gateway + private-S3 CDK deployment layer** for this same code, and its app/infra **lint, typecheck, test, and `cdk synth` all pass** in Docker.
- If/when Lambda deployment is wanted, apply the §5 additive recipe (Lambda handler + esbuild + `@vendia/serverless-express` + the 4 backward-compatible source supersets + `infra/`), gated by the existing tests and a review. It will **not** remove Docker/local support.
- Independently, fix the `z.coerce.boolean()` SSE bug (§7a) in this repo so the documented MinIO quickstart works out of the box.

**Verdict per the requested options:** *not* "use as-is", *not* "do not use" → **"use only as reference" for everything except the deployment layer, which is "adapt only the deployment wrapper" (additive, backward-compatible).**

---

## Non-negotiables — confirmation

- ✅ No `git init` · ✅ No commits · ✅ No pushes
- ✅ No global installs (all tooling ran inside `node:20-bullseye` / `curlimages/curl` containers or against Docker; the Windows host has no new global packages)
- ✅ No Windows configuration changes
- ✅ FICCT Express source **not** modified (only this report added; temp `.env` + temp E2E dir removed at cleanup)
- ✅ No repo moved into a monorepo; no conversion to a monorepo
- ✅ Go repo **not** modified (its public/private dev keys were only **read** to validate the JWT contract)
