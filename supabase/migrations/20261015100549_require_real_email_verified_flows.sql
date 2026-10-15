-- A confirmed synthetic WeChat login email is not a verified contact email.
-- Keep email-gated features and reviewer checks limited to users with a real,
-- confirmed email address, even when requests reach these RPCs directly.

create or replace function public.campus_verified_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.campus_real_email_actor(p_actor);
$$;
revoke all on function public.campus_verified_actor(uuid) from public,anon,authenticated;
grant execute on function public.campus_verified_actor(uuid) to service_role;

create or replace function private.social_email_search(p_actor_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  if p_actor_id is null or not public.campus_real_email_actor(p_actor_id) then
    raise exception using message = 'SOCIAL_EMAIL_VERIFICATION_REQUIRED', errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object(
    'userId', profile.user_id,
    'nickname', profile.nickname,
    'school', profile.school
  ) into v_profile
  from auth.users target
  join public.social_profiles profile on profile.user_id = target.id
  where target.id <> p_actor_id
    and public.campus_real_email_actor(target.id)
    and pg_catalog.lower(pg_catalog.btrim(target.email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
    and profile.email_discoverable = true
    and not exists (
      select 1 from public.social_friendships friendship
      where friendship.user_low = least(p_actor_id, target.id)
        and friendship.user_high = greatest(p_actor_id, target.id)
    )
    and not exists (
      select 1 from public.social_friend_requests request
      where request.status = 'pending'
        and least(request.requester_id, request.recipient_id) = least(p_actor_id, target.id)
        and greatest(request.requester_id, request.recipient_id) = greatest(p_actor_id, target.id)
    )
  limit 1;
  return v_profile;
end;
$$;

create or replace function private.social_send_friend_request(p_actor uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.social_friend_requests%rowtype;
  v_id uuid;
  v_target_id uuid;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception using message = 'SOCIAL_INVALID_TARGET', errcode = '22023';
  end if;
  if not public.campus_real_email_actor(p_actor) then
    raise exception using message = 'SOCIAL_EMAIL_VERIFICATION_REQUIRED', errcode = '42501';
  end if;
  select profile.user_id into v_target_id
    from auth.users target
    join public.social_profiles profile on profile.user_id = target.id
    where target.id = p_target and public.campus_real_email_actor(target.id) and profile.email_discoverable = true
    for share of target, profile;
  if not found then
    raise exception using message = 'SOCIAL_TARGET_NOT_FOUND', errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.social_friendships friendship
    where friendship.user_low = least(p_actor, p_target) and friendship.user_high = greatest(p_actor, p_target)
  ) then
    return pg_catalog.jsonb_build_object('status', 'already_friends');
  end if;
  select * into v_request from public.social_friend_requests request
    where request.status = 'pending' and request.requester_id = p_target and request.recipient_id = p_actor
    for update;
  if found then
    update public.social_friend_requests set status = 'accepted', responded_at = pg_catalog.now(), updated_at = pg_catalog.now()
      where id = v_request.id;
    insert into public.social_friendships (user_low, user_high)
      values (least(p_actor, p_target), greatest(p_actor, p_target)) on conflict do nothing;
    perform private.social_notify(p_target, p_actor, 'friend_accepted', v_request.id);
    return pg_catalog.jsonb_build_object('status', 'accepted', 'requestId', v_request.id);
  end if;
  select * into v_request from public.social_friend_requests request
    where request.status = 'pending' and request.requester_id = p_actor and request.recipient_id = p_target
    limit 1;
  if found then
    return pg_catalog.jsonb_build_object('status', 'pending', 'requestId', v_request.id);
  end if;
  insert into public.social_friend_requests (requester_id, recipient_id)
    values (p_actor, p_target) returning id into v_id;
  perform private.social_notify(p_target, p_actor, 'friend_request', v_id);
  return pg_catalog.jsonb_build_object('status', 'pending', 'requestId', v_id);
exception when unique_violation then
  select request.id into v_id from public.social_friend_requests request
    where request.status = 'pending'
      and least(request.requester_id, request.recipient_id) = least(p_actor, p_target)
      and greatest(request.requester_id, request.recipient_id) = greatest(p_actor, p_target)
    limit 1;
  return pg_catalog.jsonb_build_object('status', 'pending', 'requestId', v_id);
end;
$$;
