-- Add a single, time-limited reporter appeal after a report was dismissed.
-- Existing reports keep their original outcome and moderation history.
alter table public.campus_content_reports
  add column appeal_status text not null default 'none'
    check (appeal_status in ('none','pending_review','upheld','accepted')),
  add column appeal_reason text not null default '' check (char_length(appeal_reason) <= 500),
  add column appealed_at timestamptz,
  add column appeal_resolution text not null default '' check (char_length(appeal_resolution) <= 500),
  add column appeal_resolved_by uuid references auth.users(id) on delete set null,
  add column appeal_resolved_at timestamptz;

comment on column public.campus_content_reports.appeal_status is
  'One-time reporter appeal state: none, pending_review, upheld (original dismissal stands), or accepted.';
comment on column public.campus_content_reports.appeal_reason is
  'Private appeal context visible only to the reporter and authorized campus reviewers.';

create index campus_reports_appeal_queue on public.campus_content_reports(appealed_at)
  where appeal_status = 'pending_review';

create function public.campus_submit_report_appeal(p_actor uuid,p_report uuid,p_reason text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_report public.campus_content_reports;
begin
  select * into v_report from public.campus_content_reports where id=p_report for update;
  if not found then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if v_report.reporter_id is distinct from p_actor then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_revision is distinct from v_report.revision then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if v_report.status <> 'dismissed' or v_report.appeal_status <> 'none'
    or v_report.resolved_at is null or now() > v_report.resolved_at + interval '7 days' then
    raise exception 'CAMPUS_APPEAL_NOT_AVAILABLE';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'CAMPUS_INVALID_INPUT'; end if;

  update public.campus_content_reports
    set appeal_status='pending_review',appeal_reason=btrim(p_reason),appealed_at=now(),revision=revision+1
    where id=p_report;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_report.school,v_report.campus,'report_appeal',p_report,'dismissed','appeal_pending_review',btrim(p_reason));
  return jsonb_build_object('id',p_report,'appealStatus','pending_review');
end;
$$;

create or replace function public.campus_governance_target(p_type text,p_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_table text; v_status text:='review_status'; v_owner text:='owner_id'; v_row jsonb; v_parent jsonb;
begin
  case p_type
    when 'place' then v_table:='campus_places';
    when 'teacher' then v_table:='campus_teachers';
    when 'course' then v_table:='campus_courses';
    when 'assignment' then v_table:='campus_teaching_assignments';
    when 'course_review' then v_table:='campus_course_reviews'; v_owner:='user_id';
    when 'market_listing' then v_table:='campus_market_listings'; v_status:='status';
    when 'help_task' then v_table:='campus_help_tasks'; v_status:='status';
    when 'help_dispute' then v_table:='campus_help_disputes'; v_status:='status'; v_owner:='opened_by';
    when 'shuttle_route' then v_table:='campus_shuttle_routes'; v_status:='status';
    when 'shuttle_correction' then v_table:='campus_shuttle_corrections'; v_status:='status';
    when 'shuttle_exception' then v_table:='campus_shuttle_exceptions'; v_status:='status';
    when 'lost_found' then v_table:='campus_lost_found_items'; v_status:='status';
    when 'event' then v_table:='campus_events';
    when 'guide' then v_table:='campus_guides';
    when 'matter' then v_table:='campus_matters'; v_owner:='author_id';
    when 'matter_response' then v_table:='campus_matter_responses'; v_owner:='author_id';
    when 'matter_clarification' then v_table:='campus_matter_clarifications'; v_owner:='asker_id';
    when 'report' then v_table:='campus_content_reports'; v_status:='status'; v_owner:='reporter_id';
    when 'report_appeal' then v_table:='campus_content_reports'; v_status:='appeal_status'; v_owner:='reporter_id';
    else raise exception 'CAMPUS_INVALID_INPUT';
  end case;
  execute format('select to_jsonb(t) from public.%I t where id=$1%s',v_table,case when p_lock then ' for update' else '' end)
    into v_row using p_id;
  if v_row is null then return null; end if;
  if p_type='course_review' then
    v_parent:=public.campus_governance_target('assignment',(v_row->>'assignment_id')::uuid);
  elsif p_type in ('shuttle_exception','shuttle_correction') then
    v_parent:=public.campus_governance_target('shuttle_route',(v_row->>'route_id')::uuid);
  elsif p_type='help_dispute' then
    v_parent:=public.campus_governance_target('help_task',(v_row->>'task_id')::uuid);
    v_row:=v_row||jsonb_build_object('task',v_parent-ARRAY['_table','_status','_owner','owner_id','assignee_id']);
  elsif p_type='matter_response' then
    v_parent:=public.campus_governance_target('matter',(v_row->>'matter_id')::uuid);
    v_row:=v_row||jsonb_build_object('matter',v_parent-ARRAY['_table','_status','_owner','owner_id','author_id']);
  elsif p_type='matter_clarification' then
    v_parent:=public.campus_governance_target('matter',(v_row->>'matter_id')::uuid);
    v_row:=v_row||jsonb_build_object('matter',v_parent-ARRAY['_table','_status','_owner','owner_id','author_id']);
  elsif p_type in ('report','report_appeal') then
    v_parent:=public.campus_governance_target(v_row->>'target_type',(v_row->>'target_id')::uuid);
    v_row:=v_row||jsonb_build_object('target',v_parent-ARRAY['_table','_status','_owner','owner_id','user_id','reporter_id']);
  end if;
  if v_parent is not null then v_row:=v_row||jsonb_build_object('school',v_parent->>'school','campus',coalesce(v_parent->>'campus','')); end if;
  return v_row||jsonb_build_object('_table',v_table,'_status',v_status,'_owner',v_row->>v_owner,'campus',coalesce(v_row->>'campus',''));
end;
$$;

create or replace function public.campus_governance_queue(p_actor_id uuid,p_offset integer default 0,p_limit integer default 30,
  p_type text default '',p_school text default '') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_items jsonb; v_total integer; v_counts jsonb;
begin
  if p_offset<0 or p_offset>100000 or p_limit<1 or p_limit>100 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  with pending as (
    select 'place'::text type,id,updated_at as created_at from public.campus_places where review_status='pending' and visibility='school' and archived_at is null
    union all select 'teacher',id,created_at from public.campus_teachers where review_status='pending_review'
    union all select 'course',id,created_at from public.campus_courses where review_status='pending_review'
    union all select 'assignment',id,created_at from public.campus_teaching_assignments where review_status='pending_review'
    union all select 'course_review',id,created_at from public.campus_course_reviews where review_status='pending_review'
    union all select 'market_listing',id,created_at from public.campus_market_listings where status='pending_review'
    union all select 'help_task',id,created_at from public.campus_help_tasks where status='pending_review'
    union all select 'help_dispute',id,created_at from public.campus_help_disputes where status='open'
    union all select 'shuttle_route',id,created_at from public.campus_shuttle_routes where status='pending_review'
    union all select 'shuttle_correction',id,created_at from public.campus_shuttle_corrections where status='pending_review'
    union all select 'shuttle_exception',id,created_at from public.campus_shuttle_exceptions where status='pending_review'
    union all select 'lost_found',id,created_at from public.campus_lost_found_items where status='pending_review'
    union all select 'event',id,created_at from public.campus_events where review_status='pending_review'
    union all select 'guide',id,created_at from public.campus_guides where review_status='pending_review'
    union all select 'matter',id,created_at from public.campus_matters where review_status='pending_review' and deleted_at is null
    union all select 'matter_response',id,created_at from public.campus_matter_responses where review_status='pending_review' and deleted_at is null
    union all select 'matter_clarification',id,created_at from public.campus_matter_clarifications where review_status='pending_review' and deleted_at is null
    union all select 'report',id,created_at from public.campus_content_reports where status='pending_review'
    union all select 'report_appeal',id,appealed_at from public.campus_content_reports where appeal_status='pending_review'
  ), scoped as materialized (
    select p.*,t.item from pending p cross join lateral (select public.campus_governance_target(p.type,p.id) item) t
    where public.campus_can_review(p_actor_id,t.item->>'school',t.item->>'campus') and (p_school='' or t.item->>'school'=p_school)
  ), filtered as materialized (select * from scoped where p_type='' or type=p_type), paged as (
    select * from filtered order by created_at,type,id offset p_offset limit p_limit
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('type',type,'item',
      (case when type in ('report','report_appeal') then item||jsonb_build_object('response_due_at',
        coalesce(item->>'appealed_at',item->>'created_at')::timestamptz+interval '72 hours') else item end)
        -ARRAY['_table','_status','_owner','owner_id','user_id','reporter_id']) order by created_at,type,id),'[]') from paged),
    (select count(*) from filtered),(select coalesce(jsonb_object_agg(type,n),'{}') from (select type,count(*) n from scoped group by type)c)
    into v_items,v_total,v_counts;
  return jsonb_build_object('items',v_items,'total',v_total,'counts',v_counts,'hasMore',p_offset+p_limit<v_total);
end;
$$;

create or replace function public.campus_resolve_report(p_actor uuid,p_report uuid,p_decision text,p_reason text,
  p_revision integer,p_target_revision text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_report jsonb; v_target jsonb; v_status text; v_owner uuid; v_result text; v_is_appeal boolean;
begin
  v_report:=public.campus_governance_target('report',p_report,true);
  if v_report is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor,v_report->>'school',v_report->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if v_report->>'reporter_id'=p_actor::text then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  v_is_appeal:=v_report->>'appeal_status'='pending_review';
  if (v_report->>'status'<>'pending_review' and not v_is_appeal)
    or p_revision is distinct from (v_report->>'revision')::integer then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if v_is_appeal and v_report->>'resolved_by'=p_actor::text then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if p_decision not in ('remove','dismiss','resolve') or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_target:=public.campus_governance_target(v_report->>'target_type',(v_report->>'target_id')::uuid,true);
  if v_target->>'_owner'=p_actor::text then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if v_target is not null and p_target_revision is distinct from coalesce(v_target->>'review_revision',v_target->>'revision') then
    raise exception 'CAMPUS_REVISION_CHANGED';
  end if;
  if p_decision='remove' then
    if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
    v_owner:=(v_target->>'_owner')::uuid;
    v_status:=v_target->>(v_target->>'_status');
    if v_report->>'target_type'='help_task' and v_status in ('assigned','in_progress','awaiting_confirmation','disputed') then raise exception 'CAMPUS_USE_DISPUTE'; end if;
    if v_report->>'target_type'='place' then
      update public.campus_places set review_status='rejected',review_reason=p_reason,review_revision=gen_random_uuid(),updated_at=now() where id=(v_report->>'target_id')::uuid;
    else
      execute format('update public.%I set %I=''rejected'',review_reason=$2,revision=revision+1 where id=$1',v_target->>'_table',v_target->>'_status')
        using (v_report->>'target_id')::uuid,p_reason;
    end if;
    insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
      values(p_actor,v_report->>'school',v_report->>'campus',v_report->>'target_type',(v_report->>'target_id')::uuid,v_status,'rejected',p_reason);
  end if;
  v_result:=case when p_decision='dismiss' then 'dismissed' else 'resolved' end;
  -- Keep the original report decision intact after an appeal. The appeal outcome
  -- has its own fields, while revision still advances to invalidate stale queue items.
  update public.campus_content_reports set
    status=case when v_is_appeal then status else v_result end,
    resolution=case when v_is_appeal then resolution else p_reason end,
    resolution_action=case when v_is_appeal then resolution_action else p_decision end,
    resolved_by=case when v_is_appeal then resolved_by else p_actor end,
    resolved_at=case when v_is_appeal then resolved_at else now() end,
    revision=revision+1,
    appeal_status=case when v_is_appeal then case when p_decision='dismiss' then 'upheld' else 'accepted' end else appeal_status end,
    appeal_resolution=case when v_is_appeal then p_reason else appeal_resolution end,
    appeal_resolved_by=case when v_is_appeal then p_actor else appeal_resolved_by end,
    appeal_resolved_at=case when v_is_appeal then now() else appeal_resolved_at end
    where id=p_report;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_report->>'school',v_report->>'campus',case when v_is_appeal then 'report_appeal' else 'report' end,p_report,
      case when v_is_appeal then 'appeal_pending_review' else 'pending_review' end,
      case when v_is_appeal and p_decision='dismiss' then 'appeal_upheld' when v_is_appeal then 'appeal_accepted' else v_result end,p_reason);
  insert into public.social_notifications(recipient_id,actor_id,kind,resource_id,dedupe_key)
    values((v_report->>'reporter_id')::uuid,p_actor,'campus_report_reviewed',p_report,'report:'||p_report::text||':'||(v_report->>'revision'));
  if v_owner is not null then
    insert into public.social_notifications(recipient_id,actor_id,kind,resource_id,dedupe_key)
      values(v_owner,p_actor,'campus_content_reviewed',(v_report->>'target_id')::uuid,'report-removal:'||p_report::text);
  end if;
  return jsonb_build_object('id',p_report,'status',v_result,'appealStatus',case when v_is_appeal then case when p_decision='dismiss' then 'upheld' else 'accepted' end else null end,'notificationSent',true);
end;
$$;

revoke all on function public.campus_submit_report_appeal(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.campus_submit_report_appeal(uuid,uuid,text,integer) to service_role;
revoke all on function public.campus_governance_target(text,uuid,boolean),
  public.campus_governance_queue(uuid,integer,integer,text,text),
  public.campus_resolve_report(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.campus_governance_target(text,uuid,boolean),
  public.campus_governance_queue(uuid,integer,integer,text,text),
  public.campus_resolve_report(uuid,uuid,text,text,integer,text) to service_role;
