# Hash Ledger

The `hash_ledger` table makes document tampering provable. This document explains the construction, the threat model, and the verification algorithm.

## Schema

```sql
CREATE TABLE hash_ledger (
    id              BIGSERIAL PRIMARY KEY,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_id      UUID REFERENCES document_versions(id) ON DELETE CASCADE,
    sha256          TEXT NOT NULL,
    prev_chain_hash TEXT,
    chain_hash      TEXT NOT NULL,
    recorded_by     UUID NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One ledger row is written every time a document hash is observed. Today that happens on `confirmUpload`. Future version replacement would append another row per version.

## Chain construction

The implementation is in [src/modules/ledger/ledger.service.ts](../../src/modules/ledger/ledger.service.ts):

```javascript
chain_hash = SHA-256( (prev_chain_hash ?? '') || '|' || sha256 )
```

So the first row for a document has `prev_chain_hash = NULL` and `chain_hash = SHA-256('|' + sha256)`. Each subsequent row chains to the previous row's `chain_hash`.

## Threat model

This is a **tamper-evidence** scheme, not a tamper-prevention scheme.

| Threat | Detected? |
|--------|-----------|
| Someone modifies the bytes in S3 without re-confirming through this service. | Yes — `verify` recomputes the SHA-256 of stored bytes and compares to `documents.sha256`. |
| Someone modifies a past row's `sha256` in `hash_ledger`. | Yes — that row's `chain_hash` no longer matches `SHA-256(prev || '\|' || sha256)`, and every later row's `prev_chain_hash` also breaks. |
| Someone modifies `chain_hash` directly. | Yes — recomputation in `verifyChain` will disagree at that row. |
| Someone deletes the most recent row. | Detectable only if the consumer has previously seen a later `chain_hash`. The chain by itself cannot prove "no row was removed from the tail." |
| Someone with write access drops the table or rewrites every row. | **Not detected.** This scheme cannot protect against a fully compromised DB admin. For that, pin `chain_hash` values to an out-of-band store (write-once log, hardware security module, public chain). |

The ledger is **immutable by convention, not by enforcement**. Postgres does not prevent UPDATE/DELETE on this table; production deployments should use a per-table grant that allows only INSERT and SELECT to the application role.

## Verification flow

`documentService.verify(documentId)` does two independent checks:

```text
1. Stream the current object from S3.
   - hash = SHA-256(stream)
   - intact = (hash == documents.sha256)

2. Walk ledger entries in id ASC order:
   - prevChain = null
   - for each entry e:
       expected = SHA-256(prevChain ?? '' || '|' || e.sha256)
       if expected != e.chain_hash:  break, mark brokenAt=index
       if e.prev_chain_hash != prevChain: break, mark brokenAt=index
       prevChain = e.chain_hash
   - chainIntact = (no break occurred)
```

Result: `{ intact, chainIntact, storedSha, currentSha, brokenAt }`.

## What to do when verification fails

There is no automated remediation. The expected workflow:

1. Compare `currentSha` to `storedSha`. If they differ, the bytes were replaced — the document **cannot be trusted** to represent what was originally confirmed. Quarantine it (set `status='deleted'`).
2. If `chainIntact=false`, walk the audit log (`GET /api/v1/audit?documentId=...&action=verify`) to find when the last successful `verify` ran. Everything after that point is suspect.
3. Open an incident; rotate database credentials; investigate who had write access to `hash_ledger`.

## Why `|` as a separator?

To prevent a "concatenation attack" where `sha256` values that happen to share a prefix could be re-grouped. `prev || sha256` could in principle collide with `prev' || sha256'` if the boundary is movable. The `|` byte is not in hex output, so `prev || '|' || sha256` is unambiguously decodable into the two components by simple split.
