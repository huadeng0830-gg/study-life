-- Product feedback is global; retain stored suggestions and legacy API names.
begin;
alter table public.campus_feedback_suggestions
  add column is_anonymous boolean not null default true,
  add column public_author_name text not null default '匿名用户' check (char_length(btrim(public_author_name)) between 1 and 32),
  add column public_history jsonb not null default '[]'::jsonb check (jsonb_typeof(public_history)='array');
alter table public.campus_feedback_suggestions drop constraint campus_feedback_suggestions_status_check;
alter table public.campus_feedback_suggestions add constraint campus_feedback_suggestions_status_check check (status in ('pending','needs_info','planned','processing','resolved','not_adopted','duplicate'));
-- A reward belongs to the suggestion, and remains issued even when a fix is reopened.
do $$ declare c record; begin
  for c in select conname from pg_catalog.pg_constraint where conrelid='public.campus_feedback_suggestions'::regclass and contype='c' and pg_catalog.pg_get_constraintdef(oid) like '%reward_issued%status%' loop
    execute format('alter table public.campus_feedback_suggestions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.campus_feedback_suggestions add constraint feedback_duplicate_reason check (status <> 'duplicate' or char_length(btrim(public_reason))>0);
-- Anonymous rows cannot be paired with a nickname even through privileged inserts.
alter table public.campus_feedback_suggestions add constraint feedback_anonymous_name check (not is_anonymous or public_author_name='匿名用户');
grant select (public_author_name,public_history) on public.campus_feedback_suggestions to anon,authenticated;

-- Only public progress is copied; account IDs and private messages never enter this JSON.
create function public.feedback_record_public_progress() returns trigger language plpgsql set search_path='' as $$
begin
  if new.visibility='public' and (old.visibility<>'public' or row(new.status,new.public_reply,new.public_reason) is distinct from row(old.status,old.public_reply,old.public_reason)) then
    new.public_history := coalesce(old.public_history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('status',new.status,'reply',new.public_reply,'reason',new.public_reason,'at',new.updated_at));
  else new.public_history := old.public_history; end if;
  return new;
end $$;
revoke all on function public.feedback_record_public_progress() from public,anon,authenticated;
create trigger feedback_public_progress before update on public.campus_feedback_suggestions for each row execute function public.feedback_record_public_progress();
drop function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint);
create function public.campus_manage_feedback(p_actor uuid,p_feedback uuid,p_visibility text,p_status text,p_reply text,
  p_public_reason text,p_reward smallint default null,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.campus_feedback_suggestions; v_wallet public.campus_bean_wallets; v_reward integer;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor and role='owner') then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_visibility not in ('pending_safety','public','hidden') or p_status not in ('pending','needs_info','planned','processing','resolved','not_adopted','duplicate')
    or char_length(coalesce(p_reply,''))>2000 or char_length(coalesce(p_public_reason,''))>1000
    or (p_reward is not null and p_reward not between 0 and 20) then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  select * into v_item from public.campus_feedback_suggestions where id=p_feedback for update;
  if v_item.id is null then raise exception 'CAMPUS_NOT_FOUND'; end if;
  if p_expected_updated_at is not null and v_item.updated_at <> p_expected_updated_at then raise exception 'CAMPUS_REVISION_CHANGED'; end if;
  if p_status not in ('pending','not_adopted','duplicate') and char_length(btrim(coalesce(p_reply,'')))=0 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
  if p_reward>0 and v_item.author_id=p_actor then raise exception 'CAMPUS_FORBIDDEN'; end if;
  if p_status in ('not_adopted','duplicate') and char_length(btrim(coalesce(p_public_reason,'')))=0 then raise exception 'CAMPUS_INVALID_INPUT'; end if;
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
revoke all on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz) from public,anon,authenticated;
grant execute on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz) to service_role;


commit;
