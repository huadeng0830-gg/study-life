-- Fictional accounts and settings only; leave production state unchanged.
begin;
do $$
declare
  owner_id uuid := coalesce((select user_id from public.platform_admins where role='owner' limit 1),gen_random_uuid());
  ordinary_id uuid := gen_random_uuid();
  new_id uuid := gen_random_uuid();
  initial_stamp timestamptz;
  paused_stamp timestamptz;
  before_count bigint;
begin
  -- Fixture setup is outside the gate test and is rolled back.
  update public.platform_registration_settings set registration_open=true;
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,'registration-owner-'||owner_id||'@example.invalid',now()) on conflict(id) do nothing;
  insert into public.platform_admins(user_id,role) values(owner_id,'owner') on conflict(user_id) do nothing;
  insert into auth.users(id,email,email_confirmed_at) values(ordinary_id,'registration-reader-'||ordinary_id||'@example.invalid',now());
  select updated_at into initial_stamp from public.platform_registration_settings;
  select count(*) into before_count from public.platform_admin_audit;
  begin
    perform public.platform_set_registration(ordinary_id,false,initial_stamp);
    raise exception 'ordinary account changed registration';
  exception when raise_exception then if sqlerrm<>'PLATFORM_FORBIDDEN' then raise; end if; end;
  perform public.platform_set_registration(owner_id,false,initial_stamp);
  if public.platform_registration_status() then raise exception 'pause not saved'; end if;
  select updated_at into paused_stamp from public.platform_registration_settings;
  begin
    insert into auth.users(id,email) values(new_id,'registration-blocked-'||new_id||'@example.invalid');
    raise exception 'direct user insert bypassed pause';
  exception when raise_exception then if sqlerrm<>'REGISTRATION_PAUSED' then raise; end if; end;
  update auth.users set email_confirmed_at=now() where id=ordinary_id;
  if not exists(select 1 from auth.users where id=ordinary_id) then raise exception 'pause removed existing user'; end if;
  begin
    perform public.platform_set_registration(owner_id,true,initial_stamp);
    raise exception 'stale settings update accepted';
  exception when raise_exception then if sqlerrm<>'PLATFORM_STATE_CHANGED' then raise; end if; end;
  perform public.platform_set_registration(owner_id,true,paused_stamp);
  insert into auth.users(id,email) values(new_id,'registration-restored-'||new_id||'@example.invalid');
  if (select count(*) from public.platform_admin_audit) <> before_count+2 then raise exception 'registration transitions not audited'; end if;
  if has_column_privilege('anon','public.platform_registration_settings','updated_by','select')
    or has_table_privilege('authenticated','public.platform_registration_settings','update')
    or has_function_privilege('authenticated','public.platform_set_registration(uuid,boolean,timestamptz)','execute') then raise exception 'registration administration exposed'; end if;
end;
$$;
update public.platform_registration_settings set registration_open=false;
set local role supabase_auth_admin;
select public.platform_registration_status();
do $$ begin
  begin
    insert into auth.users(id,email) values(gen_random_uuid(),'registration-auth-blocked@example.invalid');
    raise exception 'Auth role bypassed closed gate';
  exception when raise_exception then if sqlerrm<>'REGISTRATION_PAUSED' then raise; end if; end;
end; $$;
reset role;
update public.platform_registration_settings set registration_open=true;
set local role supabase_auth_admin;
insert into auth.users(id,email) values(gen_random_uuid(),'registration-auth-restored@example.invalid');
reset role;
set local role anon;
select public.platform_registration_status();
reset role;
rollback;
