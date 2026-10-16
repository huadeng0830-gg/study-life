-- 反馈处理的审计闭环：证明「谁把这条建议改成了什么」。
--
-- 【修复前的事实】
--  1. `campus_manage_feedback` 会改状态、公开回复、公开原因，甚至发放 0–20 个贡献豆，
--     却**不写任何审计**，动作白名单里也没有 feedback 相关的动作。
--  2. `platform_admin_audit` 对 service_role 授予了 `update, delete` —— 审计可以事后改写，
--     而全仓没有任何代码需要改写它。
-- 于是「谁把已解决改回处理中」「谁在隐藏状态下改了公开回复」「谁发了豆」事后全无痕迹；
-- 而奖励一旦发放（`reward_issued=true`）不可撤销。
--
-- 【本迁移做什么】
--  1. 动作白名单加入 `feedback.manage`；
--  2. 新增通用的 `change_details`（`restriction_details` 专用于账号限制，不借用来放反馈）；
--  3. `campus_manage_feedback` 在**同一事务**里写审计（业务改动与审计一起成功或一起失败）；
--  4. 审计表对 service_role 收回 `update, delete`，变成只可追加。
--
-- 说明：只记录成功的处理动作。被拒绝的调用（参数非法、版本冲突）目前只抛错不留痕，
-- 因为真正的追责对象是「改动本身」；若以后需要，「who tried and failed」应单独一条 action。
begin;

alter table public.platform_admin_audit drop constraint platform_admin_audit_action_check;
alter table public.platform_admin_audit add constraint platform_admin_audit_action_check
  check (action in ('user.suspend','user.restore','user.publish_restrict','user.publish_restore',
    'reviewer.grant','reviewer.revoke','registration.open','registration.pause','feedback.manage'));

alter table public.platform_admin_audit add column change_details jsonb;

-- 审计的价值取决于它不可被改写。授予 select, insert 足够让平台运维读取与追加。
revoke update, delete on public.platform_admin_audit from service_role;

drop function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz);
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
  -- 审计与业务改动同一个事务：要么都留下，要么都不留。
  -- reason 必填且限 1–500 字，所以写「状态迁移」而不是复用公开回复 —— 后者是对外文案，
  -- 可能为空（例如只是改可见性），也可能被管理员写得很长。
  insert into public.platform_admin_audit(actor_user_id,target_user_id,action,outcome,reason,completed_at,change_details)
    values(p_actor,v_item.author_id,'feedback.manage','succeeded',
      left('反馈处理：'||v_item.status||' → '||p_status,500),now(),
      jsonb_build_object('feedbackId',p_feedback,'fromStatus',v_item.status,'toStatus',p_status,
        'fromVisibility',v_item.visibility,'toVisibility',p_visibility,
        'replyChanged',btrim(coalesce(p_reply,'')) is distinct from v_item.public_reply,
        'reasonChanged',btrim(coalesce(p_public_reason,'')) is distinct from v_item.public_reason,
        'reward',p_reward,'rewardIssued',p_reward is not null));
  return jsonb_build_object('saved',true,'reward_issued',p_reward is not null,'status',p_status,'visibility',p_visibility);
end;
$$;
revoke all on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz) from public,anon,authenticated;
grant execute on function public.campus_manage_feedback(uuid,uuid,text,text,text,text,smallint,timestamptz) to service_role;

commit;