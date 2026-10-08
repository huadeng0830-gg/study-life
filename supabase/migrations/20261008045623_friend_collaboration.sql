-- Friend discovery, private availability matching, invitations, and in-app notices.
-- All social rows are additive; account_sync_snapshots and its payload contract stay intact.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 32),
  school text not null default '' check (char_length(school) <= 100),
  email_discoverable boolean not null default false,
  timezone text not null default 'Asia/Shanghai' check (char_length(timezone) between 1 and 64),
  schedule_complete_through date,
  semester_end date,
  availability_preferences jsonb not null default '{"startTime":"09:00","endTime":"22:00","minimumMinutes":90,"classBufferMinutes":30,"includeWeekends":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profile_preferences_object check (jsonb_typeof(availability_preferences) = 'object')
);

create table public.social_friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint social_friend_request_distinct_users check (requester_id <> recipient_id)
);
create unique index social_friend_requests_one_pending_pair
  on public.social_friend_requests (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status = 'pending';
create index social_friend_requests_recipient_pending
  on public.social_friend_requests (recipient_id, created_at desc) where status = 'pending';
create index social_friend_requests_requester_recent
  on public.social_friend_requests (requester_id, created_at desc);

create table public.social_friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint social_friendship_canonical_pair check (user_low < user_high)
);
create index social_friendships_high_user on public.social_friendships (user_high, user_low);

create table public.social_invitations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (activity_type in ('meal', 'movie', 'sports', 'outing', 'custom')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 160),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'change_proposed', 'confirmed', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_invitation_positive_range check (ends_at > starts_at)
);
create index social_invitations_status_time on public.social_invitations (status, starts_at, ends_at);
create index social_invitations_expiry on public.social_invitations (expires_at) where status in ('pending', 'change_proposed');

-- Participant rows keep the first release pair-only while leaving the persisted
-- shape ready for a later group invitation without adding a second invite model.
create table public.social_invitation_participants (
  invitation_id uuid not null references public.social_invitations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  proposal_rounds integer not null default 0 check (proposal_rounds between 0 and 1),
  responded_at timestamptz,
  primary key (invitation_id, user_id),
  constraint social_invitation_participant_proposal_pair check (
    (proposed_starts_at is null and proposed_ends_at is null)
    or (proposed_starts_at is not null and proposed_ends_at is not null and proposed_ends_at > proposed_starts_at)
  )
);
create index social_invitation_participants_user_recent
  on public.social_invitation_participants (user_id, invitation_id);

create table public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'friend_removed', 'invitation', 'invitation_updated', 'invitation_cancelled', 'invitation_expired')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index social_notifications_unread_recent
  on public.social_notifications (recipient_id, created_at desc) where read_at is null;

create table private.social_rate_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('email_search', 'availability_query', 'friend_request', 'invitation')),
  bucket_start timestamptz not null,
  hits integer not null default 0 check (hits > 0),
  primary key (user_id, action, bucket_start)
);
revoke all on all tables in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;

alter table public.social_profiles enable row level security;
alter table public.social_friend_requests enable row level security;
alter table public.social_friendships enable row level security;
alter table public.social_invitations enable row level security;
alter table public.social_invitation_participants enable row level security;
alter table public.social_notifications enable row level security;

create policy social_profiles_select_owner on public.social_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy social_profiles_insert_owner on public.social_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy social_profiles_update_owner on public.social_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy social_friend_requests_select_participants on public.social_friend_requests
  for select to authenticated using ((select auth.uid()) in (requester_id, recipient_id));
create policy social_friendships_select_members on public.social_friendships
  for select to authenticated using ((select auth.uid()) in (user_low, user_high));
create policy social_invitations_select_participants on public.social_invitations
  for select to authenticated using (
    exists (
      select 1 from public.social_invitation_participants participant
      where participant.invitation_id = id and participant.user_id = (select auth.uid())
    )
  );
create policy social_invitation_participants_select_owner on public.social_invitation_participants
  for select to authenticated using ((select auth.uid()) = user_id);
create policy social_notifications_select_recipient on public.social_notifications
  for select to authenticated using ((select auth.uid()) = recipient_id);
create policy social_notifications_update_recipient on public.social_notifications
  for update to authenticated using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id);

-- New Supabase projects may not auto-expose public tables through the Data API.
-- Grant read-only access for social rows, owner writes for profiles, and only
-- read_at updates for notifications. All relationship/invitation mutations go
-- through the authenticated Edge Function and the service-only dispatcher.
grant select, insert, update on public.social_profiles to authenticated;
grant select on public.social_friend_requests to authenticated;
grant select on public.social_friendships to authenticated;
grant select on public.social_invitations to authenticated;
grant select on public.social_invitation_participants to authenticated;
grant select on public.social_notifications to authenticated;
grant update (read_at) on public.social_notifications to authenticated;
grant all on public.social_profiles, public.social_friend_requests, public.social_friendships,
  public.social_invitations, public.social_invitation_participants, public.social_notifications to service_role;
revoke all on public.social_profiles, public.social_friend_requests, public.social_friendships,
  public.social_invitations, public.social_invitation_participants, public.social_notifications
  from anon;
revoke insert, update, delete on public.social_friend_requests, public.social_friendships,
  public.social_invitations, public.social_invitation_participants from authenticated;

create or replace function private.social_take_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 600), 3600));
  v_bucket timestamptz;
  v_hits integer;
begin
  if p_user_id is null or p_action not in ('email_search', 'availability_query', 'friend_request', 'invitation') then
    return false;
  end if;
  v_bucket := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / v_window) * v_window
  );
  insert into private.social_rate_buckets (user_id, action, bucket_start, hits)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket_start)
  do update set hits = private.social_rate_buckets.hits + 1
  returning hits into v_hits;
  delete from private.social_rate_buckets
    where user_id = p_user_id and bucket_start < pg_catalog.clock_timestamp() - interval '1 day';
  return v_hits <= greatest(1, coalesce(p_limit, 1));
end;
$$;

create or replace function private.social_email_search(p_actor_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
begin
  if p_actor_id is null or not exists (
    select 1 from auth.users current_user_row
    where current_user_row.id = p_actor_id and current_user_row.email_confirmed_at is not null
  ) then
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
    and target.email_confirmed_at is not null
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

create or replace function private.social_notify(
  p_recipient uuid,
  p_actor uuid,
  p_kind text,
  p_resource uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.social_notifications (recipient_id, actor_id, kind, resource_id)
  values (p_recipient, p_actor, p_kind, p_resource);
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
  if not exists (select 1 from auth.users u where u.id = p_actor and u.email_confirmed_at is not null) then
    raise exception using message = 'SOCIAL_EMAIL_VERIFICATION_REQUIRED', errcode = '42501';
  end if;
  select profile.user_id into v_target_id
    from auth.users target
    join public.social_profiles profile on profile.user_id = target.id
    where target.id = p_target and target.email_confirmed_at is not null and profile.email_discoverable = true
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

create or replace function private.social_respond_friend_request(p_actor uuid, p_request_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.social_friend_requests%rowtype;
  v_next text;
begin
  if p_decision not in ('accept', 'reject', 'withdraw') then
    raise exception using message = 'SOCIAL_INVALID_ACTION', errcode = '22023';
  end if;
  select * into v_request from public.social_friend_requests request
    where request.id = p_request_id and request.status = 'pending'
      and ((p_decision = 'withdraw' and request.requester_id = p_actor)
        or (p_decision <> 'withdraw' and request.recipient_id = p_actor))
    for update;
  if not found then
    raise exception using message = 'SOCIAL_REQUEST_NOT_FOUND', errcode = 'P0002';
  end if;
  v_next := case p_decision when 'accept' then 'accepted' when 'reject' then 'rejected' else 'withdrawn' end;
  update public.social_friend_requests
    set status = v_next, responded_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = p_request_id;
  if p_decision = 'accept' then
    insert into public.social_friendships (user_low, user_high)
      values (least(v_request.requester_id, v_request.recipient_id), greatest(v_request.requester_id, v_request.recipient_id))
      on conflict do nothing;
    perform private.social_notify(v_request.requester_id, p_actor, 'friend_accepted', p_request_id);
  elsif p_decision = 'reject' then
  end if;
  return pg_catalog.jsonb_build_object('status', v_next, 'requestId', p_request_id);
end;
$$;

create or replace function private.social_remove_friend(p_actor uuid, p_friend uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low uuid := least(p_actor, p_friend);
  v_high uuid := greatest(p_actor, p_friend);
  v_invitation record;
begin
  if p_actor is null or p_friend is null or p_actor = p_friend then
    raise exception using message = 'SOCIAL_INVALID_TARGET', errcode = '22023';
  end if;
  for v_invitation in
    select invitation.id
    from public.social_invitations invitation
    where invitation.status in ('pending', 'change_proposed', 'confirmed')
      and exists (select 1 from public.social_invitation_participants p where p.invitation_id = invitation.id and p.user_id = p_actor)
      and exists (select 1 from public.social_invitation_participants p where p.invitation_id = invitation.id and p.user_id = p_friend)
    for update
  loop
    update public.social_invitations set status = 'cancelled', updated_at = pg_catalog.now(), revision = revision + 1
      where id = v_invitation.id;
    perform private.social_notify(p_friend, p_actor, 'invitation_cancelled', v_invitation.id);
  end loop;
  delete from public.social_friendships where user_low = v_low and user_high = v_high;
  if not found then
    raise exception using message = 'SOCIAL_FRIEND_NOT_FOUND', errcode = 'P0002';
  end if;
  perform private.social_notify(p_friend, p_actor, 'friend_removed', p_actor);
  return pg_catalog.jsonb_build_object('status', 'removed');
end;
$$;

create or replace function private.social_assert_schedule_revisions(p_user_ids uuid[], p_expected jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_actual bigint;
  v_expected_entry jsonb;
  v_expected_revision bigint;
  v_actual_profile_updated_at timestamptz;
  v_expected_profile_updated_at timestamptz;
begin
  for v_user in select distinct user_id from pg_catalog.unnest(p_user_ids) as ids(user_id) order by user_id loop
    select profile.updated_at into v_actual_profile_updated_at
      from public.social_profiles profile where profile.user_id = v_user for update;
    if not found then
      raise exception using message = 'SOCIAL_PROFILE_REQUIRED', errcode = 'P0002';
    end if;
    select snapshot.revision into v_actual from public.account_sync_snapshots snapshot
      where snapshot.user_id = v_user for update;
    if not found then
      raise exception using message = 'SOCIAL_SCHEDULE_UNKNOWN', errcode = 'P0002';
    end if;
    begin
      v_expected_entry := p_expected -> v_user::text;
      v_expected_revision := (v_expected_entry ->> 'revision')::bigint;
      v_expected_profile_updated_at := (v_expected_entry ->> 'profileUpdatedAt')::timestamptz;
    exception when others then
      v_expected_revision := null;
      v_expected_profile_updated_at := null;
    end;
    if v_expected_revision is null or v_actual <> v_expected_revision
        or v_expected_profile_updated_at is null or v_actual_profile_updated_at <> v_expected_profile_updated_at then
      raise exception using message = 'SOCIAL_SCHEDULE_STALE', errcode = '40001';
    end if;
  end loop;
end;
$$;

create or replace function private.social_assert_no_invite_overlap(p_user_ids uuid[], p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  -- Serialize checks per participant so different invitations cannot
  -- concurrently confirm overlapping times for the same person.
  for v_user in
    select distinct user_id from pg_catalog.unnest(p_user_ids) as ids(user_id) order by user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  end loop;
  if exists (
    select 1
    from public.social_invitations invitation
    join public.social_invitation_participants participant on participant.invitation_id = invitation.id
    where invitation.status = 'confirmed'
      and participant.user_id = any(p_user_ids)
      and invitation.id is distinct from p_exclude
      and invitation.starts_at < p_end and invitation.ends_at > p_start
  ) then
    raise exception using message = 'SOCIAL_INVITATION_CONFLICT', errcode = '23P01';
  end if;
end;
$$;

create or replace function private.social_create_invitation(p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest uuid := (p_payload ->> 'guestId')::uuid;
  v_start timestamptz := (p_payload ->> 'startsAt')::timestamptz;
  v_end timestamptz := (p_payload ->> 'endsAt')::timestamptz;
  v_kind text := p_payload ->> 'activityType';
  v_title text := pg_catalog.btrim(p_payload ->> 'title');
  v_location text := coalesce(p_payload ->> 'location', '');
  v_note text := coalesce(p_payload ->> 'note', '');
  v_id uuid;
  v_revisions jsonb := p_payload -> 'revisions';
begin
  if v_guest is null or v_guest = p_actor or v_start is null or v_end is null or v_end <= v_start
      or v_start <= pg_catalog.now() or v_end - v_start > interval '12 hours'
      or coalesce(v_kind, '') not in ('meal', 'movie', 'sports', 'outing', 'custom')
      or coalesce(pg_catalog.char_length(v_title), 0) not between 1 and 80
      or pg_catalog.char_length(v_location) > 160 or pg_catalog.char_length(v_note) > 500 then
    raise exception using message = 'SOCIAL_INVALID_INVITATION', errcode = '22023';
  end if;
  perform 1 from public.social_friendships friendship
    where friendship.user_low = least(p_actor, v_guest) and friendship.user_high = greatest(p_actor, v_guest)
    for update;
  if not found then
    raise exception using message = 'SOCIAL_FRIENDSHIP_REQUIRED', errcode = '42501';
  end if;
  if not exists (
    select 1 from public.social_profiles profile where profile.user_id = v_guest
  ) then
    raise exception using message = 'SOCIAL_PROFILE_REQUIRED', errcode = 'P0002';
  end if;
  perform private.social_assert_schedule_revisions(array[p_actor, v_guest], v_revisions);
  perform private.social_assert_no_invite_overlap(array[p_actor, v_guest], v_start, v_end);
  insert into public.social_invitations (
    created_by, activity_type, title, starts_at, ends_at, location, note, expires_at
  ) values (
    p_actor, v_kind, v_title, v_start, v_end, v_location, v_note,
    least(v_start, pg_catalog.now() + interval '48 hours')
  ) returning id into v_id;
  insert into public.social_invitation_participants (invitation_id, user_id, role, status)
    values (v_id, p_actor, 'host', 'accepted'), (v_id, v_guest, 'guest', 'pending');
  perform private.social_notify(v_guest, p_actor, 'invitation', v_id);
  return pg_catalog.jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

create or replace function private.social_respond_invitation(p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_payload ->> 'invitationId')::uuid;
  v_action text := p_payload ->> 'decision';
  v_invitation public.social_invitations%rowtype;
  v_self public.social_invitation_participants%rowtype;
  v_other public.social_invitation_participants%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_expected jsonb := p_payload -> 'revisions';
  v_next text;
begin
  select * into v_invitation from public.social_invitations where id = v_id for update;
  if not found then raise exception using message = 'SOCIAL_INVITATION_NOT_FOUND', errcode = 'P0002'; end if;
  select * into v_self from public.social_invitation_participants where invitation_id = v_id and user_id = p_actor for update;
  if not found then raise exception using message = 'SOCIAL_INVITATION_NOT_FOUND', errcode = '42501'; end if;
  select * into v_other from public.social_invitation_participants where invitation_id = v_id and user_id <> p_actor limit 1;
  if not found then raise exception using message = 'SOCIAL_INVITATION_INVALID', errcode = 'P0002'; end if;

  if v_invitation.status in ('pending', 'change_proposed')
      and (v_invitation.expires_at <= pg_catalog.now() or v_invitation.starts_at <= pg_catalog.now()) then
    raise exception using message = 'SOCIAL_INVITATION_STATE_CHANGED', errcode = '40001';
  end if;

  if v_action = 'accept' then
    if v_self.role <> 'guest' or v_invitation.status <> 'pending' then
      raise exception using message = 'SOCIAL_INVITATION_STATE_CHANGED', errcode = '40001';
    end if;
    perform private.social_assert_schedule_revisions(array[p_actor, v_other.user_id], v_expected);
    perform private.social_assert_no_invite_overlap(array[p_actor, v_other.user_id], v_invitation.starts_at, v_invitation.ends_at, v_id);
    update public.social_invitation_participants set status = 'accepted', responded_at = pg_catalog.now()
      where invitation_id = v_id and user_id = p_actor;
    v_next := 'confirmed';
  elsif v_action = 'decline' then
    if v_self.role <> 'guest' or v_invitation.status <> 'pending' then
      raise exception using message = 'SOCIAL_INVITATION_STATE_CHANGED', errcode = '40001';
    end if;
    update public.social_invitation_participants set status = 'declined', responded_at = pg_catalog.now()
      where invitation_id = v_id and user_id = p_actor;
    v_next := 'declined';
  elsif v_action = 'propose_change' then
    v_start := (p_payload ->> 'startsAt')::timestamptz;
    v_end := (p_payload ->> 'endsAt')::timestamptz;
    if v_self.role <> 'guest' or v_invitation.status <> 'pending' or v_self.proposal_rounds >= 1 or v_start is null or v_end is null
        or v_start <= pg_catalog.now() or v_end <= v_start or v_end - v_start > interval '12 hours' then
      raise exception using message = 'SOCIAL_INVALID_PROPOSAL', errcode = '22023';
    end if;
    perform private.social_assert_schedule_revisions(array[p_actor, v_other.user_id], v_expected);
    perform private.social_assert_no_invite_overlap(array[p_actor, v_other.user_id], v_start, v_end, v_id);
    update public.social_invitation_participants
      set proposed_starts_at = v_start, proposed_ends_at = v_end, proposal_rounds = proposal_rounds + 1, responded_at = pg_catalog.now()
      where invitation_id = v_id and user_id = p_actor;
    v_next := 'change_proposed';
  elsif v_action = 'accept_change' then
    if v_self.role <> 'host' or v_invitation.status <> 'change_proposed'
        or v_other.proposed_starts_at is null or v_other.proposed_ends_at is null then
      raise exception using message = 'SOCIAL_INVITATION_STATE_CHANGED', errcode = '40001';
    end if;
    perform private.social_assert_schedule_revisions(array[p_actor, v_other.user_id], v_expected);
    perform private.social_assert_no_invite_overlap(array[p_actor, v_other.user_id], v_other.proposed_starts_at, v_other.proposed_ends_at, v_id);
    update public.social_invitations set starts_at = v_other.proposed_starts_at, ends_at = v_other.proposed_ends_at,
      status = 'confirmed', revision = revision + 1, updated_at = pg_catalog.now() where id = v_id;
    update public.social_invitation_participants set status = 'accepted', proposed_starts_at = null,
      proposed_ends_at = null, responded_at = pg_catalog.now() where invitation_id = v_id;
    perform private.social_notify(v_other.user_id, p_actor, 'invitation_updated', v_id);
    return pg_catalog.jsonb_build_object('id', v_id, 'status', 'confirmed');
  elsif v_action = 'reject_change' then
    if v_self.role <> 'host' or v_invitation.status <> 'change_proposed' then
      raise exception using message = 'SOCIAL_INVITATION_STATE_CHANGED', errcode = '40001';
    end if;
    update public.social_invitation_participants set proposed_starts_at = null, proposed_ends_at = null,
      responded_at = pg_catalog.now() where invitation_id = v_id and user_id = v_other.user_id;
    v_next := 'pending';
  else
    raise exception using message = 'SOCIAL_INVALID_ACTION', errcode = '22023';
  end if;

  update public.social_invitations set status = v_next, revision = revision + 1, updated_at = pg_catalog.now() where id = v_id;
  perform private.social_notify(v_other.user_id, p_actor, 'invitation_updated', v_id);
  return pg_catalog.jsonb_build_object('id', v_id, 'status', v_next);
end;
$$;

create or replace function private.social_cancel_invitation(p_actor uuid, p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.social_invitations%rowtype;
  v_other uuid;
begin
  select invitation.* into v_invitation from public.social_invitations invitation
    where invitation.id = p_invitation_id and invitation.status in ('pending', 'change_proposed', 'confirmed')
      and exists (select 1 from public.social_invitation_participants p where p.invitation_id = invitation.id and p.user_id = p_actor)
    for update;
  if not found then raise exception using message = 'SOCIAL_INVITATION_NOT_FOUND', errcode = 'P0002'; end if;
  select user_id into v_other from public.social_invitation_participants
    where invitation_id = p_invitation_id and user_id <> p_actor limit 1;
  update public.social_invitations set status = 'cancelled', revision = revision + 1, updated_at = pg_catalog.now()
    where id = p_invitation_id;
  update public.social_invitation_participants set proposed_starts_at = null, proposed_ends_at = null
    where invitation_id = p_invitation_id;
  perform private.social_notify(v_other, p_actor, 'invitation_cancelled', p_invitation_id);
  return pg_catalog.jsonb_build_object('id', p_invitation_id, 'status', 'cancelled');
end;
$$;

create or replace function private.social_expire_invitations(p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_count integer := 0;
  v_other uuid;
begin
  for v_item in
    select invitation.id, participant.user_id as actor_id
    from public.social_invitations invitation
    join public.social_invitation_participants participant on participant.invitation_id = invitation.id
    where invitation.status in ('pending', 'change_proposed')
      and (invitation.expires_at <= pg_catalog.now() or invitation.starts_at <= pg_catalog.now())
      and participant.user_id = p_actor
    for update of invitation
  loop
    update public.social_invitations set status = 'expired', revision = revision + 1, updated_at = pg_catalog.now()
      where id = v_item.id and status in ('pending', 'change_proposed');
    if found then
      select user_id into v_other from public.social_invitation_participants
        where invitation_id = v_item.id and user_id <> p_actor limit 1;
      perform private.social_notify(v_other, null, 'invitation_expired', v_item.id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- One non-public-by-privilege Data API RPC is the only entry into privileged
-- helpers. The Edge Function validates the Supabase user JWT before calling it.
create or replace function public.social_dispatch(p_action text, p_actor_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_actor_id is null or p_action is null then
    raise exception using message = 'SOCIAL_INVALID_REQUEST', errcode = '22023';
  end if;
  case p_action
    when 'email_search' then
      v_allowed := private.social_take_rate_limit(p_actor_id, 'email_search', 12, 600);
      if not v_allowed then raise exception using message = 'SOCIAL_RATE_LIMIT', errcode = '54000'; end if;
      return pg_catalog.jsonb_build_object('profile', private.social_email_search(p_actor_id, p_payload ->> 'email'));
    when 'availability_rate_limit' then
      v_allowed := private.social_take_rate_limit(p_actor_id, 'availability_query', 60, 600);
      if not v_allowed then raise exception using message = 'SOCIAL_RATE_LIMIT', errcode = '54000'; end if;
      return pg_catalog.jsonb_build_object('allowed', true);
    when 'send_friend_request' then
      v_allowed := private.social_take_rate_limit(p_actor_id, 'friend_request', 10, 600);
      if not v_allowed then raise exception using message = 'SOCIAL_RATE_LIMIT', errcode = '54000'; end if;
      return private.social_send_friend_request(p_actor_id, (p_payload ->> 'targetId')::uuid);
    when 'respond_friend_request' then return private.social_respond_friend_request(p_actor_id, (p_payload ->> 'requestId')::uuid, p_payload ->> 'decision');
    when 'remove_friend' then return private.social_remove_friend(p_actor_id, (p_payload ->> 'friendId')::uuid);
    when 'create_invitation' then
      v_allowed := private.social_take_rate_limit(p_actor_id, 'invitation', 30, 600);
      if not v_allowed then raise exception using message = 'SOCIAL_RATE_LIMIT', errcode = '54000'; end if;
      return private.social_create_invitation(p_actor_id, p_payload);
    when 'respond_invitation' then
      v_allowed := private.social_take_rate_limit(p_actor_id, 'invitation', 30, 600);
      if not v_allowed then raise exception using message = 'SOCIAL_RATE_LIMIT', errcode = '54000'; end if;
      return private.social_respond_invitation(p_actor_id, p_payload);
    when 'cancel_invitation' then return private.social_cancel_invitation(p_actor_id, (p_payload ->> 'invitationId')::uuid);
    when 'expire_invitations' then return pg_catalog.jsonb_build_object('expired', private.social_expire_invitations(p_actor_id));
    else raise exception using message = 'SOCIAL_INVALID_ACTION', errcode = '22023';
  end case;
end;
$$;

revoke all on function public.social_dispatch(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.social_dispatch(text, uuid, jsonb) to service_role;

grant execute on function private.social_take_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function private.social_email_search(uuid, text) to service_role;
grant execute on function private.social_notify(uuid, uuid, text, uuid) to service_role;
grant execute on function private.social_send_friend_request(uuid, uuid) to service_role;
grant execute on function private.social_respond_friend_request(uuid, uuid, text) to service_role;
grant execute on function private.social_remove_friend(uuid, uuid) to service_role;
grant execute on function private.social_assert_schedule_revisions(uuid[], jsonb) to service_role;
grant execute on function private.social_assert_no_invite_overlap(uuid[], timestamptz, timestamptz, uuid) to service_role;
grant execute on function private.social_create_invitation(uuid, jsonb) to service_role;
grant execute on function private.social_respond_invitation(uuid, jsonb) to service_role;
grant execute on function private.social_cancel_invitation(uuid, uuid) to service_role;
grant execute on function private.social_expire_invitations(uuid) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.social_notifications';
  end if;
end;
$$;
