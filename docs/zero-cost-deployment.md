# 零费用架构实施记录

核验日期：2026-10-15。约束：不绑定支付方式，不开通付费套餐，没有自有域名。Cloudflare Workers Free 由维护者明确确认；Supabase 组织读取结果为 Free。本次没有购买域名、绑定付款方式或创建付费服务。

本次数据库实测约 17.7 MB（`pg_database_size`，含数据库内部开销）；这是当次观测值，不是可持续用户数或剩余额度承诺。

## 已实施

- Pages 继续托管静态 Web/PWA；私有业务保留 Supabase Postgres、Auth、RPC/RLS 和现有 Edge Functions。
- 专用 Worker `study-life-public-api` 只读公开反馈，地址为 `https://study-life-public-api.sync-coordinator.workers.dev`。没有 R2、D1、KV、Durable Objects 等资源绑定。
- `/v1/feedback` 仅接受公开查询筛选项，使用 publishable key、固定字段白名单和 `visibility=public` RLS。作者身份和私有反馈不进入响应或缓存。只读 GET/OPTIONS、精确来源白名单、15 秒共享缓存；进入 Worker 的请求仍计算请求额度，缓存按数据中心独立存在。
- 私有 `qixing-deliverables` bucket 的新上传限制已设为 5 MiB，并读回验证。既有文件未删除。客户端也在上传前检查；单账号或项目的总容量配额尚未实施。服务端配置操作留档在 `supabase/operations/zero-cost-storage-limit.sql`，后续优先使用 Storage API 管理脚本。
- 同步保留元数据探测、版本比较和冲突处理。已确认版本未改变时复用会话内快照，减少整包读取；界面增加本次会话有效载荷估算。计数不持久化、不上传，不能代替 Supabase 的实际计量。
- GitHub/Google OAuth 代码已接入；维护者已配置 Supabase GitHub 提供方，本地与 Pages 生产构建提供方列表已设为 `github`，Google 保持关闭。邮件注册、重发和恢复默认关闭；已有账号密码登录保留。没有 SMTP 或自有发信域名时不承诺邮件可达。

## 生产生效边界

Worker 和存储桶限制已经线上生效。Pages 项目的生产构建变量已配置，但已有静态资源不会因此更新；前端变化仍需要重新构建和合规发布。

当前工作区包含本轮开始前已有的大量未提交改动。`scripts/deploy-production.mjs` 要求干净的 `main` 且本地 HEAD 等于 `origin/main`，因此不能直接发布当前工作区。先审查、隐私扫描并提交需要发布的源码，再使用正式发布脚本；不要绕过闸门部署未审查的混合改动。

GitHub OAuth 提供方已于 2026-10-15 由维护者完成配置。公开 Auth settings 读回 `github=true`，授权入口返回 302 并指向 GitHub 官方授权端点；Client ID 格式、Supabase 回调地址及仅 `user:email` 请求范围检查通过。这项检查停在 Supabase 的重定向响应，没有访问 GitHub 页面、创建用户或完成令牌交换；完整登录回调仍待发布后的真实账号验收。Client Secret 只保存在控制台，不进入聊天或仓库。

后续维护 OAuth App 时，主页使用 `https://study-life.pages.dev`，回调使用 `https://xyuwjmswqmxfwtyzakan.supabase.co/auth/v1/callback`，不启用通配符或 Device Flow。邮箱和 GitHub 登录密码不是 OAuth 客户端凭据。

本地迁移 `20261015110001_zero_cost_public_api.sql` 已通过 Supabase MCP 应用，但 MCP 自动记录为远端版本 `20261015071020`，名称均为 `zero_cost_public_api`。在线权限、RLS 和索引已经验证。直接对齐历史元数据的操作被自动审批拒绝，未修改历史记录。维护者随后授权继续处理，但当前 CLI 未登录，官方修复流程仍缺少可用认证。先通过[官方 migration list / repair 流程](https://supabase.com/docs/reference/cli/supabase-migration-repair)核对这项差异及原有历史漂移，再执行全量 `db push`。不要重复应用或删除业务表。

## 配置与验证

在未跟踪的 `.env.local` 中配置公开客户端参数；示例见 `.env.example`。生产 Pages 已设置：

```dotenv
VITE_PUBLIC_API_URL=https://study-life-public-api.sync-coordinator.workers.dev
VITE_ACCOUNT_OAUTH_PROVIDERS=github
VITE_ACCOUNT_EMAIL_SIGNUP_ENABLED=false
VITE_ACCOUNT_EMAIL_DELIVERY_ENABLED=false
```

Supabase URL 和 publishable key 沿用现有公开客户端配置。禁止将 secret/service_role key 放入任何 `VITE_` 变量。GitHub Actions 的 Web job 读取同名仓库 Variables；若未配置公开接口 URL，构建会使用原公开查询接口。此记录不保存真实密钥或用户数据。

```sh
npm run auth:inspect
npm run worker:check
npm run worker:deploy                         # 仅 dry-run
npm run worker:deploy -- --apply --free-plan-confirmed
npm run storage:free-limit                    # 仅检查；需要服务端认证
npm run storage:free-limit -- --apply
npm run check
```

Windows 受限沙箱可能无法启动 workerd，需要在获准的正常进程权限下运行 `worker:check`。检查包括实际 workerd 回源、缓存命中、拒绝重定向以及来源隔离，外部请求由虚构上游替代，不消耗线上数据库资源。

公开端点验收：`GET /health` 和 `GET /v1/feedback?limit=1` 应为 200，非法筛选为 400，非白名单 Origin 为 403，POST 为 405。不要用真实私有内容做公开接口测试。`/health` 只报告配置是否就绪；它不证明 Supabase 当下可用。

## 回退与免费额度

公开接口回退：清空 `VITE_PUBLIC_API_URL` 并重新构建 Pages，客户端将使用原 `campus-community` 公开列表路径；私有写入和同步路径不变。不要因为 Worker 失败而自动发起第二套回源请求，以免故障时重复消耗额度。

OAuth 在 Supabase 提供方及授权跳转检查通过后配置为 `github`；新前端发布后验证完整登录和回调，再向用户开放推广。若登录失败，清空该变量并重新构建即可隐藏入口。发信能力只有在真实邮件送达验收后才开启。不要为消除邮件限制而自动升级套餐。

定期查看 Supabase 数据库、Storage 和出站用量，以及 Workers 请求和 CPU 用量。免费配额用完可能导致功能受限，本地基本功能和导出应保持可用；此方案不承诺无限容量。R2、Clerk、Resend、Turso 和 D1 暂不作为依赖，后续按实际瓶颈评估。

## 安全检查的既有提示

Supabase Security Advisor 没有报告本次公开反馈表缺失 RLS。仍有既有的 [RLS 开启但无 policy 提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)：相关表由现有受控 Edge Function 使用，客户端权限保持关闭，不应为清除提示而直接开放读取。另有[泄露密码保护尚未开启](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)提示；本轮没有为此升级套餐。OAuth 仍需完成真实登录验收。

## 本轮验证结果

- GitHub 提供方配置后的认证入口、能力开关及账号面板定向测试：3 个文件、20 项通过。生产构建变量启用 `github`；这不改变当前已部署的静态资源。
- 355 个测试文件、3,214 项测试通过；修复了两个旧弹窗守卫清单、存储估算返回值断言和同步回归 mock 的适配问题，保留实际调用拒绝和迟到响应隔离断言。
- Workers 类型生成、类型检查、dry-run 及实际 workerd 冒烟通过；线上正常读取 200、非法筛选 400、非白名单来源 403、写入 405 均已验证。
- ESLint、Vue 类型检查和类型基线检查通过。检查期间其他源码仍有变化，首次构建被版本签名检查阻止；通过正式发布脚本更新未发布候选的说明和签名后，Web/PWA 1.6.0 构建通过，源码签名读回一致。
- 构建产物中 214 个 JavaScript 资源通过公开配置和秘密扫描。源码扫描覆盖 1,089 个文件；仅命中既有秘密检测测试内的三组虚构夹具，已人工复核。未跟踪真实 `.env`、数据库、日志或私钥；本轮没有提交或推送混合工作区，也没有构建桌面安装包。
