# 07 — API specification (Azure Functions)

Base URL: `https://inspection.ozellar.com/api` (web, via Static Web Apps linked backend) or `https://<func-app>.azurewebsites.net/api` (native apps).
Auth: every call needs `Authorization: Bearer <Entra access token>` for scope `api://<api-client-id>/access_as_user`. The API resolves the caller to a `users` row by Entra object id (first sign-in: by email) and loads role + assigned vessels.
Errors: `{ "error": { "code": "FORBIDDEN|LOCKED|VALIDATION|NOT_FOUND|CONFLICT", "message": "…" } }`.

## Me & users
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/me` | any | current user: id, name, email, designation, role, assignedVesselIds |
| GET | `/users` | Admin | list users |
| POST | `/users` | Admin | create/assign `{email, name, designation, role, vesselIds[]}` (+ optional Entra guest invite) |
| PATCH | `/users/{id}` | Admin | edit role/name/designation/vessels/active |
| GET | `/designations` | Admin | preset list + designations in use |
| GET | `/approvers?inspectionId=…&level=tm\|director` | submitter/approver | Tech Managers who have that vessel, or Directors |

## Vessels
| GET | `/vessels` | any (filtered by role) | list |
| POST / PATCH / DELETE | `/vessels[/{id}]` | Admin | manage (soft delete) |
| GET | `/fleet-status` | any (filtered) | per vessel: last approved inspection, next due, colour (6-month cycle) |

## Checklist template
| GET | `/checklist-template` | any | master sections + questions |
| PUT | `/checklist-template` | Admin | save edits (add/rename/delete/reorder); ids permanent |
| POST | `/checklist-template/photo-sections` | Admin | add a Photo section to template **and** to all not-approved inspections |

## Inspections (normally via sync; direct endpoints for admin tools)
| POST | `/inspections` | Admin, TM, VM (own vessels) | create with frozen checklist copy |
| PATCH | `/inspections/{id}` | editors, only when editable | header/summary/conclusion |
| DELETE | `/inspections/{id}` | Admin, TM, VM (own; not when submitted/approved) | soft delete |
| POST | `/inspections/{id}/sections` | Admin | add custom section (`photoOnly`, `addToAllVessels`) |
| GET | `/inspections/{id}/export.csv` | viewers | CSV (excludes Photo sections) |
| GET | `/inspections/{id}/backup.json` / POST `/import` | Admin/TM/VM | JSON backup |

## Sync (main path for the apps) — see `08-offline-sync.md`
| POST | `/sync/push` | any | `{ deviceId, mutations: [{id, entity, op: upsert\|delete, data, baseVersion}] }` → per-mutation `ok` / `rejected {code, serverRow}` |
| GET | `/sync/pull?cursor=<row_version>&limit=500` | any | changed rows the caller may see, grouped by entity, + `nextCursor`, `hasMore` |

## Photos
| POST | `/photos/upload-url` | editors | `{photoId, inspectionId, target, …}` → `{uploadUrl (SAS, 15 min, create/write only), blobPath}` |
| POST | `/photos/{id}/commit` | editors | marks `uploaded = true` after the PUT to Blob |
| POST | `/photos/read-urls` | viewers | `{photoIds[]}` → short-lived read SAS URLs |
| PATCH | `/photos/{id}` | editors | `is_defect`, `position`, move to another owner |
| DELETE | `/photos/{id}` | editors | soft delete (blob removed by a cleanup job) |

## Approvals
| POST | `/inspections/{id}/submit` | VM → `{approverId (TM), comment}`; TM/Admin → `{approverId (Director), comment}` | requires summary + conclusion |
| POST | `/inspections/{id}/approve` | assigned TM `{directorId, comment}`; assigned Director or Admin `{comment}` | |
| POST | `/inspections/{id}/reject` | assigned approver or Admin `{comment}` (required) | back to submitter, unlocked |
| POST | `/inspections/{id}/reopen` | Admin | approved → returned |
| GET | `/approvals/inbox` | any | waiting for me / returned to me (home notices) |
| GET | `/inspections/{id}/approval` | viewers | stage + history |

Each approval call: validates with `packages/shared/approval.ts`, writes `approvals` + `approval_events` in **one transaction**, then sends the email (Graph) — email failure never rolls back the approval.

## Reports (optional phase)
| POST | `/inspections/{id}/report.pdf` | viewers | server-generated PDF (large reports); the app keeps on-device PDF for offline |
