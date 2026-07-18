# OpenCode Session Checkpoint — DoneBond 4.6 Evidence API

## State at checkpoint

- **Branch:** `main`
- **Last commit:** `a52d74d` — `docs: update task.md work log with commit hash`
- **Git identity:** Vedant817 <vedantmahajan271@gmail.com> (verified OK)
- **Remote:** `git@github-personal:Vedant817/donebond.git`
- **Working dir:** `/Users/salescode/Documents/Code/DoneBond`
- **Push blocked:** SSH `Permission denied (publickey)` — repo cannot be pushed to GitHub

## Prior verification (all gates pass from last commit)

```
pnpm typecheck    → 6/6 successful
pnpm lint         → 0 errors, boundaries OK
pnpm format:check → all clean
pnpm test         → 11/11 suites (shared 16, evidence 36, db 66/67, cli 22, web 69)
```

## In-progress work (UNCOMMITTED)

### Files modified (not staged):
- `packages/db/src/repository.ts` — Added `listEvidence()` + `getEvidence()` methods (109 additions)

### Files created (untracked):
- `apps/web/src/server/evidence-handlers.ts` — New handler module (submit/list/get evidence, CLI token auth)
- `apps/web/src/server/evidence-runtime.ts` — New runtime wiring module (initializes CliTokenAuthenticator + DoneBondRepository, creates evidence handlers)

### What these files do:
1. **DB `listEvidence`/`getEvidence`**: Keyset-cursor pagination for evidence bundles joined with tasks/projects. Detail fetch includes verification checks. Added `import { and, desc, eq, lt, or }` to repository.
2. **Evidence handlers**: `createEvidenceHandlers({ applicationOrigin, resourceSecret, authenticator, store })` — three handler functions: `submit` (CLI bearer auth + idempotency key, parses EvidenceBundle via Zod schema, derives opaque public ID, persists to DB), `listEvidence` (CLI auth, cursor pagination), `getEvidence` (public ID lookup).
3. **Evidence runtime**: `dispatchEvidence(action, request, ...params)` — lazy-initializes services from `getCliTokenServices()`, creates `CliTokenAuthenticator`, wires `DoneBondRepository` to `EvidenceStore` adapter, DB error translation (DB_IDEMPOTENCY_CONFLICT → EVIDENCE_UPLOAD_CONFLICT (409), DB_NOT_FOUND → EVIDENCE_NOT_FOUND (404)).

### Issues in in-progress code:
- **Handlers use `ERROR_CODES.EVIDENCE_UPLOAD_CONFLICT`** but this code does NOT exist in `packages/shared/src/errors.ts` yet — needs adding
- **Handlers call `PersistEvidence` on repository** but the in-progress store adapter is incomplete: creates an ad-hoc bundle object but needs to properly interface with `DoneBondRepository.persistEvidence` which requires `EvidenceInsert` (full DB row shape), `VerificationCheckInsert[]`, `IdempotencyContext`, `AuditEventInsert`
- **No route files created yet** — need `POST /api/v1/projects/[projectId]/evidence`, `GET /api/v1/tasks/[taskId]/evidence`, `GET /api/v1/evidence/[evidenceId]`
- **No tests yet**

### Remaining partial file reads used:
- `packages/db/src/repository.ts` — `persistEvidence` method uses `EvidencePersistenceInput` with full DB row shape (id, taskId/projectId/policyId UUIDs needed, not just public IDs)
- The current evidence-runtime.ts store adapter creates fake bundle objects that won't work with `persistEvidence`

## Needed completion for 4.6 Evidence API

### Must fix/add:

1. **`packages/shared/src/errors.ts`** — Add `EVIDENCE_NOT_FOUND: "EVIDENCE_NOT_FOUND"` and `EVIDENCE_UPLOAD_CONFLICT: "EVIDENCE_UPLOAD_CONFLICT"`

2. **Rewrite `evidence-runtime.ts` store adapter**: The `persistEvidence()` store method needs to properly construct `EvidencePersistenceInput`:
   - Fetch task UUID from `taskPublicId` to get `taskId`
   - Fetch project UUID from `projectPublicId` to get `projectId` and `policyId` from task's linked policy
   - Build `EvidenceInsert` with all fields: `schemaVersion, objectLocation, evidenceHash, commitHashDerived, gitObjectId, passing, bundleSizeBytes, publicId, submittedByTokenId, idempotencyKey, requestHash` — but also needs `taskId, projectId, policyId` UUIDs
   - Build `VerificationCheckInsert[]` from check results
   - Build `AuditEventInsert` with project UUID and task UUID

   Alternatively, create a simpler evidence persistence method on `DoneBondRepository` that accepts public IDs (the repo already has `persistEvidence` but it requires internal UUIDs — a wrapper or new method is needed).

3. **Route files**:
   - `apps/web/src/app/api/v1/projects/[projectId]/evidence/route.ts` — `POST → dispatchEvidence("submit", request, projectPublicId)`
   - `apps/web/src/app/api/v1/tasks/[taskId]/evidence/route.ts` — `GET → dispatchEvidence("listEvidence", request, projectPublicId, taskPublicId)` 
   - `apps/web/src/app/api/v1/evidence/[evidenceId]/route.ts` — `GET → dispatchEvidence("getEvidence", request, evidencePublicId)`

4. **Write tests**: Follow pattern from `project-policy-handlers.test.ts` — use `node:test` + `node:assert/strict`, mock store/authenticator, test negative cases.

5. **Run verification gate**: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`

6. **Commit**: `feat(api): add evidence upload and listing`

## Post-4.6 remaining milestones (handoff to next agent)

### 4.7 Public receipt API (not started)
- Return allowed-fields receipt view
- GET /api/v1/tasks/[taskId]/receipt for public (member) and GET /api/v1/receipt/[receiptId]/public (no-auth)
- Chain metadata/explorer metadata
- Safe bundle download (for public receipts only)

### 4.8 Event indexing and reconciliation (partial)
- Existing: `contractEvents` table, `appendContractEvent`, inline reconciliation event storage
- Need: background indexer/event polling, admin debug visibility, pending reconciliation batch endpoint

### 5.6 donebond submit (CLI, not started)
- Upload evidence bundle with idempotency key
- Compare server commitments
- Print public receipt link
- Must NOT sign with raw private key

### 5.7 donebond receipt verify (CLI, not started)
- Download public bundle
- Recompute evidence commitment
- Read contract state via RPC
- Compare all commitments and print independently verified status

### 5.8 CLI distribution (not started)
- Build portable package, test install from packed tarball

### Milestone 6 — Web product (NOT STARTED — 7 sub-milestones, 0 implemented)
- 6.1: Design system — typography, spacing, UI primitives
- 6.2: Landing and onboarding — product pitch, install command, sample receipt
- 6.3: Project screens — project list/create/detail, policy status, CLI tokens
- 6.4: Task creation — acceptance criteria editor, assignee/deadline, optional MON reward, wallet states
- 6.5: Task detail and receipt — git commit, check results, hashes, transaction state, approve/reject controls
- 6.6: Public proof page — no-login route, integrity status, bundle download
- 6.7: Error states — first project/task, no receipt, failed evidence, RPC unavailable, wallet rejection

### Milestone 7 — E2E integration (NOT STARTED)
### Milestone 8 — Production hardening (NOT STARTED)
### Milestone 10 — Documentation & demo (NOT STARTED)

## Key existing files for context

| File | Role |
|------|------|
| `apps/web/src/server/task-handlers.ts` | ~809 lines, full pattern for create/read/write handlers |
| `apps/web/src/server/task-runtime.ts` | ~345 lines, runtime wiring with DB error translation |
| `apps/web/src/server/project-policy-handlers.ts` | ~554 lines, project CRUD + policy handler pattern |
| `apps/web/src/server/auth-runtime.ts` | ~377 lines, `getCliTokenServices()`, `getProjectPolicyServices()` |
| `apps/web/src/server/cli-token.ts` | ~223 lines, `CliTokenAuthenticator` with digest validation |
| `apps/web/src/server/http.ts` | ~160 lines, `HttpError`, `jsonResponse`, `errorResponse`, `readBoundedJson` |
| `packages/db/src/repository.ts` | ~910 lines, `persistEvidence`, `listEvidence`, `getEvidence`, `appendContractEvent` |
| `packages/db/src/task-chain-repository.ts` | ~2260 lines, DrizzleTaskRepository pattern |
| `packages/shared/src/domain.ts` | ~481 lines, all Zod schemas including `EvidenceBundleSchema`, `ReceiptSchema`, `ChainTransactionSchema` |
| `packages/shared/src/errors.ts` | ~60 lines, ERROR_CODES (needs EVIDENCE_NOT_FOUND + EVIDENCE_UPLOAD_CONFLICT added) |
| `apps/cli/src/verify-command.ts` | ~330 lines, CLI evidence generation pattern |
| `packages/ui/src/index.ts` | Empty stub — all UI components need building from scratch |
| `apps/web/src/app/page.tsx` | Simple static landing — needs complete redesign |
| `task.md` | Full tracker at `/Users/salescode/Documents/Code/DoneBond/task.md` |

## Infrastructure notes
- Monorepo: pnpm + Turborepo, `pnpm typecheck` runs all packages
- Tests: Node.js built-in `node:test` and `node:assert/strict`, `.ts` extension with `--experimental-strip-types`
- DB tests use `.mjs` with `createFakeDatabase()` mock patterns
- Routes: Next.js App Router, `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
- Rate limiting: dual-tier (global + subject) PostgreSQL atomic window counters
- Idempotency: `Idempotency-Key` header + API idempotency key table + response snapshots
- CSRF: For browser mutations; CLI auth uses bearer tokens only
- No external test frameworks (no Vitest/Jest)