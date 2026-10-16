-- Independent, expiring application restrictions. Auth still verifies identity
-- so a restricted account can privately read its notice. No Auth fields are written.
create table public.platform_account_restrictions (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('account','publish')),
  enabled boolean not null,
  expires_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  read_at timestamptz,
  primary key(user_id,scope)
);
create index platform_account_restrictions_actor on public.platform_account_restrictions(updated_by);
alter table public.platform_account_restrictions enable row level security;
revoke all on public.platform_account_restrictions from public,anon,authenticated;
grant select,insert,update on public.platform_account_restrictions to service_role;

alter table public.platform_admin_audit drop constraint platform_admin_audit_action_check;
alter table public.platform_admin_audit add constraint platform_admin_audit_action_check
  check (action in ('user.suspend','user.restore','user.publish_restrict','user.publish_restore',
    'reviewer.grant','reviewer.revoke','registration.open','registration.pause'));
alter table public.platform_admin_audit add column restriction_details jsonb;

-- Private boolean helper for restrictive policies. Fresh indexed DB state, not
-- user_metadata, a JWT claim, or a client-side cache, decides authorization.
create or replace function private.platform_account_allowed(p_user uuid, p_publish boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user is not null
    and exists(select 1 from auth.users u where u.id=p_user and (u.banned_until is null or u.banned_until<=now()))
    and not exists(select 1 from public.platform_account_restrictions r where r.user_id=p_user
      and (r.scope='account' or (p_publish and r.scope='publish'))
      and r.enabled and (r.expires_at is null or r.expires_at>now()));
$$;
revoke all on function private.platform_account_allowed(uuid,boolean) from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on function private.platform_account_allowed(uuid,boolean) to authenticated,service_role;

create function private.platform_assert_account_allowed(p_user uuid,p_publish boolean default false)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.platform_account_allowed(p_user,p_publish) then raise exception 'PLATFORM_ACCOUNT_RESTRICTED' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function private.platform_assert_account_allowed(uuid,boolean) from public,anon;
grant execute on function private.platform_assert_account_allowed(uuid,boolean) to authenticated,service_role;

create function private.platform_restriction_json(r public.platform_account_restrictions)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('scope',r.scope,'enabled',r.enabled,'expiresAt',r.expires_at,
    'reason',r.reason,'revision',r.revision,'updatedAt',r.updated_at,'unread',r.read_at is null,
    'active',r.enabled and (r.expires_at is null or r.expires_at>now()));
$$;
revoke all on function private.platform_restriction_json(public.platform_account_restrictions) from public,anon,authenticated;

create function private.platform_set_account_restriction(p_actor uuid,p_user uuid,p_scope text,p_enabled boolean,
  p_reason text,p_revision uuid default null,p_duration_seconds bigint default null,p_expires_at timestamptz default null,p_permanent boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.platform_account_restrictions; v_saved public.platform_account_restrictions;
  v_expires timestamptz; v_action text; v_exists boolean;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner')
    or not private.platform_account_allowed(p_actor) then raise exception 'PLATFORM_FORBIDDEN' using errcode='42501'; end if;
  if p_user=p_actor or exists(select 1 from public.platform_admins where user_id=p_user)
    then raise exception 'PLATFORM_OWNER_PROTECTED' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_user) then raise exception 'PLATFORM_USER_NOT_FOUND'; end if;
  if p_scope is null or p_scope not in ('account','publish') or p_enabled is null
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500
    then raise exception 'PLATFORM_INVALID_INPUT' using errcode='22023'; end if;
  if p_enabled then
    if (case when p_duration_seconds is not null then 1 else 0 end
      +case when p_expires_at is not null then 1 else 0 end
      +case when p_permanent then 1 else 0 end)<>1
      then raise exception 'PLATFORM_INVALID_DURATION' using errcode='22023'; end if;
    if p_duration_seconds is not null then
      if p_duration_seconds not between 60 and 3153600000 then raise exception 'PLATFORM_INVALID_DURATION' using errcode='22023'; end if;
      v_expires:=now()+p_duration_seconds*interval '1 second';
    else v_expires:=p_expires_at; end if;
    if v_expires is not null and (v_expires<now()+interval '1 minute' or v_expires>now()+interval '100 years')
      then raise exception 'PLATFORM_INVALID_DURATION' using errcode='22023'; end if;
  elsif p_duration_seconds is not null or p_expires_at is not null or p_permanent then
    raise exception 'PLATFORM_INVALID_DURATION' using errcode='22023';
  end if;
  -- Also serializes concurrent first inserts, where SELECT FOR UPDATE has no row.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_scope,0));
  select * into v_before from public.platform_account_restrictions where user_id=p_user and scope=p_scope for update;
  v_exists:=found;
  if (v_exists and v_before.revision is distinct from p_revision) or (not v_exists and p_revision is not null)
    then raise exception 'PLATFORM_STATE_CHANGED' using errcode='40001'; end if;
  insert into public.platform_account_restrictions(user_id,scope,enabled,expires_at,reason,updated_by)
    values(p_user,p_scope,p_enabled,v_expires,btrim(p_reason),p_actor)
    on conflict(user_id,scope) do update set enabled=excluded.enabled,expires_at=excluded.expires_at,
      reason=excluded.reason,revision=gen_random_uuid(),updated_at=now(),updated_by=p_actor,read_at=null
    returning * into v_saved;
  v_action:=case when p_scope='account' then case when p_enabled then 'user.suspend' else 'user.restore' end
    else case when p_enabled then 'user.publish_restrict' else 'user.publish_restore' end end;
  insert into public.platform_admin_audit(actor_user_id,target_user_id,action,outcome,reason,completed_at,restriction_details)
    values(p_actor,p_user,v_action,'succeeded',btrim(p_reason),now(),jsonb_build_object('scope',p_scope,
      'before',case when v_exists then private.platform_restriction_json(v_before) else null end,
      'after',private.platform_restriction_json(v_saved)));
  return jsonb_build_object('restriction',private.platform_restriction_json(v_saved),'auditIncomplete',false,'notificationSaved',true);
end;
$$;
revoke all on function private.platform_set_account_restriction(uuid,uuid,text,boolean,text,uuid,bigint,timestamptz,boolean) from public,anon,authenticated;
grant execute on function private.platform_set_account_restriction(uuid,uuid,text,boolean,text,uuid,bigint,timestamptz,boolean) to service_role;
create function public.platform_set_account_restriction(p_actor uuid,p_user uuid,p_scope text,p_enabled boolean,
  p_reason text,p_revision uuid default null,p_duration_seconds bigint default null,p_expires_at timestamptz default null,p_permanent boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select private.platform_set_account_restriction(p_actor,p_user,p_scope,p_enabled,p_reason,p_revision,p_duration_seconds,p_expires_at,p_permanent);
$$;
revoke all on function public.platform_set_account_restriction(uuid,uuid,text,boolean,text,uuid,bigint,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.platform_set_account_restriction(uuid,uuid,text,boolean,text,uuid,bigint,timestamptz,boolean) to service_role;

-- The only self-service projection: at most two latest notices. No target ID,
-- emails, actor IDs, audit history, or other account's details are accepted/returned.
create function private.platform_my_restrictions() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_restrictions jsonb; v_legacy timestamptz;
begin
  if v_user is null then raise exception 'PLATFORM_UNAUTHORIZED' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(r.scope,private.platform_restriction_json(r)),'{}'::jsonb)
    into v_restrictions from public.platform_account_restrictions r where r.user_id=v_user;
  select banned_until into v_legacy from auth.users where id=v_user and banned_until>now();
  return jsonb_build_object('restrictions',v_restrictions,'legacyBannedUntil',v_legacy,'serverTime',now());
end;
$$;
revoke all on function private.platform_my_restrictions() from public,anon;
grant execute on function private.platform_my_restrictions() to authenticated;
create function public.platform_my_restrictions() returns jsonb language sql stable security invoker set search_path='' as $$ select private.platform_my_restrictions(); $$;
revoke all on function public.platform_my_restrictions() from public,anon;
grant execute on function public.platform_my_restrictions() to authenticated;

create function private.platform_ack_restriction(p_scope text,p_revision uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'PLATFORM_UNAUTHORIZED' using errcode='42501'; end if;
  update public.platform_account_restrictions set read_at=now() where user_id=auth.uid() and scope=p_scope and revision=p_revision;
  return found;
end;
$$;
revoke all on function private.platform_ack_restriction(text,uuid) from public,anon;
grant execute on function private.platform_ack_restriction(text,uuid) to authenticated;
create function public.platform_ack_restriction(p_scope text,p_revision uuid) returns boolean language sql security invoker set search_path='' as $$ select private.platform_ack_restriction(p_scope,p_revision); $$;
revoke all on function public.platform_ack_restriction(text,uuid) from public,anon;
grant execute on function public.platform_ack_restriction(text,uuid) to authenticated;

-- Service-only preflight for the three trusted business Edge Functions. RLS
-- alone cannot constrain their service_role writes. No authorization caching.
create function private.platform_account_access(p_actor uuid,p_publish boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('allowed',private.platform_account_allowed(p_actor,p_publish),
    'code',case when not private.platform_account_allowed(p_actor) then 'account_suspended'
      when p_publish and not private.platform_account_allowed(p_actor,true) then 'publishing_restricted' else null end);
$$;
revoke all on function private.platform_account_access(uuid,boolean) from public,anon,authenticated;
grant execute on function private.platform_account_access(uuid,boolean) to service_role;
create function public.platform_account_access(p_actor uuid,p_publish boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.platform_account_access(p_actor,p_publish); $$;
revoke all on function public.platform_account_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.platform_account_access(uuid,boolean) to service_role;

-- Add AND guards to existing ownership policies, rather than permissive OR
-- policies which could bypass either the existing ownership or the restriction.
do $$ declare t text; begin
  foreach t in array array['account_sync_snapshots','social_profiles','social_friend_requests',
    'social_friendships','social_invitations','social_invitation_participants'] loop
    execute format('create policy platform_account_guard on public.%I as restrictive for all to authenticated using ((select private.platform_assert_account_allowed(auth.uid()))) with check ((select private.platform_assert_account_allowed(auth.uid(),%L)))',t,t='social_profiles');
  end loop;
end $$;
create policy platform_account_storage_guard on storage.objects as restrictive for all to authenticated
  using (bucket_id<>'qixing-deliverables' or (select private.platform_account_allowed(auth.uid())))
  with check (bucket_id<>'qixing-deliverables' or (select private.platform_account_allowed(auth.uid(),true)));

-- A clear denial before the optimistic snapshot write; otherwise RLS-hidden
-- rows could be mistaken for an ordinary revision conflict.
create or replace function public.write_account_sync_snapshot(expected_revision bigint,snapshot_payload jsonb,source_device_name text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_user_id uuid:=auth.uid(); saved public.account_sync_snapshots%rowtype;
begin
  if not private.platform_account_allowed(current_user_id) then raise exception 'PLATFORM_ACCOUNT_SUSPENDED' using errcode='42501'; end if;
  if expected_revision is not null and expected_revision<1 then raise exception 'Invalid revision' using errcode='22023'; end if;
  insert into public.account_sync_snapshots as existing(user_id,payload,revision,updated_at,device_name)
    select current_user_id,snapshot_payload,1,now(),left(coalesce(source_device_name,''),80) where expected_revision is null
    on conflict(user_id) do nothing returning * into saved;
  if saved.user_id is null and expected_revision is not null then
    update public.account_sync_snapshots set payload=snapshot_payload,revision=revision+1,updated_at=now(),device_name=left(coalesce(source_device_name,''),80)
      where user_id=current_user_id and revision=expected_revision returning * into saved;
  end if;
  if saved.user_id is not null then return jsonb_build_object('ok',true,'exists',true,'revision',saved.revision,'updatedAt',saved.updated_at,'updatedByDeviceName',saved.device_name); end if;
  select * into saved from public.account_sync_snapshots where user_id=current_user_id;
  return jsonb_build_object('ok',false,'conflict',true,'exists',saved.user_id is not null,'revision',saved.revision,
    'updatedAt',saved.updated_at,'updatedByDeviceName',coalesce(saved.device_name,''),'error','Cloud revision changed');
end;
$$;
