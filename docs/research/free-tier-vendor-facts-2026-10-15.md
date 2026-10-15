# Supabase、Turso、Clerk、Resend 免费方案核验

> 查询日期：2026-10-15（Asia/Shanghai）。仅查公开官方资料，未登录或修改线上资源，未读取真实用户数据。已读取项目根 `AGENTS.md`，沿用 `docs/research/` 的研究文档位置。
>
> 当前约束：没有自有域名；不绑定银行卡或其他付款方式；不启用付费订阅、试用或自动超额。这里的“零成本”指保持免费计划并接受限额后的功能停止；任何供应商都不承诺免费计划永久不变。

## 可直接用于方案决策的结论

| 服务 | 在当前约束下的位置 | 主要依据 |
|---|---|---|
| Supabase Free | 首选候选：Postgres + Auth + 小附件；Auth 先用 GitHub OAuth | 免费含社交 OAuth；默认 Supabase 回调域名即可；免费超额走通知和服务限制，仍应保留本地导出能力。 |
| Turso Free | 数据库替代候选，不与 D1、Supabase 同时部署业务主数据 | 定价明确无需信用卡；容量和读写额度更宽，但需要自己做身份鉴权和应用层数据隔离。 |
| Clerk | 当前排除 | 虽有免费认证额度，但生产部署明确需要自有域名和 DNS 控制权。 |
| Resend | 当前不接入正式用户邮件 | 无需付款信息，但默认 `resend.dev` 只能发给账号自身邮箱；任意收件人需要验证自己的域名。 |

表格是对下文主源的工程判断；免费额度不能跨产品简单相加成单一资源池。没有域名时，不能把 Resend 的 3,000 封/月当成已经可供公众使用的能力。

## 1. Supabase Free

### 免费额度

| 资源 | 当前免费额度 |
|---|---|
| 活跃项目 | 2 个；跨本人作为 Owner/Admin 的组织计数 |
| Postgres 数据库 | 每项目 500 MB；共享 CPU、500 MB RAM |
| 非缓存 Egress | 每月 5 GB，Database/Auth/Storage/Functions/Realtime 等共用 |
| 缓存 Egress | 每月另有 5 GB；不是可以自由替代非缓存流量的总 10 GB |
| 文件存储 | 1 GB；免费单文件上传上限 50 MB |
| Auth | 50,000 MAU；总用户数不限；社交 OAuth 免费 |
| 第三方 Auth 用户 | 50,000 Third-Party MAU；例如改用 Clerk 仍会消耗此额度 |
| Realtime | 200 峰值并发连接，2,000,000 消息/月 |
| Edge Functions | 500,000 调用/月 |
| 自动数据库备份、PITR | 免费计划不包含 |

来源：[Supabase 当前定价](https://supabase.com/pricing)、[组织计费与免费项目数](https://supabase.com/docs/guides/platform/billing-on-supabase)、[Egress 计量](https://supabase.com/docs/guides/platform/manage-your-usage/egress)。API 请求次数不限不代表 CPU、数据库体积、连接数或返回流量不限。

### 不绑卡、超额、休眠和备份

- **不绑卡依据的证据强度**：当前账单文档明确是付费计划需要银行卡，升级要主动进入账单选择计划；官网 2021 年定价公告曾明确免费体验不需信用卡。本次没有实际开户，因此不能声称实测了 2026 年注册界面；如果注册出现付款方式要求，应停止该流程，不按“先绑卡再设上限”处理。[当前账单设置](https://supabase.com/docs/guides/platform/get-set-up-for-billing)、[管理订阅](https://supabase.com/docs/guides/platform/manage-your-subscription)、[2021 年官方 no-card 说明，旧资料](https://supabase.com/blog/2021-03-29-pricing)
- 免费超额后先通知，持续超额可暂停项目、数据库只读或 API 返回 `402`；官方免费超额流程是减少使用或主动升级。不能承诺超额仍正常服务。[Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq#what-will-happen-when-i-exceed-the-free-plan-quota)
- 数据库大于 500 MB 会进入只读；这个限额针对数据库数据大小，免费实例分配的 1 GB 磁盘不能当成 1 GB 数据库配额。新项目本身约占 40–60 MB。[数据库与磁盘大小](https://supabase.com/docs/guides/platform/database-size#free-plan-behavior)
- 免费项目在一周低数据库活动后可能暂停；当前文档写可在暂停后 **1 年**内从平台恢复，并非旧资料中的 90 天。只用 Auth、把业务数据库放 D1，不能推定已满足“足够数据库活动”的判断。[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- 免费计划应定期自行导出数据库并保留离站备份；数据库备份也不包含 Storage 中实际文件对象，附件要另行备份。[Database Backups](https://supabase.com/docs/guides/platform/backups)

### 没有自有域名时的 Auth

**GitHub OAuth 路径有明确文档支持**：创建 GitHub OAuth App，主页填写站点 HTTPS 地址，回调填写 `https://<project-ref>.supabase.co/auth/v1/callback`，再在 Supabase 配置密钥和本站 redirect allow list。这个流程使用供应商域名，没有自有发信域名步骤；不额外启用应用发邮件的确认步骤即可避免依赖自己的 SMTP。属于将官方流程用于 Pages 地址的工程推断，本次未实际注册 OAuth App。[GitHub 登录教程](https://supabase.com/docs/guides/auth/social-login/auth-github)

Google OAuth 文档同样允许默认 `<project-id>.supabase.co`，自定义域名是改善品牌和信任度的建议。Google 同意屏幕、发布状态、scope 验证及目标用户网络可达性仍需单独核验；这里不把 Google 设为首期唯一登录方式。[Google 登录教程](https://supabase.com/docs/guides/auth/social-login/auth-google#setup-consent-screen-branding)

**默认 SMTP 不能用于公开注册邮件**：只允许寄给项目团队成员邮箱，目前 2 封/小时，且限制可随时变化。自定义 SMTP 可用 Resend，但默认还有 30 封/小时 Auth 邮件限制，可配置。不要为了避开发信限制而向公众开放未验证邮箱注册。[SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)

### 与 Clerk 组合的成本

Supabase 原生支持 Clerk 第三方认证，并通过 Clerk session token 和 RLS 保护数据库、Storage、Realtime。旧的共享 Supabase JWT secret + Clerk JWT template 方案在 2025-04-01 废弃，不应照搬旧教程。增加 Clerk 后需要处理字符串用户 ID、RLS 和两端用户生命周期；这些是集成成本，并不增加主数据库容量。[Supabase / Clerk 当前集成](https://supabase.com/docs/guides/auth/third-party/clerk)

### 本次发现的相关 2026 变更

先尝试读取 `changelog.md`，浏览器工具不支持其 `text/markdown` 类型，随后改查官方 [HTML changelog](https://supabase.com/changelog)。相关项：2026-06-03 起新免费项目使用默认 SMTP 不能定制 Auth 邮件模板；Data API 表授权规则已调整，2026-10-30 将对所有项目强制执行，RLS 和表级 GRANT 要分别检查。[邮件模板变更](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)、[Data API 默认暴露变更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

## 2. Turso Free

当前定价明确 **no credit card required**；免费为 100 个数据库、合计 5 GB 存储、每月 500,000,000 rows read、10,000,000 rows written、3 GB syncs，Point-in-Time Restore 为 1 天。不要引用旧版“500 个库 / 9 GB / 十亿次读”作为现行免费额度。[当前定价](https://turso.tech/pricing)

官方 Usage & Billing 解释超额查询会返回 `BLOCKED`，读计量是扫描行数，可能远高于结果行数；索引维护还可能增加写量。该文档仍残留旧的 Starter/Scaler 计划名，因此数字以当前定价页为准，错误行为依据该限制文档。定价页说明自动超额计费需要启用；本项目应保持 Free、不提供付款方式、不启用 overages。[Usage & Billing](https://docs.turso.tech/help/usage-and-billing)

2025-03-19 官方公告明确免费改为不再冷启动或休眠数据库，自 2025-03-31 生效；这比 2023–2024 年旧文档中“闲置缩容/归档”的描述更新。[2025 Developer Plan 公告](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)

**判断**：只想要更大的免费 SQL 存储时值得作为单独替代选项；现有 Supabase RLS/Auth/Realtime 或 D1 binding 集成不能直接迁过去。前期不要为了拼额度再增加一份用户主数据及同步任务。

## 3. Clerk

当前 Hobby 免费 **50,000 MRU/应用**，不需要信用卡。MRU 是注册至少 24 小时后又回访的月度留存用户，不能直接称为 50,000 MAU。免费含邮箱 code/link、密码、至多 3 个社交连接；超过 50,000 MRU 要升级，官方给 1 个月宽限。继续付费将按 MRU 计价，而不是永远免费延续。[当前定价](https://clerk.com/pricing)、[2026-02-05 定价更新](https://clerk.com/changelog/2026-02-05-new-plans-more-value)

**本次排除的决定性条件**：生产部署前置条件明确要求拥有域名并能添加 DNS 记录。开发实例有 Clerk 提供的域名，但不能把开发模式充当已满足生产条件的方案。[生产部署文档](https://clerk.com/docs/guides/development/deployment/production)

## 4. Resend

当前免费交易邮件额度为 **3,000 封/月、100 封/UTC 自然日**，发出和收到的邮件都计量，多收件人分别计量；3 个验证域名。日限重置为 UTC 00:00，即北京时间 08:00。文档当前写起始 API 速率为 10 requests/s，不能再沿用旧资料的 2 requests/s。[Account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)

三个域名从 2026-08-25 起生效，旧的 2023 免费公告仍写 1 个，应采用新文档。[More Domains on the Free Tier](https://resend.com/changelog/three-domains-on-the-free-tier)

**没有自有域名时不能给公众发信**：默认 `resend.dev` 只允许向注册 Resend 的账号邮箱发测试信，给其他收件人会返回 `403`。需要验证自己的域名并使用该域名的 From 才能给其他人发送。[resend.dev 限制](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)

免费不需提供付款信息，付费超额需在付费订阅下启用；但 2026-08-27 服务条款同时保留调整免费层、超限时转付费订阅的权利，不能将产品文档解释成法律层面的“任何情形永不产生账单保证”。无域名已足以排除本次上线接入，无需为它开户。[Resend 定价与超额说明](https://resend.com/pricing)、[Terms §6 Free Tier](https://resend.com/legal/terms-of-service)

## 5. 待实际部署时确认

1. 未替用户开户：免费注册若出现绑卡或试用，停止；不为“免费额度”开付费计划。
2. 没有供应商跨地域网络实测；不能仅凭免费额度承诺中国大陆稳定访问。
3. 官方网页没有统一最后修改日期；这里记录的是查询日见到的公开资料，公告日期已单独标注。
4. 个人数据导出应在本地或私有备份位置，不能进入源码或 Git 仓库；本报告只有公开服务资料。
