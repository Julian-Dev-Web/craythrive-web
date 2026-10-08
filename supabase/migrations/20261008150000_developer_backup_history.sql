-- Dedicated server-only encrypted archive store. No application tables changed.
begin;
create schema if not exists craythrive_private authorization postgres;
revoke all on schema craythrive_private from public, anon, authenticated, service_role;

create table if not exists craythrive_private.backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null,
  backup_day date not null,
  source text not null check (source in ('automatic','manual')),
  content_hash text not null,
  table_count integer not null check (table_count >= 0),
  record_count integer not null check (record_count >= 0),
  byte_size integer not null check (byte_size > 0),
  summary jsonb not null,
  payload jsonb not null
);
create index if not exists backups_created_at_id on craythrive_private.backups (created_at desc,id desc);
alter table craythrive_private.backups enable row level security;
revoke all on craythrive_private.backups from public, anon, authenticated, service_role;

create table if not exists craythrive_private.backup_runs (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null,
  source text not null check (source in ('automatic','manual')),
  status text not null check (status in ('saved','skipped','failed')),
  reason text not null check (reason in ('data_changed','no_data_changes','backup_failed')),
  backup_id uuid references craythrive_private.backups(id)
);
create index if not exists backup_runs_checked_at on craythrive_private.backup_runs (checked_at desc,id desc);
alter table craythrive_private.backup_runs enable row level security;
revoke all on craythrive_private.backup_runs from public, anon, authenticated, service_role;

create table if not exists craythrive_private.backup_schedule_config (
  singleton boolean primary key default true check (singleton),
  worker_url text not null check (worker_url ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/developer-backup-scheduled$')
);
alter table craythrive_private.backup_schedule_config enable row level security;
revoke all on craythrive_private.backup_schedule_config from public, anon, authenticated, service_role;
commit;
