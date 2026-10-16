-- Public availability, private administration metadata, and a database signup gate.
begin;
create table public.platform_registration_settings (
  singleton boolean primary key default true check(singleton),
  registration_open boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.platform_registration_settings(singleton) values(true);
alter table public.platform_registration_settings enable row level security;
revoke all on public.platform_registration_settings from public, anon, authenticated, supabase_auth_admin;
grant select(registration_open) on public.platform_registration_settings to anon, authenticated, supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select, update on public.platform_registration_settings to service_role;
create policy registration_availability_read on public.platform_registration_settings
  for select to anon, authenticated, supabase_auth_admin using(true);

create function public.platform_registration_status() returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select registration_open from public.platform_registration_settings), false);
$$;
revoke all on function public.platform_registration_status() from public;
grant execute on function public.platform_registration_status() to anon, authenticated, service_role, supabase_auth_admin;

-- Covers direct Auth requests and every provider creating an auth.users row.
-- Existing-user login and recovery update rows and are unaffected.
create function public.platform_guard_new_registration() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not public.platform_registration_status() then raise exception 'REGISTRATION_PAUSED'; end if;
  return new;
end;
$$;
revoke all on function public.platform_guard_new_registration() from public, anon, authenticated;
grant execute on function public.platform_guard_new_registration() to supabase_auth_admin, service_role;
create trigger platform_new_registration_guard before insert on auth.users
  for each row execute function public.platform_guard_new_registration();

alter table public.platform_admin_audit drop constraint platform_admin_audit_action_check;
alter table public.platform_admin_audit add constraint platform_admin_audit_action_check
  check(action in ('user.suspend','user.restore','reviewer.grant','reviewer.revoke','registration.open','registration.pause'));
create function public.platform_set_registration(p_actor uuid, p_enabled boolean, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare settings public.platform_registration_settings;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'PLATFORM_FORBIDDEN'; end if;
  if p_enabled is null or p_expected_updated_at is null then raise exception 'PLATFORM_INVALID_INPUT'; end if;
  select * into settings from public.platform_registration_settings where singleton for update;
  if settings.updated_at is distinct from p_expected_updated_at then raise exception 'PLATFORM_STATE_CHANGED'; end if;
  if settings.registration_open <> p_enabled then
    update public.platform_registration_settings set registration_open=p_enabled,updated_at=clock_timestamp(),updated_by=p_actor where singleton returning * into settings;
    insert into public.platform_admin_audit(actor_user_id,action,outcome,reason,completed_at)
      values(p_actor,case when p_enabled then 'registration.open' else 'registration.pause' end,'succeeded',
        case when p_enabled then '恢复新用户注册' else '暂停新用户注册' end,clock_timestamp());
  end if;
  return jsonb_build_object('enabled',settings.registration_open,'updatedAt',settings.updated_at);
end;
$$;
revoke all on function public.platform_set_registration(uuid,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.platform_set_registration(uuid,boolean,timestamptz) to service_role;
commit;
