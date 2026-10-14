-- The existing single owner remains separate from delegated campus reviewers.
create table public.campus_reviewer_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  active boolean not null default true,
  revision integer not null default 1,
  granted_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.campus_reviewer_grants enable row level security;
revoke all on public.campus_reviewer_grants from public, anon, authenticated;
grant all on public.campus_reviewer_grants to service_role;
create index campus_reviewer_grants_scope on public.campus_reviewer_grants(school, campus) where active;
create index campus_reviewer_grants_actor on public.campus_reviewer_grants(granted_by);

alter table public.platform_admin_audit drop constraint platform_admin_audit_action_check;
alter table public.platform_admin_audit add constraint platform_admin_audit_action_check
  check (action in ('user.suspend','user.restore','reviewer.grant','reviewer.revoke'));

-- The service role cannot read auth.users directly. This narrowly scoped boolean
-- helper is the only definer added here; it never returns account data.
create function public.campus_verified_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now()));
$$;
revoke all on function public.campus_verified_actor(uuid) from public,anon,authenticated;
grant execute on function public.campus_verified_actor(uuid) to service_role;

create function public.campus_can_review(p_actor uuid, p_school text, p_campus text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.campus_verified_actor(p_actor) and
    (exists(select 1 from public.platform_admins where user_id=p_actor and role='owner')
    or exists(select 1 from public.campus_reviewer_grants where user_id=p_actor and active
      and school=p_school and (campus='' or campus=coalesce(p_campus,''))));
$$;

create function public.campus_set_reviewer(p_actor uuid, p_user uuid, p_school text, p_campus text,
  p_active boolean, p_reason text, p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_current public.campus_reviewer_grants; v_owner uuid;
begin
  select user_id into v_owner from public.platform_admins where role='owner' for update;
  if v_owner is distinct from p_actor or not public.campus_can_review(p_actor,'','') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_user=p_actor then raise exception 'CAMPUS_SELF_ACTION'; end if;
  if p_active and not public.campus_verified_actor(p_user) then raise exception 'CAMPUS_REVIEWER_UNVERIFIED'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500
    or char_length(btrim(coalesce(p_school,''))) not between 1 and 100
    or char_length(coalesce(p_campus,''))>100 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into v_current from public.campus_reviewer_grants where user_id=p_user for update;
  if (v_current.user_id is not null and p_revision is distinct from v_current.revision)
    or (v_current.user_id is null and p_revision is not null) then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  insert into public.campus_reviewer_grants(user_id,school,campus,active,granted_by)
    values(p_user,btrim(p_school),btrim(coalesce(p_campus,'')),p_active,p_actor)
    on conflict(user_id) do update set school=excluded.school,campus=excluded.campus,active=excluded.active,
      granted_by=p_actor,revision=campus_reviewer_grants.revision+1,updated_at=now();
  insert into public.platform_admin_audit(actor_user_id,target_user_id,action,outcome,reason,completed_at)
    values(p_actor,p_user,case when p_active then 'reviewer.grant' else 'reviewer.revoke' end,'succeeded',p_reason,now());
  return jsonb_build_object('saved',true);
end;
$$;

alter table public.campus_content_reports
  add column campus text not null default '',
  add column resolution text not null default '',
  add column resolution_action text not null default '',
  add column resolved_by uuid references auth.users(id) on delete set null,
  add column resolved_at timestamptz,
  add column revision integer not null default 1;
-- Preserve historical place reports and their IDs without deleting the legacy rows.
insert into public.campus_content_reports(id,reporter_id,school,campus,target_type,target_id,reason,detail,created_at)
  select r.id,r.reporter_id,p.school,p.campus,'place',r.place_id,
    case when r.reason='sensitive' then 'privacy' else r.reason end,r.detail,r.created_at
  from public.campus_place_reports r join public.campus_places p on p.id=r.place_id
  on conflict do nothing;
alter table public.campus_content_reports drop constraint campus_content_reports_reporter_id_target_type_target_id_key;
create unique index campus_reports_one_pending on public.campus_content_reports(reporter_id,target_type,target_id)
  where status='pending_review';
create index campus_reports_owner_recent on public.campus_content_reports(reporter_id,created_at desc);
create index campus_reports_resolver on public.campus_content_reports(resolved_by);
alter table public.campus_moderation_events add column campus text not null default '';
alter table public.social_notifications drop constraint social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check check(kind=any(array[
  'friend_request','friend_accepted','friend_removed','invitation','invitation_updated','invitation_cancelled','invitation_expired',
  'place_preset','campus_place_reviewed','campus_content_reviewed','campus_report_reviewed','campus_market_interest',
  'campus_help_application','campus_lost_found_claim','campus_event_update','campus_private_message','campus_help_update'
]::text[]));

-- Internal target lookup: only a fixed table/column allowlist is interpolated.
create function public.campus_governance_target(p_type text,p_id uuid,p_lock boolean default false)
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
    when 'report' then v_table:='campus_content_reports'; v_status:='status'; v_owner:='reporter_id';
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
  elsif p_type='report' then
    v_parent:=public.campus_governance_target(v_row->>'target_type',(v_row->>'target_id')::uuid);
    v_row:=v_row||jsonb_build_object('target',v_parent-ARRAY['_table','_status','_owner','owner_id','user_id','reporter_id']);
  end if;
  if v_parent is not null then
    v_row:=v_row||jsonb_build_object('school',v_parent->>'school','campus',coalesce(v_parent->>'campus',''));
  end if;
  return v_row||jsonb_build_object('_table',v_table,'_status',v_status,'_owner',v_row->>v_owner,
    'campus',coalesce(v_row->>'campus',''));
end;
$$;

create function public.campus_governance_queue(p_actor_id uuid,p_offset integer default 0,p_limit integer default 30,
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
    union all select 'report',id,created_at from public.campus_content_reports where status='pending_review'
  ), scoped as materialized (
    select p.*,t.item from pending p cross join lateral (select public.campus_governance_target(p.type,p.id) item) t
    where public.campus_can_review(p_actor_id,t.item->>'school',t.item->>'campus')
      and (p_school='' or t.item->>'school'=p_school)
  ), filtered as materialized (select * from scoped where p_type='' or type=p_type), paged as (
    select * from filtered order by created_at,type,id offset p_offset limit p_limit
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('type',type,'item',item-ARRAY['_table','_status','_owner','owner_id','user_id','reporter_id']) order by created_at,type,id),'[]') from paged),
    (select count(*) from filtered),(select coalesce(jsonb_object_agg(type,n),'{}') from (select type,count(*) n from scoped group by type)c)
    into v_items,v_total,v_counts;
  return jsonb_build_object('items',v_items,'total',v_total,'counts',v_counts,'hasMore',p_offset+p_limit<v_total);
end;
$$;

create function public.campus_resolve_report(p_actor uuid,p_report uuid,p_decision text,p_reason text,
  p_revision integer,p_target_revision text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_report jsonb; v_target jsonb; v_status text; v_owner uuid; v_result text;
begin
  v_report:=public.campus_governance_target('report',p_report,true);
  if v_report is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor,v_report->>'school',v_report->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner')
    and v_report->>'reporter_id'=p_actor::text then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if v_report->>'status'<>'pending_review' or p_revision is distinct from (v_report->>'revision')::integer then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if p_decision not in ('remove','dismiss','resolve') or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_target:=public.campus_governance_target(v_report->>'target_type',(v_report->>'target_id')::uuid,true);
  if v_target->>'_owner'=p_actor::text and not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if p_decision='remove' then
    if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
    if p_target_revision is distinct from coalesce(v_target->>'review_revision',v_target->>'revision') then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
    v_owner:=(v_target->>'_owner')::uuid;
    if v_owner=p_actor and not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_SELF_REVIEW'; end if;
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
  update public.campus_content_reports set status=v_result,resolution=p_reason,resolution_action=p_decision,
    resolved_by=p_actor,resolved_at=now(),revision=revision+1 where id=p_report;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_report->>'school',v_report->>'campus','report',p_report,'pending_review',v_result,p_reason);
  insert into public.social_notifications(recipient_id,actor_id,kind,resource_id,dedupe_key)
    values((v_report->>'reporter_id')::uuid,p_actor,'campus_report_reviewed',p_report,'report:'||p_report::text||':'||(v_report->>'revision'));
  if v_owner is not null then
    insert into public.social_notifications(recipient_id,actor_id,kind,resource_id,dedupe_key)
      values(v_owner,p_actor,'campus_content_reviewed',(v_report->>'target_id')::uuid,'report-removal:'||p_report::text);
  end if;
  return jsonb_build_object('id',p_report,'status',v_result,'notificationSent',true);
end;
$$;

-- Only the trusted Edge tier may call governance helpers or mutate role grants.
revoke all on function public.campus_can_review(uuid,text,text),public.campus_set_reviewer(uuid,uuid,text,text,boolean,text,integer),
  public.campus_governance_target(text,uuid,boolean),public.campus_governance_queue(uuid,integer,integer,text,text),
  public.campus_resolve_report(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.campus_can_review(uuid,text,text),public.campus_set_reviewer(uuid,uuid,text,text,boolean,text,integer),
  public.campus_governance_target(text,uuid,boolean),public.campus_governance_queue(uuid,integer,integer,text,text),
  public.campus_resolve_report(uuid,uuid,text,text,integer,text) to service_role;

-- Retain the established domain transitions behind a permission-checked entrypoint.
alter function public.campus_life_moderate_content(uuid,text,uuid,text,text,integer) rename to campus_life_moderate_content_core;
create function public.campus_life_moderate_content(p_actor_id uuid,p_target_type text,p_target_id uuid,
  p_decision text,p_reason text,p_expected_revision integer default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_target jsonb; v_result jsonb;
begin
  if p_target_type in ('report','place') then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_target:=public.campus_governance_target(p_target_type,p_target_id,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor_id,v_target->>'school',v_target->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if v_target->>'_owner'=p_actor_id::text and not exists(select 1 from public.platform_admins where user_id=p_actor_id and role='owner') then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  v_result:=public.campus_life_moderate_content_core(p_actor_id,p_target_type,p_target_id,p_decision,p_reason,p_expected_revision);
  update public.campus_moderation_events set campus=v_target->>'campus'
    where actor_id=p_actor_id and target_type=p_target_type and target_id=p_target_id and created_at=now();
  return v_result;
end;
$$;
create function public.campus_review_place(p_actor uuid,p_id uuid,p_decision text,p_reason text,p_revision uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target jsonb; v_status text;
begin
  v_target:=public.campus_governance_target('place',p_id,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor,v_target->>'school',v_target->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if v_target->>'_owner'=p_actor::text and not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if v_target->>'review_status'<>'pending' or v_target->>'visibility'<>'school' or v_target->>'archived_at' is not null
    or p_revision is distinct from (v_target->>'review_revision')::uuid then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if p_decision not in ('approve','reject') or (p_decision='reject' and char_length(btrim(coalesce(p_reason,'')))=0)
    or char_length(coalesce(p_reason,''))>500 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_status:=case when p_decision='approve' then 'approved' else 'rejected' end;
  update public.campus_places set review_status=v_status,review_reason=case when p_decision='reject' then p_reason else '' end,
    review_revision=gen_random_uuid(),updated_at=now() where id=p_id;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_target->>'school',v_target->>'campus','place',p_id,'pending',v_status,coalesce(p_reason,''));
  return jsonb_build_object('id',p_id,'status',v_status,'ownerId',v_target->>'_owner');
end;
$$;
alter function public.campus_life_resolve_help_dispute(uuid,uuid,text,text) rename to campus_life_resolve_help_dispute_core;
create function public.campus_life_resolve_help_dispute(p_actor_id uuid,p_dispute_id uuid,p_task_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target jsonb; v_result jsonb;
begin
  v_target:=public.campus_governance_target('help_dispute',p_dispute_id,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor_id,v_target->>'school',v_target->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if not exists(select 1 from public.platform_admins where user_id=p_actor_id and role='owner')
    and exists(select 1 from public.campus_help_tasks where id=(v_target->>'task_id')::uuid and (owner_id=p_actor_id or assignee_id=p_actor_id)) then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  v_result:=public.campus_life_resolve_help_dispute_core(p_actor_id,p_dispute_id,p_task_status,p_reason);
  update public.campus_moderation_events set campus=v_target->>'campus'
    where actor_id=p_actor_id and target_type='help_dispute' and target_id=p_dispute_id and created_at=now();
  return v_result;
end;
$$;
revoke all on function public.campus_life_moderate_content(uuid,text,uuid,text,text,integer),
  public.campus_review_place(uuid,uuid,text,text,uuid),public.campus_life_resolve_help_dispute(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.campus_life_moderate_content(uuid,text,uuid,text,text,integer),
  public.campus_review_place(uuid,uuid,text,text,uuid),public.campus_life_resolve_help_dispute(uuid,uuid,text,text) to service_role;

create function public.campus_governance_history(p_actor uuid,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]') from (
    select id,school,campus,target_type,target_id,from_status,to_status,reason,created_at
    from public.campus_moderation_events e
    where public.campus_can_review(p_actor,e.school,e.campus)
    order by created_at desc,id offset greatest(0,least(100000,p_offset)) limit 30
  )t;
$$;
revoke all on function public.campus_governance_history(uuid,integer) from public,anon,authenticated;
grant execute on function public.campus_governance_history(uuid,integer) to service_role;

create function public.campus_withdraw_content(p_actor uuid,p_type text,p_id uuid,p_revision text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target jsonb; v_status text;
begin
  if p_type in ('report','help_dispute') or not public.campus_verified_actor(p_actor) then raise exception 'CAMPUS_FORBIDDEN'; end if;
  v_target:=public.campus_governance_target(p_type,p_id,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if v_target->>'_owner' is distinct from p_actor::text then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_revision is distinct from coalesce(v_target->>'review_revision',v_target->>'revision') then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  v_status:=v_target->>(v_target->>'_status');
  if v_status not in ('pending','pending_review','approved','active','open') then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if p_type='place' then
    update public.campus_places set review_status='rejected',review_reason='作者主动撤回',review_revision=gen_random_uuid(),updated_at=now() where id=p_id;
  else
    execute format('update public.%I set %I=''rejected'',review_reason=''作者主动撤回'',revision=revision+1 where id=$1',v_target->>'_table',v_target->>'_status') using p_id;
  end if;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_target->>'school',v_target->>'campus',p_type,p_id,v_status,'rejected','作者主动撤回');
  return jsonb_build_object('withdrawn',true);
end;
$$;
revoke all on function public.campus_withdraw_content(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.campus_withdraw_content(uuid,text,uuid,text) to service_role;
