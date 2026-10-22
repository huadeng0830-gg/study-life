-- 扩展平台运维能力所需的最小附加结构。
--
-- 【为什么必须迁移】`platform_admin_audit.action` 原先被 CHECK 写死为
-- ('user.suspend','user.restore')。任何新增管理动作写入审计都会直接失败，
-- 所以下面第一件事就是放宽这个枚举。
--
-- 【边界】只新增列与放宽枚举，不改写任何既有审计行，不触碰账号、快照或协作数据。
alter table public.platform_admin_audit drop constraint if exists platform_admin_audit_action_check;
alter table public.platform_admin_audit
  add constraint platform_admin_audit_action_check
  check (action in ('user.suspend', 'user.restore', 'user.sessions_revoke', 'user.password_reset'));

-- 限时暂停的到期时间。原有行为（永久暂停）留空即可，保持向后兼容。
alter table public.platform_admin_audit add column if not exists expires_at timestamptz;

-- 动作的附加上下文，例如限时暂停的时长、吊销了几个会话。
-- 只允许放不含用户内容的结构化字段。
alter table public.platform_admin_audit add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.platform_admin_audit drop constraint if exists platform_admin_audit_details_object;
alter table public.platform_admin_audit
  add constraint platform_admin_audit_details_object check (jsonb_typeof(details) = 'object');

-- 审计列表要按动作与结果筛选；原索引只覆盖 created_at。
create index if not exists platform_admin_audit_action_created_at_idx
  on public.platform_admin_audit (action, created_at desc);