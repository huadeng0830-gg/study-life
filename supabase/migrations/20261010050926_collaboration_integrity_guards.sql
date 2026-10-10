-- Use the same participant lock for social invitations and project meetings.
-- Existing rows are retained; only subsequent confirmations are validated.
create or replace function qixing_private.calendar_has_overlap(
  p_user_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_invitation uuid default null,
  p_exclude_meeting uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct user_id from pg_catalog.unnest(p_user_ids) as ids(user_id)
      where user_id is not null order by user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  end loop;
  return exists (
    select 1 from public.social_invitations invitation
    join public.social_invitation_participants participant on participant.invitation_id = invitation.id
    where invitation.status = 'confirmed'
      and participant.user_id = any(p_user_ids)
      and invitation.id is distinct from p_exclude_invitation
      and invitation.starts_at < p_end and invitation.ends_at > p_start
  ) or exists (
    select 1 from public.team_project_meetings meeting
    join public.team_project_meeting_participants participant on participant.meeting_id = meeting.id
    where meeting.status = 'confirmed' and participant.status = 'accepted'
      and participant.user_id = any(p_user_ids)
      and meeting.id is distinct from p_exclude_meeting
      and meeting.starts_at < p_end and meeting.ends_at > p_start
  );
end;
$$;
revoke all on function qixing_private.calendar_has_overlap(uuid[], timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function qixing_private.calendar_has_overlap(uuid[], timestamptz, timestamptz, uuid, uuid) to service_role;

create or replace function private.social_assert_no_invite_overlap(
  p_user_ids uuid[], p_start timestamptz, p_end timestamptz, p_exclude uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if qixing_private.calendar_has_overlap(p_user_ids, p_start, p_end, p_exclude, null) then
    raise exception using message = 'SOCIAL_INVITATION_CONFLICT', errcode = '23P01';
  end if;
end;
$$;
revoke all on function private.social_assert_no_invite_overlap(uuid[], timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function private.social_assert_no_invite_overlap(uuid[], timestamptz, timestamptz, uuid) to service_role;

create or replace function qixing_private.guard_meeting_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_ids uuid[];
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed'
    and old.starts_at = new.starts_at and old.ends_at = new.ends_at then
    return new;
  end if;
  select pg_catalog.array_agg(participant.user_id order by participant.user_id) into v_user_ids
    from public.team_project_meeting_participants participant
    where participant.meeting_id = new.id and participant.status = 'accepted';
  if qixing_private.calendar_has_overlap(v_user_ids, new.starts_at, new.ends_at, null, new.id) then
    raise exception using message = 'QIXING_MEETING_SLOT_CONFLICT', errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function qixing_private.guard_meeting_calendar() from public, anon, authenticated, service_role;
create trigger team_project_meeting_calendar_guard
  before insert or update of status, starts_at, ends_at on public.team_project_meetings
  for each row execute function qixing_private.guard_meeting_calendar();

-- Every task status writer, including submission/review, shares the same
-- dependency invariant. A rejected submission rolls back its version as well.
create or replace function qixing_private.guard_task_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status
    and old.depends_on_task_id is not distinct from new.depends_on_task_id then
    return new;
  end if;
  if new.status <> 'todo' and new.depends_on_task_id is not null
    and not exists (
      select 1 from public.team_project_tasks prerequisite
      where prerequisite.id = new.depends_on_task_id and prerequisite.project_id = new.project_id
        and prerequisite.status = 'completed'
    ) then
    raise exception using message = 'QIXING_TASK_DEPENDENCY_BLOCKED', errcode = '40001';
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed'
    and exists (
      select 1 from public.team_project_tasks dependent
      where dependent.project_id = new.project_id and dependent.depends_on_task_id = new.id
        and dependent.status = 'completed'
    ) then
    raise exception using message = 'QIXING_TASK_DEPENDENCY_IN_USE', errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function qixing_private.guard_task_dependency() from public, anon, authenticated, service_role;
create trigger team_project_task_dependency_guard
  before insert or update of status, depends_on_task_id on public.team_project_tasks
  for each row execute function qixing_private.guard_task_dependency();

-- Retain the existing RPC contract and implementation. Reserve the project
-- before locking task/deliverable rows, so personal sync and reviews cannot
-- race prerequisite changes or acquire these locks in opposite orders.
alter function public.project_dispatch(text, uuid, jsonb) set schema qixing_private;
alter function qixing_private.project_dispatch(text, uuid, jsonb) rename to project_dispatch_core;
revoke all on function qixing_private.project_dispatch_core(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function qixing_private.project_dispatch_core(text, uuid, jsonb) to service_role;

create or replace function public.project_dispatch(
  p_action text, p_actor_id uuid, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is not null and p_payload ? 'projectId'
    and p_action not in (
      'list', 'inbox', 'detail', 'time_members', 'meetings_list', 'invite_links',
      'task_events', 'adjustments_list', 'deliverables'
    ) then
    perform 1 from public.team_projects where id = (p_payload ->> 'projectId')::uuid for update;
  end if;
  return qixing_private.project_dispatch_core(p_action, p_actor_id, p_payload);
end;
$$;
revoke all on function public.project_dispatch(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.project_dispatch(text, uuid, jsonb) to service_role;
