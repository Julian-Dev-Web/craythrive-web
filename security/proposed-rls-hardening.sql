-- REVIEW-ONLY DRAFT, NOT AN AUTOMATIC SUPABASE MIGRATION.
-- Live schema/policies and the AI backend were not available in this workspace.
-- This file intentionally aborts until reviewed. Do not remove the gate until
-- inspect-supabase.sql, ownership backfills, ingestion identities, mobile flows,
-- public seller fields, order transitions and existing permissive policies are verified.
-- No data is deleted. All changes below are transactional.
-- Restrictive guards AND with existing permissive policies; they do not grant access.
begin;

do $$ begin
  raise exception 'REVIEW REQUIRED: validate schema, policies, public seller fields and order workflows before applying this draft';
end $$;

-- Stop atomically on every assumed column mismatch. No speculative ALTER ADD columns.
do $$
declare item record;
begin
  for item in select * from (values
    ('profiles', 'id'), ('profiles', 'role'),
    ('tanks', 'id'), ('tanks', 'user_id'),
    ('iot_devices', 'user_id'), ('iot_devices', 'tank_id'),
    ('sensor_readings', 'user_id'), ('sensor_readings', 'tank_id'),
    ('ammonia_readings', 'user_id'), ('ammonia_readings', 'tank_id'),
    ('alerts', 'user_id'), ('threshold_settings', 'user_id'),
    ('seller_profiles', 'user_id'),
    ('marketplace_listings', 'id'), ('marketplace_listings', 'seller_id'), ('marketplace_listings', 'status'),
    ('marketplace_orders', 'buyer_id'), ('marketplace_orders', 'seller_id'), ('marketplace_orders', 'listing_id'),
    ('marketplace_chat_threads', 'id'), ('marketplace_chat_threads', 'buyer_id'), ('marketplace_chat_threads', 'seller_id'),
    ('marketplace_chat_messages', 'thread_id'), ('marketplace_chat_messages', 'sender_id')
  ) as expected(table_name, column_name)
  loop
    if not exists (select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = item.table_name and c.column_name = item.column_name) then
      raise exception 'Schema assumption failed: %.%', item.table_name, item.column_name;
    end if;
  end loop;
end $$;

-- Private user-owned tables; no anon access even if an older permissive policy allows it.
do $$
declare target_table text;
begin
  foreach target_table in array array['tanks', 'alerts', 'threshold_settings'] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('create policy ct_owner_guard on public.%I as restrictive for all to public
      using ((select auth.uid()) is not null and user_id = (select auth.uid()))
      with check ((select auth.uid()) is not null and user_id = (select auth.uid()))', target_table);

  end loop;
  -- Optional tables must have a verified user_id; stop instead of silently leaving them insecure.
  foreach target_table in array array['notification_preferences', 'push_tokens', 'control_logs', 'device_commands', 'devices'] loop
    if to_regclass('public.' || target_table) is null then continue; end if;
    if not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
      and c.table_name = target_table and c.column_name = 'user_id') then
      raise exception 'Verify ownership column before protecting %', target_table;
    end if;
    execute format('alter table public.%I enable row level security', target_table);
    execute format('create policy ct_owner_guard on public.%I as restrictive for all to public
      using ((select auth.uid()) is not null and user_id = (select auth.uid()))
      with check ((select auth.uid()) is not null and user_id = (select auth.uid()))', target_table);
    if target_table in ('control_logs', 'device_commands') then
      if not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
        and c.table_name = target_table and c.column_name = 'tank_id') then
        raise exception 'Verify tank binding before protecting %', target_table;
      end if;
      execute format('create policy ct_command_tank_guard on public.%I as restrictive for all to public
        using (exists (select 1 from public.tanks t where t.id = %I.tank_id
          and t.user_id = (select auth.uid())))
        with check (exists (select 1 from public.tanks t where t.id = %I.tank_id
          and t.user_id = (select auth.uid())))', target_table, target_table, target_table);
      -- Device UID binding, command whitelist/status and duration limits still
      -- require the actual device backend contract before this draft is applied.
    end if;
  end loop;
end $$;

-- Verify tank ownership on both existing rows and new row contents.
-- Legacy device-only rows must be mapped to tanks BEFORE applying this section.
do $$
declare target_table text;
begin
  foreach target_table in array array['iot_devices', 'sensor_readings', 'ammonia_readings'] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('create policy ct_tank_owner_guard on public.%I as restrictive for all to public
      using (user_id = (select auth.uid()) and exists (select 1 from public.tanks t
        where t.id = %I.tank_id and t.user_id = (select auth.uid())))
      with check (user_id = (select auth.uid()) and exists (select 1 from public.tanks t
        where t.id = %I.tank_id and t.user_id = (select auth.uid())))', target_table, target_table, target_table);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy ct_profile_owner_guard on public.profiles as restrictive for all to public
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = 'user');

-- RLS owner checks alone cannot prevent a user updating their own role.
create function public.ct_protect_profile_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
    new.id is distinct from old.id or
    new.role is distinct from old.role or
    (to_jsonb(new)->'user_id') is distinct from (to_jsonb(old)->'user_id') or
    (to_jsonb(new)->'user_role') is distinct from (to_jsonb(old)->'user_role') or
    (to_jsonb(new)->'account_role') is distinct from (to_jsonb(old)->'account_role')
  ) then raise exception 'Profile identity and role cannot be changed by clients'; end if;
  return new;
end $$;
create trigger ct_protect_profile_identity before update on public.profiles
  for each row execute function public.ct_protect_profile_identity();
revoke all on function public.ct_protect_profile_identity() from public, anon, authenticated;

alter table public.marketplace_listings enable row level security;
create policy ct_listing_read_guard on public.marketplace_listings as restrictive for select to public
  using (seller_id = (select auth.uid()) or status = 'active');
create policy ct_listing_insert_guard on public.marketplace_listings as restrictive for insert to public
  with check (seller_id = (select auth.uid()));
create policy ct_listing_update_guard on public.marketplace_listings as restrictive for update to public
  using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));
create policy ct_listing_delete_guard on public.marketplace_listings as restrictive for delete to public
  using (seller_id = (select auth.uid()));

-- Seller SELECT requires a reviewed public projection to preserve shop links.
-- Owner-only SELECT below is conservative; adapt the UI to a verified public view
-- exposing ONLY intentionally public store/contact/URL fields before applying.
alter table public.seller_profiles enable row level security;
create policy ct_seller_owner_guard on public.seller_profiles as restrictive for all to public
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.marketplace_orders enable row level security;
create policy ct_order_read_guard on public.marketplace_orders as restrictive for select to public
  using ((select auth.uid()) in (buyer_id, seller_id));
create policy ct_order_insert_guard on public.marketplace_orders as restrictive for insert to public
  with check (buyer_id = (select auth.uid()) and buyer_id <> seller_id and exists (
    select 1 from public.marketplace_listings l where l.id = marketplace_orders.listing_id
      and l.seller_id = marketplace_orders.seller_id and l.status = 'active'));
create policy ct_order_update_guard on public.marketplace_orders as restrictive for update to public
  using (false) with check (false);
create policy ct_order_delete_guard on public.marketplace_orders as restrictive for delete to public
  using (false);

-- Direct updates are deliberately blocked in this DRAFT, pending the real mobile
-- workflow. Fit an authenticated transaction/RPC before enabling this migration for
-- pricing, inventory, permitted status transitions, listing_id/seller_id/buyer_id
-- immutability and concurrency. Do not grant unrestricted participant UPDATE.

alter table public.marketplace_chat_threads enable row level security;
create policy ct_thread_read_guard on public.marketplace_chat_threads as restrictive for select to public
  using ((select auth.uid()) in (buyer_id, seller_id));
-- Fit the verified existing thread-creation workflow before applying this DRAFT:
-- a participant must not freely replace membership or forge a seller/buyer relationship.
create policy ct_thread_insert_guard on public.marketplace_chat_threads as restrictive for insert to public
  with check (false);
create policy ct_thread_update_guard on public.marketplace_chat_threads as restrictive for update to public
  using (false) with check (false);
create policy ct_thread_delete_guard on public.marketplace_chat_threads as restrictive for delete to public
  using (false);
alter table public.marketplace_chat_messages enable row level security;
create policy ct_message_read_guard on public.marketplace_chat_messages as restrictive for select to public
  using (exists (select 1 from public.marketplace_chat_threads t
    where t.id = marketplace_chat_messages.thread_id and (select auth.uid()) in (t.buyer_id, t.seller_id)));
create policy ct_message_insert_guard on public.marketplace_chat_messages as restrictive for insert to public
  with check (sender_id = (select auth.uid()) and exists (select 1 from public.marketplace_chat_threads t
    where t.id = marketplace_chat_messages.thread_id and (select auth.uid()) in (t.buyer_id, t.seller_id)));
create policy ct_message_update_guard on public.marketplace_chat_messages as restrictive for update to public
  using (false) with check (false);
create policy ct_message_delete_guard on public.marketplace_chat_messages as restrictive for delete to public
  using (false);
-- Thread creation/participant immutability and message-edit requirements need
-- the actual backend schema; do not claim these examples complete that audit.

-- Existing URLs are preserved: no object renames, removals or bucket recreation.
-- Existing public READ stays as-is. Restrictive write guards protect marketplace-images.
create policy ct_marketplace_upload_guard on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'marketplace-images' or (
    (select auth.uid()) is not null and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text));
create policy ct_marketplace_update_guard on storage.objects as restrictive for update to public
  using (bucket_id <> 'marketplace-images' or (
    (select auth.uid()) is not null and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text))
  with check (bucket_id <> 'marketplace-images' or (
    owner_id = (select auth.uid())::text and (storage.foldername(name))[1] = (select auth.uid())::text));
create policy ct_marketplace_delete_guard on storage.objects as restrictive for delete to public
  using (bucket_id <> 'marketplace-images' or (
    (select auth.uid()) is not null and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text));
-- Verify storage.objects.owner_id and backfill legitimate old owners first.
-- Review the bucket's server-enforced MIME allowlist and 5 MB limit separately.

-- Do not grant public/anon writes or introduce service-role credentials to clients.
-- No permissive access is added by this draft; existing grants/policies still need review.
commit;
