# Tools — NOT BUILT YET

These were planned but not written (work stopped here on 28 Sep 2026):

- `seed/` — load `db/seed/default-checklist.json` into `template_sections` / `template_questions` and create the first Admin user.
  Until then: insert rows manually, or write a short script following `docs/06-data-model.md`.
- `migrate-from-supabase/` — export `records` + `user_roles` from Supabase (service-role key, secure machine only),
  keep the newest copy per (store, key), transform to the new tables (mapping in `docs/06-data-model.md`),
  upload photos (base64 → Blob), load into Postgres, reconcile counts. Plan: `docs/11-migration-plan.md`.

Because these don't exist yet, the `seed` and `migrate` scripts in the root package.json won't run until they're added.
