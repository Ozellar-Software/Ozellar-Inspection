# 06 — Data model

Target DDL: **`starter/db/schema.sql`** (tested on PostgreSQL 16; idempotent).
Seed checklist: **`starter/db/seed/default-checklist.json`** (75 sections, 221 questions, 3 zones).

## Entity overview
```
users ──< user_vessels >── vessels ──< inspections ──┬──< inspection_sections ──< inspection_questions
                                   │                 │            │                         │
                                   └── photos        │            ├──< findings             └── responses (1:1 per question)
                                                     │            └── photos (section)            └── photos (question)
                                                     ├── photos (cover)
                                                     ├── approvals (1:1)
                                                     └──< approval_events
template_sections ──< template_questions      app_settings      audit_log
```

## Tables (purpose)
| Table | Purpose |
|---|---|
| `users` | one row per person: Entra object id, email, name, **designation**, role, active flag |
| `user_vessels` | assigned fleet for Tech/Vessel Managers (replaces `user_roles.fleet` names with real ids) |
| `vessels` | fleet list; the 23 extra particulars live in `particulars` jsonb |
| `template_sections`, `template_questions` | master checklist; `sr`/`qid` are permanent ids; `photo_only` marks Photo sections |
| `inspections` | header, dates by type, summary, conclusion, `status` |
| `inspection_sections` | the inspection's frozen checklist copy **and** its custom sections (`is_custom`) |
| `inspection_questions` | frozen questions for that inspection |
| `responses` | answer per question |
| `findings` | extra observations in a section |
| `photos` | every photo: owner (section/question/finding/cover/vessel), blob path, defect flag, order |
| `approvals` | current approval state per inspection |
| `approval_events` | full history (with name/designation/role snapshots) |
| `app_settings` | misc settings (e.g., email mailbox, fleet cycle months) |
| `audit_log` | who changed what |

Every synced table has `updated_at` and `row_version` (from `sync_seq`, bumped by trigger on every update) plus `deleted_at` where rows can be deleted — see `08-offline-sync.md`.

## Status values
`inspections.status`: `in_progress` → `pending_tm` → `pending_director` → `approved`; or → `returned` (after a rejection, editable again).
`approvals.stage`: `tm` | `director` | `approved` | `returned`.

## Current → target mapping (used by the migration tool)

### `inspections` store → `inspections` (+ sections, questions, approvals)
| Current field | Target |
|---|---|
| `id` (short string e.g. `lz3k9a…`) | new uuid; keep old id in `audit_log`/mapping table during migration |
| `vesselName`, `imo`, `vesselType` | `vessel_name`, `imo`, `vessel_type`; `vessel_id` = vessel matched by name (case-insensitive) |
| `inspectionType` (`port`/`remote`/`sailing`) | `inspection_type` |
| `port`, `date`, `completionDate` | `port`, `start_date`, `completion_date` |
| `sailFromDate`, `sailFromPort`, `sailToDate`, `sailToPort` | same, snake_case |
| `remoteFromDate`, `remoteToDate` | same |
| `inspector`, `company`, `summary`, `conclusion` | same |
| `vesselPhoto {id, blob}` | `photos` row (`target='cover'`) + blob; `cover_photo_id` |
| `status` (`in_progress`/`pending_approval`/`completed`) + `approval.stage` | `status`: see rule below |
| `sections[]` `{sr, zone, name, q:[[ref,text,qId]], photoOnly}` | `inspection_sections` (`template_sr = sr`) + `inspection_questions` |
| `approval {stage, submittedBy{email,name,designation,role}, tmEmail, directorEmail, history[]}` | `approvals` + `approval_events` (users resolved by email) |
| `createdAt`, `updatedAt` (ms) | `created_at`, `updated_at` |

Status rule: `approval.stage` tm → `pending_tm`; director → `pending_director`; approved → `approved`; returned → `returned`; no approval & `status='completed'` → **decision needed** (`approved` or `in_progress`, see `14-…`); otherwise `in_progress`.

### `responses` store → `responses` (+ photos)
Key `inspId__sectionSr__qId`. Fields: `applicable` (true/false/null), `answer` (`yes`/`no`/null), `remarks`, `correctiveAction`, `preventiveAction`, `photos[] {id, blob, defect}` → `photos` (`target='question'`).

### `sectionExtras` store → `photos` + `findings`
Key `inspId__sectionSr` (sectionSr is a number for template sections or `cs_…` for custom sections).
- `photos[] {id, blob, defect}` → `photos` (`target='section'`), order kept in `position`.
- `customFindings[] {id, text, answer, correctiveAction, preventiveAction, photos[]}` → `findings` + `photos` (`target='finding'`).

### `customSections` store → `inspection_sections` (`is_custom = true`)
`{id, inspectionId, name, photoOnly, createdAt}`.

### `vessels` store → `vessels`
`{id, name, imo, vesselType, vesselPhoto?, createdAt, updatedAt}` + 23 particulars → `particulars` jsonb:
`flag, portOfRegistry, callSign, officialNo, yearBuilt, placeOfBuild, classSociety, classNotation, grossTonnage, netTonnage, deadweight, loa, breadth, depth, summerDraft, mainEngine, mainEngineMakerModel, mainEnginePower, propulsion, owner, managerOperator, email, satellitePhone`.

### `appConfig` store
- key `sections` `{sections[], nextSr}` → `template_sections` / `template_questions` (Photo sections: `photo_only = true`).
- key `emailjs` → not migrated (replaced by Microsoft Graph).

### `user_roles` table → `users` + `user_vessels`
`email, role, name, designation` → `users`; `fleet[]` (vessel names) → `user_vessels` by name match. `password_set` dropped.

### Photos (blobs)
Current: `{"__sbBlob": true, "b64": "...", "type": "image/jpeg"}` inside JSON → decode base64 → upload to `photos/<inspectionId>/<photoId>.jpg` (vessel photos: `photos/vessels/<vesselId>/<photoId>.jpg`) → `photos.blob_path`, `uploaded = true`.
