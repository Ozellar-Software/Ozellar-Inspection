# Ozellar VIR — starter code (new architecture)

React + TypeScript PWA · Azure Functions API · PostgreSQL · Blob Storage · Entra ID. Read `../docs/05-code-architecture.md` first.

| Folder | Status |
|---|---|
| `packages/shared` | ✅ roles & permissions, approval state machine, fleet due status, sync contracts — **13 unit tests passing** |
| `apps/api` | ✅ 20 routes: /me, users, designations, approvers, vessels, fleet-status, approvals (submit/approve/reject/reopen/history/inbox), photos (upload-url/commit/read-urls), sync (push/pull) — **36-check integration test passing against real Postgres 16** |
| `apps/web` | 🟡 skeleton: Microsoft sign-in, local DB (Dexie), outbox sync engine, photo upload queue, update prompt, Home page (sync bar, approval notices, Normal/Light switch, list). Other screens are placeholders — see `apps/web/src/features/README.md` |
| `db/schema.sql` | ✅ tested on PostgreSQL 16, idempotent |
| `db/seed/default-checklist.json` | ✅ 75 sections / 221 questions from the current app |
| `infra/main.bicep` | ✅ compiles with no warnings (Bicep 0.47); **not yet deployed to a real subscription** |
| `.github/workflows` | ✅ CI (typecheck, unit + integration tests, build) and deploy (SWA + Functions via OIDC); not yet run on GitHub |
| `tools/` | ❌ seed + Supabase migration not built — see `tools/README.md` |

## Run locally
```bash
npm install
npm test                                   # shared rules
# API integration test (needs a Postgres 16 with db/schema.sql applied):
cd apps/api && PG_TEST_HOST=localhost PG_TEST_PORT=5432 PG_TEST_DB=virtest PG_TEST_USER=postgres PG_TEST_PASSWORD=postgres npm run test:integration
# Web (fill apps/web/.env.local from .env.example):
npm run dev -w @ozellar/web
# API (needs Azure Functions Core Tools; copy local.settings.example.json → local.settings.json):
npm run build -w @ozellar/api && cd apps/api && func start
```
