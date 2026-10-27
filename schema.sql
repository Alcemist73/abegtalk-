-- AbegTalk schema (PostgreSQL 13+). Run once.
create table sessions(
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,          -- sha256 of the secret token; raw token is never stored
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now());

create table queue(
  session_id uuid primary key references sessions(id) on delete cascade,
  joined_at timestamptz not null default now());

create table rooms(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ended_at timestamptz);

create table room_participants(
  room_id uuid not null references rooms(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key(room_id, session_id));
-- a session can be in at most one active room
create unique index one_active_room on room_participants(session_id) where left_at is null;

create table messages(
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  sender uuid not null references sessions(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now());
create index on messages(room_id, id);

-- no foreign keys: reports must outlive sessions/rooms. Only the server (via DATABASE_URL) can read them.
create table reports(
  id bigserial primary key,
  room_id uuid, reporter uuid, reported uuid,
  reason text not null check (reason in ('harassment','threats','spam','inappropriate')),
  created_at timestamptz not null default now());
