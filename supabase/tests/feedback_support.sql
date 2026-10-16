-- Fictional fixtures only. Every vote, user and feedback is rolled back.
begin;
do $$
declare
  author_id uuid := gen_random_uuid();
  voter_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  suggestion_id uuid := gen_random_uuid();
  hidden_id uuid := gen_random_uuid();
  stamp timestamptz;
  result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (author_id,'vote-author-'||author_id||'@example.invalid',now()),
    (voter_id,'vote-reader-'||voter_id||'@example.invalid',now()),
    (other_id,'vote-other-'||other_id||'@example.invalid',now());
  insert into public.campus_feedback_suggestions(id,author_id,title,body,visibility) values
    (suggestion_id,author_id,'Fictional public feedback','Fictional public support test body.','public'),
    (hidden_id,author_id,'Fictional private feedback','Fictional private support test body.','hidden');
  select updated_at into stamp from public.campus_feedback_suggestions where id=suggestion_id;
  perform public.feedback_set_support(voter_id,suggestion_id,true);
  result := public.feedback_set_support(voter_id,suggestion_id,true);
  if (result->>'likeCount')::integer <> 1 then raise exception 'retry counted twice'; end if;
  perform public.feedback_set_support(other_id,suggestion_id,true);
  if (select like_count from public.campus_feedback_suggestions where id=suggestion_id) <> 2 then raise exception 'different voters not counted'; end if;
  perform public.feedback_set_support(voter_id,suggestion_id,false);
  result := public.feedback_set_support(voter_id,suggestion_id,false);
  if (result->>'likeCount')::integer <> 1 then raise exception 'repeated cancellation changed count'; end if;
  delete from auth.users where id=other_id;
  if (select like_count from public.campus_feedback_suggestions where id=suggestion_id) <> 0 then raise exception 'account deletion left stale count'; end if;
  if (select updated_at from public.campus_feedback_suggestions where id=suggestion_id) <> stamp then raise exception 'vote changed content revision'; end if;
  if (select public_history from public.campus_feedback_suggestions where id=suggestion_id) <> '[]'::jsonb then raise exception 'vote forged public progress'; end if;
  begin
    perform public.feedback_set_support(voter_id,hidden_id,true);
    raise exception 'hidden feedback accepted vote';
  exception when raise_exception then if sqlerrm<>'CAMPUS_NOT_FOUND' then raise; end if; end;
  begin
    perform public.feedback_set_support(voter_id,suggestion_id,null);
    raise exception 'invalid state accepted';
  exception when raise_exception then if sqlerrm<>'CAMPUS_INVALID_INPUT' then raise; end if; end;
  if has_table_privilege('anon','public.feedback_support_votes','select,insert,update,delete')
    or has_table_privilege('authenticated','public.feedback_support_votes','select,insert,update,delete') then raise exception 'vote identity table exposed'; end if;
  if has_function_privilege('anon','public.feedback_set_support(uuid,uuid,boolean)','execute')
    or has_function_privilege('authenticated','public.feedback_set_support(uuid,uuid,boolean)','execute') then raise exception 'client can impersonate a voter'; end if;
  if not has_function_privilege('service_role','public.feedback_set_support(uuid,uuid,boolean)','execute') then raise exception 'API cannot save votes'; end if;
  perform public.feedback_set_support(voter_id,suggestion_id,true);
  delete from public.campus_feedback_suggestions where id=suggestion_id;
  if exists(select 1 from public.feedback_support_votes where feedback_support_votes.feedback_id=suggestion_id) then raise exception 'feedback deletion left votes'; end if;
end;
$$;
rollback;
