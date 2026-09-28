# 09 — Security, roles & approval rules

Implemented once in `starter/packages/shared/src/` (`roles.ts`, `approval.ts`) and used by both the app (show/hide) and the API (**enforce**).

## Permissions matrix
| Action | Admin | Director | Tech Manager | Vessel Manager |
|---|---|---|---|---|
| See vessels / inspections | all | all | assigned fleet | assigned vessels |
| Manage users | ✅ | – | – | – |
| Manage vessels | ✅ | view | – | – |
| Manage checklist template | ✅ | – | – | – |
| Create inspection | ✅ | – | own vessels | own vessels |
| Edit inspection (when editable) | ✅ | – | own vessels | own vessels |
| Delete inspection (when editable) | ✅ | – | own vessels | own vessels |
| Add / delete custom section | ✅ | – | – | – |
| Submit for approval | ✅ → Director | – | → Director | → Tech Manager (with that vessel) |
| Level-1 approve / reject | ✅ | – | if assigned | – |
| Final approve / reject | ✅ | if assigned | – | – |
| Reopen approved | ✅ | – | – | – |
| Export PDF/CSV/JSON | ✅ | ✅ | own | own |
| Import JSON backup | ✅ | – | ✅ | ✅ |
| Normal / Light mode | ✅ | ✅ | ✅ | ✅ |

## Approval state machine
```
in_progress ──submit(VM→TM)──► pending_tm ──approve(TM, pick Director)──► pending_director ──approve(Director)──► approved
     ▲   └──submit(TM/Admin→Director)─────────────────────────────────────►      │                                  │
     │                           │ reject(TM)                                     │ reject(Director)                 │ reopen(Admin)
     └──────── returned ◄────────┴────────────────────────────────────────────────┘◄─────────────────────────────────┘
returned ──resubmit──► (same as submit)
```
- Editable only in `in_progress` and `returned`. Directors: never.
- Reject requires a comment.
- Admin may perform any approval step.
- The chosen Tech Manager must have the inspection's vessel assigned.

## Authentication
- Microsoft Entra ID (single tenant `ozellar.com`), MSAL with PKCE; MFA per company policy.
- Two app registrations: **VIR Web** (SPA, redirect URIs for web + native) and **VIR API** (exposes scope `access_as_user`).
- External users (ship crew, external superintendents) → **Entra B2B guests**.
- App role comes from the `users` table (managed in the app by Admins). Optional: mirror roles as Entra app roles/groups.

## Authorisation in the API
Every request: validate JWT (issuer, audience, signature via JWKS) → load user → check `can(...)` + `isEditable(...)` → proceed. Deny by default.

## Data protection
- Postgres: Entra authentication; the Function App's **managed identity** is the DB login (no passwords). Public access restricted to Azure services, or private endpoint + VNet (recommended for prod).
- Blob: private container; access only via short-lived **user-delegation SAS** (upload 15 min, read 60 min).
- Key Vault for any remaining secrets; no secrets in GitHub (OIDC federated credentials).
- TLS everywhere; HSTS + CSP headers from Static Web Apps config.
- Graph `Mail.Send` application permission **restricted to one mailbox** (`inspections@ozellar.com`) using Exchange Online RBAC for Applications / application access policy.
- Audit log for approvals, deletes, role changes.
- Backups: Postgres PITR (7–35 days); Blob soft delete + versioning.
