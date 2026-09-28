# 12 — Testing & go-live

## Automated
| Level | Tool | What |
|---|---|---|
| Unit (shared rules) | Vitest | permissions matrix, approval state machine (every allowed/denied transition), edit locks, fleet due status — starter tests in `packages/shared/test/` |
| Unit (API) | Vitest | services with a test Postgres (Docker) — create/submit/approve/reject/reopen, sync push/pull cursors, rejected mutations |
| Unit (web) | Vitest + Testing Library | outbox, sync merge, photo queue retry |
| End-to-end | Playwright | 3 browser contexts: Vessel Manager submits → Tech Manager approves → Director approves; rejection path; Director view-only; lock after submit; offline edit then sync; Light mode shows only Photo sections |
| Report | Playwright | generated PDF contains no section numbers, no Photo sections, no approval record, defect photos framed |

## Manual UAT (on real devices)
- iPhone (Safari + installed app + TestFlight), Android (Chrome + Play internal test), Windows laptop (Edge/Chrome).
- **Airplane-mode test**: fill a full section with 20 photos offline, close the app, reopen, go online → everything arrives; approvals disabled offline.
- **Weak-signal test**: throttle to 3G, upload 50 photos; kill the app midway; confirm resume.
- Every row of `03-feature-inventory.md`.

## Performance targets
- App start (cached): < 2 s. Section open: < 300 ms. Sync of 1 inspection (no photos): < 3 s. Photo upload (1.5 MB) on 4G: < 5 s.

## Go-live
1. Pilot with 1 Tech Manager + 2 Vessel Managers for 2 weeks on dev/prod.
2. Fix, then migrate all data (see `11-…`), train users (15-min video: sign in with Microsoft, offline use, approvals).
3. Monitor Application Insights daily for the first 2 weeks.
