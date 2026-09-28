# Ozellar All Right Inspection — architecture & migration package (28 Sep 2026)

Everything discussed for moving the app from **GitHub Pages + Supabase** to **Azure**, with a new code architecture.

## What's inside
| Folder | Contents |
|---|---|
| `docs/` | 14 documents (read in order) |
| `current-app/` | the latest version of today's app (`index.html` APP_VERSION 2026-09-26-0930, `sw.js`, manifest, icons) |
| `current-supabase-sql/` | every SQL script run in Supabase (01–03) + reconstructed base tables (00, for reference only) |
| `starter/` | starter code for the new system (see `starter/README.md` for what is done and tested) |

## Documents
1. `01-current-system.md` — how today's app works, roles, approvals, limitations
2. `02-current-supabase.md` — tables, functions, security rules, auth settings
3. `03-feature-inventory.md` — **every current feature = acceptance checklist for the rebuild**
4. `04-target-architecture.md` — Azure design, components, key decisions
5. `05-code-architecture.md` — stack, repo layout, design rules, porting guide
6. `06-data-model.md` — new tables + field-by-field mapping from today's data
7. `07-api-spec.md` — API endpoints
8. `08-offline-sync.md` — offline & sync design, conflicts
9. `09-security-and-roles.md` — permissions matrix, approval state machine, security
10. `10-azure-deployment.md` — step-by-step Azure setup, CI/CD, mobile apps
11. `11-migration-plan.md` — phases, data migration, cutover, rollback
12. `12-testing-and-go-live.md` — tests, UAT, go-live
13. `13-costs-and-operations.md` — cost drivers (use Azure Pricing Calculator), operations
14. `14-decisions-and-open-questions.md` — decided items + 10 open questions with proposed defaults

## Start here
Read 01 → 04 → 14 (answer the open questions), then hand 05–11 and `starter/` to the developer.
