# 免费套餐容量模型

官方规则核查：2026-10-16。本文中的用量预测均为估算，不是已验证承载。代码内没有硬编码供应商套餐配额；本次未新增付费服务、修改套餐或开启自动付费。

## 官方免费边界

| 服务 | 当前 Free 边界 | 对项目的含义 |
|---|---|---|
| Supabase Database | 500MB / project，共享 CPU、500MB RAM | API 请求数量不限不等于计算和 I/O 无限 |
| Supabase egress | 5GB/月 uncached，另有 5GB cached | PostgreSQL/Edge 响应不能假设全部用 cached 额度；两池不能随意相加 |
| Supabase Auth | 50,000 MAU；总用户数不限 | 不是 50,000 并发保证 |
| Supabase Storage | 1GB，单文件最多 50MB | 现有私有桶仍受项目自身更严格限制 |
| Supabase Realtime | 峰值 200 连接、2M messages/月、256KB/message | 后台暂停可释放连接；扇出消息按实际消耗计算 |
| Supabase Edge Functions | 500,000 invocations/月 | OPTIONS、失败调用也应纳入仪表盘核算 |
| Supabase 生命周期 | 1 周不活跃可暂停；无免费自动备份 | 离线工作台可用，不等于云端 24x7 SLA |

来源：[Supabase 当前定价](https://supabase.com/pricing)。Free Edge 运行时另受 256MB、150s wall clock、每请求 2s CPU 限制；异步等待和 CPU 不可混为一谈。[Edge Functions Limits](https://supabase.com/docs/guides/functions/limits)

| Cloudflare 服务 | 当前 Free 边界 | 本项目决定 |
|---|---|---|
| Workers | 100,000 次/天，账户共享；UTC 0 点重置；10ms CPU/请求；128MB/isolate | 公开 API 命中缓存仍是一次调用；本地延迟不是 CPU |
| Workers I/O | 50 subrequests/请求；6 同时出站连接/请求 | 当前公开读取通常 1 次上游；Cache API 操作也占相关调用预算 |
| Pages | 500 builds/月、1 并行构建、20,000 files、25MiB/文件 | 静态访问不强行经过 Worker；Pages Functions 使用 Worker 配额 |
| KV | 100,000 reads/天，write/delete/list 各 1,000/天，1GB | 未使用、未新增 |
| D1 | 5M rows read/天，100k rows written/天，5GB 总存储 | 未使用、未新增 |
| R2 Standard | 10GB-month、1M Class A/月、10M Class B/月，直接 egress 免费 | 未使用、未开启，不能据此假设已具有这些资源 |

来源：[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Pages Limits](https://developers.cloudflare.com/pages/platform/limits/)、[KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)、[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[R2 Pricing](https://developers.cloudflare.com/r2/pricing/)。静态 Pages 与动态配额应分别看待；Workers Static Assets 的计费说明见 [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

## 已知消耗与缺口

已确认生产 Supabase 为 Free，数据库基线 19.50MB、Storage 0 对象；过去 24h 的四个核心 Edge 入口共 230 条日志，混合测试流量。生产仅通知表发布到 Realtime。Cloudflare 当前主项目为 Pages + 公开反馈 Worker，配置仅 1% 平台日志采样。旧 sync-coordinator 与 test Worker 仍存在，未证明无使用前不擅自删除。

**未测量：**完整账期 egress、实际 MAU/DAU、有效会话平均前台时长、真实 cache hit、Worker CPU/错误占比、Realtime 月消息及峰值连接、用户快照大小分布、附件月增长。230 次日志不能按 30 天简单放大为生产真实需求。没有足够证据承诺 1,000、5,000 或 10,000 同时在线。

## 可替换参数的使用情景

下面用现有真实机制建立一个“校园中等使用”情景，所有行为频次与载荷大小都是**估算参数**，部署后应替换为采样实测：

| 单个 DAU 每天 | 估算量 | 依据/边界 |
|---|---:|---|
| 前台活跃时间 | 20 分钟 | 场景假设 |
| 60s 元数据同步探测 | 20 次 × 0.5KiB | 代码健康轮询间隔；非整份快照下载 |
| 合并后的账号写入 | 4 次 × 1KiB 响应 | 代码 4s 合并；4 个编辑批次为假设 |
| 完整快照读取 | 1 次 × 128KiB | 假设；大小应看实际序列化字节 |
| 私有校园业务 API | 24 次 × 12KiB | 假设，平均每次 3 个逻辑 DB 往返，其中 8 次为写动作 |
| Auth/资料读取 | 4 次 × 2KiB | 假设，不等于 4 次重新登录 |
| 公开反馈 | 8 次 × 5KiB，80% Edge 命中 | 命中率是目标，尚非线上实测 |
| 预检 OPTIONS | 3 次 | 7200s CORS max-age 机制存在；具体浏览器/入口分布为假设 |
| 写入行数 | 20 行：4 快照 + 8×2 业务行 | 不含未知的触发器、审计、奖励附加写入，是逻辑模型 |

由此计算：浏览器 API 约 64 次/DAU/天，Supabase Edge 27 次/天（24 业务 +3 预检），Cloudflare Worker 8 次/天。逻辑 DB 往返约 102.6 次/天：20+4+1+24×3+4+8×20%。RPC 内部 SQL 数、Auth 内部查询和触发器另计，不可把此值当物理 SQL 总数。

未缓存 Supabase 下行约 446KiB/DAU/天 =128+288+10+4+8+8。上行、HTTP 头、Realtime、失败、第三方或服务间流量若计费会使消耗更高，至少留 20% 运营余量。公开 Worker 命中减少 Supabase 下行与查询，不能减少浏览器访问 Worker 的调用数。没有将 Cloudflare 静态 JS/CSS 下载算进 Supabase egress。

## 100 至 10,000 DAU 的模型

按 30 天算月用量，GB=10^9 bytes，KiB=1024 bytes。

| DAU（估算） | 浏览器 API/天 | 逻辑 DB 往返/天 | 写行/天 | Supabase uncached GB/月 | Edge invocations/月 | Worker/天 |
|---|---:|---:|---:|---:|---:|---:|
| 100 | 6,400 | 10,260 | 2,000 | 1.37 | 81,000 | 800 |
| 500 | 32,000 | 51,300 | 10,000 | 6.85 | 405,000 | 4,000 |
| 1,000 | 64,000 | 102,600 | 20,000 | 13.70 | 810,000 | 8,000 |
| 5,000 | 320,000 | 513,000 | 100,000 | 68.51 | 4,050,000 | 40,000 |
| 10,000 | 640,000 | 1,026,000 | 200,000 | 137.01 | 8,100,000 | 80,000 |

500 DAU 在此模型已超过 5GB egress；1,000 DAU 同时超过 egress 和 Edge 月调用。10,000 DAU 即便 Worker 日请求未过额度，Supabase 仍远超模型边界。缓存命中率若从 80% 降为 0，公开查询的额外开销还需增加；不能靠随机搜索假设所有请求命中。

## 注册数、MAU、在线与并发

注册数 R 是持久账号总数；MAU 是月内活跃不同账号；DAU 是日内活跃不同账号；同时在线用户不等于同时发请求；Realtime 连接与 DB 连接也不是同一个指标。

仅用于估算：MAU/持有快照账号数 R=3×DAU；峰值同时在线=10% DAU；其中 25% 位于需通知订阅的页面。平均每个在线用户 20 分钟发 64 次 API、平均响应假设 1s，使用 L=λW 估算请求在途量。真实突发和长尾会比平均值大。

| DAU | MAU/R 假设 | 同时在线假设 | Realtime 连接假设 | 活跃窗口平均 RPS | 1s 时在途请求约 | DB 容量 MB 假设 |
|---|---:|---:|---:|---:|---:|---:|
| 100 | 300 | 10 | 3 | 0.53 | 1 | 64.97 |
| 500 | 1,500 | 50 | 13 | 2.67 | 3 | 246.83 |
| 1,000 | 3,000 | 100 | 25 | 5.33 | 6 | 474.16 |
| 5,000 | 15,000 | 500 | 125 | 26.67 | 27 | 2,292.78 |
| 10,000 | 30,000 | 1,000 | 250 | 53.33 | 54 | 4,566.06 |

DB 容量为现有 19.50MB + R×128KiB 快照 + DAU×2KiB/天净留存×30。2KiB 不是实际行长/索引测量，索引、TOAST、审计增长和历史注册数都可能使结果更大。附加 Storage 此基本情景暂按 0 新文件估算；上传功能仍在，若平均每账号保留 10MiB，约 100 个附件账号就可接近 1GB，下载又会吃 egress。

Realtime 模型 10,000 DAU 的 250 连接已高于 200；消息扇出可能更早用完 2M/月。不能从 50k MAU 配额推出可支撑表中任何请求速率。CPU、数据库连接和锁竞争仍需真实生产分布验证。

## 容量判断与敏感性

在“446KiB/天、27 Edge 次/天”的假设下，egress 算术边界约 365 DAU，Edge 约 617 DAU；留 20% 余量，先按约 290 DAU 触发复核，**不是 290 DAU 的稳定性保证**。100 DAU 的模型有配额余量；没有生产并发证据可以将“模型有余量”升级为“SLA 已验证”。若每次业务都重新预检，48 Edge 次/天的边界会降至约 347 DAU，应更早预警。

轻量本地使用如果每 DAU 每天下行仅 100KiB、10 次 Edge，算术边界约 1,600 DAU；这是另一种估算行为，不代表当前真实使用。若每人每天下载 8 份 2MiB 快照，仅快照就需 480MiB/人/月，十来个重度用户即可逼近 egress 上限。保留元数据探测、去重和编辑合并比增加缓存服务更有价值。

要在 5GB 内服务 500 DAU，平均未缓存下行须低于约 326KiB/DAU/天（且还要留余量）；1,000 DAU 约 163KiB、10,000 DAU 约 16KiB。50 万 Edge 次在 10,000 DAU 下仅容许约 1.67 次/人/天。现有完整校园业务不能据此承诺零费用服务 10,000 重度 DAU。

本次测得的直接节约：管理员邮箱补全 200/25 次变 1 次，降低冷查询扇出；摘要降低不必要大字段；公开暖缓存测试免回源，故障 21 次请求只回源 1 次；后台通知释放连接；前端首屏请求减少。缺少真实使用权重，不能将这些局部比例相乘成“总承载提升 X 倍”。

## 达到边界前后的动作

以官方用量仪表盘和当前账期速率做每日预测。预计使用达到 60% 时核查快照、摘要、缓存有效性、慢查询；达到 80% 时减少非必要预取和用户主动允许的非关键刷新，保留本地工作台与未提交队列，给出清晰云端不可用状态。429 尊重 Retry-After，不自动跨入口重试。不能通过关闭 RLS、藏错误、删除历史、擅自关闭正常功能或增加副本账号突破额度。

本轮没有自动实现“按账单使用量远程熔断”，也没有假装免费平台暂停/日超额时仍能保证所有云端功能。若优化后的真实资源曲线持续预测超额，或需要不可暂停、自动备份/SLA，才值得由用户决定付费/调整使用计划。本方案默认保持 0 元，不擅自升级；不承诺突破任何硬性上限。
