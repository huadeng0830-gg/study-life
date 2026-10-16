# 性能变更记录

日期：2026-10-16。工作区原有和同期界面/版本改动全部保留；下表仅说明本轮性能任务实施内容。未提交、推送、部署、永久应用数据库迁移，未构建原生桌面。

## 应用变更、收益与风险

| 文件 | 原问题 | 修改与原因 | 可验证收益 | 风险/保护 |
|---|---|---|---|---|
| src/services/readCache.js | 只按条目数限缓存；共享读取缺少独立取消 | 默认 2MiB 字节预算，大成功响应不留存，消费者独立 AbortSignal | 同 key 只发一次；所有消费者离开中止上游 | 内存预算只计序列化载荷，不代表整个 JS heap；清缓存不回填旧结果 |
| src/services/social.js | SDK 读取未携带页面取消信号 | 给 cachedCampusRequest、campusLifeRequest、campusCommunityRequest 传 signal | 过时搜索/账号变化可停止在途网络 | 保留原认证、账号校验、SDK 超时；写入不重试 |
| src/services/social.js | 通知后台连接持续；恢复有漏事件窗口 | 可见/在线控制频道，串行 remove/reconnect，SUBSCRIBED 后补读 | 后台频道被移除；恢复仅一次补读 | 防旧频道回调、账号串用和离开后回调 |
| src/services/campusLife.js | 搜索接口无法接受取消 | campusLifeSearch 第三参数透传 signal | 真实传输回归验证取消 | 旧两参数调用兼容 |
| src/composables/campusLifePage.js | 只忽略过时结果 | 读取开始时替换 controller，账号变化/卸载中止 | 搜索取消到达 SDK | 未接线的读取不宣称已全面取消；本地错误显示语义保留 |
| src/composables/campusRequest.js | 页面请求序号没有停止上游 | begin/invalidate/dispose 维护 AbortController，暴露 signal() | 公开反馈加载/详情可取消 | 上游共享消费者相互独立 |
| src/views/campus/CampusSearchView.vue | 快速搜索仍执行旧 HTTP | page.load 的 signal 接到 campusLifeSearch | 只保留最新有效搜索 | 原防抖、筛选与可见错误保留 |
| src/services/campusCommunity.js | 公开读取超时、429 连续访问 | 独立取消、10s 超时、按 origin 的有限故障冷却 | Retry-After 内不同过滤也不继续发请求 | 不跨接口自动重试；不存错误正文，成功缓存优先 |
| src/views/FeedbackView.vue | 列表与详情生命周期不取消 | 传 request.signal() | 离开或替换读取中止 | 原分页、全局搜索/排序仍保留 |
| supabase/functions/campus-community/index.ts | 申请/审计邮箱 N+1；body 先无限读取 | 使用已授权 actor 的批量邮箱 RPC；32KiB 流式字节边界 | 200 申请→1 邮箱 RPC；中文超字节 body→413 且不触 DB | RPC 错误显式返回，不静默回退 N+1；原 owner guard 保留 |
| supabase/functions/platform-admin/index.ts | 审核员列表逐条 Auth 查询 | 批量 RPC、去重 ID、传操作者 | 25→1 邮箱 RPC | 不增加 auth.users 全表授权 |
| supabase/functions/platform-admin/handler.js | 批量查询需要可信操作者 | 将已认证 user.id 传给服务层 | SQL 仍能验证 actor 是 owner | 不相信 payload 提供的 actor |
| supabase/functions/campus-life/index.ts | mine 的 SELECT *、大字段与 11 并发 | 明确 detail/summary 投影；按批最多 3 个表请求 | wildcard 1→0；聚合并发 11→3；摘要免校车子表 | 编辑字段、原 13 分类与上限保留，不能当作请求总数降至 3 |
| src/views/campus/CampusMySubmissionsView.vue | 列表使用完整编辑载荷 | view:summary，独立摘要 cache key | 省正文/子表载荷 | 编辑时仍取 detail，不裁剪编辑内容 |
| supabase/migrations/20261016131336_performance_capacity_guards.sql | 3 个用户外键未覆盖；批量邮箱缺服务端窄接口 | 3 个索引、private helper、service-only invoker RPC | 合成索引查询 1.480→0.088ms；N+1 可替换 | 尚未永久应用；先迁移再部署函数；增加索引空间/写成本 |
| workers/public-api/index.ts | 429 丢失、失败不断回源、缺观测 | 状态保留、2–30s 冷却、8s含body超时、Server-Timing/cache 标记、URL大小界限 | 本地故障21次→1回源，暖360次→0回源 | 缓存单位置且尽力；不是全局速率限制，不缓存私密/错误正文 |
| vite.config.js | 静态启动图和共享状态过多小包 | startup-core 与按 entry 共享 composables 分组 | 更少 HTTP 请求，桌面减少早期可选下载 | 移动 decoded JS 有小幅增加；路由与重库仍 lazy |
| src/components/Sidebar.vue | 空闲首屏预热低频设置 | 移除 appearance/data 的自动 idle 预热，意图加载保留 | 降低桌面提前下载 | 未删除工具或指针/键盘预加载 |
| src/router/routePreload.js | 3g/后台也允许预取多个页面 | 仅可见、在线、非省流量 4g 预取待办一个路由 | 较少无意图下载 | 无 Network API 时保守跳过，点击导航照常可用 |
| src/main.js | 按早晚钟点猜测预取两个业务页面，与侧栏预算重叠 | 移除无操作依据的时段预取，保留实际书签启动和更新调度 | 4秒观察窗口不再自动下载整组账本等业务依赖 | 不删页面；真实导航和指针/聚焦预载保留 |
| src/services/apiMetrics.js | 缺少轻量接口分位数与错误计数 | 10% 会话，固定8类入口，每类128条内存数值 | 不增加云请求/写入；可读取本地 P50/P95/P99 | fetch-to-headers，不代表完整body或所有真实用户 |
| src/services/supabase.js | 无统一 fetch 测量接点 | 复用原单例，注入透明 measuredSupabaseFetch | 覆盖 Auth/PostgREST/Storage/Edge 的采样 | 参数、Response、错误、认证持久化不变 |

## 验证、预算与规范文件

| 文件 | 用途 |
|---|---|
| tests/readCacheCapacity.test.js | 字节淘汰、大响应、取消独立性、全部取消、clear 后旧请求 |
| tests/campusReadCancellation.test.js | 页面读取取消穿过真实 transport seam；账号变化 |
| tests/socialNotificationLifecycle.test.js | 5 个频道生命周期用例，异步 ready 与初始隐藏 |
| tests/campusPublicApiTransport.test.js | 原公开读取测试增加跨过滤 Retry-After 保护 |
| tests/capacityBackend.test.js | 执行真实 TS handler，检验批量邮箱、权限/错误、编辑字段、摘要、扇出和 body |
| tests/campusLifeEdge.test.js | 原静态源码断言从 select('*') 更新为明确 select(columns)，额外禁止 wildcard；保留行为断言 |
| tests/publicApiWorker.test.js | 429、cooldown、body超时、来源、公开字段、重定向与私密凭据隔离 |
| tests/apiMetrics.test.js | Response/错误不变、计数有界、未知入口不记录、不联网 |
| supabase/tests/performance_capacity_guards.sql | 迁移/RPC 的角色、owner、数量与数据隔离回滚测试 |
| supabase/tests/performance_capacity_plan.sql | 真实 PG TEMP 合成数据的索引前后执行计划 |
| scripts/audit/performance-source.mjs | 读取版本化/新源码、lock、环境变量名称；只输出位置/计数，不输出秘密 |
| scripts/audit/performance-load.mjs | 真实本地 Workers 1/2/5/10阶梯，虚构上游与精确字节断言 |
| scripts/audit/performance-budget.mjs | dist 体积/gzip 和浏览器首页预算；缺失/空报告失败；--inventory仅清单 |
| scripts/audit/core-flows.mjs | 更新实际“创建待办”按钮定位；每流程重新加载，持久化断言改为真正离开并重载，避免旧模态框/同hash假刷新 |
| scripts/audit/interaction-browser.mjs | 按当前真实入口打开编辑界面删除待办、展开设置与工具后编辑导航；保留原确认/取消/撤销/过期CSV/导航持久化断言 |
| PERFORMANCE-BUDGET.json | 工程阈值，不把可能变化的套餐配额写进应用 |
| 六份根目录性能报告、docs/PERFORMANCE-RULES.md、AGENTS.md | 基线、证据、容量估算、边界、后续开发约束 |

没有通过删除/跳过失败测试改变验收。基线存在的界面测试失败在同期工作区改动中消失，不能归功于本轮性能修复。原 core-flows 失败包含旧按钮文案和未刷新状态污染；新版本保留保存、列表、无报错与持久化断言，并加强了真实重载。

## 审查和最终证据

独立只读审查核对账号缓存、RPC ACL/search_path、字段投影和测试工具；发现 Realtime 补读早于 SUBSCRIBED，以及 Worker body 超时遗漏冷却。3 个新增回归先失败后修复，17/17 通过，复核无剩余阻断项。预算缺报告仍成功的次要问题也已修正。

第一轮冻结副本签名 68fe7d1d78，全量 Vitest 384/384 文件、3510/3510 测试通过。延长可见页面观察窗口后又移除 src/main.js 的时段猜测预取，最终候选签名 a0193e69ad；最终检查以 PERFORMANCE-AUDIT.md 的结果为准。Windows 全套测试使用原工作区已安装的 updater 依赖目录联接，没有原生桌面打包。真实浏览器交互 148 项断言、66 次路由检查已通过，包含保存、删除确认/取消/撤销、过期CSV、导航持久化与控件反馈。

最终候选复验：384文件/3510测试通过，lint/typecheck/正式隔离build/PWA与首页预算10项通过；297路由宽度组合全部通过；缺API启动和分包404恢复GREEN。最终4秒JS手机减少36.3%、桌面33.5%，三次弱网LCP中位数5.74→5.08s；PWA首次安装请求401→318且离线待办重载成功。主工作区标准build仍由未同步的发布签名/更新说明阻止；未把隔离副本成功混作主build成功。生产API优化后分位数未测量。

原始 diff、冻结副本、浏览器 JSON、日志与截图保存在仓库外 D:/study-life/audit/capacity-20261016，不写入公开源码、用户数据或账单日志。最终前端对照额外使用与冻结版完全相同界面的 control 副本，只恢复旧分包/预取，避免把同期 UI 改动算成性能收益。
