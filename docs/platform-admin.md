# 平台运维

Study-Life 的业务记录以本机为主，账号同步和协作服务运行在 Supabase。平台运维页只管理认证账号及协作服务状态；它不能读取个人同步快照、课程、待办、账本或协作正文。

## 访问和登录

- 正式站点：`https://study-life.pages.dev/#/platform-admin`
- 从个人管理中心进入：登录平台所有者账号后，打开“管理中心”，选择“平台运维”。
- 使用 Supabase Auth 的邮箱和现有密码登录。没有单独的后台密码；忘记密码时走账号面板的邮件重设流程。
- 首位所有者为项目指定的已验证 Supabase 账号。后台角色保存在服务端 `platform_admins` 表中，不保存在浏览器、`user_metadata` 或用户可自行编辑的字段中。

## 已开放的能力

- 概览：逐页统计 Auth 账号数、进行中的协作项目数、协作资料数和最近一次真实查询时间。账号超过 50,000 时显示已扫描数量下限。
- 账号管理：按邮箱搜索，按页查看注册和登录时间、邮箱验证及暂停状态。
- 暂停/恢复：操作前填写原因；暂停会阻止新的登录和会话续期。已签发的访问令牌在过期前可能仍可使用；操作不删除账号、设备数据或项目内容。平台所有者账号不能被暂停。
- 管理审计：服务端记录操作者、对象、操作、结果、原因和时间。

搜索最多扫描 50,000 个账号；达到上限且仍有下一页时，页面会提示结果可能不完整。账号列表只返回邮箱和认证状态，不返回用户 metadata、同步快照或业务内容。

## 服务端安全边界

- `platform-admin` Edge Function 保持 `verify_jwt = true`，并再次从 Supabase Auth 验证用户会话。
- 每次管理请求都在服务端查询 `platform_admins`；前端显示/隐藏入口不参与授权判断。
- 管理表启用 RLS，且只向 `service_role` 授权。`anon` 和 `authenticated` 没有读取或写入权限。
- `service_role` 仅存在于 Supabase Edge Function 运行环境，不进入网页包、Cloudflare 环境变量或 Git。
- 当前只开放一个平台所有者。后台没有账号删除、角色自助提升、数据库恢复、读取用户私有内容等能力。

## 数据库和发布

迁移：`supabase/migrations/20261013013521_platform_admin_console.sql`

迁移只新增两张服务端管理表及索引，不改写现有账号、快照或协作数据。部署顺序：先应用数据库迁移并绑定所有者，再部署 `platform-admin` Edge Function，最后发布网页版本。Cloudflare Pages Git 集成从 `main` 构建网页；Supabase 迁移与 Edge Function 需要单独部署。

如果需要回退网页代码，恢复到之前的 Pages 部署即可。新表是附加结构；代码回退时保留迁移和审计记录，不要自动删除或重置生产数据库。

SQL 回归检查保存在 `supabase/tests/platform_admin.sql`。本地 Supabase 测试环境运行后，它会确认 owner 唯一性、匿名/普通账号无法访问管理数据，并在事务回滚后清理虚构测试行。
