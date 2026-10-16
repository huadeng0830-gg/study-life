-- 反馈处理的审计闭环。虚构数据，整个事务结束回滚。
begin;
select set_config('feedback_audit.owner',(select user_id::text from public.platform_admins where role='owner'),true);
select set_config('feedback_audit.author',gen_random_uuid()::text,true);
select set_config('feedback_audit.suggestion',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at)
  select current_setting('feedback_audit.author')::uuid,
    'fictional-feedback-audit-'||current_setting('feedback_audit.author')||'@example.invalid',now();
insert into public.campus_feedback_suggestions(id,author_id,category,title,body,status,visibility,public_author_name,is_anonymous)
  values(current_setting('feedback_audit.suggestion')::uuid,
    current_setting('feedback_audit.author')::uuid,'product','虚构审计用例标题','用于事务回滚测试的虚构正文内容。',
    'pending','hidden','匿名用户',true);

set local role service_role;
do $$
declare
  owner_id uuid:=current_setting('feedback_audit.owner')::uuid;
  author uuid:=current_setting('feedback_audit.author')::uuid;
  suggestion uuid:=current_setting('feedback_audit.suggestion')::uuid;
  before_count integer;
  row_count integer;
  details jsonb;
  denied boolean:=false;
begin
  select count(*) into before_count from public.platform_admin_audit;

  perform public.campus_manage_feedback(owner_id,suggestion,'public','planned','虚构进展说明','',null,null);
  select count(*) into row_count from public.platform_admin_audit;
  if row_count<>before_count+1 then raise exception 'feedback.manage wrote % audit rows, expected exactly one',row_count-before_count; end if;

  select change_details into details from public.platform_admin_audit
    where action='feedback.manage' order by created_at desc,id desc limit 1;
  if details->>'fromStatus'<>'pending' or details->>'toStatus'<>'planned' then
    raise exception 'audit change_details lost the status transition: %',details;
  end if;
  if details->>'toVisibility'<>'public' then raise exception 'audit change_details lost the visibility transition: %',details; end if;
  if not exists(select 1 from public.platform_admin_audit
      where action='feedback.manage' and actor_user_id=owner_id and target_user_id=author and outcome='succeeded') then
    raise exception 'audit row lost its actor, target or outcome';
  end if;
  if not exists(select 1 from public.platform_admin_audit
      where action='feedback.manage' and reason='反馈处理：pending → planned') then
    raise exception 'audit reason did not record the status transition';
  end if;

  -- 第二次处理必须**再写一条**，而不是覆盖上一条：审计是流水，不是状态。
  perform public.campus_manage_feedback(owner_id,suggestion,'public','resolved','虚构解决说明','',null,null);
  select count(*) into row_count from public.platform_admin_audit where action='feedback.manage';
  if row_count<>2 then raise exception 'a second manage produced % audit rows, expected 2',row_count; end if;
  if not exists(select 1 from public.platform_admin_audit where action='feedback.manage'
      and change_details->>'fromStatus'='planned' and change_details->>'toStatus'='resolved') then
    raise exception 'the second audit row lost its from/to status';
  end if;

  -- 发放奖励也要能追到人：奖励一旦发出去不可撤销，这条记录是唯一的凭据。
  perform public.campus_manage_feedback(owner_id,suggestion,'public','resolved','虚构解决说明','',8,null);
  if not exists(select 1 from public.platform_admin_audit where action='feedback.manage'
      and (change_details->>'reward')::integer=8 and (change_details->>'rewardIssued')::boolean) then
    raise exception 'the reward was not recorded in the audit trail';
  end if;

  -- 审计只可追加：service_role 也不能改写或删除历史。
  begin
    update public.platform_admin_audit set reason='被改写的理由' where action='feedback.manage';
    raise exception 'updating audit rows was accepted';
  exception
    when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'service_role can still update audit rows'; end if;

  denied:=false;
  begin
    delete from public.platform_admin_audit where action='feedback.manage';
    raise exception 'deleting audit rows was accepted';
  exception
    when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'service_role can still delete audit rows'; end if;
end $$;

-- 普通账号既读不到反馈审计，也调不动这个 RPC。
reset role;
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin perform count(*) from public.platform_admin_audit;
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'authenticated users can read the admin audit trail'; end if;
end $$;

rollback;
select 'passed' as feedback_manage_audit_checks,
  (select count(*) from public.platform_admin_audit where action='feedback.manage') as remaining_feedback_audits;