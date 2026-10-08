-- Account snapshots are private to their authenticated owner.
create table public.account_sync_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now(),
  device_name text not null default '',
  constraint account_snapshot_format check (
    jsonb_typeof(payload) = 'object'
    and payload->>'format' = 'study-life-sync'
    and payload->>'version' = '3'
    and jsonb_typeof(payload->'values') = 'object'
    and jsonb_typeof(payload->'manifest') = 'object'
    and octet_length(payload::text) <= 16777216
  ),
  constraint account_device_name_length check (char_length(device_name) <= 80)
);
alter table public.account_sync_snapshots enable row level security;
revoke all on public.account_sync_snapshots from public, anon;
grant select, insert, update on public.account_sync_snapshots to authenticated;

create policy account_snapshot_select on public.account_sync_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy account_snapshot_insert on public.account_sync_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy account_snapshot_update on public.account_sync_snapshots
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Cooperative clients write via CAS: an outdated revision never overwrites a newer snapshot.
-- SECURITY INVOKER keeps RLS active; ownership always comes from auth.uid(), never client input.
create function public.write_account_sync_snapshot(
  expected_revision bigint,
  snapshot_payload jsonb,
  source_device_name text default ''
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  saved public.account_sync_snapshots%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if expected_revision is not null and expected_revision < 1 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;

  insert into public.account_sync_snapshots as existing
    (user_id, payload, revision, updated_at, device_name)
  select current_user_id, snapshot_payload, 1, now(), left(coalesce(source_device_name, ''), 80)
    where expected_revision is null
  on conflict (user_id) do nothing
  returning * into saved;

  if saved.user_id is null and expected_revision is not null then
    update public.account_sync_snapshots
      set payload = snapshot_payload,
          revision = revision + 1,
          updated_at = now(),
          device_name = left(coalesce(source_device_name, ''), 80)
      where user_id = current_user_id and revision = expected_revision
      returning * into saved;
  end if;

  if saved.user_id is not null then
    return jsonb_build_object('ok', true, 'exists', true, 'revision', saved.revision,
      'updatedAt', saved.updated_at, 'updatedByDeviceName', saved.device_name);
  end if;

  select * into saved from public.account_sync_snapshots where user_id = current_user_id;
  return jsonb_build_object('ok', false, 'conflict', true, 'exists', saved.user_id is not null,
    'revision', saved.revision, 'updatedAt', saved.updated_at,
    'updatedByDeviceName', coalesce(saved.device_name, ''), 'error', 'Cloud revision changed');
end;
$$;
revoke all on function public.write_account_sync_snapshot(bigint, jsonb, text) from public, anon;
grant execute on function public.write_account_sync_snapshot(bigint, jsonb, text) to authenticated;
