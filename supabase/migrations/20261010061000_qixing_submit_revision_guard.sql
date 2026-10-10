-- Bind a submitted version to the draft the caller actually saved/viewed.
-- Preserve legacy clients and the existing project-before-resource lock order.
create or replace function public.project_dispatch(
  p_action text, p_actor_id uuid, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision integer;
begin
  if p_actor_id is not null and p_payload ? 'projectId'
    and p_action not in (
      'list', 'inbox', 'detail', 'time_members', 'meetings_list', 'invite_links',
      'task_events', 'adjustments_list', 'deliverables'
    ) then
    perform 1 from public.team_projects where id = (p_payload ->> 'projectId')::uuid for update;
  end if;

  if p_action = 'deliverable_submit' and p_payload ? 'expectedRevision'
    and exists(select 1 from public.team_project_members
      where project_id = (p_payload ->> 'projectId')::uuid and user_id = p_actor_id and status = 'active')
    and not exists(select 1 from public.team_project_result_versions
      where submission_key = (p_payload ->> 'submissionKey')::uuid) then
    if coalesce(p_payload ->> 'expectedRevision', '') !~ '^(0|[1-9][0-9]*)$' then
      raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
    end if;
    perform 1 from public.team_project_deliverables
      where id = (p_payload ->> 'deliverableId')::uuid and project_id = (p_payload ->> 'projectId')::uuid for update;
    select revision into v_revision from public.team_project_deliverable_drafts
      where deliverable_id = (p_payload ->> 'deliverableId')::uuid and user_id = p_actor_id for update;
    if found and v_revision <> (p_payload ->> 'expectedRevision')::integer then
      raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
    end if;
  end if;
  -- Existing-key retries still return the already frozen version, even after
  -- the draft changes. Authorization and key ownership remain in the core.
  return qixing_private.project_dispatch_core(p_action, p_actor_id, p_payload);
end;
$$;
revoke all on function public.project_dispatch(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.project_dispatch(text, uuid, jsonb) to service_role;
