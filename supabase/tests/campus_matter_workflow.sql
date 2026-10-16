-- Fictional end-to-end fixture. Every row is rolled back; never production seed data.
begin;
select set_config('campus_matter_test.owner',(select user_id::text from public.platform_admins where role='owner' limit 1),true);
select set_config('campus_matter_test.reviewer',gen_random_uuid()::text,true);
select set_config('campus_matter_test.author',gen_random_uuid()::text,true);
select set_config('campus_matter_test.helper',gen_random_uuid()::text,true);
select set_config('campus_matter_test.reporter',gen_random_uuid()::text,true);
select set_config('campus_matter_test.other_campus',gen_random_uuid()::text,true);

insert into auth.users(id,email,email_confirmed_at)
select current_setting('campus_matter_test.'||who)::uuid,
  'fictional-matter-'||current_setting('campus_matter_test.'||who)||'@example.invalid',now()
from unnest(array['reviewer','author','helper','reporter','other_campus']) who;
insert into public.social_profiles(user_id,nickname,school,campus)
select current_setting('campus_matter_test.'||who)::uuid,'虚构同学','怎么办事务测试大学',
  case when who='other_campus' then '西区' else '东区' end
from unnest(array['reviewer','author','helper','reporter','other_campus']) who;

set local role service_role;
do $$
<<workflow>>
declare
  owner_id uuid:=current_setting('campus_matter_test.owner')::uuid;
  reviewer uuid:=current_setting('campus_matter_test.reviewer')::uuid;
  author uuid:=current_setting('campus_matter_test.author')::uuid;
  helper uuid:=current_setting('campus_matter_test.helper')::uuid;
  reporter uuid:=current_setting('campus_matter_test.reporter')::uuid;
  other_campus uuid:=current_setting('campus_matter_test.other_campus')::uuid;
  matter_result jsonb; response_result jsonb; clarification_result jsonb; action_result jsonb; outcome_result jsonb;
  matter_id uuid; response_id uuid; clarification_id uuid; action_id uuid; decision_id uuid; report_id uuid; place_id uuid;
  queue jsonb; denied boolean;
begin
  if owner_id is null then raise exception 'test needs the configured platform owner'; end if;
  perform public.campus_set_reviewer(owner_id,reviewer,'怎么办事务测试大学','东区',true,'虚构流程测试',null);
  insert into public.campus_places(id,owner_id,school,campus,name,category,rating_template_id,review_status,place_type)
    values(gen_random_uuid(),author,'怎么办事务测试大学','东区','虚构快递点','service','service','approved','parcel-station') returning id into place_id;

  -- Roommate conflict: create, review, actionable advice, adopt, try, and confirm.
  matter_result:=public.campus_matter_create(author,'','室友晚上打游戏太吵，我不知道该不该直接说。',
    'decision','dormitory',true,true,true,
    '[{"label":"找合适时间沟通"},{"label":"先不直接说"}]'::jsonb,
    '{"communication":"还没有"}'::jsonb,null,null);
  matter_id:=(matter_result->>'id')::uuid;
  perform public.campus_matter_moderate(reviewer,'matter',matter_id,'approve','',1);
  response_result:=public.campus_matter_response_submit(helper,matter_id,'advice',
    '找双方都平静的时间，先说清楚具体影响，再提议晚上十一点后戴耳机。',
    '描述影响比指责更容易开始沟通。','今天先私下问问对方是否愿意约一个宿舍作息规则。',
    '如果对方拒绝，可以再请宿舍成员一起商量。',true,true,null);
  response_id:=(response_result->>'id')::uuid;
  perform public.campus_matter_moderate(reviewer,'matter_response',response_id,'approve','',1);
  perform public.campus_matter_response_privacy(helper,response_id,false);
  if not exists(select 1 from public.campus_matter_responses where id=response_id and is_anonymous=false) then raise exception 'response identity preference did not update'; end if;
  perform public.campus_matter_response_privacy(helper,response_id,true);
  perform public.campus_matter_response_adopt(author,response_id);
  action_result:=public.campus_matter_action_start(author,matter_id,response_id,'今晚和室友聊一下。',null);
  action_id:=(action_result->>'id')::uuid;
  outcome_result:=public.campus_matter_outcome_submit(author,matter_id,action_id,'solved','约好晚上十一点后戴耳机，之后安静了。');
  if not exists(select 1 from public.campus_matters where id=matter_id and status='resolved') then raise exception 'only the author confirmation should resolve a matter'; end if;
  if not exists(select 1 from public.campus_matter_actions a where a.id=action_id and a.response_id=workflow.response_id and a.status='done') then raise exception 'action did not persist or link to the response'; end if;
  if not exists(select 1 from public.campus_matter_outcomes where id=(outcome_result->>'id')::uuid and outcome='solved') then raise exception 'confirmed outcome missing'; end if;
  if not exists(select 1 from public.campus_matter_actions a join public.campus_matter_outcomes o on o.action_id=a.id
    where a.response_id=workflow.response_id and o.outcome in ('solved','improved')) then raise exception 'verified-help evidence missing'; end if;
  perform public.campus_matter_response_feedback(author,response_id,'helpful',true);
  perform public.campus_matter_mark(helper,matter_id,'experienced',true);

  -- The helper cannot submit a second answer or rate their own answer.
  denied:=false;
  begin
    perform public.campus_matter_response_submit(helper,matter_id,'advice','再补充一条。','','','',false,true,null);
  exception when unique_violation then denied:=true; end;
  if not denied then raise exception 'one-response-per-author limit failed'; end if;

  -- One reviewed key question can be answered once; answer content returns to review.
  clarification_result:=public.campus_matter_clarification_submit(helper,matter_id,'你之前和室友沟通过吗？');
  clarification_id:=(clarification_result->>'id')::uuid;
  perform public.campus_matter_moderate(reviewer,'matter_clarification',clarification_id,'approve','',1);
  perform public.campus_matter_clarification_reply(author,clarification_id,'还没有，打算先在周末聊。',false);
  if not exists(select 1 from public.campus_matter_clarifications where id=clarification_id and review_status='pending_review' and revision=3) then raise exception 'clarification answer must return to moderation'; end if;
  perform public.campus_set_reviewer(owner_id,author,'怎么办事务测试大学','东区',true,'虚构自审测试',null);
  denied:=false;
  begin
    perform public.campus_matter_moderate(author,'matter_clarification',clarification_id,'approve','',3);
  exception when others then if sqlerrm like '%CAMPUS_SELF_REVIEW%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'reviewer approved their own clarification answer'; end if;
  perform public.campus_matter_moderate(reviewer,'matter_clarification',clarification_id,'approve','',3);
  if not exists(select 1 from public.campus_matter_clarifications where id=clarification_id and status='answered' and review_status='approved') then raise exception 'clarification answer did not publish'; end if;

  -- A/B decisions require a reason and preserve the author’s final choice.
  matter_result:=public.campus_matter_create(author,'','两台二手平板不知道买哪台。','decision','purchase',
    true,true,true,'[{"label":"价格更低"},{"label":"性能更好"}]'::jsonb,'{}'::jsonb,null,null);
  decision_id:=(matter_result->>'id')::uuid;
  perform public.campus_matter_moderate(reviewer,'matter',decision_id,'approve','',1);
  response_result:=public.campus_matter_response_submit(helper,decision_id,'decision','我会选 A。','价格更低，而且卖家还能提供购买凭证。','','',false,true,'A');
  response_id:=(response_result->>'id')::uuid;
  perform public.campus_matter_moderate(reviewer,'matter_response',response_id,'approve','',1);
  perform public.campus_matter_set_choice(author,decision_id,'A','我更重视预算和售后凭证。');
  if not exists(select 1 from public.campus_matters where id=decision_id and author_choice='A' and choice_note like '我更重视%') then raise exception 'author choice was not recorded'; end if;

  -- Existing campus entities are linked by ID, not copied into a second directory.
  matter_result:=public.campus_matter_create(author,'','学校快递点几点关门？','information','campus_info',
    true,true,true,'[]'::jsonb,'{}'::jsonb,'place',place_id);
  if not exists(select 1 from public.campus_matters where id=(matter_result->>'id')::uuid and related_entity_type='place' and related_entity_id=place_id) then raise exception 'campus entity relation missing'; end if;

  -- Reports accept the new target type and remain inside the existing review queue.
  report_id:=gen_random_uuid();
  insert into public.campus_content_reports(id,reporter_id,school,campus,target_type,target_id,reason,detail)
    values(report_id,reporter,'怎么办事务测试大学','东区','matter_response',response_id,'inaccurate','虚构事务测试举报');
  queue:=public.campus_governance_queue(reviewer,0,100,'matter','怎么办事务测试大学');
  if not exists(select 1 from jsonb_array_elements(queue->'items') as q(item) where q.item->>'type'='matter') then raise exception 'matter is missing from the reviewer queue'; end if;
  perform public.campus_matter_response_submit(reporter,decision_id,'advice','虚构待审回应','','','',false,true,null);
  queue:=public.campus_governance_queue(reviewer,0,100,'matter_response','怎么办事务测试大学');
  if not exists(select 1 from jsonb_array_elements(queue->'items') as q(item) where q.item->>'type'='matter_response' and q.item->'item' ? 'author_id') then raise exception 'anonymous response lost its reviewer account linkage'; end if;
  queue:=public.campus_governance_queue(reviewer,0,100,'report','怎么办事务测试大学');
  if not exists(select 1 from jsonb_array_elements(queue->'items') as q(item) where q.item->>'type'='report' and q.item->'item'->>'target_type'='matter_response') then raise exception 'matter reports are missing from the existing report queue'; end if;

  -- School scope is enforced by the mutation RPC, even for a service-side request.
  denied:=false;
  begin
    perform public.campus_matter_response_submit(other_campus,matter_id,'advice','跨校区回应','','','','false','true',null);
  exception when others then if sqlerrm like '%CAMPUS_MATTER_NOT_FOUND%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'cross-campus response was accepted'; end if;

end $$;
reset role;
set local role authenticated;
do $$ declare denied boolean:=false; begin
  begin perform count(*) from public.campus_matters;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'authenticated table read was allowed'; end if;
end $$;
reset role;
rollback;
select 'campus matter workflow transaction tests passed; fictional fixtures rolled back' as result;
