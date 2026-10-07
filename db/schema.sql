-- =====================================================================
-- Ozellar VIR — target PostgreSQL schema (Azure Database for PostgreSQL)
-- Tested on PostgreSQL 16. Idempotent where practical.
-- Conventions: uuid PKs generated on the device (offline-safe),
-- updated_at + row_version on every synced table (sync pull cursor),
-- soft delete via deleted_at (so deletions sync to other devices).
-- =====================================================================

create extension if not exists pgcrypto;

-- Global, monotonically increasing version used as the sync cursor.
create sequence if not exists sync_seq;

create or replace function touch_row() returns trigger language plpgsql as $$
begin
  new.updated_at  := now();
  new.row_version := nextval('sync_seq');
  return new;
end $$;

-- ---------- Users & access ----------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  entra_oid     text unique,                 -- Entra object id (unused while auth is email/password; kept for a future SSO switch)
  email         text not null,
  password_hash text,                        -- bcrypt hash; null until the user sets a password
  name          text not null default '',
  designation   text not null default '',
  role          text not null check (role in ('admin','director','techManager','vesselManager')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  row_version   bigint not null default nextval('sync_seq')
);

-- One-time tokens for "set your password" (new user) / "forgot password" emails.
create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null,                 -- sha256 of the token in the emailed link (raw token never stored)
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx on password_reset_tokens (user_id);
create unique index if not exists users_email_lower_uq on users (lower(email));
-- `create table if not exists` above is a no-op on a database that already has `users`,
-- so this column has to be added separately for anyone upgrading from before password auth.
alter table users add column if not exists password_hash text;

create table if not exists vessels (
  id            uuid primary key,
  name          text not null,
  imo           text not null default '',
  vessel_type   text not null default '',
  particulars   jsonb not null default '{}'::jsonb,   -- flag, callSign, grossTonnage, … (23 fields, see docs/06)
  photo_id      uuid,                                  -- -> photos.id (vessel photo)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  row_version   bigint not null default nextval('sync_seq')
);
create unique index if not exists vessels_name_lower_uq on vessels (lower(name)) where deleted_at is null;

create table if not exists user_vessels (
  user_id   uuid not null references users(id) on delete cascade,
  vessel_id uuid not null references vessels(id) on delete cascade,
  primary key (user_id, vessel_id)
);

-- ---------- Checklist template (master) ----------
create table if not exists template_sections (
  id          uuid primary key default gen_random_uuid(),
  sr          int  not null unique,          -- permanent section id (never reused)
  zone        text not null default '',
  name        text not null,
  position    int  not null,
  photo_only  boolean not null default false,  -- Photo section: internal photo store, never printed
  vessel_types text[] not null default '{}'::text[], -- empty = applies to all vessel types
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  row_version bigint not null default nextval('sync_seq')
);
create table if not exists template_questions (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references template_sections(id) on delete cascade,
  qid         int  not null,                 -- permanent question id within the section
  ref         text not null,                 -- e.g. H-1
  text        text not null,
  position    int  not null,
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  row_version bigint not null default nextval('sync_seq'),
  unique (section_id, qid)
);

-- ---------- Inspections ----------
create table if not exists inspections (
  id               uuid primary key,
  vessel_id        uuid references vessels(id),
  vessel_name      text not null,            -- snapshot at creation
  imo              text not null default '',
  vessel_type      text not null default '',
  inspection_type  text not null default 'port' check (inspection_type in ('port','remote','sailing')),
  port             text not null default '',
  start_date       date,
  completion_date  date,
  sail_from_date   date, sail_from_port text not null default '',
  sail_to_date     date, sail_to_port   text not null default '',
  remote_from_date date, remote_to_date date,
  inspector        text not null default '',
  company          text not null default '',
  summary          text not null default '',
  conclusion       text not null default '',
  cover_photo_id   uuid,
  status           text not null default 'in_progress'
                   check (status in ('in_progress','pending_tm','pending_director','approved','returned')),
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  row_version      bigint not null default nextval('sync_seq')
);
create index if not exists inspections_vessel_idx on inspections (vessel_id);
create index if not exists inspections_status_idx on inspections (status);

-- Each inspection's own frozen copy of the checklist, plus sections added to
-- this inspection only (is_custom = true, replaces the old customSections store).
create table if not exists inspection_sections (
  id              uuid primary key,
  inspection_id   uuid not null references inspections(id) on delete cascade,
  template_sr     int,                        -- null for custom sections
  zone            text not null default '',
  name            text not null,
  position        int  not null,
  photo_only      boolean not null default false,
  is_custom       boolean not null default false,
  vessel_types    text[] not null default '{}'::text[],
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  row_version     bigint not null default nextval('sync_seq')
);
create index if not exists insp_sections_insp_idx on inspection_sections (inspection_id);

create table if not exists inspection_questions (
  id                     uuid primary key,
  inspection_section_id  uuid not null references inspection_sections(id) on delete cascade,
  qid                    int  not null,
  ref                    text not null,
  text                   text not null,
  position               int  not null,
  updated_at             timestamptz not null default now(),
  row_version            bigint not null default nextval('sync_seq'),
  unique (inspection_section_id, qid)
);

create table if not exists responses (
  id                     uuid primary key,
  inspection_id          uuid not null references inspections(id) on delete cascade,
  inspection_question_id uuid not null unique references inspection_questions(id) on delete cascade,
  applicable             boolean,             -- null = not answered
  answer                 text check (answer in ('yes','no')),
  remarks                text not null default '',
  corrective_action      text not null default '',
  preventive_action      text not null default '',
  updated_by             uuid references users(id),
  updated_at             timestamptz not null default now(),
  row_version            bigint not null default nextval('sync_seq')
);
create index if not exists responses_insp_idx on responses (inspection_id);

-- "Additional findings" / extra observations inside a section.
create table if not exists findings (
  id                     uuid primary key,
  inspection_id          uuid not null references inspections(id) on delete cascade,
  inspection_section_id  uuid not null references inspection_sections(id) on delete cascade,
  text                   text not null default '',
  answer                 text check (answer in ('yes','no')),
  corrective_action      text not null default '',
  preventive_action      text not null default '',
  position               int  not null default 0,
  updated_by             uuid references users(id),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  row_version            bigint not null default nextval('sync_seq')
);

-- Every photo is a row + a blob. Exactly one "owner" is set.
create table if not exists photos (
  id                     uuid primary key,
  inspection_id          uuid references inspections(id) on delete cascade,
  target                 text not null check (target in ('section','question','finding','cover','vessel')),
  inspection_section_id  uuid references inspection_sections(id) on delete cascade,
  response_id            uuid references responses(id) on delete cascade,
  finding_id             uuid references findings(id) on delete cascade,
  vessel_id              uuid references vessels(id) on delete cascade,
  blob_path              text not null,        -- photos/<inspectionId|vessel>/<photoId>.jpg
  content_type           text not null default 'image/jpeg',
  size_bytes             int,
  width                  int,
  height                 int,
  is_defect              boolean not null default false,
  position               int not null default 0,
  uploaded               boolean not null default false,   -- true once the blob upload is committed
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  row_version            bigint not null default nextval('sync_seq'),
  check (
    (target = 'section'  and inspection_section_id is not null) or
    (target = 'question' and response_id is not null) or
    (target = 'finding'  and finding_id is not null) or
    (target = 'cover'    and inspection_id is not null) or
    (target = 'vessel'   and vessel_id is not null)
  )
);
create index if not exists photos_insp_idx on photos (inspection_id);

-- ---------- Approvals ----------
create table if not exists approvals (
  inspection_id     uuid primary key references inspections(id) on delete cascade,
  stage             text not null check (stage in ('tm','director','approved','returned')),
  submitted_by      uuid not null references users(id),
  submitted_at      timestamptz not null,
  tm_user_id        uuid references users(id),
  director_user_id  uuid references users(id),
  approved_at       timestamptz,
  returned_by       uuid references users(id),
  return_comment    text,
  updated_at        timestamptz not null default now(),
  row_version       bigint not null default nextval('sync_seq')
);
create table if not exists approval_events (
  id                    uuid primary key default gen_random_uuid(),
  inspection_id         uuid not null references inspections(id) on delete cascade,
  action                text not null check (action in ('submitted','approved','rejected','reopened')),
  level                 text not null default '',     -- 'To Tech Manager', 'Level 1 — Tech Manager', 'Final — Director', …
  actor_user_id         uuid not null references users(id),
  actor_name            text not null default '',     -- snapshots, so history survives renames
  actor_designation     text not null default '',
  actor_role            text not null default '',
  target_user_id        uuid references users(id),    -- who it was sent to
  comment               text not null default '',
  created_at            timestamptz not null default now(),
  row_version           bigint not null default nextval('sync_seq')
);
alter table approval_events add column if not exists row_version bigint not null default nextval('sync_seq');
create index if not exists approval_events_insp_idx on approval_events (inspection_id, created_at);

-- ---------- Settings & audit ----------
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
create table if not exists audit_log (
  id          bigserial primary key,
  actor_user_id uuid references users(id),
  entity      text not null,
  entity_id   text not null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Mutations already applied (makes /sync/push idempotent when a phone retries).
create table if not exists sync_mutations (
  id          uuid primary key,
  user_id     uuid not null references users(id),
  device_id   text not null default '',
  applied_at  timestamptz not null default now()
);

-- ---------- Notifications ----------
create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  inspection_id uuid references inspections(id) on delete cascade,
  type          text not null,
  title         text not null,
  message       text not null,
  link          text not null default '',
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

-- ---------- Triggers: bump updated_at + row_version on every change ----------
do $$
declare t text;
begin
  foreach t in array array['users','vessels','template_sections','template_questions','inspections',
                           'inspection_sections','inspection_questions','responses','findings','photos','approvals']
  loop
    execute format('drop trigger if exists trg_touch on %I', t);
    execute format('create trigger trg_touch before update on %I for each row execute function touch_row()', t);
  end loop;
end $$;

-- Cross-table index for the sync pull (one per synced table).
create index if not exists vessels_rv_idx      on vessels (row_version);
create index if not exists inspections_rv_idx  on inspections (row_version);
create index if not exists insp_sections_rv_idx on inspection_sections (row_version);
create index if not exists responses_rv_idx    on responses (row_version);
create index if not exists findings_rv_idx     on findings (row_version);
create index if not exists photos_rv_idx       on photos (row_version);
create index if not exists approvals_rv_idx    on approvals (row_version);
create index if not exists tsec_rv_idx         on template_sections (row_version);
create index if not exists tq_rv_idx           on template_questions (row_version);
create index if not exists users_rv_idx        on users (row_version);
create index if not exists insp_q_rv_idx       on inspection_questions (row_version);
