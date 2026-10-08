# 核心页面 UI 审计（今天 / 待办 / 重要日期 / 日程 / 清单 / 笔记 / 回顾）

> 范围：`src/views/{TodayView,TasksView,ExamsView,EventsView,ListsView,NotesView,WeeklyReviewView}.vue`、`src/components/task-views/*`、`src/components/{TaskCenter,TaskProgress,MemoryView,InboxPanel,QuickCapturePanel,QuickLedgerPanel,EmptyState,SkeletonBlock,VirtualList,SwipeActionItem}.vue`、相关 composables（`taskCenter/taskProgress/taskRecurrence/taskViews/notes/checklists/retrospective/reviewCharts/domain/*/smartClassify/quickCapture`）。
> 方式：`read`/`grep`/`glob` 读源码为主；用本机 Edge 无头 + 原生 CDP 补真机事实（几何、AX 树、控制台、截图）。
> 本轮**未修改 `src/` 与 `tests/` 下任何文件**。所有真机数据来自 `D:/study-life/ui-audit/probe*.mjs`（我临时写的只读探针，不属于交付物）与 `probe*-report.json` / `probe*-shots/*.png`。
> **快照时间：2026-10-07 14:10（Asia/Shanghai）**。审计过程中 `src/views/ExamsView.vue` 于 13:50:14 被并行修复过一次（P0，见下），本报告已按修复后的工作区复核该处；其余范围内文件在本轮内 mtime 未变。真机证据取自 13:32 构建的 `dist`（修复前），因此 P0 的机器复现对应修复前产物。

## 结论摘要

1. **P0 ×1（已于本轮 13:50:14 被并行修复，我复核了 diff）：重要日期（/exams）上只要存在一条「学习」类且未结束的记录，整个列表区就渲染失败** —— 卡片和空态都不渲染，只剩页头 + 一条全局错误提示。根因是模板调用了从未定义的 `reviewSummary`（唯一定义叫 `reviewSummaryOf`），真机控制台可复现 `TypeError: t.reviewSummary is not a function`。修复把模板改成读预计算字段 `item.review`（`ExamsView.vue:503`），与我的建议修法一致；**建议补一条守卫**，因为现有测试没有喂过「学习」类数据。
2. **P1 ×2**：① 待办列表在 390px 手机上**标题被挤成 0 宽**（只剩优先级/课程胶囊与截止时间）；② 待办与清单的**滑动动作按钮点了没反应**（动作在滑动展开的那一刻就已经执行了，露出的按钮是遗留的死控件）。
3. P2 ×6：清单/收件箱的筛选不暴露选中态；空清单误报「这个筛选下暂时没有物品」；笔记 0 条时标题写「还没有匹配的笔记」且空态没有主按钮；回放弹窗的日期/月份控件没有可访问名称（AX 树 `name:""`）；回放空态标题只描述「那一天」却复用到月度/年度；勾选类触控目标只有 23–24px（粗指针 44px 兜底不覆盖它们）。
4. P3 ×4：`一键整理` 的提示会被另一条提示的 `v-if` 压住（窗口期内零反馈）；`TodayView.taskDeadline` 有一段不可达分支；`历史 ` 按钮 0 条时带尾随空格；回顾页同页对同一概念混用「晴朗/晴」；生成的回顾笔记里「专注」其实是预计分钟数。
5. **已核查确认没问题**的关键项：7 个页面在 390/1024/1440 四档均无横向溢出；看板/月历的键盘路径与 aria 接线完整；弹窗（冲突确认、删除确认、重新安排）都按仓库 `state + 回调 + v-if 随目标挂载` 的惯例接线；重复规则文案与行为与 `tests/taskRepeatRules.test.js` 口径一致；`mood.js` 的非标准 emoji 归「多云」、`SwipeActionItem` 收起时移出 Tab 序、TodayView 的 `.task-*` 死 CSS、面子上的 `role=radiogroup` 无方向键模型，都是**有注释/有报告记录的既定项**，未计入问题。
6. **证据链注意事项（工具链，不是 UI 缺陷）**：`D:/study-life/ui-audit/shots/` 下那 11 张路由截图**全部被「已更新」发布说明弹窗遮住**，页面内容基本看不见。原因：`audit-ui.mjs` 的 SEED 用页面里的 `globalThis.__STUDY_LIFE_RELEASE__` 写 `study_life_seen_release`，而该标识符只在**构建期**被替换成字面量（`vite.config.js:36`，dist 主包里搜不到它），运行时是 `undefined` → SEED 写入 `'x'`，于是 `shouldShowReleaseNotes()` 仍返回 true（`src/composables/releaseNotes.js:41-45`）。本报告的真机结论改用先点「知道了」再截图的探针取得。

## 问题清单

### [P0][已修复 2026-10-07 13:50:14] 重要日期：「学习」类未结束记录会让整个列表渲染失败

- 位置：`src/views/ExamsView.vue:503`（模板调用）、`src/views/ExamsView.vue:180`（真正定义的 `reviewSummaryOf`）、`src/views/ExamsView.vue:147`（本该被使用的预算字段 `review`）
- 状态：**本轮并行修复已落地**（`git diff -- src/views/ExamsView.vue` 只有 1 行）：
  ```diff
  -{{ reviewSummary(item) ? '再安排 25 分钟复习' : '安排 25 分钟复习' }}
  +{{ item.review ? '再安排 25 分钟复习' : '安排 25 分钟复习' }}
  ```
  修复是正确的：`item.review` 由 `visibleItems` 对**每一条**渲染项预计算（`:142-148` 的 `review: reviewSummaryOf(item, grouped.get(item.id))`，失败时是空串），所以模板不再引用任何未定义标识符，且行为与原来想做的一致（有复习任务 → 「再安排」）。
- 未复验的部分：我没有重新构建 `dist`（避免改写并行工作共享的构建产物），因此**修复后的真机表现没有复跑**；下面的机器证据对应 13:32 构建的修复前产物。
- 现象：只要存在一条 `category === '学习'` 且 `countdown.isPast` 为假的重要日期，`/exams` 的列表区就整块不渲染——既没有卡片，也没有两个空态中的任何一个；页面只剩页头/工具条，并弹出全局错误提示「页面遇到一个小问题」。用户完全看不到、也点不到这条记录（也看不到编辑/删除入口）。
- 证据：
  - 源码：`ExamsView.vue:503`
    ```html
    <button v-if="item.category === '学习' && !item.countdown.isPast" type="button" class="review-action"
            @click="createReviewTask(item, $event)">{{ reviewSummary(item) ? '再安排 25 分钟复习' : '安排 25 分钟复习' }}</button>
    ```
    全仓 `reviewSummary` 只有 5 处命中（`grep` 结果）：`ExamsView.vue:121` 是注释、`:147` 是 `reviewSummaryOf(...)` 赋值、`:180` 是函数定义、`:503` 是这次调用、外加本仓既有报告 `docs/audit/ui-audit-ledger.md:16,215`。**没有任何 `reviewSummary` 定义**，`app.config.globalProperties` 也未被使用（全仓 0 命中）。
  - 真机（`probe4.mjs`，全部通过应用自己的表单造数据，避开外部写 localStorage 与镜像恢复的竞态）：
    - 对照「其他」类：新建「普通话考试 / 其他」→ `{"exams":1,"name":"普通话考试","empty":false}`，控制台 0 条错误，卡片正常（`probe4-shots/A-other.png`）。
    - 「学习」类：新建「四六级考试 / 学习」→ `{"exams":0,"names":[],"reviewBtn":0,"empty":"","listHTMLlen":-1}`（连 `.list` 容器都不存在），控制台：
      `error: [GlobalError:render] TypeError: t.reviewSummary is not a function at .../assets/ExamsView-_NHSNsAQ.js:1:16031`
      （`probe4-shots/B-study.png`）。刷新后仍是 `{"exams":0,"empty":false}`。
  - 构建产物一致：`dist/assets/ExamsView-_NHSNsAQ.js` 里就是 `t.reviewSummary(r)?…`（`dist` 构建时间 2026-10-07 13:32 晚于所有范围内源码的 mtime，不存在"dist 过期"的解释）。
  - 旁证：并行进行的账本审计在同一批抓取里也看到同一条错误（`docs/audit/ui-audit-ledger.md:16`、`:215`：「`/bills` 与 `/exams` 各 4 次命中」）。
  - 守卫缺口：全仓没有任何 UI 守卫喂过「学习」类重要日期（`grep tests/` 里 `category: '学习'` 0 命中），所以 176 项审计没抓到它。
- 建议修法：~~把 `:503` 的 `reviewSummary(item)` 换成已经预算好的 `item.review`~~（**已按此修复**）。剩下要做的是**补守卫**：现在 `tests/` 里没有任何 UI 用例喂过「学习」类重要日期（`grep tests/` 里 `category: '学习'` 0 命中），所以 176 项审计与 200+ 条守卫都没抓到它。建议加一条渲染 `/exams` 且数据含 `category:'学习'`、非过去日期的用例（断言至少有一张 `.exam` 卡、控制台无错），并考虑用 `tests/templateBindingIntegrity.test.js` 的形态扩一条通用判据：**模板里调用的标识符必须在同一组件的 setup 里存在**。

### [P1] 待办列表在 390px 手机上标题被挤成 0 宽

- 位置：`src/views/TasksView.vue:843-846`（`.task-main{flex:1}`）、`src/views/TasksView.vue:997-999`（`≤760px` 的 `.task-main{width:calc(100% - 38px)}`）、`src/views/TasksView.vue:853-859`（`.task-topline h2{overflow:hidden;white-space:nowrap}`）、`src/views/TasksView.vue:863-870`（胶囊 `flex:0 0 auto`）
- 现象：390px 宽下，一条「标题 + 优先级 + 课程 + 截止时间」的待办渲染成
  `▢ 高优先级 高等数学 明天 23:59 ✎ 🗑` —— **标题一个字都看不见**。
- 证据：
  - 真机几何（`probe7.mjs`，用应用表单建一条 `完成高数第三章作业 / 高等数学 / 高优先级 / 明天 23:59`，再只改视口宽度）：

    | 视口 | `.task` 宽 | `.task-main` 宽 | `h2` clientWidth | `h2` scrollWidth |
    | --- | --- | --- | --- | --- |
    | 1440 | 1008 | 783 | 126 | 126 |
    | 1024 | 732 | 507 | 126 | 126 |
    | 760 | 728 | 469 | 126 | 126 |
    | 390 | 362 | **103** | **0** | **126** |

    390 档里 `h2` 的 `getBoundingClientRect().width` 是 `0px`，胶囊与 `.due` 却仍在同一行（y 都是 454）。截图 `probe7-shots/tasks-phone.png`；同一条件在 `probe2-shots/phone-tasks.png` 复现。
  - 机制（可复核）：`.task-main` 是 `flex: 1` → 计算值为 `flex: 1 1 0%`，**`flex-basis: 0%` 会让 flex 布局忽略 `width`**，所以 `:998` 的 `width: calc(100% - 38px)` 完全不生效（我的真机读数里 `.task-main` 的 `flex` 就是 `"1 1 0%"`）。于是「检查框 + `.task-main` + `.due` + `.more`」全部落在同一行，`.task-topline`（`nowrap`）里唯一可收缩的孩子就是 `h2`，被压到 0。胶囊是 `flex: 0 0 auto`、`.due` 也是 `flex: 0 0 auto`，都不会让位。
- 建议修法：二选一或并用——① 把 `.task-main` 的伸缩基准改成内容宽度（`flex: 1 1 auto` 并把 `:998` 的 `width` 换成 `flex-basis: calc(100% - 38px)`），让 `.due` / `.more` 真正换到第二行；② 给 `h2` 一个不可压的下界（如 `flex: 1 1 auto; min-width: 72px`）并允许 `.task-topline` `flex-wrap: wrap`。修完请用 390 档重跑一次几何断言（`h2.clientWidth > 0`），这类"标题归零"在 760/1024/1440 都看不出来。

### [P1] 待办 / 清单的滑动动作按钮是"点了没反应"的死控件

- 位置：`src/views/TasksView.vue:618-624`（只监听 `@swipe`）、`src/views/ListsView.vue:376-382`（同上）、`src/components/SwipeActionItem.vue:159-164`（`onAction` 只 `emit('action')`）、`SwipeActionItem.vue:203`/`:215`（按钮 `@click.stop="onAction(action)"`）、`SwipeActionItem.vue:155`（展开时 `emit('swipe', direction)`）
- 现象：左滑一行，动作**在手指松开、面板展开的那一刻就已经执行**（默认 `left:'complete'`，`src/composables/appearance.js:86,90`）；此时露出的按钮文案已经变成反向动作（「恢复待办」），但**点它什么都不会发生**。用户若想撤销，会以为按钮坏了。
- 证据：
  - 源码：`SwipeActionItem.vue:155` `if (nextOpen && !wasOpen) emit('swipe', direction)` → `TasksView.handleTaskSwipe`（`:271-276`）→ `toggleTask` 立即改 `done/status`；而 `onAction`（`:159-164`）只 `emit('action', …)`，`TasksView:618-624` 与 `ListsView:376-382` 都**没有 `@action` 监听**（Vue 的 emit 无监听者即静默 no-op）。可对照的"正确接线"是账本：`src/views/ledger-panels/LedgerHomePanel.vue:287,290` 用 `:actions` + `@action="$emit('swipe-action', …)"`，`tests/swipeActionItem.test.js:45-53` 也按这个形态写测试——但那条测试只覆盖账本用法，待办/清单这两处没有守卫。
  - 真机（`probe5.mjs`，390 档，用表单建一条待办）：直接点击 `.swipe-action`（「完成」）后，
    `{"clickedLabel":"完成","tabIndex":-1}` → 任务仍是 `{"done":false}`、复选框的 `aria-label` 仍是「标记为已完成」；`probe5-report.json` 的 `tasks_swipe_button_click`。
  - 说明：清单页的同一处**只有源码证据**——那次探针里 `sl_checklists` 为空、页面停在空态，没有 `.swipe-action` 可点（`lists_swipe_button_click` 记为 `none`），见「待确认」。
- 建议修法：二选一——① 改成账本形态：父组件传 `:actions`、监听 `@action`，滑动只负责展开（把"滑动即执行"关掉，或至少在 `open` 时不重复 emit `swipe`）；② 保留"滑动即执行"，但不再渲染这个遗留的单动作按钮（`leftLabel/rightLabel` 只用于视觉提示或直接不渲染）。无论选哪种，都建议补一条"点露出的按钮必须产生状态变化"的 DOM 测试。

### [P2] 清单页与首页收件箱的筛选不暴露选中态、也不在分组容器里

- 位置：`src/views/ListsView.vue:366-373`（全部/待完成/已完成）、`src/components/InboxPanel.vue:16`（全部/#标签）
- 现象：这两组筛选的"当前选哪一项"只存在于 `.on` 这个 class 里；读屏用户听不出选中态，而同一个功能在别的页面是能听出来的。
- 证据：两组都只有 `:class="{ on: … }"`，没有 `aria-pressed`，容器也没有 `role="group"`/`aria-label`。同仓对照：`src/views/TasksView.vue:565-573`、`src/views/EventsView.vue:239-247` 都是 `role="group"` + `:aria-pressed`（`docs/archive/UX_AUDIT_176_REPORT.md:1578-1603` 记录了这次收敛，但那张表里的「ListsView 清单分类」指的是左侧 `.list-sidebar`（`:321-336`，已合规），**物品筛选这一组当时没进收敛范围**）。
- 守卫为什么看不见：`tests/tabPanelSemantics.test.js:112-127` 只锁 5 个文件的"不得再有 tab 语义 + 必须出现 `:aria-pressed`"，`ListsView` 因为别的行（`.list-sidebar`）已含 `:aria-pressed` 而整体通过；`tests/helpers/tabOrder.js:213-224` 只在 `role="group"/radiogroup/tablist` 内扫描，而这两处的容器根本没有角色。
- 建议修法：容器补 `role="group" aria-label="物品筛选"` / `aria-label="收件箱标签"`，按钮补 `:aria-pressed="filter === 'all'"` 等（与 EventsView 完全同形）。

### [P2] 空清单在默认筛选下误报「这个筛选下暂时没有物品」

- 位置：`src/views/ListsView.vue:403`（唯一空态文案）、`src/views/ListsView.vue:98-103`（`filter` 默认 `'all'`）
- 现象：新建一份清单（0 条物品）时，正文显示「这个筛选下暂时没有物品。」——把"清单本来就是空的"说成了"筛选筛没了"，用户会去找那个并不存在的筛选动作。
- 证据：真机（`probe2.mjs`，390 档，通过 seed 造出 `本周采购` + `空清单`）：切到「空清单」后 `itemsEmpty = "这个筛选下暂时没有物品。"`；切到「已完成」筛选后**同一句**（`lists_empty_filter_done`），也就是说有物品、只是被筛掉和完全没物品两种情况读起来一模一样。
- 建议修法：按 `visibleItems.length === 0 && (activeList.items.length === 0)` 分支出「这份清单还是空的，先在下面加一项」，与 `TasksView.vue:439-462` 的 `emptyInfo` 分支同形。

### [P2] 笔记 0 条时标题写「还没有匹配的笔记」，且空态没有主按钮

- 位置：`src/views/NotesView.vue:192`（文案固定）、`src/views/NotesView.vue:39`（`filterNotes` 才是过滤点）
- 现象：没有任何搜索词、也没有任何笔记时，空态标题是「还没有匹配的笔记」——"匹配"暗示存在一个用户在找的目标，实际并没有。同一条空态也没有 `primary-label`，唯一的下一步是页头的「返回首页」，而同类页面（待办/清单/重要日期）的空态都给了直接动作按钮。
- 证据：真机（`probe3.mjs`，390 档，笔记 0 条 + 搜索框为空）：
  `empty = "✦ 还没有匹配的笔记 在首页使用"记录"保存一段想法，之后可以在这里集中查看。"`、`notes_count = "0 条"`、`search = ""`（截图 `probe3-shots/notes-zero.png`、`probe2-shots/phone-notes.png`）。对照 `src/views/EventsView.vue:68-70` 会按 `query` 分支区分「没有匹配的日程」与「还没有日程」。
- 建议修法：照 `emptyState` 的写法按 `debouncedQuery.trim()` 分支；"一条笔记都没有"时给 `primary-label="去首页记录"`/`打开快速记录`（走 `quickRecord` 或跳 `/`）。

### [P2] 回放弹窗的日期/月份控件没有可访问名称

- 位置：`src/components/MemoryView.vue:155-156`
- 现象：`<label v-if="tab === 'day'"><input v-model="day" type="date" /></label>` —— `<label>` 里只有控件、没有文字；`<label>` 关联是合法的，但算出来的可访问名称是空串，读屏聚焦时只说「日期 / Date」，用户不知道这是在选"回放哪一天"还是"回放哪个月"。月度档的 `type="month"` 同理。
- 证据：真机 AX 树（`probe5.mjs`，`Accessibility.getPartialAXTree`，1440 档打开回放弹窗）：
  `{"dateInput":[{"role":"Date","name":""}]}`，同一行的分段按钮则正确：`{"role":"button","name":"那天","pressed":"true"}`。
  守卫看不见它：`tests/formControlNames.test.js:66` 把「控件位于某个 `<label>` 区间内部」直接判为"有名称"，所以这条规则结构上抓不到空 label。
- 建议修法：给两个控件补 `aria-label="回放日期"` / `aria-label="回放月份"`（或把可见文字放进 `<label>`，与 `TasksView.vue:740` 的 `<label>新的截止日期<input …/></label>` 同形）。

### [P2] 回放弹窗的空态标题只描述「那一天」，却复用到月度/年度

- 位置：`src/components/MemoryView.vue:168-174`（固定 title「这一天还没有留下记录」）与 `MemoryView.vue:68-82`（`hasContent` 已按 tab 分支）
- 现象：切到「月度」或「年度」且该区间没有记录时，标题仍然是「这一天还没有留下记录」，与上方已经切走的日期选择器（月/年）自相矛盾。
- 证据：源码事实：`hasContent` 明确按 `tab` 计算（`:68-82`，月度还会额外看 `moodLog`），而 `EmptyState` 的 `title` 是常量字符串（`:172`）；`Modal` 的标题/分段控件同时只显示一个受控的日期选择器（`:155-157`）。
- 建议修法：`title` 按 `tab` 取「这一天 / 这个月 / 这一年还没有留下记录」，或直接复用 `report.title`（`retrospective.js:119,179,240` 已分别产出「那天 / 月度 / 年度回顾」）。

### [P2] 勾选类触控目标只有 23–24px（粗指针下拿不到 44px 兜底）

- 位置：`src/views/TasksView.vue:821-833`（`.check` 24×24）、`src/views/ListsView.vue:504`（`.item-check` 23×23）、`src/components/task-views/TaskBoard.vue:290-303`、`src/components/task-views/TaskCalendar.vue:280-294`（均 24×24）、`src/views/ExamsView.vue:661-666`（`.menu-btn` 28×24）
- 现象：手机上"打勾完成"是最高频的动作之一，命中区只有 23–24px；卡片的「···」菜单按钮只有 28×24。
- 证据：真机 390 档测量（`probe2.mjs`）：`button.check 24x24 ""`、`button.item-check 23x23 ""`、`button.menu-btn 28x24 "···"`（`phone_tasks` / `phone_lists` / `phone_exams` 的 `small` 列表）。
  为什么兜底没生效：`src/style.css:394-401` 的 `@media (pointer: coarse)` 只放大 `.btn:not(.chip):not(.link-btn)`、`button.tap-target`、`[role='button'].tap-target`、`.setting-del`；上面这些选择器一个都不沾。
- 边界（需要 Lead 拍板，不要照我这条直接改）：仓库明确记录过"拒绝按字号+padding 推算像素高度做守卫"，并把 `.chip / .segmented / .link-btn / .toast-btn` 列为**刻意靠间距而非尺寸**的密集控件（`src/style.css:390-393`、`tests/touchTargetHooks.test.js:5-16`）。但**勾选方块与「···」不在那份清单里**，所以我认为这是漏接而不是既定取舍。最小改动是给它们加 `tap-target`（或在粗指针媒体查询里显式列出）。
- 建议修法：给 `.check` / `.item-check` / `.menu-btn` 加 `tap-target`，或把这几个选择器加入 `style.css:394-401` 的粗指针规则；若判定为"刻意密集"，请把它们写进 `style.css` 的注释清单与 `touchTargetHooks` 的说明里，别让它继续悬空。

### [P3] 待办页「一键整理」的提示会被另一条提示压掉

- 位置：`src/views/TasksView.vue:556-558`
- 现象：三条提示的渲染条件不一致——`noticeMessage`（粘贴通知）与 `csvImportMessage`（CSV 导入）无条件渲染，`organizeMessage`（一键整理）却带 `&& !noticeMessage`。在"粘贴通知"提示还亮着的 3.5 秒内点「一键整理」，整理结果**一个字都不显示**，看起来像没反应（`csvImportMessage` 又允许与 `noticeMessage` 同时出现两条一模一样的绿条，同一件事两种口径）。
- 证据：源码 `:556-558`；时长见 `noticeMessageTimer` 3500ms（`:303-309`）与 `organizeTimer` 3000ms（`:82-83`）。没有注释解释这个差异，所以不算既定项。
- 建议修法：三条用同一个"最近一条提示"的口径（同一个 ref + 覆盖写），或至少把 `&& !noticeMessage` 的取舍写成注释。

### [P3] `TodayView.taskDeadline` 有一段不可达分支

- 位置：`src/views/TodayView.vue:275-283`
- 现象：`:277` 已经把所有 `taskStatus === 'overdue'` 的情况拦下并返回「已逾期」，`:280` 的 `if (days < 0) return 已逾期 ${-days} 天` 因而永远走不到（`days < 0` 必然满足 `dueDate < today` → 必然 overdue）。副作用是首页对逾期任务只说「已逾期」，而待办列表说的是「逾期 N 天」（`TasksView.vue:332`），同一件事两种说法。
- 证据：源码 `:275-283` + `src/composables/domain/state.js:16-24`（`taskStatus` 的 overdue 判据）。
- 建议修法：删掉死分支，或把 `:277` 改成先算天数（想在首页显示「逾期 N 天」就统一到列表的口径）。

### [P3] 待办页「历史」按钮在 0 条归档时渲染成「历史 」

- 位置：`src/views/TasksView.vue:542`（`` `历史 ${counts.archived || ''}` ``）
- 现象：`counts.archived === 0` 时按钮文字是「历史 」+尾随空格（同页「全部 N」等筛选都带数字，这里空着显得像漏渲染）。
- 证据：源码 `:542` + `:29`（`counts.archived` 由 `selectTaskView` 产出，`src/composables/domain/selectors.js:42`）。
- 建议修法：`counts.archived ? \`历史 ${counts.archived}\` : '历史'`。

### [P3] 回顾页对同一概念混用「晴朗」与「晴」

- 位置：`src/views/WeeklyReviewView.vue:43`（`moodLabel` → 「晴朗」）、`:152`（大数字用 `moodLabel`）、`:154`（小字「晴 X · 多云 Y · 低落 Z」）、`:203`（aria-label 里也是「晴 X 天」）；`src/composables/reviewCharts.js:356` 与 `describeMoodFocus`（`:387`）用「晴朗」。
- 现象：同一张卡片里主数字写「晴朗」、下一行写「晴」，读屏与视觉在同一格听到/看到两个词。
- 建议修法：三处统一成「晴/多云/低落」（或全用「晴朗」），`WEATHER_NAMES` 是唯一事实来源。

### [P3] 生成的回顾笔记里「专注：X 分钟」其实是预计分钟数

- 位置：`src/views/WeeklyReviewView.vue:75`（笔记正文 `- 专注：${r.tasks.focusMinutes} 分钟`）、`src/composables/domain/weeklySelectors.js:69`（`focusMinutes += numeric(task.estimateMinutes)`）；同页卡片用的是「预计投入」（`WeeklyReviewView.vue:141`），而「专注时段规律」那张图统计的是真实专注会话（`reviewCharts.js:447-476`）。
- 现象：导出的回顾笔记把"完成待办的预计时长之和"写成「专注」，与同一页另一个真正的专注统计（图 + `focusHours.totalMinutes`）是两套数；`retrospective.js:99,167,224` 的「专注」也是同一个预计口径（那几个字符串被 `tests/retrospective.test.js` 钉住，改文案要连带改测试）。
- 建议修法：至少把周回顾笔记这一行改成「预计投入：X 分钟」（与同页卡片一致）；若要统一口径，需要先决定"专注"这个词是给预计值还是给真实会话，再一次性改 `retrospective.js` 的钉住字符串。

## 待确认（未能证实）

1. **`docs/audit/ui-audit-ledger.md:16,215` 说 `all-report.json` 里 `/bills` 也带同一条 ExamsView 渲染错误（四档各 1 次），我在干净页面上复现不出来**：`probe5.mjs` 依次全新打开 `/bills` `/review` `/notes` `/lists` `/events` `/tasks`，六个路由的控制台**全为空**（`routes_console`）。要证实那份归因需要 `ui-audit/all-report.json` 原文（当前 `ui-audit/` 下只有我写的报告，没有 `all-report.json`），或知道那次抓取在同一页面实例里的路由顺序。若确实是"先渲染过 /exams 再跳到 /bills 时错误延迟到达"，那是外壳/错误上报（App.vue、globalError.js）的时序问题，不在我的范围。
2. **清单页"滑动按钮无动作"只有源码证据**：`probe5.mjs` 那次 `sl_checklists` 为空，页面停在空态，没有 `.swipe-action` 可点（记 `none`）。要证实需要一条有清单项的用例（或用表单先建一份清单再点）。源码上 `ListsView.vue:376-382` 与 `TasksView` 完全同形，所以我按同一缺陷记录，但机器结论以待办侧为准。
3. **手机上标题归零的临界宽度没逐档测**：我只测了 390（归零）/760（正常）/1024/1440。520、600、700 这些档位以及"只有课程胶囊、没有优先级胶囊"等更少胶囊的组合还没测。按机制（`flex-basis: 0%` + 唯一可收缩项是 `h2`）推测只要"胶囊 + 截止时间"的固有宽度超过可用宽度就会归零，但**这是推断**，需要逐档几何断言才能定死。
4. **`.task-main{width: calc(100% - 38px)}`（`TasksView.vue:998`）是不是"曾经生效、后来被 `flex:1` 吃掉"**：需要 git 历史或第三十七轮前后的编译产物比对。当前只证实它**现在不生效**。
5. **触控目标（P2 第 9 条）要不要在本轮修**：仓库有"拒绝按推算像素做守卫"的明确记录（`tests/touchTargetHooks.test.js:5-16`），但那份记录里没有勾选方块与「···」。这属于产品取舍，需要 Lead 拍板：接 `tap-target`，还是把它们写进"刻意密集控件"清单并留注释。
6. **`SwipeActionItem` 的"滑动即执行 + 按钮空操作"是不是有意为之（保留视觉提示）**：组件里没有一句相关注释（`:189-193` 只解释了 Tab 序）。如果是有意的，请补注释；否则按 P1 修。

## 已核查确认无问题

- **横向溢出**：7 个页面在 390 / 1024 / 1440 三档、`documentElement.scrollWidth - innerWidth` 全为 0，越界元素列表为空（`probe2-report.json` 的 `phone_*`、`probe1` 的 desktop 各页）。待办看板的三列用了 `minmax(0,1fr)`（`TaskBoard.vue:165-170`）并写了理由注释，长标题不会撑破轨道。
- **状态覆盖（空/加载/出错/全部完成）**：这 7 个页面都从 localStorage 同步读（`useStoredRef`），不存在"数据未到"的中间态，因此不需要骨架屏——全仓 `SkeletonBlock` 只被 `RouteFallback.vue`（懒加载路由，属外壳）使用。空态：`TasksView.vue:575-584`（按筛选分支 + 下一步动作）、`ExamsView.vue:411-427`（两段，第二段给了"右上角重新显示"的指引）、`ListsView.vue:310-318`（有主按钮）、`EventsView.vue:277`（按 query 分支）、`NotesView.vue:192`（文案问题见 P2）、`MemoryView.vue:168`（文案问题见 P2）、`TaskCenter.vue:150-152`（「当前没有后台任务」+ 说明）。全部完成态：`TasksView` 走已完成筛选 + 空态文案「还没有已完成的待办」；`WeeklyReviewView` 每个区块都有自己的空提示（`下周还没有需要提前看的事项。`、`还没有可统计的专注时长记录。`、`describeMoodFocus` 的"只有 N 周…"），不需要页面级空态。
- **看板/月历（`task-views/*`）的键盘与 aria**：方向键换列/换行、空列不是死路（`TaskBoard.vue:56-75` 有注释解释）、卡片主体是**真 button**（避免 ARIA 后代语义被吃掉，`:113-128`）、列容器用 `role="group"` 而非 `list`（`:10-12` 注释）；月历的翻月按钮有中文 `aria-label`、格子 `aria-label` 说出当天条数、选中态用 `aria-pressed`、当日明细行是"打开详情"按钮 + 兄弟按钮而不是嵌套（`TaskCalendar.vue:5-17,74-119`）。与 `taskViews.js:139-149` 的标签生成函数一致。
- **任务操作（完成/撤销/重复/批量）**：完成↔撤销走 `toggleTask`（`domain/commands.js:162`），归档/删除都带 6 秒撤销 Toast（`TasksView.vue:412-436`）；重复规则 6 档的文案与行为（含"完成后生成下一期"的选项文案、结束日期含当天、不重复/脏规则不生成）与 `tests/taskRepeatRules.test.js` 的断言口径一致，`taskRecurrence.js:69-97` 对"工作日跳过周末"和"每月夹到月末"都写了理由；`一键整理`只改字段不删数据（`smartClassify.js` 文件头 + `TasksView.vue:68-84`）。未发现批量操作缺失或状态不一致。
- **弹窗接线（本范围内）**：`TasksView` 的时间冲突确认（`:725-736`）、重新安排日期（`:737-743`）、删除确认（`:724`），`ExamsView` 的删除确认（`:562-569`）、`ListsView`（`:440-447`，三种目标共用一个对话框）、`NotesView`（`:229-237`）、`EventsView`（`:339-359`）都符合仓库"`state` + 回调 + `v-if` 随目标挂载"的惯例，并对应写明了层叠顺序原因；焦点回跳只对**字段校验**做（`setFormError(..., 'title')` 之类），保存失败不抢焦点，与注释口径一致。
- **重复报错/匿名控件/无标签控件/图片 alt**：真机四档里 `nameless`/`noAlt` 均为空；范围内表单控件的标签关联（`TasksView.vue:671-707`、`ListsView.vue:409-432`、`ExamsView.vue:510-545`、`NotesView.vue:198-206`）都用了 `for/id` 或包裹式可见 label（唯一例外是 MemoryView，见 P2）。
- **`mood.js` 的降级**：非标准 emoji → `cloudy`，`weatherOfMood` 返回值被限制在三键内并有注释说明原因（`mood.js:21-39`），`monthMoodSummary` 另外给出 `countsByMood/unknownMoods` 供调用方提示。按设计降级，未计入问题。
- **TodayView 心情按钮的 `role="radiogroup"` 没有方向键模型**：`docs/archive/UX_AUDIT_176_REPORT.md:1590-1592` 明确把"radiogroup 需要方向键模型"记为**已知待办**（"那是另一件更大的事，记在这里备查"），属于已决策边界，不计入问题。
- **TodayView 里 `.task-*/.bill-*/.add-btn/.secondary-panel` 等"没有对应模板"的样式**：`:466-491` 的注释写明是第三十七轮样式重建时**故意保留**的（并给了删除器的判据），按既定项不计入。
- **`SwipeActionItem` 收起时把动作按钮移出 Tab 序**（`:201/:213` `tabindex="-1"`）：`:189-193` 有注释解释（WCAG 2.4.7 焦点可见），且账本行本身有可聚焦的详情入口，属于既定项。
- **`VirtualList`**：窗口化阈值、`reveal-key` 用于聚焦回滚、行高 4px 滞回防抖、`animationsEnabled()` 管住平滑滚动（`:115-126,144-163`）都与注释和 `tests/virtualList.test.js` / `reducedMotionScroll.test.js` 口径一致；`aria-label` 通过 attrs 落到根节点，`NotesView.vue:178` 的「笔记列表」能生效。
- **`TaskProgress`**：`needs-confirmation` 只作为**步骤**状态出现（`taskProgress.js:3-11`），任务级 `state.status` 只可能是 waiting/running/completed/warning/failed/cancelled（`:68-184`），所以 `stateText` 的兜底"进行中"不会误报；`aria-live="polite"` + `role="alert"` 的错误行分工正确。
- **`TaskCenter`**：悬浮胶囊的底栏避让（`:161-163`）与 901px 断点理由（`:337-338`）、计时只在面板打开时跑（`:51-69`）、空态文案（`:150-152`）都没问题；`registerTask` 的契约（`source.status` 必须读响应式状态）有文档（`:175-188`）。
- **`EmptyState` / `SkeletonBlock` / `QuickCapturePanel` / `QuickLedgerPanel`**：`EmptyState` 的 `level` 用于标题层级、空态都用 `:level="2"` 挂在页面 h1 之下，与 `tests/renderedHeadingOrder.test.js` 口径一致；`SkeletonBlock` 用 `aria-hidden` 且降级由全局规则管；两个 Quick*Panel 现在只是 `QuickRecordPanel` 的兼容转发壳（`QuickLedgerPanel` 额外带 `preferredType: 'expense'`），无重复实现。
- **`retrospective.js` / `reviewCharts.js`**：完成率公式已抽成 `taskRatePercent` 并被三处复用（避免同页同名数字含义不同）、空周与 0% 分开（`empty` 标记）、时区一律走 `policyDateKey/policyTimeKey`、跨小时会话整段算在开始小时并写明理由、跳过条数会暴露（`skippedSessions`）。这些都有理由注释与 `tests/reviewCharts.test.js` / `retrospective.test.js` 覆盖，未发现新问题。