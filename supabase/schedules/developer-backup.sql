-- Additive scheduler setup after installing the history migration and placing
-- the dedicated worker token in Vault. The token never appears in cron SQL.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function craythrive_private.dispatch_daily_backup()
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  destination text;
  worker_token text;
  signed_at text;
  signature text;
begin
  select worker_url into strict destination from craythrive_private.backup_schedule_config where singleton;
  select decrypted_secret into strict worker_token from vault.decrypted_secrets where name='craythrive_backup_scheduler_token';
  if worker_token !~ '^[a-f0-9]{64}$' then raise exception 'Backup scheduler configuration is incomplete'; end if;
  signed_at := floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  signature := encode(extensions.hmac(convert_to('craythrive-daily-backup:v1:' || signed_at,'UTF8'),
    decode(worker_token,'hex'),'sha256'),'hex');
  -- Queue only a two-minute signature. The reusable Vault secret never enters
  -- pg_net's queue, which has platform-managed PUBLIC object privileges.
  return net.http_post(url := destination,
    headers := jsonb_build_object('Content-Type','application/json',
      'x-craythrive-backup-timestamp',signed_at,'x-craythrive-backup-signature',signature),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end;
$$;
revoke all on function craythrive_private.dispatch_daily_backup() from public, anon, authenticated, service_role;

-- pg_cron uses UTC on hosted Supabase: 15:55 UTC = 23:55 Asia/Manila.
-- Scheduling by the same job name updates this job rather than adding another.
select cron.schedule('craythrive-daily-backup','55 15 * * *',
  'select craythrive_private.dispatch_daily_backup();');
commit;
