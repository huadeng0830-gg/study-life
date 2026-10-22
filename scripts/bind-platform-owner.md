# 绑定平台所有者

`platform_admins` 表由迁移创建，但**没有任何代码会往里写所有者**。
迁移只 `create table`，仓库里唯一一条 `insert into platform_admins`
在 `supabase/tests/platform_admin.sql` 里，而那是事务内会回滚的测试数据。

所以生产库这张表通常是空的，`platform-admin` Edge Function 的
`isOwner()` 恒为 false，每个请求都返回 403，页面显示
"此账号没有平台管理权限"。本脚本就是补上这一步。

## 用法

```powershell
npm run supabase:bind-owner -- owner@example.com
```

可选 `--dry-run` 只打印将要执行的语句。

脚本会：

1. 通过 `supabase projects api-keys` 取 service_role key
2. 若 `platform_admins` 已有所有者，直接报告并退出（幂等）
3. 按邮箱查出 `auth.users` 里的账号（**必须已验证邮箱**，否则 Edge Function 会以
   `email_verification_required` 拒绝）
4. 写入 `platform_admins` 并打印结果

## 为什么走 REST 而不是 `db execute`

迁移里已经 `grant select, insert, update, delete ... to service_role`，
而 service_role 绕过 RLS，所以绑定只需要一个 service_role key，
**不需要数据库密码**——那是所有凭据里最不该到处贴的一个。

## 换所有者

唯一索引 `platform_admins_single_owner` 限制同时只能有一个所有者。
先解绑再绑定：

```sql
delete from public.platform_admins;
```