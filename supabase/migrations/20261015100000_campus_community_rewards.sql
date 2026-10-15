-- Campus community governance, contribution beans, and public suggestions.
-- All mutation tables are service-role only; Edge Functions authenticate the caller
-- and enforce owner / reviewer access before invoking these transaction boundaries.

alter table private.social_rate_buckets drop constraint if exists social_rate_buckets_action_check;
alter table private.social_rate_buckets add constraint social_rate_buckets_action_check
  check (action in ('email_search', 'availability_query', 'friend_request', 'invitation',
    'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite',
    'campus_publish', 'campus_contact', 'campus_review', 'campus_report', 'campus_favorite',
    'campus_feedback_submit', 'campus_reviewer_reply'));

create or replace function private.social_take_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 600), 3600));
  v_bucket timestamptz;
  v_hits integer;
begin
  if p_user_id is null or p_action not in ('email_search', 'availability_query', 'friend_request', 'invitation',
      'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite',
      'campus_publish', 'campus_contact', 'campus_review', 'campus_report', 'campus_favorite',
      'campus_feedback_submit', 'campus_reviewer_reply') then
    return false;
  end if;
  v_bucket := pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / v_window) * v_window);
  insert into private.social_rate_buckets (user_id, action, bucket_start, hits)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket_start)
  do update set hits = private.social_rate_buckets.hits + 1
  returning hits into v_hits;
  delete from private.social_rate_buckets where user_id = p_user_id
    and bucket_start < pg_catalog.clock_timestamp() - interval '1 day';
  return v_hits <= greatest(1, coalesce(p_limit, 1));
end;
$$;

create table public.campus_reviewer_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school text not null check (char_length(btrim(school)) between 1 and 100),
  campus text not null default '' check (char_length(campus) <= 100),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  owner_note text not null default '' check (char_length(owner_note) <= 1000),
  applicant_response text not null default '' check (char_length(applicant_response) <= 1000),
  scope_school text not null default '' check (char_length(scope_school) <= 100),
  scope_campus text not null default '' check (char_length(scope_campus) <= 100),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index campus_reviewer_one_pending_application on public.campus_reviewer_applications(user_id) where status='pending';
create index campus_reviewer_applications_owner on public.campus_reviewer_applications(status,created_at desc);
create index campus_reviewer_applications_user_recent on public.campus_reviewer_applications(user_id,created_at desc);
create index campus_reviewer_applications_decided_by on public.campus_reviewer_applications(decided_by) where decided_by is not null;

create table public.campus_bean_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purchased_balance integer not null default 0 check (purchased_balance >= 0),
  contribution_balance integer not null default 0 check (contribution_balance >= 0),
  contribution_debt integer not null default 0 check (contribution_debt >= 0),
  updated_at timestamptz not null default now()
);
create table public.campus_bean_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bean_type text not null check (bean_type in ('purchased','contribution')),
  amount integer not null,
  debt_delta integer not null default 0,
  balance_after integer not null check (balance_after >= 0),
  debt_after integer not null default 0 check (debt_after >= 0),
  entry_type text not null check (entry_type in ('review_award','audit_reversal','feedback_award','purchase','redemption','manual_adjustment')),
  reason text not null check (char_length(reason) between 1 and 500),
  idempotency_key text not null unique check (char_length(idempotency_key) <= 220),
  moderation_event_id uuid references public.campus_moderation_events(id) on delete set null,
  feedback_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (bean_type='contribution' or debt_delta=0)
);
create index campus_bean_ledger_user_recent on public.campus_bean_ledger(user_id,created_at desc,id desc);
create unique index campus_bean_one_review_target on public.campus_bean_ledger((metadata->>'target_key'))
  where entry_type='review_award';
create index campus_bean_daily_review_limit on public.campus_bean_ledger(user_id,created_at)
  where entry_type='review_award';
create index campus_bean_ledger_moderation_event on public.campus_bean_ledger(moderation_event_id) where moderation_event_id is not null;
create index campus_bean_ledger_feedback on public.campus_bean_ledger(feedback_id) where feedback_id is not null;

create table public.campus_review_audits (
  id uuid primary key default gen_random_uuid(),
  moderation_event_id uuid not null unique references public.campus_moderation_events(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  sample_month date not null,
  outcome text not null default 'pending' check (outcome in ('pending','correct','incorrect')),
  owner_reason text not null default '' check (char_length(owner_reason) <= 1000),
  reopened boolean not null default false,
  audited_by uuid references auth.users(id) on delete set null,
  audited_at timestamptz,
  created_at timestamptz not null default now()
);
create index campus_review_audits_month on public.campus_review_audits(sample_month,reviewer_id);
create index campus_review_audits_audited_by on public.campus_review_audits(audited_by) where audited_by is not null;

create table public.campus_feedback_suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'product' check (category in ('product','campus','accessibility','other')),
  title text not null check (char_length(btrim(title)) between 4 and 100),
  body text not null check (char_length(btrim(body)) between 10 and 3000),
  status text not null default 'pending' check (status in ('pending','processing','resolved','not_adopted')),
  visibility text not null default 'pending_safety' check (visibility in ('pending_safety','public','hidden')),
  public_reply text not null default '' check (char_length(public_reply) <= 2000),
  public_reason text not null default '' check (char_length(public_reason) <= 1000),
  reward_beans smallint check (reward_beans between 0 and 20),
  reward_issued boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'not_adopted' or char_length(btrim(public_reason)) > 0),
  check (not reward_issued or status='resolved')
);
create index campus_feedback_public on public.campus_feedback_suggestions(status,updated_at desc)
  where visibility='public';
create index campus_feedback_author on public.campus_feedback_suggestions(author_id,created_at desc);
create index campus_feedback_resolved_by on public.campus_feedback_suggestions(resolved_by) where resolved_by is not null;

create table public.campus_feedback_messages (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.campus_feedback_suggestions(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index campus_feedback_messages_thread on public.campus_feedback_messages(suggestion_id,created_at);
create index campus_feedback_messages_sender on public.campus_feedback_messages(sender_id,created_at);
create index campus_feedback_messages_recipient on public.campus_feedback_messages(recipient_id,created_at);

create table public.campus_digital_entitlements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  contribution_price integer check (contribution_price >= 0),
  purchased_price integer check (purchased_price >= 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WeChat Mini Program identity is mapped by keyed hashes, never by exposing raw
-- OpenID / session_key to a public table or client bundle.
create table public.wechat_auth_links (
  app_id_hash text not null check (char_length(app_id_hash)=64),
  openid_hash text not null check (char_length(openid_hash)=64),
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key(app_id_hash,openid_hash),
  unique(app_id_hash,user_id)
);
create index wechat_auth_links_user on public.wechat_auth_links(user_id);

do $$ declare t text; begin
  foreach t in array array['campus_reviewer_applications','campus_bean_wallets','campus_bean_ledger',
    'campus_review_audits','campus_feedback_suggestions','campus_feedback_messages','campus_digital_entitlements','wechat_auth_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

-- A WeChat-created internal account has an Auth session but no verified contact
-- email. It may use campus features, but it cannot receive moderation authority.
create or replace function public.campus_real_email_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
    and lower(coalesce(u.email,'')) not like '%@wechat.study-life.invalid'
    and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function public.campus_real_email_actor(uuid) from public,anon,authenticated;
grant execute on function public.campus_real_email_actor(uuid) to service_role;

create or replace function public.campus_can_review(p_actor uuid,p_school text,p_campus text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.campus_real_email_actor(p_actor) and
    (exists(select 1 from public.platform_admins where user_id=p_actor and role='owner')
    or exists(select 1 from public.campus_reviewer_grants where user_id=p_actor and active
      and school=p_school and (campus='' or campus=coalesce(p_campus,''))));
$$;
revoke all on function public.campus_can_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.campus_can_review(uuid,text,text) to service_role;

create or replace function public.campus_set_reviewer(p_actor uuid,p_user uuid,p_school text,p_campus text,
  p_active boolean,p_reason text,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_current public.campus_reviewer_grants; v_owner uuid;
begin
  select user_id into v_owner from public.platform_admins where role='owner' for update;
  if v_owner is distinct from p_actor or not public.campus_can_review(p_actor,'','') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_user=p_actor then raise exception 'CAMPUS_SELF_ACTION'; end if;
  if p_active and not public.campus_real_email_actor(p_user) then raise exception 'CAMPUS_REVIEWER_UNVERIFIED'; end if;
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
revoke all on function public.campus_set_reviewer(uuid,uuid,text,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.campus_set_reviewer(uuid,uuid,text,text,boolean,text,integer) to service_role;

-- Read-only diagnostic for service-side identity merge checks.
create function public.campus_wechat_user_is_empty(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_fk record; v_has_rows boolean;
begin
  for v_fk in
    select ns.nspname as schema_name, cls.relname as table_name, att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cls on cls.oid=con.conrelid
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
    where con.contype='f' and con.confrelid='auth.users'::regclass and array_length(con.conkey,1)=1
      and ns.nspname='public' and cls.relname<>'wechat_auth_links'
  loop
    execute format('select exists(select 1 from %I.%I where %I=$1)',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
      into v_has_rows using p_user;
    if v_has_rows then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.campus_wechat_user_is_empty(uuid) from public,anon,authenticated;
grant execute on function public.campus_wechat_user_is_empty(uuid) to service_role;

create function public.campus_wechat_rebind_identity(p_app_hash text,p_openid_hash text,p_old_user uuid,p_new_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_fk record;
begin
  if p_old_user=p_new_user then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  perform 1 from auth.users where id in (p_old_user,p_new_user) order by id for update;
  if not exists(select 1 from public.wechat_auth_links where app_id_hash=p_app_hash and openid_hash=p_openid_hash and user_id=p_old_user for update) then
    raise exception 'CAMPUS_REVISION_CHANGED';
  end if;
  -- Reviewer and platform-admin grants never move across identities automatically.
  if exists(select 1 from public.platform_admins where user_id=p_old_user)
    or exists(select 1 from public.campus_reviewer_grants where user_id=p_old_user and active) then
    raise exception 'CAMPUS_WECHAT_PRIVILEGE_REVIEW';
  end if;
  -- Preserve any existing email-account profile values. Fill only blanks from the
  -- generated account so campus and scheduling data are not silently discarded.
  insert into public.social_profiles as existing_profile(user_id,nickname,school,campus,email_discoverable,timezone,schedule_complete_through,semester_end,availability_preferences)
    select p_new_user,nickname,school,campus,email_discoverable,timezone,schedule_complete_through,semester_end,availability_preferences
    from public.social_profiles where user_id=p_old_user
  on conflict(user_id) do update set
    nickname=case when btrim(existing_profile.nickname)='' then excluded.nickname else existing_profile.nickname end,
    school=case when btrim(existing_profile.school)='' then excluded.school else existing_profile.school end,
    campus=case when btrim(existing_profile.campus)='' then excluded.campus else existing_profile.campus end,
    email_discoverable=existing_profile.email_discoverable or excluded.email_discoverable,
    timezone=case when btrim(existing_profile.timezone)='' then excluded.timezone else existing_profile.timezone end,
    schedule_complete_through=coalesce(existing_profile.schedule_complete_through,excluded.schedule_complete_through),
    semester_end=coalesce(existing_profile.semester_end,excluded.semester_end),
    availability_preferences=coalesce(excluded.availability_preferences,'{}'::jsonb)||coalesce(existing_profile.availability_preferences,'{}'::jsonb);
  delete from public.social_profiles where user_id=p_old_user;
  -- Keep the two bean types separate while combining an otherwise empty/new identity.
  insert into public.campus_bean_wallets as existing_wallet(user_id,purchased_balance,contribution_balance,contribution_debt)
    select p_new_user,purchased_balance,contribution_balance,contribution_debt from public.campus_bean_wallets where user_id=p_old_user
  on conflict(user_id) do update set purchased_balance=existing_wallet.purchased_balance+excluded.purchased_balance,
    contribution_balance=existing_wallet.contribution_balance+excluded.contribution_balance,
    contribution_debt=existing_wallet.contribution_debt+excluded.contribution_debt,updated_at=now();
  delete from public.campus_bean_wallets where user_id=p_old_user;
  -- Transfer every remaining direct FK to auth.users. Constraint conflicts abort
  -- the whole transaction, leaving both accounts and the identity link unchanged.
  for v_fk in
    select ns.nspname as schema_name,cls.relname as table_name,att.attname as column_name
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cls on cls.oid=con.conrelid
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    join pg_catalog.pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
    where con.contype='f' and con.confrelid='auth.users'::regclass and array_length(con.conkey,1)=1
      and ns.nspname='public' and cls.relname not in ('social_profiles','campus_bean_wallets','wechat_auth_links','platform_admins','campus_reviewer_grants')
  loop
    execute format('update %I.%I set %I=$1 where %I=$2',v_fk.schema_name,v_fk.table_name,v_fk.column_name,v_fk.column_name)
      using p_new_user,p_old_user;
  end loop;
  update public.wechat_auth_links set user_id=p_new_user,linked_at=now()
    where app_id_hash=p_app_hash and openid_hash=p_openid_hash and user_id=p_old_user;
  if not found then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  return true;
end;
$$;
revoke all on function public.campus_wechat_rebind_identity(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.campus_wechat_rebind_identity(text,text,uuid,uuid) to service_role;

create or replace function public.campus_record_final_review_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_wallet public.campus_bean_wallets;
  v_repaid integer;
  v_credit integer;
  v_today date;
  v_target_key text;
begin
  if char_length(btrim(coalesce(new.reason,'')))=0
    or new.to_status not in ('approved','active','open','rejected','resolved','dismissed','completed','cancelled')
    or new.from_status not in ('pending','pending_review','open')
    or exists(select 1 from public.platform_admins where user_id=new.actor_id and role='owner')
    or not public.campus_can_review(new.actor_id,new.school,new.campus) then return new; end if;
  v_target_key:=new.target_type||':'||new.target_id::text;
  v_today:=(new.created_at at time zone 'Asia/Shanghai')::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campus-review-target:'||v_target_key,0));
  if exists(select 1 from public.campus_bean_ledger where entry_type='review_award' and metadata->>'target_key'=v_target_key) then return new; end if;
  insert into public.campus_bean_wallets(user_id) values(new.actor_id) on conflict(user_id) do nothing;
  select * into v_wallet from public.campus_bean_wallets where user_id=new.actor_id for update;
  -- The wallet row serializes different targets from the same reviewer. Recheck
  -- the cap after acquiring it so concurrent moderation cannot exceed 20/day.
  if (select count(*) from public.campus_bean_ledger l where l.user_id=new.actor_id and l.entry_type='review_award'
      and (l.created_at at time zone 'Asia/Shanghai')::date=v_today)>=20 then return new; end if;
  if exists(select 1 from public.campus_bean_ledger where entry_type='review_award' and metadata->>'target_key'=v_target_key) then return new; end if;
  v_repaid:=least(v_wallet.contribution_debt,3);
  v_credit:=3-v_repaid;
  update public.campus_bean_wallets set contribution_balance=contribution_balance+v_credit,
    contribution_debt=contribution_debt-v_repaid,updated_at=now() where user_id=new.actor_id;
  insert into public.campus_bean_ledger(user_id,bean_type,amount,debt_delta,balance_after,debt_after,entry_type,reason,
    idempotency_key,moderation_event_id,metadata)
  select new.actor_id,'contribution',v_credit,-v_repaid,v_wallet.contribution_balance+v_credit,v_wallet.contribution_debt-v_repaid,
    'review_award','校园审核完成奖励','review:'||v_target_key,new.id,
    jsonb_build_object('target_key',v_target_key,'reward_total',3,'debt_repaid',v_repaid)
  where not exists(select 1 from public.campus_bean_ledger where entry_type='review_award' and metadata->>'target_key'=v_target_key)
  on conflict ((metadata->>'target_key')) where entry_type='review_award' do nothing;
  return new;
end;
$$;
drop trigger if exists campus_review_award_after_event on public.campus_moderation_events;
create trigger campus_review_award_after_event after insert on public.campus_moderation_events
  for each row execute function public.campus_record_final_review_reward();
revoke all on function public.campus_record_final_review_reward() from public,anon,authenticated;

create function public.campus_sample_reviewer_audits(p_actor uuid,p_month date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_month date;
  v_start timestamptz;
  v_next timestamptz;
  v_grant record;
  v_total integer;
  v_existing integer;
  v_need integer;
  v_added integer := 0;
  v_total_added integer := 0;
  v_reviewers integer := 0;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  v_month:=coalesce(date_trunc('month',p_month::timestamp)::date,date_trunc('month',now() at time zone 'Asia/Shanghai')::date);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('campus-review-audit:'||v_month::text,0));
  v_start:=v_month::timestamp at time zone 'Asia/Shanghai';
  v_next:=(v_month + interval '1 month')::timestamp at time zone 'Asia/Shanghai';
  for v_grant in select user_id from public.campus_reviewer_grants order by user_id loop
    select count(*) into v_total from public.campus_moderation_events e
      where e.actor_id=v_grant.user_id and e.created_at>=v_start and e.created_at<v_next
        and char_length(btrim(coalesce(e.reason,'')))>0
        and e.to_status in ('approved','active','open','rejected','resolved','dismissed','completed','cancelled');
    if v_total=0 then continue; end if;
    select count(*) into v_existing from public.campus_review_audits a join public.campus_moderation_events e on e.id=a.moderation_event_id
      where a.reviewer_id=v_grant.user_id and a.sample_month=v_month and e.created_at>=v_start and e.created_at<v_next;
    v_need:=greatest(0,greatest(1,ceil(v_total*0.10)::integer)-v_existing);
    if v_need=0 then continue; end if;
    with eligible as (
      select e.id,row_number() over(order by random(),e.id) as rn from public.campus_moderation_events e
      where e.actor_id=v_grant.user_id and e.created_at>=v_start and e.created_at<v_next
        and char_length(btrim(coalesce(e.reason,'')))>0
        and e.to_status in ('approved','active','open','rejected','resolved','dismissed','completed','cancelled')
        and not exists(select 1 from public.campus_review_audits a where a.moderation_event_id=e.id)
    ), inserted as (
      insert into public.campus_review_audits(moderation_event_id,reviewer_id,sample_month)
      select id,v_grant.user_id,v_month from eligible where rn<=v_need on conflict(moderation_event_id) do nothing returning id
    ) select count(*) into v_added from inserted;
    if v_added>0 then v_reviewers:=v_reviewers+1; v_total_added:=v_total_added+v_added; end if;
  end loop;
  return jsonb_build_object('month',v_month,'reviewers_sampled',v_reviewers,'audits_created',v_total_added);
end;
$$;
revoke all on function public.campus_sample_reviewer_audits(uuid,date) from public,anon,authenticated;
grant execute on function public.campus_sample_reviewer_audits(uuid,date) to service_role;

create function public.campus_review_reviewer_application(p_actor uuid,p_application uuid,p_decision text,p_reason text,
  p_scope_school text default null,p_scope_campus text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.campus_reviewer_applications; v_school text; v_campus text;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_decision not in ('approve','decline','request_proof') or char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into v_app from public.campus_reviewer_applications where id=p_application for update;
  if v_app.id is null or v_app.status<>'pending' then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  v_school:=coalesce(nullif(btrim(p_scope_school),''),v_app.school);
  v_campus:=coalesce(btrim(p_scope_campus),v_app.campus);
  if p_decision='approve' then
    perform public.campus_set_reviewer(p_actor,v_app.user_id,v_school,v_campus,true,btrim(p_reason),null);
  end if;
  if p_decision='request_proof' then
    update public.campus_reviewer_applications set owner_note=btrim(p_reason),applicant_response='',updated_at=now() where id=p_application;
    return jsonb_build_object('saved',true,'status','pending','proof_requested',true);
  end if;
  update public.campus_reviewer_applications set status=case when p_decision='approve' then 'approved' else 'declined' end,
    owner_note=btrim(p_reason),scope_school=case when p_decision='approve' then v_school else '' end,
    scope_campus=case when p_decision='approve' then v_campus else '' end,decided_by=p_actor,decided_at=now(),updated_at=now()
    where id=p_application;
  return jsonb_build_object('saved',true,'status',case when p_decision='approve' then 'approved' else 'declined' end);
end;
$$;
revoke all on function public.campus_review_reviewer_application(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.campus_review_reviewer_application(uuid,uuid,text,text,text,text) to service_role;

create function public.campus_reopen_audited_content(p_actor uuid,p_type text,p_target uuid,p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_target jsonb; v_table text; v_status_col text; v_from text;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_type in ('report','help_dispute') then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  v_target:=public.campus_governance_target(p_type,p_target,true);
  if v_target is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  v_table:=v_target->>'_table'; v_status_col:=v_target->>'_status'; v_from:=v_target->>v_status_col;
  if v_from not in ('approved','active','open','rejected','resolved','dismissed','completed','cancelled') then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if p_type='place' then
    update public.campus_places set review_status='pending_review',review_reason=btrim(p_reason),review_revision=gen_random_uuid(),updated_at=now() where id=p_target;
  else
    execute format('update public.%I set %I=''pending_review'',review_reason=$2,revision=revision+1,updated_at=now() where id=$1',v_table,v_status_col)
      using p_target,btrim(p_reason);
  end if;
  insert into public.campus_moderation_events(actor_id,school,campus,target_type,target_id,from_status,to_status,reason)
    values(p_actor,v_target->>'school',coalesce(v_target->>'campus',''),p_type,p_target,v_from,'pending_review',btrim(p_reason));
  return true;
end;
$$;
revoke all on function public.campus_reopen_audited_content(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.campus_reopen_audited_content(uuid,text,uuid,text) to service_role;

create function public.campus_resolve_review_audit(p_actor uuid,p_audit uuid,p_correct boolean,p_reason text,p_reopen boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_audit public.campus_review_audits; v_event public.campus_moderation_events; v_award public.campus_bean_ledger;
  v_wallet public.campus_bean_wallets; v_recover integer; v_debt_add integer; v_recent_errors integer;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into v_audit from public.campus_review_audits where id=p_audit for update;
  if v_audit.id is null or v_audit.outcome<>'pending' then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  select * into v_event from public.campus_moderation_events where id=v_audit.moderation_event_id;
  if v_event.id is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  update public.campus_review_audits set outcome=case when p_correct then 'correct' else 'incorrect' end,
    owner_reason=btrim(p_reason),audited_by=p_actor,audited_at=now() where id=p_audit;
  if not p_correct then
    select * into v_award from public.campus_bean_ledger where moderation_event_id=v_event.id and entry_type='review_award' for update;
    if v_award.id is not null then
      insert into public.campus_bean_wallets(user_id) values(v_event.actor_id) on conflict(user_id) do nothing;
      select * into v_wallet from public.campus_bean_wallets where user_id=v_event.actor_id for update;
      v_recover:=least(v_wallet.contribution_balance,coalesce((v_award.metadata->>'reward_total')::integer,3));
      v_debt_add:=coalesce((v_award.metadata->>'reward_total')::integer,3)-v_recover;
      update public.campus_bean_wallets set contribution_balance=contribution_balance-v_recover,
        contribution_debt=contribution_debt+v_debt_add,updated_at=now() where user_id=v_event.actor_id;
      insert into public.campus_bean_ledger(user_id,bean_type,amount,debt_delta,balance_after,debt_after,entry_type,reason,idempotency_key,moderation_event_id,metadata)
        values(v_event.actor_id,'contribution',-v_recover,v_debt_add,v_wallet.contribution_balance-v_recover,
          v_wallet.contribution_debt+v_debt_add,'audit_reversal',btrim(p_reason),'audit-reversal:'||p_audit::text,v_event.id,
          jsonb_build_object('audit_id',p_audit,'review_award_id',v_award.id));
    end if;
    if p_reopen then perform public.campus_reopen_audited_content(p_actor,v_event.target_type,v_event.target_id,btrim(p_reason)); end if;
  elsif p_reopen then raise exception 'CAMPUS_INVALID_INPUT';
  end if;
  select count(*) into v_recent_errors from public.campus_review_audits
    where reviewer_id=v_audit.reviewer_id and outcome='incorrect' and audited_at>=now()-interval '30 days';
  return jsonb_build_object('saved',true,'outcome',case when p_correct then 'correct' else 'incorrect' end,
    'recovered',case when p_correct then 0 else coalesce(v_recover,0) end,'debt_added',case when p_correct then 0 else coalesce(v_debt_add,0) end,
    'reviewer_alert',v_recent_errors>=2,'recent_errors',v_recent_errors,'reviewer_id',v_audit.reviewer_id);
end;
$$;
revoke all on function public.campus_resolve_review_audit(uuid,uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.campus_resolve_review_audit(uuid,uuid,boolean,text,boolean) to service_role;

create function public.campus_manage_feedback(p_actor uuid,p_feedback uuid,p_visibility text,p_status text,p_reply text,
  p_public_reason text,p_reward smallint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.campus_feedback_suggestions; v_wallet public.campus_bean_wallets; v_reward integer;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_visibility not in ('pending_safety','public','hidden') or p_status not in ('pending','processing','resolved','not_adopted')
    or char_length(coalesce(p_reply,''))>2000 or char_length(coalesce(p_public_reason,''))>1000
    or (p_reward is not null and p_reward not between 0 and 20) then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into v_item from public.campus_feedback_suggestions where id=p_feedback for update;
  if v_item.id is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if p_status='not_adopted' and char_length(btrim(coalesce(p_public_reason,'')))=0 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  if p_reward is not null and (p_status<>'resolved' or v_item.reward_issued) then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  update public.campus_feedback_suggestions set visibility=p_visibility,status=p_status,public_reply=btrim(coalesce(p_reply,'')),
    public_reason=btrim(coalesce(p_public_reason,'')),reward_beans=case when p_reward is null then reward_beans else p_reward end,
    reward_issued=case when p_reward is null then reward_issued else true end,
    resolved_by=case when p_status='resolved' then p_actor else resolved_by end,
    resolved_at=case when p_status='resolved' then coalesce(resolved_at,now()) else resolved_at end,updated_at=now()
    where id=p_feedback;
  if p_reward is not null and p_reward>0 then
    insert into public.campus_bean_wallets(user_id) values(v_item.author_id) on conflict(user_id) do nothing;
    select * into v_wallet from public.campus_bean_wallets where user_id=v_item.author_id for update;
    update public.campus_bean_wallets set contribution_balance=contribution_balance+p_reward,updated_at=now() where user_id=v_item.author_id;
    insert into public.campus_bean_ledger(user_id,bean_type,amount,balance_after,debt_after,entry_type,reason,idempotency_key,feedback_id,metadata)
      values(v_item.author_id,'contribution',p_reward,v_wallet.contribution_balance+p_reward,v_wallet.contribution_debt,
        'feedback_award','建议处理奖励','feedback:'||p_feedback::text,p_feedback,jsonb_build_object('admin_id',p_actor));
  end if;
  return jsonb_build_object('saved',true,'reward_issued',p_reward is not null,'status',p_status,'visibility',p_visibility);
end;
$$;
revoke all on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint) from public,anon,authenticated;
grant execute on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint) to service_role;

create function public.campus_bean_wallet(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_wallet public.campus_bean_wallets;
begin
  if not exists(select 1 from auth.users where id=p_actor and (banned_until is null or banned_until<=now())) then raise exception 'CAMPUS_FORBIDDEN'; end if;
  insert into public.campus_bean_wallets(user_id) values(p_actor) on conflict(user_id) do nothing;
  select * into v_wallet from public.campus_bean_wallets where user_id=p_actor;
  return jsonb_build_object('purchased',v_wallet.purchased_balance,'contribution',v_wallet.contribution_balance,
    'contributionDebt',v_wallet.contribution_debt,'rechargeEnabled',false,'entitlementRedemptionEnabled',false);
end;
$$;
revoke all on function public.campus_bean_wallet(uuid) from public,anon,authenticated;
grant execute on function public.campus_bean_wallet(uuid) to service_role;
