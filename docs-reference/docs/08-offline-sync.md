# 08 — Offline & sync design

Goal: inspectors work a full day at sea with no signal; everything reaches the office when a connection appears; nothing is lost; approvals and locks stay correct.

## On the device
- **Dexie (IndexedDB)** tables mirror the server entities: `vessels`, `inspections`, `inspectionSections`, `inspectionQuestions`, `responses`, `findings`, `photos`, `approvals`, `templateSections`, `templateQuestions`, `me`.
- **`outbox`** table: every local change appends `{id (uuid), entity, entityId, op, data, baseVersion, createdAt, attempts}`.
- **`photoQueue`** table: `{photoId, blob (compressed JPEG), status: pending|uploading|uploaded|committed, attempts}`.
- **`syncState`**: `{cursor (last row_version pulled), lastSyncAt, deviceId}`.
- UI reads **only** from Dexie (live queries), so screens are instant and identical online/offline.

## Write path
1. User edits → transaction: update Dexie row **and** append to `outbox`.
2. Sync engine (runs on app start, every 60 s while open, on `online` event, on "Sync now", and via background sync in the native app) sends outbox in batches to `POST /sync/push`.
3. Server validates each mutation **with the shared rules** (permission, edit lock, approval stage), applies it, bumps `row_version`, returns result.
4. `ok` → remove from outbox. `rejected` → replace local row with `serverRow`, remove mutation, show a message (e.g., "This inspection was submitted — your change wasn't saved").
5. Network error → keep in outbox, retry with backoff.

## Read path
`GET /sync/pull?cursor=N` returns every row the caller may see with `row_version > N` (including soft-deleted rows, so deletions propagate), ordered by `row_version`, max 500 per page; the client loops until `hasMore=false`, applies rows to Dexie (skipping rows that have pending outbox mutations), then stores `nextCursor`.
First sync on a new device = pull from cursor 0 (filtered to the user's vessels; photos arrive as metadata only).

## Photos
1. Take/upload → compress on device (≈1600 px, JPEG ~0.8) → Dexie `photos` row + `photoQueue` entry + outbox mutation (metadata).
2. When online: `POST /photos/upload-url` → PUT blob to the SAS URL → `POST /photos/{id}/commit`.
3. Viewing: local blob if present; else request read URLs in batches and cache the images (Workbox runtime cache / native file cache).
4. Survives app restarts; on native, uploads continue in background.

## Conflicts
| Case | Rule |
|---|---|
| Two people edit **different** questions/fields | no conflict (rows are small: one response per question) |
| Two people edit the **same** response offline | last write wins at **row** level (server `updated_at`); the losing device gets the server row back and a notice. Optional: field-level merge later |
| Edit an inspection that became **submitted/approved** meanwhile | server rejects (`LOCKED`); client reverts local change |
| Approval actions | **online only** (need the server to be the single authority). Buttons disabled offline with a hint |
| Delete vs edit | delete wins (soft delete); edit to a deleted row rejected |

## Why this is better than today
- Rows are per answer/photo, not whole documents → far fewer conflicts and smaller syncs.
- Photos are files uploaded once, not base64 re-sent inside JSON.
- The server enforces locks, so a phone that was offline can't overwrite a submitted report.
