-- Keep resumable project-task notes in the existing append-only task timeline.
-- This is additive: no project rows are rewritten and no existing event is removed.
create or replace function public.project_task_checkpoints(
  p_actor_id uuid,
  p_project_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text;
  v_checkpoints jsonb;
begin
  if p_actor_id is null or p_project_id is null then
    raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
  end if;

  select member.role into v_role
    from public.team_project_members member
    where member.project_id = p_project_id and member.user_id = p_actor_id and member.status = 'active';
  if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'taskId', latest.task_id,
    'checkpoint', latest.details -> 'workCheckpoint',
    'updatedAt', latest.created_at,
    'actorName', coalesce(nullif(profile.nickname, ''), '成员')
  ) order by latest.created_at desc, latest.event_id desc), '[]'::jsonb)
    into v_checkpoints
    from (
      select distinct on (event.task_id)
        event.task_id, event.details, event.created_at, event.id as event_id, event.actor_id
      from public.team_project_task_events event
      join public.team_project_tasks task on task.id = event.task_id and task.project_id = event.project_id
      where event.project_id = p_project_id
        and event.details ->> 'source' = 'workbench'
        and pg_catalog.jsonb_typeof(event.details -> 'workCheckpoint') = 'object'
      order by event.task_id, event.created_at desc, event.id desc
    ) latest
    left join public.social_profiles profile on profile.user_id = latest.actor_id;

  return pg_catalog.jsonb_build_object('checkpoints', v_checkpoints);
end;
$$;

create or replace function public.project_task_checkpoint_save(
  p_actor_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_checkpoint jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text;
  v_task public.team_project_tasks%rowtype;
  v_latest_updated_at timestamptz;
  v_created_at timestamptz;
begin
  if p_actor_id is null or p_project_id is null or p_task_id is null
    or pg_catalog.jsonb_typeof(p_checkpoint) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_checkpoint -> 'lastStep') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_checkpoint -> 'blocker') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_checkpoint -> 'nextStep') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_checkpoint -> 'resources') is distinct from 'array' then
    raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023';
  end if;

  if pg_catalog.char_length(coalesce(p_checkpoint ->> 'lastStep', '')) > 1000
    or pg_catalog.char_length(coalesce(p_checkpoint ->> 'blocker', '')) > 1000
    or pg_catalog.char_length(coalesce(p_checkpoint ->> 'nextStep', '')) > 1000
    or pg_catalog.jsonb_array_length(p_checkpoint -> 'resources') > 12 then
    raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_checkpoint -> 'resources') as items(value)
    where pg_catalog.jsonb_typeof(items.value) is distinct from 'string'
      or (items.value #>> '{}') !~* '^https?://[^/@[:space:]]+($|[/#?])'
      or pg_catalog.char_length(items.value #>> '{}') > 2048
  ) then
    raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023';
  end if;

  select member.role into v_role
    from public.team_project_members member
    where member.project_id = p_project_id and member.user_id = p_actor_id and member.status = 'active';
  if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
  if not exists(select 1 from public.team_projects where id = p_project_id and status = 'active') then
    raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
  end if;

  select * into v_task
    from public.team_project_tasks
    where id = p_task_id and project_id = p_project_id
    for update;
  if not found then raise exception using message = 'QIXING_TASK_NOT_FOUND', errcode = 'P0002'; end if;
  if v_task.status = 'completed'
    or (v_role not in ('owner', 'admin')
      and (v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted')) then
    raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501';
  end if;

  select event.created_at into v_latest_updated_at
    from public.team_project_task_events event
    where event.project_id = p_project_id and event.task_id = p_task_id
      and event.details ->> 'source' = 'workbench'
      and pg_catalog.jsonb_typeof(event.details -> 'workCheckpoint') = 'object'
    order by event.created_at desc, event.id desc
    limit 1;
  if v_latest_updated_at is distinct from p_expected_updated_at then
    raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
  end if;

  insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
    values (p_project_id, p_task_id, p_actor_id, 'updated',
      pg_catalog.jsonb_build_object('source', 'workbench', 'workCheckpoint', p_checkpoint))
    returning created_at into v_created_at;

  return pg_catalog.jsonb_build_object('taskId', p_task_id, 'updatedAt', v_created_at);
end;
$$;

revoke all on function public.project_task_checkpoints(uuid, uuid) from public, anon, authenticated;
revoke all on function public.project_task_checkpoint_save(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.project_task_checkpoints(uuid, uuid) to service_role;
grant execute on function public.project_task_checkpoint_save(uuid, uuid, uuid, jsonb, timestamptz) to service_role;
