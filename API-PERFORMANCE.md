# API 性能、错误恢复与压测

核查日期：2026-10-16。区分生产服务端日志、浏览器端到端时间、虚构上游实验。没有部署本轮代码，不能给出“生产优化后 P95”。

## 生产基线

Supabase function_edge_logs，UTC 2026-10-15 11:55 至 2026-10-16 11:55。execution_time_ms 为平台记录的服务端执行时间，包含冷启动/等待等因素，不含用户完整 DNS、TLS、跨境网络和浏览器渲染。样本混有测试流量。Content-Length 大量缺失，因此 Payload 与 Response 实际完整大小均标为未测量，不能把缺失值当作 0 字节。

| Endpoint | 样本 | 均值 ms | P50 ms | P95 ms | P99 ms | 错误率 | Payload/Response | Cache | DB Query |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| campus-community | 88 | 583.49 | 209 | 1,683 | 2,539 | 0/88 | 未测量 | 私有 no-store | 随 action，逐请求数未测量 |
| campus-social | 55 | 742.62 | 334 | 2,071 | 2,480 | 1/55 = 1.82% | 未测量 | 私有 no-store | dispatcher；不等于 1 条 SQL |
| campus-life | 48 | 899.75 | 1,000 | 2,086 | 3,269 | 0/48 | 未测量 | 私有 no-store | 随 action；mine 旧代码可并发 11 |
| platform-admin | 39 | 983.33 | 1,023 | 2,347 | 2,562 | 0/39 | 未测量 | 私有 no-store | 随 action，旧 reviewer 逐条补全邮箱 |

四个入口共 230 次记录，1 次错误，HTTP 429=0，HTTP 504=0；超过 800ms 的请求共 93 次。0 个 HTTP 504 不等于浏览器取消/超时率为 0。未获得真实重试、用户会话去重、全链路慢请求追踪数据。普通 P95 <800ms、简单读 <500ms、P99 <1,500ms 尚未在生产达标。

这里按HTTP>=400粗计错误，样本中的预期权限4xx和历史测试尚未剥离，不将它等同于线上5xx故障率。

数据库代表性语句均值约 0.45–35ms，API 尾延迟约 1.7–2.35s。两者来自不同粒度与样本，不能用相减精确分解网络/冷启动；目前证据不支持把全部慢响应归因于 PostgreSQL、Cloudflare 或 DNS 中的某一个。Supabase 在新加坡，国内真实网络仍需登录测试用户的瀑布图与 Server-Timing 来继续定位。

## 已实施

| 入口/文件 | 原问题 | 处理 | 保护条件与风险 |
|---|---|---|---|
| readCache.js | 条目数有限，字节无限；一个取消可能影响共享读取 | 默认最多 2MiB 保守 UTF-16 载荷、FIFO、共享 in-flight、每消费者独立 AbortSignal | 最后一个消费者退出才中止上游；大成功响应仍返回但不保存；清缓存不让旧结果回填 |
| social.js / campusLifePage.js / campusRequest.js | 只丢弃过时搜索结果，网络继续运行 | 旧搜索、账号切换、卸载取消；SDK 30s 原超时保留 | 只取消读取，不把写入取消误当作事务回滚；其他未接线读取不宣称已全面取消 |
| campusCommunity.js / FeedbackView.vue | 公开搜索无法从页面取消，429 后连续打上游 | 10s 超时；公开请求去重；独立取消；按 Retry-After 1–300s 有限冷却 | 不自动切换备用入口重试；只记 origin/status/deadline；成功缓存仍可用 |
| workers/public-api/index.ts | 429 被改为 503；失败后每次访问回源 | 原样区分 429/503，Retry-After 上限 30s；短暂全公开入口故障冷却；8s 覆盖响应体读取 | 不缓存错误正文、401/403 或非法 JSON；冷却为单 CDN 位置的尽力保护，不能承诺全局严格限流 |
| 同 Worker | 缺少公开回源可观测性 | X-Public-Cache、Server-Timing、暴露安全响应头 | 不记录私有正文/令牌/邮箱；命中仍消耗 Worker invocation |
| campus-community/index.ts | 先无限读 body 再按字符长度校验 | 流式按 UTF-8 字节计数，32KiB 硬边界，超过即取消 | 保持原业务字段限制；中文大 body 不可绕过 |
| social.js Realtime | 后台在线，恢复可能漏事件 | 隐藏/离线移除频道；串行重连；当前 SUBSCRIBED 后补读一次 | 初始隐藏也标记暂停，旧频道 ready/event 和离开后的回调均无效 |
| apiMetrics.js / supabase.js | 无统一低成本浏览器指标 | 10% 浏览器会话内存采样、每固定入口最多 128 个耗时、请求/错误/取消计数 | 不联网、不写数据库、不含 URL/payload/ID/token；测到 response headers，未测完整 body |

Web/PWA 首页是本地工作台，未登录冷启动 API=0；release/version 检查单独统计，不把其当业务 API。Auth 客户端继续单例与初始化 Promise 复用；隔离验证客户端仍不持久化 session。账号同步健康时约 60s 元数据探测、写入 4s 合并，隐藏暂停，失败延长至分钟级；没有删除必要同步或强迫重新登录。

## 本地真实 Workers 运行时压力阶梯

运行命令：先 npm run worker:check，再 node scripts/audit/performance-load.mjs。Miniflare/workerd 执行真实 Worker，10ms 虚构上游。每阶梯先一次冷请求，等待缓存写入后分别测暖缓存；没有向生产免费服务压测。

| 阶梯 | 并发请求 | 暖请求数 | 冷请求 ms | 暖 P50 ms | 暖 P95 ms | 暖 P99 ms | 暖错误 | 暖回源 | 响应字节 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1x | 1 | 20 | 183.58 | 2.32 | 3.33 | 4.31 | 0 | 0 | 2,160 |
| 2x | 2 | 40 | 17.72 | 2.19 | 4.81 | 5.46 | 0 | 0 | 4,320 |
| 5x | 5 | 100 | 18.76 | 5.34 | 8.03 | 8.30 | 0 | 0 | 10,800 |
| 10x | 10 | 200 | 17.26 | 11.12 | 17.63 | 18.96 | 0 | 0 | 21,600 |

暖缓存 360/360 成功、0 次上游；响应字节有精确断言，不能在并发 await 复合赋值中丢计数。429 故障场景 21 次不同搜索只回源 1 次、自动重试 0；只保存状态/截止时间，不保存供应商错误正文。并发冷缓存多位置、Cache API 驱逐、恶意随机搜索仍可能回源，未宣称其为全局熔断或防 DDoS。

该测试只证明当前业务缓存路径与故障保护，在 10 并发本地条件下工作。Node 宿主 RSS 约 160.7MB，不是 Worker isolate 内存；Worker CPU、生产内存、每秒承载上限均未测量。本地墙钟延迟不能代替 [Cloudflare 10ms CPU 计费限制](https://developers.cloudflare.com/workers/platform/limits/)。

## 监测与预算

PERFORMANCE-BUDGET.json 只保存项目工程阈值，供应商配额在 FREE-TIER-CAPACITY.md 按日期维护。首页预算脚本必须提供非空浏览器报告，否则失败；--inventory 明确仅列产物体积。API/DB 阈值目前是目标，脚本不会伪装成已经自动覆盖所有 API 行为。

调试会话可运行 window.__STUDY_LIFE_API_METRICS__() 读取数值聚合；采样未命中为空是正常情况。需要有意采样测试时通过源码中的 configureApiMetrics 开关控制，不能把实际用户载荷写日志。结合 Supabase 1 天平台日志、pg_stat_statements 和 Worker 现有采样观测检查 P95、错误、CPU/超额状态。真实 RUM INP、部署后 API P95、月 egress 和 CDN 命中仍待实测。

## 回归证据

新增测试覆盖真实 Edge handler、字节边界、权限、缓存隔离/上限、取消共享请求、错误传播、摘要与编辑字段、并发扇出、Realtime 异步恢复、公开 Worker CORS/令牌剥离/重定向拒绝/429/超时。独立审查发现的两处边界问题先复现失败，修复后 17/17 通过并完成复核。完整最终结果见 PERFORMANCE-AUDIT.md，不能将真实登录、注册、邮件、上传、跨设备用户实测标记为已完成。
