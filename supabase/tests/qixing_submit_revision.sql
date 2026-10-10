-- Disposable local database only; fictional fixtures are rolled back.
begin;
select set_config('qixing_test.actor', gen_random_uuid()::text, true);
insert into auth.users(id, email_confirmed_at) values (current_setting('qixing_test.actor')::uuid, now());
set local role service_role;
do $$
declare
  actor uuid := current_setting('qixing_test.actor')::uuid;
  project uuid := gen_random_uuid();
  deliverable uuid := gen_random_uuid();
  version uuid := gen_random_uuid();
  submission uuid := gen_random_uuid();
  result jsonb;
  denied boolean := false;
begin
  perform public.project_dispatch('create', actor, jsonb_build_object('id', project, 'name', 'Fictional revision project', 'type', 'blank'));
  perform public.project_dispatch('deliverable_create', actor, jsonb_build_object('id', deliverable, 'projectId', project, 'title', 'Fictional result', 'reviewRequired', false));
  perform public.project_dispatch('deliverable_draft_save', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'expectedRevision', 0, 'content', jsonb_build_object('summary', 'Fictional original')));
  perform public.project_dispatch('deliverable_draft_save', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'expectedRevision', 1, 'content', jsonb_build_object('summary', 'Fictional other tab')));
  begin
    perform public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', version, 'submissionKey', submission, 'expectedRevision', 1));
  exception when serialization_failure then
    if sqlerrm <> 'QIXING_CONFLICT' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Stale draft revision was submitted'; end if;
  if exists(select 1 from public.team_project_result_versions where id = version) then raise exception 'Rejected submission left a version'; end if;
  result := public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', version, 'submissionKey', submission, 'expectedRevision', 2));
  if result ->> 'versionId' <> version::text then raise exception 'Current draft could not be submitted'; end if;
  perform public.project_dispatch('deliverable_draft_save', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'expectedRevision', 2, 'content', jsonb_build_object('summary', 'Fictional later draft')));
  result := public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', gen_random_uuid(), 'submissionKey', submission, 'expectedRevision', 2));
  if result ->> 'versionId' <> version::text then raise exception 'Lost-response retry created another version'; end if;
  if (select content ->> 'summary' from public.team_project_result_versions where id = version) <> 'Fictional other tab' then raise exception 'Frozen version changed with draft'; end if;
  if (select count(*) from public.team_project_result_versions where deliverable_id = deliverable) <> 1 then raise exception 'Retry duplicated a result'; end if;
  -- Older deployed clients remain compatible during the rollout.
  result := public.project_dispatch('deliverable_submit', actor, jsonb_build_object('projectId', project, 'deliverableId', deliverable, 'versionId', gen_random_uuid(), 'submissionKey', gen_random_uuid()));
  if (result ->> 'version')::integer <> 2 then raise exception 'Legacy submit contract broke'; end if;
end;
$$;
rollback;
