# 02 — Current Supabase setup

Project ref: `dgbierhekwndcxrlyhja` (free plan) · URL `https://dgbierhekwndcxrlyhja.supabase.co`
The public `anon` key is embedded in `index.html` (normal for Supabase; RLS does the protecting).

## Tables
| Table | Created by | Purpose |
|---|---|---|
| `public.records` | pre-existing | all synced app data, one row per (user_id, store, key) |
| `public.user_roles` | pre-existing; columns `password_set`, `designation` added Sept 2026 | roles, assigned fleet, name, designation |
| `auth.users`, `auth.identities` | Supabase Auth | logins |

Reconstructed DDL: `current-supabase-sql/00_base_tables_INFERRED.sql` (verify against the real project before relying on it).

### `records` row example
```json
{ "user_id": "712edf31-…", "store": "inspections", "key": "lz3k9a1b2c3",
  "data": { "id": "lz3k9a1b2c3", "vesselName": "AMNS Hercules", "status": "pending_approval",
            "vesselPhoto": { "id": "…", "blob": { "__sbBlob": true, "b64": "/9j/4AAQ…", "type": "image/jpeg" } },
            "sections": [ … ], "approval": { "stage": "tm", … } },
  "updated_at": 1758800000000, "deleted": false }
```
Blobs (photos) are packed by `sbPackForSync` into `{__sbBlob, b64, type}` and unpacked by `sbUnpackFromSync`.

## SQL functions (all `security definer`, `search_path` pinned)
| Function | File | Callable by | What it does |
|---|---|---|---|
| `admin_set_password(target_email, new_password)` | `01_…sql` | authenticated (checks Admin inside) | creates an email/password login (inserts `auth.users` + `auth.identities`, email confirmed) or replaces the password; sets `password_set = true` |
| `mark_password_set()` | `01_…sql` | authenticated | flags the caller's own `user_roles.password_set = true` |
| `is_app_member()` | `02_…sql` | authenticated | true if caller's email is the bootstrap admin or has a role |
| `list_app_users()` | `03_…sql` | authenticated members | returns email, name, role, fleet (jsonb), designation — used to pick approvers |

## RLS policies
- `records`: own-row write (pre-existing) + **"Company members can read all records"** (`for select to authenticated using (is_app_member())`) — added Sept 2026.
- `user_roles`: pre-existing (own row read; admin manage).

## Auth settings in use
- Email + password sign-in, sign-up.
- Magic link / OTP (`signInWithOtp`, `verifyOtp` type `email`). To send the 6-digit code, the **Magic Link** template must contain `{{ .Token }}` (not yet done).
- **Custom SMTP: not configured** → emails only reach Supabase team members, ~2/hour.
- URL configuration: Site URL / redirect should be `https://pavan5296-sys.github.io/Ozellar-Inspection-/`.

## Order the SQL was applied
1. `01_admin_set_password_and_password_flag.sql`
2. `02_company_shared_read_access.sql`
3. `03_designation_and_list_app_users.sql` (replaces the earlier version of `list_app_users`)

All three are idempotent (safe to re-run).

## Getting data out of Supabase (for migration)
- Dashboard → Table Editor → `records` / `user_roles` → Export CSV, **or**
- use the service-role key from a secure machine (never in the app) with the migration tool in `starter/tools/migrate-from-supabase/`.
- Users: Authentication → Users (emails only; passwords are not exportable and are not needed after moving to Microsoft sign-in).
