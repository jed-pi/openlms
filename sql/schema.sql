-- Woodhouse Park Training — database schema (PostgreSQL / Supabase).
-- Idempotent: safe to run repeatedly.

create table if not exists learners (
  id             text primary key,
  email          text unique not null,
  full_name      text not null,
  is_admin       boolean not null default false,
  email_verified boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Passwordless sign-in: short-lived single-use magic-link tokens.
create table if not exists login_tokens (
  token       text primary key,
  learner_id  text not null references learners(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_login_tokens_learner on login_tokens(learner_id);

-- One row per SCORM course, seeded from the packages at deploy time.
create table if not exists courses (
  id                   text primary key,        -- EdApp manifest id
  slug                 text unique not null,
  title                text not null,
  category             text not null,           -- from the source folder
  content_path         text not null,           -- e.g. /content/<id>
  entry                text not null default 'index.html',
  minimum_score        integer not null default 0,
  disable_lesson_score boolean not null default false,
  gate_on_score        boolean not null default false,  -- if true, require score >= minimum_score
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now()
);

-- One current row per (learner, course); upserted on each SCORM commit.
create table if not exists completions (
  id              text primary key,
  learner_id      text not null references learners(id) on delete cascade,
  course_id       text not null references courses(id) on delete cascade,
  lesson_status   text,
  score_raw       integer,
  suspend_data    text,
  lesson_location text,
  raw_cmi         jsonb,
  passed          boolean not null default false,
  completed_at    timestamptz,                  -- set when first passed
  updated_at      timestamptz not null default now(),
  unique (learner_id, course_id)
);
create index if not exists idx_completions_learner on completions(learner_id);
create index if not exists idx_completions_course  on completions(course_id);

-- One active certificate per (learner, course); re-issuable.
create table if not exists certificates (
  id          text primary key,                 -- verifiable ref, e.g. WHP-PPE-01HXYZ...
  learner_id  text not null references learners(id) on delete cascade,
  course_id   text not null references courses(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  pdf_path    text,
  emailed_at  timestamptz,
  revoked     boolean not null default false
);
create unique index if not exists uq_active_cert
  on certificates(learner_id, course_id) where revoked = false;
create index if not exists idx_certificates_learner on certificates(learner_id);

-- Optional grouping of courses into tools/areas (for dashboard + "cleared for X" reporting).
create table if not exists tool_groups (
  id          text primary key,
  name        text not null,
  slug        text unique not null,
  description text,
  sort_order  integer not null default 0
);

create table if not exists tool_group_courses (
  tool_group_id text not null references tool_groups(id) on delete cascade,
  course_id     text not null references courses(id) on delete cascade,
  primary key (tool_group_id, course_id)
);
