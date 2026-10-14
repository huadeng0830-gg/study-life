-- All fixtures are fictional and the entire test is rolled back.
begin;
select set_config('campus_test.owner',(select user_id::text from public.platform_admins where role='owner'),true);
select set_config('campus_test.reviewer',gen_random_uuid()::text,true);
select set_config('campus_test.author',gen_random_uuid()::text,true);
select set_config('campus_test.reporter',gen_random_uuid()::text,true);
select set_config('campus_test.east',gen_random_uuid()::text,true);
select set_config('campus_test.west',gen_random_uuid()::text,true);
select set_config('campus_test.self',gen_random_uuid()::text,true);
select set_config('campus_test.report',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) select current_setting('campus_test.'||k)::uuid,
  'fictional-governance-'||current_setting('campus_test.'||k)||'@example.invalid',now()
  from unnest(array['reviewer','author','reporter']) k;
insert into public.campus_guides(id,owner_id,school,campus,title,category,body,source_type)
  select current_setting('campus_test.'||k)::uuid,
    current_setting('campus_test.'||case when k='self' then 'reviewer' else 'author' end)::uuid,
    '虚构治理测试大学',case when k='west' then '西区' else '东区' end,'虚构审核范例','other','用于事务回滚测试的虚构正文','student_experience'
  from unnest(array['east','west','self']) k;

set local role service_role;
do $$
declare
  owner_id uuid:=current_setting('campus_test.owner')::uuid;
  reviewer uuid:=current_setting('campus_test.reviewer')::uuid;
  author uuid:=current_setting('campus_test.author')::uuid;
  reporter uuid:=current_setting('campus_test.reporter')::uuid;
  east uuid:=current_setting('campus_test.east')::uuid;
  west uuid:=current_setting('campus_test.west')::uuid;
  self_id uuid:=current_setting('campus_test.self')::uuid;
  report_id uuid:=current_setting('campus_test.report')::uuid;
  result jsonb; denied boolean;
begin
  perform public.campus_set_reviewer(owner_id,reviewer,'虚构治理测试大学','东区',true,'虚构授权测试',null);
  if not public.campus_can_review(reviewer,'虚构治理测试大学','东区') or public.campus_can_review(reviewer,'虚构治理测试大学','西区') then raise exception 'scope isolation failed'; end if;
  if public.campus_can_review(reviewer,'其他虚构大学','东区') or public.campus_can_review(reviewer,'虚构治理测试大学','') then raise exception 'school/global scope isolation failed'; end if;
  result:=public.campus_governance_queue(reviewer,0,40,'guide','虚构治理测试大学');
  if (result->>'total')::integer<>2 then raise exception 'queue scope failed: %',result; end if;
  if exists(select 1 from jsonb_array_elements(result->'items') r where r->'item' ? 'owner_id') then raise exception 'queue exposed authors'; end if;
  denied:=false;
  begin perform public.campus_life_moderate_content(reviewer,'guide',west,'approve','',1);
  exception when others then if sqlerrm like '%CAMPUS_FORBIDDEN%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'cross-campus review accepted'; end if;
  denied:=false;
  begin perform public.campus_life_moderate_content(reviewer,'guide',self_id,'approve','',1);
  exception when others then if sqlerrm like '%CAMPUS_SELF_REVIEW%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'self-review accepted'; end if;
  denied:=false;
  begin perform public.campus_life_moderate_content(reviewer,'guide',east,'approve','',2);
  exception when others then if sqlerrm like '%REVISION_CHANGED%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'stale revision accepted'; end if;
  perform public.campus_life_moderate_content(reviewer,'guide',east,'approve','核对公开资料',1);
  if not exists(select 1 from public.campus_guides where id=east and review_status='approved' and revision=2) then raise exception 'approval failed'; end if;
  insert into public.campus_content_reports(id,reporter_id,school,campus,target_type,target_id,reason,detail)
    values(report_id,reporter,'虚构治理测试大学','东区','guide',east,'inaccurate','虚构举报说明');
  denied:=false;
  begin perform public.campus_resolve_report(reviewer,report_id,'remove','需要核实',1,'1');
  exception when others then if sqlerrm like '%REVISION_CHANGED%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'report stale revision accepted'; end if;
  if not exists(select 1 from public.campus_content_reports where id=report_id and status='pending_review') then raise exception 'failed removal partially saved'; end if;
  perform public.campus_resolve_report(reviewer,report_id,'remove','虚构测试：资料不准确，退回补正',1,'2');
  if not exists(select 1 from public.campus_guides where id=east and review_status='rejected' and revision=3) then raise exception 'reported content remained public'; end if;
  if not exists(select 1 from public.campus_content_reports where id=report_id and status='resolved' and resolution_action='remove' and resolved_at is not null) then raise exception 'report resolution missing'; end if;
  if not exists(select 1 from public.social_notifications where recipient_id=reporter and resource_id=report_id and kind='campus_report_reviewed') then raise exception 'reporter feedback missing'; end if;
  if not exists(select 1 from public.social_notifications where recipient_id=author and resource_id=east) then raise exception 'author feedback missing'; end if;
  result:=public.campus_governance_history(reviewer,0);
  if jsonb_array_length(result)<>3 then raise exception 'history scope missing: %',result; end if;
  perform public.campus_set_reviewer(owner_id,reviewer,'虚构治理测试大学','东区',false,'虚构撤权测试',1);
  if public.campus_can_review(reviewer,'虚构治理测试大学','东区') then raise exception 'revocation ineffective'; end if;
  denied:=false;
  begin perform public.campus_life_moderate_content(reviewer,'guide',self_id,'reject','虚构测试',1);
  exception when others then if sqlerrm like '%CAMPUS_FORBIDDEN%' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'revoked reviewer accepted'; end if;
  perform public.campus_withdraw_content(author,'guide',west,'1');
  if not exists(select 1 from public.campus_guides where id=west and review_status='rejected' and review_reason='作者主动撤回') then raise exception 'author withdrawal failed'; end if;
end $$;
reset role;
-- A suspended reviewer can still be revoked, while a new grant is denied.
update auth.users set banned_until=now()+interval '1 day' where id=current_setting('campus_test.reviewer')::uuid;
set local role service_role;
select public.campus_set_reviewer(current_setting('campus_test.owner')::uuid,current_setting('campus_test.reviewer')::uuid,'虚构治理测试大学','东区',false,'虚构暂停后撤权',2);
reset role;
set local role authenticated;
do $$ declare denied boolean:=false; begin
  begin perform public.campus_governance_queue(current_setting('campus_test.reviewer')::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'authenticated caller reached governance RPC'; end if;
  denied:=false;
  begin perform count(*) from public.campus_reviewer_grants;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'authenticated caller read reviewer registry'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false; begin
  begin perform public.campus_verified_actor(current_setting('campus_test.owner')::uuid);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'anonymous caller reached auth helper'; end if;
end $$;
reset role;
rollback;
select 'campus governance transaction tests passed; all fictional fixtures rolled back' as result;
