# 功能与页面覆盖台账

2026-10-11 最终验收：逐项当前状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)，命令与故障复现见 [TEST_REPORT.md](TEST_REPORT.md)。项目验收未通过，两项 P1 数据保护问题开放。下文保留历史清单与各阶段限定证据，不自动表示当前已验证。

审计日期：2026-10-10（Asia/Shanghai）。对象：`D:\study-life\study-life` 当前工作区，HEAD `f0ce520`，包含审计开始时已有的 77 个已修改文件和 139 个未跟踪文件。审计期间存在其他并行变更，最终索引快照与 Git 增量见文末及 STATUS；构建/浏览器/测试结果各自对应记录时的源码，不能混成一次全仓通过。父目录中的备份、其他项目、历史审计快照不作为本产品的活动源码。

本台账记录“存在什么、从哪里进入、依赖什么、还需怎样验收”。登记不等于功能已验收。问题对应 [AUDIT.md](AUDIT.md)，改造方向对应 [DESIGN_PLAN.md](DESIGN_PLAN.md)，阶段状态对应 [STATUS.md](STATUS.md)。后续改造必须保留功能 ID，迁移入口时更新位置，不以页面外观相似代替功能覆盖。

## 全局交互专项覆盖（2026-10-11 第 1 批）

先补齐共享反馈组件，再处理 **GLO02 导航编辑保存** 一组消费者。全部模板交互重新扫描：207 个 Vue 文件、1463 个控件/事件定义，静态依赖可达 1457 个。原生控件、shadcn Button/Input/Toggle/Tabs/Switch/菜单触发器、v-model、交互 role 和事件均纳入；循环/包装器重复计数。逐入口待办保留在 [INTERACTION_LEDGER.md](INTERACTION_LEDGER.md)，分类与静态可达不代替真实角色/平台行为验证。

| 功能 ID / 组 | 本批新增覆盖 | 未覆盖与下一步 |
| --- | --- | --- |
| GLO12 · ActionButton/Feedback | T/V：Promise 决定成功、未完成持续 loading；150ms 淡出、320ms 收缩/恢复、1 秒成功、同步防重、错误重试、焦点/名称/占位、KeepAlive/卸载/取消代次；减少动态不旋转/收缩 | 共享逻辑改善不代表所有消费者完成；真实 Safari/iOS/读屏器、请求不可中止时的数据提交边界继续 U |
| GLO02 · 导航编辑保存 | T：主保存失败/草稿保留/重试；保存并离开重复点击/真实错误/关闭晚结果/同步后 clean 离开；新会话 clean 预览跟随实际存储。V：真实导航保存与本机存储、即时生效一致 | 双端云端真实同步、跨窗口事件、账号云权限仍 U；取消不能撤回已提交的本机事务 |
| GLO02 · 轻量编辑/危险草稿操作 | T：双端草稿、搜索、键盘切换/排序、拖拽取消、移除组转移确认、放弃确认、恢复默认及撤销的既有挂载回归复验 | 未将轻量交互改为复杂动画；触屏真机拖拽/缩放/屏幕阅读器完整路径 U |
| GLO08 / SCH04 · 下一组设置保存 | 待办：今天页文字/作息保存入口、防重、失败持久化、关闭/新草稿、键盘提交 | 既有状态机测试不计消费者整体完成 |
| GLO05/06 · 账号与同步 | 待办：登录/验证码/退出确认、同步开关/冲突/重试/取消和并发锁 | 真实服务/邮件/双设备仍 U |
| 全部剩余页面与工具 | 待办：HOME、SCH、CRS、TSK、EXM、EVT、LST、LED、REV、TOG、PRO 及 GLO03/04/07/09/10/11/13/14/15 的表单、导航、菜单、弹窗、开关、搜索、上传、导入、删除、保存、提交 | 逐入口 S/U 清单完整保留；后续每轮一组与入口，验证后更新 STATUS，不能由本轮共享组件改善推断全部完成 |

当前真实浏览器只验证该组件组与导航保存，不把前一阶段页面截图或本轮源码扫描标作全局交互验收。测试/构建/审查和环境边界见 [STATUS.md 第 0D 节](STATUS.md)。

2026-10-11 增量：功能可靠性第 1 批只处理 A01/A22/A23，实际测试见 [STATUS.md 第 0 节](STATUS.md#0-功能可靠性优化第-1-批)。没有重做上一阶段完整扫描；后面的源码/浮层索引保留审计时快照。**T** 表示本轮实际 Vue 组件挂载或真实 memory router 回归通过，其覆盖范围逐行明确，不能代替实体浏览器/线上验收。


## 移动端专项覆盖（2026-10-11 第 1 批）

本批仅深入 / 今天与 /tasks 待办流程。主视口为 iPhone 16 Pro Max 的 440×956 CSS 尺寸，另验证 320/375/390/430/768、956×440 触屏横屏及 1440 电脑端。36 组页面与 31 项浏览器检查通过，构建/回归与边界见 [STATUS.md 第 0C 节](STATUS.md)。T 为实际挂载回归，V 为隔离 Chromium，不代表 iOS 真机或云端验收。

| 页面/功能 ID | 本批新增覆盖 | 仍未验证/下一步 |
| --- | --- | --- |
| / · HOME01/03/04 | V：长问候、下一行动主按钮、长日程时间/地点分行、行动列表，浅深/多宽/触屏横屏及字号 Token 200% | 全部首页模块、账单/课程/节点来源业务矩阵、学习计划创建及真实反馈 U |
| /tasks · TSK01/02 | T/V：手机状态筛选对应实体与 query、返回恢复；V：三视图布局、展开筛选完整宽度、44px 日期触区、虚拟长列表/滚动恢复 | 月份/日期与全部实体写动作组合、跨平台缓存/刷新 U；完整导入 TSK09 未深入 |
| TSK03 | V：手机新建标题保存到实际 store；T/V：全屏编辑、短视口页脚/滚动、关闭焦点/返回；V：320–768 字段在屏幕内 | 完整 CRUD、校验/删除/课程关系/失败写入矩阵 U，真实软键盘 U |
| TSK04/05/06 | V：阶段展开/提醒触区；S：改期、重复、提醒、工作断点及所有字段/动作保留；已有领域回归保留 | 完整多阶段/改期/重复/通知/断点组合未作本轮真机验收，仍 U |
| TSK07/08 | V：选择一个实体、当前可用完成/改期/删除/取消入口、批量布局；S：行更多/长按/滑动及按状态提供归档合同保留 | 批量写入/冲突、删除撤销、滑动长按设备矩阵 U；未隐藏必要操作 |
| GLO01/02/12 | T/V：新默认底栏今天/待办/课表；T：旧配置/自定义保留；V：学习五项、更多/工具、横屏导航、浮层返回、备份提醒推迟/恢复 | 真机安全区/手势/读屏、全部 Drawer/Sheet 消费者及安全告警组合 U |
| 其余 9 个主页面 | 尚未完成本阶段移动专项，不因共用导航/Modal 修改自动算完成 | 下一批 /schedule 课表查课/详情与 /events 日程创建/详情；/course、/exams、/lists、/bills、/review、/together、/projects 排队 |

真实 iOS Safari/PWA 键盘/安全区、OS 大字体、Android、读屏与账号云同步仍 U。短视口/字号 Token 模拟只覆盖所列布局。保留下方 95 个业务功能 ID / 10 个 API ID 的原序与细分边界，不把本批局部 V 改成领域整体通过。

## 电脑端深度优化覆盖（2026-10-11 第 1 批）

本批只完成 /tasks 与 /review 的深度布局；其余主页面不因共享 Token / Sidebar 改动自动算作完成。构建、相关回归和截图证据见 [STATUS.md 第 0B 节](STATUS.md)。V 使用隔离 Chromium 与实际业务数据结构的虚构记录，T 使用实际 Vue 挂载；均不代表云端/实体设备验收。

| 页面 | 本阶段状态 | 实际范围 |
| --- | --- | --- |
| /tasks 待办 | 本批已完成 | 概览/工具区/列表与三视图、高级筛选与辅助入口、长内容/空态；编辑/批量/URL 回归保留 |
| /review 周回顾 | 本批已完成 | 摘要、复盘/下周主次布局、按样本分析与空态、周次/保存/恢复 |
| /、/schedule、/course、/exams、/events、/lists、/bills、/together、/projects | 仍未完成逐页深度优化 | 沿用原台账的 S/T/V/U 边界，下一批再选 2–3 页 |

## 1. 范围与证据口径

| 范围 | 当前扫描结果 | 边界 |
| --- | --- | --- |
| 前端 | `src/` 469 个文件；207 个 Vue SFC，其中业务/壳/页面 114 个、UI 原语 93 个；9 个独立 CSS 文件 | 完整文件枚举、SFC 模板解析、导入关系、状态/事件/浮层定位；重点链路精读。不是每个运行分支都被手工操作 |
| UI 基础 | `src/components/ui/` 21 组、114 个文件；16 个业务文件直接引用 UI 原语 | Vue 3 + Reka UI + shadcn-vue，Tailwind v4；不是 React shadcn/ui；包含审计期间新增的 progress/spinner |
| 服务端与桌面 | Pages middleware 1 个；Supabase 19 个文件（13 个迁移、3 个 SQL 测试、2 个 Edge 文件、1 个配置）；Electron 4 个 CJS 文件、1 个 PWA shim | 静态接口与权限审阅。没有访问真实数据库、账号内容或已安装客户端 |
| 工程 | 26 个脚本、321 个测试/辅助/夹具源码文件、2 个 GitHub workflow，以及根目录配置、公开静态资源 | 初始枚举 835 个，结束索引 843 个上述目录内代码/配置文件；构建产物、依赖与用户数据排除出源码分母 |
| 浏览器 | 11 路由 × 1440×900、390×844、320×844 的空业务数据场景；4 路由 × 3 视口的虚构数据场景，共 45 组 | 同一隔离会话内检查，正常引导、备份提示可能随停留时间出现。Chromium 模拟视口，不等于实体手机 |
| 弹窗/交互 | 手机“更多”、待办/重要日期/日程/清单新建、账本分类，共 6 个表层入口；另复现 3 个待办下拉框，共 9 个探针 | 未把打开弹窗当作完整 CRUD 验收；未执行云端写入 |

标记：**S**＝源码确认；**V**＝本次浏览器观察；**I**＝本次交互探针；**U**＝待后续运行验收。下表“V”只覆盖所列场景；已登录协作、完整导入链、真实通知等仍为 U。源码索引和浮层调用点见文末附录。

## 2. 路由与隐藏页面

路由真源：[routes.js](../../src/router/routes.js)；懒加载真源：[routePreload.js](../../src/router/routePreload.js)。采用 hash history，实际地址形如 `/#/tasks`。

| ID | 路由/入口 | 页面与用途 | 桌面/手机入口 | 本次状态 |
| --- | --- | --- | --- | --- |
| R01 | `/` | `TodayView.vue` 今天工作台 | 今日侧栏；底栏“今天” | S/V；虚构数据 V |
| R02 | `/schedule` | `ScheduleView.vue` 课程表 | 学习侧栏；底栏“学习”；学习导航 | S/V |
| R03 | `/course` | `CourseArchiveView.vue` 课程总览/单课进度 | 学习侧栏；学习导航；手机更多 | S/V；单课详情 U |
| R04 | /tasks | TasksView.vue 待办列表/看板/月历/历史 | 学习侧栏；手机学习导航/更多；桌面去重复导航 | 本批电脑端布局已完成，构建/相关 T/V 通过；完整实体写入异常/云同步 U |
| R05 | `/exams` | `ExamsView.vue` 重要日期/列表/月历 | 学习侧栏；学习导航；手机更多 | S/V/I；虚构数据 V |
| R06 | `/events` | `EventsView.vue` 日程清单/月历 | 日程侧栏；底栏“日程” | S/V/I |
| R07 | `/lists` | `ListsView.vue` 清单与模板 | “其他”折叠组；手机更多 | S/V/I |
| R08 | `/bills` | `LedgerView.vue` 账本/固定账单/月回顾 | “其他”折叠组；手机更多 | S/V/I；账本各分区完整操作 U |
| R09 | /review | WeeklyReviewView.vue 周回顾/复盘/分析 | 其他侧栏；手机学习导航/更多；桌面去重复导航 | 本批电脑端布局已完成，摘要/样本分析/复盘保存与刷新 T/V；真实同步/备份 U |
| R10 | `/together` | `TogetherView.vue` 好友与约时间 | 日程侧栏；手机更多 | S/V 游客态；登录后的全部功能 U |
| R11 | `/projects` | `ProjectsView.vue` 齐行项目协作 | 齐行侧栏；手机更多 | S/V 游客态；项目详情/成员权限/云交互 U |
| R12 | `/today`、`/notes` | 都重定向到 `/`；旧书签兼容 | 旧链接/地址输入 | S；本次未单独浏览器操作 |
| R13 | 未知路由 | `NotFoundView.vue` 返回可用页面 | 非法/过期链接 | S；本次未单独运行 |
| R14 | `/desktop-auth-return/` | 独立 `public/desktop-auth-return/index.html`，桌面账号回调/返回引导 | 邮箱链接、Electron 协议回调 | S/U；不是 Vue 主路由 |
| R15 | 启动异常/安全模式 | `index.html`、`main.js`、`startupGate`、`RouteFallback` 的启动占位、资源失败、重试与安全模式 | 首次启动、资源损坏/离线/分包失败 | S/U；正常启动 V，故障注入未重跑 |

### 页内地址状态与深链

| 页面 | 已确认地址参数/上下文 | 需要保留的行为 |
| --- | --- | --- |
| 全局 | `focus`、`section`；`focusLocation()` 和路由滚动记忆 | 指向实体、处理已删除实体、滚动/高亮后清理临时参数；前进/后退 |
| 今天 | `focusTask`、`focusMinutes`；日程 `focus` + `section=event` | 从任务进入专注；打开指定日程详情 |
| 课程表 | `scheduleFocusRoute.js` 管理实体焦点与日期定位 | 从单课/搜索/任务关系跳到对应课程，不丢周次和课程调整语义 |
| 课程进度 | `courseId`、`focus`、`section` | 总览/单课分支；课程待办、节点和历史活动定位 |
| 待办 | `f`、`sort`、`dir`、`q`、`prio`、`when`、`hist`；`view`、`month`；`new`、`courseId`、`focus` | 真源为 `tasks/taskViewQuery.js`；默认筛选是已安排，智能回退另有规则。不要把业务字段名 `filter/priority/period` 当成 URL 键 |
| 重要日期 | `new`、`courseId`、`focus` | 添加课程节点/聚焦；其他筛选与月历局部状态需逐项检查恢复策略 |
| 日程/清单 | `focus`；日程月份/选中日与清单当前列表为局部状态 | 聚焦与筛选同时存在时仍能到达目标 |
| 账本 | `tab=ledger/bills/review`、`focus`、`section=bill` | 分区双向写 URL，账单与交易深链、返回位置 |
| 齐行 | `project`、`task`、`join` | 项目切换、进入工作台、受控邀请链接；不要记录真实 join token |

## 3. 完整业务功能台账

每行是后续验收单元，行内列出的二级操作都需保留。共享浮层的具体调用位置另登记在附录，不能因为组件复用而漏验某个入口。

| 功能 ID | 功能及二级操作 | 主要代码/数据 | 当前覆盖 |
| --- | --- | --- | --- |
| HOME01 | 问候、日期/周次/校区/作息季、每日文字、签名、节日叙事 | TodayView；appearance/narrative/festiveAtmosphere/timeContext | S/V |
| HOME02 | 首次使用引导、关闭引导、跳转添加课程/待办 | HomeProductivityPanel；本机引导状态 | S/V |
| HOME03 | 下一行动、出发时间、课程/待办/账单/节点优先投影、实体跳转 | home/nextUp；domain/selectors | S/V；时间边界 U |
| HOME04 | 今日课程/日程时间线、日程详情、现在该做/需要注意的处理动作 | TodayAgenda、TodayActionList；课程/任务/事件/账单/节点 | S/V |
| HOME05 | 学习建议时段、长任务分段、学习日程创建、近期复习任务 | StudyPlanner、learningPlan、studyBlockSuggestions | S/V；创建完整链 U |
| HOME06 | 课程课后反馈、本周进展、收支摘要、心情及备注 | experience、mood、weeklySelectors、ledgerFx | S/V；反馈写入 U |
| HOME07 | 回放、专注入口、首页模块显隐/排序的投影 | MemoryView、FocusPanel、homeModules | S/V；回放/重排 U |
| SCH01 | 单日/整周、上一周/下一周、日期跳转、今天、键盘网格 | ScheduleGrid、useScheduleGrid；timeConfig/semester | S/V；日历跳转完整键盘 U |
| SCH02 | 课程搜索（全学期）、当前/历史、统计、单课定位 | ScheduleView；scheduleFocusRoute | S/V |
| SCH03 | 课程添加/编辑/归档/恢复/删除；从课程记录作业、复习或专注 | CourseEditorModal；scheduleCourseForm、courseLinks | S；完整 CRUD U |
| SCH04 | 批量管理、选择/删除课程、模板保存/导入/删除 | CourseManagerModal；scheduleCourseManager/courseTemplates | S/U |
| SCH05 | 批量文本与 Excel 导入、解析预览、编辑结果、确认、撤销、替换整表 | BatchImportModal；courseImport、excelTimetableParser、scheduleImportReview | S/U |
| SCH06 | 图片/相机/OCR、裁剪、进度/取消、识别词汇、结果校正、重复/冲突处理 | ImageCropModal、ImportConflictModal；ocrService/Pipeline、scheduleOcr*、ocrVocabulary | S/U；真实照片/相机未测 |
| SCH07 | 课程调整：取消/补课及对应日期、冲突/撤销 | ExceptionsModal；schedule exceptions、schedule.js | S/U |
| SCH08 | 学期起始日、校区/作息季、自动季节、节次与每日时间、导入/生成作息、未保存修改保护 | SemesterModal、TimeSettingsModal、TimeBaseSettings、TimeGeneratePanel、TimeImportPlanModal、RecognitionSchemeDetailModal；timePlan* | S/U |
| SCH09 | 课表设置、经典/笔记/极简外观、课表备注 | ScheduleView、ScheduleNote；appearance、sl_schedule_note | S/V 表层；各皮肤 U |
| SCH10 | 折叠学习安排、课程任务徽记与跨页面联动 | StudyPlanner、courseLinks；学习计划事件 | S/V 表层 |
| CRS01 | 课程总览、在学/待推进/归档、搜索和汇总 | CourseArchiveView、courseProgress | S/V 空态 |
| CRS02 | 单课详情、关联任务列表、任务工作会话 | CourseTaskItem、TaskWorkSession；courseId 关系 | S/U |
| CRS03 | 关联重要日期/日程、展开全部节点、添加课程待办 | CourseArchiveView、courseLinks | S/U |
| CRS04 | 课程历史活动、按类型过滤/展开、专注与课后反馈 | CourseActivityItem、courseProgress | S/U |
| TSK01 | 列表/看板/月历、月份/日期选择、历史；三个视图共享实体操作 | TaskBoard、TaskCalendar、TasksView、taskViews | 本批三视图/归档 V；Reka 键盘切换及必选状态 T/V；月份/日期与实体写动作完整矩阵 U |
| TSK02 | 搜索、优先级/日期范围/状态筛选、排序/方向、概览快捷筛选、URL 状态 | taskViewQuery、useTaskViewQuery；TasksView | A01/A22/A23 回归保留；本批真实搜索/select/query/筛选清除/布局 T/V；各平台历史与缓存刷新完整矩阵 U |
| TSK03 | 添加/编辑/删除、课程/类别、优先级、备注、截止日期/时间 | useTaskEditor、domain/commands | S/I 打开表单；提交 U |
| TSK04 | 起止时间、多阶段、阶段动作、日期平移、改期、时间冲突确认/撤销 | TaskTimeEditor/Shift、TaskStageAction、TaskRescheduleDialog；taskTime* | S/U |
| TSK05 | 重复规则/结束日、预估/实际分钟、提醒设置 | useTaskEditor、taskRecurrence、reminderScheduler | S/U |
| TSK06 | 开始/继续工作、进度/卡点/下一步/资源、保存工作断点、进入专注 | TaskWorkSession、TaskWorkCheckpointFields、useTaskWorkSession | S/U |
| TSK07 | 完成/恢复、归档/恢复、行更多菜单/长按/左右滑动 | TaskRowActions、SwipeActionItem、useTaskRowActions | S/V 表层；动作 U |
| TSK08 | 多选/全选、完成/归档/删除、批量改期、冲突与整事项完成确认 | TaskBulkBar、TaskBulkRescheduleDialog、useTaskBulkActions/Selection | S/U；当前仅列表提供批量入口 |
| TSK09 | 粘贴通知、理解草稿、去重、逐项修正/选中保存、一键整理 | NoticePaste → NoticeUnderstanding；noticeParser/Segments、smartClassify | S/U |
| TSK10 | 齐行任务桥接、打开项目工作台、关联重要日期/课程、深链新建/聚焦 | projectTaskBridge、useTaskRouteFocus、courseLinks | S/U；多账号桥接 U |
| MILE01 | 重要日期列表/月历、搜索/范围/排序/类型、历史/已结束/置顶 | ExamsView、planningViews；sl_exams | S/V |
| MILE02 | 添加/编辑/删除、名称/日期/具体时间/地点/备注/提醒、每年重复 | ExamsView 表单；domain、countdown、anniversarySchedule | S/I 打开；写入/提醒 U |
| MILE03 | 置顶/取消置顶、归档/恢复、行菜单/右键菜单 | ExamsView、ContextMenu | S/V 表层；菜单动作 U |
| MILE04 | 月份/日期选择、选中日期事项、添加到该日、时间线进度 | Calendar、exams.css、planningViews | S/U |
| MILE05 | 关联课程、复习完成度、创建/继续 25 分钟复习、相关待办 | TaskFocusLink、learningPlan/courseLinks | S/V 表层；联动写入 U |
| EVT01 | 日程清单/月历、月份/日期、当前/归档、统计/搜索/范围 | EventsView、EventCalendar、eventPlanning | S/V |
| EVT02 | 新建/编辑/复制、待安排/全天/起止时间/快捷时长、地点/课程/备注/提醒 | useEventEditor、TimeWheelSheet、eventFields | S/I 打开；提交 U |
| EVT03 | 详情、归档/恢复/删除、时间冲突及继续保存确认 | EventsView、eventConflicts | S/I 表层；动作 U |
| EVT04 | ICS 导入预览、CSV 导入、选择记录/校验/确认、ICS 导出 | IcsImportButton、DomainCsvImportButton；icalImport/domainCsvImport/eventCalendarExport | S/U |
| EVT05 | 社交共同日历显示、齐行会议的来源/项目跳转 | SocialCalendarEvents、projectMeetingBridge | S/U（已登录） |
| EVT06 | 浏览器通知授权、提醒去重、无时间提醒口径 | reminderScheduler、settingsPolicy | S/U（系统权限） |
| LST01 | 清单检索/选择、空白/采购/出行/返校/整理模板、类型 | ListsView、checklists/domain/checklistModel | S/V/I 打开新建 |
| LST02 | 新建/编辑/复制/删除清单；重置勾选再次使用；导出文本 | ListsView、useShareText | S/U |
| LST03 | 快速添加/详细添加/编辑/删除事项、分组/数量等字段 | ListsView、Modal、domain/checklistModel | S/U |
| LST04 | 批量文本解析/预览/添加 | ListsView bulk form；checklists | S/U |
| LST05 | 勾选/恢复、完成度、搜索/状态/分组筛选、清除已完成 | ListsView、VirtualList、SwipeActionItem | S/U |
| LST06 | 多选、批量完成/恢复/删除、触摸滑动与动作确认 | ListsView、checklists | S/U |
| LED01 | 账本/固定账单/回顾分区；今日/周/月个人花费、预算、常记与近期记录 | LedgerView、LedgerHomePanel、LedgerBudgetCard；ledgerView/* | S/V |
| LED02 | 记一笔/编辑、支出/收入、分类/账户/币种/日期、连续记、一句话入口 | QuickEntryModal、useQuickEntryForm、quickRecord | S/U |
| LED03 | 交易详情、同名批量分类、备注、退款登记/关联原交易、个人分摊、归档/删除 | TransactionDetailModal、useTransactionDetail、ledgerRelations/Split | S/U |
| LED04 | CSV 文件导入、字段映射/预览/选中/分页/错误/去重/确认、撤销 | TransactionImportDialog、ledgerBillImport | S/U |
| LED05 | 交易查询、时间/类型/分类/账户等筛选、展开全部、滑动操作、筛选结果导出 CSV | LedgerHomePanel、feed/export、ledgerSwipe | S/V 表层；完整筛选/导出 U |
| LED06 | 固定账单新建/编辑/模板、频率/账户/提醒、已支付/跳过/暂停/恢复/删除 | BillsPanel、BillFormModal、ledgerView/bills、ledgerTemplates | S/U |
| LED07 | 基准币种/手动汇率、缺汇率提示、月预算设置/清除/超额反馈 | FxSettingsModal、BudgetSettingsModal、useLedgerFxBudget | S/V 空态；提交 U |
| LED08 | 支出/收入分类、常用/全部/隐藏/自定义、顺序/图标/改名/隐藏/删除及关系迁移 | LedgerView 分类管理、PromptDialog、useLedgerCategoryManager | S/I 表层；修改 U |
| LED09 | 月回顾、分类分布/展开/明细、月历点迹/选中日、多月趋势/范围/历史翻页、CSV/Excel/全部导出 | ReviewPanel、MonthlyTrendCard、reviewCharts、ledgerView/review/export | S/U |
| REV01 | 上/下周、本周、时间范围、跨域完成/课程/专注/财务/心情摘要 | WeeklyReviewView、domain/weeklySelectors | 本批紧凑摘要及周次 T/V；保留多币种缺汇率说明，金额异常完整矩阵 U |
| REV02 | 下一周任务/日程/重要日期/账单及实体跳转 | WeeklyReviewView；weeklySelectors、focusLocation | 本批主次工作区/有任务日程/空态 V；四来源入口保留，完整实体跳转 U |
| REV03 | 每周复盘三字段、自动/手动保存、切周恢复、同步/备份 | weeklyReflections；sl_weekly_reflections | 本批 Field 名称/说明、自动保存/重建、切周独立草稿 T；Chromium 自动保存/真实刷新 V；真实同步/备份/存储失败 U |
| REV04 | 16 周完成节奏、完成率/逾期、专注时段、心情与专注图表 | reviewCharts、WeeklyReviewView | 本批样本条件/空图不绘制/分析入口 T/V；既有图表选择器回归通过；全边界统计 U |
| REV05 | 周回顾与账本月回顾的范围/金额口径区别 | weeklySelectors、ledgerView/review、ledgerFx/Split | S；多币种/退款统计 U |
| TOG01 | 登录/验证邮箱/服务失败/缺资料引导，资料姓名、学校/时区/空闲偏好 | TogetherView、accountAuth、social profiles | S/V 游客；登录分支 U |
| TOG02 | 邮箱精确查找、好友请求发送/接收/拒绝/撤回、好友移除确认 | TogetherView、social service/Edge | S/U |
| TOG03 | 好友选择、7/14/30 天共同时间、时长筛选、unknown/无结果/扩大范围/重试 | TogetherView、availability.js、账号课表快照 | S/U |
| TOG04 | 选择时段、编辑具体起止/内容/地点/类型、核对并发送邀约 | TogetherView、socialRequest、availability | S/U |
| TOG05 | 邀约分类、接受/拒绝/改约/接受或拒绝改约/取消确认 | TogetherView、social_dispatch | S/U |
| TOG06 | 通知读取/全部已读、实时订阅、账号切换/页面退出清理 | subscribeSocialNotifications、collaborationContext | S/U |
| TOG07 | 共享日历同步到今天/日程；仅共享空闲结果 | SocialCalendarEvents、calendar_has_overlap | S/U |
| PRO01 | 我的项目/收件箱、创建/编辑/归档/恢复/删除、选择项目、项目模板类型 | ProjectsView、services/projects、project_dispatch | S/V 游客；业务 U |
| PRO02 | 任务创建/编辑/指派/接受/拒绝、优先级/截止、父子任务/依赖/里程碑 | ProjectsView、useProjectTaskActions、projectTaskSelectors | S/U |
| PRO03 | 任务状态开始/继续/待验收/完成、逐任务并发保护、工作台/检查点/资源/进展记录 | TaskWorkSession、ProjectTaskWorkProgress、useProjectTaskWorkbench/Checkpoints | S/U |
| PRO04 | 个人待办桥接与排队/重试、项目/账号切换隔离 | projectTaskBridge、projectRequestScope、collaborationContext | S/U |
| PRO05 | 里程碑创建/修改/完成/删除；交付检查项新增/修改/勾选/证据/删除 | ProjectsView、project_dispatch、revision | S/U |
| PRO06 | 六个分区：任务/协商/成果/团队时间/成员/动态；项目摘要快捷筛选、任务检索/状态/负责人过滤 | ProjectsView、ProjectTaskOverview | S/U |
| PRO07 | 延期/求助/工作量/重分配等任务协商申请、批准/拒绝/撤回 | useProjectTaskActions、adjustment requests | S/U |
| PRO08 | 交付项创建、成果正文/链接/文件、草稿保存/恢复、正式提交版本、验收/退回/重新提交/检查清单 | useProjectDeliverableEditor、ProjectDraftRecovery、Storage、draft/result/review tables | S/U |
| PRO09 | 好友邀请、受控链接创建/复制/停用/加入、等待接受邀请、成员角色/移除/退出/负责人转交 | ProjectsView、project_dispatch、join deep link | S/U |
| PRO10 | 团队共同空闲、讨论邀请、接受/拒绝/改期/采用建议/确认/取消、个人日历桥接 | useProjectMeetings、projectMeetingBridge、Edge availability | S/U |
| PRO11 | 项目动态、任务事件、归档只读分支、无权限/陈旧 revision/冲突/重试 | ProjectsView、projectEditorScope、SQL guards | S/U |

## 4. 全局工具、设置及平台功能

| 功能 ID | 功能及隐藏入口 | 真源与范围 | 当前覆盖 |
| --- | --- | --- | --- |
| GLO01 | 桌面分组/折叠/快捷键；手机底栏/更多抽屉；侧栏工具与搜索；焦点/返回 | Sidebar、navigation registry/ViewModel/Preferences、App | S/V/I 更多；自定义导航 U |
| GLO02 | 编辑导航：桌面组名/增删/移动/选择页面、手机 3 个自选入口、预览、保存/放弃/移除组 | NavigationSettings、navigationEditor/FeaturePicker/Preview | S/U；另固定“快速记录”和“更多” |
| GLO03 | 全局搜索、分类/相关度/结果跳转、键盘快捷入口 | SearchPanel、globalSearch/searchRelevance/usePageShortcuts | S/U；显示入口 V |
| GLO04 | 快速记录：7 类快捷入口、文字/剪贴板/语音、自动理解、多条草稿修正/选中保存、去重/冲突、最近记录复用、撤销/查看 | QuickRecordPanel、useQuickRecordPanel、quickRecord/* | S/U；本机/会话草稿，语音依能力显示 |
| GLO05 | 账号登录/注册/验证码或邮箱链接/找回、密码修改、邮箱验证重发、当前/全部设备退出；当前密码验证 | AccountPanel、AccountPasswordForm、AccountSessionActions、accountAuth/services/supabase | S/U；真实 SMTP/会话未操作 |
| GLO06 | 账号同步开关、同步状态/重试、首次本机数据归属/合并、冲突本机/云端选择、账号切换/退出清理 | AccountSyncPanel、accountSyncEngine/Identity/Lifecycle/Schema/LocalData/LogoutCleanup | S/U；保留 revision 与实体合并协议 |
| GLO07 | 本机数据清点/空间占用、完整备份、可选壁纸、JSON 恢复预览/范围选择/确认、恢复点/撤销 | DataManager、data/*、backupArchive/Restore、dataVault | S/U；只检查代码与字段，未读取真实导出 |
| GLO08 | 外观六分区：主题与课表/本地壁纸/今天页文字/首页布局/滑动/导航；主题、自定义颜色/壁纸提色、性能/高对比度、上传/拍照/裁剪/删除/恢复、排序显隐 | AppearanceSettings、AppearanceSwipeSettings、SwipeActionSelector、theme/appearance/wallpaperStorage | S/U；壁纸二进制本机保存 |
| GLO09 | 氛围与纪念日：开启、生日/安装日、公历自定义纪念日、农历纪念日/闰月/编辑删除、近期对照表、叙事语言 | FestiveSettings、festive/lunarAnniversaries/Editor/anniversarySchedule/narrativeLanguages | S/U |
| GLO10 | 专注：目标/待办选择、自定义时间、开始/暂停/恢复/提前结束、休息/轮次、完成反馈、返回工作台；时长/音效/振动/系统通知设置 | FocusPanel/Settings/Return、focusTimer/Navigation/SettingsEditor | S/V 表层；计时/系统权限 U |
| GLO11 | 快速记录设置中隐藏的全局时区、默认记账账户、待办/日程/重要日期默认提醒、剪贴板提示 | QuickRecordSettings、settingsPolicy | S/U；不是仅快速记录自己的配置 |
| GLO12 | 后台任务详情/进度/取消、Toast/撤销/重试、全局错误/持久化失败/同步冲突/备份提醒 | TaskCenter/Progress、ActionButton/Feedback、Toast、globalError/overlayStack/floatingStack | S/V 部分告警；异常分支 U |
| GLO13 | 版本与更新、检查/下载/取消/安装、更新历史/单次更新说明；更新阶段/重试/缓存恢复/运行版本验证/诊断复制 | VersionUpdateModal、AppUpdateSection、ReleaseNotesBrowser、UpdateNotes、appUpdate/desktopAppUpdate、webUpdateController/updateProtocol/updatePresentation | S/U；审计期间更新模块在并行改造，增量竞态测试 5 项最终通过；真实更新未执行 |
| GLO14 | PWA 安装/离线/缓存更新、受控启动恢复、懒加载失败兜底、低性能/减少动效 | vite PWA、startupGate/pwaStartupRecovery、routePreload/performanceMode/motion | S；构建成功；离线故障/跨版本 U |
| GLO15 | Electron 独立协议/预加载桥、账户回调、签名更新、安装数据/缓存/备份路径 | desktop-app/main/preload/updaterController/cachePaths、desktop shim | S/U；未启动真实客户端或安装 |

### 已退役/无活动入口的能力

- 独立笔记页 `/notes` 兼容跳到首页；`sl_archived_quick_notes` 只作历史保留。旧饮食/快递键由 `retiredData`、`foodRetirement`、`retireLegacySyncState` 管理，不能当垃圾数据删除。
- `/api/auth/verify` 和 `/api/sync/*` 返回 410，设备码/同步空间已退役。`sync-coordinator/` 当前只有 `.wrangler` 缓存，没有活动业务源码。
- `QuickCapturePanel.vue`、`QuickLedgerPanel.vue` 没有当前 `src/` 导入入口；列为删除候选 A17。`NoticePaste.vue` 是仍被调用的兼容封装，保留。

## 5. 状态管理与数据流

当前没有 Pinia/Vuex。主要是模块级 Vue ref/computed + `useStoredRef`，页面局部 ref 管草稿/选择，URL 管部分工作区状态，协作使用 scoped context 和服务端数据。

```text
启动：main → 本机安全副本恢复/退役归档 → 领域迁移 → App/router → 可选账号/提醒/桥接
个人操作：页面/表单 → composable/领域 command → stored ref → localStorage
                                                   ├→ IndexedDB 镜像与恢复点
                                                   └→ dirty/mutation 事件 → 账号同步/合并/revision RPC
快速记录/导入：输入 → parser → 预览草稿 → 用户确认 → 领域 command → 同上
协作：页面 scoped state → social/project service → 经核对的 JWT → campus-social
        → 验证用户/输入/邮箱与成员权限 → SQL dispatch/guards → 云表/私有 Storage
        → 个人任务/会议桥接 → 本机领域数据（云项目与个人快照不是同一份数据）
```

| 数据域 | 状态/存储键族 | 持久化、同步与边界 |
| --- | --- | --- |
| 课程/作息 | `sl_courses`、`sl_course_templates`、`sl_timecfg`、`sl_semester`、`sl_schedule_exceptions`、`sl_schedule_note`、`sl_course_checkins`、`sl_ocr_vocabulary` | 领域/课表命令；localStorage + vault；个人账号同步/备份 |
| 待办/日程/日期 | `sl_tasks`、`sl_events`、`sl_exams`、`sl_countdown_show_past`、`sl_checklists` | 高增长集合显式提交；软删除/tombstone、归档、重复实例与跨域关系 |
| 财务 | `sl_expenses`、`sl_bills`、`sl_ledger_categories`、`sl_ledger_freq`、`sl_ledger_fx`、`sl_ledger_budget`、`sl_ledger_templates` | 金额、退款/分摊/汇率选择器；导入与恢复不能改为直接写数组 |
| 专注/心情/回顾 | `sl_focus_sessions`、`sl_focus_settings`、`sl_focus_active`、`sl_mood_log`、`sl_weekly_reflections` | 活动计时本机状态与完成记录分开；周复盘已接入同步/备份 |
| 设置/导航/提醒 | `sl_quick_record_settings`、`sl_capture_enabled`、主题/appearance/navigation/festive/language/performance 键、`sl_reminder_log` | 设置包含全局时间与提醒策略；默认值有多真源问题 A19 |
| 图片/草稿/设备 | wallpaper IndexedDB Blob、local vault、quickRecord session draft、项目恢复草稿、device/sync 元数据、登录 session | 不应全部云同步；图片/备份选择属于本机。账号 session 不作为普通个人记录导出 |
| 云账号快照 | `account_sync_snapshots` | 用户所有权 + revision 条件写；42 个个人同步键真源为 `syncKeys.js` |
| 云协作 | 6 张 social 表、私有 rate bucket；15 张 team project 表 | 独立 SQL 模型、成员权限、revision/项目锁、Realtime 和私有文件桶；不包含在本机个人完整备份 |

备份有 44 个命名字段，真源 `BACKUP_STORAGE_KEYS`；同步有 42 个键，真源 `SYNC_DEFAULTS`。两者不同是范围设计，不能把数量差异直接判为丢数据。高增长集合的 13 个显式提交键见 `store/core.js` 的 `EXPLICIT_COMMIT_KEY_LIST`；新写路径必须使用对应 command/touch 机制。

## 6. API、权限与平台边界

| 接口 ID | 接口/传输 | 消费方与授权边界 | 本次结论 |
| --- | --- | --- | --- |
| API01 | Supabase Auth（登录/注册/邮箱/找回/密码/退出） | AccountPanel/accountAuth；公开 publishable/anon 配置；server secret 禁止客户端配置 | S，真实邮箱/回调 U |
| API02 | `account_sync_snapshots` 查询、`write_account_sync_snapshot` RPC | pull/probe/push；绑定当前账号 JWT，数据库 `auth.uid()` 决定归属，revision 冲突 | S；真实双设备冲突 U |
| API03 | `POST /functions/v1/campus-social` `{ action, payload }` | socialRequest/projectRequest；63 个动作（见附录）。32 KiB 请求体上限；Edge `getUser(token)`，协作动作要求验证邮箱 | S；真实部署/所有动作 U |
| API04 | `social_dispatch`、`project_dispatch`、project task checkpoint RPC | Edge 服务身份；SQL 校验参与者/项目成员/角色/依赖/revision/事务锁 | S；service-only EXECUTE 的 revoke/grant 已存在，不能因 SECURITY DEFINER 字样直接判漏洞 |
| API05 | `social_notifications` postgres_changes Realtime | 按 recipient 订阅；离开/换账号清理 channel | S；真实 WebSocket/RLS U |
| API06 | `qixing-deliverables` 私有 Storage upload / signed URL | 成员上传成果；客户端 20 MiB 限制，下载签名 URL 60 秒；路径/对象所有权由存储策略决定 | S；真实桶/MIME/拒绝路径 U |
| API07 | `version.txt`/PWA 资源、Electron 更新服务 | appUpdate/desktopAppUpdate；Web 和桌面更新策略独立 | S；真实更新链 U |
| API08 | `/api/auth/verify`、`/api/sync/*` | Pages `_middleware` 的退役兼容返回 410 | S；不得作为仍工作的同步接口规划 |
| API09 | `window.studyLifeDesktop` IPC | preload 暴露更新状态/检查/下载/取消/安装等窄桥；主进程校验 sender，contextIsolation=true、nodeIntegration=false、sandbox=true | S；安装/更新运行 U |
| API10 | 本机浏览器能力 | 相机/文件、剪贴板、语音、通知、分享、音频/振动、IndexedDB | 都需按能力/权限提供退化；实体设备 U |

| 用户/角色 | 可以到达的页面与动作 | 必须验证的拒绝路径 |
| --- | --- | --- |
| 游客/离线本机 | 全部个人功能；一起约/齐行显示登录引导 | 不得以路由全局鉴权挡住本机功能；协作服务拒绝未登录 |
| 已登录未验证邮箱 | 个人同步与账号功能、社交资料准备（以实际服务规则为准） | 好友/共同空闲/项目协作不能仅凭前端显示放行 |
| 已验证好友 | 好友相关邀约、自己的通知、双方共同空闲 | 陌生人、已移除好友、其他用户通知、个人课表内容不可读取 |
| 项目成员/任务受派者 | 成员范围内项目；接受分工、自己的工作进度/成果等 | 跨项目 ID、已退出成员、未接受分工、归档项目、过期 revision |
| 管理员/负责人/验收者 | 管理任务/成员/里程碑；指定验收者验收；负责人转交等 | 角色升级、负责人专属动作、非验收者提交决定、跨项目文件 |

本次没有确认可利用的越权/密钥泄露问题，也没有据此证明线上安全。已审阅本地 RLS、grants、Edge 用户验证与桌面隔离；实际部署一致性和拒绝矩阵列入 STATUS。未读取 `.env.local` 内容、浏览器个人档案、数据库/备份/真实记录；未进行公开发布或历史清密操作。

## 7. 后续逐项验收规则

每个功能 ID 都需填：入口可达、正常流程、加载/空/筛选无结果/错误/离线、保存/取消/重试/撤销、权限、键盘焦点、手机 320/390 与横屏、主题、刷新/返回、持久化/同步结果、实际证据。当前静态登记 S 不自动转成“通过”。共用 Modal/按钮通过也不自动证明每个调用方通过。

第 1 批已覆盖 A01/A22/A23 的限定范围。后续功能可靠性批次按 STATUS 第 0 节的创建/编辑/删除与持久化任务继续；A02 和视觉/架构项保留在相应阶段。新增表单、弹窗、API 动作或路由必须同时补 ID 和验收条件；退役时保留旧入口/数据处置记录。

### 2026-10-11 第 1 批增量覆盖（3 个问题）

| 操作 | 实际证据 | 状态/边界 |
| --- | --- | --- |
| 排序/优先级/范围控件，搜索/清除、排序方向、组合筛选 | 新增 `tests/taskViewQueryInteractions.test.js`：实际 TasksView、领域虚构记录、select/input/click，断言实体 ID、顺序、数量和 URL | T；组合筛选用例同时断言业务记录内容不变 |
| 列表 → 看板 → 月历及清除筛选 | 同上，真实页面/视图组件切换与查询数量 | T；不代替三个视图的创建/编辑/删除/阶段矩阵 |
| 连续操作/守卫延迟/旧失败/外部导航/前进后退/失败回滚与提示 | 新增 `tests/useTaskViewQuery.test.js`：真实 Vue Router，无 mock replace；页面另断言 role=alert 及重试成功 | T；网络/账号/双设备竞态 U |
| 显式“已安排”/干净地址智能默认、搜索恢复 | 销毁页面与路由后按保存的 URL 重建；hook 用例检查前进后退 | T；本轮未验 IndexedDB 配额/真实 PWA 缓存 |
| 创建/编辑/保存/删除/批量写及登录权限/数据库 | 本批未做新的完整写入或云端验收；原有局部回归仅按 STATUS 记实际结果 | U 保留；下一批任务已登记 |

本批增量源码索引仅登记上述两个新增测试文件；三个业务文件入口仍为 `src/views/TasksView.vue`、`src/composables/tasks/{taskViewQuery,useTaskViewQuery}.js`。历史完整索引中的行数与哈希不自动变成本轮快照。

<!-- BEGIN_RUNTIME_APPENDIX -->

## 8. 浮层与隐藏调用点索引

以下是模板 AST 中的调用点，包含封装内部的 Modal 和调用方，数量不代表独立弹窗数量。业务功能 ID 仍以第 3、4 节为准；F 编号用于本次定位。动态标题、确认对象、open 条件必须分别验收。通用 UI 原语的内部结构在源码索引中登记，不当作新的业务功能。

登记 156 个组件调用点；另有 4 个自定义 HTML 浮层根。旧 QuickCapture/QuickLedger 封装的调用点同时保留，但没有活动入口。

| 定位 ID | 调用位置 | 组件 | 标题/开启条件/关闭行为 |
| --- | --- | --- | --- |
| F001 | [src/App.vue:519](../../src/App.vue#L519) | UpdateNotes | if:=showReleaseNotes；bind:open=showReleaseNotes；on:close=showReleaseNotes = false |
| F002 | [src/App.vue:520](../../src/App.vue#L520) | QuickRecordPanel | if:=quickRecordMounted；bind:open=showQuickRecord；on:close=closeQuickRecord |
| F003 | [src/components/account/AccountSessionActions.vue:35](../../src/components/account/AccountSessionActions.vue#L35) | ConfirmDialog | if:=scope；bind:open=Boolean(scope)；bind:title=scope === 'global' ? '退出所有设备？' : '退出当前设备？'；on:close=scope = '' |
| F004 | [src/components/AccountPanel.vue:243](../../src/components/AccountPanel.vue#L243) | Modal | bind:open=props.open；title=我的账号；on:close=close |
| F005 | [src/components/AccountPanel.vue:355](../../src/components/AccountPanel.vue#L355) | DataManager | if:=backupOpen；bind:open=backupOpen；on:close=backupOpen = false |
| F006 | [src/components/AppearanceSettings.vue:333](../../src/components/AppearanceSettings.vue#L333) | Modal | bind:open=open；title=🎨 个性化外观；on:close=emit('close') |
| F007 | [src/components/AppearanceSettings.vue:448](../../src/components/AppearanceSettings.vue#L448) | ActionSheet | bind:open=showImageSheet；title=更换壁纸；on:close=showImageSheet = false |
| F008 | [src/components/AppearanceSettings.vue:460](../../src/components/AppearanceSettings.vue#L460) | ConfirmDialog | if:=removeImageTarget；bind:open=Boolean(removeImageTarget)；title=删除壁纸；on:close=removeImageTarget = null |
| F009 | [src/components/AppearanceSettings.vue:470](../../src/components/AppearanceSettings.vue#L470) | ConfirmDialog | if:=resetWallpapersTarget；bind:open=resetWallpapersTarget；title=恢复全部壁纸；on:close=resetWallpapersTarget = false |
| F010 | [src/components/AppearanceSettings.vue:480](../../src/components/AppearanceSettings.vue#L480) | ConfirmDialog | if:=resetAppearanceTarget；bind:open=resetAppearanceTarget；title=恢复初始外观；on:close=resetAppearanceTarget = false |
| F011 | [src/components/ConfirmDialog.vue:41](../../src/components/ConfirmDialog.vue#L41) | Modal | bind:open=open；bind:title=title；on:close=$emit('close') |
| F012 | [src/components/data/AppUpdateSection.vue:185](../../src/components/data/AppUpdateSection.vue#L185) | ReleaseNotesBrowser | if:=notesOpen；bind:open=notesOpen；on:close=notesOpen = false |
| F013 | [src/components/DataManager.vue:127](../../src/components/DataManager.vue#L127) | Modal | bind:open=open；title=数据管理；on:close=closeDataManager |
| F014 | [src/components/DataManager.vue:196](../../src/components/DataManager.vue#L196) | ConfirmDialog | if:=restoreBackupTarget；bind:open=Boolean(restoreBackupTarget)；title=从备份恢复；on:close=restoreBackupTarget = null |
| F015 | [src/components/DataManager.vue:205](../../src/components/DataManager.vue#L205) | ConfirmDialog | if:=showCheckpointConfirm && restoreCheckpoint；bind:open=showCheckpointConfirm；title=恢复本机恢复点；on:close=showCheckpointConfirm = false |
| F016 | [src/components/DomainCsvImportButton.vue:90](../../src/components/DomainCsvImportButton.vue#L90) | Modal | bind:open=open；bind:title=copy.title；on:close=open = false |
| F017 | [src/components/FestiveSettings.vue:207](../../src/components/FestiveSettings.vue#L207) | Modal | bind:open=open；title=节日与纪念日设置；on:close=emit('close') |
| F018 | [src/components/FocusPanel.vue:607](../../src/components/FocusPanel.vue#L607) | TaskWorkSession | bind:open=Boolean(workSessionTask)；on:close=closeTaskWorkSession |
| F019 | [src/components/FocusPanel.vue:611](../../src/components/FocusPanel.vue#L611) | Modal | bind:open=showTodoPicker；title=从待办选择；on:close=showTodoPicker = false |
| F020 | [src/components/FocusPanel.vue:621](../../src/components/FocusPanel.vue#L621) | Modal | bind:open=showCustomTime；title=自定义专注时间；on:close=showCustomTime = false |
| F021 | [src/components/FocusPanel.vue:634](../../src/components/FocusPanel.vue#L634) | Modal | bind:open=showEarly；title=提前结束；on:close=showEarly = false |
| F022 | [src/components/FocusSettings.vue:71](../../src/components/FocusSettings.vue#L71) | Modal | bind:open=open；title=⏱ 专注设置；on:close=emit('close') |
| F023 | [src/components/IcsImportButton.vue:82](../../src/components/IcsImportButton.vue#L82) | Modal | bind:open=Boolean(preview)；title=预览日历导入；on:close=closePreview |
| F024 | [src/components/MemoryView.vue:145](../../src/components/MemoryView.vue#L145) | Modal | bind:open=open；title=📖 回放；on:close=emit('close') |
| F025 | [src/components/NavigationSettings.vue:213](../../src/components/NavigationSettings.vue#L213) | Modal | bind:open=open；title=编辑导航；on:close=requestClose() |
| F026 | [src/components/NavigationSettings.vue:284](../../src/components/NavigationSettings.vue#L284) | Modal | if:=pendingDeparture；bind:open=true；title=保存导航修改？；on:close=!saving && (pendingDeparture = null) |
| F027 | [src/components/NavigationSettings.vue:290](../../src/components/NavigationSettings.vue#L290) | Modal | if:=pendingGroupRemoval；bind:open=true；title=移除分组；on:close=pendingGroupRemoval = null |
| F028 | [src/components/NoticePaste.vue:10](../../src/components/NoticePaste.vue#L10) | NoticeUnderstanding | if:=open；bind:open=open；on:close=emit('close') |
| F029 | [src/components/NoticeUnderstanding.vue:441](../../src/components/NoticeUnderstanding.vue#L441) | Modal | bind:open=open；title=📋 通知理解；on:close=emit('close') |
| F030 | [src/components/PromptDialog.vue:76](../../src/components/PromptDialog.vue#L76) | Modal | bind:open=open；bind:title=title；on:close=$emit('close') |
| F031 | [src/components/QuickCapturePanel.vue:14](../../src/components/QuickCapturePanel.vue#L14) | QuickRecordPanel | bind:open=open；on:close=emit('close') |
| F032 | [src/components/QuickLedgerPanel.vue:14](../../src/components/QuickLedgerPanel.vue#L14) | QuickRecordPanel | bind:open=open；on:close=emit('close') |
| F033 | [src/components/QuickRecordPanel.vue:85](../../src/components/QuickRecordPanel.vue#L85) | Modal | bind:open=open；title=⚡ 快速记录；on:close=requestClose |
| F034 | [src/components/QuickRecordSettings.vue:22](../../src/components/QuickRecordSettings.vue#L22) | Modal | bind:open=open；title=⚡ 快速记录设置；on:close=emit('close') |
| F035 | [src/components/ReleaseNotesBrowser.vue:33](../../src/components/ReleaseNotesBrowser.vue#L33) | Modal | bind:open=open；title=更新说明；on:close=emit('close') |
| F036 | [src/components/schedule/BatchImportModal.vue:230](../../src/components/schedule/BatchImportModal.vue#L230) | Modal | if:=show；bind:open=show；title=批量录入课程；on:close=emit('close') |
| F037 | [src/components/schedule/CourseEditorModal.vue:144](../../src/components/schedule/CourseEditorModal.vue#L144) | Modal | bind:open=open；bind:title=editingId ? '编辑课程' : '添加课程'；on:close=emit('close') |
| F038 | [src/components/schedule/CourseManagerModal.vue:55](../../src/components/schedule/CourseManagerModal.vue#L55) | Modal | bind:open=open；title=课程批量管理；on:close=emit('close') |
| F039 | [src/components/schedule/ExceptionsModal.vue:382](../../src/components/schedule/ExceptionsModal.vue#L382) | Modal | if:=show；bind:open=show；title=🗓 课程调整；on:close=emit('close') |
| F040 | [src/components/schedule/ImageCropModal.vue:146](../../src/components/schedule/ImageCropModal.vue#L146) | Modal | bind:open=show；title=框选课表区域；on:close=emit('close') |
| F041 | [src/components/schedule/ImportConflictModal.vue:76](../../src/components/schedule/ImportConflictModal.vue#L76) | Modal | if:=show；bind:open=show；title=课程导入冲突处理；on:close=emit('close') |
| F042 | [src/components/schedule/RecognitionSchemeDetailModal.vue:39](../../src/components/schedule/RecognitionSchemeDetailModal.vue#L39) | Modal | if:=schemeDetailOpen && !!activeScheme；bind:open=schemeDetailOpen && !!activeScheme；bind:title=activeScheme ? &#96;编辑识别结果 · ${schemeDisplayName(activeScheme, timeConfig)}&#96; : '编辑识别结果'；on:close=closeSchemeDetail |
| F043 | [src/components/schedule/SemesterModal.vue:29](../../src/components/schedule/SemesterModal.vue#L29) | Modal | if:=show；bind:open=show；title=📅 学期设置；on:close=emit('close') |
| F044 | [src/components/schedule/TimeBaseSettings.vue:288](../../src/components/schedule/TimeBaseSettings.vue#L288) | ConfirmDialog | if:=removeCampusTarget；bind:open=Boolean(removeCampusTarget)；title=删除校区；on:close=removeCampusTarget = null |
| F045 | [src/components/schedule/TimeBaseSettings.vue:298](../../src/components/schedule/TimeBaseSettings.vue#L298) | ConfirmDialog | if:=removeSeasonTarget；bind:open=Boolean(removeSeasonTarget)；title=删除作息季；on:close=removeSeasonTarget = null |
| F046 | [src/components/schedule/TimeImportPlanModal.vue:46](../../src/components/schedule/TimeImportPlanModal.vue#L46) | Modal | if:=importPlanOpen；bind:open=importPlanOpen；bind:title=modalTitle；on:close=closeImportPlan |
| F047 | [src/components/schedule/TimeSettingsModal.vue:230](../../src/components/schedule/TimeSettingsModal.vue#L230) | Modal | if:=show；bind:open=show；title=🕐 作息与时间设置；on:close=tryCloseTimeEditor |
| F048 | [src/components/schedule/TimeSettingsModal.vue:518](../../src/components/schedule/TimeSettingsModal.vue#L518) | RecognitionSchemeDetailModal | 由封装/插槽决定，需查看调用方 |
| F049 | [src/components/schedule/TimeSettingsModal.vue:521](../../src/components/schedule/TimeSettingsModal.vue#L521) | TimeImportPlanModal | 由封装/插槽决定，需查看调用方 |
| F050 | [src/components/schedule/TimeSettingsModal.vue:529](../../src/components/schedule/TimeSettingsModal.vue#L529) | ConfirmDialog | if:=pendingDraftAction；bind:open=Boolean(pendingDraftAction)；title=放弃未保存的修改；on:close=cancelPendingDraft |
| F051 | [src/components/schedule/TimeSettingsModal.vue:543](../../src/components/schedule/TimeSettingsModal.vue#L543) | ConfirmDialog | if:=resetTimesTarget；bind:open=Boolean(resetTimesTarget)；title=恢复默认作息时间；on:close=resetTimesTarget = false |
| F052 | [src/components/SearchPanel.vue:319](../../src/components/SearchPanel.vue#L319) | Modal | bind:open=open；title=🔍 全局搜索；on:close=emit('close') |
| F053 | [src/components/Sidebar.vue:580](../../src/components/Sidebar.vue#L580) | Toast | model:open=toast.open；on:close=toast.open = false |
| F054 | [src/components/Sidebar.vue:582](../../src/components/Sidebar.vue#L582) | AccountPanel | if:=accountOpen；bind:open=accountOpen；on:close=accountOpen = false |
| F055 | [src/components/Sidebar.vue:583](../../src/components/Sidebar.vue#L583) | DataManager | if:=showDataManager；bind:open=showDataManager；on:close=showDataManager = false |
| F056 | [src/components/Sidebar.vue:584](../../src/components/Sidebar.vue#L584) | VersionUpdateModal | if:=showVersionUpdate；bind:open=showVersionUpdate；on:close=showVersionUpdate = false |
| F057 | [src/components/Sidebar.vue:585](../../src/components/Sidebar.vue#L585) | AppearanceSettings | if:=showAppearance；bind:open=showAppearance；on:close=showAppearance = false |
| F058 | [src/components/Sidebar.vue:586](../../src/components/Sidebar.vue#L586) | NavigationSettings | if:=showNavigationSettings；bind:open=showNavigationSettings；on:close=showNavigationSettings = false |
| F059 | [src/components/Sidebar.vue:587](../../src/components/Sidebar.vue#L587) | QuickRecordSettings | if:=showQuickRecordSettings；bind:open=showQuickRecordSettings；on:close=showQuickRecordSettings = false |
| F060 | [src/components/Sidebar.vue:588](../../src/components/Sidebar.vue#L588) | SearchPanel | if:=showSearch；bind:open=showSearch；on:close=closeSearch() |
| F061 | [src/components/Sidebar.vue:589](../../src/components/Sidebar.vue#L589) | FocusSettings | if:=showFocusSettings；bind:open=showFocusSettings；on:close=showFocusSettings = false |
| F062 | [src/components/Sidebar.vue:590](../../src/components/Sidebar.vue#L590) | FestiveSettings | if:=showFestiveSettings；bind:open=showFestiveSettings；on:close=showFestiveSettings = false |
| F063 | [src/components/TaskCenter.vue:102](../../src/components/TaskCenter.vue#L102) | Modal | bind:open=open；title=后台任务；on:close=open = false |
| F064 | [src/components/tasks/TaskBulkBar.vue:41](../../src/components/tasks/TaskBulkBar.vue#L41) | ConfirmDialog | bind:open=confirmRemove；bind:title=&#96;删除 ${count} 项待办&#96;；on:close=confirmRemove = false |
| F065 | [src/components/tasks/TaskBulkRescheduleDialog.vue:37](../../src/components/tasks/TaskBulkRescheduleDialog.vue#L37) | Modal | bind:open=true；title=批量改期；on:close=emit('close') |
| F066 | [src/components/tasks/TaskRescheduleDialog.vue:40](../../src/components/tasks/TaskRescheduleDialog.vue#L40) | Modal | bind:open=true；title=重新安排时间；on:close=emit('close') |
| F067 | [src/components/tasks/TaskRescheduleDialog.vue:55](../../src/components/tasks/TaskRescheduleDialog.vue#L55) | ConfirmDialog | if:=conflictMessage；bind:open=true；title=改期后的时间冲突；on:close=conflictMessage = '' |
| F068 | [src/components/tasks/TaskRowActions.vue:60](../../src/components/tasks/TaskRowActions.vue#L60) | ActionSheet | bind:open=open；bind:title=subject ? &#96;更多操作：${subject}&#96; : '更多操作'；on:close=open = false |
| F069 | [src/components/tasks/TaskWorkSession.vue:38](../../src/components/tasks/TaskWorkSession.vue#L38) | Modal | bind:open=open；bind:title=task ? &#96;${task.title} · 工作进度&#96; : '任务工作进度'；on:close=emit('close') |
| F070 | [src/components/TimeWheelSheet.vue:62](../../src/components/TimeWheelSheet.vue#L62) | Modal | bind:open=open；bind:title=title；on:close=emit('close') |
| F071 | [src/components/UpdateNotes.vue:15](../../src/components/UpdateNotes.vue#L15) | Modal | bind:open=open；title=✨ 已更新；on:close=acknowledge |
| F072 | [src/components/VersionUpdateModal.vue:10](../../src/components/VersionUpdateModal.vue#L10) | Modal | bind:open=open；title=版本与更新；on:close=emit('close') |
| F073 | [src/views/CourseArchiveView.vue:268](../../src/views/CourseArchiveView.vue#L268) | TaskWorkSession | bind:open=Boolean(workSessionTask)；on:close=closeTaskWorkSession |
| F074 | [src/views/CourseArchiveView.vue:269](../../src/views/CourseArchiveView.vue#L269) | Toast | model:open=toast.open；on:close=toast.open = false |
| F075 | [src/views/EventsView.vue:254](../../src/views/EventsView.vue#L254) | Modal | if:=formOpen；bind:open=formOpen；bind:title=editing ? '编辑日程' : '新建日程'；on:close=closeForm |
| F076 | [src/views/EventsView.vue:283](../../src/views/EventsView.vue#L283) | Modal | if:=detail；bind:open=Boolean(detail)；title=日程详情；on:close=detail = null |
| F077 | [src/views/EventsView.vue:293](../../src/views/EventsView.vue#L293) | Modal | if:=importOpen；bind:open=importOpen；title=导入日程；on:close=importOpen = false |
| F078 | [src/views/EventsView.vue:294](../../src/views/EventsView.vue#L294) | TimeWheelSheet | bind:open=Boolean(wheelField)；bind:title=wheelField === 'endTime' ? '选择结束时间' : '选择开始时间'；on:close=wheelField = '' |
| F079 | [src/views/EventsView.vue:295](../../src/views/EventsView.vue#L295) | ConfirmDialog | if:=deleteEventTarget；bind:open=Boolean(deleteEventTarget)；title=删除日程；on:close=deleteEventTarget = null |
| F080 | [src/views/EventsView.vue:296](../../src/views/EventsView.vue#L296) | ConfirmDialog | if:=saveConflict；bind:open=Boolean(saveConflict)；title=时间冲突；on:close=saveConflict = null |
| F081 | [src/views/EventsView.vue:297](../../src/views/EventsView.vue#L297) | Toast | model:open=toast.open |
| F082 | [src/views/ExamsView.vue:802](../../src/views/ExamsView.vue#L802) | Modal | if:=showForm；bind:open=showForm；bind:title=editingId ? '编辑重要日期' : '添加重要日期'；on:close=showForm = false |
| F083 | [src/views/ExamsView.vue:868](../../src/views/ExamsView.vue#L868) | ConfirmDialog | bind:open=Boolean(deleteTarget)；title=删除重要日期；on:close=deleteTarget = null |
| F084 | [src/views/ExamsView.vue:876](../../src/views/ExamsView.vue#L876) | Toast | model:open=toast.open；on:close=toast.open = false |
| F085 | [src/views/ExamsView.vue:878](../../src/views/ExamsView.vue#L878) | ContextMenu | bind:open=Boolean(contextMenu)；bind:title=contextMenuTarget?.name &#124;&#124; ''；on:close=contextMenu = null |
| F086 | [src/views/ledger-panels/BillFormModal.vue:2](../../src/views/ledger-panels/BillFormModal.vue#L2) | Modal | if:=formOpen；bind:open=formOpen；bind:title=editingBillId ? '编辑固定账单' : '添加固定账单'；on:close=formOpen = false |
| F087 | [src/views/ledger-panels/BillFormModal.vue:129](../../src/views/ledger-panels/BillFormModal.vue#L129) | ConfirmDialog | bind:open=Boolean(deleteBillTarget)；title=删除固定账单；on:close=deleteBillTarget = null |
| F088 | [src/views/ledger-panels/BudgetSettingsModal.vue:2](../../src/views/ledger-panels/BudgetSettingsModal.vue#L2) | Modal | if:=open；bind:open=open；title=月度预算；on:close=emit('close') |
| F089 | [src/views/ledger-panels/FxSettingsModal.vue:2](../../src/views/ledger-panels/FxSettingsModal.vue#L2) | Modal | if:=open；bind:open=open；title=汇率设置；on:close=emit('close') |
| F090 | [src/views/ledger-panels/LedgerHomePanel.vue:292](../../src/views/ledger-panels/LedgerHomePanel.vue#L292) | SwipeActionItem | bind:open=openSwipeId === String(e.transaction.id) |
| F091 | [src/views/ledger-panels/QuickEntryModal.vue:200](../../src/views/ledger-panels/QuickEntryModal.vue#L200) | Modal | bind:open=open；bind:title=editingId ? '编辑记录' : keepAdding ? '再记一笔' : '记一笔'；on:close=closeQuick |
| F092 | [src/views/ledger-panels/QuickEntryModal.vue:307](../../src/views/ledger-panels/QuickEntryModal.vue#L307) | QuickRecordPanel | if:=showQuickRecord；bind:open=showQuickRecord；on:close=$emit('update:showQuickRecord', false) |
| F093 | [src/views/ledger-panels/TransactionDetailModal.vue:86](../../src/views/ledger-panels/TransactionDetailModal.vue#L86) | Modal | if:=detailExpense；bind:open=open；bind:title=detailExpense?.name ?? '记录详情'；on:close=$emit('update:open', false) |
| F094 | [src/views/ledger-panels/TransactionDetailModal.vue:136](../../src/views/ledger-panels/TransactionDetailModal.vue#L136) | Modal | if:=showRefund；bind:open=showRefund；title=登记退款；on:close=$emit('close-refund') |
| F095 | [src/views/ledger-panels/TransactionImportDialog.vue:217](../../src/views/ledger-panels/TransactionImportDialog.vue#L217) | Modal | if:=open；bind:open=open；title=导入账单；on:close=close |
| F096 | [src/views/LedgerView.vue:734](../../src/views/LedgerView.vue#L734) | QuickEntryModal | bind:open=showQuick；on:close=closeQuickModal |
| F097 | [src/views/LedgerView.vue:802](../../src/views/LedgerView.vue#L802) | TransactionImportDialog | bind:open=showImportDialog；on:close=showImportDialog = false |
| F098 | [src/views/LedgerView.vue:815](../../src/views/LedgerView.vue#L815) | TransactionDetailModal | bind:open=detailOpen |
| F099 | [src/views/LedgerView.vue:864](../../src/views/LedgerView.vue#L864) | BillFormModal | 由封装/插槽决定，需查看调用方 |
| F100 | [src/views/LedgerView.vue:873](../../src/views/LedgerView.vue#L873) | FxSettingsModal | bind:open=showFxSettings；on:close=showFxSettings = false |
| F101 | [src/views/LedgerView.vue:882](../../src/views/LedgerView.vue#L882) | BudgetSettingsModal | bind:open=showBudgetSettings；on:close=showBudgetSettings = false |
| F102 | [src/views/LedgerView.vue:890](../../src/views/LedgerView.vue#L890) | Modal | if:=showCatManage；bind:open=showCatManage；title=分类管理；on:close=showCatManage = false |
| F103 | [src/views/LedgerView.vue:983](../../src/views/LedgerView.vue#L983) | PromptDialog | if:=renameTarget；bind:open=Boolean(renameTarget)；title=修改分类名称；on:close=renameTarget = null; renameError = '' |
| F104 | [src/views/LedgerView.vue:996](../../src/views/LedgerView.vue#L996) | ConfirmDialog | if:=categoryDeleteTarget；bind:open=Boolean(categoryDeleteTarget)；title=删除自定义分类；on:close=categoryDeleteTarget = null |
| F105 | [src/views/LedgerView.vue:1006](../../src/views/LedgerView.vue#L1006) | Toast | model:open=toast.open；on:close=toast.open = false |
| F106 | [src/views/ListsView.vue:495](../../src/views/ListsView.vue#L495) | SwipeActionItem | bind:open=openSwipeItemId === item.id |
| F107 | [src/views/ListsView.vue:512](../../src/views/ListsView.vue#L512) | Modal | if:=showListForm；bind:open=showListForm；bind:title=editingListId ? '编辑清单' : '新建清单'；on:close=showListForm = false |
| F108 | [src/views/ListsView.vue:532](../../src/views/ListsView.vue#L532) | Modal | if:=showItemForm；bind:open=showItemForm；bind:title=editingItemId ? '编辑事项' : '添加事项'；on:close=showItemForm = false |
| F109 | [src/views/ListsView.vue:550](../../src/views/ListsView.vue#L550) | Modal | if:=showBulkForm；bind:open=showBulkForm；title=批量添加事项；on:close=showBulkForm = false |
| F110 | [src/views/ListsView.vue:561](../../src/views/ListsView.vue#L561) | ConfirmDialog | if:=confirmTarget；bind:open=Boolean(confirmTarget)；bind:title=confirmTitle；on:close=confirmTarget = null |
| F111 | [src/views/ListsView.vue:562](../../src/views/ListsView.vue#L562) | Toast | model:open=toast.open |
| F112 | [src/views/ProjectsView.vue:1386](../../src/views/ProjectsView.vue#L1386) | Modal | if:=showProjectForm；bind:open=showProjectForm；bind:title=projectFormTitle；on:close=showProjectForm = false |
| F113 | [src/views/ProjectsView.vue:1399](../../src/views/ProjectsView.vue#L1399) | Modal | if:=showTaskForm；bind:open=showTaskForm；bind:title=editingTask ? '编辑任务' : taskDraft.parentTaskId ? '添加子任务' : '添加任务'；on:close=showTaskForm = false; editingTask = false |
| F114 | [src/views/ProjectsView.vue:1418](../../src/views/ProjectsView.vue#L1418) | Modal | if:=showMilestoneForm；bind:open=showMilestoneForm；bind:title=editingMilestone ? '编辑里程碑' : '添加里程碑'；on:close=showMilestoneForm = false |
| F115 | [src/views/ProjectsView.vue:1429](../../src/views/ProjectsView.vue#L1429) | Modal | if:=showDeliveryCheckForm；bind:open=showDeliveryCheckForm；title=添加交付检查项；on:close=showDeliveryCheckForm = false |
| F116 | [src/views/ProjectsView.vue:1439](../../src/views/ProjectsView.vue#L1439) | Modal | if:=showMeetingForm；bind:open=showMeetingForm；bind:title=meetingProposalTarget ? '提出改期建议' : '发起小组讨论'；on:close=showMeetingForm = false; meetingProposalTarget = null |
| F117 | [src/views/ProjectsView.vue:1452](../../src/views/ProjectsView.vue#L1452) | Modal | if:=showAdjustmentForm；bind:open=showAdjustmentForm；title=协商任务调整；on:close=showAdjustmentForm = false |
| F118 | [src/views/ProjectsView.vue:1467](../../src/views/ProjectsView.vue#L1467) | Modal | if:=showDeliverableForm；bind:open=showDeliverableForm；title=添加项目交付项；on:close=showDeliverableForm = false |
| F119 | [src/views/ProjectsView.vue:1481](../../src/views/ProjectsView.vue#L1481) | Modal | if:=showDeliverableEditor；bind:open=showDeliverableEditor；bind:title=&#96;提交成果 · ${activeDeliverable?.title &#124;&#124; ''}&#96;；on:close=closeDeliverableEditor |
| F120 | [src/views/ProjectsView.vue:1502](../../src/views/ProjectsView.vue#L1502) | Modal | if:=reviewTarget；bind:open=Boolean(reviewTarget)；title=验收成果；on:close=reviewTarget = null |
| F121 | [src/views/ProjectsView.vue:1513](../../src/views/ProjectsView.vue#L1513) | Modal | if:=showInviteForm；bind:open=showInviteForm；title=邀请成员；on:close=showInviteForm = false |
| F122 | [src/views/ProjectsView.vue:1521](../../src/views/ProjectsView.vue#L1521) | Modal | if:=taskEventsTitle；bind:open=Boolean(taskEventsTitle)；bind:title=&#96;${taskEventsTitle} · 进展记录&#96;；on:close=taskEventsTitle = ''; taskEvents = [] |
| F123 | [src/views/ProjectsView.vue:1526](../../src/views/ProjectsView.vue#L1526) | Modal | if:=transferTargetId；bind:open=Boolean(transferTargetId)；title=转交项目负责人；on:close=transferTargetId = '' |
| F124 | [src/views/ProjectsView.vue:1531](../../src/views/ProjectsView.vue#L1531) | ConfirmDialog | if:=confirmAction；bind:open=Boolean(confirmAction)；bind:title=({ archive: '归档项目', delete: '删除项目', leave: '退出项目', remove: '移出成员', restore: '恢复项目', 'decline-invite': '拒绝项目邀请', 'delete-milestone': '删除里程碑', 'meeting-confirm': '确认小组讨论', 'meeting-cancel': '取消讨论邀约', 'meeting-apply-proposal': '采用改期建议', 'delivery-check-delete': '删除交付检查项' })[confirmAction.kind] &#124;&#124; '确认操作'；on:close=confirmAction = null |
| F125 | [src/views/ScheduleView.vue:411](../../src/views/ScheduleView.vue#L411) | Popover | model:open=calendarOpen |
| F126 | [src/views/ScheduleView.vue:536](../../src/views/ScheduleView.vue#L536) | CourseEditorModal | bind:open=showForm；on:close=showForm = false |
| F127 | [src/views/ScheduleView.vue:553](../../src/views/ScheduleView.vue#L553) | QuickRecordPanel | if:=quickHomeworkCourse；bind:open=Boolean(quickHomeworkCourse)；on:close=closeHomeworkRecord |
| F128 | [src/views/ScheduleView.vue:561](../../src/views/ScheduleView.vue#L561) | ConfirmDialog | bind:open=Boolean(deleteCourseTarget)；title=删除课程；on:close=deleteCourseTarget = null |
| F129 | [src/views/ScheduleView.vue:573](../../src/views/ScheduleView.vue#L573) | ConfirmDialog | if:=coursesRemovalTarget；bind:open=Boolean(coursesRemovalTarget)；title=删除课程；on:close=coursesRemovalTarget = null |
| F130 | [src/views/ScheduleView.vue:583](../../src/views/ScheduleView.vue#L583) | ConfirmDialog | if:=importTemplateTarget；bind:open=Boolean(importTemplateTarget)；title=导入课表模板；on:close=importTemplateTarget = null |
| F131 | [src/views/ScheduleView.vue:593](../../src/views/ScheduleView.vue#L593) | ConfirmDialog | if:=deleteTemplateTarget；bind:open=Boolean(deleteTemplateTarget)；title=删除课表模板；on:close=deleteTemplateTarget = null |
| F132 | [src/views/ScheduleView.vue:603](../../src/views/ScheduleView.vue#L603) | ConfirmDialog | if:=replaceAllTarget；bind:open=Boolean(replaceAllTarget)；title=替换整张课表；on:close=replaceAllTarget = null |
| F133 | [src/views/ScheduleView.vue:613](../../src/views/ScheduleView.vue#L613) | CourseManagerModal | bind:open=showCourseManager；on:close=showCourseManager = false |
| F134 | [src/views/ScheduleView.vue:633](../../src/views/ScheduleView.vue#L633) | BatchImportModal | on:close=showBatch = false |
| F135 | [src/views/ScheduleView.vue:666](../../src/views/ScheduleView.vue#L666) | ImageCropModal | on:close=showImageCropper = false; cropImageFile = null |
| F136 | [src/views/ScheduleView.vue:668](../../src/views/ScheduleView.vue#L668) | ImportConflictModal | on:close=cancelCourseImportReview |
| F137 | [src/views/ScheduleView.vue:684](../../src/views/ScheduleView.vue#L684) | ExceptionsModal | on:close=showExceptions = false |
| F138 | [src/views/ScheduleView.vue:696](../../src/views/ScheduleView.vue#L696) | SemesterModal | on:close=showSemester = false |
| F139 | [src/views/ScheduleView.vue:704](../../src/views/ScheduleView.vue#L704) | TimeSettingsModal | on:close=showTimeEditor = false |
| F140 | [src/views/ScheduleView.vue:711](../../src/views/ScheduleView.vue#L711) | Toast | model:open=toast.open；on:close=toast.open = false |
| F141 | [src/views/TasksView.vue:735](../../src/views/TasksView.vue#L735) | ConfirmDialog | if:=bulkCompletionConfirm；bind:open=true；title=完成多项待办；on:close=bulkCompletionConfirm = null |
| F142 | [src/views/TasksView.vue:747](../../src/views/TasksView.vue#L747) | TaskBulkRescheduleDialog | if:=viewMode === 'list' && bulk.shiftTargets.value.length；on:close=bulk.shiftTargets.value = [] |
| F143 | [src/views/TasksView.vue:754](../../src/views/TasksView.vue#L754) | ConfirmDialog | if:=bulkShiftConfirmation；bind:open=true；title=批量改期有时间冲突；on:close=bulkShiftConfirmation = null |
| F144 | [src/views/TasksView.vue:816](../../src/views/TasksView.vue#L816) | SwipeActionItem | if:=isTaskRow(task)；bind:open=openSwipeItemId === task.id |
| F145 | [src/views/TasksView.vue:887](../../src/views/TasksView.vue#L887) | Modal | if:=showForm；bind:open=showForm；bind:title=editingId ? '编辑待办' : '添加待办'；on:close=showForm = false |
| F146 | [src/views/TasksView.vue:954](../../src/views/TasksView.vue#L954) | TaskWorkSession | bind:open=Boolean(workSessionTask)；on:close=closeTaskWorkSession |
| F147 | [src/views/TasksView.vue:957](../../src/views/TasksView.vue#L957) | NoticePaste | bind:open=showNotice；on:close=showNotice = false |
| F148 | [src/views/TasksView.vue:964](../../src/views/TasksView.vue#L964) | ConfirmDialog | bind:open=Boolean(deleteTarget)；title=删除待办；on:close=deleteTarget = null |
| F149 | [src/views/TasksView.vue:966](../../src/views/TasksView.vue#L966) | ConfirmDialog | if:=saveConflict；bind:open=Boolean(saveConflict)；title=时间冲突；on:close=saveConflict = null |
| F150 | [src/views/TasksView.vue:977](../../src/views/TasksView.vue#L977) | TaskRescheduleDialog | if:=rescheduleTarget；on:close=rescheduleTarget = null |
| F151 | [src/views/TasksView.vue:978](../../src/views/TasksView.vue#L978) | ConfirmDialog | if:=completionTarget；bind:open=Boolean(completionTarget)；title=完成整个事项；on:close=completionTarget = null |
| F152 | [src/views/TasksView.vue:979](../../src/views/TasksView.vue#L979) | Toast | model:open=toast.open；on:close=toast.open = false |
| F153 | [src/views/TodayView.vue:467](../../src/views/TodayView.vue#L467) | MemoryView | bind:open=showMemory；on:close=showMemory = false |
| F154 | [src/views/TodayView.vue:468](../../src/views/TodayView.vue#L468) | Modal | if:=eventDetail；bind:open=Boolean(eventDetail)；title=日程详情；on:close=eventDetail = null |
| F155 | [src/views/TogetherView.vue:840](../../src/views/TogetherView.vue#L840) | ConfirmDialog | if:=friendRemovalTarget；bind:open=Boolean(friendRemovalTarget)；title=移除好友；on:close=friendRemovalTarget = null |
| F156 | [src/views/TogetherView.vue:849](../../src/views/TogetherView.vue#L849) | ConfirmDialog | if:=invitationCancellationTarget；bind:open=Boolean(invitationCancellationTarget)；title=取消邀约；on:close=invitationCancellationTarget = null |

| 根节点 | 位置 | 合同 |
| --- | --- | --- |
| 通用 Modal | [src/components/Modal.vue:341](../../src/components/Modal.vue#L341) | dialog/aria-modal、栈、历史返回、焦点、手机 detents/拖动/visualViewport |
| 手机动作表 | [src/components/ActionSheet.vue:117](../../src/components/ActionSheet.vue#L117) | dialog、动作列表/取消、危险动作与返回 |
| 上下文菜单 | [src/components/ContextMenu.vue:126](../../src/components/ContextMenu.vue#L126) | menu、定位/键盘/关闭、各项状态 |
| 手机更多 | [src/components/Sidebar.vue:472](../../src/components/Sidebar.vue#L472) | 页面与工具入口、滚动、安全区、路由后关闭 |

## 9. 云接口动作与表索引

所有动作通过 API03 的统一 POST 入口；以下 63 个名字是实际 Edge 分派值，不是新增 HTTP 路由。profile_get/save 允许已登录的未验证邮箱用户；其余在 handle 的 verified-email 门禁后，仍需逐动作核对自身/好友/邀约参与者/项目成员/角色等数据库边界。服务端动作存在不证明每个用户都能执行。

| 动作 | Edge 分派位置 | 授权验收类别 |
| --- | --- | --- |
| profile_get | [supabase/functions/campus-social/index.ts:620](../../supabase/functions/campus-social/index.ts#L620) | 当前账号资料 |
| profile_save | [supabase/functions/campus-social/index.ts:621](../../supabase/functions/campus-social/index.ts#L621) | 当前账号资料 |
| email_search | [supabase/functions/campus-social/index.ts:624](../../supabase/functions/campus-social/index.ts#L624) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| friends_list | [supabase/functions/campus-social/index.ts:630](../../supabase/functions/campus-social/index.ts#L630) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| friend_request_send | [supabase/functions/campus-social/index.ts:631](../../supabase/functions/campus-social/index.ts#L631) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| friend_request_respond | [supabase/functions/campus-social/index.ts:632](../../supabase/functions/campus-social/index.ts#L632) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| friend_remove | [supabase/functions/campus-social/index.ts:635](../../supabase/functions/campus-social/index.ts#L635) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| availability_query | [supabase/functions/campus-social/index.ts:636](../../supabase/functions/campus-social/index.ts#L636) | 邮箱验证 + 自己/好友关系/精确搜索及限流 |
| invitations_list | [supabase/functions/campus-social/index.ts:637](../../supabase/functions/campus-social/index.ts#L637) | 邮箱验证 + 邀约参与者/有效好友/冲突复核 |
| invitation_create | [supabase/functions/campus-social/index.ts:638](../../supabase/functions/campus-social/index.ts#L638) | 邮箱验证 + 邀约参与者/有效好友/冲突复核 |
| invitation_respond | [supabase/functions/campus-social/index.ts:639](../../supabase/functions/campus-social/index.ts#L639) | 邮箱验证 + 邀约参与者/有效好友/冲突复核 |
| invitation_cancel | [supabase/functions/campus-social/index.ts:640](../../supabase/functions/campus-social/index.ts#L640) | 邮箱验证 + 邀约参与者/有效好友/冲突复核 |
| notifications_list | [supabase/functions/campus-social/index.ts:641](../../supabase/functions/campus-social/index.ts#L641) | 邮箱验证 + 自己的通知 |
| notifications_mark_read | [supabase/functions/campus-social/index.ts:642](../../supabase/functions/campus-social/index.ts#L642) | 邮箱验证 + 自己的通知 |
| project_time_availability | [supabase/functions/campus-social/index.ts:643](../../supabase/functions/campus-social/index.ts#L643) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meetings_list | [supabase/functions/campus-social/index.ts:644](../../supabase/functions/campus-social/index.ts#L644) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meeting_create | [supabase/functions/campus-social/index.ts:645](../../supabase/functions/campus-social/index.ts#L645) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meeting_respond | [supabase/functions/campus-social/index.ts:663](../../supabase/functions/campus-social/index.ts#L663) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meeting_confirm | [supabase/functions/campus-social/index.ts:675](../../supabase/functions/campus-social/index.ts#L675) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meeting_apply_proposal | [supabase/functions/campus-social/index.ts:678](../../supabase/functions/campus-social/index.ts#L678) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_meeting_cancel | [supabase/functions/campus-social/index.ts:682](../../supabase/functions/campus-social/index.ts#L682) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_list | [supabase/functions/campus-social/index.ts:685](../../supabase/functions/campus-social/index.ts#L685) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_inbox | [supabase/functions/campus-social/index.ts:686](../../supabase/functions/campus-social/index.ts#L686) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_detail | [supabase/functions/campus-social/index.ts:687](../../supabase/functions/campus-social/index.ts#L687) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_create | [supabase/functions/campus-social/index.ts:688](../../supabase/functions/campus-social/index.ts#L688) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_update | [supabase/functions/campus-social/index.ts:693](../../supabase/functions/campus-social/index.ts#L693) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_archive | [supabase/functions/campus-social/index.ts:699](../../supabase/functions/campus-social/index.ts#L699) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_delete | [supabase/functions/campus-social/index.ts:702](../../supabase/functions/campus-social/index.ts#L702) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_restore | [supabase/functions/campus-social/index.ts:703](../../supabase/functions/campus-social/index.ts#L703) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invite_member | [supabase/functions/campus-social/index.ts:704](../../supabase/functions/campus-social/index.ts#L704) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invites | [supabase/functions/campus-social/index.ts:711](../../supabase/functions/campus-social/index.ts#L711) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invite_link_create | [supabase/functions/campus-social/index.ts:712](../../supabase/functions/campus-social/index.ts#L712) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invite_link_revoke | [supabase/functions/campus-social/index.ts:721](../../supabase/functions/campus-social/index.ts#L721) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invite_join | [supabase/functions/campus-social/index.ts:724](../../supabase/functions/campus-social/index.ts#L724) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_invite_respond | [supabase/functions/campus-social/index.ts:729](../../supabase/functions/campus-social/index.ts#L729) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_member_leave | [supabase/functions/campus-social/index.ts:732](../../supabase/functions/campus-social/index.ts#L732) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_member_remove | [supabase/functions/campus-social/index.ts:733](../../supabase/functions/campus-social/index.ts#L733) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_member_role_update | [supabase/functions/campus-social/index.ts:736](../../supabase/functions/campus-social/index.ts#L736) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_owner_transfer | [supabase/functions/campus-social/index.ts:740](../../supabase/functions/campus-social/index.ts#L740) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_create | [supabase/functions/campus-social/index.ts:743](../../supabase/functions/campus-social/index.ts#L743) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_update | [supabase/functions/campus-social/index.ts:752](../../supabase/functions/campus-social/index.ts#L752) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_respond | [supabase/functions/campus-social/index.ts:761](../../supabase/functions/campus-social/index.ts#L761) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_status | [supabase/functions/campus-social/index.ts:765](../../supabase/functions/campus-social/index.ts#L765) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_personal_sync | [supabase/functions/campus-social/index.ts:769](../../supabase/functions/campus-social/index.ts#L769) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_events | [supabase/functions/campus-social/index.ts:773](../../supabase/functions/campus-social/index.ts#L773) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_checkpoints | [supabase/functions/campus-social/index.ts:776](../../supabase/functions/campus-social/index.ts#L776) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_task_checkpoint_save | [supabase/functions/campus-social/index.ts:777](../../supabase/functions/campus-social/index.ts#L777) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_milestone_create | [supabase/functions/campus-social/index.ts:781](../../supabase/functions/campus-social/index.ts#L781) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_milestone_update | [supabase/functions/campus-social/index.ts:786](../../supabase/functions/campus-social/index.ts#L786) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_milestone_toggle | [supabase/functions/campus-social/index.ts:792](../../supabase/functions/campus-social/index.ts#L792) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_milestone_delete | [supabase/functions/campus-social/index.ts:795](../../supabase/functions/campus-social/index.ts#L795) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_delivery_check_create | [supabase/functions/campus-social/index.ts:798](../../supabase/functions/campus-social/index.ts#L798) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_delivery_check_update | [supabase/functions/campus-social/index.ts:802](../../supabase/functions/campus-social/index.ts#L802) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_delivery_check_delete | [supabase/functions/campus-social/index.ts:807](../../supabase/functions/campus-social/index.ts#L807) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_adjustment_create | [supabase/functions/campus-social/index.ts:810](../../supabase/functions/campus-social/index.ts#L810) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_adjustments_list | [supabase/functions/campus-social/index.ts:818](../../supabase/functions/campus-social/index.ts#L818) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_adjustment_decide | [supabase/functions/campus-social/index.ts:819](../../supabase/functions/campus-social/index.ts#L819) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_adjustment_cancel | [supabase/functions/campus-social/index.ts:824](../../supabase/functions/campus-social/index.ts#L824) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_deliverables | [supabase/functions/campus-social/index.ts:827](../../supabase/functions/campus-social/index.ts#L827) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_deliverable_create | [supabase/functions/campus-social/index.ts:828](../../supabase/functions/campus-social/index.ts#L828) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_deliverable_draft_save | [supabase/functions/campus-social/index.ts:835](../../supabase/functions/campus-social/index.ts#L835) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_deliverable_submit | [supabase/functions/campus-social/index.ts:843](../../supabase/functions/campus-social/index.ts#L843) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |
| project_deliverable_review | [supabase/functions/campus-social/index.ts:849](../../supabase/functions/campus-social/index.ts#L849) | 邮箱验证 + 项目成员/邀请对象/负责人/验收者 + revision/归档状态 |

### 数据库实体

这里只索引本项目创建的 23 张表；Supabase 系统 auth/storage 表另由平台管理。private.social_rate_buckets 是服务端限流状态。RLS/grants/RPC 的验收以第 6 节权限矩阵为准。

| 表 | 创建位置 |
| --- | --- |
| public.account_sync_snapshots | [supabase/migrations/20261006170314_account_sync_snapshots.sql:2](../../supabase/migrations/20261006170314_account_sync_snapshots.sql#L2) |
| public.social_profiles | [supabase/migrations/20261008045623_friend_collaboration.sql:8](../../supabase/migrations/20261008045623_friend_collaboration.sql#L8) |
| public.social_friend_requests | [supabase/migrations/20261008045623_friend_collaboration.sql:22](../../supabase/migrations/20261008045623_friend_collaboration.sql#L22) |
| public.social_friendships | [supabase/migrations/20261008045623_friend_collaboration.sql:40](../../supabase/migrations/20261008045623_friend_collaboration.sql#L40) |
| public.social_invitations | [supabase/migrations/20261008045623_friend_collaboration.sql:49](../../supabase/migrations/20261008045623_friend_collaboration.sql#L49) |
| public.social_invitation_participants | [supabase/migrations/20261008045623_friend_collaboration.sql:70](../../supabase/migrations/20261008045623_friend_collaboration.sql#L70) |
| public.social_notifications | [supabase/migrations/20261008045623_friend_collaboration.sql:88](../../supabase/migrations/20261008045623_friend_collaboration.sql#L88) |
| private.social_rate_buckets | [supabase/migrations/20261008045623_friend_collaboration.sql:100](../../supabase/migrations/20261008045623_friend_collaboration.sql#L100) |
| public.team_projects | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:5](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L5) |
| public.team_project_milestones | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:23](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L23) |
| public.team_project_members | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:40](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L40) |
| public.team_project_invite_links | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:59](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L59) |
| public.team_project_tasks | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:73](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L73) |
| public.team_project_task_events | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:105](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L105) |
| public.team_project_activity | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:124](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L124) |
| public.team_project_adjustment_requests | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:141](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L141) |
| public.team_project_deliverables | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:162](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L162) |
| public.team_project_deliverable_drafts | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:179](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L179) |
| public.team_project_result_versions | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:188](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L188) |
| public.team_project_reviews | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:203](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L203) |
| public.team_project_delivery_checks | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:213](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L213) |
| public.team_project_meetings | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:230](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L230) |
| public.team_project_meeting_participants | [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql:247](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql#L247) |

## 10. 完整源码追踪索引

索引快照：2026/10/10 23:43:14（Asia/Shanghai），843 个活动代码/配置文件。这里是可定位的文件清单，不再重复业务说明；页面、组件、状态、权限和二级功能的语义台账在前文。审计期间并行变更及验证快照差异见 STATUS。

依赖安装目录、Git 元数据、dist/临时产物、已退役 coordinator 的 .wrangler 输出、真实用户配置/备份未纳入活动源码。测试索引包含辅助/夹具，因此文件数不等于 Vitest 测试套件数。

<details>
<summary>应用壳、路由、全局样式与类型（18 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [src/App.vue](../../src/App.vue) | 975 |
| [src/env.d.ts](../../src/env.d.ts) | 33 |
| [src/lib/utils.ts](../../src/lib/utils.ts) | 7 |
| [src/main.js](../../src/main.js) | 324 |
| [src/router/navigation.js](../../src/router/navigation.js) | 62 |
| [src/router/routePreload.js](../../src/router/routePreload.js) | 36 |
| [src/router/routes.js](../../src/router/routes.js) | 79 |
| [src/services/accountSync.js](../../src/services/accountSync.js) | 53 |
| [src/services/projects.js](../../src/services/projects.js) | 114 |
| [src/services/social.js](../../src/services/social.js) | 105 |
| [src/services/supabase.js](../../src/services/supabase.js) | 70 |
| [src/style.css](../../src/style.css) | 951 |
| [src/styles/action-feedback.css](../../src/styles/action-feedback.css) | 40 |
| [src/styles/shadcn.css](../../src/styles/shadcn.css) | 41 |
| [src/types/checklists.ts](../../src/types/checklists.ts) | 31 |
| [src/types/domain.ts](../../src/types/domain.ts) | 230 |
| [src/types/lucide-vue.d.ts](../../src/types/lucide-vue.d.ts) | 18 |
| [src/utils/formatters.js](../../src/utils/formatters.js) | 126 |

</details>

<details>
<summary>业务与共享组件（92 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [src/components/account/AccountPasswordForm.vue](../../src/components/account/AccountPasswordForm.vue) | 111 |
| [src/components/account/AccountSessionActions.vue](../../src/components/account/AccountSessionActions.vue) | 54 |
| [src/components/AccountPanel.vue](../../src/components/AccountPanel.vue) | 426 |
| [src/components/ActionButton.vue](../../src/components/ActionButton.vue) | 149 |
| [src/components/ActionFeedback.vue](../../src/components/ActionFeedback.vue) | 31 |
| [src/components/ActionSheet.vue](../../src/components/ActionSheet.vue) | 295 |
| [src/components/AppearanceSettings.vue](../../src/components/AppearanceSettings.vue) | 1039 |
| [src/components/AppearanceSwipeSettings.vue](../../src/components/AppearanceSwipeSettings.vue) | 113 |
| [src/components/ConfirmDialog.vue](../../src/components/ConfirmDialog.vue) | 52 |
| [src/components/ContextMenu.vue](../../src/components/ContextMenu.vue) | 242 |
| [src/components/courses/CourseActivityItem.vue](../../src/components/courses/CourseActivityItem.vue) | 39 |
| [src/components/courses/CourseTaskItem.vue](../../src/components/courses/CourseTaskItem.vue) | 52 |
| [src/components/data/AccountSyncPanel.vue](../../src/components/data/AccountSyncPanel.vue) | 164 |
| [src/components/data/AppUpdateSection.vue](../../src/components/data/AppUpdateSection.vue) | 256 |
| [src/components/data/BackupSection.vue](../../src/components/data/BackupSection.vue) | 77 |
| [src/components/data/DataOverview.vue](../../src/components/data/DataOverview.vue) | 77 |
| [src/components/data/RestorePreview.vue](../../src/components/data/RestorePreview.vue) | 63 |
| [src/components/data/RestoreSection.vue](../../src/components/data/RestoreSection.vue) | 87 |
| [src/components/DataManager.vue](../../src/components/DataManager.vue) | 349 |
| [src/components/DomainCsvImportButton.vue](../../src/components/DomainCsvImportButton.vue) | 130 |
| [src/components/EmptyState.vue](../../src/components/EmptyState.vue) | 116 |
| [src/components/events/EventCalendar.vue](../../src/components/events/EventCalendar.vue) | 108 |
| [src/components/FestiveSettings.vue](../../src/components/FestiveSettings.vue) | 894 |
| [src/components/focus-panel.css](../../src/components/focus-panel.css) | 324 |
| [src/components/FocusPanel.vue](../../src/components/FocusPanel.vue) | 648 |
| [src/components/FocusReturn.vue](../../src/components/FocusReturn.vue) | 41 |
| [src/components/FocusSettings.vue](../../src/components/FocusSettings.vue) | 199 |
| [src/components/HomeProductivityPanel.vue](../../src/components/HomeProductivityPanel.vue) | 76 |
| [src/components/IcsImportButton.vue](../../src/components/IcsImportButton.vue) | 118 |
| [src/components/learning/LearningNavigation.vue](../../src/components/learning/LearningNavigation.vue) | 30 |
| [src/components/learning/StudyPlanner.vue](../../src/components/learning/StudyPlanner.vue) | 162 |
| [src/components/learning/TaskFocusLink.vue](../../src/components/learning/TaskFocusLink.vue) | 16 |
| [src/components/MemoryView.vue](../../src/components/MemoryView.vue) | 304 |
| [src/components/Modal.vue](../../src/components/Modal.vue) | 535 |
| [src/components/navigation/NavigationFeaturePicker.vue](../../src/components/navigation/NavigationFeaturePicker.vue) | 88 |
| [src/components/navigation/NavigationPreview.vue](../../src/components/navigation/NavigationPreview.vue) | 88 |
| [src/components/NavigationSettings.vue](../../src/components/NavigationSettings.vue) | 378 |
| [src/components/NotFoundView.vue](../../src/components/NotFoundView.vue) | 17 |
| [src/components/NoticePaste.vue](../../src/components/NoticePaste.vue) | 19 |
| [src/components/NoticeUnderstanding.vue](../../src/components/NoticeUnderstanding.vue) | 522 |
| [src/components/projects/ProjectDraftRecovery.vue](../../src/components/projects/ProjectDraftRecovery.vue) | 35 |
| [src/components/projects/ProjectTaskOverview.vue](../../src/components/projects/ProjectTaskOverview.vue) | 43 |
| [src/components/projects/ProjectTaskWorkProgress.vue](../../src/components/projects/ProjectTaskWorkProgress.vue) | 19 |
| [src/components/PromptDialog.vue](../../src/components/PromptDialog.vue) | 133 |
| [src/components/QuickCapturePanel.vue](../../src/components/QuickCapturePanel.vue) | 21 |
| [src/components/QuickLedgerPanel.vue](../../src/components/QuickLedgerPanel.vue) | 22 |
| [src/components/QuickRecordPanel.vue](../../src/components/QuickRecordPanel.vue) | 378 |
| [src/components/QuickRecordSettings.vue](../../src/components/QuickRecordSettings.vue) | 42 |
| [src/components/ReleaseNotesBrowser.vue](../../src/components/ReleaseNotesBrowser.vue) | 85 |
| [src/components/RouteFallback.vue](../../src/components/RouteFallback.vue) | 73 |
| [src/components/schedule/BatchImportModal.vue](../../src/components/schedule/BatchImportModal.vue) | 678 |
| [src/components/schedule/CourseEditorModal.vue](../../src/components/schedule/CourseEditorModal.vue) | 245 |
| [src/components/schedule/CourseManagerModal.vue](../../src/components/schedule/CourseManagerModal.vue) | 129 |
| [src/components/schedule/ExceptionsModal.vue](../../src/components/schedule/ExceptionsModal.vue) | 570 |
| [src/components/schedule/ImageCropModal.vue](../../src/components/schedule/ImageCropModal.vue) | 173 |
| [src/components/schedule/ImportConflictModal.vue](../../src/components/schedule/ImportConflictModal.vue) | 167 |
| [src/components/schedule/RecognitionSchemeDetailModal.vue](../../src/components/schedule/RecognitionSchemeDetailModal.vue) | 235 |
| [src/components/schedule/ScheduleGrid.vue](../../src/components/schedule/ScheduleGrid.vue) | 590 |
| [src/components/schedule/ScheduleNote.vue](../../src/components/schedule/ScheduleNote.vue) | 43 |
| [src/components/schedule/SemesterModal.vue](../../src/components/schedule/SemesterModal.vue) | 58 |
| [src/components/schedule/TimeBaseSettings.vue](../../src/components/schedule/TimeBaseSettings.vue) | 404 |
| [src/components/schedule/TimeGeneratePanel.vue](../../src/components/schedule/TimeGeneratePanel.vue) | 146 |
| [src/components/schedule/TimeImportPlanModal.vue](../../src/components/schedule/TimeImportPlanModal.vue) | 180 |
| [src/components/schedule/TimeSettingsModal.vue](../../src/components/schedule/TimeSettingsModal.vue) | 800 |
| [src/components/SearchPanel.vue](../../src/components/SearchPanel.vue) | 423 |
| [src/components/Sidebar.vue](../../src/components/Sidebar.vue) | 1020 |
| [src/components/SkeletonBlock.vue](../../src/components/SkeletonBlock.vue) | 70 |
| [src/components/SocialCalendarEvents.vue](../../src/components/SocialCalendarEvents.vue) | 124 |
| [src/components/SwipeActionItem.vue](../../src/components/SwipeActionItem.vue) | 287 |
| [src/components/SwipeActionSelector.vue](../../src/components/SwipeActionSelector.vue) | 80 |
| [src/components/task-views/TaskBoard.vue](../../src/components/task-views/TaskBoard.vue) | 364 |
| [src/components/task-views/TaskCalendar.vue](../../src/components/task-views/TaskCalendar.vue) | 354 |
| [src/components/TaskCenter.vue](../../src/components/TaskCenter.vue) | 343 |
| [src/components/TaskProgress.vue](../../src/components/TaskProgress.vue) | 112 |
| [src/components/tasks/TaskBulkBar.vue](../../src/components/tasks/TaskBulkBar.vue) | 90 |
| [src/components/tasks/TaskBulkRescheduleDialog.vue](../../src/components/tasks/TaskBulkRescheduleDialog.vue) | 82 |
| [src/components/tasks/TaskRescheduleDialog.vue](../../src/components/tasks/TaskRescheduleDialog.vue) | 69 |
| [src/components/tasks/TaskRowActions.vue](../../src/components/tasks/TaskRowActions.vue) | 104 |
| [src/components/tasks/TaskStageAction.vue](../../src/components/tasks/TaskStageAction.vue) | 26 |
| [src/components/tasks/TaskTimeEditor.vue](../../src/components/tasks/TaskTimeEditor.vue) | 182 |
| [src/components/tasks/TaskTimeShift.vue](../../src/components/tasks/TaskTimeShift.vue) | 93 |
| [src/components/tasks/TaskWorkCheckpointFields.vue](../../src/components/tasks/TaskWorkCheckpointFields.vue) | 47 |
| [src/components/tasks/TaskWorkSession.vue](../../src/components/tasks/TaskWorkSession.vue) | 92 |
| [src/components/TimeWheelSheet.vue](../../src/components/TimeWheelSheet.vue) | 142 |
| [src/components/Toast.vue](../../src/components/Toast.vue) | 208 |
| [src/components/TodayActionList.vue](../../src/components/TodayActionList.vue) | 144 |
| [src/components/TodayAgenda.vue](../../src/components/TodayAgenda.vue) | 161 |
| [src/components/UpdateNotes.vue](../../src/components/UpdateNotes.vue) | 43 |
| [src/components/VersionUpdateModal.vue](../../src/components/VersionUpdateModal.vue) | 23 |
| [src/components/VirtualList.vue](../../src/components/VirtualList.vue) | 231 |
| [src/components/WallpaperLayer.vue](../../src/components/WallpaperLayer.vue) | 223 |
| [src/components/WheelPicker.vue](../../src/components/WheelPicker.vue) | 200 |

</details>

<details>
<summary>UI 原语与导出（114 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [src/components/ui/alert/Alert.vue](../../src/components/ui/alert/Alert.vue) | 23 |
| [src/components/ui/alert/AlertDescription.vue](../../src/components/ui/alert/AlertDescription.vue) | 18 |
| [src/components/ui/alert/AlertTitle.vue](../../src/components/ui/alert/AlertTitle.vue) | 18 |
| [src/components/ui/alert/index.ts](../../src/components/ui/alert/index.ts) | 25 |
| [src/components/ui/badge/Badge.vue](../../src/components/ui/badge/Badge.vue) | 27 |
| [src/components/ui/badge/index.ts](../../src/components/ui/badge/index.ts) | 27 |
| [src/components/ui/button/Button.vue](../../src/components/ui/button/Button.vue) | 32 |
| [src/components/ui/button/index.ts](../../src/components/ui/button/index.ts) | 36 |
| [src/components/ui/calendar/Calendar.vue](../../src/components/ui/calendar/Calendar.vue) | 165 |
| [src/components/ui/calendar/CalendarCell.vue](../../src/components/ui/calendar/CalendarCell.vue) | 24 |
| [src/components/ui/calendar/CalendarCellTrigger.vue](../../src/components/ui/calendar/CalendarCellTrigger.vue) | 40 |
| [src/components/ui/calendar/CalendarGrid.vue](../../src/components/ui/calendar/CalendarGrid.vue) | 24 |
| [src/components/ui/calendar/CalendarGridBody.vue](../../src/components/ui/calendar/CalendarGridBody.vue) | 16 |
| [src/components/ui/calendar/CalendarGridHead.vue](../../src/components/ui/calendar/CalendarGridHead.vue) | 17 |
| [src/components/ui/calendar/CalendarGridRow.vue](../../src/components/ui/calendar/CalendarGridRow.vue) | 23 |
| [src/components/ui/calendar/CalendarHeadCell.vue](../../src/components/ui/calendar/CalendarHeadCell.vue) | 24 |
| [src/components/ui/calendar/CalendarHeader.vue](../../src/components/ui/calendar/CalendarHeader.vue) | 24 |
| [src/components/ui/calendar/CalendarHeading.vue](../../src/components/ui/calendar/CalendarHeading.vue) | 31 |
| [src/components/ui/calendar/CalendarNextButton.vue](../../src/components/ui/calendar/CalendarNextButton.vue) | 33 |
| [src/components/ui/calendar/CalendarPrevButton.vue](../../src/components/ui/calendar/CalendarPrevButton.vue) | 33 |
| [src/components/ui/calendar/index.ts](../../src/components/ui/calendar/index.ts) | 15 |
| [src/components/ui/card/Card.vue](../../src/components/ui/card/Card.vue) | 23 |
| [src/components/ui/card/CardAction.vue](../../src/components/ui/card/CardAction.vue) | 18 |
| [src/components/ui/card/CardContent.vue](../../src/components/ui/card/CardContent.vue) | 18 |
| [src/components/ui/card/CardDescription.vue](../../src/components/ui/card/CardDescription.vue) | 18 |
| [src/components/ui/card/CardFooter.vue](../../src/components/ui/card/CardFooter.vue) | 18 |
| [src/components/ui/card/CardHeader.vue](../../src/components/ui/card/CardHeader.vue) | 18 |
| [src/components/ui/card/CardTitle.vue](../../src/components/ui/card/CardTitle.vue) | 18 |
| [src/components/ui/card/index.ts](../../src/components/ui/card/index.ts) | 8 |
| [src/components/ui/checkbox/Checkbox.vue](../../src/components/ui/checkbox/Checkbox.vue) | 36 |
| [src/components/ui/checkbox/index.ts](../../src/components/ui/checkbox/index.ts) | 2 |
| [src/components/ui/dialog/Dialog.vue](../../src/components/ui/dialog/Dialog.vue) | 20 |
| [src/components/ui/dialog/DialogClose.vue](../../src/components/ui/dialog/DialogClose.vue) | 16 |
| [src/components/ui/dialog/DialogContent.vue](../../src/components/ui/dialog/DialogContent.vue) | 54 |
| [src/components/ui/dialog/DialogDescription.vue](../../src/components/ui/dialog/DialogDescription.vue) | 24 |
| [src/components/ui/dialog/DialogFooter.vue](../../src/components/ui/dialog/DialogFooter.vue) | 28 |
| [src/components/ui/dialog/DialogHeader.vue](../../src/components/ui/dialog/DialogHeader.vue) | 18 |
| [src/components/ui/dialog/DialogOverlay.vue](../../src/components/ui/dialog/DialogOverlay.vue) | 22 |
| [src/components/ui/dialog/DialogScrollContent.vue](../../src/components/ui/dialog/DialogScrollContent.vue) | 60 |
| [src/components/ui/dialog/DialogTitle.vue](../../src/components/ui/dialog/DialogTitle.vue) | 24 |
| [src/components/ui/dialog/DialogTrigger.vue](../../src/components/ui/dialog/DialogTrigger.vue) | 16 |
| [src/components/ui/dialog/index.ts](../../src/components/ui/dialog/index.ts) | 11 |
| [src/components/ui/empty/Empty.vue](../../src/components/ui/empty/Empty.vue) | 21 |
| [src/components/ui/empty/EmptyContent.vue](../../src/components/ui/empty/EmptyContent.vue) | 21 |
| [src/components/ui/empty/EmptyDescription.vue](../../src/components/ui/empty/EmptyDescription.vue) | 21 |
| [src/components/ui/empty/EmptyHeader.vue](../../src/components/ui/empty/EmptyHeader.vue) | 21 |
| [src/components/ui/empty/EmptyMedia.vue](../../src/components/ui/empty/EmptyMedia.vue) | 22 |
| [src/components/ui/empty/EmptyTitle.vue](../../src/components/ui/empty/EmptyTitle.vue) | 18 |
| [src/components/ui/empty/index.ts](../../src/components/ui/empty/index.ts) | 27 |
| [src/components/ui/field/Field.vue](../../src/components/ui/field/Field.vue) | 26 |
| [src/components/ui/field/FieldContent.vue](../../src/components/ui/field/FieldContent.vue) | 21 |
| [src/components/ui/field/FieldDescription.vue](../../src/components/ui/field/FieldDescription.vue) | 23 |
| [src/components/ui/field/FieldError.vue](../../src/components/ui/field/FieldError.vue) | 54 |
| [src/components/ui/field/FieldGroup.vue](../../src/components/ui/field/FieldGroup.vue) | 21 |
| [src/components/ui/field/FieldLabel.vue](../../src/components/ui/field/FieldLabel.vue) | 24 |
| [src/components/ui/field/FieldLegend.vue](../../src/components/ui/field/FieldLegend.vue) | 25 |
| [src/components/ui/field/FieldSeparator.vue](../../src/components/ui/field/FieldSeparator.vue) | 30 |
| [src/components/ui/field/FieldSet.vue](../../src/components/ui/field/FieldSet.vue) | 22 |
| [src/components/ui/field/FieldTitle.vue](../../src/components/ui/field/FieldTitle.vue) | 21 |
| [src/components/ui/field/index.ts](../../src/components/ui/field/index.ts) | 40 |
| [src/components/ui/input/index.ts](../../src/components/ui/input/index.ts) | 2 |
| [src/components/ui/input/Input.vue](../../src/components/ui/input/Input.vue) | 34 |
| [src/components/ui/label/index.ts](../../src/components/ui/label/index.ts) | 2 |
| [src/components/ui/label/Label.vue](../../src/components/ui/label/Label.vue) | 27 |
| [src/components/ui/native-select/index.ts](../../src/components/ui/native-select/index.ts) | 4 |
| [src/components/ui/native-select/NativeSelect.vue](../../src/components/ui/native-select/NativeSelect.vue) | 49 |
| [src/components/ui/native-select/NativeSelectOptGroup.vue](../../src/components/ui/native-select/NativeSelectOptGroup.vue) | 13 |
| [src/components/ui/native-select/NativeSelectOption.vue](../../src/components/ui/native-select/NativeSelectOption.vue) | 13 |
| [src/components/ui/popover/index.ts](../../src/components/ui/popover/index.ts) | 8 |
| [src/components/ui/popover/Popover.vue](../../src/components/ui/popover/Popover.vue) | 20 |
| [src/components/ui/popover/PopoverAnchor.vue](../../src/components/ui/popover/PopoverAnchor.vue) | 16 |
| [src/components/ui/popover/PopoverContent.vue](../../src/components/ui/popover/PopoverContent.vue) | 46 |
| [src/components/ui/popover/PopoverDescription.vue](../../src/components/ui/popover/PopoverDescription.vue) | 18 |
| [src/components/ui/popover/PopoverHeader.vue](../../src/components/ui/popover/PopoverHeader.vue) | 18 |
| [src/components/ui/popover/PopoverTitle.vue](../../src/components/ui/popover/PopoverTitle.vue) | 18 |
| [src/components/ui/popover/PopoverTrigger.vue](../../src/components/ui/popover/PopoverTrigger.vue) | 16 |
| [src/components/ui/progress/index.ts](../../src/components/ui/progress/index.ts) | 2 |
| [src/components/ui/progress/Progress.vue](../../src/components/ui/progress/Progress.vue) | 49 |
| [src/components/ui/select/index.ts](../../src/components/ui/select/index.ts) | 12 |
| [src/components/ui/select/Select.vue](../../src/components/ui/select/Select.vue) | 20 |
| [src/components/ui/select/SelectContent.vue](../../src/components/ui/select/SelectContent.vue) | 52 |
| [src/components/ui/select/SelectGroup.vue](../../src/components/ui/select/SelectGroup.vue) | 16 |
| [src/components/ui/select/SelectItem.vue](../../src/components/ui/select/SelectItem.vue) | 45 |
| [src/components/ui/select/SelectItemText.vue](../../src/components/ui/select/SelectItemText.vue) | 16 |
| [src/components/ui/select/SelectLabel.vue](../../src/components/ui/select/SelectLabel.vue) | 18 |
| [src/components/ui/select/SelectScrollDownButton.vue](../../src/components/ui/select/SelectScrollDownButton.vue) | 27 |
| [src/components/ui/select/SelectScrollUpButton.vue](../../src/components/ui/select/SelectScrollUpButton.vue) | 27 |
| [src/components/ui/select/SelectSeparator.vue](../../src/components/ui/select/SelectSeparator.vue) | 20 |
| [src/components/ui/select/SelectTrigger.vue](../../src/components/ui/select/SelectTrigger.vue) | 34 |
| [src/components/ui/select/SelectValue.vue](../../src/components/ui/select/SelectValue.vue) | 16 |
| [src/components/ui/separator/index.ts](../../src/components/ui/separator/index.ts) | 2 |
| [src/components/ui/separator/Separator.vue](../../src/components/ui/separator/Separator.vue) | 30 |
| [src/components/ui/spinner/index.ts](../../src/components/ui/spinner/index.ts) | 2 |
| [src/components/ui/spinner/Spinner.vue](../../src/components/ui/spinner/Spinner.vue) | 15 |
| [src/components/ui/table/index.ts](../../src/components/ui/table/index.ts) | 10 |
| [src/components/ui/table/Table.vue](../../src/components/ui/table/Table.vue) | 17 |
| [src/components/ui/table/TableBody.vue](../../src/components/ui/table/TableBody.vue) | 18 |
| [src/components/ui/table/TableCaption.vue](../../src/components/ui/table/TableCaption.vue) | 18 |
| [src/components/ui/table/TableCell.vue](../../src/components/ui/table/TableCell.vue) | 23 |
| [src/components/ui/table/TableEmpty.vue](../../src/components/ui/table/TableEmpty.vue) | 35 |
| [src/components/ui/table/TableFooter.vue](../../src/components/ui/table/TableFooter.vue) | 18 |
| [src/components/ui/table/TableHead.vue](../../src/components/ui/table/TableHead.vue) | 21 |
| [src/components/ui/table/TableHeader.vue](../../src/components/ui/table/TableHeader.vue) | 18 |
| [src/components/ui/table/TableRow.vue](../../src/components/ui/table/TableRow.vue) | 18 |
| [src/components/ui/tabs/index.ts](../../src/components/ui/tabs/index.ts) | 5 |
| [src/components/ui/tabs/Tabs.vue](../../src/components/ui/tabs/Tabs.vue) | 25 |
| [src/components/ui/tabs/TabsContent.vue](../../src/components/ui/tabs/TabsContent.vue) | 22 |
| [src/components/ui/tabs/TabsList.vue](../../src/components/ui/tabs/TabsList.vue) | 25 |
| [src/components/ui/tabs/TabsTrigger.vue](../../src/components/ui/tabs/TabsTrigger.vue) | 27 |
| [src/components/ui/toggle-group/index.ts](../../src/components/ui/toggle-group/index.ts) | 3 |
| [src/components/ui/toggle-group/ToggleGroup.vue](../../src/components/ui/toggle-group/ToggleGroup.vue) | 50 |
| [src/components/ui/toggle-group/ToggleGroupItem.vue](../../src/components/ui/toggle-group/ToggleGroupItem.vue) | 46 |
| [src/components/ui/toggle/index.ts](../../src/components/ui/toggle/index.ts) | 28 |
| [src/components/ui/toggle/Toggle.vue](../../src/components/ui/toggle/Toggle.vue) | 36 |

</details>

<details>
<summary>业务页面与账本子面板（27 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [src/views/course-progress.css](../../src/views/course-progress.css) | 117 |
| [src/views/CourseArchiveView.vue](../../src/views/CourseArchiveView.vue) | 274 |
| [src/views/EventsView.vue](../../src/views/EventsView.vue) | 413 |
| [src/views/exams.css](../../src/views/exams.css) | 367 |
| [src/views/ExamsView.vue](../../src/views/ExamsView.vue) | 891 |
| [src/views/ledger-panels/BillFormModal.vue](../../src/views/ledger-panels/BillFormModal.vue) | 473 |
| [src/views/ledger-panels/BillsPanel.vue](../../src/views/ledger-panels/BillsPanel.vue) | 245 |
| [src/views/ledger-panels/BudgetSettingsModal.vue](../../src/views/ledger-panels/BudgetSettingsModal.vue) | 133 |
| [src/views/ledger-panels/FxSettingsModal.vue](../../src/views/ledger-panels/FxSettingsModal.vue) | 165 |
| [src/views/ledger-panels/LedgerBudgetCard.vue](../../src/views/ledger-panels/LedgerBudgetCard.vue) | 198 |
| [src/views/ledger-panels/LedgerHomePanel.vue](../../src/views/ledger-panels/LedgerHomePanel.vue) | 768 |
| [src/views/ledger-panels/MonthlyTrendCard.vue](../../src/views/ledger-panels/MonthlyTrendCard.vue) | 359 |
| [src/views/ledger-panels/QuickEntryModal.vue](../../src/views/ledger-panels/QuickEntryModal.vue) | 479 |
| [src/views/ledger-panels/ReviewPanel.vue](../../src/views/ledger-panels/ReviewPanel.vue) | 580 |
| [src/views/ledger-panels/TransactionDetailModal.vue](../../src/views/ledger-panels/TransactionDetailModal.vue) | 290 |
| [src/views/ledger-panels/TransactionImportDialog.vue](../../src/views/ledger-panels/TransactionImportDialog.vue) | 598 |
| [src/views/LedgerView.vue](../../src/views/LedgerView.vue) | 1161 |
| [src/views/ListsView.vue](../../src/views/ListsView.vue) | 761 |
| [src/views/projects.css](../../src/views/projects.css) | 292 |
| [src/views/ProjectsView.vue](../../src/views/ProjectsView.vue) | 1536 |
| [src/views/ScheduleView.vue](../../src/views/ScheduleView.vue) | 1137 |
| [src/views/tasks.css](../../src/views/tasks.css) | 373 |
| [src/views/TasksView.vue](../../src/views/TasksView.vue) | 984 |
| [src/views/TodayView.vue](../../src/views/TodayView.vue) | 992 |
| [src/views/together.css](../../src/views/together.css) | 180 |
| [src/views/TogetherView.vue](../../src/views/TogetherView.vue) | 862 |
| [src/views/WeeklyReviewView.vue](../../src/views/WeeklyReviewView.vue) | 482 |

</details>

<details>
<summary>状态、领域、存储、同步、权限与交互逻辑（218 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [src/composables/accountAuth.js](../../src/composables/accountAuth.js) | 346 |
| [src/composables/accountEmailCooldown.js](../../src/composables/accountEmailCooldown.js) | 45 |
| [src/composables/accountLocalData.js](../../src/composables/accountLocalData.js) | 314 |
| [src/composables/accountLogoutCleanup.js](../../src/composables/accountLogoutCleanup.js) | 9 |
| [src/composables/accountSyncData.js](../../src/composables/accountSyncData.js) | 185 |
| [src/composables/accountSyncEngine.js](../../src/composables/accountSyncEngine.js) | 569 |
| [src/composables/accountSyncIdentity.js](../../src/composables/accountSyncIdentity.js) | 50 |
| [src/composables/accountSyncLifecycle.js](../../src/composables/accountSyncLifecycle.js) | 153 |
| [src/composables/accountSyncMode.js](../../src/composables/accountSyncMode.js) | 63 |
| [src/composables/accountSyncSchema.js](../../src/composables/accountSyncSchema.js) | 3 |
| [src/composables/accountSyncState.js](../../src/composables/accountSyncState.js) | 16 |
| [src/composables/actionFeedback.js](../../src/composables/actionFeedback.js) | 141 |
| [src/composables/anniversarySchedule.js](../../src/composables/anniversarySchedule.js) | 266 |
| [src/composables/appearance.js](../../src/composables/appearance.js) | 126 |
| [src/composables/appearanceFeedback.js](../../src/composables/appearanceFeedback.js) | 35 |
| [src/composables/appUpdate.js](../../src/composables/appUpdate.js) | 80 |
| [src/composables/asyncTask.js](../../src/composables/asyncTask.js) | 59 |
| [src/composables/atmosphereStore.js](../../src/composables/atmosphereStore.js) | 21 |
| [src/composables/backupArchive.js](../../src/composables/backupArchive.js) | 314 |
| [src/composables/backupReminder.js](../../src/composables/backupReminder.js) | 27 |
| [src/composables/backupRestore.js](../../src/composables/backupRestore.js) | 15 |
| [src/composables/checklists.js](../../src/composables/checklists.js) | 236 |
| [src/composables/collaborationContext.js](../../src/composables/collaborationContext.js) | 72 |
| [src/composables/conflictDetection.js](../../src/composables/conflictDetection.js) | 259 |
| [src/composables/contrast.js](../../src/composables/contrast.js) | 27 |
| [src/composables/courseImport.js](../../src/composables/courseImport.js) | 110 |
| [src/composables/courseLinks.js](../../src/composables/courseLinks.js) | 8 |
| [src/composables/courseParser.js](../../src/composables/courseParser.js) | 372 |
| [src/composables/coursePeriodMigration.js](../../src/composables/coursePeriodMigration.js) | 27 |
| [src/composables/courseProgress.js](../../src/composables/courseProgress.js) | 167 |
| [src/composables/courseTemplates.js](../../src/composables/courseTemplates.js) | 42 |
| [src/composables/courseTime.js](../../src/composables/courseTime.js) | 18 |
| [src/composables/dataManagerBackup.js](../../src/composables/dataManagerBackup.js) | 439 |
| [src/composables/dataManagerFeedback.js](../../src/composables/dataManagerFeedback.js) | 8 |
| [src/composables/dataManagerInventory.js](../../src/composables/dataManagerInventory.js) | 89 |
| [src/composables/dataVault.js](../../src/composables/dataVault.js) | 575 |
| [src/composables/desktopAppUpdate.js](../../src/composables/desktopAppUpdate.js) | 110 |
| [src/composables/deviceIdentity.js](../../src/composables/deviceIdentity.js) | 54 |
| [src/composables/domain/checklistModel.js](../../src/composables/domain/checklistModel.js) | 183 |
| [src/composables/domain/commands.js](../../src/composables/domain/commands.js) | 809 |
| [src/composables/domain/migrations.js](../../src/composables/domain/migrations.js) | 37 |
| [src/composables/domain/relations.js](../../src/composables/domain/relations.js) | 12 |
| [src/composables/domain/selectors.js](../../src/composables/domain/selectors.js) | 165 |
| [src/composables/domain/state.js](../../src/composables/domain/state.js) | 63 |
| [src/composables/domain/weeklySelectors.js](../../src/composables/domain/weeklySelectors.js) | 203 |
| [src/composables/domainCsvImport.js](../../src/composables/domainCsvImport.js) | 244 |
| [src/composables/drawerDrag.js](../../src/composables/drawerDrag.js) | 177 |
| [src/composables/emergencyExport.js](../../src/composables/emergencyExport.js) | 61 |
| [src/composables/events/eventCalendarExport.js](../../src/composables/events/eventCalendarExport.js) | 70 |
| [src/composables/events/eventConflicts.js](../../src/composables/events/eventConflicts.js) | 25 |
| [src/composables/events/eventFields.js](../../src/composables/events/eventFields.js) | 27 |
| [src/composables/events/eventPlanning.js](../../src/composables/events/eventPlanning.js) | 115 |
| [src/composables/events/useEventEditor.js](../../src/composables/events/useEventEditor.js) | 123 |
| [src/composables/excelTimetableParser.js](../../src/composables/excelTimetableParser.js) | 147 |
| [src/composables/experience.js](../../src/composables/experience.js) | 135 |
| [src/composables/festive.js](../../src/composables/festive.js) | 267 |
| [src/composables/festiveAtmosphere.js](../../src/composables/festiveAtmosphere.js) | 65 |
| [src/composables/floatingStack.js](../../src/composables/floatingStack.js) | 68 |
| [src/composables/focusNavigation.js](../../src/composables/focusNavigation.js) | 96 |
| [src/composables/focusReturn.js](../../src/composables/focusReturn.js) | 35 |
| [src/composables/focusSettingsEditor.js](../../src/composables/focusSettingsEditor.js) | 47 |
| [src/composables/focusTimer.js](../../src/composables/focusTimer.js) | 226 |
| [src/composables/foodRetirement.js](../../src/composables/foodRetirement.js) | 114 |
| [src/composables/globalError.js](../../src/composables/globalError.js) | 94 |
| [src/composables/globalSearch.js](../../src/composables/globalSearch.js) | 21 |
| [src/composables/home/nextUp.js](../../src/composables/home/nextUp.js) | 98 |
| [src/composables/homeModules.js](../../src/composables/homeModules.js) | 40 |
| [src/composables/icalImport.js](../../src/composables/icalImport.js) | 264 |
| [src/composables/imageCropSizing.js](../../src/composables/imageCropSizing.js) | 19 |
| [src/composables/intlFormatters.js](../../src/composables/intlFormatters.js) | 41 |
| [src/composables/latestTask.js](../../src/composables/latestTask.js) | 39 |
| [src/composables/learningFocus.js](../../src/composables/learningFocus.js) | 6 |
| [src/composables/learningPlan.js](../../src/composables/learningPlan.js) | 101 |
| [src/composables/ledger.js](../../src/composables/ledger.js) | 642 |
| [src/composables/ledgerBillImport.js](../../src/composables/ledgerBillImport.js) | 376 |
| [src/composables/ledgerBudget.js](../../src/composables/ledgerBudget.js) | 211 |
| [src/composables/ledgerCategories.js](../../src/composables/ledgerCategories.js) | 282 |
| [src/composables/ledgerFx.js](../../src/composables/ledgerFx.js) | 344 |
| [src/composables/ledgerRelations.js](../../src/composables/ledgerRelations.js) | 23 |
| [src/composables/ledgerSplit.js](../../src/composables/ledgerSplit.js) | 206 |
| [src/composables/ledgerSwipe.js](../../src/composables/ledgerSwipe.js) | 23 |
| [src/composables/ledgerTemplates.js](../../src/composables/ledgerTemplates.js) | 104 |
| [src/composables/ledgerView/bills.js](../../src/composables/ledgerView/bills.js) | 119 |
| [src/composables/ledgerView/export.js](../../src/composables/ledgerView/export.js) | 308 |
| [src/composables/ledgerView/feed.js](../../src/composables/ledgerView/feed.js) | 220 |
| [src/composables/ledgerView/review.js](../../src/composables/ledgerView/review.js) | 263 |
| [src/composables/ledgerView/spendStats.js](../../src/composables/ledgerView/spendStats.js) | 170 |
| [src/composables/ledgerView/useLedgerCategoryManager.js](../../src/composables/ledgerView/useLedgerCategoryManager.js) | 272 |
| [src/composables/ledgerView/useLedgerFxBudget.js](../../src/composables/ledgerView/useLedgerFxBudget.js) | 71 |
| [src/composables/ledgerView/useQuickEntryForm.js](../../src/composables/ledgerView/useQuickEntryForm.js) | 408 |
| [src/composables/ledgerView/useTransactionDetail.js](../../src/composables/ledgerView/useTransactionDetail.js) | 338 |
| [src/composables/liveRegion.js](../../src/composables/liveRegion.js) | 86 |
| [src/composables/localSafeMode.js](../../src/composables/localSafeMode.js) | 13 |
| [src/composables/localStorageUsage.js](../../src/composables/localStorageUsage.js) | 21 |
| [src/composables/longPress.js](../../src/composables/longPress.js) | 81 |
| [src/composables/lunar.js](../../src/composables/lunar.js) | 313 |
| [src/composables/lunarAnniversaries.js](../../src/composables/lunarAnniversaries.js) | 457 |
| [src/composables/lunarAnniversaryEditor.js](../../src/composables/lunarAnniversaryEditor.js) | 176 |
| [src/composables/menuPlacement.js](../../src/composables/menuPlacement.js) | 48 |
| [src/composables/modalSections.js](../../src/composables/modalSections.js) | 13 |
| [src/composables/monthlyTrendChart.js](../../src/composables/monthlyTrendChart.js) | 104 |
| [src/composables/mood.js](../../src/composables/mood.js) | 127 |
| [src/composables/motion.js](../../src/composables/motion.js) | 157 |
| [src/composables/narrative.js](../../src/composables/narrative.js) | 84 |
| [src/composables/narrativeLanguages.js](../../src/composables/narrativeLanguages.js) | 24 |
| [src/composables/navigationEditor.js](../../src/composables/navigationEditor.js) | 278 |
| [src/composables/navigationPreferences.js](../../src/composables/navigationPreferences.js) | 142 |
| [src/composables/navigationViewModel.js](../../src/composables/navigationViewModel.js) | 60 |
| [src/composables/noticeParser.js](../../src/composables/noticeParser.js) | 589 |
| [src/composables/noticeSegments.js](../../src/composables/noticeSegments.js) | 346 |
| [src/composables/ocrPipeline.js](../../src/composables/ocrPipeline.js) | 729 |
| [src/composables/ocrService.js](../../src/composables/ocrService.js) | 21 |
| [src/composables/ocrVocabulary.js](../../src/composables/ocrVocabulary.js) | 102 |
| [src/composables/overlayStack.js](../../src/composables/overlayStack.js) | 242 |
| [src/composables/pendingFieldEdits.js](../../src/composables/pendingFieldEdits.js) | 62 |
| [src/composables/performanceMode.js](../../src/composables/performanceMode.js) | 48 |
| [src/composables/planningViews.js](../../src/composables/planningViews.js) | 114 |
| [src/composables/projectMeetingBridge.js](../../src/composables/projectMeetingBridge.js) | 112 |
| [src/composables/projects/projectEditorScope.js](../../src/composables/projects/projectEditorScope.js) | 15 |
| [src/composables/projects/projectRequestScope.js](../../src/composables/projects/projectRequestScope.js) | 29 |
| [src/composables/projects/projectTaskCheckpoints.js](../../src/composables/projects/projectTaskCheckpoints.js) | 32 |
| [src/composables/projects/projectTaskSelectors.js](../../src/composables/projects/projectTaskSelectors.js) | 106 |
| [src/composables/projects/taskEventLabel.js](../../src/composables/projects/taskEventLabel.js) | 18 |
| [src/composables/projects/useProjectDeliverableEditor.js](../../src/composables/projects/useProjectDeliverableEditor.js) | 250 |
| [src/composables/projects/useProjectMeetings.js](../../src/composables/projects/useProjectMeetings.js) | 126 |
| [src/composables/projects/useProjectTaskActions.js](../../src/composables/projects/useProjectTaskActions.js) | 21 |
| [src/composables/projects/useProjectTaskWorkbench.js](../../src/composables/projects/useProjectTaskWorkbench.js) | 126 |
| [src/composables/projectTaskBridge.js](../../src/composables/projectTaskBridge.js) | 247 |
| [src/composables/pwaStartupRecovery.js](../../src/composables/pwaStartupRecovery.js) | 125 |
| [src/composables/quickCapture.js](../../src/composables/quickCapture.js) | 81 |
| [src/composables/quickRecord/adapters.js](../../src/composables/quickRecord/adapters.js) | 47 |
| [src/composables/quickRecord/contracts.ts](../../src/composables/quickRecord/contracts.ts) | 55 |
| [src/composables/quickRecord/draftStorage.js](../../src/composables/quickRecord/draftStorage.js) | 37 |
| [src/composables/quickRecord/entities.js](../../src/composables/quickRecord/entities.js) | 217 |
| [src/composables/quickRecord/parser.js](../../src/composables/quickRecord/parser.js) | 254 |
| [src/composables/quickRecord/types.js](../../src/composables/quickRecord/types.js) | 32 |
| [src/composables/quickRecord/workflow.js](../../src/composables/quickRecord/workflow.js) | 62 |
| [src/composables/recognitionSchemes.js](../../src/composables/recognitionSchemes.js) | 230 |
| [src/composables/releaseNotes.js](../../src/composables/releaseNotes.js) | 55 |
| [src/composables/reminderScheduler.js](../../src/composables/reminderScheduler.js) | 298 |
| [src/composables/retiredData.js](../../src/composables/retiredData.js) | 39 |
| [src/composables/retireLegacySyncState.js](../../src/composables/retireLegacySyncState.js) | 44 |
| [src/composables/retrospective.js](../../src/composables/retrospective.js) | 246 |
| [src/composables/reviewCharts.js](../../src/composables/reviewCharts.js) | 483 |
| [src/composables/routeState.js](../../src/composables/routeState.js) | 6 |
| [src/composables/schedule/useScheduleGrid.js](../../src/composables/schedule/useScheduleGrid.js) | 77 |
| [src/composables/scheduleBatchText.js](../../src/composables/scheduleBatchText.js) | 199 |
| [src/composables/scheduleCampusSeason.js](../../src/composables/scheduleCampusSeason.js) | 104 |
| [src/composables/scheduleCourseForm.js](../../src/composables/scheduleCourseForm.js) | 176 |
| [src/composables/scheduleCourseManager.js](../../src/composables/scheduleCourseManager.js) | 140 |
| [src/composables/scheduleFocusRoute.js](../../src/composables/scheduleFocusRoute.js) | 63 |
| [src/composables/scheduleImportReview.js](../../src/composables/scheduleImportReview.js) | 215 |
| [src/composables/scheduleOcrFlow.js](../../src/composables/scheduleOcrFlow.js) | 221 |
| [src/composables/scheduleOcrImport.js](../../src/composables/scheduleOcrImport.js) | 348 |
| [src/composables/scheduleOcrParser.js](../../src/composables/scheduleOcrParser.js) | 575 |
| [src/composables/scheduleRecognition.js](../../src/composables/scheduleRecognition.js) | 658 |
| [src/composables/searchRelevance.js](../../src/composables/searchRelevance.js) | 154 |
| [src/composables/settingsPolicy.js](../../src/composables/settingsPolicy.js) | 171 |
| [src/composables/sheetDrag.js](../../src/composables/sheetDrag.js) | 104 |
| [src/composables/smartClassify.js](../../src/composables/smartClassify.js) | 133 |
| [src/composables/startupData.js](../../src/composables/startupData.js) | 43 |
| [src/composables/startupDiagnostics.js](../../src/composables/startupDiagnostics.js) | 78 |
| [src/composables/startupGate.js](../../src/composables/startupGate.js) | 42 |
| [src/composables/startupStatus.js](../../src/composables/startupStatus.js) | 31 |
| [src/composables/store/cloudAccess.js](../../src/composables/store/cloudAccess.js) | 4 |
| [src/composables/store/core.js](../../src/composables/store/core.js) | 677 |
| [src/composables/store/countdown.js](../../src/composables/store/countdown.js) | 89 |
| [src/composables/store/index.js](../../src/composables/store/index.js) | 5 |
| [src/composables/store/schedule.js](../../src/composables/store/schedule.js) | 368 |
| [src/composables/store/timeConfig.js](../../src/composables/store/timeConfig.js) | 390 |
| [src/composables/store/utils.js](../../src/composables/store/utils.js) | 151 |
| [src/composables/studyBlockSuggestions.js](../../src/composables/studyBlockSuggestions.js) | 116 |
| [src/composables/syncIntegrity.js](../../src/composables/syncIntegrity.js) | 57 |
| [src/composables/syncKeys.js](../../src/composables/syncKeys.js) | 74 |
| [src/composables/syncMerge.js](../../src/composables/syncMerge.js) | 184 |
| [src/composables/syncMetadata.js](../../src/composables/syncMetadata.js) | 293 |
| [src/composables/tabKeys.js](../../src/composables/tabKeys.js) | 64 |
| [src/composables/taskCenter.js](../../src/composables/taskCenter.js) | 213 |
| [src/composables/taskProgress.js](../../src/composables/taskProgress.js) | 229 |
| [src/composables/taskRecurrence.js](../../src/composables/taskRecurrence.js) | 192 |
| [src/composables/tasks/taskRepeatCommand.js](../../src/composables/tasks/taskRepeatCommand.js) | 54 |
| [src/composables/tasks/taskTimeFields.ts](../../src/composables/tasks/taskTimeFields.ts) | 49 |
| [src/composables/tasks/taskTimePlan.ts](../../src/composables/tasks/taskTimePlan.ts) | 195 |
| [src/composables/tasks/taskTimeShift.ts](../../src/composables/tasks/taskTimeShift.ts) | 120 |
| [src/composables/tasks/taskViewQuery.js](../../src/composables/tasks/taskViewQuery.js) | 160 |
| [src/composables/tasks/taskWorkProgress.js](../../src/composables/tasks/taskWorkProgress.js) | 63 |
| [src/composables/tasks/useTaskBulkActions.js](../../src/composables/tasks/useTaskBulkActions.js) | 201 |
| [src/composables/tasks/useTaskEditor.js](../../src/composables/tasks/useTaskEditor.js) | 255 |
| [src/composables/tasks/useTaskRouteFocus.js](../../src/composables/tasks/useTaskRouteFocus.js) | 68 |
| [src/composables/tasks/useTaskRowActions.js](../../src/composables/tasks/useTaskRowActions.js) | 85 |
| [src/composables/tasks/useTaskSelection.js](../../src/composables/tasks/useTaskSelection.js) | 60 |
| [src/composables/tasks/useTaskStageActions.ts](../../src/composables/tasks/useTaskStageActions.ts) | 71 |
| [src/composables/tasks/useTaskViewQuery.js](../../src/composables/tasks/useTaskViewQuery.js) | 102 |
| [src/composables/tasks/useTaskWorkSession.js](../../src/composables/tasks/useTaskWorkSession.js) | 74 |
| [src/composables/tasks/useTaskWorkspaceSelection.js](../../src/composables/tasks/useTaskWorkspaceSelection.js) | 99 |
| [src/composables/taskViews.js](../../src/composables/taskViews.js) | 164 |
| [src/composables/theme.js](../../src/composables/theme.js) | 290 |
| [src/composables/timeContext.js](../../src/composables/timeContext.js) | 74 |
| [src/composables/timeGenerate.js](../../src/composables/timeGenerate.js) | 107 |
| [src/composables/timeImportPlan.js](../../src/composables/timeImportPlan.js) | 238 |
| [src/composables/timePlanDraft.js](../../src/composables/timePlanDraft.js) | 246 |
| [src/composables/timePlanTools.js](../../src/composables/timePlanTools.js) | 104 |
| [src/composables/timeSettingsShared.js](../../src/composables/timeSettingsShared.js) | 40 |
| [src/composables/timetableLayoutParser.js](../../src/composables/timetableLayoutParser.js) | 606 |
| [src/composables/updatePresentation.js](../../src/composables/updatePresentation.js) | 35 |
| [src/composables/updateProtocol.js](../../src/composables/updateProtocol.js) | 48 |
| [src/composables/useDebouncedRef.js](../../src/composables/useDebouncedRef.js) | 59 |
| [src/composables/usePageShortcuts.js](../../src/composables/usePageShortcuts.js) | 39 |
| [src/composables/useQuickRecordPanel.js](../../src/composables/useQuickRecordPanel.js) | 732 |
| [src/composables/useShareText.js](../../src/composables/useShareText.js) | 60 |
| [src/composables/useToastQueue.js](../../src/composables/useToastQueue.js) | 40 |
| [src/composables/viewScrollMemory.js](../../src/composables/viewScrollMemory.js) | 68 |
| [src/composables/voiceInput.js](../../src/composables/voiceInput.js) | 194 |
| [src/composables/wallpaperStorage.js](../../src/composables/wallpaperStorage.js) | 369 |
| [src/composables/webUpdateController.js](../../src/composables/webUpdateController.js) | 365 |
| [src/composables/weeklyReflections.js](../../src/composables/weeklyReflections.js) | 39 |
| [src/composables/wheelPicker.js](../../src/composables/wheelPicker.js) | 97 |
| [src/composables/zonedTime.js](../../src/composables/zonedTime.js) | 110 |

</details>

<details>
<summary>服务端与 Supabase 配置/迁移/测试（20 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [functions/api/_middleware.js](../../functions/api/_middleware.js) | 13 |
| [supabase/config.toml](../../supabase/config.toml) | 5 |
| [supabase/functions/campus-social/availability.js](../../supabase/functions/campus-social/availability.js) | 331 |
| [supabase/functions/campus-social/index.ts](../../supabase/functions/campus-social/index.ts) | 908 |
| [supabase/migrations/20261006170314_account_sync_snapshots.sql](../../supabase/migrations/20261006170314_account_sync_snapshots.sql) | 82 |
| [supabase/migrations/20261006170752_account_sync_required_fields.sql](../../supabase/migrations/20261006170752_account_sync_required_fields.sql) | 8 |
| [supabase/migrations/20261008045623_friend_collaboration.sql](../../supabase/migrations/20261008045623_friend_collaboration.sql) | 727 |
| [supabase/migrations/20261008045755_social_foreign_key_indexes.sql](../../supabase/migrations/20261008045755_social_foreign_key_indexes.sql) | 5 |
| [supabase/migrations/20261008050343_social_rate_buckets_rls.sql](../../supabase/migrations/20261008050343_social_rate_buckets_rls.sql) | 10 |
| [supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql](../../supabase/migrations/20261008063633_qixing_project_collaboration_schema.sql) | 345 |
| [supabase/migrations/20261008064042_qixing_project_collaboration_dispatch.sql](../../supabase/migrations/20261008064042_qixing_project_collaboration_dispatch.sql) | 1543 |
| [supabase/migrations/20261008064136_qixing_project_collaboration_fk_indexes.sql](../../supabase/migrations/20261008064136_qixing_project_collaboration_fk_indexes.sql) | 43 |
| [supabase/migrations/20261008090340_retire_quick_notes.sql](../../supabase/migrations/20261008090340_retire_quick_notes.sql) | 219 |
| [supabase/migrations/20261008122338_social_storage_write_policy_hardening.sql](../../supabase/migrations/20261008122338_social_storage_write_policy_hardening.sql) | 16 |
| [supabase/migrations/20261009072859_qixing_task_workbench.sql](../../supabase/migrations/20261009072859_qixing_task_workbench.sql) | 132 |
| [supabase/migrations/20261010050926_collaboration_integrity_guards.sql](../../supabase/migrations/20261010050926_collaboration_integrity_guards.sql) | 152 |
| [supabase/migrations/20261010061000_qixing_submit_revision_guard.sql](../../supabase/migrations/20261010061000_qixing_submit_revision_guard.sql) | 44 |
| [supabase/tests/account_sync.sql](../../supabase/tests/account_sync.sql) | 73 |
| [supabase/tests/collaboration_integrity.sql](../../supabase/tests/collaboration_integrity.sql) | 126 |
| [supabase/tests/qixing_submit_revision.sql](../../supabase/tests/qixing_submit_revision.sql) | 41 |

</details>

<details>
<summary>桌面与平台桥（5 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [desktop-app/cachePaths.cjs](../../desktop-app/cachePaths.cjs) | 16 |
| [desktop-app/main.cjs](../../desktop-app/main.cjs) | 386 |
| [desktop-app/preload.cjs](../../desktop-app/preload.cjs) | 21 |
| [desktop-app/updaterController.cjs](../../desktop-app/updaterController.cjs) | 259 |
| [desktop/pwa-register-shim.js](../../desktop/pwa-register-shim.js) | 3 |

</details>

<details>
<summary>工程脚本与工作流（28 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | 108 |
| [.github/workflows/desktop-release.yml](../../.github/workflows/desktop-release.yml) | 80 |
| [scripts/audit-contrast.mjs](../../scripts/audit-contrast.mjs) | 887 |
| [scripts/audit/boot-verdict.mjs](../../scripts/audit/boot-verdict.mjs) | 14 |
| [scripts/audit/first-visit.mjs](../../scripts/audit/first-visit.mjs) | 260 |
| [scripts/audit/interaction-browser.mjs](../../scripts/audit/interaction-browser.mjs) | 254 |
| [scripts/audit/interactions.mjs](../../scripts/audit/interactions.mjs) | 93 |
| [scripts/audit/iphone-boot.mjs](../../scripts/audit/iphone-boot.mjs) | 262 |
| [scripts/audit/release-integrity.mjs](../../scripts/audit/release-integrity.mjs) | 338 |
| [scripts/audit/reload-loop.mjs](../../scripts/audit/reload-loop.mjs) | 297 |
| [scripts/audit/route-loading.mjs](../../scripts/audit/route-loading.mjs) | 153 |
| [scripts/audit/shared.mjs](../../scripts/audit/shared.mjs) | 333 |
| [scripts/bump-release.mjs](../../scripts/bump-release.mjs) | 177 |
| [scripts/check-release-readme.mjs](../../scripts/check-release-readme.mjs) | 22 |
| [scripts/css-rules.mjs](../../scripts/css-rules.mjs) | 130 |
| [scripts/deploy-production.mjs](../../scripts/deploy-production.mjs) | 59 |
| [scripts/desktop-signature.mjs](../../scripts/desktop-signature.mjs) | 18 |
| [scripts/desktop-update-source.mjs](../../scripts/desktop-update-source.mjs) | 7 |
| [scripts/release-readme.mjs](../../scripts/release-readme.mjs) | 42 |
| [scripts/source-signature.mjs](../../scripts/source-signature.mjs) | 80 |
| [scripts/supabase-build-checks.mjs](../../scripts/supabase-build-checks.mjs) | 73 |
| [scripts/typecheck-baseline.mjs](../../scripts/typecheck-baseline.mjs) | 43 |
| [scripts/typecheck-ratchet.mjs](../../scripts/typecheck-ratchet.mjs) | 147 |
| [scripts/verify-desktop-package.mjs](../../scripts/verify-desktop-package.mjs) | 97 |
| [scripts/verify-pages-config.mjs](../../scripts/verify-pages-config.mjs) | 45 |
| [scripts/verify-supabase-bundle.mjs](../../scripts/verify-supabase-bundle.mjs) | 14 |
| [scripts/verify-supabase-config.mjs](../../scripts/verify-supabase-config.mjs) | 10 |
| [scripts/version-utils.mjs](../../scripts/version-utils.mjs) | 146 |

</details>

<details>
<summary>自动测试、辅助与夹具（321 文件）</summary>

| 文件 | 行数 |
| --- | --- |
| [tests/accessibleNames.test.js](../../tests/accessibleNames.test.js) | 127 |
| [tests/accountAuth.test.js](../../tests/accountAuth.test.js) | 386 |
| [tests/accountLocalData.test.js](../../tests/accountLocalData.test.js) | 131 |
| [tests/accountPanel.test.js](../../tests/accountPanel.test.js) | 256 |
| [tests/accountPasswordVerification.test.js](../../tests/accountPasswordVerification.test.js) | 56 |
| [tests/accountSyncData.test.js](../../tests/accountSyncData.test.js) | 92 |
| [tests/accountSyncEngine.test.js](../../tests/accountSyncEngine.test.js) | 314 |
| [tests/accountSyncLifecycle.test.js](../../tests/accountSyncLifecycle.test.js) | 82 |
| [tests/accountSyncTransport.test.js](../../tests/accountSyncTransport.test.js) | 69 |
| [tests/actionButtonErrorBoundary.test.js](../../tests/actionButtonErrorBoundary.test.js) | 23 |
| [tests/actionFeedback.test.js](../../tests/actionFeedback.test.js) | 145 |
| [tests/anniversaryAnimation.test.js](../../tests/anniversaryAnimation.test.js) | 203 |
| [tests/anniversarySchedule.test.js](../../tests/anniversarySchedule.test.js) | 309 |
| [tests/appearanceFeedback.test.js](../../tests/appearanceFeedback.test.js) | 57 |
| [tests/appShellAnnouncements.test.js](../../tests/appShellAnnouncements.test.js) | 177 |
| [tests/appUpdateActivation.test.js](../../tests/appUpdateActivation.test.js) | 103 |
| [tests/appUpdateLatency.test.js](../../tests/appUpdateLatency.test.js) | 233 |
| [tests/archiveWeekly.test.js](../../tests/archiveWeekly.test.js) | 121 |
| [tests/ariaHiddenFocusable.test.js](../../tests/ariaHiddenFocusable.test.js) | 172 |
| [tests/asyncTask.test.js](../../tests/asyncTask.test.js) | 26 |
| [tests/auditFixes.test.js](../../tests/auditFixes.test.js) | 107 |
| [tests/backupArchive.test.js](../../tests/backupArchive.test.js) | 109 |
| [tests/backupIntegrity.test.js](../../tests/backupIntegrity.test.js) | 163 |
| [tests/backupRestore.test.js](../../tests/backupRestore.test.js) | 35 |
| [tests/checklistModel.test.js](../../tests/checklistModel.test.js) | 55 |
| [tests/checklists.test.js](../../tests/checklists.test.js) | 136 |
| [tests/checklistsInteractions.test.js](../../tests/checklistsInteractions.test.js) | 174 |
| [tests/componentDeadCss.test.js](../../tests/componentDeadCss.test.js) | 209 |
| [tests/componentEmitContract.test.js](../../tests/componentEmitContract.test.js) | 238 |
| [tests/confirmDialogMigration.test.js](../../tests/confirmDialogMigration.test.js) | 805 |
| [tests/conflictDetection.test.js](../../tests/conflictDetection.test.js) | 56 |
| [tests/contextMenu.test.js](../../tests/contextMenu.test.js) | 252 |
| [tests/contrastAudit.test.js](../../tests/contrastAudit.test.js) | 860 |
| [tests/countdown.test.js](../../tests/countdown.test.js) | 78 |
| [tests/courierAbsence.test.js](../../tests/courierAbsence.test.js) | 61 |
| [tests/courseImport.test.js](../../tests/courseImport.test.js) | 41 |
| [tests/courseLinksNavigation.test.js](../../tests/courseLinksNavigation.test.js) | 34 |
| [tests/courseParser.test.js](../../tests/courseParser.test.js) | 58 |
| [tests/coursePeriodMigration.test.js](../../tests/coursePeriodMigration.test.js) | 24 |
| [tests/courseProgress.test.js](../../tests/courseProgress.test.js) | 121 |
| [tests/courseProgressView.test.js](../../tests/courseProgressView.test.js) | 163 |
| [tests/courseTemplateDate.test.js](../../tests/courseTemplateDate.test.js) | 134 |
| [tests/cssOrderSensitivity.test.js](../../tests/cssOrderSensitivity.test.js) | 196 |
| [tests/cssRules.test.js](../../tests/cssRules.test.js) | 215 |
| [tests/dataManagerInventory.test.js](../../tests/dataManagerInventory.test.js) | 63 |
| [tests/dataManagerRestoreNav.test.js](../../tests/dataManagerRestoreNav.test.js) | 134 |
| [tests/dataManagerWorkflow.test.js](../../tests/dataManagerWorkflow.test.js) | 209 |
| [tests/dataVault.test.js](../../tests/dataVault.test.js) | 24 |
| [tests/dateAndAnniversary.test.js](../../tests/dateAndAnniversary.test.js) | 196 |
| [tests/deployProductionGuard.test.js](../../tests/deployProductionGuard.test.js) | 20 |
| [tests/designTokenExport.test.js](../../tests/designTokenExport.test.js) | 156 |
| [tests/desktopAppUpdate.test.js](../../tests/desktopAppUpdate.test.js) | 68 |
| [tests/desktopCachePaths.test.js](../../tests/desktopCachePaths.test.js) | 28 |
| [tests/desktopSignature.test.js](../../tests/desktopSignature.test.js) | 12 |
| [tests/desktopUpdaterConfig.test.js](../../tests/desktopUpdaterConfig.test.js) | 27 |
| [tests/desktopUpdaterController.test.js](../../tests/desktopUpdaterController.test.js) | 73 |
| [tests/disclosureExpanded.test.js](../../tests/disclosureExpanded.test.js) | 204 |
| [tests/domain.test.js](../../tests/domain.test.js) | 132 |
| [tests/domainCsvImport.test.js](../../tests/domainCsvImport.test.js) | 25 |
| [tests/drawerDrag.test.js](../../tests/drawerDrag.test.js) | 232 |
| [tests/engineeringAuditHarness.test.js](../../tests/engineeringAuditHarness.test.js) | 54 |
| [tests/engineeringBackendEdge.test.js](../../tests/engineeringBackendEdge.test.js) | 150 |
| [tests/engineeringBackendRegression.test.js](../../tests/engineeringBackendRegression.test.js) | 154 |
| [tests/engineeringConfig.test.js](../../tests/engineeringConfig.test.js) | 42 |
| [tests/engineeringDataActionCenter.test.js](../../tests/engineeringDataActionCenter.test.js) | 26 |
| [tests/engineeringDataAnnualMilestones.test.js](../../tests/engineeringDataAnnualMilestones.test.js) | 18 |
| [tests/engineeringDataCalendar.test.js](../../tests/engineeringDataCalendar.test.js) | 26 |
| [tests/engineeringDataImportCancellation.test.js](../../tests/engineeringDataImportCancellation.test.js) | 108 |
| [tests/engineeringDataImportConcurrency.test.js](../../tests/engineeringDataImportConcurrency.test.js) | 164 |
| [tests/engineeringDataImportValidation.test.js](../../tests/engineeringDataImportValidation.test.js) | 78 |
| [tests/engineeringDataPasteLifetime.test.js](../../tests/engineeringDataPasteLifetime.test.js) | 63 |
| [tests/engineeringDataPersistence.test.js](../../tests/engineeringDataPersistence.test.js) | 99 |
| [tests/engineeringDataProjectQueue.test.js](../../tests/engineeringDataProjectQueue.test.js) | 64 |
| [tests/engineeringDataProjectWorkbench.test.js](../../tests/engineeringDataProjectWorkbench.test.js) | 96 |
| [tests/engineeringDataRetirement.test.js](../../tests/engineeringDataRetirement.test.js) | 34 |
| [tests/engineeringDataRetrospectiveFx.test.js](../../tests/engineeringDataRetrospectiveFx.test.js) | 53 |
| [tests/engineeringDataVaultRace.test.js](../../tests/engineeringDataVaultRace.test.js) | 67 |
| [tests/engineeringDataWallpaperCommit.test.js](../../tests/engineeringDataWallpaperCommit.test.js) | 41 |
| [tests/engineeringFormatterDates.test.js](../../tests/engineeringFormatterDates.test.js) | 32 |
| [tests/engineeringFrontendCalendarLifecycle.test.js](../../tests/engineeringFrontendCalendarLifecycle.test.js) | 70 |
| [tests/engineeringFrontendCropLayout.test.js](../../tests/engineeringFrontendCropLayout.test.js) | 18 |
| [tests/engineeringFrontendFinanceForms.test.js](../../tests/engineeringFrontendFinanceForms.test.js) | 37 |
| [tests/engineeringFrontendInteractions.test.js](../../tests/engineeringFrontendInteractions.test.js) | 69 |
| [tests/engineeringFrontendPagesCsp.test.js](../../tests/engineeringFrontendPagesCsp.test.js) | 73 |
| [tests/engineeringFrontendProjectsLifecycle.test.js](../../tests/engineeringFrontendProjectsLifecycle.test.js) | 381 |
| [tests/engineeringFrontendSocialLifecycle.test.js](../../tests/engineeringFrontendSocialLifecycle.test.js) | 113 |
| [tests/engineeringFrontendSwipe.test.js](../../tests/engineeringFrontendSwipe.test.js) | 68 |
| [tests/engineeringFrontendWallpaper.test.js](../../tests/engineeringFrontendWallpaper.test.js) | 90 |
| [tests/engineeringShellStorage.test.js](../../tests/engineeringShellStorage.test.js) | 90 |
| [tests/errorAnnouncement.test.js](../../tests/errorAnnouncement.test.js) | 300 |
| [tests/eventCalendarExport.test.js](../../tests/eventCalendarExport.test.js) | 49 |
| [tests/eventConflicts.test.js](../../tests/eventConflicts.test.js) | 66 |
| [tests/eventPlanning.test.js](../../tests/eventPlanning.test.js) | 81 |
| [tests/eventReminderPersistence.test.js](../../tests/eventReminderPersistence.test.js) | 72 |
| [tests/eventsInteractions.test.js](../../tests/eventsInteractions.test.js) | 155 |
| [tests/excelTimetableParser.test.js](../../tests/excelTimetableParser.test.js) | 47 |
| [tests/experience.test.js](../../tests/experience.test.js) | 54 |
| [tests/explicitCommitContract.test.js](../../tests/explicitCommitContract.test.js) | 103 |
| [tests/festive.test.js](../../tests/festive.test.js) | 71 |
| [tests/festiveLunarAnniversaryHome.test.js](../../tests/festiveLunarAnniversaryHome.test.js) | 116 |
| [tests/festiveLunarAnniversaryUi.test.js](../../tests/festiveLunarAnniversaryUi.test.js) | 309 |
| [tests/festiveUpcomingPanel.test.js](../../tests/festiveUpcomingPanel.test.js) | 217 |
| [tests/final2Ux.test.js](../../tests/final2Ux.test.js) | 28 |
| [tests/fixtures/ledger-browser.html](../../tests/fixtures/ledger-browser.html) | 35 |
| [tests/floatingStack.test.js](../../tests/floatingStack.test.js) | 100 |
| [tests/focusNavigation.test.js](../../tests/focusNavigation.test.js) | 32 |
| [tests/focusObscured.test.js](../../tests/focusObscured.test.js) | 273 |
| [tests/focusReturn.test.js](../../tests/focusReturn.test.js) | 131 |
| [tests/focusSettingsEditor.test.js](../../tests/focusSettingsEditor.test.js) | 62 |
| [tests/focusTimer.test.js](../../tests/focusTimer.test.js) | 174 |
| [tests/foodRetirement.test.js](../../tests/foodRetirement.test.js) | 59 |
| [tests/formatters.test.js](../../tests/formatters.test.js) | 38 |
| [tests/formControlNames.test.js](../../tests/formControlNames.test.js) | 169 |
| [tests/formValidationA11y.test.js](../../tests/formValidationA11y.test.js) | 154 |
| [tests/globalError.test.js](../../tests/globalError.test.js) | 59 |
| [tests/globalErrorAnnouncement.test.js](../../tests/globalErrorAnnouncement.test.js) | 207 |
| [tests/globalSearchShortcut.test.js](../../tests/globalSearchShortcut.test.js) | 142 |
| [tests/hashSyncValueStability.test.js](../../tests/hashSyncValueStability.test.js) | 76 |
| [tests/helpers/mirrorTeardown.js](../../tests/helpers/mirrorTeardown.js) | 41 |
| [tests/helpers/mountApp.js](../../tests/helpers/mountApp.js) | 185 |
| [tests/helpers/renderedHeadings.js](../../tests/helpers/renderedHeadings.js) | 50 |
| [tests/helpers/syncSandbox.js](../../tests/helpers/syncSandbox.js) | 257 |
| [tests/helpers/tabOrder.js](../../tests/helpers/tabOrder.js) | 232 |
| [tests/helpers/taskRowActions.js](../../tests/helpers/taskRowActions.js) | 24 |
| [tests/helpers/vueTemplate.js](../../tests/helpers/vueTemplate.js) | 166 |
| [tests/helpers/webStorage.js](../../tests/helpers/webStorage.js) | 51 |
| [tests/hiddenLiveRegion.test.js](../../tests/hiddenLiveRegion.test.js) | 182 |
| [tests/highContrastPalette.test.js](../../tests/highContrastPalette.test.js) | 240 |
| [tests/homeModules.test.js](../../tests/homeModules.test.js) | 53 |
| [tests/homeNextUp.test.js](../../tests/homeNextUp.test.js) | 37 |
| [tests/imageCropKeyboard.test.js](../../tests/imageCropKeyboard.test.js) | 152 |
| [tests/imageCropSizing.test.js](../../tests/imageCropSizing.test.js) | 17 |
| [tests/interactionAlternatives.test.js](../../tests/interactionAlternatives.test.js) | 216 |
| [tests/interactionLifetime.test.js](../../tests/interactionLifetime.test.js) | 68 |
| [tests/intlFormatters.test.js](../../tests/intlFormatters.test.js) | 20 |
| [tests/keyboardReachability.test.js](../../tests/keyboardReachability.test.js) | 379 |
| [tests/landmarksAndRoles.test.js](../../tests/landmarksAndRoles.test.js) | 352 |
| [tests/learningPlan.test.js](../../tests/learningPlan.test.js) | 103 |
| [tests/learningWorkflow.test.js](../../tests/learningWorkflow.test.js) | 179 |
| [tests/ledger.test.js](../../tests/ledger.test.js) | 146 |
| [tests/ledgerBillImport.test.js](../../tests/ledgerBillImport.test.js) | 212 |
| [tests/ledgerBillRowDom.test.js](../../tests/ledgerBillRowDom.test.js) | 101 |
| [tests/ledgerBillsAndPacing.test.js](../../tests/ledgerBillsAndPacing.test.js) | 254 |
| [tests/ledgerBudget.test.js](../../tests/ledgerBudget.test.js) | 149 |
| [tests/ledgerCategoryManager.test.js](../../tests/ledgerCategoryManager.test.js) | 56 |
| [tests/ledgerDeleteVisibility.test.js](../../tests/ledgerDeleteVisibility.test.js) | 175 |
| [tests/ledgerFeaturesDom.test.js](../../tests/ledgerFeaturesDom.test.js) | 368 |
| [tests/ledgerFeaturesRegression.test.js](../../tests/ledgerFeaturesRegression.test.js) | 182 |
| [tests/ledgerFinalOptimization.test.js](../../tests/ledgerFinalOptimization.test.js) | 343 |
| [tests/ledgerFx.test.js](../../tests/ledgerFx.test.js) | 241 |
| [tests/ledgerMoneyCorrectness.test.js](../../tests/ledgerMoneyCorrectness.test.js) | 254 |
| [tests/ledgerReviewCategories.test.js](../../tests/ledgerReviewCategories.test.js) | 279 |
| [tests/ledgerScrollPerformance.test.js](../../tests/ledgerScrollPerformance.test.js) | 122 |
| [tests/ledgerSpendStats.test.js](../../tests/ledgerSpendStats.test.js) | 28 |
| [tests/ledgerSplit.test.js](../../tests/ledgerSplit.test.js) | 294 |
| [tests/ledgerSplitDisplay.test.js](../../tests/ledgerSplitDisplay.test.js) | 230 |
| [tests/ledgerTabUrl.test.js](../../tests/ledgerTabUrl.test.js) | 120 |
| [tests/ledgerTemplates.test.js](../../tests/ledgerTemplates.test.js) | 130 |
| [tests/ledgerViewStartup.test.js](../../tests/ledgerViewStartup.test.js) | 52 |
| [tests/ledgerWorkflowCorrectness.test.js](../../tests/ledgerWorkflowCorrectness.test.js) | 289 |
| [tests/ledgerXlsxExport.test.js](../../tests/ledgerXlsxExport.test.js) | 268 |
| [tests/liveRegion.test.js](../../tests/liveRegion.test.js) | 59 |
| [tests/loadingAffordance.test.js](../../tests/loadingAffordance.test.js) | 79 |
| [tests/localStorageUsage.test.js](../../tests/localStorageUsage.test.js) | 25 |
| [tests/lunarAnniversaries.test.js](../../tests/lunarAnniversaries.test.js) | 372 |
| [tests/lunarAnniversaryEditor.test.js](../../tests/lunarAnniversaryEditor.test.js) | 78 |
| [tests/lunarAnniversaryStorageSource.test.js](../../tests/lunarAnniversaryStorageSource.test.js) | 168 |
| [tests/lunarCalendar.test.js](../../tests/lunarCalendar.test.js) | 471 |
| [tests/mirrorDurability.test.js](../../tests/mirrorDurability.test.js) | 261 |
| [tests/mobileMenu.test.js](../../tests/mobileMenu.test.js) | 10 |
| [tests/mobileViewport.test.js](../../tests/mobileViewport.test.js) | 223 |
| [tests/modal.test.js](../../tests/modal.test.js) | 127 |
| [tests/modalSections.test.js](../../tests/modalSections.test.js) | 218 |
| [tests/modalSheet.test.js](../../tests/modalSheet.test.js) | 223 |
| [tests/modalStackOrder.test.js](../../tests/modalStackOrder.test.js) | 466 |
| [tests/monthlyTrendCard.test.js](../../tests/monthlyTrendCard.test.js) | 245 |
| [tests/monthlyTrendChart.test.js](../../tests/monthlyTrendChart.test.js) | 84 |
| [tests/mood.test.js](../../tests/mood.test.js) | 66 |
| [tests/motion.test.js](../../tests/motion.test.js) | 168 |
| [tests/motionTokens.test.js](../../tests/motionTokens.test.js) | 114 |
| [tests/narrativeI18n.test.js](../../tests/narrativeI18n.test.js) | 248 |
| [tests/navigationEditor.test.js](../../tests/navigationEditor.test.js) | 230 |
| [tests/navigationEditorInteraction.test.js](../../tests/navigationEditorInteraction.test.js) | 190 |
| [tests/navigationInformationArchitecture.test.js](../../tests/navigationInformationArchitecture.test.js) | 25 |
| [tests/navigationPreferences.test.js](../../tests/navigationPreferences.test.js) | 192 |
| [tests/notFoundViewDom.test.js](../../tests/notFoundViewDom.test.js) | 70 |
| [tests/noticeParser.regression.test.js](../../tests/noticeParser.regression.test.js) | 177 |
| [tests/noticeParser.test.js](../../tests/noticeParser.test.js) | 75 |
| [tests/noticeSegments.test.js](../../tests/noticeSegments.test.js) | 318 |
| [tests/ocr-reference-read.mjs](../../tests/ocr-reference-read.mjs) | 57 |
| [tests/ocrEngineWiring.test.js](../../tests/ocrEngineWiring.test.js) | 161 |
| [tests/ocrVocabulary.test.js](../../tests/ocrVocabulary.test.js) | 24 |
| [tests/overlayEscape.test.js](../../tests/overlayEscape.test.js) | 278 |
| [tests/pendingFieldEdits.test.js](../../tests/pendingFieldEdits.test.js) | 94 |
| [tests/performanceMode.test.js](../../tests/performanceMode.test.js) | 18 |
| [tests/performanceSmoke.test.js](../../tests/performanceSmoke.test.js) | 29 |
| [tests/phase1Regression.test.js](../../tests/phase1Regression.test.js) | 64 |
| [tests/planningViews.test.js](../../tests/planningViews.test.js) | 82 |
| [tests/planningWorkspaceInteractions.test.js](../../tests/planningWorkspaceInteractions.test.js) | 153 |
| [tests/printStyles.test.js](../../tests/printStyles.test.js) | 222 |
| [tests/projectAvailability.test.js](../../tests/projectAvailability.test.js) | 37 |
| [tests/projectDeliverableEditor.test.js](../../tests/projectDeliverableEditor.test.js) | 214 |
| [tests/projectEditorScope.test.js](../../tests/projectEditorScope.test.js) | 32 |
| [tests/projectFilesAndErrors.test.js](../../tests/projectFilesAndErrors.test.js) | 46 |
| [tests/projectMeetingBridge.test.js](../../tests/projectMeetingBridge.test.js) | 119 |
| [tests/projectMeetingsEditor.test.js](../../tests/projectMeetingsEditor.test.js) | 67 |
| [tests/projectQixingInteractions.test.js](../../tests/projectQixingInteractions.test.js) | 207 |
| [tests/projectRequestScope.test.js](../../tests/projectRequestScope.test.js) | 58 |
| [tests/projectsFormErrorBinding.test.js](../../tests/projectsFormErrorBinding.test.js) | 145 |
| [tests/projectsService.test.js](../../tests/projectsService.test.js) | 51 |
| [tests/projectsTaskVirtualization.test.js](../../tests/projectsTaskVirtualization.test.js) | 72 |
| [tests/projectSubmitContract.test.js](../../tests/projectSubmitContract.test.js) | 44 |
| [tests/projectTaskActions.test.js](../../tests/projectTaskActions.test.js) | 35 |
| [tests/projectTaskBridge.test.js](../../tests/projectTaskBridge.test.js) | 125 |
| [tests/projectTaskFiltering.test.js](../../tests/projectTaskFiltering.test.js) | 89 |
| [tests/projectTaskSelectors.test.js](../../tests/projectTaskSelectors.test.js) | 49 |
| [tests/projectTaskWorkbench.test.js](../../tests/projectTaskWorkbench.test.js) | 50 |
| [tests/projectTimezoneSync.test.js](../../tests/projectTimezoneSync.test.js) | 53 |
| [tests/projectWorkbenchInteractions.test.js](../../tests/projectWorkbenchInteractions.test.js) | 72 |
| [tests/promptDialogMigration.test.js](../../tests/promptDialogMigration.test.js) | 634 |
| [tests/pwaStartupRecovery.test.js](../../tests/pwaStartupRecovery.test.js) | 138 |
| [tests/quickCapture.test.js](../../tests/quickCapture.test.js) | 40 |
| [tests/quickEntryModalClose.test.js](../../tests/quickEntryModalClose.test.js) | 216 |
| [tests/quickRecord.test.js](../../tests/quickRecord.test.js) | 157 |
| [tests/quickRecordAdapters.test.js](../../tests/quickRecordAdapters.test.js) | 208 |
| [tests/quickRecordConcurrency.test.js](../../tests/quickRecordConcurrency.test.js) | 141 |
| [tests/quickRecordExperience.test.js](../../tests/quickRecordExperience.test.js) | 230 |
| [tests/quickRecordPanel.test.js](../../tests/quickRecordPanel.test.js) | 155 |
| [tests/quickRecordWorkflow.test.js](../../tests/quickRecordWorkflow.test.js) | 89 |
| [tests/ratchetHardcoding.test.js](../../tests/ratchetHardcoding.test.js) | 442 |
| [tests/reducedMotionScroll.test.js](../../tests/reducedMotionScroll.test.js) | 250 |
| [tests/referenceIntegrity.test.js](../../tests/referenceIntegrity.test.js) | 203 |
| [tests/refund.test.js](../../tests/refund.test.js) | 82 |
| [tests/releaseNotes.test.js](../../tests/releaseNotes.test.js) | 72 |
| [tests/releaseReadme.test.js](../../tests/releaseReadme.test.js) | 41 |
| [tests/reminderScheduler.test.js](../../tests/reminderScheduler.test.js) | 143 |
| [tests/renderedHeadingOrder.test.js](../../tests/renderedHeadingOrder.test.js) | 138 |
| [tests/restoreBackupScope.test.js](../../tests/restoreBackupScope.test.js) | 106 |
| [tests/retiredNotesMigration.test.js](../../tests/retiredNotesMigration.test.js) | 17 |
| [tests/retrospective.test.js](../../tests/retrospective.test.js) | 88 |
| [tests/reviewCharts.test.js](../../tests/reviewCharts.test.js) | 617 |
| [tests/routeAnnouncement.test.js](../../tests/routeAnnouncement.test.js) | 95 |
| [tests/routeFallback.test.js](../../tests/routeFallback.test.js) | 31 |
| [tests/routePreload.test.js](../../tests/routePreload.test.js) | 32 |
| [tests/safariApiGuards.test.js](../../tests/safariApiGuards.test.js) | 135 |
| [tests/scheduleAdjustments.test.js](../../tests/scheduleAdjustments.test.js) | 121 |
| [tests/scheduleAdjustmentsUi.test.js](../../tests/scheduleAdjustmentsUi.test.js) | 380 |
| [tests/scheduleDates.test.js](../../tests/scheduleDates.test.js) | 54 |
| [tests/scheduleExceptions.test.js](../../tests/scheduleExceptions.test.js) | 75 |
| [tests/scheduleGridRoving.test.js](../../tests/scheduleGridRoving.test.js) | 156 |
| [tests/scheduleMakeupSlots.test.js](../../tests/scheduleMakeupSlots.test.js) | 132 |
| [tests/scheduleNoteProtection.test.js](../../tests/scheduleNoteProtection.test.js) | 20 |
| [tests/scheduleOcrParser.test.js](../../tests/scheduleOcrParser.test.js) | 166 |
| [tests/scheduleRecognition.test.js](../../tests/scheduleRecognition.test.js) | 532 |
| [tests/scheduleSeasonRules.test.js](../../tests/scheduleSeasonRules.test.js) | 72 |
| [tests/scheduleSessionExceptions.test.js](../../tests/scheduleSessionExceptions.test.js) | 153 |
| [tests/scopedChildReachability.test.js](../../tests/scopedChildReachability.test.js) | 596 |
| [tests/searchEnhancements.test.js](../../tests/searchEnhancements.test.js) | 568 |
| [tests/settingsPolicy.test.js](../../tests/settingsPolicy.test.js) | 59 |
| [tests/sheetDrag.test.js](../../tests/sheetDrag.test.js) | 156 |
| [tests/shellAlertQueue.test.js](../../tests/shellAlertQueue.test.js) | 292 |
| [tests/shellToolEntries.test.js](../../tests/shellToolEntries.test.js) | 93 |
| [tests/sidebarDrawer.test.js](../../tests/sidebarDrawer.test.js) | 749 |
| [tests/sidebarMoreSheetEscape.test.js](../../tests/sidebarMoreSheetEscape.test.js) | 134 |
| [tests/smartClassify.test.js](../../tests/smartClassify.test.js) | 50 |
| [tests/socialWritePolicyGuard.test.js](../../tests/socialWritePolicyGuard.test.js) | 41 |
| [tests/sourceSignature.test.js](../../tests/sourceSignature.test.js) | 60 |
| [tests/startupGate.test.js](../../tests/startupGate.test.js) | 52 |
| [tests/startupStatus.test.js](../../tests/startupStatus.test.js) | 106 |
| [tests/storageCorruptionResilience.test.js](../../tests/storageCorruptionResilience.test.js) | 247 |
| [tests/storagePerformance.test.js](../../tests/storagePerformance.test.js) | 40 |
| [tests/storagePersistence.test.js](../../tests/storagePersistence.test.js) | 61 |
| [tests/storeExplicitCommitSeam.test.js](../../tests/storeExplicitCommitSeam.test.js) | 87 |
| [tests/storePersistence.test.js](../../tests/storePersistence.test.js) | 344 |
| [tests/studyBlockSuggestions.test.js](../../tests/studyBlockSuggestions.test.js) | 41 |
| [tests/styleComments.test.js](../../tests/styleComments.test.js) | 141 |
| [tests/styleHooks.test.js](../../tests/styleHooks.test.js) | 279 |
| [tests/supabaseBuildChecks.test.js](../../tests/supabaseBuildChecks.test.js) | 53 |
| [tests/swipeActionItem.test.js](../../tests/swipeActionItem.test.js) | 190 |
| [tests/syncDirtyAllowlist.test.js](../../tests/syncDirtyAllowlist.test.js) | 77 |
| [tests/syncMerge.test.js](../../tests/syncMerge.test.js) | 134 |
| [tests/syncSandbox.test.js](../../tests/syncSandbox.test.js) | 361 |
| [tests/tabKeys.test.js](../../tests/tabKeys.test.js) | 163 |
| [tests/tableSemantics.test.js](../../tests/tableSemantics.test.js) | 128 |
| [tests/tabOrderAndNames.test.js](../../tests/tabOrderAndNames.test.js) | 337 |
| [tests/tabPanelSemantics.test.js](../../tests/tabPanelSemantics.test.js) | 261 |
| [tests/taskBoardVirtualization.test.js](../../tests/taskBoardVirtualization.test.js) | 37 |
| [tests/taskCenter.test.js](../../tests/taskCenter.test.js) | 286 |
| [tests/taskCourseLinks.test.js](../../tests/taskCourseLinks.test.js) | 30 |
| [tests/taskEditor.test.js](../../tests/taskEditor.test.js) | 147 |
| [tests/taskProgress.test.js](../../tests/taskProgress.test.js) | 120 |
| [tests/taskRepeatRules.test.js](../../tests/taskRepeatRules.test.js) | 243 |
| [tests/taskStageReminders.test.js](../../tests/taskStageReminders.test.js) | 84 |
| [tests/taskTimeInteractions.test.js](../../tests/taskTimeInteractions.test.js) | 229 |
| [tests/taskTimeLocalTimezone.test.js](../../tests/taskTimeLocalTimezone.test.js) | 127 |
| [tests/taskTimePersistence.test.js](../../tests/taskTimePersistence.test.js) | 78 |
| [tests/taskTimePlan.test.js](../../tests/taskTimePlan.test.js) | 213 |
| [tests/taskViewQuery.test.js](../../tests/taskViewQuery.test.js) | 79 |
| [tests/taskWorkProgress.test.js](../../tests/taskWorkProgress.test.js) | 30 |
| [tests/taskWorkSession.test.js](../../tests/taskWorkSession.test.js) | 60 |
| [tests/templateBindingIntegrity.test.js](../../tests/templateBindingIntegrity.test.js) | 168 |
| [tests/timeConfig.test.js](../../tests/timeConfig.test.js) | 41 |
| [tests/timeContext.test.js](../../tests/timeContext.test.js) | 68 |
| [tests/timeGenerate.test.js](../../tests/timeGenerate.test.js) | 74 |
| [tests/timeImportPlanFailure.test.js](../../tests/timeImportPlanFailure.test.js) | 238 |
| [tests/timeResetConfirm.test.js](../../tests/timeResetConfirm.test.js) | 194 |
| [tests/timetableLayoutParser.test.js](../../tests/timetableLayoutParser.test.js) | 213 |
| [tests/todayNext.test.js](../../tests/todayNext.test.js) | 17 |
| [tests/togetherAvailabilityStaleResponse.test.js](../../tests/togetherAvailabilityStaleResponse.test.js) | 180 |
| [tests/touchTargetHooks.test.js](../../tests/touchTargetHooks.test.js) | 217 |
| [tests/updateCoordinationRegression.test.js](../../tests/updateCoordinationRegression.test.js) | 110 |
| [tests/updateNotesModal.test.js](../../tests/updateNotesModal.test.js) | 116 |
| [tests/useToastQueue.test.js](../../tests/useToastQueue.test.js) | 32 |
| [tests/versionUpdatePanel.test.js](../../tests/versionUpdatePanel.test.js) | 84 |
| [tests/versionUtils.test.js](../../tests/versionUtils.test.js) | 172 |
| [tests/viewRenderMatrix.test.js](../../tests/viewRenderMatrix.test.js) | 178 |
| [tests/viewScrollMemory.test.js](../../tests/viewScrollMemory.test.js) | 88 |
| [tests/virtualList.test.js](../../tests/virtualList.test.js) | 86 |
| [tests/voiceInput.test.js](../../tests/voiceInput.test.js) | 151 |
| [tests/wheelPicker.test.js](../../tests/wheelPicker.test.js) | 251 |
| [tests/zonedTimeEquivalence.test.js](../../tests/zonedTimeEquivalence.test.js) | 129 |

</details>

### 根配置与公共资源

| 范围 | 文件/用途 |
| --- | --- |
| 工程与依赖 | package.json / package-lock.json；desktop-app/package.json / package-lock.json；.nvmrc；tsconfig.json；eslint.config.js |
| 构建与设计 | vite.config.js；components.json；release.config.js；DESIGN_TOKENS.md |
| 平台与发布 | wrangler.jsonc；electron-builder.yml / electron-builder.release.yml；.github/workflows（已索引） |
| 启动/账户回调 | index.html；public/desktop-auth-return/index.html；public/_headers |
| 图标与 OCR | public/pwa-v2-192x192.png、pwa-v2-512x512.png、favicon-v2.png、apple-touch-icon-v2.png；ocr/tesseract-worker.min.js、tesseract-core-simd-lstm.wasm.js、chi_sim.traineddata |
| 指导与环境 | AGENTS.md；README.md；.gitignore / .gitattributes；.env.example 仅核对模板，.env.local 未读内容 |

公共 OCR 引擎/语言数据按外部资源依赖登记，没有把压缩第三方代码或模型权重逐行当作本项目业务源审。包锁、平台配置和全部迁移保留在原处。

<!-- END_RUNTIME_APPENDIX -->
