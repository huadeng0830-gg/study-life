create or replace function public.project_dispatch(
  p_action text,
  p_actor_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_target_id uuid;
  v_owner_id uuid;
  v_task_id uuid;
  v_milestone_id uuid;
  v_dependency_id uuid;
  v_check_id uuid;
  v_meeting_id uuid;
  v_parent_id uuid;
  v_request_id uuid;
  v_deliverable_id uuid;
  v_version_id uuid;
  v_submission_key uuid;
  v_request_type text;
  v_request_data jsonb;
  v_content jsonb;
  v_item jsonb;
  v_expected_revision integer;
  v_version_number integer;
  v_request public.team_project_adjustment_requests%rowtype;
  v_deliverable public.team_project_deliverables%rowtype;
  v_draft public.team_project_deliverable_drafts%rowtype;
  v_result_version public.team_project_result_versions%rowtype;
  v_review public.team_project_reviews%rowtype;
  v_role text;
  v_target_role text;
  v_status text;
  v_decision text;
  v_name text;
  v_description text;
  v_type text;
  v_starts_on date;
  v_target_end_on date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_due_on date;
  v_priority text;
  v_assignment_status text;
  v_task_status text;
  v_subtask_title text;
  v_project public.team_projects%rowtype;
  v_task public.team_project_tasks%rowtype;
  v_milestone public.team_project_milestones%rowtype;
  v_check public.team_project_delivery_checks%rowtype;
  v_meeting public.team_project_meetings%rowtype;
  v_meeting_participant public.team_project_meeting_participants%rowtype;
  v_member public.team_project_members%rowtype;
  v_link public.team_project_invite_links%rowtype;
  v_json jsonb;
  v_milestones jsonb;
  v_delivery_checks jsonb;
  v_meetings jsonb;
  v_rows integer;
  v_has_assignee boolean;
  v_has_milestone boolean;
  v_has_dependency boolean;
begin
  if p_actor_id is null or p_action is null or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
  end if;

  case p_action
    when 'list' then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', project.id, 'ownerId', project.owner_id, 'name', project.name,
        'description', project.description, 'type', project.project_type,
        'startsOn', project.starts_on, 'targetEndOn', project.target_end_on,
        'status', project.status, 'revision', project.revision,
        'role', member.role, 'createdAt', project.created_at, 'updatedAt', project.updated_at
      ) order by project.updated_at desc), '[]'::jsonb)
      into v_json
      from public.team_projects project
      join public.team_project_members member on member.project_id = project.id
      where member.user_id = p_actor_id and member.status = 'active' and project.status <> 'deleted';
      return pg_catalog.jsonb_build_object('projects', v_json);

    when 'inbox' then
      select pg_catalog.jsonb_build_object(
        'invitations', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'projectId', project.id, 'projectName', project.name, 'type', project.project_type,
            'invitedBy', member.invited_by, 'invitedAt', member.invited_at
          ) order by member.invited_at desc)
          from public.team_project_members member
          join public.team_projects project on project.id = member.project_id
          where member.user_id = p_actor_id and member.status = 'invited' and project.status = 'active'
        ), '[]'::jsonb),
        'assignments', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'taskId', task.id, 'projectId', project.id, 'projectName', project.name,
            'title', task.title, 'dueOn', task.due_on, 'priority', task.priority,
            'createdAt', task.created_at
          ) order by task.due_on nulls last, task.created_at desc)
          from public.team_project_tasks task
          join public.team_projects project on project.id = task.project_id
          join public.team_project_members member on member.project_id = project.id and member.user_id = p_actor_id and member.status = 'active'
          where task.assignee_id = p_actor_id and task.assignment_status = 'pending'
            and task.status <> 'completed' and project.status = 'active'
        ), '[]'::jsonb),
        'adjustments', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'requestId', request.id, 'projectId', project.id, 'projectName', project.name,
            'taskId', task.id, 'taskTitle', task.title, 'type', request.request_type,
            'requesterName', coalesce(nullif(requester.nickname, ''), '成员'), 'reason', request.reason,
            'createdAt', request.created_at
          ) order by request.created_at desc)
          from public.team_project_adjustment_requests request
          join public.team_projects project on project.id = request.project_id and project.status = 'active'
          join public.team_project_members member on member.project_id = project.id and member.user_id = p_actor_id and member.status = 'active'
          join public.team_project_tasks task on task.id = request.task_id
          left join public.social_profiles requester on requester.user_id = request.requester_id
          where request.status = 'pending' and request.requester_id <> p_actor_id
            and (request.approver_id = p_actor_id or (request.approver_id is null and member.role in ('owner', 'admin')))
        ), '[]'::jsonb),
        'reviews', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'projectId', project.id, 'projectName', project.name, 'deliverableId', deliverable.id,
            'deliverableTitle', deliverable.title, 'taskId', task.id, 'taskTitle', task.title,
            'versionId', version.id, 'version', version.version_number,
            'submitterName', coalesce(nullif(submitter.nickname, ''), '成员'), 'createdAt', version.created_at
          ) order by version.created_at asc)
          from public.team_project_result_versions version
          join public.team_project_deliverables deliverable on deliverable.id = version.deliverable_id and deliverable.review_required
          join public.team_projects project on project.id = version.project_id and project.status = 'active'
          join public.team_project_members member on member.project_id = project.id and member.user_id = p_actor_id and member.status = 'active'
          left join public.team_project_tasks task on task.id = deliverable.task_id
          left join public.social_profiles submitter on submitter.user_id = version.submitted_by
          where version.review_status = 'pending' and version.submitted_by <> p_actor_id
            and (deliverable.reviewer_id = p_actor_id or (deliverable.reviewer_id is null and member.role in ('owner', 'admin')))
        ), '[]'::jsonb),
        'meetings', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'meetingId', meeting.id, 'projectId', project.id, 'projectName', project.name,
            'title', meeting.title, 'startsAt', meeting.starts_at, 'endsAt', meeting.ends_at,
            'status', meeting.status, 'participantStatus', participant.status, 'createdBy', meeting.created_by
          ) order by meeting.starts_at)
          from public.team_project_meeting_participants participant
          join public.team_project_meetings meeting on meeting.id = participant.meeting_id and meeting.status = 'open'
          join public.team_projects project on project.id = meeting.project_id and project.status = 'active'
          join public.team_project_members member on member.project_id = project.id and member.user_id = p_actor_id and member.status = 'active'
          where (participant.user_id = p_actor_id and participant.status = 'invited')
            or (participant.status = 'proposed' and meeting.created_by = p_actor_id)
        ), '[]'::jsonb)
      ) into v_json;
      return v_json;

    when 'time_members' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'userId', member.user_id, 'nickname', coalesce(nullif(profile.nickname, ''), '成员'), 'role', member.role
      ) order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end, member.joined_at), '[]'::jsonb)
        into v_json
        from public.team_project_members member
        left join public.social_profiles profile on profile.user_id = member.user_id
        where member.project_id = v_project_id and member.status = 'active';
      return pg_catalog.jsonb_build_object('members', v_json);

    when 'meetings_list' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', meeting.id, 'title', meeting.title, 'note', meeting.note, 'startsAt', meeting.starts_at,
        'endsAt', meeting.ends_at, 'status', meeting.status, 'revision', meeting.revision,
        'createdBy', meeting.created_by, 'createdAt', meeting.created_at,
        'participants', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'userId', participant.user_id, 'nickname', coalesce(nullif(profile.nickname, ''), '成员'),
            'status', participant.status, 'proposedStartsAt', participant.proposed_starts_at,
            'proposedEndsAt', participant.proposed_ends_at, 'respondedAt', participant.responded_at
          ) order by case when participant.user_id = meeting.created_by then 0 else 1 end, participant.user_id)
          from public.team_project_meeting_participants participant
          join public.team_project_members member on member.project_id = v_project_id and member.user_id = participant.user_id and member.status = 'active'
          left join public.social_profiles profile on profile.user_id = participant.user_id
          where participant.meeting_id = meeting.id
        ), '[]'::jsonb)
      ) order by meeting.starts_at desc), '[]'::jsonb)
        into v_json
        from public.team_project_meetings meeting where meeting.project_id = v_project_id;
      return pg_catalog.jsonb_build_object('meetings', v_json);

    when 'detail' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_project from public.team_projects where id = v_project_id and status <> 'deleted';
      if not found then raise exception using message = 'QIXING_PROJECT_NOT_FOUND', errcode = 'P0002'; end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'userId', member.user_id, 'role', member.role, 'status', member.status,
        'invitedBy', member.invited_by, 'invitedAt', member.invited_at,
        'joinedAt', member.joined_at, 'nickname', coalesce(nullif(profile.nickname, ''), '成员'),
        'school', coalesce(profile.school, '')
      ) order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end, member.joined_at nulls last), '[]'::jsonb)
        into v_json
        from public.team_project_members member
        left join public.social_profiles profile on profile.user_id = member.user_id
        where member.project_id = v_project_id
          and (member.status = 'active' or (v_role in ('owner', 'admin') and member.status = 'invited'));
      v_description := v_json::text;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', task.id, 'parentTaskId', task.parent_task_id, 'title', task.title,
        'dependsOnTaskId', task.depends_on_task_id, 'dependencyTaskTitle', dependency.title,
        'dependencyStatus', dependency.status,
        'description', task.description, 'createdBy', task.created_by,
        'assigneeId', task.assignee_id, 'assigneeName', coalesce(nullif(assignee.nickname, ''), ''),
        'assignmentStatus', task.assignment_status, 'status', task.status,
        'priority', task.priority, 'dueOn', task.due_on, 'milestoneId', task.milestone_id, 'revision', task.revision,
        'createdAt', task.created_at, 'updatedAt', task.updated_at, 'completedAt', task.completed_at
      ) order by task.due_on nulls last, task.created_at), '[]'::jsonb)
        into v_json
        from public.team_project_tasks task
        left join public.social_profiles assignee on assignee.user_id = task.assignee_id
        left join public.team_project_tasks dependency on dependency.id = task.depends_on_task_id and dependency.project_id = task.project_id
        where task.project_id = v_project_id;
      v_status := v_json::text;
      return pg_catalog.jsonb_build_object(
        'project', pg_catalog.jsonb_build_object(
          'id', v_project.id, 'ownerId', v_project.owner_id, 'name', v_project.name,
          'description', v_project.description, 'type', v_project.project_type,
          'startsOn', v_project.starts_on, 'targetEndOn', v_project.target_end_on,
          'status', v_project.status, 'revision', v_project.revision,
          'createdAt', v_project.created_at, 'updatedAt', v_project.updated_at, 'role', v_role
        ),
        'members', v_description::jsonb,
        'tasks', v_status::jsonb,
        'milestones', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', milestone.id, 'title', milestone.title, 'description', milestone.description,
            'dueOn', milestone.due_on, 'status', milestone.status, 'revision', milestone.revision,
            'createdAt', milestone.created_at, 'updatedAt', milestone.updated_at, 'completedAt', milestone.completed_at
          ) order by milestone.due_on nulls last, milestone.created_at)
          from public.team_project_milestones milestone where milestone.project_id = v_project_id
        ), '[]'::jsonb),
        'deliveryChecks', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', check_item.id, 'title', check_item.title, 'required', check_item.required,
            'checked', check_item.checked, 'evidence', check_item.evidence, 'checkedBy', check_item.checked_by,
            'checkedByName', coalesce(nullif(profile.nickname, ''), ''),
            'revision', check_item.revision, 'checkedAt', check_item.checked_at, 'updatedAt', check_item.updated_at
          ) order by check_item.created_at)
          from public.team_project_delivery_checks check_item
          left join public.social_profiles profile on profile.user_id = check_item.checked_by
          where check_item.project_id = v_project_id
        ), '[]'::jsonb),
        'activities', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', activity.id, 'actorId', activity.actor_id,
            'actorName', coalesce(nullif(profile.nickname, ''), '成员'),
            'type', activity.event_type, 'details', activity.details, 'createdAt', activity.created_at
          ) order by activity.created_at desc)
          from (select * from public.team_project_activity where project_id = v_project_id order by created_at desc limit 30) activity
          left join public.social_profiles profile on profile.user_id = activity.actor_id
        ), '[]'::jsonb)
      );

    when 'create' then
      v_project_id := (p_payload ->> 'id')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'name', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', ''));
      v_type := coalesce(p_payload ->> 'type', 'blank');
      v_starts_on := nullif(p_payload ->> 'startsOn', '')::date;
      v_target_end_on := nullif(p_payload ->> 'targetEndOn', '')::date;
      if v_name = '' or pg_catalog.char_length(v_name) > 120 or pg_catalog.char_length(v_description) > 2000
        or v_type not in ('course', 'competition', 'research', 'software', 'event', 'blank')
        or (v_starts_on is not null and v_target_end_on is not null and v_target_end_on < v_starts_on) then
        raise exception using message = 'QIXING_INVALID_PROJECT', errcode = '22023';
      end if;
      insert into public.team_projects(id, owner_id, name, description, project_type, starts_on, target_end_on)
        values (v_project_id, p_actor_id, v_name, v_description, v_type, v_starts_on, v_target_end_on)
        on conflict (id) do nothing;
      if found then
        insert into public.team_project_members(project_id, user_id, role, status, invited_by, joined_at)
          values (v_project_id, p_actor_id, 'owner', 'active', p_actor_id, pg_catalog.now());
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'project_created', pg_catalog.jsonb_build_object('name', v_name));
      else
        select * into v_project from public.team_projects where id = v_project_id;
        if v_project.owner_id is distinct from p_actor_id then raise exception using message = 'QIXING_PROJECT_ID_CONFLICT', errcode = '23505'; end if;
      end if;
      return pg_catalog.jsonb_build_object('projectId', v_project_id);

    when 'update' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      if coalesce(p_payload ->> 'expectedRevision', '') !~ '^[1-9][0-9]*$' then
        raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
      end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'name', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', ''));
      v_type := coalesce(p_payload ->> 'type', 'blank');
      v_starts_on := nullif(p_payload ->> 'startsOn', '')::date;
      v_target_end_on := nullif(p_payload ->> 'targetEndOn', '')::date;
      if v_name = '' or pg_catalog.char_length(v_name) > 120 or pg_catalog.char_length(v_description) > 2000
        or v_type not in ('course', 'competition', 'research', 'software', 'event', 'blank')
        or (v_starts_on is not null and v_target_end_on is not null and v_target_end_on < v_starts_on) then
        raise exception using message = 'QIXING_INVALID_PROJECT', errcode = '22023';
      end if;
      if exists(select 1 from public.team_projects where id = v_project_id
        and name = v_name and description = v_description and project_type = v_type
        and starts_on is not distinct from v_starts_on and target_end_on is not distinct from v_target_end_on
        and revision > (p_payload ->> 'expectedRevision')::integer) then
        return pg_catalog.jsonb_build_object('projectId', v_project_id);
      end if;
      update public.team_projects set name = v_name, description = v_description, project_type = v_type,
        starts_on = v_starts_on, target_end_on = v_target_end_on, revision = revision + 1, updated_at = pg_catalog.now()
        where id = v_project_id and status <> 'deleted' and revision = (p_payload ->> 'expectedRevision')::integer;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'project_updated', pg_catalog.jsonb_build_object('name', v_name));
      return pg_catalog.jsonb_build_object('projectId', v_project_id);

    when 'archive' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_decision := case when p_payload ->> 'archived' = 'true' then 'archived' else 'active' end;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      update public.team_projects set status = v_decision, revision = revision + 1, updated_at = pg_catalog.now()
        where id = v_project_id and status <> 'deleted' and status <> v_decision;
      if found then
        insert into public.team_project_activity(project_id, actor_id, event_type)
          values (v_project_id, p_actor_id, case when v_decision = 'archived' then 'project_archived' else 'project_restored' end);
      end if;
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', v_decision);

    when 'delete' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is distinct from 'owner' then raise exception using message = 'QIXING_OWNER_REQUIRED', errcode = '42501'; end if;
      update public.team_projects set status = 'deleted', deleted_at = pg_catalog.now(), revision = revision + 1, updated_at = pg_catalog.now()
        where id = v_project_id and status <> 'deleted';
      if found then
        update public.team_project_invite_links set revoked_at = coalesce(revoked_at, pg_catalog.now())
          where project_id = v_project_id;
        insert into public.team_project_activity(project_id, actor_id, event_type)
          values (v_project_id, p_actor_id, 'project_deleted');
      end if;
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', 'deleted');

    when 'restore' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is distinct from 'owner' then raise exception using message = 'QIXING_OWNER_REQUIRED', errcode = '42501'; end if;
      update public.team_projects set status = 'active', deleted_at = null, revision = revision + 1, updated_at = pg_catalog.now()
        where id = v_project_id and status = 'deleted';
      if found then
        insert into public.team_project_activity(project_id, actor_id, event_type)
          values (v_project_id, p_actor_id, 'project_restored');
      end if;
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', 'active');

    when 'member_invite' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_target_id := (p_payload ->> 'targetId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') or v_target_id = p_actor_id then
        raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501';
      end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      insert into public.team_project_members(project_id, user_id, role, status, invited_by)
        values (v_project_id, v_target_id, 'member', 'invited', p_actor_id)
        on conflict (project_id, user_id) do update set role = 'member', status = 'invited', invited_by = p_actor_id,
          invited_at = pg_catalog.now(), joined_at = null, left_at = null
        where public.team_project_members.status in ('declined', 'left');
      get diagnostics v_rows = row_count;
      select * into v_member from public.team_project_members where project_id = v_project_id and user_id = v_target_id;
      if v_member.status = 'active' then raise exception using message = 'QIXING_ALREADY_MEMBER', errcode = '23505'; end if;
      if v_rows > 0 then
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'member_invited', pg_catalog.jsonb_build_object('targetId', v_target_id));
      end if;
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'targetId', v_target_id, 'status', v_member.status);

    when 'invite_respond' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_decision := p_payload ->> 'decision';
      if v_decision not in ('accept', 'decline') then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_member from public.team_project_members
        where project_id = v_project_id and user_id = p_actor_id for update;
      if not found then raise exception using message = 'QIXING_INVITE_NOT_FOUND', errcode = 'P0002'; end if;
      if (v_member.status = 'active' and v_decision = 'accept') or (v_member.status = 'declined' and v_decision = 'decline') then
        return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', v_member.status);
      end if;
      if v_member.status <> 'invited' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      update public.team_project_members set status = case when v_decision = 'accept' then 'active' else 'declined' end,
        joined_at = case when v_decision = 'accept' then pg_catalog.now() else null end,
        left_at = null where project_id = v_project_id and user_id = p_actor_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, case when v_decision = 'accept' then 'member_joined' else 'member_declined' end, '{}'::jsonb);
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', case when v_decision = 'accept' then 'active' else 'declined' end);

    when 'invite_link_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      if coalesce(p_payload ->> 'tokenHash', '') !~ '^[0-9a-f]{64}$'
        or (p_payload ->> 'maxUses')::integer not between 1 and 20
        or (p_payload ->> 'expiresAt')::timestamptz <= pg_catalog.now()
        or (p_payload ->> 'expiresAt')::timestamptz > pg_catalog.now() + interval '30 days' then
        raise exception using message = 'QIXING_INVALID_INVITE_LINK', errcode = '22023';
      end if;
      insert into public.team_project_invite_links(id, project_id, token_hash, created_by, expires_at, max_uses)
        values ((p_payload ->> 'id')::uuid, v_project_id, p_payload ->> 'tokenHash', p_actor_id,
          (p_payload ->> 'expiresAt')::timestamptz, (p_payload ->> 'maxUses')::integer)
        on conflict (id) do nothing;
      get diagnostics v_rows = row_count;
      select * into v_link from public.team_project_invite_links where id = (p_payload ->> 'id')::uuid;
      if v_link.project_id is distinct from v_project_id or v_link.created_by is distinct from p_actor_id or v_link.token_hash is distinct from (p_payload ->> 'tokenHash') then
        raise exception using message = 'QIXING_INVALID_INVITE_LINK', errcode = '23505';
      end if;
      if v_rows > 0 then
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'invite_link_created', pg_catalog.jsonb_build_object('expiresAt', p_payload ->> 'expiresAt'));
      end if;
      return pg_catalog.jsonb_build_object('id', p_payload ->> 'id', 'expiresAt', p_payload ->> 'expiresAt', 'maxUses', (p_payload ->> 'maxUses')::integer);

    when 'invite_links' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', link.id, 'createdAt', link.created_at, 'expiresAt', link.expires_at,
        'maxUses', link.max_uses, 'uses', link.uses, 'revokedAt', link.revoked_at
      ) order by link.created_at desc), '[]'::jsonb)
        into v_json from public.team_project_invite_links link where link.project_id = v_project_id;
      return pg_catalog.jsonb_build_object('links', v_json);

    when 'invite_link_revoke' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_target_id := (p_payload ->> 'linkId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      update public.team_project_invite_links set revoked_at = coalesce(revoked_at, pg_catalog.now())
        where id = v_target_id and project_id = v_project_id;
      return pg_catalog.jsonb_build_object('linkId', v_target_id, 'revoked', true);

    when 'invite_join' then
      if coalesce(p_payload ->> 'tokenHash', '') !~ '^[0-9a-f]{64}$' then raise exception using message = 'QIXING_INVITE_LINK_INVALID', errcode = '22023'; end if;
      select * into v_link from public.team_project_invite_links where token_hash = p_payload ->> 'tokenHash' for update;
      if not found then raise exception using message = 'QIXING_INVITE_LINK_INVALID', errcode = 'P0002'; end if;
      select * into v_project from public.team_projects where id = v_link.project_id and status = 'active';
      if not found then raise exception using message = 'QIXING_PROJECT_NOT_FOUND', errcode = 'P0002'; end if;
      select * into v_member from public.team_project_members where project_id = v_link.project_id and user_id = p_actor_id for update;
      if found and v_member.status = 'active' then return pg_catalog.jsonb_build_object('projectId', v_link.project_id, 'status', 'active'); end if;
      if v_link.revoked_at is not null or v_link.expires_at <= pg_catalog.now() or v_link.uses >= v_link.max_uses then
        raise exception using message = 'QIXING_INVITE_LINK_INVALID', errcode = 'P0002';
      end if;
      insert into public.team_project_members(project_id, user_id, role, status, invited_by, joined_at)
        values (v_link.project_id, p_actor_id, 'member', 'active', v_link.created_by, pg_catalog.now())
        on conflict (project_id, user_id) do update set role = 'member', status = 'active', invited_by = excluded.invited_by,
          joined_at = pg_catalog.now(), left_at = null;
      update public.team_project_invite_links set uses = uses + 1 where id = v_link.id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_link.project_id, p_actor_id, 'member_joined', pg_catalog.jsonb_build_object('viaLink', true));
      return pg_catalog.jsonb_build_object('projectId', v_link.project_id, 'status', 'active');

    when 'member_leave' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      select * into v_member from public.team_project_members where project_id = v_project_id and user_id = p_actor_id for update;
      if not found then raise exception using message = 'QIXING_NOT_MEMBER', errcode = 'P0002'; end if;
      if v_member.status = 'left' then return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', 'left'); end if;
      if v_member.status <> 'active' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      if v_member.role = 'owner' then raise exception using message = 'QIXING_OWNER_TRANSFER_REQUIRED', errcode = '42501'; end if;
      update public.team_project_members set status = 'left', joined_at = null, left_at = pg_catalog.now()
        where project_id = v_project_id and user_id = p_actor_id;
      with stale as (
        update public.team_project_adjustment_requests set status = 'stale', decision_by = p_actor_id,
          decision_note = '相关成员已退出项目，请刷新后重新申请。', resolved_at = pg_catalog.now()
          where project_id = v_project_id and status = 'pending' and (requester_id = p_actor_id or approver_id = p_actor_id)
          returning id, task_id
      )
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        select v_project_id, stale.task_id, p_actor_id, 'adjustment_stale', pg_catalog.jsonb_build_object('requestId', stale.id, 'reason', 'member_left') from stale;
      update public.team_project_meeting_participants set status = 'declined', proposed_starts_at = null, proposed_ends_at = null, responded_at = pg_catalog.now()
        where user_id = p_actor_id and meeting_id in (select id from public.team_project_meetings where project_id = v_project_id and status <> 'cancelled');
      with reopened as (
        update public.team_project_meetings meeting set status = 'open', revision = revision + 1, updated_at = pg_catalog.now()
          where meeting.project_id = v_project_id and meeting.status = 'confirmed'
            and exists(select 1 from public.team_project_meeting_participants participant where participant.meeting_id = meeting.id and participant.user_id = p_actor_id)
          returning meeting.id
      )
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        select v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object('meetingId', reopened.id, 'status', 'open', 'reason', 'member_left') from reopened;
      with changed as (
        update public.team_project_tasks set assignee_id = null, assignment_status = 'none', revision = revision + 1, updated_at = pg_catalog.now()
          where project_id = v_project_id and assignee_id = p_actor_id and status <> 'completed'
          returning id
      )
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        select v_project_id, changed.id, p_actor_id, 'member_left', '{}'::jsonb from changed;
      insert into public.team_project_activity(project_id, actor_id, event_type)
        values (v_project_id, p_actor_id, 'member_left');
      return pg_catalog.jsonb_build_object('projectId', v_project_id, 'status', 'left');

    when 'member_remove' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_target_id := (p_payload ->> 'targetId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') or v_target_id = p_actor_id then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      select * into v_member from public.team_project_members where project_id = v_project_id and user_id = v_target_id for update;
      if not found or v_member.status = 'left' then return pg_catalog.jsonb_build_object('targetId', v_target_id, 'status', 'left'); end if;
      if v_member.role = 'owner' or (v_role = 'admin' and v_member.role = 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      update public.team_project_members set status = 'left', joined_at = null, left_at = pg_catalog.now()
        where project_id = v_project_id and user_id = v_target_id;
      with stale as (
        update public.team_project_adjustment_requests set status = 'stale', decision_by = p_actor_id,
          decision_note = '相关成员已离开项目，请刷新后重新申请。', resolved_at = pg_catalog.now()
          where project_id = v_project_id and status = 'pending' and (requester_id = v_target_id or approver_id = v_target_id)
          returning id, task_id
      )
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        select v_project_id, stale.task_id, p_actor_id, 'adjustment_stale', pg_catalog.jsonb_build_object('requestId', stale.id, 'reason', 'member_removed') from stale;
      update public.team_project_meeting_participants set status = 'declined', proposed_starts_at = null, proposed_ends_at = null, responded_at = pg_catalog.now()
        where user_id = v_target_id and meeting_id in (select id from public.team_project_meetings where project_id = v_project_id and status <> 'cancelled');
      with reopened as (
        update public.team_project_meetings meeting set status = 'open', revision = revision + 1, updated_at = pg_catalog.now()
          where meeting.project_id = v_project_id and meeting.status = 'confirmed'
            and exists(select 1 from public.team_project_meeting_participants participant where participant.meeting_id = meeting.id and participant.user_id = v_target_id)
          returning meeting.id
      )
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        select v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object('meetingId', reopened.id, 'status', 'open', 'reason', 'member_removed', 'targetId', v_target_id) from reopened;
      with changed as (
        update public.team_project_tasks set assignee_id = null, assignment_status = 'none', revision = revision + 1, updated_at = pg_catalog.now()
          where project_id = v_project_id and assignee_id = v_target_id and status <> 'completed'
          returning id
      )
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        select v_project_id, changed.id, p_actor_id, 'member_removed', pg_catalog.jsonb_build_object('targetId', v_target_id) from changed;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'member_removed', pg_catalog.jsonb_build_object('targetId', v_target_id));
      return pg_catalog.jsonb_build_object('targetId', v_target_id, 'status', 'left');

    when 'owner_transfer' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_target_id := (p_payload ->> 'targetId')::uuid;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is distinct from 'owner' then
        select member.role into v_target_role from public.team_project_members member
          where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
        select project.owner_id into v_owner_id from public.team_projects project where project.id = v_project_id;
        if not (v_target_role = 'admin' and v_owner_id = v_target_id) then raise exception using message = 'QIXING_OWNER_REQUIRED', errcode = '42501'; end if;
        return pg_catalog.jsonb_build_object('ownerId', v_target_id);
      end if;
      select member.role into v_target_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = v_target_id and member.status = 'active';
      if v_target_role is null or v_target_id = p_actor_id then raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023'; end if;
      update public.team_project_members set role = 'admin' where project_id = v_project_id and user_id = p_actor_id;
      update public.team_project_members set role = 'owner' where project_id = v_project_id and user_id = v_target_id;
      update public.team_projects set owner_id = v_target_id, revision = revision + 1, updated_at = pg_catalog.now() where id = v_project_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'owner_transferred', pg_catalog.jsonb_build_object('targetId', v_target_id));
      return pg_catalog.jsonb_build_object('ownerId', v_target_id);

    when 'member_role_update' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_target_id := (p_payload ->> 'targetId')::uuid;
      v_decision := p_payload ->> 'role';
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is distinct from 'owner' then raise exception using message = 'QIXING_OWNER_REQUIRED', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      if v_decision is null or v_decision not in ('admin', 'member') or v_target_id = p_actor_id then
        raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023';
      end if;
      select * into v_member from public.team_project_members
        where project_id = v_project_id and user_id = v_target_id and status = 'active' for update;
      if not found or v_member.role = 'owner' then raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023'; end if;
      if v_member.role = v_decision then return pg_catalog.jsonb_build_object('targetId', v_target_id, 'role', v_decision); end if;
      update public.team_project_members set role = v_decision where project_id = v_project_id and user_id = v_target_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'member_role_changed', pg_catalog.jsonb_build_object('targetId', v_target_id, 'from', v_member.role, 'to', v_decision));
      return pg_catalog.jsonb_build_object('targetId', v_target_id, 'role', v_decision);

    when 'task_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'id')::uuid;
      v_parent_id := nullif(p_payload ->> 'parentTaskId', '')::uuid;
      v_target_id := nullif(p_payload ->> 'assigneeId', '')::uuid;
      v_milestone_id := nullif(p_payload ->> 'milestoneId', '')::uuid;
      v_dependency_id := nullif(p_payload ->> 'dependsOnTaskId', '')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', ''));
      v_due_on := nullif(p_payload ->> 'dueOn', '')::date;
      v_priority := coalesce(p_payload ->> 'priority', 'normal');
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_project from public.team_projects where id = v_project_id and status = 'active' for update;
      if not found then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 3000
        or v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023'; end if;
      if v_parent_id is not null and not exists(select 1 from public.team_project_tasks where id = v_parent_id and project_id = v_project_id and parent_task_id is null) then
        raise exception using message = 'QIXING_INVALID_PARENT_TASK', errcode = '22023';
      end if;
      if v_target_id is not null and not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = v_target_id and status = 'active') then
        raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023';
      end if;
      if v_milestone_id is not null and not exists(select 1 from public.team_project_milestones where id = v_milestone_id and project_id = v_project_id) then raise exception using message = 'QIXING_MILESTONE_NOT_FOUND', errcode = 'P0002'; end if;
      if v_dependency_id is not null and (v_dependency_id = v_task_id or not exists(select 1 from public.team_project_tasks where id = v_dependency_id and project_id = v_project_id)) then raise exception using message = 'QIXING_DEPENDENCY_INVALID', errcode = '22023'; end if;
      insert into public.team_project_tasks(id, project_id, milestone_id, parent_task_id, depends_on_task_id, title, description, created_by, assignee_id, assignment_status, priority, due_on)
        values (v_task_id, v_project_id, v_milestone_id, v_parent_id, v_dependency_id, v_name, v_description, p_actor_id, v_target_id,
          case when v_target_id is null then 'none' else 'pending' end, v_priority, v_due_on)
        on conflict (id) do nothing;
      if found then
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_task_id, p_actor_id, 'created', pg_catalog.jsonb_build_object('title', v_name));
        if v_target_id is not null then
          insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
            values (v_project_id, v_task_id, p_actor_id, 'assigned', pg_catalog.jsonb_build_object('assigneeId', v_target_id));
        end if;
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, case when v_target_id is null then 'task_created' else 'task_assigned' end,
            pg_catalog.jsonb_build_object('taskId', v_task_id, 'title', v_name, 'assigneeId', v_target_id));
      else
        select * into v_task from public.team_project_tasks where id = v_task_id;
        if v_task.project_id is distinct from v_project_id or v_task.created_by is distinct from p_actor_id
          or v_task.milestone_id is distinct from v_milestone_id or v_task.depends_on_task_id is distinct from v_dependency_id
          or v_task.parent_task_id is distinct from v_parent_id or v_task.title is distinct from v_name
          or v_task.description is distinct from v_description or v_task.assignee_id is distinct from v_target_id
          or v_task.priority is distinct from v_priority or v_task.due_on is distinct from v_due_on
          or v_task.assignment_status is distinct from (case when v_target_id is null then 'none' else 'pending' end) then
          raise exception using message = 'QIXING_TASK_ID_CONFLICT', errcode = '23505';
        end if;
      end if;
      return pg_catalog.jsonb_build_object('taskId', v_task_id);

    when 'task_update' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      if coalesce(p_payload ->> 'expectedRevision', '') !~ '^[1-9][0-9]*$' then
        raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
      end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_project from public.team_projects where id = v_project_id and status = 'active' for update;
      if not found then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_task from public.team_project_tasks where id = v_task_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_TASK_NOT_FOUND', errcode = 'P0002'; end if;
      if v_role not in ('owner', 'admin') and v_task.created_by is distinct from p_actor_id then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', v_task.title));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', v_task.description));
      v_due_on := case when p_payload ? 'dueOn' then nullif(p_payload ->> 'dueOn', '')::date else v_task.due_on end;
      v_priority := coalesce(p_payload ->> 'priority', v_task.priority);
      v_has_assignee := p_payload ? 'assigneeId';
      v_target_id := case when v_has_assignee then nullif(p_payload ->> 'assigneeId', '')::uuid else v_task.assignee_id end;
      v_has_milestone := p_payload ? 'milestoneId';
      v_milestone_id := case when v_has_milestone then nullif(p_payload ->> 'milestoneId', '')::uuid else v_task.milestone_id end;
      v_has_dependency := p_payload ? 'dependsOnTaskId';
      v_dependency_id := case when v_has_dependency then nullif(p_payload ->> 'dependsOnTaskId', '')::uuid else v_task.depends_on_task_id end;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 3000
        or v_priority not in ('low', 'normal', 'high', 'urgent') then raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023'; end if;
      if v_has_assignee and v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_has_assignee and v_target_id is not null and not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = v_target_id and status = 'active') then
        raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023';
      end if;
      if v_has_milestone and v_milestone_id is not null and not exists(select 1 from public.team_project_milestones where id = v_milestone_id and project_id = v_project_id) then raise exception using message = 'QIXING_MILESTONE_NOT_FOUND', errcode = 'P0002'; end if;
      if v_has_dependency and v_dependency_id is not null then
        if v_dependency_id = v_task_id or not exists(select 1 from public.team_project_tasks where id = v_dependency_id and project_id = v_project_id) then
          raise exception using message = 'QIXING_DEPENDENCY_INVALID', errcode = '22023';
        end if;
        if exists (
          with recursive dependency_chain(task_id, depends_on_task_id) as (
            select dependency.id, dependency.depends_on_task_id from public.team_project_tasks dependency
              where dependency.id = v_dependency_id and dependency.project_id = v_project_id
            union
            select dependency.id, dependency.depends_on_task_id from public.team_project_tasks dependency
              join dependency_chain chain on dependency.id = chain.depends_on_task_id
              where dependency.project_id = v_project_id
          ) select 1 from dependency_chain where task_id = v_task_id
        ) then raise exception using message = 'QIXING_TASK_DEPENDENCY_CYCLE', errcode = '22023'; end if;
        if v_task.status <> 'todo' and v_dependency_id is distinct from v_task.depends_on_task_id
          and not exists(select 1 from public.team_project_tasks dependency where dependency.id = v_dependency_id and dependency.status = 'completed') then
          raise exception using message = 'QIXING_TASK_DEPENDENCY_BLOCKED', errcode = '40001';
        end if;
      end if;
      if (p_payload ->> 'expectedRevision')::integer <> v_task.revision then
        if v_task.title = v_name and v_task.description = v_description and v_task.due_on is not distinct from v_due_on
          and v_task.priority = v_priority and v_task.assignee_id is not distinct from v_target_id
          and v_task.milestone_id is not distinct from v_milestone_id
          and v_task.depends_on_task_id is not distinct from v_dependency_id
          and (not v_has_assignee or v_task.assignment_status <> 'declined') then
          return pg_catalog.jsonb_build_object('taskId', v_task_id, 'revision', v_task.revision);
        end if;
        raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
      end if;
      update public.team_project_tasks set title = v_name, description = v_description, due_on = v_due_on, milestone_id = v_milestone_id, depends_on_task_id = v_dependency_id, priority = v_priority,
        assignee_id = v_target_id,
        assignment_status = case when v_target_id is null then 'none'
          when v_target_id is distinct from v_task.assignee_id or (v_has_assignee and v_task.assignment_status = 'declined') then 'pending'
          else assignment_status end,
        revision = revision + 1, updated_at = pg_catalog.now()
        where id = v_task_id;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        values (v_project_id, v_task_id, p_actor_id, case when v_target_id is distinct from v_task.assignee_id or (v_has_assignee and v_task.assignment_status = 'declined') then 'assigned' else 'updated' end,
          pg_catalog.jsonb_build_object('assigneeId', v_target_id, 'dueOn', v_due_on, 'milestoneId', v_milestone_id, 'dependsOnTaskId', v_dependency_id, 'priority', v_priority));
      return pg_catalog.jsonb_build_object('taskId', v_task_id, 'revision', v_task.revision + 1);

    when 'task_respond' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      v_decision := p_payload ->> 'decision';
      if v_decision not in ('accept', 'decline') then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_task from public.team_project_tasks where id = v_task_id and project_id = v_project_id for update;
      if not found or v_task.assignee_id is distinct from p_actor_id then raise exception using message = 'QIXING_TASK_NOT_ASSIGNED', errcode = '42501'; end if;
      if (v_task.assignment_status = 'accepted' and v_decision = 'accept') or (v_task.assignment_status = 'declined' and v_decision = 'decline') then
        return pg_catalog.jsonb_build_object('taskId', v_task_id, 'assignmentStatus', v_task.assignment_status, 'status', v_task.status);
      end if;
      if v_task.assignment_status <> 'pending' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      v_assignment_status := case when v_decision = 'accept' then 'accepted' else 'declined' end;
      update public.team_project_tasks set assignment_status = v_assignment_status, revision = revision + 1, updated_at = pg_catalog.now() where id = v_task_id;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type)
        values (v_project_id, v_task_id, p_actor_id, case when v_decision = 'accept' then 'assignment_accepted' else 'assignment_declined' end);
      return pg_catalog.jsonb_build_object('taskId', v_task_id, 'assignmentStatus', v_assignment_status, 'status', v_task.status);

    when 'task_status' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      v_task_status := p_payload ->> 'status';
      if v_task_status not in ('todo', 'in_progress', 'review', 'completed') then raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023'; end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_project from public.team_projects where id = v_project_id and status = 'active' for update;
      if not found then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_task from public.team_project_tasks where id = v_task_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_TASK_NOT_FOUND', errcode = 'P0002'; end if;
      if v_task_status = 'completed' and exists (
        select 1 from public.team_project_deliverables deliverable
        where deliverable.task_id = v_task_id and deliverable.review_required
          and coalesce((select version.review_status from public.team_project_result_versions version
            where version.deliverable_id = deliverable.id order by version.version_number desc limit 1), 'missing') <> 'approved'
      ) then raise exception using message = 'QIXING_REVIEW_REQUIRED', errcode = '40001'; end if;
      if v_task.status = v_task_status then return pg_catalog.jsonb_build_object('taskId', v_task_id, 'status', v_task.status); end if;
      if v_task_status <> 'todo' and v_task.depends_on_task_id is not null
        and not exists(select 1 from public.team_project_tasks dependency where dependency.id = v_task.depends_on_task_id and dependency.project_id = v_project_id and dependency.status = 'completed') then
        raise exception using message = 'QIXING_TASK_DEPENDENCY_BLOCKED', errcode = '40001';
      end if;
      if v_task.status = 'completed' and v_task_status <> 'completed' and exists(
        select 1 from public.team_project_tasks dependent where dependent.project_id = v_project_id
          and dependent.depends_on_task_id = v_task_id and dependent.status = 'completed'
      ) then raise exception using message = 'QIXING_TASK_DEPENDENCY_IN_USE', errcode = '40001'; end if;
      if v_role not in ('owner', 'admin') and (v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted') then
        raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501';
      end if;
      update public.team_project_tasks set status = v_task_status,
        completed_at = case when v_task_status = 'completed' then pg_catalog.now() else null end,
        revision = revision + 1, updated_at = pg_catalog.now() where id = v_task_id;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        values (v_project_id, v_task_id, p_actor_id, 'status_changed', pg_catalog.jsonb_build_object('from', v_task.status, 'to', v_task_status));
      return pg_catalog.jsonb_build_object('taskId', v_task_id, 'status', v_task_status);

    when 'task_personal_sync' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      v_task_status := p_payload ->> 'status';
      if v_task_status not in ('todo', 'completed') then raise exception using message = 'QIXING_INVALID_TASK', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active')
        or not exists(select 1 from public.team_projects where id = v_project_id and status <> 'deleted') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      select * into v_task from public.team_project_tasks where id = v_task_id and project_id = v_project_id for update;
      if not found or v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted' then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_task.status = v_task_status then return pg_catalog.jsonb_build_object('taskId', v_task_id, 'status', v_task.status); end if;
      if v_task_status <> 'todo' and v_task.depends_on_task_id is not null
        and not exists(select 1 from public.team_project_tasks dependency where dependency.id = v_task.depends_on_task_id and dependency.project_id = v_project_id and dependency.status = 'completed') then
        raise exception using message = 'QIXING_TASK_DEPENDENCY_BLOCKED', errcode = '40001';
      end if;
      if v_task.status = 'completed' and v_task_status <> 'completed' and exists(
        select 1 from public.team_project_tasks dependent where dependent.project_id = v_project_id
          and dependent.depends_on_task_id = v_task_id and dependent.status = 'completed'
      ) then raise exception using message = 'QIXING_TASK_DEPENDENCY_IN_USE', errcode = '40001'; end if;
      if v_task_status = 'completed' and exists (
        select 1 from public.team_project_deliverables deliverable
        where deliverable.task_id = v_task_id and deliverable.review_required
          and coalesce((select version.review_status from public.team_project_result_versions version
            where version.deliverable_id = deliverable.id order by version.version_number desc limit 1), 'missing') <> 'approved'
      ) then raise exception using message = 'QIXING_REVIEW_REQUIRED', errcode = '40001'; end if;
      update public.team_project_tasks set status = v_task_status,
        completed_at = case when v_task_status = 'completed' then pg_catalog.now() else null end,
        revision = revision + 1, updated_at = pg_catalog.now() where id = v_task_id;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        values (v_project_id, v_task_id, p_actor_id, 'status_changed', pg_catalog.jsonb_build_object('from', v_task.status, 'to', v_task_status, 'source', 'personal_todo'));
      return pg_catalog.jsonb_build_object('taskId', v_task_id, 'status', v_task_status);

    when 'task_events' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', event.id, 'actorId', event.actor_id, 'actorName', coalesce(nullif(profile.nickname, ''), '成员'),
        'type', event.event_type, 'details', event.details, 'createdAt', event.created_at
      ) order by event.created_at desc), '[]'::jsonb)
        into v_json
        from public.team_project_task_events event
        left join public.social_profiles profile on profile.user_id = event.actor_id
        where event.project_id = v_project_id and event.task_id = v_task_id;
      return pg_catalog.jsonb_build_object('events', v_json);

    when 'milestone_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_milestone_id := (p_payload ->> 'id')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', ''));
      v_due_on := nullif(p_payload ->> 'dueOn', '')::date;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 2000 then raise exception using message = 'QIXING_INVALID_MILESTONE', errcode = '22023'; end if;
      insert into public.team_project_milestones(id, project_id, title, description, due_on, created_by)
        values (v_milestone_id, v_project_id, v_name, v_description, v_due_on, p_actor_id) on conflict (id) do nothing;
      if found then
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'milestone_created', pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'title', v_name));
      else
        select * into v_milestone from public.team_project_milestones where id = v_milestone_id;
        if v_milestone.project_id is distinct from v_project_id or v_milestone.created_by is distinct from p_actor_id
          or v_milestone.title is distinct from v_name or v_milestone.description is distinct from v_description
          or v_milestone.due_on is distinct from v_due_on then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
      end if;
      return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id);

    when 'milestone_update' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_milestone_id := (p_payload ->> 'milestoneId')::uuid;
      if coalesce(p_payload ->> 'expectedRevision', '') !~ '^[1-9][0-9]*$' then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select * into v_milestone from public.team_project_milestones where id = v_milestone_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MILESTONE_NOT_FOUND', errcode = 'P0002'; end if;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'description', ''));
      v_due_on := nullif(p_payload ->> 'dueOn', '')::date;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 2000 then raise exception using message = 'QIXING_INVALID_MILESTONE', errcode = '22023'; end if;
      if v_milestone.revision <> (p_payload ->> 'expectedRevision')::integer then
        if v_milestone.title = v_name and v_milestone.description = v_description and v_milestone.due_on is not distinct from v_due_on then return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'revision', v_milestone.revision); end if;
        raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
      end if;
      update public.team_project_milestones set title = v_name, description = v_description, due_on = v_due_on,
        revision = revision + 1, updated_at = pg_catalog.now() where id = v_milestone_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'milestone_updated', pg_catalog.jsonb_build_object('milestoneId', v_milestone_id));
      return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'revision', v_milestone.revision + 1);

    when 'milestone_toggle' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_milestone_id := (p_payload ->> 'milestoneId')::uuid;
      v_decision := case when p_payload ->> 'completed' = 'true' then 'completed' else 'upcoming' end;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select * into v_milestone from public.team_project_milestones where id = v_milestone_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MILESTONE_NOT_FOUND', errcode = 'P0002'; end if;
      if v_milestone.status = v_decision then return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'status', v_decision); end if;
      update public.team_project_milestones set status = v_decision,
        completed_by = case when v_decision = 'completed' then p_actor_id else null end,
        completed_at = case when v_decision = 'completed' then pg_catalog.now() else null end,
        revision = revision + 1, updated_at = pg_catalog.now() where id = v_milestone_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'milestone_updated', pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'status', v_decision));
      return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'status', v_decision);

    when 'milestone_delete' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_milestone_id := (p_payload ->> 'milestoneId')::uuid;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      delete from public.team_project_milestones where id = v_milestone_id and project_id = v_project_id;
      if not found then raise exception using message = 'QIXING_MILESTONE_NOT_FOUND', errcode = 'P0002'; end if;
      return pg_catalog.jsonb_build_object('milestoneId', v_milestone_id, 'deleted', true);

    when 'delivery_check_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_check_id := (p_payload ->> 'id')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      if v_name = '' or pg_catalog.char_length(v_name) > 200 then raise exception using message = 'QIXING_INVALID_DELIVERY_CHECK', errcode = '22023'; end if;
      insert into public.team_project_delivery_checks(id, project_id, title, required, created_by)
        values (v_check_id, v_project_id, v_name, coalesce((p_payload ->> 'required')::boolean, true), p_actor_id) on conflict (id) do nothing;
      if not found then
        select * into v_check from public.team_project_delivery_checks where id = v_check_id;
        if v_check.project_id is distinct from v_project_id or v_check.created_by is distinct from p_actor_id
          or v_check.title is distinct from v_name or v_check.required is distinct from coalesce((p_payload ->> 'required')::boolean, true) then
          raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
        end if;
      else
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'delivery_check_created', pg_catalog.jsonb_build_object('checkId', v_check_id, 'title', v_name));
      end if;
      return pg_catalog.jsonb_build_object('checkId', v_check_id);

    when 'delivery_check_update' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_check_id := (p_payload ->> 'checkId')::uuid;
      if coalesce(p_payload ->> 'expectedRevision', '') !~ '^[1-9][0-9]*$' then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select * into v_check from public.team_project_delivery_checks where id = v_check_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_DELIVERY_CHECK_NOT_FOUND', errcode = 'P0002'; end if;
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'evidence', ''));
      if pg_catalog.char_length(v_description) > 1500 then raise exception using message = 'QIXING_INVALID_DELIVERY_CHECK', errcode = '22023'; end if;
      if v_check.revision <> (p_payload ->> 'expectedRevision')::integer then
        if v_check.checked = (p_payload ->> 'checked' = 'true') and v_check.evidence = v_description then return pg_catalog.jsonb_build_object('checkId', v_check_id, 'revision', v_check.revision); end if;
        raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
      end if;
      update public.team_project_delivery_checks set checked = (p_payload ->> 'checked' = 'true'), evidence = v_description,
        checked_by = case when p_payload ->> 'checked' = 'true' then p_actor_id else null end,
        checked_at = case when p_payload ->> 'checked' = 'true' then pg_catalog.now() else null end,
        revision = revision + 1, updated_at = pg_catalog.now() where id = v_check_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'delivery_check_updated', pg_catalog.jsonb_build_object('checkId', v_check_id, 'checked', p_payload ->> 'checked'));
      return pg_catalog.jsonb_build_object('checkId', v_check_id, 'revision', v_check.revision + 1);

    when 'delivery_check_delete' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_check_id := (p_payload ->> 'checkId')::uuid;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      delete from public.team_project_delivery_checks where id = v_check_id and project_id = v_project_id;
      if not found then raise exception using message = 'QIXING_DELIVERY_CHECK_NOT_FOUND', errcode = 'P0002'; end if;
      return pg_catalog.jsonb_build_object('checkId', v_check_id, 'deleted', true);

    when 'meeting_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_meeting_id := (p_payload ->> 'id')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'note', ''));
      v_starts_at := (p_payload ->> 'startsAt')::timestamptz;
      v_ends_at := (p_payload ->> 'endsAt')::timestamptz;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 1500
        or v_starts_at <= pg_catalog.now() or v_ends_at <= v_starts_at or v_ends_at - v_starts_at > interval '8 hours' then
        raise exception using message = 'QIXING_INVALID_MEETING', errcode = '22023';
      end if;
      insert into public.team_project_meetings(id, project_id, created_by, title, note, starts_at, ends_at)
        values (v_meeting_id, v_project_id, p_actor_id, v_name, v_description, v_starts_at, v_ends_at) on conflict (id) do nothing;
      if found then
        insert into public.team_project_meeting_participants(meeting_id, user_id, status, responded_at)
          select v_meeting_id, member.user_id, case when member.user_id = p_actor_id then 'accepted' else 'invited' end,
            case when member.user_id = p_actor_id then pg_catalog.now() else null end
          from public.team_project_members member where member.project_id = v_project_id and member.status = 'active';
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'meeting_created', pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'title', v_name));
      else
        select * into v_meeting from public.team_project_meetings where id = v_meeting_id;
        if v_meeting.project_id is distinct from v_project_id or v_meeting.created_by is distinct from p_actor_id
          or v_meeting.title is distinct from v_name or v_meeting.note is distinct from v_description
          or v_meeting.starts_at is distinct from v_starts_at or v_meeting.ends_at is distinct from v_ends_at then
          raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
        end if;
        v_status := v_meeting.status;
      end if;
      if v_status is null then v_status := 'open'; end if;
      return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', v_status);

    when 'meeting_respond' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_meeting_id := (p_payload ->> 'meetingId')::uuid;
      v_decision := p_payload ->> 'response';
      v_starts_at := nullif(p_payload ->> 'proposedStartsAt', '')::timestamptz;
      v_ends_at := nullif(p_payload ->> 'proposedEndsAt', '')::timestamptz;
      if v_decision not in ('accept', 'decline', 'propose') then raise exception using message = 'QIXING_INVALID_MEETING', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_meeting from public.team_project_meetings where id = v_meeting_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_decision is null or v_decision not in ('accept', 'decline', 'propose') then raise exception using message = 'QIXING_INVALID_MEETING', errcode = '22023'; end if;
      if v_meeting.status = 'cancelled' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      if v_meeting.created_by = p_actor_id then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      select * into v_member from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active';
      if not found then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_meeting_participant from public.team_project_meeting_participants
        where meeting_id = v_meeting_id and user_id = p_actor_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_decision = 'propose' and (v_starts_at is null or v_ends_at is null or v_starts_at <= pg_catalog.now() or v_ends_at <= v_starts_at or v_ends_at - v_starts_at > interval '8 hours') then
        raise exception using message = 'QIXING_INVALID_MEETING', errcode = '22023';
      end if;
      if (v_decision = 'accept' and v_meeting_participant.status = 'accepted')
        or (v_decision = 'decline' and v_meeting_participant.status = 'declined')
        or (v_decision = 'propose' and v_meeting_participant.status = 'proposed'
          and v_meeting_participant.proposed_starts_at = v_starts_at and v_meeting_participant.proposed_ends_at = v_ends_at) then
        return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'response', v_decision, 'status', v_meeting.status);
      end if;
      update public.team_project_meeting_participants set
        status = case v_decision when 'accept' then 'accepted' when 'decline' then 'declined' else 'proposed' end,
        proposed_starts_at = case when v_decision = 'propose' then v_starts_at else null end,
        proposed_ends_at = case when v_decision = 'propose' then v_ends_at else null end,
        responded_at = pg_catalog.now()
        where meeting_id = v_meeting_id and user_id = p_actor_id;
      if v_meeting.status = 'confirmed' and v_decision <> 'accept' then
        update public.team_project_meetings set status = 'open', revision = revision + 1, updated_at = pg_catalog.now() where id = v_meeting_id;
      else
        update public.team_project_meetings set revision = revision + 1, updated_at = pg_catalog.now() where id = v_meeting_id;
      end if;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'response', v_decision));
      return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'response', v_decision, 'status', case when v_meeting.status = 'confirmed' and v_decision <> 'accept' then 'open' else v_meeting.status end);

    when 'meeting_confirm' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_meeting_id := (p_payload ->> 'meetingId')::uuid;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_meeting from public.team_project_meetings where id = v_meeting_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_meeting.created_by is distinct from p_actor_id and v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_meeting.status = 'confirmed' then return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'confirmed'); end if;
      if v_meeting.status <> 'open' or exists(
        select 1 from public.team_project_meeting_participants participant
        join public.team_project_members member on member.project_id = v_project_id and member.user_id = participant.user_id and member.status = 'active'
        where participant.meeting_id = v_meeting_id and participant.status <> 'accepted'
      ) then raise exception using message = 'QIXING_MEETING_NOT_READY', errcode = '40901'; end if;
      update public.team_project_meetings set status = 'confirmed', revision = revision + 1, updated_at = pg_catalog.now() where id = v_meeting_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'confirmed'));
      return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'confirmed');

    when 'meeting_apply_proposal' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_meeting_id := (p_payload ->> 'meetingId')::uuid;
      v_target_id := (p_payload ->> 'participantId')::uuid;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_meeting from public.team_project_meetings where id = v_meeting_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_meeting.created_by is distinct from p_actor_id and v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_meeting.status = 'cancelled' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      select * into v_meeting_participant from public.team_project_meeting_participants where meeting_id = v_meeting_id and user_id = v_target_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_meeting_participant.status <> 'proposed' then
        if v_meeting_participant.status = 'accepted' and exists(
          select 1 from public.team_project_activity activity
          where activity.project_id = v_project_id and activity.actor_id = p_actor_id
            and activity.event_type = 'meeting_status_changed'
            and activity.details ->> 'status' = 'time_changed'
            and activity.details ->> 'meetingId' = v_meeting_id::text
            and activity.details ->> 'participantId' = v_target_id::text
            and (activity.details ->> 'startsAt')::timestamptz = v_meeting.starts_at
            and (activity.details ->> 'endsAt')::timestamptz = v_meeting.ends_at
        ) then return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', v_meeting.status); end if;
        raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002';
      end if;
      v_starts_at := v_meeting_participant.proposed_starts_at;
      v_ends_at := v_meeting_participant.proposed_ends_at;
      if v_starts_at <= pg_catalog.now() or v_ends_at <= v_starts_at or v_ends_at - v_starts_at > interval '8 hours' then raise exception using message = 'QIXING_INVALID_MEETING', errcode = '22023'; end if;
      update public.team_project_meetings set starts_at = v_starts_at, ends_at = v_ends_at, status = 'open', revision = revision + 1, updated_at = pg_catalog.now() where id = v_meeting_id;
      update public.team_project_meeting_participants set
        status = case when user_id in (p_actor_id, v_target_id) then 'accepted' else 'invited' end,
        proposed_starts_at = null, proposed_ends_at = null,
        responded_at = case when user_id in (p_actor_id, v_target_id) then pg_catalog.now() else null end
        where meeting_id = v_meeting_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object(
          'meetingId', v_meeting_id, 'status', 'time_changed', 'participantId', v_target_id,
          'startsAt', v_starts_at, 'endsAt', v_ends_at
        ));
      return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'open');

    when 'meeting_cancel' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_meeting_id := (p_payload ->> 'meetingId')::uuid;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_meeting from public.team_project_meetings where id = v_meeting_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_MEETING_NOT_FOUND', errcode = 'P0002'; end if;
      if v_meeting.created_by is distinct from p_actor_id and v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_meeting.status = 'cancelled' then return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'cancelled'); end if;
      update public.team_project_meetings set status = 'cancelled', revision = revision + 1, updated_at = pg_catalog.now() where id = v_meeting_id;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'meeting_status_changed', pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'cancelled'));
      return pg_catalog.jsonb_build_object('meetingId', v_meeting_id, 'status', 'cancelled');

    when 'adjustment_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_task_id := (p_payload ->> 'taskId')::uuid;
      v_request_id := (p_payload ->> 'id')::uuid;
      v_request_type := p_payload ->> 'type';
      v_request_data := coalesce(p_payload -> 'data', '{}'::jsonb);
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'reason', ''));
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_task from public.team_project_tasks where id = v_task_id and project_id = v_project_id for share;
      if not found then raise exception using message = 'QIXING_TASK_NOT_FOUND', errcode = 'P0002'; end if;
      if v_request_type is null or v_request_type not in ('deadline_extension', 'help', 'scope_change', 'split', 'handover', 'unable_to_continue')
        or jsonb_typeof(v_request_data) <> 'object' or pg_catalog.char_length(v_name) not between 1 and 1500 then
        raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
      end if;
      select * into v_request from public.team_project_adjustment_requests where id = v_request_id;
      if found then
        if v_request.requester_id is distinct from p_actor_id or v_request.project_id is distinct from v_project_id
          or v_request.task_id is distinct from v_task_id or v_request.request_type is distinct from v_request_type
          or v_request.request_data is distinct from v_request_data or v_request.reason is distinct from v_name then
          raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
        end if;
        return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', v_request.status);
      end if;
      if v_role not in ('owner', 'admin') and (v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted') then
        raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501';
      end if;
      if v_role in ('owner', 'admin') and v_task.assignee_id = p_actor_id then
        raise exception using message = 'QIXING_USE_TASK_EDIT', errcode = '22023';
      end if;
      if v_role in ('owner', 'admin') and v_request_type not in ('help') and v_task.assignee_id is null then
        raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
      end if;
      v_target_id := nullif(v_request_data ->> 'targetId', '')::uuid;
      if v_request_type = 'help' then
        if v_target_id is null or v_target_id = p_actor_id
          or not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = v_target_id and status = 'active') then
          raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023';
        end if;
      elsif v_request_type = 'deadline_extension' then
        v_due_on := (v_request_data ->> 'dueOn')::date;
        if v_due_on is null or v_due_on <= greatest(coalesce(v_task.due_on, current_date), current_date) then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      elsif v_request_type = 'scope_change' then
        v_description := pg_catalog.btrim(coalesce(v_request_data ->> 'description', ''));
        if pg_catalog.char_length(v_description) > 3000 then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      elsif v_request_type = 'split' then
        if jsonb_typeof(v_request_data -> 'subtasks') is distinct from 'array' then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
        if pg_catalog.jsonb_array_length(v_request_data -> 'subtasks') not between 1 and 8 then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
        if exists(select 1 from jsonb_array_elements(v_request_data -> 'subtasks') item
          where jsonb_typeof(item) <> 'string' or pg_catalog.char_length(pg_catalog.btrim(item #>> '{}')) not between 1 and 160) then
          raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023';
        end if;
      elsif v_request_type = 'handover' then
        if v_target_id is null or v_target_id = v_task.assignee_id or v_target_id = p_actor_id
          or not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = v_target_id and status = 'active') then
          raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023';
        end if;
      end if;
      if exists(select 1 from public.team_project_adjustment_requests where task_id = v_task_id and requester_id = p_actor_id and request_type = v_request_type and status = 'pending' and id <> v_request_id) then
        raise exception using message = 'QIXING_DUPLICATE_ADJUSTMENT', errcode = '23505';
      end if;
      v_owner_id := case when v_request_type = 'help' then v_target_id
        when v_role in ('owner', 'admin') then v_task.assignee_id else null end;
      insert into public.team_project_adjustment_requests(id, project_id, task_id, requester_id, approver_id,
        request_type, reason, request_data, task_revision)
        values (v_request_id, v_project_id, v_task_id, p_actor_id, v_owner_id,
          v_request_type, v_name, v_request_data, v_task.revision)
        on conflict (id) do nothing;
      if found then
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_task_id, p_actor_id, 'adjustment_requested', pg_catalog.jsonb_build_object('requestId', v_request_id, 'type', v_request_type));
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'adjustment_requested', pg_catalog.jsonb_build_object('requestId', v_request_id, 'taskId', v_task_id, 'type', v_request_type));
      else
        select * into v_request from public.team_project_adjustment_requests where id = v_request_id;
        if v_request.requester_id is distinct from p_actor_id or v_request.project_id is distinct from v_project_id
          or v_request.task_id is distinct from v_task_id or v_request.request_type is distinct from v_request_type
          or v_request.request_data is distinct from v_request_data or v_request.reason is distinct from v_name then
          raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
        end if;
        return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', v_request.status);
      end if;
      return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', 'pending');

    when 'adjustments_list' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then
        raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501';
      end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', request.id, 'taskId', request.task_id, 'taskTitle', task.title,
        'requesterId', request.requester_id, 'requesterName', coalesce(nullif(requester.nickname, ''), '成员'),
        'approverId', request.approver_id, 'type', request.request_type, 'reason', request.reason,
        'data', request.request_data, 'taskRevision', request.task_revision, 'status', request.status,
        'decisionBy', request.decision_by, 'decisionName', coalesce(nullif(decider.nickname, ''), ''),
        'decisionNote', request.decision_note, 'createdAt', request.created_at, 'resolvedAt', request.resolved_at
      ) order by request.created_at desc), '[]'::jsonb)
        into v_json
        from (select * from public.team_project_adjustment_requests where project_id = v_project_id order by created_at desc limit 100) request
        join public.team_project_tasks task on task.id = request.task_id
        left join public.social_profiles requester on requester.user_id = request.requester_id
        left join public.social_profiles decider on decider.user_id = request.decision_by;
      return pg_catalog.jsonb_build_object('requests', v_json);

    when 'adjustment_decide' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_request_id := (p_payload ->> 'requestId')::uuid;
      v_decision := p_payload ->> 'decision';
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'decisionNote', ''));
      if v_decision is null or v_decision not in ('approve', 'reject') or pg_catalog.char_length(v_name) > 1500 then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_request from public.team_project_adjustment_requests where id = v_request_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_REQUEST_NOT_FOUND', errcode = 'P0002'; end if;
      if v_request.status <> 'pending' then
        if (v_request.status = 'approved' and v_decision = 'approve') or (v_request.status = 'rejected' and v_decision = 'reject') then
          return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', v_request.status);
        end if;
        raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001';
      end if;
      if v_request.requester_id = p_actor_id
        or (v_request.approver_id is not null and v_request.approver_id <> p_actor_id)
        or (v_request.approver_id is null and v_role not in ('owner', 'admin')) then
        raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501';
      end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      select * into v_task from public.team_project_tasks where id = v_request.task_id and project_id = v_project_id for update;
      if not found or v_task.revision <> v_request.task_revision then
        update public.team_project_adjustment_requests set status = 'stale', decision_by = p_actor_id,
          decision_note = '任务约定已变化，请刷新后重新申请。', resolved_at = pg_catalog.now() where id = v_request_id;
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_request.task_id, p_actor_id, 'adjustment_stale', pg_catalog.jsonb_build_object('requestId', v_request_id));
        return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', 'stale');
      end if;
      if v_decision = 'reject' then
        update public.team_project_adjustment_requests set status = 'rejected', decision_by = p_actor_id,
          decision_note = v_name, resolved_at = pg_catalog.now() where id = v_request_id;
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_task.id, p_actor_id, 'adjustment_rejected', pg_catalog.jsonb_build_object('requestId', v_request_id, 'type', v_request.request_type, 'note', v_name));
      else
        if v_request.request_type = 'deadline_extension' then
          update public.team_project_tasks set due_on = (v_request.request_data ->> 'dueOn')::date, revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        elsif v_request.request_type = 'scope_change' then
          update public.team_project_tasks set description = coalesce(v_request.request_data ->> 'description', ''), revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        elsif v_request.request_type = 'handover' then
          update public.team_project_tasks set assignee_id = (v_request.request_data ->> 'targetId')::uuid, assignment_status = 'pending', revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        elsif v_request.request_type = 'help' then
          v_parent_id := gen_random_uuid();
          insert into public.team_project_tasks(id, project_id, parent_task_id, title, description, created_by, assignee_id, assignment_status, due_on, priority)
            values (v_parent_id, v_project_id, v_task.id, pg_catalog.left('协助：' || v_task.title, 160),
              pg_catalog.left('协助说明：' || v_request.reason, 3000), v_request.requester_id,
              (v_request.request_data ->> 'targetId')::uuid, 'pending', v_task.due_on, v_task.priority);
          insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
            values (v_project_id, v_parent_id, p_actor_id, 'created', pg_catalog.jsonb_build_object('title', pg_catalog.left('协助：' || v_task.title, 160), 'parentTaskId', v_task.id));
          insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
            values (v_project_id, v_parent_id, p_actor_id, 'assigned', pg_catalog.jsonb_build_object('assigneeId', v_request.request_data ->> 'targetId'));
          update public.team_project_tasks set revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        elsif v_request.request_type = 'unable_to_continue' then
          update public.team_project_tasks set assignee_id = null, assignment_status = 'none', revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        elsif v_request.request_type = 'split' then
          for v_item in select pg_catalog.jsonb_array_elements(v_request.request_data -> 'subtasks') loop
            v_subtask_title := pg_catalog.btrim(v_item #>> '{}');
            if pg_catalog.char_length(v_subtask_title) not between 1 and 160 then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
            v_parent_id := gen_random_uuid();
            insert into public.team_project_tasks(id, project_id, parent_task_id, title, created_by)
              values (v_parent_id, v_project_id, v_task.id, v_subtask_title, v_request.requester_id);
            insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
              values (v_project_id, v_parent_id, p_actor_id, 'created', pg_catalog.jsonb_build_object('title', v_subtask_title, 'parentTaskId', v_task.id));
          end loop;
          update public.team_project_tasks set revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
        end if;
        update public.team_project_adjustment_requests set status = 'approved', decision_by = p_actor_id,
          decision_note = v_name, resolved_at = pg_catalog.now() where id = v_request_id;
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_task.id, p_actor_id, 'adjustment_approved', pg_catalog.jsonb_build_object('requestId', v_request_id, 'type', v_request.request_type, 'note', v_name));
      end if;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'adjustment_decided', pg_catalog.jsonb_build_object('requestId', v_request_id, 'taskId', v_task.id, 'decision', v_decision));
      return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', case when v_decision = 'approve' then 'approved' else 'rejected' end);

    when 'adjustment_cancel' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_request_id := (p_payload ->> 'requestId')::uuid;
      select * into v_request from public.team_project_adjustment_requests where id = v_request_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_REQUEST_NOT_FOUND', errcode = 'P0002'; end if;
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or (v_request.requester_id is distinct from p_actor_id and v_role not in ('owner', 'admin')) then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_request.status = 'cancelled' then return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', 'cancelled'); end if;
      if v_request.status <> 'pending' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      update public.team_project_adjustment_requests set status = 'cancelled', decision_by = p_actor_id, resolved_at = pg_catalog.now() where id = v_request_id;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        values (v_project_id, v_request.task_id, p_actor_id, 'adjustment_cancelled', pg_catalog.jsonb_build_object('requestId', v_request_id));
      return pg_catalog.jsonb_build_object('requestId', v_request_id, 'status', 'cancelled');

    when 'deliverable_create' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_deliverable_id := (p_payload ->> 'id')::uuid;
      v_task_id := nullif(p_payload ->> 'taskId', '')::uuid;
      v_target_id := nullif(p_payload ->> 'reviewerId', '')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'title', ''));
      v_description := pg_catalog.btrim(coalesce(p_payload ->> 'instructions', ''));
      select member.role into v_role from public.team_project_members member
        where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null or v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then
        raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001';
      end if;
      if v_name = '' or pg_catalog.char_length(v_name) > 160 or pg_catalog.char_length(v_description) > 3000 then raise exception using message = 'QIXING_INVALID_DELIVERABLE', errcode = '22023'; end if;
      if v_task_id is not null and not exists(select 1 from public.team_project_tasks where id = v_task_id and project_id = v_project_id) then raise exception using message = 'QIXING_TASK_NOT_FOUND', errcode = 'P0002'; end if;
      if v_target_id is not null and not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = v_target_id and status = 'active') then raise exception using message = 'QIXING_INVALID_MEMBER', errcode = '22023'; end if;
      if v_task_id is not null and exists(select 1 from public.team_project_deliverables where task_id = v_task_id and id <> v_deliverable_id) then raise exception using message = 'QIXING_DUPLICATE_DELIVERABLE', errcode = '23505'; end if;
      insert into public.team_project_deliverables(id, project_id, task_id, title, instructions, required, review_required, reviewer_id, created_by)
        values (v_deliverable_id, v_project_id, v_task_id, v_name, v_description,
          coalesce((p_payload ->> 'required')::boolean, true), coalesce((p_payload ->> 'reviewRequired')::boolean, true), v_target_id, p_actor_id)
        on conflict (id) do nothing;
      if found then
        insert into public.team_project_activity(project_id, actor_id, event_type, details)
          values (v_project_id, p_actor_id, 'deliverable_created', pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'title', v_name));
      else
        select * into v_deliverable from public.team_project_deliverables where id = v_deliverable_id;
        if v_deliverable.project_id is distinct from v_project_id or v_deliverable.created_by is distinct from p_actor_id
          or v_deliverable.task_id is distinct from v_task_id or v_deliverable.title is distinct from v_name
          or v_deliverable.instructions is distinct from v_description or v_deliverable.required is distinct from coalesce((p_payload ->> 'required')::boolean, true)
          or v_deliverable.review_required is distinct from coalesce((p_payload ->> 'reviewRequired')::boolean, true)
          or v_deliverable.reviewer_id is distinct from v_target_id then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
      end if;
      return pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id);

    when 'deliverables' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', deliverable.id, 'taskId', deliverable.task_id, 'taskTitle', task.title,
        'title', deliverable.title, 'instructions', deliverable.instructions, 'required', deliverable.required,
        'reviewRequired', deliverable.review_required, 'reviewerId', deliverable.reviewer_id,
        'reviewerName', coalesce(nullif(reviewer.nickname, ''), ''), 'createdAt', deliverable.created_at,
        'draft', (select pg_catalog.jsonb_build_object('content', draft.content, 'revision', draft.revision, 'updatedAt', draft.updated_at)
          from public.team_project_deliverable_drafts draft where draft.deliverable_id = deliverable.id and draft.user_id = p_actor_id),
        'versions', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', version.id, 'number', version.version_number, 'submittedBy', version.submitted_by,
            'submitterName', coalesce(nullif(submitter.nickname, ''), '成员'), 'content', version.content,
            'changeNote', version.change_note, 'reviewStatus', version.review_status, 'createdAt', version.created_at,
            'review', case when review.version_id is null then null else pg_catalog.jsonb_build_object(
              'result', review.result, 'reviewerId', review.reviewer_id, 'reviewerName', coalesce(nullif(review_profile.nickname, ''), '成员'),
              'feedback', review.feedback, 'checklist', review.checklist, 'createdAt', review.created_at) end
          ) order by version.version_number desc)
          from public.team_project_result_versions version
          left join public.social_profiles submitter on submitter.user_id = version.submitted_by
          left join public.team_project_reviews review on review.version_id = version.id
          left join public.social_profiles review_profile on review_profile.user_id = review.reviewer_id
          where version.deliverable_id = deliverable.id
        ), '[]'::jsonb)
      ) order by deliverable.created_at), '[]'::jsonb)
        into v_json
        from public.team_project_deliverables deliverable
        left join public.team_project_tasks task on task.id = deliverable.task_id
        left join public.social_profiles reviewer on reviewer.user_id = deliverable.reviewer_id
        where deliverable.project_id = v_project_id;
      return pg_catalog.jsonb_build_object('deliverables', v_json);

    when 'deliverable_draft_save' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_deliverable_id := (p_payload ->> 'deliverableId')::uuid;
      v_expected_revision := (p_payload ->> 'expectedRevision')::integer;
      v_content := p_payload -> 'content';
      if jsonb_typeof(v_content) is distinct from 'object' or pg_catalog.octet_length(v_content::text) > 45000 then raise exception using message = 'QIXING_INVALID_DELIVERABLE', errcode = '22023'; end if;
      if coalesce(p_payload ->> 'expectedRevision', '') !~ '^(0|[1-9][0-9]*)$' then raise exception using message = 'QIXING_INVALID_REQUEST', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select * into v_deliverable from public.team_project_deliverables where id = v_deliverable_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_DELIVERABLE_NOT_FOUND', errcode = 'P0002'; end if;
      if v_deliverable.task_id is not null then
        select * into v_task from public.team_project_tasks where id = v_deliverable.task_id;
        select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
        if v_role not in ('owner', 'admin') and (v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      end if;
      if v_deliverable.review_required and exists(select 1 from public.team_project_result_versions where deliverable_id = v_deliverable_id and review_status = 'pending') then
        raise exception using message = 'QIXING_REVIEW_PENDING', errcode = '40901';
      end if;
      select * into v_draft from public.team_project_deliverable_drafts where deliverable_id = v_deliverable_id and user_id = p_actor_id for update;
      if not found then
        if v_expected_revision <> 0 then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
        insert into public.team_project_deliverable_drafts(deliverable_id, user_id, content) values (v_deliverable_id, p_actor_id, v_content);
        return pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'revision', 1);
      end if;
      if v_expected_revision <> v_draft.revision then
        if v_draft.content = v_content then return pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'revision', v_draft.revision); end if;
        raise exception using message = 'QIXING_CONFLICT', errcode = '40001';
      end if;
      update public.team_project_deliverable_drafts set content = v_content, revision = revision + 1, updated_at = pg_catalog.now()
        where deliverable_id = v_deliverable_id and user_id = p_actor_id;
      return pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'revision', v_expected_revision + 1);

    when 'deliverable_submit' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_deliverable_id := (p_payload ->> 'deliverableId')::uuid;
      v_version_id := (p_payload ->> 'versionId')::uuid;
      v_submission_key := (p_payload ->> 'submissionKey')::uuid;
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'changeNote', ''));
      if pg_catalog.char_length(v_name) > 1500 then raise exception using message = 'QIXING_INVALID_DELIVERABLE', errcode = '22023'; end if;
      if not exists(select 1 from public.team_project_members where project_id = v_project_id and user_id = p_actor_id and status = 'active') then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      if not exists(select 1 from public.team_projects where id = v_project_id and status = 'active') then raise exception using message = 'QIXING_PROJECT_NOT_ACTIVE', errcode = '40001'; end if;
      select * into v_result_version from public.team_project_result_versions where submission_key = v_submission_key;
      if found then
        if v_result_version.deliverable_id is distinct from v_deliverable_id or v_result_version.submitted_by is distinct from p_actor_id then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
        return pg_catalog.jsonb_build_object('versionId', v_result_version.id, 'version', v_result_version.version_number, 'reviewStatus', v_result_version.review_status);
      end if;
      select * into v_deliverable from public.team_project_deliverables where id = v_deliverable_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_DELIVERABLE_NOT_FOUND', errcode = 'P0002'; end if;
      select * into v_result_version from public.team_project_result_versions where submission_key = v_submission_key;
      if found then
        if v_result_version.deliverable_id is distinct from v_deliverable_id or v_result_version.submitted_by is distinct from p_actor_id then raise exception using message = 'QIXING_CONFLICT', errcode = '40001'; end if;
        return pg_catalog.jsonb_build_object('versionId', v_result_version.id, 'version', v_result_version.version_number, 'reviewStatus', v_result_version.review_status);
      end if;
      if v_deliverable.review_required and exists(select 1 from public.team_project_result_versions where deliverable_id = v_deliverable_id and review_status = 'pending') then raise exception using message = 'QIXING_REVIEW_PENDING', errcode = '40901'; end if;
      if v_deliverable.task_id is not null then
        select * into v_task from public.team_project_tasks where id = v_deliverable.task_id;
        select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
        if v_role not in ('owner', 'admin') and (v_task.assignee_id is distinct from p_actor_id or v_task.assignment_status <> 'accepted') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      end if;
      select * into v_draft from public.team_project_deliverable_drafts where deliverable_id = v_deliverable_id and user_id = p_actor_id for update;
      if not found then raise exception using message = 'QIXING_DRAFT_REQUIRED', errcode = 'P0002'; end if;
      if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_draft.content ->> 'summary', ''))) = 0
        and coalesce(jsonb_array_length(v_draft.content -> 'links'), 0) = 0
        and coalesce(jsonb_array_length(v_draft.content -> 'files'), 0) = 0 then
        raise exception using message = 'QIXING_INVALID_DELIVERABLE', errcode = '22023';
      end if;
      select coalesce(pg_catalog.max(version_number), 0) + 1 into v_version_number from public.team_project_result_versions where deliverable_id = v_deliverable_id;
      insert into public.team_project_result_versions(id, deliverable_id, project_id, version_number, submission_key, submitted_by, content, change_note, review_status)
        values (v_version_id, v_deliverable_id, v_project_id, v_version_number, v_submission_key, p_actor_id,
          v_draft.content, v_name, case when v_deliverable.review_required then 'pending' else 'not_required' end);
      if v_deliverable.review_required and v_deliverable.task_id is not null then
        select * into v_task from public.team_project_tasks where id = v_deliverable.task_id for update;
        if v_task.status <> 'review' then
          update public.team_project_tasks set status = 'review', completed_at = null, revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
          insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
            values (v_project_id, v_task.id, p_actor_id, 'status_changed', pg_catalog.jsonb_build_object('from', v_task.status, 'to', 'review', 'source', 'deliverable'));
        end if;
      end if;
      insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
        select v_project_id, v_deliverable.task_id, p_actor_id, 'result_submitted', pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'version', v_version_number)
        where v_deliverable.task_id is not null;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'result_submitted', pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'version', v_version_number));
      return pg_catalog.jsonb_build_object('versionId', v_version_id, 'version', v_version_number,
        'reviewStatus', case when v_deliverable.review_required then 'pending' else 'not_required' end);

    when 'deliverable_review' then
      v_project_id := (p_payload ->> 'projectId')::uuid;
      v_deliverable_id := (p_payload ->> 'deliverableId')::uuid;
      v_version_id := (p_payload ->> 'versionId')::uuid;
      v_decision := p_payload ->> 'result';
      v_name := pg_catalog.btrim(coalesce(p_payload ->> 'feedback', ''));
      v_content := coalesce(p_payload -> 'checklist', '[]'::jsonb);
      if v_decision not in ('approved', 'returned') or v_name = '' or pg_catalog.char_length(v_name) > 3000
        or jsonb_typeof(v_content) is distinct from 'array' or pg_catalog.octet_length(v_content::text) > 20000 then raise exception using message = 'QIXING_INVALID_REVIEW', errcode = '22023'; end if;
      if v_decision = 'approved' and exists(select 1 from jsonb_array_elements(v_content) item
        where jsonb_typeof(item) <> 'object' or coalesce(item ->> 'passed', 'false') <> 'true') then
        raise exception using message = 'QIXING_INVALID_REVIEW', errcode = '22023';
      end if;
      select member.role into v_role from public.team_project_members member where member.project_id = v_project_id and member.user_id = p_actor_id and member.status = 'active';
      if v_role is null then raise exception using message = 'QIXING_NOT_MEMBER', errcode = '42501'; end if;
      select * into v_deliverable from public.team_project_deliverables where id = v_deliverable_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_DELIVERABLE_NOT_FOUND', errcode = 'P0002'; end if;
      select * into v_result_version from public.team_project_result_versions where id = v_version_id and deliverable_id = v_deliverable_id and project_id = v_project_id for update;
      if not found then raise exception using message = 'QIXING_VERSION_NOT_FOUND', errcode = 'P0002'; end if;
      if v_deliverable.reviewer_id is not null then
        if v_deliverable.reviewer_id <> p_actor_id then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      elsif v_role not in ('owner', 'admin') then raise exception using message = 'QIXING_FORBIDDEN', errcode = '42501'; end if;
      if v_result_version.submitted_by = p_actor_id then raise exception using message = 'QIXING_SELF_REVIEW', errcode = '42501'; end if;
      select * into v_review from public.team_project_reviews where version_id = v_version_id;
      if found then
        if v_review.result = v_decision and v_review.feedback = v_name and v_review.checklist = v_content then return pg_catalog.jsonb_build_object('versionId', v_version_id, 'result', v_decision); end if;
        raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001';
      end if;
      if v_result_version.review_status <> 'pending' then raise exception using message = 'QIXING_STATE_CHANGED', errcode = '40001'; end if;
      insert into public.team_project_reviews(version_id, reviewer_id, result, feedback, checklist)
        values (v_version_id, p_actor_id, v_decision, v_name, v_content);
      update public.team_project_result_versions set review_status = v_decision where id = v_version_id;
      if v_deliverable.task_id is not null then
        select * into v_task from public.team_project_tasks where id = v_deliverable.task_id for update;
        if v_task.status = 'review' then
          update public.team_project_tasks set status = case when v_decision = 'approved' then 'completed' else 'in_progress' end,
            completed_at = case when v_decision = 'approved' then pg_catalog.now() else null end,
            revision = revision + 1, updated_at = pg_catalog.now() where id = v_task.id;
          insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
            values (v_project_id, v_task.id, p_actor_id, 'status_changed', pg_catalog.jsonb_build_object('from', 'review', 'to', case when v_decision = 'approved' then 'completed' else 'in_progress' end, 'source', 'review'));
        end if;
        insert into public.team_project_task_events(project_id, task_id, actor_id, event_type, details)
          values (v_project_id, v_deliverable.task_id, p_actor_id, case when v_decision = 'approved' then 'review_approved' else 'review_returned' end,
            pg_catalog.jsonb_build_object('version', v_result_version.version_number, 'feedback', v_name));
      end if;
      insert into public.team_project_activity(project_id, actor_id, event_type, details)
        values (v_project_id, p_actor_id, 'review_completed', pg_catalog.jsonb_build_object('deliverableId', v_deliverable_id, 'version', v_result_version.version_number, 'result', v_decision));
      return pg_catalog.jsonb_build_object('versionId', v_version_id, 'result', v_decision);

    else
      raise exception using message = 'QIXING_INVALID_ACTION', errcode = '22023';
  end case;
end;
$$;

revoke all on function public.project_dispatch(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.project_dispatch(text, uuid, jsonb) to service_role;
