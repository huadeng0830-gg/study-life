-- 「怎么办」把一件校园里的真实问题作为可持续跟进的事项。
-- 所有公开内容仍由 campus-life Edge Function 写入；表本身只开放给 service_role。

-- PostgreSQL exposes jsonb_object_keys rather than jsonb_object_length. Keep
-- the small CHECK helper in the private schema and callable only by the server.
create function private.campus_matter_answer_count(p_value jsonb)
returns integer language sql immutable strict security invoker set search_path = '' as $$
  select count(*)::integer from pg_catalog.jsonb_object_keys(p_value);
$$;
revoke all on function private.campus_matter_answer_count(jsonb) from public,anon,authenticated;
grant execute on function private.campus_matter_answer_count(jsonb) to service_role;

create table public.campus_matters (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  content text not null check (char_length(btrim(content)) between 1 and 2400),
  intent text not null default 'advice' check (intent in ('advice','decision','experience','vent','information','judgment')),
  category text not null default 'other' check (category in ('dormitory','relationship','academic','career','purchase','campus_info','transport','lost_found','other')),
  status text not null default 'finding_help' check (status in ('finding_help','considering','trying','resolved','paused','venting')),
  review_status text not null default 'pending_review' check (review_status in ('pending_review','approved','rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  is_anonymous boolean not null default true,
  allow_clarifications boolean not null default true,
  show_outcomes boolean not null default true,
  intake_answers jsonb not null default '{}'::jsonb,
  related_entity_type text,
  related_entity_id uuid,
  options jsonb not null default '[]'::jsonb,
  author_choice text check (author_choice in ('A','B')),
  choice_note text not null default '' check (char_length(choice_note) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (case when jsonb_typeof(options) = 'array' then jsonb_array_length(options) in (0,2) else false end),
  check (author_choice is null or case when jsonb_typeof(options) = 'array' then jsonb_array_length(options) = 2 else false end),
  check (case when jsonb_typeof(intake_answers) = 'object' then private.campus_matter_answer_count(intake_answers) <= 3 else false end),
  check ((related_entity_type is null and related_entity_id is null)
    or (related_entity_type in ('teacher','course','place','market_listing','help_task','shuttle_route','lost_found','event','guide') and related_entity_id is not null))
);
create index campus_matters_public_recent on public.campus_matters(school,campus,created_at desc,id)
  where review_status='approved' and deleted_at is null;
create index campus_matters_owner_recent on public.campus_matters(author_id,updated_at desc,id)
  where deleted_at is null;
create index campus_matters_review_queue on public.campus_matters(school,campus,created_at,id)
  where review_status='pending_review' and deleted_at is null;

create table public.campus_matter_responses (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.campus_matters(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  response_type text not null check (response_type in ('advice','experience','information','risk','perspective','decision','judgment')),
  content text not null check (char_length(btrim(content)) between 1 and 2400),
  why text not null default '' check (char_length(why) <= 1000),
  steps text not null default '' check (char_length(steps) <= 1500),
  risk text not null default '' check (char_length(risk) <= 800),
  firsthand boolean not null default false,
  is_anonymous boolean not null default true,
  selected_option text,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','approved','rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  adopted boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (selected_option is null
    or (response_type='decision' and selected_option in ('A','B'))
    or (response_type='judgment' and selected_option in ('not_overthinking','need_more_info','new_angle','serious_concern')))
);
create index campus_matter_responses_matter_recent on public.campus_matter_responses(matter_id,created_at desc,id)
  where review_status='approved' and deleted_at is null;
create index campus_matter_responses_author_recent on public.campus_matter_responses(author_id,created_at desc)
  where deleted_at is null;
create unique index campus_matter_response_one_per_author on public.campus_matter_responses(matter_id,author_id)
  where deleted_at is null;
create index campus_matter_responses_review_queue on public.campus_matter_responses(created_at,id)
  where review_status='pending_review' and deleted_at is null;

create table public.campus_matter_clarifications (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.campus_matters(id) on delete cascade,
  asker_id uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 180),
  answer text not null default '' check (char_length(answer) <= 500),
  status text not null default 'pending' check (status in ('pending','answered','skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  answered_at timestamptz,
  review_status text not null default 'pending_review' check (review_status in ('pending_review','approved','rejected')),
  review_reason text not null default '' check (char_length(review_reason) <= 500),
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz
);
create unique index campus_matter_clarifications_one_active on public.campus_matter_clarifications(matter_id,asker_id)
  where deleted_at is null;
create index campus_matter_clarifications_matter on public.campus_matter_clarifications(matter_id,created_at);
create index campus_matter_clarifications_asker on public.campus_matter_clarifications(asker_id,created_at desc);

create table public.campus_matter_marks (
  matter_id uuid not null references public.campus_matters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mark_type text not null check (mark_type in ('experienced','understand')),
  created_at timestamptz not null default now(),
  primary key(matter_id,user_id,mark_type)
);
create index campus_matter_marks_matter on public.campus_matter_marks(matter_id,mark_type);

create table public.campus_matter_response_feedback (
  response_id uuid not null references public.campus_matter_responses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('helpful','experienced','confirmed')),
  created_at timestamptz not null default now(),
  primary key(response_id,user_id)
);
create index campus_matter_response_feedback_response on public.campus_matter_response_feedback(response_id,feedback_type);

create table public.campus_matter_actions (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.campus_matters(id) on delete cascade,
  response_id uuid references public.campus_matter_responses(id) on delete set null,
  author_id uuid not null references auth.users(id) on delete cascade,
  action_text text not null check (char_length(btrim(action_text)) between 1 and 500),
  due_on date,
  local_task_id text not null default '' check (char_length(local_task_id) <= 120),
  status text not null default 'planned' check (status in ('planned','trying','done','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campus_matter_actions_author_recent on public.campus_matter_actions(author_id,created_at desc);
create index campus_matter_actions_response on public.campus_matter_actions(response_id) where response_id is not null;
create unique index campus_matter_one_active_action on public.campus_matter_actions(matter_id,author_id)
  where status in ('planned','trying');

create table public.campus_matter_outcomes (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.campus_matters(id) on delete cascade,
  action_id uuid references public.campus_matter_actions(id) on delete set null,
  author_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in ('solved','improved','ongoing','no_help','no_action')),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index campus_matter_outcomes_matter_recent on public.campus_matter_outcomes(matter_id,created_at desc);
create index campus_matter_outcomes_action on public.campus_matter_outcomes(action_id) where action_id is not null;

-- Private by default at both the privilege and row-security layers. Only the
-- authenticated campus-life Edge Function uses the service role for these rows.
alter table public.campus_matters enable row level security;
alter table public.campus_matter_responses enable row level security;
alter table public.campus_matter_clarifications enable row level security;
alter table public.campus_matter_marks enable row level security;
alter table public.campus_matter_response_feedback enable row level security;
alter table public.campus_matter_actions enable row level security;
alter table public.campus_matter_outcomes enable row level security;
revoke all on public.campus_matters,public.campus_matter_responses,public.campus_matter_clarifications,
  public.campus_matter_marks,public.campus_matter_response_feedback,public.campus_matter_actions,
  public.campus_matter_outcomes from public,anon,authenticated;
grant all on public.campus_matters,public.campus_matter_responses,public.campus_matter_clarifications,
  public.campus_matter_marks,public.campus_matter_response_feedback,public.campus_matter_actions,
  public.campus_matter_outcomes to service_role;

create or replace function private.campus_matter_scope(p_actor uuid)
returns table(school text,campus text)
language plpgsql security invoker set search_path = '' as $$
begin
  if not public.campus_verified_actor(p_actor) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  return query select p.school,p.campus from public.social_profiles p
    where p.user_id=p_actor and char_length(btrim(coalesce(p.school,'')))>0;
  if not found then raise exception 'CAMPUS_MATTER_PROFILE_REQUIRED'; end if;
end;
$$;
revoke all on function private.campus_matter_scope(uuid) from public,anon,authenticated;
grant execute on function private.campus_matter_scope(uuid) to service_role;

create function public.campus_matter_create(p_actor uuid,p_title text,p_content text,p_intent text,p_category text,
  p_anonymous boolean,p_allow_clarifications boolean,p_show_outcomes boolean,p_options jsonb default '[]'::jsonb,
  p_intake_answers jsonb default '{}'::jsonb,p_related_entity_type text default null,p_related_entity_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matters; v_content text:=btrim(coalesce(p_content,'')); v_title text:=btrim(coalesce(p_title,''));
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  if char_length(v_content) not between 1 and 2400 or p_intent not in ('advice','decision','experience','vent','information','judgment')
    or p_category not in ('dormitory','relationship','academic','career','purchase','campus_info','transport','lost_found','other') then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if jsonb_typeof(coalesce(p_options,'[]'::jsonb))<>'array' then raise exception 'CAMPUS_MATTER_OPTIONS_INVALID'; end if;
  if jsonb_array_length(coalesce(p_options,'[]'::jsonb)) not in (0,2) then raise exception 'CAMPUS_MATTER_OPTIONS_INVALID'; end if;
  if jsonb_array_length(coalesce(p_options,'[]'::jsonb))=2 and
    (char_length(btrim(coalesce(p_options->0->>'label',''))) not between 1 and 80 or char_length(btrim(coalesce(p_options->1->>'label',''))) not between 1 and 80) then raise exception 'CAMPUS_MATTER_OPTIONS_INVALID'; end if;
  if jsonb_typeof(coalesce(p_intake_answers,'{}'::jsonb))<>'object' then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if private.campus_matter_answer_count(coalesce(p_intake_answers,'{}'::jsonb))>3 or ((p_related_entity_type is null)<>(p_related_entity_id is null))
    or (p_related_entity_type is not null and p_related_entity_type not in ('teacher','course','place','market_listing','help_task','shuttle_route','lost_found','event','guide')) then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if v_title='' then v_title:=left(v_content,97)||case when char_length(v_content)>100 then '…' else '' end; end if;
  insert into public.campus_matters(author_id,school,campus,title,content,intent,category,status,review_status,is_anonymous,allow_clarifications,show_outcomes,options,intake_answers,related_entity_type,related_entity_id)
    values(p_actor,v_scope.school,coalesce(v_scope.campus,''),left(v_title,100),v_content,p_intent,p_category,
      case when p_intent='vent' then 'venting' when p_intent='decision' then 'considering' else 'finding_help' end,
      'pending_review',coalesce(p_anonymous,true),coalesce(p_allow_clarifications,true),coalesce(p_show_outcomes,true),coalesce(p_options,'[]'::jsonb),
      coalesce(p_intake_answers,'{}'::jsonb),p_related_entity_type,p_related_entity_id) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'reviewStatus',v_row.review_status,'revision',v_row.revision);
end;
$$;

create function public.campus_matter_response_submit(p_actor uuid,p_matter uuid,p_response_type text,p_content text,
  p_why text default '',p_steps text default '',p_risk text default '',p_firsthand boolean default false,
  p_anonymous boolean default true,p_selected_option text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters; v_response public.campus_matter_responses;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null for share;
  if v_matter.id is null or v_matter.review_status<>'approved' or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  if v_matter.author_id=p_actor then raise exception 'CAMPUS_MATTER_SELF_ACTION'; end if;
  if p_response_type is null or p_response_type not in ('advice','experience','information','risk','perspective','decision','judgment')
    or char_length(btrim(coalesce(p_content,''))) not between 1 and 2400 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if (p_response_type in ('decision','judgment') and char_length(btrim(coalesce(p_why,'')))=0) then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if p_response_type='decision' and (v_matter.intent<>'decision' or jsonb_array_length(v_matter.options)<>2 or coalesce(p_selected_option not in ('A','B'),true)) then raise exception 'CAMPUS_MATTER_OPTIONS_INVALID'; end if;
  if p_response_type='judgment' and (v_matter.intent<>'judgment' or coalesce(p_selected_option not in ('not_overthinking','need_more_info','new_angle','serious_concern'),true)) then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  insert into public.campus_matter_responses(matter_id,author_id,response_type,content,why,steps,risk,firsthand,is_anonymous,selected_option,review_status)
    values(p_matter,p_actor,p_response_type,btrim(p_content),btrim(coalesce(p_why,'')),btrim(coalesce(p_steps,'')),btrim(coalesce(p_risk,'')),
      coalesce(p_firsthand,false),coalesce(p_anonymous,true),p_selected_option,'pending_review') returning * into v_response;
  return jsonb_build_object('id',v_response.id,'reviewStatus',v_response.review_status,'revision',v_response.revision,'matterAuthorId',v_matter.author_id);
end;
$$;

create function public.campus_matter_clarification_submit(p_actor uuid,p_matter uuid,p_question text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters; v_row public.campus_matter_clarifications;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null;
  if v_matter.id is null or v_matter.review_status<>'approved' or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  if v_matter.author_id=p_actor or not v_matter.allow_clarifications then raise exception 'CAMPUS_MATTER_SELF_ACTION'; end if;
  if char_length(btrim(coalesce(p_question,''))) not between 1 and 180 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  insert into public.campus_matter_clarifications(matter_id,asker_id,question,review_status) values(p_matter,p_actor,btrim(p_question),'pending_review') returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'reviewStatus',v_row.review_status,'matterAuthorId',v_matter.author_id);
end;
$$;

create function public.campus_matter_clarification_reply(p_actor uuid,p_clarification uuid,p_answer text,p_skip boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matter_clarifications; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_row from public.campus_matter_clarifications where id=p_clarification for update;
  select * into v_matter from public.campus_matters where id=v_row.matter_id and deleted_at is null;
  if v_row.id is null or v_matter.author_id<>p_actor or v_row.status<>'pending' or v_row.review_status<>'approved'
    or v_matter.school<>v_scope.school or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus)
    or v_row.deleted_at is not null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  if not coalesce(p_skip,false) and char_length(btrim(coalesce(p_answer,''))) not between 1 and 500 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  update public.campus_matter_clarifications set answer=case when p_skip then '' else btrim(p_answer) end,
    status=case when p_skip then 'skipped' else 'answered' end,review_status=case when p_skip then 'approved' else 'pending_review' end,
    review_reason='',revision=revision+1,updated_at=now(),answered_at=now() where id=p_clarification returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'reviewStatus',v_row.review_status,'askerId',v_row.asker_id);
end;
$$;

create function public.campus_matter_clarification_delete(p_actor uuid,p_clarification uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matter_clarifications;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  update public.campus_matter_clarifications c set deleted_at=now(),review_status='rejected',review_reason='用户已删除',revision=revision+1
    from public.campus_matters m where c.id=p_clarification and m.id=c.matter_id and m.school=v_scope.school
      and (v_scope.campus='' or m.campus='' or m.campus=v_scope.campus) and c.deleted_at is null
      and (c.asker_id=p_actor or m.author_id=p_actor) returning c.* into v_row;
  if v_row.id is null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  return jsonb_build_object('deleted',true);
end;
$$;

create function public.campus_matter_mark(p_actor uuid,p_matter uuid,p_mark_type text,p_enabled boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null;
  if v_matter.id is null or v_matter.review_status<>'approved' or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  if v_matter.author_id=p_actor or p_mark_type not in ('experienced','understand') then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if coalesce(p_enabled,true) then
    insert into public.campus_matter_marks(matter_id,user_id,mark_type) values(p_matter,p_actor,p_mark_type) on conflict do nothing;
  else
    delete from public.campus_matter_marks where matter_id=p_matter and user_id=p_actor and mark_type=p_mark_type;
  end if;
  return jsonb_build_object('saved',coalesce(p_enabled,true));
end;
$$;

create function public.campus_matter_response_feedback(p_actor uuid,p_response uuid,p_feedback_type text,p_enabled boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_response public.campus_matter_responses; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_response from public.campus_matter_responses where id=p_response and deleted_at is null;
  select * into v_matter from public.campus_matters where id=v_response.matter_id and deleted_at is null;
  if v_response.id is null or v_response.review_status<>'approved' or v_matter.review_status<>'approved' or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  if v_response.author_id=p_actor or p_feedback_type not in ('helpful','experienced','confirmed') then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  if coalesce(p_enabled,true) then
    insert into public.campus_matter_response_feedback(response_id,user_id,feedback_type) values(p_response,p_actor,p_feedback_type)
      on conflict(response_id,user_id) do update set feedback_type=excluded.feedback_type,created_at=now();
  else
    delete from public.campus_matter_response_feedback where response_id=p_response and user_id=p_actor;
  end if;
  return jsonb_build_object('saved',coalesce(p_enabled,true));
end;
$$;

create function public.campus_matter_response_adopt(p_actor uuid,p_response uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_response public.campus_matter_responses; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_response from public.campus_matter_responses where id=p_response and deleted_at is null;
  select * into v_matter from public.campus_matters where id=v_response.matter_id and deleted_at is null for update;
  if v_response.id is null or v_response.review_status<>'approved' or v_matter.author_id<>p_actor or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  update public.campus_matter_responses set adopted=false,updated_at=now() where matter_id=v_matter.id and adopted;
  update public.campus_matter_responses set adopted=true,updated_at=now() where id=p_response;
  return jsonb_build_object('adopted',true,'responseAuthorId',v_response.author_id);
end;
$$;

create function public.campus_matter_action_start(p_actor uuid,p_matter uuid,p_response uuid,p_action_text text,p_due_on date default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters; v_response public.campus_matter_responses; v_row public.campus_matter_actions;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null for update;
  if v_matter.id is null or v_matter.author_id<>p_actor or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  if v_matter.review_status<>'approved' then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  if p_response is not null then
    select * into v_response from public.campus_matter_responses where id=p_response and matter_id=p_matter and deleted_at is null and review_status='approved';
    if v_response.id is null then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  end if;
  if char_length(btrim(coalesce(p_action_text,''))) not between 1 and 500 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  insert into public.campus_matter_actions(matter_id,response_id,author_id,action_text,due_on,status)
    values(p_matter,p_response,p_actor,btrim(p_action_text),p_due_on,'planned') returning * into v_row;
  update public.campus_matters set status='trying',updated_at=now(),revision=revision+1 where id=p_matter;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'dueOn',v_row.due_on);
end;
$$;

create function public.campus_matter_action_link_task(p_actor uuid,p_action uuid,p_local_task_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_action public.campus_matter_actions; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_action from public.campus_matter_actions where id=p_action and author_id=p_actor;
  select * into v_matter from public.campus_matters where id=v_action.matter_id;
  if v_action.id is null or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  if char_length(coalesce(p_local_task_id,''))>120 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  update public.campus_matter_actions set local_task_id=coalesce(p_local_task_id,''),updated_at=now() where id=p_action;
  return jsonb_build_object('linked',p_local_task_id is not null and p_local_task_id<>'');
end;
$$;

create function public.campus_matter_outcome_submit(p_actor uuid,p_matter uuid,p_action uuid,p_outcome text,p_note text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters; v_action public.campus_matter_actions; v_row public.campus_matter_outcomes;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null for update;
  if v_matter.id is null or v_matter.author_id<>p_actor or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  if p_action is not null then
    select * into v_action from public.campus_matter_actions where id=p_action and matter_id=p_matter and author_id=p_actor for update;
    if v_action.id is null then raise exception 'CAMPUS_MATTER_NOT_FOUND'; end if;
  end if;
  if p_outcome not in ('solved','improved','ongoing','no_help','no_action') or char_length(coalesce(p_note,''))>1000 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  insert into public.campus_matter_outcomes(matter_id,action_id,author_id,outcome,note)
    values(p_matter,p_action,p_actor,p_outcome,btrim(coalesce(p_note,''))) returning * into v_row;
  update public.campus_matters set status=case p_outcome when 'solved' then 'resolved' when 'improved' then 'trying' when 'ongoing' then 'trying' when 'no_action' then 'paused' else 'finding_help' end,
    updated_at=now(),revision=revision+1 where id=p_matter;
  if p_action is not null then
    update public.campus_matter_actions set status=case p_outcome when 'solved' then 'done' when 'improved' then 'done' when 'no_action' then 'abandoned' when 'no_help' then 'abandoned' else 'trying' end,
      updated_at=now() where id=p_action;
  end if;
  return jsonb_build_object('id',v_row.id,'outcome',v_row.outcome,'createdAt',v_row.created_at);
end;
$$;

create function public.campus_matter_set_choice(p_actor uuid,p_matter uuid,p_choice text,p_note text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_matter from public.campus_matters where id=p_matter and deleted_at is null for update;
  if v_matter.id is null or v_matter.author_id<>p_actor or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  if v_matter.intent<>'decision' or jsonb_array_length(v_matter.options)<>2 or p_choice is null or p_choice not in ('A','B') or char_length(coalesce(p_note,''))>500 then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  update public.campus_matters set author_choice=p_choice,choice_note=btrim(coalesce(p_note,'')),updated_at=now(),revision=revision+1 where id=p_matter;
  return jsonb_build_object('saved',true,'choice',p_choice);
end;
$$;

create function public.campus_matter_update_state(p_actor uuid,p_matter uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  if p_status not in ('finding_help','considering','trying','paused','venting') then raise exception 'CAMPUS_MATTER_INVALID'; end if;
  update public.campus_matters set status=p_status,updated_at=now(),revision=revision+1
    where id=p_matter and author_id=p_actor and school=v_scope.school and (v_scope.campus='' or campus='' or campus=v_scope.campus)
      and deleted_at is null returning * into v_row;
  if v_row.id is null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  return jsonb_build_object('status',v_row.status,'revision',v_row.revision);
end;
$$;

create function public.campus_matter_update_preferences(p_actor uuid,p_matter uuid,p_anonymous boolean,p_allow_clarifications boolean,p_show_outcomes boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  update public.campus_matters set is_anonymous=coalesce(p_anonymous,true),allow_clarifications=coalesce(p_allow_clarifications,true),
    show_outcomes=coalesce(p_show_outcomes,true),updated_at=now(),revision=revision+1
    where id=p_matter and author_id=p_actor and school=v_scope.school and (v_scope.campus='' or campus='' or campus=v_scope.campus)
      and deleted_at is null returning * into v_row;
  if v_row.id is null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  return jsonb_build_object('saved',true,'isAnonymous',v_row.is_anonymous,'allowClarifications',v_row.allow_clarifications,'showOutcomes',v_row.show_outcomes);
end;
$$;

create function public.campus_matter_delete(p_actor uuid,p_matter uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  update public.campus_matters set deleted_at=now(),status='paused',review_status='rejected',review_reason='作者已删除',updated_at=now(),revision=revision+1
    where id=p_matter and author_id=p_actor and school=v_scope.school and (v_scope.campus='' or campus='' or campus=v_scope.campus)
      and deleted_at is null returning * into v_row;
  if v_row.id is null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  update public.campus_matter_responses set deleted_at=now(),review_status='rejected',review_reason='所属事项已删除',updated_at=now(),revision=revision+1 where matter_id=p_matter and deleted_at is null;
  return jsonb_build_object('deleted',true);
end;
$$;

create function public.campus_matter_response_delete(p_actor uuid,p_response uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_row public.campus_matter_responses;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  update public.campus_matter_responses r set deleted_at=now(),review_status='rejected',review_reason='作者已删除',updated_at=now(),revision=revision+1
    from public.campus_matters m where r.id=p_response and r.author_id=p_actor and m.id=r.matter_id and m.school=v_scope.school
      and (v_scope.campus='' or m.campus='' or m.campus=v_scope.campus) and r.deleted_at is null
    returning r.* into v_row;
  if v_row.id is null then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  return jsonb_build_object('deleted',true);
end;
$$;

create function public.campus_matter_response_privacy(p_actor uuid,p_response uuid,p_anonymous boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_scope record; v_response public.campus_matter_responses; v_matter public.campus_matters;
begin
  select * into v_scope from private.campus_matter_scope(p_actor);
  select * into v_response from public.campus_matter_responses where id=p_response and author_id=p_actor and deleted_at is null for update;
  select * into v_matter from public.campus_matters where id=v_response.matter_id and deleted_at is null;
  if v_response.id is null or v_matter.id is null or v_matter.school<>v_scope.school
    or (v_scope.campus<>'' and v_matter.campus<>'' and v_matter.campus<>v_scope.campus) then raise exception 'CAMPUS_MATTER_FORBIDDEN'; end if;
  update public.campus_matter_responses set is_anonymous=coalesce(p_anonymous,true),updated_at=now(),revision=revision+1 where id=p_response returning * into v_response;
  return jsonb_build_object('saved',true,'isAnonymous',v_response.is_anonymous,'revision',v_response.revision);
end;
$$;

-- Extend the existing moderation and reporting path; anonymous items still keep
-- their real author_id for authorized review and abuse handling.
alter table public.campus_content_reports drop constraint campus_content_reports_target_type_check;
alter table public.campus_content_reports add constraint campus_content_reports_target_type_check
  check (target_type in ('place','teacher','course','course_review','market_listing','help_task','shuttle_route','lost_found','event','guide','matter','matter_response','matter_clarification'));

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
  elsif p_type='report' then
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
  ), scoped as materialized (
    select p.*,t.item from pending p cross join lateral (select public.campus_governance_target(p.type,p.id) item) t
    where public.campus_can_review(p_actor_id,t.item->>'school',t.item->>'campus') and (p_school='' or t.item->>'school'=p_school)
  ), filtered as materialized (select * from scoped where p_type='' or type=p_type), paged as (
    select * from filtered order by created_at,type,id offset p_offset limit p_limit
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('type',type,'item',item-ARRAY['_table','_status','_owner','owner_id','user_id','reporter_id']) order by created_at,type,id),'[]') from paged),
    (select count(*) from filtered),(select coalesce(jsonb_object_agg(type,n),'{}') from (select type,count(*) n from scoped group by type)c)
    into v_items,v_total,v_counts;
  return jsonb_build_object('items',v_items,'total',v_total,'counts',v_counts,'hasMore',p_offset+p_limit<v_total);
end;
$$;

create function public.campus_matter_moderate(p_actor uuid,p_type text,p_id uuid,p_decision text,p_reason text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_target jsonb; v_to text; v_table text; v_owner uuid; v_matter_id uuid; v_matter_owner uuid;
begin
  if p_type not in ('matter','matter_response','matter_clarification') or p_decision not in ('approve','reject')
    or char_length(btrim(coalesce(p_reason,'')))>500 or (p_decision='reject' and char_length(btrim(coalesce(p_reason,'')))=0) then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_target:=public.campus_governance_target(p_type,p_id,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if not public.campus_can_review(p_actor,v_target->>'school',v_target->>'campus') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if (v_target->>'_owner'=p_actor::text or
    (p_type='matter_clarification' and v_target->>'status'='answered' and
      exists(select 1 from public.campus_matters where id=(v_target->>'matter_id')::uuid and author_id=p_actor)))
    and not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_SELF_REVIEW'; end if;
  if v_target->>'review_status'<>'pending_review' or p_revision is distinct from (v_target->>'revision')::integer then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  v_to:=case when p_decision='approve' then 'approved' else 'rejected' end;
  v_table:=v_target->>'_table'; v_owner:=(v_target->>'_owner')::uuid;
  execute format('update public.%I set review_status=$2,review_reason=$3,revision=revision+1,updated_at=now() where id=$1',v_table)
    using p_id,v_to,case when p_decision='approve' then '' else btrim(p_reason) end;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_target->>'school',coalesce(v_target->>'campus',''),p_type,p_id,'pending_review',v_to,btrim(coalesce(p_reason,'')));
  if p_type='matter' then
    v_matter_id:=p_id;
    v_matter_owner:=v_owner;
  elsif p_type in ('matter_response','matter_clarification') then
    v_matter_id:=(v_target->>'matter_id')::uuid;
    select author_id into v_matter_owner from public.campus_matters where id=v_matter_id;
    update public.campus_matters set updated_at=now() where id=v_matter_id;
  end if;
  return jsonb_build_object('id',p_id,'status',v_to,'ownerId',v_owner,'matterId',v_matter_id,
    'matterAuthorId',v_matter_owner,'askerId',case when p_type='matter_clarification' then v_owner else null end,
    'clarificationStatus',case when p_type='matter_clarification' then v_target->>'status' else null end,'school',v_target->>'school');
end;
$$;

alter table public.social_notifications drop constraint social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check check(kind=any(array[
  'friend_request','friend_accepted','friend_removed','invitation','invitation_updated','invitation_cancelled','invitation_expired',
  'place_preset','campus_place_reviewed','campus_content_reviewed','campus_report_reviewed','campus_market_interest',
  'campus_help_application','campus_lost_found_claim','campus_event_update','campus_private_message','campus_help_update',
  'campus_matter_response','campus_matter_clarification','campus_matter_adopted','campus_matter_outcome','campus_matter_reviewed'
]::text[]));

revoke all on function public.campus_matter_create(uuid,text,text,text,text,boolean,boolean,boolean,jsonb,jsonb,text,uuid),
  public.campus_matter_response_submit(uuid,uuid,text,text,text,text,text,boolean,boolean,text),
  public.campus_matter_clarification_submit(uuid,uuid,text),public.campus_matter_clarification_reply(uuid,uuid,text,boolean),
  public.campus_matter_clarification_delete(uuid,uuid),
  public.campus_matter_mark(uuid,uuid,text,boolean),public.campus_matter_response_feedback(uuid,uuid,text,boolean),
  public.campus_matter_response_adopt(uuid,uuid),public.campus_matter_action_start(uuid,uuid,uuid,text,date),
  public.campus_matter_action_link_task(uuid,uuid,text),public.campus_matter_outcome_submit(uuid,uuid,uuid,text,text),
  public.campus_matter_set_choice(uuid,uuid,text,text),public.campus_matter_update_state(uuid,uuid,text),
  public.campus_matter_update_preferences(uuid,uuid,boolean,boolean,boolean),public.campus_matter_delete(uuid,uuid),
  public.campus_matter_response_delete(uuid,uuid),public.campus_matter_moderate(uuid,text,uuid,text,text,integer),
  public.campus_matter_response_privacy(uuid,uuid,boolean),
  public.campus_governance_target(text,uuid,boolean),public.campus_governance_queue(uuid,integer,integer,text,text)
from public,anon,authenticated;
grant execute on function public.campus_matter_create(uuid,text,text,text,text,boolean,boolean,boolean,jsonb,jsonb,text,uuid),
  public.campus_matter_response_submit(uuid,uuid,text,text,text,text,text,boolean,boolean,text),
  public.campus_matter_clarification_submit(uuid,uuid,text),public.campus_matter_clarification_reply(uuid,uuid,text,boolean),
  public.campus_matter_clarification_delete(uuid,uuid),
  public.campus_matter_mark(uuid,uuid,text,boolean),public.campus_matter_response_feedback(uuid,uuid,text,boolean),
  public.campus_matter_response_adopt(uuid,uuid),public.campus_matter_action_start(uuid,uuid,uuid,text,date),
  public.campus_matter_action_link_task(uuid,uuid,text),public.campus_matter_outcome_submit(uuid,uuid,uuid,text,text),
  public.campus_matter_set_choice(uuid,uuid,text,text),public.campus_matter_update_state(uuid,uuid,text),
  public.campus_matter_update_preferences(uuid,uuid,boolean,boolean,boolean),public.campus_matter_delete(uuid,uuid),
  public.campus_matter_response_delete(uuid,uuid),public.campus_matter_moderate(uuid,text,uuid,text,text,integer),
  public.campus_matter_response_privacy(uuid,uuid,boolean),
  public.campus_governance_target(text,uuid,boolean),public.campus_governance_queue(uuid,integer,integer,text,text)
to service_role;
