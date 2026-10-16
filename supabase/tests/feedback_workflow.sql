-- Fictional fixtures only; every change is rolled back.
begin;
do $$
declare
  owner_id uuid := coalesce((select user_id from public.platform_admins where role='owner' limit 1),gen_random_uuid());
  author_id uuid := gen_random_uuid();
  suggestion_id uuid := gen_random_uuid();
  stamp timestamptz;
  history jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'feedback-owner-'||owner_id||'@example.invalid',now()),
    (author_id,'feedback-author-'||author_id||'@example.invalid',now()) on conflict(id) do nothing;
  insert into public.platform_admins(user_id,role) values(owner_id,'owner') on conflict(user_id) do nothing;
  insert into public.campus_feedback_suggestions(id,author_id,title,body)
    values(suggestion_id,author_id,'Fictional feedback','Fictional feedback for a rolled-back test.');
  if not exists(select 1 from public.campus_feedback_suggestions where id=suggestion_id and is_anonymous and public_author_name='匿名用户') then raise exception 'anonymous defaults missing'; end if;
  begin
    perform public.campus_manage_feedback(author_id,suggestion_id,'public','pending','','',null);
    raise exception 'non-owner managed feedback';
  exception when raise_exception then
    if sqlerrm<>'CAMPUS_FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.campus_manage_feedback(owner_id,suggestion_id,'public','resolved','','',null);
    raise exception 'resolved without explanation';
  exception when raise_exception then
    if sqlerrm<>'CAMPUS_INVALID_INPUT' then raise; end if;
  end;
  begin
    perform public.campus_manage_feedback(owner_id,suggestion_id,'public','duplicate','','',null);
    raise exception 'duplicate without explanation';
  exception when raise_exception then
    if sqlerrm<>'CAMPUS_INVALID_INPUT' then raise; end if;
  end;
  perform public.campus_manage_feedback(owner_id,suggestion_id,'public','planned','Fictional implementation plan','',null);
  perform public.campus_manage_feedback(owner_id,suggestion_id,'public','processing','Fictional progress','',null);
  select public_history,updated_at into history,stamp from public.campus_feedback_suggestions where id=suggestion_id;
  if jsonb_array_length(history)<>2 or history->0->>'status'<>'planned' or history->1->>'status'<>'processing' then raise exception 'public history missing'; end if;
  if history::text like '%'||owner_id::text||'%' or history::text like '%'||author_id::text||'%' then raise exception 'history leaked identities'; end if;
  begin
    perform public.campus_manage_feedback(owner_id,suggestion_id,'public','resolved','Stale result','',null,stamp-interval '1 second');
    raise exception 'stale update accepted';
  exception when raise_exception then
    if sqlerrm<>'CAMPUS_REVISION_CHANGED' then raise; end if;
  end;
  perform public.campus_manage_feedback(owner_id,suggestion_id,'public','resolved','Fictional solution','',5::smallint,stamp);
  perform public.campus_manage_feedback(owner_id,suggestion_id,'public','processing','Reopened for verification','',null);
  if not exists(select 1 from public.campus_feedback_suggestions where id=suggestion_id and reward_issued and status='processing') then raise exception 'reopen lost reward'; end if;
  begin
    perform public.campus_manage_feedback(owner_id,suggestion_id,'public','resolved','Repeated solution','',5::smallint);
    raise exception 'reward issued twice';
  exception when raise_exception then
    if sqlerrm<>'CAMPUS_REVISION_CHANGED' then raise; end if;
  end;
  if (select count(*) from public.campus_bean_ledger where feedback_id=suggestion_id and user_id=author_id) <> 1 then raise exception 'reward ledger duplicated'; end if;
  if exists(select 1 from information_schema.column_privileges where table_schema='public' and table_name='campus_feedback_suggestions' and column_name='author_id' and grantee in ('anon','authenticated')) then raise exception 'public author_id grant'; end if;
  if has_function_privilege('anon','public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz)','execute') then raise exception 'anonymous management execution'; end if;
end $$;
rollback;
