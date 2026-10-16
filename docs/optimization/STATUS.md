# 优化阶段与待办状态

## V5 当前总账

整份 V5 正在持续执行；完整 A–J 交付还未结束。请先看 [V5 全项目产品优化进度](V5_STATUS.md)：其中记录当前的页面/字段分母、六种验收状态、在跑的检查与剩余模块。后面的 2026-10-15 第一轮和更早阶段保留各自时点证据，不代表当前源码已经通过最终门禁。

## 2026-10-15 产品体验续作

最新增量见 [续作与验收记录](../audit/product-continuation-2026-10-15.md) 和 [页面/字段矩阵](../audit/product-continuation-matrix-2026-10-15.md)。本轮修复 5 项输入、路由恢复和小屏问题；361 文件、3299 项全量测试与 Web 构建通过；34 入口四档宽度基础检查通过。全业务、真实账号、多设备及实体设备验收仍未完成；下文各阶段记录保留原有日期边界。本地候选版本 1.8.1，未发布。

更新时间：2026-10-11（Asia/Shanghai）。当前阶段：**P1 数据安全修复、回归验证和生产部署均完成；全站完整验收仍有未验证项**。最终范围与结果以 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)、[TEST_REPORT.md](TEST_REPORT.md) 为准。旧阶段记录保留各自时点结论，最新门禁与部署结果见 0H。

## 0H. P1 后续复验与部署（2026-10-11）

- 最终 `npm run check` **exit 0**：发布说明、Pages 配置、Lint、类型检查、类型棘轮、全量测试及 Web 构建全部通过；测试为 328 文件、2940/2940，类型诊断 2914→2903，未修改基线。
- 原始 P1 探针进入默认 Vitest 收集；默认全量通过，独立复跑 3 文件、8/8 通过。补充保存失败后的路由提示持续性、延迟 IDB 镜像顺序回归共 5 文件、19/19 通过。
- `npm run build:desktop` exit 0；Supabase 公开配置、154 个 JS 产物边界和 Pages 配置检查通过。未制作 Electron 安装包，未对生产业务数据执行写入/恢复。
- 发布签名为 `aee2384ace`；Web 版本 `2026年10月11日-版本1`、桌面版本 `1.0.20`，均未递增。测试断言及类型基线均未放宽。
- `npm run deploy:production` exit 0；Cloudflare Pages 上传 144 个文件（69 个复用），生产部署 ID `78696c41-c9e0-444e-aa02-eacb210bea92`，状态 success，对应干净的 `main` 提交 `9fd61c2`。生产域名和部署 URL 的 `/version.txt`、首页均 HTTP 200，返回预期 Web 版本。
- 部署后 `audit:release` GREEN：16 个首页引用、204 条 SW 预缓存、150 个 JS、200 个闭包资源、204 个资源探测，缺失/失败均为 0。独立 Chrome 首访 390×844 和模拟 iPhone Safari 缺失 `requestIdleCallback` 启动探针均 GREEN；无重载循环、异常或控制台错误。
- **P1-001、P1-002 无已知代码级阻断。** 真实登录/RLS、独立双标签/双设备、实际浏览器配额与硬崩溃、Electron 安装包及未完成的逐页功能验收仍属未验证；不得由自动化门禁推断为通过。
- 发布门禁与部署均已完成；全项目逐页验收仍是 0/11 完整通过、基础显示 11/11。此次部署不代表上述未验证项目已通过，也不把整体交互覆盖标为全绿。

## 0G. P1 数据安全专项修复初次复验（2026-10-11；初始时点记录）

不复扫全项目；按原 QA05/QA06 复现，追踪账号身份、共享本机键、恢复 checkpoint、失败保存队列和救援导出。

- QA05 根因为恢复异步等待缺少身份世代/owner 栅栏，恢复、同步、账号切换和退出没有统一的跨标签事务保护。现已共享账号数据锁，捕获认证 user/owner/revision，在 await 和提交前复核；旧账号的迟到写入保存到 owner 隔离草稿。切回账号只在快照基线相符时恢复；发现冲突保留两份数据并拒绝静默合并。备份 source/target 不同仍走独立确认，恢复前保留 checkpoint。
- QA06 根因为写入失败丢弃待写队列、导出仅读磁盘、无关键成功会清除全局错误。现保留最新内存 refs、可重试队列及 owner 草稿，按 key/source 管理状态；只在对应数据实际保存后清错。应急导出包含最新 ref 值并声明未保存/缺失/不可读内容；失败时明确报错，刷新/关闭前提示，导入在持久化失败时不报告成功。
- 当时原始安全探针 3 文件、8/8 通过，常规集为 325 文件、2930/2930；类型棘轮尚未通过。以上历史计数由 0H 最终组合门禁结果替代。
- 未用真实账号/备份/业务数据执行恢复；真实双浏览器标签、IDB 实际配额/设备崩溃、真实云账号及角色矩阵仍未验证。当前状态以 0H 为准。

## 0F. 最终独立质量验收（2026-10-11）

该节是 P1 修复前的验收快照；其中“QA05/QA06 开放”的状态已由 0G 后续专项替代。

完整读取原六份优化记录，重新对照当前代码、入口定义、设计样式，执行常规全量与额外安全故障注入。1463 控件定义与旧交互台账没有缺失；120 唯一功能/路由/API ID、156 浮层、4 HTML 根、63 Edge 动作、23 表逐项六栏状态见最终矩阵。

- 确认 6 个真实问题；本轮修复 4 个：A07 文本动作样式、A08 日历 SVG 填充、A19 首页模块重复（局部）、旧异步同步启动在退出后迟到污染状态。
- 常规最终 323 文件、2921/2921 通过；lint、常规类型、类型棘轮、Web/桌面前端构建、配置与对比度检查通过。类型棘轮仍有 2906 条债，原基线 2914 未变。
- 独立安全验收 **2 失败/1 通过**，不在默认常规测试集：QA05 恢复跨账号覆盖、QA06 未落盘编辑救援导出遗漏且错误被无关成功清除。两个 P1 未修复，保护/回滚方案与可复现源码已交付，发布阻塞。
- 正式隔离浏览器 86 页面场景；11 主页面基础显示通过，8 页有局部本机业务运行证据，7 种创建/保存流程通过。完整页面验收 0 页；不能据此宣布全部逻辑/状态通过。
- shadcn 全局统一仍未完成：17 处 Button/Card 叠加旧类、部分移动触区偏小；云角色、数据库 SQL、双设备、真实 iOS/Android/PWA/Electron 未完成运行验收。

未提交、部署、升级依赖或改真实用户数据。新增安全探针明确红测并保留发布退出条件；下列旧阶段“完成”只指当时限定批次。

## 0E. 性能与工程：课表加载边界（2026-10-11 第 1 轮）

读取 AUDIT、INVENTORY、STATUS、已有报告及最新测试日志后，先执行独立正式构建、冷加载测量和失败回归，再修改 **2 项关联问题**：

1. A16 课表子问题：8 个关闭的异步弹窗原先首进就下载，快速记录静态导入。现在首次打开才挂载/下载，加载后保留实例；补修迟到模块在 KeepAlive 其他页面弹框/锁滚动的竞态，等待课表激活，卸载释放等待任务。
2. A02：提取日期导航、查询/归档投影及周统计到 scheduleWorkspace，ScheduleView **1137 → 1056 行**，原上限 1057 不变。搜索、统计、日期边界与现有领域/导入命令保留，原门禁通过。

同条件新 Chromium 档案各 3 次：课表页面加载 JS **93 → 80**，已解码字节 **1,047,920 → 855,153**，减少 **192,767 bytes**；8 个关闭弹窗分包首进 **8 → 0**。仅页面资源口径，未测 LCP/INP/真实弱网或内存；不推算速度百分比。PWA 完整离线能力保留，预缓存 **2696.73 → 2698.57 KiB**，安装下载总量未改善；ScheduleView 单 JS 分包增加。详细条件与取舍见报告。

| 最终验证 | 实际结果 |
| --- | --- |
| 最终相关回归 | 17 文件、118/118 通过，18.34 秒 |
| 最终稳定全量 | **322 文件、2917/2917 通过，exit 0**，143.88 秒，maxWorkers=4；含原 A02 守卫，未放宽门禁 |
| 正式浏览器 | 前后各 3 新档案，资源计数一致、Runtime 错误为空；合成课程持久化/编辑重开/管理、学期/作息/批量首开通过；最终额外分包延迟/离开/返回 2 项通过 |
| lint / 类型 / 类型棘轮 | exit 0；checkJs 2906 条，基线 2914 不变，不称零类型债 |
| Web build / 发布说明 / Pages | exit 0；独立 final-web 输出，原 dist 保留；只补当前说明与签名 dc201cb39d，版本不递增 |
| 独立审查 | 发现并关闭本轮迟到弹窗 P2，真实 Modal/KeepAlive 红绿与复核通过，无剩余重要/严重问题（限定本轮） |

本机证据：`D:/study-life/.tmp/performance-20261011/` 的 build-before/final、regression-before/after、lifetime-red/green、related-final、full-tests-final、lint-final、typecheck-final、type-ratchet-final 日志及 browser-before/final JSON。中途全量/候选构建不替代最终结果。仅合成数据、隔离浏览器、禁止外网；未读取用户档案/秘密/真实备份，未修改生产数据、权限策略、迁移或缓存协议；未提交/部署/发布。此前未提交改动保留。

本轮停止。下一轮先测 **PWA 默认安装/注册与其他路由资源闭包成本**，再选最多 3 项相关问题。A16 总体、A13/A14 其他类型/组件边界、A15 真实云权限/并发/双设备和备份故障验收继续开放；不重复全面审计。

## 0D. 全局交互专项：共享反馈与导航保存（2026-10-11 第 1 批）

已读取 shadcn Skill、设计规范、功能台账及本 STATUS。项目为 Vue 3 / shadcn-vue / Reka，本轮复用现有组件，不安装依赖、不改 preset。`npx shadcn@latest docs button` 因 npm 代理连接 EACCES 未执行成功，API 核对读取官方 shadcn-vue Button 文档。先完成共享组件，再只深入 **ActionButton/Feedback → NavigationSettings / navigationEditor → Sidebar“编辑导航”及个性化导航入口** 一组。

| 范围 | 已实施 | 验收边界 |
| --- | --- | --- |
| 状态机 | 移除重要操作 1200ms 最低等待；Promise 完成即 success、拒绝即真实 error；150ms 淡出、320ms ease-in-out 形变/对勾/恢复；重要成功保持 1000ms | 快速成功可跳过 spinner，业务立即返回；校验/no-op/cancel 无成功；不可中止写入不承诺撤回 |
| 按钮与反馈 | 同步防重、保持按钮占位/中心/邻居与焦点/名称；重试受 caller busy/disabled 及同步锁约束；取消提高激活代次、清反馈；busy progress / 成功锁普通 cursor；加载环继承 tone 前景 | KeepAlive、卸载/取消、新旧并发回归；减少动态不旋转/收缩/缩放。共享改善不算所有页面消费者完成 |
| 导航主保存 | 等待真实持久化，错误留在既有局部 alert、草稿/历史保留、可再次保存；原保存按钮完整成功动效 | 只宣称本机保存；现有“登录后可随账号同步”说明保留，真实云同步 U |
| 保存并离开 | action 直接接收 signal、返回真实 boolean；同步后草稿已 clean 可直接离开、不写入；失败不离开、不伪成功；保存中阻止放弃/重复操作 | 外部结果通道，不强制成功动画阻塞关框/路由；父关闭清子确认框，迟到结果不再离开 |
| 轻量编辑/危险操作 | 导航/标签/搜索/排序/预览即时响应；恢复默认可撤销，移除非空分组先确认转移，离开未保存草稿先确认 | 复验现有挂载回归，不另添加复杂动画；真机拖拽/读屏仍 U |
| 会话切换 | 旧请求不发布旧结果；锁释放后当前 clean 设备跟随最新 stored refs，dirty 草稿保留 | 已验证内存/挂载竞态；真实跨窗口/账号服务矩阵仍 U |

### 全局审计与待办

重新扫描 207 个 Vue 文件、1463 个控件/事件定义：A 123、B 52、C 1219、D 50、E 19；静态依赖可达 1457。计数包含循环定义、原语内部与父包装器，不是去重后的实际按钮数；动态组件/权限/平台菜单还需人工核对。已补 shadcn 控件、v-model、交互 role 扫描与静态依赖可达标记，逐入口 S/U 记录在 [INTERACTION_LEDGER.md](INTERACTION_LEDGER.md)。本批 T/V 范围另列在 INVENTORY，不将列表中声明的忙碌态视为真实任务证明。

### 新鲜验证

本机证据：`D:/study-life/.tmp/interaction-ux-20261011/`。测试用虚构数据，Chromium 新建独立档案、阻止外网访问；不读取个人浏览器或真实账号。首次测试被系统临时缓存 EPERM 阻止，改用上述工作区 TEMP/TMP 后执行；首次 Chromium 沙箱启动/跨环境服务器失败没有算入通过，随后用同一隐藏本机服务器与浏览器环境验证。

| 检查 | 实际结果 |
| --- | --- |
| 最终相关回归 | related-final.log：17 文件、149/149，通过，19.52 秒；包含状态机、DOM 防重/重试/焦点、KeepAlive/卸载、新导航保存失败/关闭/同步/会话、Modal/键盘/原生提交与主题/动效合同 |
| 独立审查 | 只读审查发现 3 个 P2（clean 离开、父关子框、新会话漏接更新），均补修复及回归；复核无剩余重要问题。review-fixes.log：6 文件、41/41 通过；不推断未检查平台 |
| 浏览器组件与真实入口 | browser-final.json：41/41，通过；320/440/768/1280px 的加载、防双击/Enter、名称、焦点、圆形与布局占位、实际成功/恢复；另失败重试、原生表单校验、防重、减少动态及真实导航写入/生效。路线数为 0，刻意不把其他页面计为本轮交互覆盖 |
| 主题补验 | browser-themes.json：48/48，通过，无 Runtime 异常；在上述 41 项外补实际主题控制器启用深色/高对比度、真实加载、过渡结束后的成功图标实际对比度 ≥3:1 与页面宽度，以及减少动态加载环 animationName=none；浅/深/高对比截图已目视核对。早先仅切属性与过渡中取色的测试不足，已经替换为真实主题/静态成功颜色验收 |
| lint / 类型 / 棘轮 | lint-final.log / typecheck-final.log / ratchet-final.log 均 exit 0；checkJs 2909 条低于 2914 基线，没有修改/放宽基线，不称零类型债 |
| 对比度 | contrast.log：144 配色、42 焦点配对通过；语义色继续消费主题 Token |
| 正式 Web build / 发布说明 | build-clean.log：exit 0，203 项预缓存；输出新目录 web-clean，无既有资产混入。保留当前版本与此前说明，追加本轮两条说明/更新签名 d98bd7347c，README 同步；release-final.log 与 pages.log exit 0；未提交、部署、发布或构建桌面安装包 |
| 首轮全量（非最终稳定快照） | full-tests.log：317/319 文件、2909/2911 项通过，262.14 秒。执行跨越审查修复，新增新会话回归失败；修复后的最终相关 149 项与稳定全量均复验该项通过。另 A02 ScheduleView 1137 > 1057 行失败。不使用这一中途结果宣称完成 |
| 最终稳定全量 | full-tests-final.log：318/319 文件、2911/2912 项通过，137.77 秒，maxWorkers=4；唯一失败为既有 A02 ScheduleView 1137 > 1057 行，未修改该页或放宽门禁。全部本轮交互回归通过，不称全量已绿 |

截图已目视核对成功圆形、错误行与真实导航保存的布局。源码主要增量为 ActionButton、actionFeedback、NavigationSettings、navigationEditor；ActionFeedback 沿用原实现，仅 caller 控制重试禁用。审计脚本与浏览器脚本增加当前批次范围；新增 actionButtonInteractions / navigationSaveFeedback 测试，扩展 actionFeedback / navigationEditor 回归；更新 DESIGN_TOKENS、INTERACTION_UX_AUDIT、三份优化文档、逐入口台账与当前发布说明。此前大量未提交改动保留，不算作本轮产出。

### 本批出口与下一组

其余所有逐入口交互继续 S/U。下一轮只处理 GLO08 / SCH04 的今天页文字与作息保存：检查持久化失败、重试/防重、输入法与新草稿/关闭；再推进 GLO05/06 账号和同步，之后按功能 ID 处理搜索/快速记录、上传/导入、各领域保存/提交/删除/撤销与菜单导航。不得因为共享组件通过而将这些消费者标成完成。

真实 iOS Safari/PWA、Android、屏幕阅读器、键盘/输入法系统差异、Electron、云端权限/SMTP/双设备及不可中止写入的完整组合仍 U。完整台账见 INVENTORY 与 INTERACTION_LEDGER。

## 0C. 移动端 UI/UX：今天与待办流程（2026-10-11 第 1 批）

本轮只深入 **今天 / 与待办 /tasks 两页，覆盖“查看下一行动 → 找到待办 → 筛选/处理 → 新建或编辑”**。主尺寸 440×956，结合 320、375、390、430、768px；触屏横屏 956×440，另以 1440px 检查电脑端。使用现有 shadcn-vue / Reka、语义 Token 和 Button / Field 组合，没有安装依赖、改 preset、改变领域命令或存储/同步协议。

| 范围 | 已实施内容 | 能力与边界 |
| --- | --- | --- |
| 导航支撑 | 默认底栏改为今天、待办、课表，另保留快速记录、更多；学习二级导航按当前页显示摘要，展开后五项均可达；短触屏横屏沿用手机导航，长标签可换行 | 已保存的自定义导航及旧默认配置原样保留，不强制迁移。更多中的日程、页面及工具入口保留；不将共用壳算作第三页 |
| 今天 | 下一行动标题/元信息换行、主按钮整行；今日安排时间与内容分行，长地点不挤时间；行动列表保留完成、继续和全部待办入口，手机触区增大 | 虚构长任务与日程已实测；全部首页模块/实体来源、学习计划创建、课后反馈、专注计时等完整矩阵仍 U |
| 待办工作区 | 概览按需展开；三视图、搜索常驻；手机状态 select 与高级筛选共享 URL 真源；列表独立栅格，标题/下一步换行，行操作保留；显式选择模式及批量动作；看板保留动作，窄屏月历局部横滚保证日期至少 44px | 全选、完成、归档、删除、改期、历史、整理/粘贴/CSV、阶段、重复、提醒、课程/项目关系入口均保留。归档等继续按实体状态决定是否可用，未隐藏必要业务 |
| 新建/编辑 | 手机复杂表单使用全屏 Modal，标题/关闭按钮留安全区，内容独立滚动、页脚保存/取消固定；主字段采用 Field；日期/时间与快捷日独立排列；阶段、提醒、改期、工作断点触区增大 | 保留 visualViewport、焦点陷阱、滚动锁、Escape/返回、错误与输入法合同；简单菜单继续 Sheet。例行备份提醒等浮层关闭后恢复，保存/同步错误维持优先级 |

### 新鲜验证与证据

本机证据：D:/study-life/.tmp/mobile-ux-20261011/。browser-results.json / browser-final-stable.log 使用新 Chromium 档案、真实应用 store、虚构 48 条任务及长日程，屏蔽外网，不读取个人档案或真实账户。**36 组页面检查与 31 项交互检查全部通过**，无观察到的整页/可见元素横向越界或 Runtime 异常；月历日期区局部横滚是明确设计行为。

| 检查 | 实际结果 |
| --- | --- |
| 典型尺寸与主题 | 两页 440/320/375/390/430/768/1440 × 浅深，共 28 组；另看板/月历、两页触屏横屏、440/320 两页字号 Token 放大 200%，合计 36 组 |
| 真实触控/数据行为 | 底栏当前态、学习五入口、四概览、状态筛选对应实体与 URL、新建保存进 store、短可见视口页脚/内容滚动、关闭焦点归还、返回先关浮层、备份提醒推迟/恢复、选择及四个当前可用批量动作、返回恢复列表滚动、虚拟长列表窗口均通过 |
| 展开/复杂布局 | 看板/月历高级筛选在 440/320 展开后输入仍完整宽度；月历日期至少 44×44px；320/375/390/430/768 编辑字段与页脚在屏幕内；阶段/提醒可见动作至少 44px；956×440 底栏/学习导航一致，桌面侧栏隐藏 |
| 对比度 | contrast-stable.log：exit 0，144 组主题配色、42 组焦点配对通过 |
| lint / 常规类型 / 类型棘轮 | lint-stable.log / typecheck-stable.log / ratchet-stable.log：exit 0；2911 条诊断低于 2914 基线，未放宽门禁，不称零类型债 |
| 正式 Web build / 发布说明 | build-stable.log / release-check.log：exit 0；独立输出上述目录 web/，203 项预缓存，未覆盖已有 dist。amend-notes 补三条说明并同步 README；签名 04a93c36db，Web 仍 2026年10月11日-版本1，桌面仍 1.0.20；未提交、部署或发布 |
| 最终全量回归 | full-test-final.log：exit 1，315/317 文件、2899/2901 项通过，142.55 秒。失败为既有 A02：ScheduleView 1137 > 1057 行，以及 quickEntryModalClose 的一项 5 秒超时；该超时在相关回归中单独复验，不将最终全量写成全绿 |
| 最终相关回归 | related-stable.log：exit 0，18 文件、169/169 通过，18.75 秒；maxWorkers=2，包含导航、手机状态/query、Modal、表单名称、告警、任务/时间/重复/提醒、触区、返回、快速记账及发布说明。全量中的记账超时项复验通过，未改其 5 秒限时 |

短视口通过调整可见高度模拟键盘占位；Modal 的 visualViewport 高度/偏移、滚动锁与关闭清理另有实际挂载回归。**真实 iOS Safari/PWA 键盘、输入法、刘海与底部安全区数值、系统字体放大、Android、读屏器仍未验证**，不能把 Chromium/字号 Token 模拟当成真机验收。真实同步、云权限、通知、导入及删除/冲突的全部异常分支仍 U。

本轮增量为 19 个应用源码文件、8 个已有测试文件、3 份优化文档、release.config.js / README；不将既有大量未提交改动归入本轮。应用文件：App、Sidebar、LearningNavigation、Modal、navigationPreferences、routes、backupReminder、TodayView、TodayActionList、TodayAgenda、TasksView、tasks.css、TaskBulkBar、TaskTimeEditor、TaskTimeShift、TaskWorkCheckpointFields、TaskBoard、TaskCalendar、shadcn.css。测试包括新默认导航合同、手机状态/query 返回、全屏浮层/visualViewport 和 FieldLabel 名称扫描；悬空 for 与零无名字段仍受检查。独立审查发现并已修正 utility 优先级导致的桌面选择按钮/不换行、展开 details 宽度、横屏断点不一致、阶段小触区和放大时间列。过程中新增的非档位断点及 App 文件体积失败已修复，未改测试上限；初次全量默认并发过高有超时，最终限定 maxWorkers=4。相关与全量结论均采用上述最后日志。

最终 integrity-final.json 确认 95 个业务 ID 与 10 个 API ID 的原序/唯一性保持，五份优化文档的 1147 个本地链接均存在，源码与发布签名一致；保存本批文件 SHA-256 供复核。git diff --check exit 0。临时 Vite 与本轮隔离 Chromium 已结束。

### 本批出口与下一批

| 状态 | 页面/流程 |
| --- | --- |
| 本轮移动专项已实施并通过所列浏览器/构建验证 | / 今天；/tasks 待办工作区与新建/编辑流程 |
| 尚未完成移动专项 | /schedule、/course、/exams、/events、/lists、/bills、/review、/together、/projects |
| 下一批建议 | 课表查课/课程详情与日程创建/详情：窄屏网格、日期定位、返回/滚动、编辑/导入与复杂浮层；继续限定 2–3 页 |
| 后续平台验证 | iPhone 16 Pro Max 真机 Safari/PWA 软键盘与安全区、系统大字体、横竖屏切换；Android/读屏器；云端/异常业务矩阵 |

A03 在本批待办手机工作区范围已处理；A04/A06/A10/A11 为限定覆盖，不能关闭全部首页模块/组件/表单。A02 课表门禁及其他页面继续开放。本轮完成记录后停止。

## 0B. 电脑端 UI/UX 深度优化：第 1 批

本轮只深度优化 **待办 /tasks 与周回顾 /review 两个页面**。选取依据是待办的高频任务管理和 A03/A10 工具层级问题，以及回顾的 A09 无样本图表与复盘优先级问题。遵循现有 shadcn-vue 设计系统，保留主题、路由 query、领域命令、同步/存储协议和所有功能入口。只修复共用侧栏的 A05 工具/主题行横向溢出，不将其算作第三个完整页面。

| 页面 | 本轮完成内容 | 保留入口与边界 |
| --- | --- | --- |
| [待办](../../src/views/TasksView.vue) / [页面样式](../../src/views/tasks.css) | 大概览卡收敛为快捷计数；视图、状态、搜索合为一个工具区；高级优先级/日期范围/排序按需展开；新增为主操作，历史与导入为辅助；列表无 Hover 投影，长标题与下一步说明保持阅读空间；桌面收起与侧栏重复的学习导航 | 列表/看板/月历、状态/概览/搜索/清除、排序/方向、历史、整理/粘贴/CSV、新增/编辑、行操作/专注/项目关联、多选/批量、改期/阶段/冲突/重复/删除撤销均保留。列表状态沿用 query；手机学习导航保留。本轮未重做复杂任务编辑器或验证真实同步/全部异常写入 |
| [周回顾](../../src/views/WeeklyReviewView.vue) | 四个大指标卡合成摘要条；复盘与下周事项构成桌面主次工作区，窄桌面自动换行；三字段采用 FieldGroup/Field/Label/Description，过去进展并列，下周重点占整行；分析保持可展开入口，按样本绘图，无样本用解释/下一行动；顶部周次与返回操作统一 Button | 上/下周/本周/今天、原有全部指标及缺汇率说明、下周四种实体来源/导航、三字段自动/手动保存与切周恢复、四类分析均保留。默认 CardTitle h3 合同保留，新增可选 h2；不改金额/时间口径、保存协议；账号同步/备份真实环境仍 U |

### 共用支撑与实际变更

业务源码共 **8 个文件**：上述两个页面与 tasks.css，以及 [Sidebar.vue](../../src/components/Sidebar.vue)、[Toggle CVA](../../src/components/ui/toggle/index.ts)、[CardTitle.vue](../../src/components/ui/card/CardTitle.vue)、[shadcn.css](../../src/styles/shadcn.css)、[Lucide 类型声明](../../src/types/lucide-vue.d.ts)。Sidebar 工具纵向排列、主题色可换行；沿用顶栏的全局搜索/快速记录、侧栏折叠、导航个性化与手机更多。Toggle 使用已有 Reka 原语，补无 Preflight 下的基础配方、32px 桌面/44px 粗指针、语义状态色、共享焦点及图标规则；没有安装组件/依赖、切换 preset 或批量改页面。

新增 [weeklyReviewWorkspace.test.js](../../tests/weeklyReviewWorkspace.test.js) 的真实 Vue 挂载用例；扩展 [taskViewQueryInteractions.test.js](../../tests/taskViewQueryInteractions.test.js) 检查必选状态重复点击；更新 [phase1Regression.test.js](../../tests/phase1Regression.test.js) 的原生按钮源码守卫为 Reka 组合检查，真实 aria-pressed 由挂载回归验证。没有修改工程阈值或类型基线。

正式构建初次被既有发布签名门禁阻止。使用项目 release:bump 的 amend-notes 保留当前版本已有说明并补本轮两条 UI 说明，同步 release.config.js / README；**网页版本仍为 2026年10月11日-版本1，桌面仍为 1.0.20**，未新增版本、打安装包、提交、部署或发布。最终签名 718c65d25b；源码签名校验保持开启。最终补齐首条版本 signature 与该常量一致，说明/版本不变，另跑 release-final.log 和 build-delivery.log 验证；该签名字段被源码哈希归一化，不改变业务签名。

### 本轮新鲜验证

| 证据 | 实际结果 |
| --- | --- |
| 相关回归（最终 16 文件） | exit 0，174/174 通过；覆盖真实筛选/搜索/排序/query/导航失败、三视图、批量/任务编辑/时间、虚拟列表、侧栏返回/Escape、标题/标签、无样本分析、复盘自动保存/页面重建/切周草稿隔离、CSS 与发布说明；见 related-complete.log |
| lint / 常规 typecheck / 类型棘轮 | exit 0；棘轮 2909 条诊断低于 2914 基线，未放宽阈值，不称零类型债；见 lint-final.log / typecheck-complete.log / ratchet-complete.log |
| 对比度审计 | exit 0，144 组主题配色及 42 组焦点配对通过；见 contrast.log |
| 正式 Web build | exit 0；两个页面均编译到独立输出 D:/study-life/.tmp/desktop-ux-20261011/web；未覆盖已有 dist。见 build-delivery.log（验证过输出绝对路径后使用 emptyOutDir，201 项预缓存，避免临时输出混入上一轮旧资产） |
| 隔离 Chromium | 使用完整虚构业务实体通过应用 store 注入，由实际选择器与组件计算；桌面 1440/1024 浅深、390/320 窄屏、列表/看板/月历/归档、编辑浮层、空数据、64 条任务、浅深高对比状态截图；最后 browser-results.json 的 12 组页面检查、13 组状态截图与 8 条行为检查均通过，无观察到整页/侧栏横向溢出或 Runtime 异常 |
| 浏览器真实行为 | 优先级筛选对应实体与地址；编辑浮层 Escape；复盘自动保存状态/刷新恢复；空分析默认收起且不画空图；64 条虚拟列表只渲染可见窗口；ArrowRight 焦点与 Space 切换看板均通过 |
| 最终全量测试 | exit 1；316/317 文件、2896/2897 项通过，唯一失败为既有 A02：ScheduleView 1137 行 > 1057 上限；252.82 秒。没有改课表或门禁。见 full-test-complete.log |
| 最后格式清理复验 | tasks.css 仅去除一处空白行的行尾空格；6 文件 39/39 通过，包括 CSS、两页交互、既有回归与发布说明；见 format-regression.log。正式构建已再次通过，git diff --check exit 0。首次重跑因沙箱临时缓存 rename EPERM 未执行测试，改用工作区临时目录后通过，没有改产品或测试合同 |

过程发现并修正：原生 Toggle 在无 Preflight 下的默认边框、主题色行溢出、320px 状态组不换行、侧栏行数新增、重复 CSS；图标补齐现有声明。首次全量中的以上新增问题不沿用为最终结论。检查脚本修正了沙箱内外 localhost 隔离、已挂载 store 对直接 LocalStorage 注入的覆盖、系统主题选择和刷新等待；未借检查脚本改动产品数据协议或放宽测试。

本机证据目录：D:/study-life/.tmp/desktop-ux-20261011/。受影响源码 before 快照、稳定源码哈希、日志和虚构截图仅本机保存；未读取个人浏览器档案、真实账号/数据库/备份或秘密。本轮不是实体 Electron/手机、读屏器、线上权限或跨设备同步验收。最终 7 个应用源码与 3 个测试文件的 SHA-256 与稳定验证起点一致；tasks.css 最后只删除一处空白行的行尾空格，经逐行忽略行尾空格对比无行为变化，另跑 CSS/页面/发布回归与正式构建（format-regression.log / build-delivery.log）；版本元数据只做上述签名对齐。95 个业务功能 ID 与 10 个 API ID 的顺序/唯一性保持，五份优化文档的 1148 个本地链接均存在；见 integrity-final.json。临时 Vite 服务与本轮隔离浏览器已结束。

### 电脑端页面完成台账（本轮限定范围）

| 状态 | 页面 |
| --- | --- |
| 本轮已完成深度布局优化并通过构建/相关功能验证 | /tasks 待办；/review 周回顾 |
| 仍未完成本阶段的逐页深度优化 | / 今天；/schedule 课程表；/course 课程进度；/exams 重要日期；/events 日程；/lists 清单；/bills 账本；/together 一起约；/projects 齐行 |

上述“完成”限定为本批页面 UI/UX 范围，不代表该领域的每个云端/异常写入组合已验收。A03 电脑端层级已处理，移动端专项仍开放；A05 在本批桌面侧栏工具区关闭；A09 在本批回顾样本/布局范围关闭，完整统计异常口径仍待验。A06/A10/A11 仍为部分覆盖；A04 首页、A07 文本动作、A08 图标和 A02 课表门禁等继续开放。下一批可选今天与日程或课程进度，先按数据状态与入口台账验收，不扩展本批页面分母。

## 0A. 设计系统基础阶段

技术栈检查确认 Vue 3 + Vite + Tailwind v4 + shadcn-vue / Reka 兼容现有架构。读取 shadcn Skill 与上一阶段四份优化文档中的设计/组件/状态登记，按既有方案局部推进。React shadcn CLI 的只读 info/docs 不接受 Vue 配置；转而核对官方 Vue 文档，没有改配置迎合 CLI。没有依赖迁移、preset 切换、全量 add 或组件覆盖。

实施范围为 14 个应用源码文件、1 个已有测试、3 个本目录文档，实际文件与增量见 [DESIGN_SYSTEM.md 第 6 节](DESIGN_SYSTEM.md#6-本轮实际变更清单)。沿用当前大量未提交增量，本轮开始时保存了受影响文件 before 快照，不把 Git 整体差异归为本次变更。

| 工作项 | 实际结果 | 范围边界 |
| --- | --- | --- |
| 全局设计 Token | 语义颜色/字号/字体/行高/4px 间距/40、32、44px 控件/8、12px 圆角/边框/阴影/图标/动画/触控规则均有消费者 | 保留 theme.js、具名/自定义/系统主题、高对比与旧数字 Token；不重做页面级 CSS |
| Button / Input / Card | 统一 CVA 与基础配方、主色 Hover、明确前景、单一焦点环、Input 可见边框、禁用、内容内距与标题层级 | 原语接口与属性透传保留；业务已有 scoped/utility 覆写仍需逐页整合 |
| PromptDialog / Field | 典型重命名表单接 FieldGroup/Field/Label/Input/Error，主操作 default、取消 outline；补中文输入法保护 | 保留 trim、空值关闭、取消/Escape、初值、错误、maxlength、焦点和现有兼容定位钩子 |
| Modal / Sheet / ActionButton | 保留已有有效交互，仅接浮层圆角/阴影/标题内距、异步按钮高度/gap/成功图标前景 Token | 未更改 overlayStack、抽屉拖拽、取消、请求去重、重试、尺寸锁或读屏公告 |
| Tabs / Dropdown / Toast / Sidebar 等 | 已记录组件所有权、保留理由与后续组合规则 | 本轮没有批量替换实现；A05/A07 等页面/导航问题仍开放 |

### 本阶段新鲜验证

| 命令 / 证据 | 实际结果 |
| --- | --- |
| 最终定向回归（14 文件） | exit 0，152/152 通过；包含 PromptDialog 的输入法、错误关联、重复浮层标签，以及 Modal/Sheet/栈、异步反馈、CSS/Token/高对比/触控守卫；见 targeted-complete.log |
| `npm run lint` / `npm run typecheck` | 最终 exit 0；见 lint-complete.log / typecheck-complete.log |
| `npm run typecheck:ratchet` | exit 0；2909 条诊断低于 2914 基线；未修改基线，不声称零类型债；见 typecheck-ratchet-final.log |
| `npm run audit:contrast` | exit 0；144 组配色及 42 组焦点配对通过；见 contrast-final.log |
| 隔离 Chromium | 最终 21 组页面检查（12 组典型组件：1440/390/320 × 浅/深/浅高对比/深高对比；9 组首页/重要日期/账本消费者）；11 组状态截图与 15 条检查通过；无观察到的整页横溢出/Runtime 异常。桌面 Button/Input 40px，手机粗指针 44px；320px 对话框输入和两个操作 44px、overflow 0 |
| 浏览器可访问性与状态 | 实际主按钮 Hover 从 #3d63d8 到 #3151b8；禁用 Hover 不变；键盘 2px 实色 outline；加载/成功/失败和重试显示；浅深对话框 Escape/焦点归还通过；输入边框相对背景分别为 3.47/3.66/5.12/7.45:1，成功图标相对实底为 5.63/8.15:1。见 browser-results.json |
| `npm test -- --maxWorkers=2`（最终稳定源码） | exit 1；315/316 文件通过，2891/2892 项通过；唯一失败为已登记 A02：ScheduleView 1137 行 > 1057 行上限。本轮没有修改课表或放宽门禁；251.14 秒；见 full-test-complete.log |
| `npm run build -- --outDir D:/study-life/.tmp/design-foundations-20261011/web` | exit 1；正式构建仍被既有发布源码签名/更新说明一致性门禁在配置阶段阻止，当前签名 a27e6bab9f；见 build-final.log。没有改 release/README、绕过门禁或称生产构建通过 |

首轮全量发现共享表单迁移移除了测试仍使用的 `.prompt-label` / `.prompt-field` 定位钩子；已在新 Field 组合上保留兼容钩子，没有恢复重复视觉 CSS，没有放宽工程测试。随后定向与全量复验记录为最终依据。浏览器第一次焦点归还探针使用 programmatic click 而没有聚焦触发按钮，改为先 focus 后 click 再验；新增对比度探针最初不识别 Chromium 的 color/oklab 字符串，转换实际 sRGB 像素后验。这些是检查脚本修正，未因此修改产品焦点协议或审计阈值。

本机证据目录：`D:\study-life\.tmp\design-foundations-20261011\`。截图、隔离浏览器档案、受影响文件 before 快照、检查日志均不纳入项目 Git。临时组件样例入口位于已忽略的 `.vitest-tmp/design-foundations/`，不接入产品路由或菜单。浏览器只用新档案/虚构文字，阻止外部请求；没有读取个人浏览器档案、真实账号/备份/环境秘密；没有提交、部署或发布。

最终验证起点到结束的 14 个源码文件和 1 个测试文件 SHA-256 均未变化；三个增量文档的 34 个本地文件链接均存在，受影响源码与 before 快照对比确认 14 个文件发生本轮增量。见 source-validation-start.json / integrity-final.json。临时本地 Vite 检查服务已结束。

### 阶段出口与下一阶段

当前设计基础为 A06 的首批实施，PromptDialog 是 A11 的典型表单验证；不能据此关闭全部 A06/A11、宣称所有组件/页面已统一。A05 侧栏工具横滚、A07 文本动作、Tabs/菜单/复杂表单、实际 iOS/Android 输入法与读屏器、完整主题/登录态仍待下一阶段。已更新 [DESIGN_PLAN.md](DESIGN_PLAN.md) 和 [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)。本阶段完成后停止，等待用户下一阶段指令。

## 0. 功能可靠性优化：第 1 批

沿用 INVENTORY/AUDIT 的现有登记，没有重复全仓源码/路由/浮层/浏览器扫描。选中 TSK02 的排序、筛选、搜索与 URL 状态链，同时验证 TSK01 的看板/月历联动。本批仅修改 3 个业务文件、新增 2 个回归测试文件，并更新本目录三个文档及 `docs/COVERAGE_MATRIX.md`。没有更改数据 schema、迁移、领域写命令、账号配置、依赖或工程基线；测试只操作 happy-dom 的虚构数据。

| 问题/优先级 | 修改文件 | 实际测试结果 | 剩余风险/覆盖边界 |
| --- | --- | --- | --- |
| A01 / P1：排序、优先级、范围选择只改变控件，不执行筛选 | [TasksView.vue](../../src/views/TasksView.vue)；新增 [taskViewQueryInteractions.test.js](../../tests/taskViewQueryInteractions.test.js) | 修改前，真实 Vue 页面挂载后的 3 个 select change 用例全部失败；修改后列表顺序/实体 ID/控件值/URL 对应断言通过。组合筛选、看板/月历、清除筛选、方向按钮另有通过用例 | 挂载集成测试使用 happy-dom；本轮没有重做实体手机或 Chromium 手工操作。TSK03–10 的完整创建/编辑/删除/批量业务仍不能由筛选通过推定 |
| A22 / P1：连续操作、历史导航及导航失败造成界面与 URL 不一致 | [useTaskViewQuery.js](../../src/composables/tasks/useTaskViewQuery.js)、TasksView；新增 [useTaskViewQuery.test.js](../../tests/useTaskViewQuery.test.js) 和上行交互测试 | 修改前连续筛选丢失 priority/sort/view、排序后立即反向丢失 sort、后退到旧回声地址不恢复；guard false 时不回滚，guard throw 产生未捕获 rejection。修改后这些用例通过；旧失败/外部导航不会覆盖新状态，失败有 role=alert 并可重试；搜索/清除与 URL 同步 | 使用真实 Vue Router memory history 和可控异步守卫；物理浏览器历史、网络/账号请求竞态、跨设备同步不在本批验收内 |
| A23 / P2：显式选择默认“已安排”后重新加载被智能默认覆盖 | [taskViewQuery.js](../../src/composables/tasks/taskViewQuery.js)、useTaskViewQuery；新增的上述两个测试文件 | 修改前 f=scheduled 被省略，地址恢复测试失败。修改后显式 f=scheduled 保留；销毁页面与路由后按保存的 URL 重建，仍显示用户选择的空列表；后退到干净地址重新启用智能默认 | 本批验证 URL 重建的等价刷新场景；本机业务持久化、IndexedDB 配额、云同步及 PWA 跨版本缓存恢复仍待独立测试 |

### 本批新鲜验证

| 命令/证据 | 实际结果 |
| --- | --- |
| 红用例：`npm test -- tests/useTaskViewQuery.test.js tests/taskViewQueryInteractions.test.js --maxWorkers=2` | 9/9 失败，全部进入实际组件/路由代码路径；见 red.log。随后新增的导航拒绝/异常/干净地址恢复用例也在修复前失败，见 red-navigation.log |
| 定向回归 + 关联已有工作区/时间交互 + query 编解码 | 最终 5 文件、46/46 通过，其中两个新文件 18 项；含 3 个控件、组合筛选、看板/月历、搜索/清除、方向、路由重建、失败/重试、旧请求/外部导航、前进后退；见 targeted-final.log。首轮 41 项记录只作过程证据 |
| 只读代码审查与复验 | 审查补充复现“两个请求待完成时后退到旧目标地址”会误被当作回声；新增用例先失败（review-red.log），限定为最新世代回声后通过，并由同一审查者重跑原脚本确认关闭（review/pending-history-final.log）；此修正属于 A22 |
| `npm run lint` / `npm run typecheck` | 最终均 exit 0；见 lint-final.log、typecheck-final.log |
| `npm run typecheck:ratchet` | 最终 exit 0；2911 条诊断低于现有 2914 基线，TS2304 硬红线未触发；未更新/放宽基线。不把非零诊断称为零类型错误；见 typecheck-ratchet-final.log |
| `npm test -- --maxWorkers=2`（最终稳定源码） | exit 1；315/316 文件通过，2889/2890 项通过，唯一失败为已登记的 A02：ScheduleView 1137 行 > 1057 行上限；本批未改课表或放宽上限。253.17 秒；见 vitest-final.log |
| 首轮全量与环境差异 | 首轮 314 文件通过、2 文件失败；2888 项通过、1 项失败。除 A02 外，engineeringConfig 在 afterAll 的临时路径字符串校验失败（TEMP 使用正斜杠，而 dirname 返回反斜杠）。改用 Windows 原生 TEMP/TMP 后该文件单独 2/2 通过，最终全量也通过；无测试源码/门禁改动。见 vitest-full.log、engineering-config-retest.log |
| `npm run build -- --outDir D:/study-life/.tmp/functional-reliability-20261011/web` | 最终 exit 1：正式生产构建在配置加载阶段被发布源码签名/更新说明一致性门禁阻止，当前签名 534276326f。未声称生产构建通过，未修改发布版本/README 或绕过门禁；见 build-final.log |

本批本机证据目录：`D:\study-life\.tmp\functional-reliability-20261011\`。baseline.json 和三个业务文件的 `.before` 快照保留的是本轮开始时内容，用于区分已有大量未提交改动。首次测试曾因沙箱系统临时缓存 rename 的 EPERM 在执行用例前退出；将 TEMP/TMP 指向上述工作区临时目录后完成红/绿验证，这不计作产品缺陷。没有读取真实账号、数据库、备份、浏览器个人档案或秘密，没有删除用户数据，没有提交/部署/发布。

增量文档校验保留原有 95 个功能 ID 及顺序，没有重复 ID；新增/更新部分的 17 个本地链接目标存在。最终检查开始后的 3 个业务文件与 2 个新增测试文件 SHA-256 未变化（validation-source-start.json、source-integrity-final.json）；Git HEAD 仍为 f0ce520。只校验本批增量，没有重新生成全仓索引或重扫其他用户文件。

### 下一批（登记后停止，最多 3 项）

1. **TSK03/TSK04：创建、编辑、保存及冲突确认。** 检查重复提交、冲突确认期间编辑/取消/再次保存、领域命令失败时错误反馈和表单保留，正常路径核对刷新后的实际数据。
2. **TSK07/TSK08：完成/恢复、归档/恢复、删除/撤销和批量操作。** 核对真实按钮、过期选择、单项失败和重复动作；先用虚构记录构建失败用例，保留软删除/撤销合同。
3. **TSK03/07/08 + GLO07：上述写操作的本机持久化。** 注入 LocalStorage/IndexedDB 失败、观察状态/持久化反馈并重建页面，核对安全副本与恢复点，避免假成功和静默失败。

登录/退出/账号切换、缓存更新、云同步和数据库权限仍按 GLO05–07、API01–06、TOG/PRO 台账列为未完成，另批检查；需要真实环境的验收仍保留 U。A02 课表行数门禁属于已登记的工程问题，本批功能范围没有处理。不得将本批 3 项修复扩展为“全部 Bug 已修复”或“全功能已验收”。

## 1. 审计阶段交付（2026-10-10 历史）

| 交付 | 状态 | 内容/边界 |
| --- | --- | --- |
| [INVENTORY.md](INVENTORY.md) | 已完成 | 11 主路由、重定向/404/桌面回调/启动分支、业务二级功能、全局工具、浮层调用点、接口/权限/数据流、完整活动源码索引 |
| [AUDIT.md](AUDIT.md) | 已完成 | 21 条问题记录（20 个开放问题/风险、1 项并行修复已补测），区分确定缺陷、设计判断和未验证条件；保留/修复/重构/删除候选 |
| [DESIGN_PLAN.md](DESIGN_PLAN.md) | 已完成 | 页面信息层级、视觉合同、移动交互、稳定代码边界和验收门槛；尚未实施 |
| Git/用户数据保护 | 已校验 | 本任务只新增本目录四个 Markdown；HEAD 不变，既有 216 个文件全部存在；并行变化单独记录，不覆盖其他作者改动 |

## 2. 原审计规划阶段与当前进度

| 阶段 | 状态 | 范围 | 完成条件 |
| --- | --- | --- | --- |
| 1. 功能缺陷与门禁 | 部分实施；第 1 批见第 0 节 | A01 已修；A22/A23 本轮新增并修复。A02 课表守卫和 A05/A07/A08 布局/样式/图标待后续阶段 | 以本批实际验证为准；完整交付门禁尚未通过；不放宽工程基线；既有输入/存储/路由行为保持 |
| 2. 核心工作流结构 | 电脑端两页已实施；第 0B 节 | 待办/回顾布局与状态已验；首页及其余页面、移动端专项仍待推进 | 台账入口覆盖；空/少/多数据结构评审；手机首屏有业务内容；指标和重复卡片有明确用途 |
| 3. 共享 UI 与设置 | 基础批已实施；见第 0A 节 | A06 基础 Token / Button / Input / Card；A11 典型 PromptDialog。其余复杂表单、设置发现性/个性化尚未实施 | 本批浅/深/高对比、键盘与模拟触控有证据；真机软键盘/读屏器仍待验；保留模态栈/取消/草稿保护 |
| 4. 架构与类型清理 | 部分实施，见 0E | A02 课表工作区边界已拆分/门禁通过；A13/A14/A17/A19 其余仍开放 | 保留原预算；其余 DTO/实体、默认真源和孤立代码分批处理 |
| 5. 平台与发布前验收 | 本机课表资源已测，环境验收未完成 | A16 课表按需加载子问题已处理，PWA 总成本/低端机与 A15 云权限/同步/桌面仍待验 | 实测与未知分开；本轮未部署/发布 |

## 3. 问题跟踪

| 问题 | 当前状态 | 下一步 | 关联功能 |
| --- | --- | --- | --- |
| A01 | 本轮已修并有挂载交互回归 | 保留回归；真实设备验收仍 U | TSK02 |
| A22 | 本轮确认并修复，真实异步路由回归通过 | 后续继续检查领域提交/账号请求竞态 | TSK01/02 |
| A23 | 本轮确认并修复，URL 重建/智能默认回归通过 | 后续检查业务数据持久化与 PWA 刷新 | TSK02 |
| A02 | 0E 本轮已修，1137 → 1056 行，原上限 1057 不变 | 原守卫与最终全量 2917 项通过；保留工作区模块回归 | SCH01–SCH10 |
| A21 | 已由并行变更补声明；23:40 typecheck 通过 | 本任务未修代码；保留修复，稳定后完整复验；长期类型边界归 A13 | UI Spinner / GLO13 |
| A03 | 第 0B 节已处理电脑端工具区；320/390 无横溢出 | 手机首屏与实体触控另批深度优化 | TSK01/02/08 |
| A04 | 确认重复与层级，未改 | 首页行动投影/空态/模块排序设计 | HOME01–07 |
| A05 | 本批修复：工具纵排、主题换行，桌面截图横溢出 0 | 保留个性化与折叠；更多设置架构后续优化 | GLO01/02/04 |
| A06 | 全局基础与典型原语批已实施，整体仍开放 | 按页面收敛 scoped/utility/legacy 覆写，推广视觉合同 | 全页面/GLO08 |
| A07 | 目视确认，未修 | 共享文本动作样式 | HOME02/GLO12 |
| A08 | 目视/源码确认，未修 | 正确日历图标 | SCH01 |
| A09 | 本批回顾范围已处理并有样本/空态回归 | 完整统计异常口径与实体环境待验 | REV01–04 |
| A10 | 已登记矩阵，未改 | 按状态/角色整理主要与辅助动作 | TSK04–10/CRS02/PRO02–04 |
| A11 | PromptDialog 典型表单及浮层基础已实施，复杂业务仍开放 | 保存区/关闭/复杂草稿/时间控件合同与真机键盘验收 | TSK03/04、MILE02、EVT02、PRO08 |
| A12 | 发现性问题确认，未改 | 全局时区/提醒/账户默认设置可达 | GLO11/EVT06 |
| A13 | 2878 条类型诊断，未修 | 事件/DTO/实体边界优先 | TSK02、PRO01–11、个人领域 |
| A14 | 责任复合确认，未改 | 按已有 composable 边界分解复杂工作区 | SCH、LED、PRO、GLO01/08 |
| A15 | 源审完成，真实环境待验 | 双账号/双设备/成员权限/Storage/部署一致性 | API01–06、GLO05–07、TOG、PRO |
| A16 | 0E 课表按需加载子问题已测/已修；总体仍开放 | 页面 JS 93→80，decoded bytes 减少 192767；后续默认 PWA 安装、真实弱网/低端机与其他路由 | GLO14/15、SCH01 |
| A17 | 删除候选，未删除 | 全仓引用/调用/兼容确认后局部移除 | GLO04、退役边界 |
| A18 | 差异已登记，未改 | 明确固定模块/壁纸页面范围 | HOME07/GLO08 |
| A19 | 源码问题已登记，未改 | 默认值真源/导入重复 ID 规范化 | GLO02/HOME07 |
| A20 | 当前记录已独立建立 | 下一阶段补交互与新鲜验证，更新相关旧报告 | 全功能验收 |

## 4. 审计阶段验证结果（2026-10-10 历史）

| 验证 | 结果 | 限制 |
| --- | --- | --- |
| lint | 初始及 23:29 增量通过 | 其后更新模块继续变化，不能当作最终增量全仓 lint |
| 常规 typecheck | 初始通过；23:35 曾失败；23:40 增量通过 | A21 已由并行变更补声明；checkJs 未开启；本任务未修复业务或类型文件 |
| typecheck:report | 初始快照 2878 条诊断 | 是诊断报告模式，exit 0 不代表零错误；未修改类型棘轮基线；非增量最终数量 |
| 默认并发全量 Vitest | 18 失败 / 2796 通过 | 包含超时/异步时机；不能全部当产品缺陷 |
| 限制 2 workers 的完整复验 | 初始全量 1 失败 / 2813 通过；310 文件 | 剩余为 ScheduleView 行数守卫；不含后来新增回归文件；当前不能据此称最终全仓全绿 |
| 新增更新竞态回归 | 23:35 单文件 5 项通过 | 23:30 的依赖/时序/安装中间态失败经并行改造消除；不是本任务修复成果，也不代替全量/真实升级 |
| Web build（独立临时输出） | 初始构建通过 | 未覆盖已有 dist；后来更新改造后的构建未复验；未部署、未重打桌面安装包 |
| 浏览器 | 初始独立构建 45 页面组合、9 表层探针；无观察到的整页横溢出/Runtime 异常 | 仅隔离 Chromium；局部工具横滚/无效 select 已发现；不是全功能通过；不覆盖增量更新 UI |
| 功能覆盖台账 | 活动源码/路由/API/浮层已枚举 | S/登记不等于 U 项已实际验收 |

本次可重查的本机证据：`D:\study-life\.tmp\optimization-audit-20261010\` 下的 `git-baseline.json`、`source-index-initial.json` / `source-index-final.json`、`source-hashes-final.json`、`inventory-summary.json`、`lint.log` / `lint-final.log`、`typecheck.log` / `typecheck-last.log` / `typecheck-cutoff.log`、`typecheck-report.log`、`vitest.log` / `vitest-bounded.log`、`update-regression-final-retry.log` / `update-regression-last.log` / `update-regression-cutoff.log`、`build.log`、`browser-results.json` 及虚构截图。临时证据不纳入项目 Git；没有附带真实用户数据。

## 5. 尚未完成的环境验收

- 已登录好友/齐行的真实双账号流程，成员/管理者/负责人/验收者拒绝矩阵，实时通知和私有文件访问。
- 托管 Supabase 的迁移/Edge/Storage/Realtime 是否与当前工作区匹配；本地迁移存在不能证明线上已应用。
- 真实跨设备同步、并发编辑/撤销、退出/换账号的数据归属、真实存储配额、备份恢复与项目云数据范围说明。
- 全部导入向导的真实照片/OCR、Excel/CSV/ICS、大文件峰值、相机/剪贴板/语音/系统分享权限。
- 实体 iOS/Android 的输入法、Safari/PWA 安全区、手势、横屏、读屏器和系统通知；所有深色/高对比度主题与复杂登录态本次未逐项浏览器走查。
- 低端设备和弱网的冷启动/INP/资源与缓存成本；PWA 安装、断网完整链、跨版本更新恢复。
- Electron 签名安装、升级/回滚、账户回调和用户数据目录；本次只源审，无真实更新/安装操作。

这些属于后续实施和验收边界，不阻碍本阶段审计文档完成；不得把它们标成“已优化/已验收”。

## 6. 审计冻结工作区保护记录（2026-10-10 历史）

冻结快照：2026-10-10 23:43:16（Asia/Shanghai）。本次文档的活动源码索引取自 23:43:14；随后内容不自动追溯为本次验证。冻结校验数字固定在下表；后续文档复验和并行增量保存在临时证据 `integrity-latest.json`，不包含用户记录。

| 项目 | 结果 |
| --- | --- |
| Git HEAD | 开始/冻结均为 `f0ce520bea1527dd5131c0f8ace1b9ff43b46110`，未移动分支或提交 |
| 开始时未提交文件 | 216 个（77 个已修改、139 个未跟踪）；全部仍存在，Git 状态未被本任务清理 |
| 内容哈希 | 208 个与开始时逐字节一致；另外 8 个发生并行内容变更，保留当前内容，未还原或覆盖 |
| 本任务写入 | 仅新增 `docs/optimization/INVENTORY.md`、`AUDIT.md`、`DESIGN_PLAN.md`、`STATUS.md`；未修改业务源码、测试、配置、依赖、其他作者文档 |
| 冻结时 Git 变化总数 | 235 个：开始时 216 + 本任务 4 个文档 + 并行新增 Git 状态记录 15 个；不能把总差异全部归给本次审计 |
| 索引/文档核对 | 843 个源码文件均有定位；11 主路由、95 功能 ID、156 个组件浮层调用点及 4 个 HTML 根、63 个 API 动作、23 张表；21 条问题记录与跟踪一致；847 个不同本地链接目标存在；无缺项/重复 ID/缺失链接 |
| 源码快照完整性 | 索引生成后到冻结校验时，活动源码哈希未再变化；后续并行变更仍需新鲜门禁 |
| 用户数据保护 | 未读取真实账号、浏览器个人档案、环境秘密、备份或用户记录；浏览器只使用新隔离档案与虚构数据；未清除/导入/覆盖真实数据 |
| 辅助产物 | 索引/日志/独立构建/虚构截图仅放在仓库外 `D:\study-life\.tmp\optimization-audit-20261010\`；未覆盖既有 dist；本任务临时浏览器/服务已结束 |

发生并行哈希变化的 8 个既有文件：README.md、package.json、package-lock.json、release.config.js、vite.config.js、src/components/data/AppUpdateSection.vue、src/styles/shadcn.css、src/types/lucide-vue.d.ts。

并行新增 Git 状态的 15 个文件：desktop-app/{main,preload,updaterController}.cjs；src/composables/{appUpdate,desktopAppUpdate,updatePresentation,updateProtocol,webUpdateController}.js；src/components/ui/{progress,spinner} 下各两个文件；tests/{appUpdateLatency,versionUpdatePanel,updateCoordinationRegression}.test.js。这些均原样保留，未将其并行修复成果计作本任务实施。

冻结后的文档复验仍观察到 src/composables/updateProtocol.js、webUpdateController.js、src/env.d.ts、desktop-app/updaterController.cjs 等继续写入。它们不影响本次文档链接/ID 覆盖校验；增量代码须在稳定后重新验证，未将冻结前的测试/构建结果自动套用到这些后续内容。本任务没有持续追踪或介入其实现。

以上第 1–6 节的冻结与验证记录描述 2026-10-10 审计历史；2026-10-11 第 1 批功能实现见第 0 节。未执行 git add/commit/push/reset/checkout/clean、部署、发布、升级依赖或真实安装客户端操作。
