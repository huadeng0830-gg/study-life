# 齐行项目协作

齐行把课程小组项目的成员、任务、里程碑、成果验收和讨论安排放进三两事。该功能使用已验证的邮箱账号，需要联网；它与本机课程、待办和账本分开保存。

## 功能范围

- 项目创建、管理员与成员角色、成员邀请、可撤销的限额邀请链接、加入申请和成员离开/移除。
- 任务分派、接受或拒绝、截止日期、优先级、父子任务、依赖关系、状态、个人任务同步和动态记录。
- 里程碑、交付检查清单、调整请求及处理记录。
- 交付项草稿、版本提交、验收清单和反馈；需要验收的成果通过后，关联任务才可完成。
- 项目讨论邀请、成员回应、改期提议、共同空闲校验和个人日程桥接。

## 服务端和隐私边界

浏览器调用 `campus-social` Edge Function 并提供 Supabase 登录 JWT。函数保持 `verify_jwt = true`，再次读取 Auth 用户，再由 `public.project_dispatch` 校验项目状态、成员身份、角色、请求版本和资源归属。`project_dispatch` 只授权 `service_role` 执行；函数使用 `service_role` 访问项目表。

项目相关的 15 张 `team_project_*` 表均启用 RLS，同时撤销 `anon` 与 `authenticated` 的直接表权限，也不创建允许浏览器直连的表策略。Storage bucket `qixing-deliverables` 是私有桶，当前单文件限制 20 MiB；对象路径在上传和读取时校验项目、交付项、当前用户及有效成员关系。项目成员不会因此获得他人的课表、课程事件或账单；会议匹配仅返回可约区间。

好友课表匹配与邀请仍共用 `campus-social` 函数，但使用各自的 `social_*` 表与限流表。账号快照同步使用独立的 `account_sync_snapshots` 表。

## 数据库迁移

迁移按文件名时间顺序应用，部署时先推数据库，再部署 Edge Function 和网页。齐行迁移为：

- `20261008063633_qixing_project_collaboration_schema.sql`：15 张项目表、约束、RLS、表权限、私有 Storage bucket 和对象访问策略。
- `20261008064042_qixing_project_collaboration_dispatch.sql`：供 Edge Function 调用的项目权限 RPC。
- `20261008064136_qixing_project_collaboration_fk_indexes.sql`：覆盖项目新增外键的索引。

仓库已包含最小 `supabase/config.toml`，本地需要 Supabase CLI、项目访问权限和数据库密码：

```bash
npx supabase login
npx supabase link --project-ref xyuwjmswqmxfwtyzakan
npx supabase db push
npx supabase functions deploy campus-social --project-ref xyuwjmswqmxfwtyzakan
```

生产环境当前已应用上述迁移及任务续接工作台迁移，`campus-social` 已部署为 v3，JWT 验证开启。修改数据库时新增迁移文件，不要改写已应用的迁移；涉及迁移的发布先执行 `db push`，再部署函数，最后重建并发布 Cloudflare Pages。

## 验收

上线后使用两个已验证的测试账号验证项目创建、邀请与成员权限；覆盖任务分配、依赖阻止/解除、版本冲突、成果退回/通过、讨论回应/改期及共同空闲冲突。另确认未登录请求被 JWT 网关拒绝、`anon`/`authenticated` 不能直读项目表、非成员无法读写私有成果文件。不要用真实课程或私人账单做演示数据。
