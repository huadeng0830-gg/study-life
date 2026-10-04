# 学习生活台 · 会话交接文档

> **⚠ 状态标注（第五十四轮加上，正文未改）**：**这是 `HANDOFF.md`，是一份历史交接文档，不是当前状态。**
> - **当前交接文档是 `HANDOVER.md`**（同目录），要了解"现在能做什么、还剩什么"请读那一份；两份文件目前**没有互相引用**，所以从这份开始读很容易读到一个几十轮前的世界。
> - 本文 **§6 的标题写着「当前最新」，但那一节记录的是 `2026年08月29日-版本13` / 签名 `8651dd88cb` / 测试 208 条**——那是几十轮之前的事（现在的规模见 `HANDOVER.md` 开头与报告 §0）。**不要把它当成现状。**
> - §7「后续可选工作」里**至少两条已经完成**：① "农历表可扩展 2030 之后的年份" → `festive.js` 的农历表现已覆盖 **1900–2101**（第五十四轮，含闰月）；② "快速录入入口目前是固定右下角悬浮球，如需迁移…" → **已经迁移完毕**（App 常驻悬浮卡与其复制监听已删除，手机为底部中央「＋记录」、桌面为侧栏「记录」、Ctrl/Cmd+K 呼出）。

# 最新会话：移动端交互体验优化（本节覆盖 §6 的发布状态）

> 写给下一个会话 / 交接人。本文件记录「氛围 + 回顾 + 快速录入 + 智能归类」四个模块的完成情况、数据契约、发布状态与注意事项，接续工作前请先通读。

---

# 最新会话：移动端交互体验优化（本节覆盖 §6 的发布状态）

## 0.1 任务与范围

用户给出一份移动端交互模式清单（7 个基础组件 / 10 个高级动效 / 6 个加载反馈 + 「等待分级」原则），要求优化本项目。经确认选定 **A + B + C**，明确不做 D；交付方式为**直接改进现有页面**，不做演示页。顺序 A → C → B。

硬约束遵守情况：未新增任何 npm 依赖；未接入外部网络服务；未引入后台轮询或常驻定时器；未改动任何既有 `sl_*` 键语义；未改动路由 hash 方案；CSS 全部复用 `--primary/--card/--border/--ink-*` 与 `.btn/.card/Modal`。

## 0.2 交付内容

### A. 主题切换圆形扩散 + 统一动效底座
- `src/style.css`：新增时长/缓动标记 `--dur-instant 90ms / fast 150 / base 220 / slow 320 / reveal 420`；`--ease-standard / --ease-out / --ease-spring`。
- `src/composables/motion.js`：`MOTION` 常量、`animationsEnabled()`、`farthestCornerRadius(x,y,w,h)`、`originFromEvent(event, fallbackElement)`、`canCircularReveal()`、`revealChange(apply, origin)`。
- `revealChange` 用 `document.startViewTransition` + `::view-transition-new(root)` 的 `clip-path: circle()` 从 `0px` 动画到「触点距最远角落」的半径。**浅色和深色两套页面都真实存在，只做圆形裁切，不做任何整体缩放。**
- 两个必须记住的实现细节：① `apply()` 之后要 `await nextTick()`，否则 Vue 还没刷 DOM，快照会截到旧主题；② 清理用 `finished.finally()` 加一次性兜底 `setTimeout`，且幂等。
- 键盘操作用元素中心作为圆心（`originFromEvent` 的回退链：触点 → 元素中心 → 视口中心）。
- 接入点：`Sidebar.vue` 与 `AppearanceSettings.vue` 的主题选择。

### B/C 之外的基础组件（C1–C4）
- `src/composables/overlayStack.js`：**共享浮层栈**（`pushOverlay/removeOverlay/isTopOverlay`）、`createScrollLock()`（保持 `body.dataset.modalLockCount`/`modalOpen`/`overflow` 语义不变）、`trapTabKey`、`initialFocusTarget`。`Modal.vue` 已重构到它上面，去掉了自己那份 `modalStack`。
- `src/components/ActionSheet.vue`：底部操作菜单（Teleport、`z-index:110`、safe-area、每项 ≥50px）。
- `Modal.vue` 新增**严格 opt-in** 的 `sheet` / `sheetDetents` props：窄屏才生效，带抓手、中间档位吸附、上滑展开、下滑收起（含甩动方向判断）。其余约 15 个 Modal 调用点行为完全不变（有回归测试）。
- `src/composables/sheetDrag.js`：纯拖拽物理（采样上限 6、速度 px/ms、`resolveSheetRelease` 的 close/peek/expand 分支、`sheetDetentHeights`）。
- `src/components/ContextMenu.vue` + `src/composables/longPress.js`：长按菜单（`LONG_PRESS_DURATION 480ms`、容差 10px、鼠标端交给右键、长按命中后吃掉紧随的一次 click）。接入 `ExamsView.vue` 卡片（置顶/编辑/归档/删除）。
- `src/components/WheelPicker.vue` + `src/components/TimeWheelSheet.vue` + `src/composables/wheelPicker.js`：双列滚轮时间选择器（`scroll-snap` + 松手后 130ms 一次性对齐回调，方向键可用）。接入 `EventsView.vue` 的开始/结束时间。

### B. 等待分级（短等待看结构 / 长等待可离开）
- **骨架屏**：`src/components/SkeletonBlock.vue`（`line`/`card` 两种变体）；`RouteFallback.vue` 由纯文字改为按真实页面结构占位（仅保留一个 `sr-only` 的「页面加载中」给读屏）。
- **启动分级**：`index.html` 的首屏占位改为「步骤清单 + 卡片轮廓」的真实结构；`src/composables/startupStatus.js` 的 `markStartupStep` 按 `runStartupGate` 的真实阶段点亮（vault → recovery → prepare → mount）。`runStartupGate` 新增可选 `onStep` 回调（向后兼容）。
- **后台任务中心**：`src/composables/taskCenter.js`（注册表 + 结果日志 `sl_task_center_log`，上限 20 条）、`src/composables/autoSyncTask.js`（把自动同步接进来）、`src/components/TaskCenter.vue`（悬浮胶囊 + 面板，挂在 `App.vue`）。
- **记住上次浏览位置**：`src/composables/viewScrollMemory.js`；`main.js` 里 `router.beforeEach` 在导航生效前记录 `window.scrollY`，`scrollBehavior` 里**优先用浏览器自己的 `savedPosition`**，其次才用记忆位置。**零定时器**。

## 0.3 新增文件清单

composables：`motion.js`、`overlayStack.js`、`sheetDrag.js`、`longPress.js`、`wheelPicker.js`、`taskCenter.js`、`autoSyncTask.js`、`startupStatus.js`、`viewScrollMemory.js`
components：`ActionSheet.vue`、`ContextMenu.vue`、`WheelPicker.vue`、`TimeWheelSheet.vue`、`SkeletonBlock.vue`、`TaskCenter.vue`
tests：`motion.test.js`、`sheetDrag.test.js`、`modalSheet.test.js`、`contextMenu.test.js`、`wheelPicker.test.js`、`taskCenter.test.js`、`autoSyncTask.test.js`、`startupStatus.test.js`、`viewScrollMemory.test.js`

修改：`src/style.css`、`src/main.js`、`src/App.vue`、`index.html`、`src/components/{Modal,RouteFallback,Sidebar,AppearanceSettings,QuickRecordPanel}.vue`、`src/views/{ExamsView,EventsView}.vue`、`src/composables/{startupGate,menuPlacement}.js`、`release.config.js`

## 0.4 关键实现注意事项（踩过的坑）

- **`event.timeStamp` 可能是 0**：`Modal.vue` 的 sheet 拖动原本写 `event.timeStamp || Date.now()`，把合法的 0 当成缺失值，导致第一个采样点时间错乱、`dt` 为负、速度恒为 0，**所有甩动判断静默失效**。已改为 `Number.isFinite(Number(event?.timeStamp))` 判断。
- **降低动效不覆盖 JS 动画**：`src/style.css` 的 `data-performance='reduced'` 规则只压 CSS 动画时长，WAAPI/rAF/`animation-delay` 都不受影响。所以 ActionSheet 的错峰延迟是在 JS 里算的（`animationsEnabled() ? … : '0ms'`），否则降级模式下条目会停在 `opacity: 0` 等一个永不生效的延迟。
- **共享浮层栈是必须的**：嵌套浮层的 Escape、滚动锁、焦点陷阱必须走同一份栈，各组件自己维护会互相踩。`ContextMenu` 有意**不锁** body 滚动（它跟着触点走，页面本来就不该被冻住）。
- **`sheet` 必须 opt-in**：默认关闭，否则会一次性改变十几个既有 Modal 的行为。
- **任务中心的 source 读取函数必须读响应式状态**：`registerTask` 靠 `watch` 观测 `source.status()` 判断终态并写结果日志；读闭包变量不会被追踪，日志会静默失效（已写进 JSDoc 契约）。
- **`sl_task_center_log` 是纯本地 UI 键**，故意不进 `SYNC_DEFAULTS`（与 `sl_food_places`/`sl_courier_bookmarks` 同类），避免把设备本地的「看过没看过」同步出去。
- 任务中心的计时只在面板打开时进行（一次性 `setInterval`，关闭即清），悬浮胶囊不显示秒数。

## 0.5 门禁与发布状态

- 全绿：`npx eslint .`（0 问题）、`npm run typecheck`、`npx vitest run`（**96 文件 / 819 条**）、`npm run build`。
- 版本 **2026年09月18日-版本7**，源码签名 `3040188896`（`release.config.js` 首条与 `RELEASE_SOURCE_SIGNATURE` 一致）。
- **未部署**。收到用户明确的部署指令后再执行 `npx wrangler pages deploy dist --project-name=study-life --branch=main`。
- 本次改动**未 git 提交**；提交前请按 `AGENTS.md` 的隐私与数据安全规则先扫 `git status` / `git diff` / `git ls-files`。

## 0.6 有意没做 / 建议后续

- **没有把 DataManager 的长任务后台化**（`DataManager.vue:806-807` 关面板即取消、`:811-812` 卸载即 abort）。原因：备份**恢复**属于有数据安全含义、且完成即 `location.reload()` 的操作，手动同步又已有 `autoSyncCoordinator` 在后台独立跑；在没有明确产品决策前，把「恢复」改成关面板仍继续跑是不该由实现单方面做的决定。若要推进：把 `syncProgress`/`backupProgress`（`DataManager.vue:100-103`）与两个 AbortController 提到模块级单例，用 `progressTaskSource()` 一行接进任务中心，并且**只为导出路径**去掉关面板取消、`restore` 保持可中断（需要在打开时补一次 `reset()` 以免沿用上一次的终态）。
- 5 套并行的分段控件实现（`.segmented` 与 `ScheduleView`/`TimeSettingsModal`/`LocalTransfer`/`AppearanceSettings` 各一份）可以合并到 `.segmented`。
- `TasksView`/`ListsView` 仍用旧的滑动手势 API，未迁移到 `SwipeActionItem` 的 `actions` 数组写法。
- `src/composables/appUpdate.js:295` 的 `window.setInterval(silentCheck, 30*60*1000)` 是全仓唯一没有对应 `clearInterval` 的定时器，仅为报告，未改动。

---

## 1. 项目概况

- 项目路径：`D:\study-life\study-life`（用户习惯说「项目在 D:\study-life」，实际仓库在其下 `study-life` 子目录）
- 技术栈：Vue 3（`<script setup>` + JavaScript，非 TS）· Vue Router（hash 路由）· Vite · vite-plugin-pwa · Cloudflare Pages Functions + Durable Objects
- 核心命令：
  - `npm run dev` / `npm run build` / `npm run preview`
  - `npm run lint` / `npm run typecheck`（vue-tsc）/ `npm test`（vitest）/ `npm run check`
  - 发布签名：`node scripts/bump-release.mjs --notes "说明1|说明2"`
  - 部署：`npx wrangler pages deploy dist --project-name=study-life --branch=main`

## 2. 本次会话任务与硬约束

实现「氛围 + 回顾 + 快速录入 + 智能归类」四模块，并在后续追加「云端选择性拉取」「语音识别可用性修复」「节日与纪念日设置面板」三项需求（见模块 E/F/G），全程遵循现有代码风格与发布流程。硬约束（已全部满足）：

1. 不新增任何 npm 依赖；不接入外部网络服务（语音用浏览器本地 Web Speech API，失败降级）。
2. 全离线优先：无后台轮询 / 常驻定时器；计算只在用户触发时执行。
3. 不修改既有 `sl_*` 键语义；新键一律 `sl_` 前缀；数据写入前必须归一化。
4. 不改变路由 hash 方案。
5. 风格：`<script setup>` + JS；CSS 复用 `--primary/--card/--border` 等变量与 `.btn/.card/Modal`。

## 3. 已完成交付（逐模块）

### 模块 A：氛围与情绪引擎
- 数据契约：
  - `sl_festive_config = { enabled:true, birthday:'MM-DD', installDate:'YYYY-MM-DD', anniversaries:[{date:'MM-DD',label}] }`
  - `sl_mood_log = { 'YYYY-MM-DD': { mood:'😊', note:'' } }`（兼容旧写法纯 emoji 字符串值）
- 核心纯函数（`src/composables/festive.js`）：`festiveFor(date, config) → { key,name,accentColor,message,decor }`，`decor ∈ snow|confetti|lantern|null`；`applyAtmosphere(overlay)` 写 CSS 变量 `--atmosphere-accent/--atmosphere-decor`。
- 核心纯函数（`src/composables/mood.js`）：`moodOf(day, log)` / `logMood(day, mood, note, log)` / `monthMoodSummary(month, log) → { sunny, cloudy, rain, dominant, themeColor }`。
- 节日规则：固定公历节日（元旦/情人节/愚人节/儿童节/国庆/圣诞）+ 农历表 2026–2030（春节/元宵/清明/端午/中秋/重阳/冬至），查不到年份就跳过不编造。
- 生日/纪念日/使用周年作为规则条目返回 message + confetti。
- 存储与坏数据修复集中在 `src/composables/atmosphereStore.js`（模块顶层导入即修复）。
- UI：`App.vue` 根节点 `:data-atmosphere` + `.atmo-layer` 彩带/雪花/灯笼纯 CSS 动画（全局样式在 `src/style.css`）；`TodayView.vue` 问候语追加节日祝福、新增一排心情记录按钮。

### 模块 B：回顾叙事引擎
- 核心纯函数（`src/composables/retrospective.js`）：`daySnapshot(dateStr, data)` / `dayStory` / `monthReport('YYYY-MM')` / `yearReport('YYYY') → { title, blocks[] }`；blocks 项 `{ type:'p'|'stat'|'list', ... }`。只读 `sl_*`，绝不写入历史数据。
- UI：`src/components/MemoryView.vue`（基于 Modal，不新增路由）：Tab「那天/月度/年度」+ 日期选择 + 复制/分享（`useShareText`）+ 空态；入口为 `TodayView.vue` 头部「↺ 回放」按钮。
- 年度报告年末（12 月）首次打开一次性提示，标记键 `sl_retro_year_notice`。

### 模块 C：全局快速记录（文字 + 语音）
- 核心拆分：`src/composables/quickRecord/parser.js` 负责本地规则解析、批量分行与一句多动作拆分；`adapters.js` 按类型写入正式数据；`types.js` 维护可扩展类型定义。
- 支持待办、作业、日程、支出、收入、固定账单、倒计时、快速笔记。已有类型仍写回 `sl_tasks / sl_expenses / sl_bills / sl_exams`；新增能力使用 `sl_events / sl_quick_notes`，设置使用 `sl_quick_record_settings`，全部已纳入备份、二维码迁移与云同步。
- UI：`src/components/QuickRecordPanel.vue` 采用手机 Bottom Sheet 风格的三级交互：输入 → 轻量解析确认（可批量）→ 按需展开详情；麦克风内置输入框，结束识别后直接解析。保存后清空并重新聚焦，支持连续记录。
- 入口：删除 App 常驻悬浮卡与其复制监听；手机底部中央改为「＋记录」，桌面侧栏改为「记录」，Ctrl/Cmd + K 可呼出。账本页“记一笔”、待办页“添加待办”保留为上下文入口；首页移除重复的主级“添加待办”。
- 剪贴板：仅在打开快速记录时提示用户「智能识别」，不会自动创建；设置入口为侧栏/手机更多中的「快速记录设置」。

### 模块 D：智能归类引擎
- 核心纯函数（`src/composables/smartClassify.js`）：`classifyTask(task, courses)` —— 课程名匹配补 `courseId`（复用 `courseLinks.findUniqueCourseByName`）；标题关键词补分类（无课程时写入 `course`）；含「紧急/今天」或 3 天内到期的 `dueDate` → `priority=high`（绝不降级、只改字段不删数据）；`classifyTasks` 返回变化条数。
- 触发：`QuickCapturePanel.vue` 保存待办前自动应用；`TasksView.vue` 新增「✦ 一键整理」按钮。

### 模块 E：云端选择性拉取
- 数据契约：`src/composables/cloudSyncData.js` 新增 `SYNC_MODULES`（模块 → 键的静态分组，8 组恰好覆盖全部 23 个同步键，不重不漏）与 `moduleKeysFor(moduleKeys)` / `normalizePullKeys(keys)` / `pickSyncValues(payload, keys)` 纯函数。
- `sl_festive_config` / `sl_mood_log` 两个本次四模块新增键已纳入 `SYNC_DEFAULTS`（同步清单），并在 `sanitizeSyncPayload` 写库前先按 `normalizeFestiveConfig` / `normalizeMoodLog` 归一化。
- `pullFromCloud({ keys })`：`keys` 传 `sl_*` 键子集时为选择性拉取，`null/undefined` 保持全量向后兼容；只对选中键做 `pickSyncValues → sanitizeSyncPayload → applyRemoteValues`，撤销快照（`snapshotStates`）也只覆盖本次涉及到的键。
- 推送仍全量，`mergeSyncValue` / `validateSyncPayload` / `assertValidSyncPayload` / `undoLastPull` / revision 冲突保护 / 加解密流程全部保持不变。
- UI：`DataManager.vue` 同步页签「从云端拉取」前新增模块多选框（默认全选、一键全选/清空、触控区域 ≥ 40px）；确认框展示「拉取范围」，未勾选任何模块时禁点拉取。

### 模块 F：语音识别可用性修复
- 根因：桌面版 Firefox 不支持 Web Speech API，且 API 仅在 HTTPS/localhost 安全上下文暴露；原 `voiceInput.js` 的 `start()` 同步抛错时被静默吞掉，未结束片段又用累加导致文本重复，均无 UI 反馈。
- 修复（`src/composables/voiceInput.js`）：`start()` 同步抛错改为显式回调 `onError(error.name)`；`onresult` 中未结束片段改为「替换」而非累加；新增 `voiceErrorMessage(code)` 把常见错误码（not-allowed/no-speech/audio-capture/network 等）转中文提示。
- UI（`QuickCapturePanel.vue`）：不支持环境把麦克风按钮置灰并给「一次性友好提示」（`sl_voice_hint_seen` 持久记忆，点「知道了」后不再打扰），不报错不白屏；支持环境正常识别并回填触发 `capture()` 归类。

### 模块 G：节日与纪念日设置面板
- 复用 `sl_festive_config`（不新增键），纯函数 `festive.js` 额外 `export SOLAR_FIXED / LUNAR_DEFS / LUNAR_DATE_TABLE` 并新增 `builtInFestivalTable()` 生成只读对照表。
- 新组件 `src/components/FestiveSettings.vue`（复用 Modal，不新增路由）：开关节日氛围、生日（date 输入、落库取后 5 位 MM-DD）、开始使用日期（YYYY-MM-DD）、纪念日列表增删改；每次修改立即 `normalizeFestiveConfig` 归一化后写回 `festiveConfig.value`（useStoredRef 自动持久化）。
- 只读对照表：固定公历节日（元旦/情人节/愚人节/儿童节/国庆/圣诞）+ 2026–2030 农历/节气节日公历日期表格，附说明「内置表在 festive.js → LUNAR_DATE_TABLE」。
- 入口：`TodayView.vue` 心情记录条右侧「🎯 节日」按钮，任何一天都能打开；移动端单列、触控区 ≥ 40px。
- 生日年份修复：`sl_festive_config.birthday` 仍保持 `MM-DD` 语义不变，另用本地键 `sl_festive_birthday_full`（`YYYY-MM-DD`，仅本地显示用、不同步）记住出生年份，避免关闭面板后 date 输入框年份被重置成占位年份；纪念日仍只存 `MM-DD`（年份不参与提醒）。

## 4. 新增 / 修改文件清单

### 新增（composables）
- `src/composables/festive.js`
- `src/composables/mood.js`
- `src/composables/atmosphereStore.js`
- `src/composables/retrospective.js`
- `src/composables/quickCapture.js`
- `src/composables/voiceInput.js`
- `src/composables/smartClassify.js`
- `src/composables/useShareText.js`（四模块共用剪贴板/分享，含降级）

### 新增（components）
- `src/components/MemoryView.vue`
- `src/components/QuickCapturePanel.vue`
- `src/components/FestiveSettings.vue`（节日与纪念日设置面板）

### 修改
- `src/App.vue`（氛围标记 + 装饰层 + 常驻快速录入悬浮按钮 + copy 监听）
- `src/views/TodayView.vue`（节日问候 + 回放入口 + 心情记录条）
- `src/views/TasksView.vue`（一键智能整理）
- `src/style.css`（雪/彩带/灯笼全局动画）
- `src/composables/cloudSyncData.js`（新增 SYNC_MODULES 分组、纳入氛围/心情两键并归一化、选择性拉取辅助函数）
- `src/composables/cloudSync.js`（`pullFromCloud` 支持 keys 子集，快照/应用只覆盖选中键）
- `src/components/DataManager.vue`（同步页签模块多选框 + 拉取范围确认）
- `src/composables/voiceInput.js`（start 抛错显式反馈、interim 替换、voiceErrorMessage）
- `src/components/QuickCapturePanel.vue`（不支持环境置灰 + 一次性友好提示 + 错误码友好文案）
- `src/composables/festive.js`（导出内置节日常量 + `builtInFestivalTable`）
- `src/views/TodayView.vue`（心情记录条右侧「🎯 节日」入口）
- `release.config.js`（版本说明与签名）

### 新增（测试）
- `tests/festive.test.js`（含 `builtInFestivalTable` 与内置常量一致的断言）/ `tests/mood.test.js` / `tests/retrospective.test.js` / `tests/quickCapture.test.js` / `tests/smartClassify.test.js`
- `tests/voiceInput.test.js`（SpeechRecognition 存在/缺失/start 抛错/结果映射/错误码）
- 更新：`tests/cloudSyncData.test.js`（分组覆盖与范围过滤）、`tests/cloudSync.test.js`（选择性拉取未勾选模块保持不变）

## 5. 关键实现注意事项

- 纯函数与存储分离：festive/mood 是纯函数（无存储依赖，node 环境可测）；存储 ref 与坏数据修复集中在 `atmosphereStore.js`。
- 测试环境：`retrospective`（依赖 `coursesForDate` → store）与 `quickCapture`（依赖 `ledger.js` → store）的测试需 `// @vitest-environment happy-dom`。
- 农历节日表只覆盖 2026–2030；之后年份命中不到会自动跳过（`festiveFor` 返回 null），不会报错。
- `useStoredRef('sl_capture_enabled', true)` 等多处调用返回同一个 ref（core.js 按 key 缓存），可放心在多个组件共享。
- 快速录入悬浮按钮移动端 `bottom` 保留了底部导航安全间距，避免与底部导航重叠。
- 选择性拉取的模块分组（`SYNC_MODULES`）需与 `SYNC_DEFAULTS` 的键保持一一对应；新增同步键时记得同时补到 `SYNC_DEFAULTS` 与对应分组（单测已断言「不重不漏」，改坏会红）。
- `pullFromCloud({ keys: [] })`（空数组）会直接返回成功提示且不发网络请求；UI 层在未勾选任何模块时已禁用「从云端拉取」按钮，双保险。
- 语音按钮的「一次性提示」用 `sl_voice_hint_seen` 直接读写 localStorage（不走 `useStoredRef`），避免为了一个纯 UI 标记把 `localChanged` 置脏。

## 6. 验证与发布状态（当前最新）

- 全部门禁通过：`npm run lint`、`npm run typecheck`、`npm test`（208 条全绿）、`npm run build`。
- 最新版本：**2026年08月29日-版本13**，源码签名 `8651dd88cb`（`release.config.js` 中 `RELEASE_SOURCE_SIGNATURE` 与首条 `signature` 一致）。
- 已部署 Cloudflare Pages（`study-life` / `main`）：
  - 版本 13 预览地址：https://f46d6cb3.study-life.pages.dev
  - 版本 11 预览地址：https://4126c4d1.study-life.pages.dev
  - 版本 9 预览地址：https://3260ebd2.study-life.pages.dev
  - 正式域名会按 `functions/` 重定向逻辑自动归一化。
- 部署时 wrangler 会提示「working directory has uncommitted changes」为无害警告，可加 `--commit-dirty=true` 静默。

## 7. 后续可选工作 / 建议

- 快速录入入口目前是固定右下角悬浮球；如需迁移到底部导航或首页头部，改 `App.vue` 中 `.capture-fab` 相关标记与 `src/style.css`（无需动数据层）。
- 农历表可扩展 2030 之后的年份（维护 `festive.js` 的 `LUNAR_DATE_TABLE`）。
- 心情备注目前仅「emoji + 单行 note」，未做跨月趋势图；`monthMoodSummary` 已备好数据。
- 回顾报告暂不生成长图；blocks 结构已为长图生成预留（`type:p|stat|list`）。
- 本次修改尚未 git 提交（本地有未提交改动），如需入库请自行 `git add` / `git commit`。

## 8. 继续发布流程（供新会话）

```
# 1. 修改业务源码后，先跑门禁
npm run check

# 2. 更新版本说明与签名（有改动说明时）
node scripts/bump-release.mjs --notes "说明一|说明二"

# 3. 构建
npm run build

# 4. 部署（收到用户部署指令后再执行）
npx wrangler pages deploy dist --project-name=study-life --branch=main
```
