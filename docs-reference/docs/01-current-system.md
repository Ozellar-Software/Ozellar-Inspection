# 01 — Current system (as of 26 Sep 2026)

## What it is
**Ozellar All Right Inspection** is a vessel inspection (VIR) app. Inspectors fill a checklist per vessel, take photos, mark defects, write a summary and conclusion, and produce a PDF report. Finished reports go through a two-level approval.

- Live URL: `https://pavan5296-sys.github.io/Ozellar-Inspection-/`
- Source repo: `github.com/pavan5296-sys/Ozellar-Inspection-` (files uploaded manually through the GitHub web UI)
- Latest version in this package: `current-app/index.html`, `APP_VERSION = '2026-09-26-0930'`

## Architecture

```
Browser / installed PWA (iPhone, Android, laptop)
 ├─ index.html   ~8,800 lines: all screens, logic, sync, PDF builder (single file, plain JS, no build step)
 ├─ sw.js        service worker: network-first, falls back to cached app shell when offline
 ├─ manifest.json + icons   installable ("Add to Home Screen")
 └─ IndexedDB  "vir_offline_db_v1" (v6)   local database; the app works fully offline
        │  supabase-js v2 (CDN) — sync when online
        ▼
Supabase project  dgbierhekwndcxrlyhja  (free plan)
 ├─ Auth: email+password, magic link / OTP code
 ├─ Postgres: records, user_roles
 └─ SQL functions: admin_set_password, mark_password_set, is_app_member, list_app_users

Libraries (CDN): @supabase/supabase-js@2 (jsdelivr), jsPDF 2.5.1 (cdnjs)
Optional: EmailJS (browser email API) for approval emails — built, not yet configured
Hosting: GitHub Pages (static)
```

## How data flows
1. Every edit is written to **IndexedDB** first (`idbPut`). The app never waits for the network.
2. The edit is queued (`sbMarkDirty`, 800 ms debounce) and **upserted** to `records` as the signed-in user's own row.
3. On app open / sign-in / "Sync now" / coming back online, the app **pulls the index of all company rows** (paged, 1000 per request), keeps the **newest `updated_at` per (store, key)**, and fetches full data only for rows newer than the local copy.
4. Deletions are tombstones (`deleted = true`) so other devices remove the item too.
5. Photos are compressed on the device (JPEG) and stored **inside the JSON** as base64.

## Local stores (IndexedDB) = cloud `records.store` values
| Store | Key | Holds |
|---|---|---|
| `inspections` | `id` | inspection header, summary, conclusion, cover photo, frozen checklist copy (`sections`), `approval` |
| `responses` | `key` = `inspId__sectionSr__qId` | one answer per checklist question (+ photos) |
| `sectionExtras` | `key` = `inspId__sectionSr` | section-level photos (incl. Photo sections) + extra findings |
| `customSections` | `id` | sections added to one inspection only |
| `vessels` | `id` | fleet list + particulars |
| `appConfig` | `key` | `sections` (master checklist template), `emailjs` (email settings) |
| `deletedInspections`, `deletedVessels` | `id` | local tombstones (not synced as stores) |

Full field lists: see `06-data-model.md` (section "Current → target mapping").

## Roles (current)
| Role | Sees | Can do |
|---|---|---|
| **Admin** | everything | everything: users, vessels, checklist, add/delete sections, set passwords, approve at any level, reopen approved |
| **Director** | everything | view only; final approval / reject |
| **Tech Manager** | assigned fleet | create/fill inspections for own vessels; Level-1 approve / reject; submit own reports to a Director |
| **Vessel Manager** | assigned vessels | create/fill inspections for own vessels; submit to a Tech Manager |

`pavan.trivedi96@gmail.com` is hard-coded as a bootstrap Admin.

**Important:** roles and edit locks are enforced **in the app**, not in the database. Any signed-in member can read all company records through the API.

## Approval workflow (current)
```
Vessel Manager submits → picks Tech Manager (one who has that vessel)
   → Tech Manager: Approve (picks Director) | Reject (back to Vessel Manager)
   → Director: Final approval | Reject (back to submitter)
Tech Manager / Admin submits → picks Director → Director: Final approval | Reject
```
- While waiting: locked for everyone (UI + save layer). Approved: view-only; Admin can reopen.
- Stored on the inspection as `approval = {stage: tm|director|approved|returned, submittedBy, tmEmail, directorEmail, history[]}`.
- `status`: `in_progress` → `pending_approval` → `completed` (approved).

## Known limitations (why re-architect)
1. **Single 8,800-line file**: hard to change safely, no automated tests, no build pipeline.
2. **Security is client-side**: roles and approval locks can be bypassed by anyone calling the Supabase API directly.
3. **Photos stored as base64 in the database**: ~33% larger than the image, counts against Supabase's 500 MB free database; slows sync.
4. **Email**: Supabase built-in email only reaches project team members (~2/hour); password emails don't reach users without custom SMTP. The company uses **Microsoft 365** (MX: `ozellar-com.mail.protection.outlook.com`).
5. **Last-write-wins per whole record**: two people editing the same record offline → one edit lost.
6. **iPhone Home-Screen app**: no background sync; limited storage; separate storage from Safari (email links sign in Safari, not the app).
7. **Manual deploys** through the GitHub upload page.
