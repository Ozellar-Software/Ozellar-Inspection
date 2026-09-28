# 05 — Code architecture

## Stack
| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Web app | React 18 + Vite, React Router, **Fluent UI React v9**, React Hook Form + zod |
| Installable/offline | `vite-plugin-pwa` (Workbox service worker, "new version" prompt) |
| Native apps | Capacitor 6 (iOS, Android) wrapping the web build |
| Local DB | Dexie.js (IndexedDB) |
| Server state | TanStack Query |
| Auth (client) | `@azure/msal-browser` + `@azure/msal-react` |
| PDF (client) | jsPDF (port of the current proven builder) |
| API | Azure Functions v4 programming model (`@azure/functions`), Node 20 |
| DB access | `pg` + Drizzle ORM (or Prisma) with SQL migrations |
| Blob | `@azure/storage-blob` (user-delegation SAS via managed identity) |
| Identity (server) | `@azure/identity` (managed identity → Postgres, Blob, Graph); `jose` for JWT validation |
| Email | Microsoft Graph REST `POST /users/{mailbox}/sendMail` |
| Tests | Vitest (unit), Playwright (end-to-end, incl. the 3-user approval flow) |
| Lint/format | ESLint + Prettier |
| Monorepo | npm workspaces |

## Repository layout
```
ozellar-inspection/
├─ apps/
│  ├─ web/                        React PWA (+ Capacitor projects under ios/, android/)
│  │  └─ src/
│  │     ├─ app/                  routing, layout, providers (MSAL, Query, Fluent theme)
│  │     ├─ auth/                 MSAL config, useCurrentUser(), role guards
│  │     ├─ offline/              Dexie schema, outbox, sync engine, photo upload queue
│  │     ├─ api/                  typed API client (fetch + bearer token)
│  │     ├─ features/
│  │     │  ├─ home/              list, search, status chips, approval notices, Normal/Light switch
│  │     │  ├─ vessels/           list, form (particulars), history, fleet status
│  │     │  ├─ inspections/       create/edit, section list, section detail, question card
│  │     │  ├─ photos/            capture, compress, select/move/drag, defect marking
│  │     │  ├─ checklist/         template editor (Admin)
│  │     │  ├─ approvals/         submit / approve / reject sheets, history
│  │     │  ├─ report/            report screen, PDF builder, CSV, JSON backup
│  │     │  └─ users/             Manage users (Admin), designation pick-list
│  │     └─ components/           shared UI
│  └─ api/                        Azure Functions
│     └─ src/
│        ├─ functions/            one file per HTTP route group
│        ├─ lib/                  auth (JWT → user), db, blob, graph, errors, logging
│        ├─ services/             business services using packages/shared rules
│        └─ db/                   Drizzle schema + migrations (mirrors db/schema.sql)
├─ packages/
│  └─ shared/                     ★ used by BOTH web and api
│     └─ src/ types.ts · roles.ts (permissions) · approval.ts (state machine) · due.ts · validation (zod)
├─ db/        schema.sql · seed/default-checklist.json
├─ infra/     main.bicep · parameters
├─ tools/     migrate-from-supabase/
└─ .github/workflows/  ci.yml · deploy.yml
```

## Core design rules
1. **One source of truth for rules.** Permissions (`can(user, action, resource)`), the approval state machine and edit locks live in `packages/shared`. The web app uses them to show/hide buttons; the API uses the *same functions* to allow/deny. Never duplicate a rule.
2. **Local-first UI.** Screens read from Dexie, never directly from the network. Writes go to Dexie + outbox; the sync engine talks to the API. This is what keeps the app usable at sea.
3. **Server is authoritative** for: approvals, locks, roles, deletes, ID of the current user. A client mutation that breaks a rule is rejected and the client rolls back its local copy.
4. **IDs are UUIDs generated on the device** so items created offline never clash.
5. **Every table has `updated_at` + `row_version`** (global sequence) — the pull cursor for sync.
6. **Photos never pass through the API**: API issues a SAS URL; the phone uploads straight to Blob; then tells the API "committed".
7. **Feature folders**: each feature owns its screens, hooks and API calls; shared UI goes in `components/`.
8. **No secrets in the front end.** Only public config (tenant ID, client ID, API URL).

## Porting guide (current file → new modules)
| Current `index.html` area | New home |
|---|---|
| `DEFAULT_SECTIONS`, template functions | `db/seed/default-checklist.json`, `features/checklist` |
| IndexedDB layer (`idbPut`, `idbGet`…) | `offline/db.ts` (Dexie) |
| Supabase sync (`sbPullAll`, `sbPushDirty`, `sbFetchCloudIndex`) | `offline/sync.ts` + `api/functions/sync.ts` |
| Role functions (`isAdminRole`, `vesselAllowedForRole`, `guardVesselAccess`) | `packages/shared/roles.ts` |
| Approval module (`submitForApproval`, `approveInspection`, `returnInspection`, `canActOnApproval`) | `packages/shared/approval.ts` + `api/functions/approvals.ts` + `features/approvals` |
| Edit lock (`inspectionEditBlocked`, `guardedWrite`) | `packages/shared/approval.ts#isEditable` enforced in API |
| Photo code (compress, select/move/drag, defect) | `features/photos` + `offline/photoQueue.ts` |
| PDF builder (`buildInspectionPDF`), printable, CSV, JSON | `features/report` |
| Fleet status (`inspectionDueInfo`) | `packages/shared/due.ts` |
| Light mode (`appLightMode`) | `features/home` (localStorage per device) |
| Update check (`APP_VERSION`) | `vite-plugin-pwa` `registerSW({ onNeedRefresh })` |

## Conventions
- API JSON is camelCase; DB is snake_case (mapped in the service layer).
- Dates: ISO strings (`YYYY-MM-DD` for dates, full ISO timestamps for times); store `timestamptz` in DB.
- Errors: API returns `{ error: { code, message } }` with proper HTTP status (400 validation, 401, 403 permission, 409 conflict/locked, 404).
- Logging: every API call logs user id, route, duration (App Insights).
