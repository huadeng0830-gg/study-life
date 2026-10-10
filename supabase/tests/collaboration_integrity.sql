-- Run against a disposable local database after all migrations. Every fixture
-- is fictional and the transaction is rolled back, including expected failures.
begin;
select set_config('study_life_test.actor', gen_random_uuid()::text, true);
select set_config('study_life_test.peer', gen_random_uuid()::text, true);
select set_config('study_life_test.outsider', gen_random_uuid()::text, true);
insert into auth.users(id, email_confirmed_at) values
  (current_setting('study_life_test.actor')::uuid, now()),
  (current_setting('study_life_test.peer')::uuid, now()),
  (current_setting('study_life_test.outsider')::uuid, now());
set local role service_role;

do $$
declare
  actor uuid := current_setting('study_life_test.actor')::uuid;
  peer uuid := current_setting('study_life_test.peer')::uuid;
  outsider uuid := current_setting('study_life_test.outsider')::uuid;
  project uuid := gen_random_uuid();
  other_project uuid := gen_random_uuid();
  prerequisite uuid := gen_random_uuid();
  dependent uuid := gen_random_uuid();
  deliverable uuid := gen_random_uuid();
  version uuid := gen_random_uuid();
  meeting uuid := gen_random_uuid();
  other_meeting uuid := gen_random_uuid();
  starts timestamptz := date_trunc('hour', now()) + interval '2 days';
  ends timestamptz := starts + interval '1 hour';
  result jsonb;
  denied boolean;
begin
  perform public.project_dispatch('create', actor, jsonb_build_object('id', project, 'name', 'Fictional project', 'type', 'blank'));
  perform public.project_dispatch('member_invite', actor, jsonb_build_object('projectId', project, 'targetId', peer));
  perform public.project_dispatch('invite_respond', peer, jsonb_build_object('projectId', project, 'decision', 'accept'));
  if (public.project_dispatch('detail', peer, jsonb_build_object('projectId', project)) -> 'project' ->> 'id') <> project::text then
    raise exception 'Active member cannot read project';
  end if;
  denied := false;
  begin
    perform public.project_dispatch('detail', outsider, jsonb_build_object('projectId', project));
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Outsider can read project'; end if;

  perform public.project_dispatch('task_create', actor, jsonb_build_object('id', prerequisite, 'projectId', project, 'title', 'Fictional prerequisite'));
  perform public.project_dispatch('task_create', actor, jsonb_build_object('id', dependent, 'projectId', project, 'title', 'Fictional dependent', 'dependsOnTaskId', prerequisite));
  perform public.project_dispatch('deliverable_create', actor, jsonb_build_object('id', deliverable, 'projectId', project, 'taskId', dependent, 'title', 'Fictional deliverable', 'reviewerId', peer));
  perform public.project_dispatch('deliverable_draft_save', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'expectedRevision', 0,
    'content', jsonb_build_object('summary', 'Fictional result', 'links', '[]'::jsonb, 'files', '[]'::jsonb)));
  denied := false;
  begin
    perform public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', version, 'submissionKey', version));
  exception when serialization_failure then
    if sqlerrm <> 'QIXING_TASK_DEPENDENCY_BLOCKED' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Submission bypassed incomplete prerequisite'; end if;
  if exists(select 1 from public.team_project_result_versions where id = version) then raise exception 'Rejected submission left a result version'; end if;
  perform public.project_dispatch('task_status', actor, jsonb_build_object('projectId', project, 'taskId', prerequisite, 'status', 'completed'));
  result := public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', version, 'submissionKey', version));
  if result ->> 'reviewStatus' <> 'pending' then raise exception 'Valid submission rejected'; end if;
  perform public.project_dispatch('deliverable_review', peer, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', version, 'result', 'approved', 'feedback', 'Fictional verification', 'checklist', '[]'::jsonb));
  denied := false;
  begin
    perform public.project_dispatch('task_status', actor, jsonb_build_object('projectId', project, 'taskId', prerequisite, 'status', 'todo'));
  exception when serialization_failure then
    if sqlerrm <> 'QIXING_TASK_DEPENDENCY_IN_USE' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Completed prerequisite reopened with completed dependent'; end if;

  perform public.project_dispatch('meeting_create', actor, jsonb_build_object('id', meeting, 'projectId', project, 'title', 'Fictional meeting', 'startsAt', starts, 'endsAt', ends));
  perform public.project_dispatch('meeting_respond', peer, jsonb_build_object('projectId', project, 'meetingId', meeting, 'response', 'accept'));
  perform public.project_dispatch('meeting_confirm', actor, jsonb_build_object('projectId', project, 'meetingId', meeting));
  perform public.project_dispatch('create', actor, jsonb_build_object('id', other_project, 'name', 'Fictional second project', 'type', 'blank'));
  perform public.project_dispatch('member_invite', actor, jsonb_build_object('projectId', other_project, 'targetId', outsider));
  perform public.project_dispatch('invite_respond', outsider, jsonb_build_object('projectId', other_project, 'decision', 'accept'));
  perform public.project_dispatch('meeting_create', actor, jsonb_build_object('id', other_meeting, 'projectId', other_project, 'title', 'Fictional overlap', 'startsAt', starts, 'endsAt', ends));
  perform public.project_dispatch('meeting_respond', outsider, jsonb_build_object('projectId', other_project, 'meetingId', other_meeting, 'response', 'accept'));
  denied := false;
  begin
    perform public.project_dispatch('meeting_confirm', actor, jsonb_build_object('projectId', other_project, 'meetingId', other_meeting));
  exception when exclusion_violation then
    if sqlerrm <> 'QIXING_MEETING_SLOT_CONFLICT' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Overlapping projects double-booked a member'; end if;
  if (select status from public.team_project_meetings where id = other_meeting) <> 'open' then raise exception 'Rejected confirmation changed meeting state'; end if;
  denied := false;
  begin
    perform private.social_assert_no_invite_overlap(array[actor, outsider], starts, ends, null);
  exception when exclusion_violation then
    if sqlerrm <> 'SOCIAL_INVITATION_CONFLICT' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Social invitation ignored confirmed project meeting'; end if;

  -- An adjacent meeting is valid; boundaries use half-open intervals.
  update public.team_project_meetings set starts_at = ends, ends_at = ends + interval '1 hour' where id = other_meeting;
  result := public.project_dispatch('meeting_confirm', actor, jsonb_build_object('projectId', other_project, 'meetingId', other_meeting));
  if result ->> 'status' <> 'confirmed' then raise exception 'Adjacent meeting rejected'; end if;
  perform set_config('study_life_test.project', project::text, true);
end;
$$;

reset role;
set local role authenticated;
do $$
declare denied boolean := false;
begin
  begin
    perform public.project_dispatch('detail', current_setting('study_life_test.actor')::uuid,
      jsonb_build_object('projectId', current_setting('study_life_test.project')));
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Authenticated client can forge service RPC actor'; end if;
  denied := false;
  begin
    perform qixing_private.project_dispatch_core('list', current_setting('study_life_test.actor')::uuid, '{}'::jsonb);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Authenticated client can bypass RPC wrapper'; end if;
end;
$$;
reset role;
rollback;
