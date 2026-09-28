-- =====================================================================
-- Ozellar — BASE TABLES (INFERRED, FOR REFERENCE ONLY)
--
-- These two tables already existed in the Supabase project before the
-- changes made in September 2026. Their exact definitions were never
-- visible from the app, so the DDL below is RECONSTRUCTED from how the
-- app reads and writes them. Before relying on it, compare with the real
-- definitions in Supabase: Table Editor -> records / user_roles ->
-- "Definition" (or run:  select pg_get_tabledef ...  / \d+ in psql).
--
-- Do NOT run this against the live project; it is documentation.
-- =====================================================================

-- One generic table for all synced app data ("stores").
create table if not exists public.records (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  store       text        not null,   -- inspections | responses | sectionExtras | customSections | vessels | appConfig
  key         text        not null,   -- item id within the store
  data        jsonb       not null default '{}'::jsonb,  -- full item; photos embedded as {"__sbBlob":true,"b64":"...","type":"image/jpeg"}
  updated_at  bigint      not null,   -- milliseconds since epoch, set by the client
  deleted     boolean     not null default false,        -- tombstone
  primary key (user_id, store, key)   -- app upserts with onConflict 'user_id,store,key'
);
alter table public.records enable row level security;

-- Existing policy (inferred): each user can insert/update/read their OWN rows.
--   using (user_id = auth.uid())  with check (user_id = auth.uid())
-- Added Sept 2026 (see 02_company_shared_read_access.sql): any app member can READ all rows.

-- Who can do what.
create table if not exists public.user_roles (
  email        text primary key,          -- lower-case login email
  role         text,                      -- admin | director | techManager | vesselManager
  fleet        text[],                    -- assigned vessel NAMES (matched case-insensitively); may be jsonb in the real table
  name         text,
  updated_at   timestamptz,
  password_set boolean,                   -- added Sept 2026
  designation  text                       -- added Sept 2026
);
alter table public.user_roles enable row level security;
-- Existing policies (inferred): signed-in users read their own row; admins manage all rows.
