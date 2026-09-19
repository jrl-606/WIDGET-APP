-- widget-app schema, as it exists on Neon project wandering-union-01244703
-- (branch `main`, database `neondb`). This file is the checked-in record of
-- that schema so a fresh branch can be rebuilt from scratch; it is written to
-- be safe to re-run.
--
-- `neon_auth.user`, `session`, `account`, `verification`, `jwks` etc. are
-- created and owned by Neon Auth (Better Auth) — never hand-edit them. Only
-- `users.auth_user_id` below reaches into that schema.

create extension if not exists pgcrypto;

create table if not exists users (
  id           text primary key,                 -- Widget ID
  display_name text not null,
  created_at   timestamptz not null default now(),
  auth_user_id uuid unique references neon_auth."user"(id) on delete set null
);

create table if not exists goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references users(id) on delete cascade,
  category     text not null check (category in (
                 'Personal Life', 'Business', 'Finances', 'Education', 'Mental Health')),
  sub          text,
  title        text not null,
  start_at     timestamptz not null,
  duration_min integer not null default 0,
  alert_min    integer not null default 0,
  repeat       text not null default 'None',
  phone        text,
  address      text,
  notes        text,
  score        integer check (score in (0, 1, 3, 5)),
  score_notes  text,
  created_at   timestamptz not null default now()
);

create index if not exists goals_user_start_idx on goals (user_id, start_at desc);
create index if not exists goals_user_category_idx on goals (user_id, category);

create table if not exists dm_messages (
  id        bigserial primary key,
  user_a    text not null references users(id) on delete cascade,
  user_b    text not null references users(id) on delete cascade,
  sender_id text not null references users(id) on delete cascade,
  body      text not null,
  sent_at   timestamptz not null default now(),
  check (user_a < user_b)   -- one canonical ordering per conversation
);

create index if not exists dm_pair_idx on dm_messages (user_a, user_b, sent_at desc);

create table if not exists groups (
  id         text primary key,
  name       text not null,
  owner_id   text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists groups_owner_idx on groups (owner_id);

create table if not exists group_members (
  group_id   text not null references groups(id) on delete cascade,
  user_id    text not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'member')),
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on group_members (user_id);

create table if not exists group_messages (
  id        bigserial primary key,
  group_id  text not null references groups(id) on delete cascade,
  sender_id text not null references users(id) on delete cascade,
  body      text not null,
  sent_at   timestamptz not null default now()
);

create index if not exists group_messages_group_idx on group_messages (group_id, sent_at desc);

-- Deliberately absent: any DELETE path for goals. Goals are permanent by
-- design, so no route and no cascade other than user deletion removes one.
