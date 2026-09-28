# 14 — Decisions made & open questions

## Decided (from discussions, 25–28 Sep 2026)
1. Move off GitHub Pages + Supabase to Azure; also re-architect the code (not just re-host).
2. Must support **web, mobile, offline sync**, with **every current feature** (`03-feature-inventory.md`).
3. Stack: React + TypeScript PWA, Capacitor for store apps, Azure Static Web Apps + Functions, PostgreSQL, Blob Storage, Entra ID, Microsoft Graph email.
4. Approval workflow: VM → TM (who has the vessel) → Director (picked by TM); TM/Admin → Director; reject with reason back to submitter; locked while pending; Director view-only; Admin any level + reopen.
5. Reports exclude: section numbers, Photo sections, "General Section photos" label, "Red frame = defect" note, approval record.
6. Photo sections are an internal photo store and reach all not-completed inspections on all vessels.
7. Designation is a pick-list (presets + "Other…").
8. Normal / Light mode switch on the main page, per device, any user.

## Open questions (defaults proposed — confirm before Phase 1)
| # | Question | Proposed default |
|---|---|---|
| Q1 | Language for the back end: TypeScript or .NET? | TypeScript (starter is TypeScript) |
| Q2 | Any users **without** an @ozellar.com account (ship crew, external superintendents)? | invite as Entra B2B guests |
| Q3 | Must PDF be produced **offline at sea**? | yes — keep on-device PDF; server PDF optional later |
| Q4 | Old inspections marked "completed" before approvals existed: migrate as `approved` or `in_progress`? | `approved` (history note "migrated as approved") |
| Q5 | Region / data residency | Central India (confirm Flex Consumption availability; else South India / Southeast Asia) |
| Q6 | App Store / Play Store publishing needed at launch, or PWA first? | PWA first (Phase 2–3), store apps Phase 4 |
| Q7 | Approval emails from which mailbox? | `inspections@ozellar.com` (shared mailbox) |
| Q8 | Fleet inspection cycle fixed at 6 months (due-soon at 5)? | keep; make configurable in `app_settings` |
| Q9 | Retention of photos / inspections | keep all; move photos > 2 years to Cool tier |
| Q10 | Should Directors be able to import JSON backups? | no (as today) |
