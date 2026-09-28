# 11 — Migration plan

## Phases
| Phase | Scope | Outcome | Users affected |
|---|---|---|---|
| **0. Quick win (optional, ~1 day)** | Host current `index.html` on Azure Static Web Apps at `inspection.ozellar.com`; Supabase unchanged | company domain, Azure hosting | new URL only |
| **1. Foundations** | repo + CI/CD, Bicep infra (dev), Entra app registrations, DB schema, `/me`, users & vessels screens, seed checklist | sign in with Microsoft; admin can set up users & vessels | pilot group |
| **2. Inspections offline** | Dexie + outbox sync, create/fill inspections, question cards, section photos, findings, custom sections, Photo sections, Light mode, photo queue → Blob, fleet status | inspectors can work end-to-end offline | pilot |
| **3. Reports & approvals** | report screen, on-device PDF (port), CSV/JSON, approval workflow + locks on server, Graph email, notices | feature parity | pilot |
| **4. Mobile apps** | Capacitor iOS/Android, native sign-in, background photo upload, TestFlight / internal testing | store apps | pilot |
| **5. Data migration & cutover** | migrate Supabase data + photos, UAT, switch everyone, freeze Supabase | old system retired | all |

## Data migration (tool: `starter/tools/migrate-from-supabase/`)
1. **Freeze**: announce a window; set the old app to read-only (or ask users to sync and stop).
2. **Export** from Supabase with the service-role key (run on a secure machine, never in the app):
   - all `records` rows (paged), `user_roles`.
3. **Resolve latest copy**: for each (store, key) keep the row with the newest `updated_at` (same rule the app uses); drop tombstones.
4. **Transform** (see mapping in `06-data-model.md`):
   - users (+ assigned vessels by name), vessels (+ particulars), template (appConfig `sections`),
   - inspections → inspections + inspection_sections + inspection_questions,
   - responses → responses; sectionExtras → section photos + findings; customSections → custom inspection_sections,
   - approval → approvals + approval_events.
5. **Photos**: decode each `{__sbBlob, b64, type}` → upload to Blob `photos/<inspectionId>/<photoId>.jpg` → `photos` rows (`uploaded = true`, `is_defect` kept, order kept).
6. **Load** into Postgres in one transaction per inspection; idempotent (re-runnable: uses deterministic uuids derived from old ids).
7. **Reconcile**: counts per vessel — inspections, answered questions, photos, defect photos, approvals — old vs new; spot-check 5 PDFs side by side.
8. **Cutover**: publish new app URL, add a banner to the old app pointing to it, keep Supabase read-only for 90 days, then export an archive and delete.

## Rollback
Until cutover, the old app keeps working (Supabase untouched). If a blocker appears after cutover, re-open Supabase for writes and point users back; new-system data entered meanwhile can be re-exported with the JSON backup feature.

## Effort guide (one experienced full-stack developer)
| Phase | Rough effort |
|---|---|
| 0 | 1 day |
| 1 | 1–2 weeks |
| 2 | 3–4 weeks |
| 3 | 2–3 weeks |
| 4 | 1–2 weeks |
| 5 | 1 week |
Total ≈ 2–3 months calendar for one developer; faster with two (web + API in parallel). Treat as a planning estimate, not a quote.
