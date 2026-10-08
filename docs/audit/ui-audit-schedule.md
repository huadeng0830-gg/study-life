# 课表 / 课程档案 UI 审计

> 范围：`src/views/ScheduleView.vue`、`src/views/CourseArchiveView.vue`、`src/components/schedule/*`（排除 Lead 负责的 `TimeSettingsModal.vue` / `TimeBaseSettings.vue`）、`src/composables/{schedule*,course*,time*,recognitionSchemes,ocr*,timetableLayoutParser,excelTimetableParser}.js`、`src/composables/schedule/useScheduleGrid.js`、`src/composables/store/{schedule,timeConfig}.js`
> 方式：源码阅读为主（`read`/`grep`/`glob`），辅以 `D:\study-life\ui-audit\shots\desktop-schedule.png`、`desktop-course.png` 真机渲染截图与 `dist/assets` 编译产物核对。
> 本轮**未修改 `src/` 与 `tests/` 下任何文件**。只产出本文件。

## 结论摘要

1. **P1 ×2**：① 冲突审阅弹窗把**节次 id 原样印给用户**（`p0至p1`），而同一张卡片里的"实际冲突"行印的是标签——同屏两种口径，用户无法判断到底哪两节冲突；② 作息导入**执行失败时零反馈**：计划弹窗静默切回计划列表，错误只写在被它盖住的 `TimeSettingsModal` 顶部。
2. P2 ×13，集中在**「提示/出口与真实状态不一致」**这一类：课表底部提示把 Markdown 星号原样渲染；`.notice-success` 这个类在 ScheduleView 里**根本没有定义**（`.page-header` 也是同类无定义钩子）；「撤销本次导入」30 秒后静默失效；OCR 部分失败提示"N 张需要重试"却没有重试入口；识别详情弹窗「确认无误」对非阻塞的"未识别"项无效；学期设置预览不随输入框更新；单日视图空状态写死「今天没有课程」；**1024×768 真机下整周视图把「周日」挤出视口且横向滚动条在首屏之外**。另有 2 条 P3（冲突"组"数实为两两对数、校对卡片按钮触控尺寸口径）。
3. 真实缺陷的共同形状与仓库历史一致：**「谁拥有状态 / 谁负责把失败讲出来」没对齐**（`importError` 只有 TimeSettingsModal 一个渲染点；`retryBatchOCR` 只有 TaskProgress 一个触发点，而那个按钮在这条路径上永远不会出现）。
4. **已被注释或测试定性为有意为之的写法，本轮一律不报**，并且逐条确认过它们与注释/守卫一致：课表 roving tabindex + 方向键、点空格预填（另一入口是「＋ 添加课程」）、裁剪弹窗的键盘操作、`ScheduleView → ScheduleGrid` 的 3 条残留死规则（棘轮登记，只准缩小）、空格键不全部可 Tab、`.setting-del` 的 44px 兜底（已显式列入 `style.css:398`）。
5. **核查后确认无问题的重点**：`settingsSchedule.campusId` 确实由 `timeConfig.currentCampus` 派生（不是两套状态）；`BatchImportModal` 的 `period.number` 确有值（`batchPeriodOptions` 走 `numberedPeriodOptions`）；`table.diagnostics` 在 `selectBestTimetableExtraction` 的每条分支上都存在；导入计划的 TaskProgress 不会渲染出无人监听的按钮（`start()` 未传 `cancel`）。
6. 真机证据：`desktop-{schedule,course}.png`（1440×900）与 `tablet-{schedule,course}.png`（1024×768，由另一个并行审计进程在 13:53 生成）已用于核实；**`phone-*.png` 本轮不存在**，我自己的 `node audit-ui.mjs routes` 也因 `EADDRINUSE 127.0.0.1:4181`（同一个进程在跑，我没有抢占端口，也没有另起服务器）未能启动。所以 **≤760px 的结论仍全部来自 CSS 源码**，未在真机证实，集中列在「待确认」。

## 问题清单

### [P1] 导入冲突审阅把节次内部 id 原样显示给用户

- 位置：`src/components/schedule/ImportConflictModal.vue:17-19`（渲染点 `:65`）
- 现象：冲突/重复审阅卡片里，**新课程那一行**的节次显示成内部 id，例如「时间冲突 / 新课程：高等数学 · 周一 · p0至p1 · 1-16周」；同一条目里下一行的「实际冲突」却显示成「第1节至第2节」。同一屏幕两种口径，用户无法核对到底哪两节冲突，而这正是他决定「替换 / 两门都保留 / 跳过」的唯一依据。
- 证据：
  - `ImportConflictModal.vue:17-19`：
    ```js
    function coursePeriodText(course) {
      return course.start === course.end ? course.start : `${course.start}至${course.end}`
    }
    ```
    `course.start` 是节次 **id**，不是标签：`periodIdFromNumber()` 返回 `.id`（`src/composables/courseParser.js:232-234`），`parseBatchLine` 用它写进 `data.start`（`courseParser.js:341-358`）——默认 id 形如 `p0`/`p1`（`src/composables/store/timeConfig.js:22` `{ id: 'p' + index, label }`）。
  - 正确写法就在同一个文件里：`:68` `<small>实际冲突：第{{ formatWeeks(match.detail.weeks) }}周 · {{ formatPeriods(match.detail) }}</small>`，而 `formatPeriods`（`:41-47`）走的是 `props.periods[detail.periodStart]?.label`。
  - 同仓对照：`CourseEditorModal.vue:105-109` 与 `CourseManagerModal.vue:35-39` 的同名函数都用 `periodLabelById()` 转成「第X节」。
- 建议修法：把 `ImportConflictModal.vue` 的 `coursePeriodText` 改为按 `props.periods` 查 `label`（与 `formatPeriods` 同一份数据源），或直接复用 `periodLabelById`；`CourseEditorModal` 已有一份可照抄的实现。

### [P1] 作息导入执行失败时，计划弹窗不给任何反馈

- 位置：`src/composables/timeImportPlan.js:141-147`、`src/components/schedule/TimeImportPlanModal.vue:41,104-112`
- 现象：`applyImportItem` 抛错时，代码回滚了数据、把 `importRunning` 置回 false，于是计划弹窗**立刻切回计划列表**；失败文案只写进 `importError`，而它的**唯一渲染点是下层弹窗**（`TimeSettingsModal.vue:268`，被计划弹窗按浮层深度盖住）。用户看到的就是"确认并导入 → 界面闪了一下又回到计划列表"，无法知道导入是成功还是失败，很可能再点一次。
- 证据：
  - `timeImportPlan.js:141-147`：
    ```js
    } catch (e) {
      currentRecognitionApi()?.restoreTimeConfig(cfg, snapshot)
      const messageText = `导入失败，已恢复原数据：${e?.message ?? '未知错误'}`
      importProgress.fail('save', messageText)
      importRunning.value = false
      importError.value = messageText
    }
    ```
  - `TimeImportPlanModal.vue:41,104`：`<template v-if="!importRunning && importPlan">` / `<template v-else>` + `<TaskProgress …>`；`importRunning=false` 后进度卡（唯一能显示 `task.error` 的地方，见 `TaskProgress.vue:75`）**不再渲染**，而计划分支里没有任何错误渲染——该组件也**没有 import `importError`**（`:16-30` 的导入清单里没有它）。
  - `grep importError src` 的全部命中：写入在 `timeSettingsShared.js:39`、`scheduleOcrFlow.js:108/167/170`、`timeImportPlan.js:98/146`；**读取只在 `TimeSettingsModal.vue:268/401`**。
  - 浮层关系：`TimeImportPlanModal` 是 `TimeSettingsModal.vue:502` 的子节点，按 `Modal.vue:55-81` 的"按打开顺序递增 z-index"，后开的计划弹窗盖住它。
- 建议修法：在 `TimeImportPlanModal` 里直接渲染失败态——最省事的是把 `importError` 接进来，在计划列表上方加一条 `role="alert"`；或改为失败时**不**复位 `importRunning`，让 `TaskProgress` 的 `is-failed` 卡（含 `task.error`，`TaskProgress.vue:75`）留在原地，由用户点「重试/关闭」再退出。

### [P2] 课表底部提示把 Markdown 星号原样渲染出来

- 位置：`src/components/schedule/ScheduleGrid.vue:280-285`（关键行 `:284`）
- 现象：课表网格下方那行 💡 提示，用户实际读到的是「点击空白格子或\*\*聚焦后用方向键选中再回车\*\*都能快速添加，点击课程卡片可编辑」——四个星号直接显示。这是全页唯一的操作提示，也是 roving tabindex 的唯一"说明书"。
- 证据：
  - 源码 `ScheduleGrid.vue:284`：`点击空白格子或**聚焦后用方向键选中再回车**都能快速添加，点击课程卡片可编辑`（`<p class="tip">` 内的纯文本节点，`v-html` 未使用，全局也没有 `text-transform` 之类能吃掉星号的规则）。
  - 编译产物复核（`dist` 构建时间 2026-10-07 13:32，晚于最后一次 `src` 改动 12:59）：`dist/assets/ScheduleView-CYL110Ob.js` 中的模板字符串为
    ```
    E(` · `+w(se(t.viewWeek))+`的课程； 点击空白格子或**聚焦后用方向键选中再回车**都能快速添加，点击课程卡片可编辑 `,1)
    ```
    星号进入了运行时字符串，必然被渲染。
- 建议修法：去掉两对 `**`，或改用 `<b>`/`<strong>` 包住"聚焦后用方向键选中再回车"（该 `<p>` 里已有 `{{ }}` 插值，改成元素包裹即可）。

### [P2] `focusMessage` 用的 `.notice-success` 在 ScheduleView 里没有任何定义

- 位置：`src/views/ScheduleView.vue:344`
- 现象：深层链接定位不到课程时提示「这门课程可能已删除或已移动。」，用了成功语义的类名却**没有任何样式生效**——全站 `style.css` 里没有 `.notice-success`，而仅有的三份定义都在别的视图的 `<style scoped>` 里（scoped 不会外泄）。于是这条提示既不是成功色也不是警告色，就是一个裸 `<p>`，与账本/待办里同一句提示的观感也不一致。
- 证据：
  - `ScheduleView.vue:344`：`<p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>`；`ScheduleView.vue` 的 `<style scoped>`（`:549-769`）里没有 `.notice-success`。
  - `grep -n "\.notice-success" src` 只命中 `views/EventsView.vue:400`、`views/WeeklyReviewView.vue:216`、`views/TasksView.vue:769`，三处均为 `<style scoped>`（`TasksView.vue:748` / `EventsView.vue:363` / `WeeklyReviewView.vue:215`）。
  - `src` 下唯一的全局样式表是 `src/style.css`，其中无该选择器（`grep notice src/style.css` 只命中 `:15` 的一句注释）。
  - `focusMessage` 的取值只有失败语义：`scheduleFocusRoute.js:38`、`:51` 都是「这门课程可能已删除或已移动。」。
- 建议修法：把这条提示换成有定义的类（`ExamsView.vue:409` 用的 `review-message`、`TodayView.vue:371` 用的 `experience-message` 都是同类语义的既有实现），或把 `.notice-success` 提升到 `style.css` 并同时给这类"目标已消失"提示一个中性/警告色类。

### [P2] 课程档案空状态：同一句话印两遍，标题与真实原因不符

- 位置：`src/views/CourseArchiveView.vue:134,171`
- 现象（真机截图 `ui-audit/shots/desktop-course.png` 可见）：没有 `courseId` 打开 `/course` 时，页头副标题是「课程链接缺少课程编号。」，页面中央的空状态又原样重复一句「课程链接缺少课程编号。」，标题却是「找不到这门课程」——**并没有找过任何课程**。有效课程时同页还会把课名印两遍（`h1` 一次、档案卡 `h2` 一次）。
- 证据：
  - `CourseArchiveView.vue:134`：`<p>{{ course ? (scheduleText || '课程时间暂未设置') : routeMessage }}</p>`
  - `:171`：`<EmptyState v-else :level="2" title="找不到这门课程" :description="routeMessage" />`
  - `:102`：`const routeMessage = computed(() => !courseId.value ? '课程链接缺少课程编号。' : !course.value ? '课程可能已删除，关联记录仍会保留在各自页面。' : '')` —— 两种原因共用同一个硬编码标题。
  - `:133` `<h1>{{ course?.name || '课程档案' }}</h1>` 与 `:143` `<h2>{{ course.name }}</h2>` 重复课名。
- 建议修法：空状态标题按 `courseId` 是否存在分档（如「未指定课程」/「找不到这门课程」），描述里只在其中一处出现；课名只在 `h1` 或档案卡 `h2` 里保留一处。

### [P2] 学期设置：预览周次不随输入框更新

- 位置：`src/components/schedule/SemesterModal.vue:9,36-38`（数据源 `src/views/ScheduleView.vue:175-177,533`）
- 现象：`previewWeek` 是从**已保存**的 `semester.start` 算出来的（`weekOf(appToday)`），不是从正在编辑的 `value`。用户改完日期后，弹窗里那句「当前设置下今天是**第 N 周**」纹丝不动，保存后周次却会变——正是这个弹窗承诺要帮他核对的那件事没法核对。
- 证据：
  - `SemesterModal.vue:9`：`previewWeek: { type: [String, Number], default: '' }`；`:36-38`：
    ```html
    <template v-if="Number(previewWeek) < 1">当前尚未到第一周。</template>
    <template v-else>当前设置下今天是<b> 第 {{ previewWeek }} 周</b>。</template>
    ```
    输入框是 `:32` 的 `v-model="value"`，而 `value` 从不参与 `previewWeek` 的计算。
  - `ScheduleView.vue:175-177`：`function semesterPreview() { return weekOf(appToday.value) }`——`weekOf` 读的是 `semester.value.start`（`store/schedule.js:57-64`），即**存储值**；`ScheduleView.vue:533` 用 `:preview-week="semesterPreview()"` 传入。
  - 对照：同一弹窗的 `needsNormalization`（`:15-16`）**是**跟着 `value` 走的，所以两行提示一行实时、一行冻结，看上去像其中一行坏了。
- 建议修法：把预览改成基于草稿值计算，例如在 `SemesterModal` 内部用 `mondayOfDate(value)` 反推并本地算 `weekOf`（`weekOf` 只依赖 `semester.start`，可临时构造或抽一个 `weekOfFrom(start, date)`），或让 `ScheduleView` 传入 `:preview-week` 时接受草稿日期。

### [P2] 识别结果详情弹窗：「确认无误」对非阻塞的"未识别"项无效

- 位置：`src/components/schedule/RecognitionSchemeDetailModal.vue:132-139`（失效根源 `src/composables/scheduleRecognition.js:353-368`）
- 现象：对「未识别，导入后将保留原时间 08:00–08:45」这类**非阻塞**问题，行内会出现「确认无误」按钮（判据是"所有 issue 都非阻塞"）。点下去 `row.confirmed = true`，但这一行的提示文字**不会消失**、行仍然保持异常底色、仍然留在「异常 N」筛选里，按钮也还在——看起来完全没反应。用户会反复点。
- 证据：
  - `RecognitionSchemeDetailModal.vue:132-139`：
    ```html
    <div v-if="rowIssuesFor(row).length" class="detail-row-issues">
      <span v-for="issue in rowIssuesFor(row)" :key="issue.message">⚠ {{ issue.message }}</span>
      <button v-if="rowIssuesFor(row).every((issue) => !issue.blocking)" class="btn btn-xs"
        @click="row.confirmed = true">确认无误</button>
    ```
  - `recognitionSchemes.js:184-186`：`rowIssuesFor(row)` 每次都从 `validateSchemeRows` 重算，不读 `confirmed`。
  - `scheduleRecognition.js` 里 `confirmed` **只在 `:365` 被读一次**：`if (row.sourceIssues.length && !row.confirmed) add(row, …, row.sourceIssues.join('；'), false)`；而 `:353-361` 的缺时间提示由 `!row.start || !row.end` 决定，与 `confirmed` 无关：
    ```js
    if (old?.start && old?.end) { keepOldCount += 1; add(row, RECOGNITION_ISSUE.MISSING_TIME, `未识别，导入后将保留原时间 ${old.start}–${old.end}`, false) }
    else { add(row, RECOGNITION_ISSUE.MISSING_TIME, '未识别，请确认') }
    ```
  - 所以：只带 `sourceIssues` 的行能"消掉"，只带"保留原时间"的行点了无效——同一个按钮两种行为。
- 建议修法：让 `confirmed` 在 `validateSchemeRows` 里也参与 `MISSING_TIME`（非阻塞那支）的判定（例如 `if (old?.start && old?.end && !row.confirmed)`），或在 UI 上把按钮文案改成它真正能做的事（"已确认，导入按原时间"）。

### [P2] 「撤销本次导入」按钮 30 秒后静默失效

- 位置：`src/composables/scheduleImportReview.js:114,127-133`（按钮 `src/components/schedule/BatchImportModal.vue:405`，接线 `src/views/ScheduleView.vue:484`）
- 现象：批量导入成功后成功面板里有「撤销本次导入」。撤销窗口是 30 秒（`expiresAt`），但**没有任何代码把过期的 `lastImportUndo` 清掉**，按钮因此在本次会话里一直可见可点；30 秒后再点，`undoLastCourseImport` 第一行就 `return`，**没有提示、没有报错、界面什么都不发生**。用户会以为撤销成功。
- 证据：
  - 设置与判定：
    ```js
    lastImportUndo.value = { snapshot: draft.snapshot, expiresAt: Date.now() + 30000 }   // :114
    function undoLastCourseImport() {
      const undo = lastImportUndo.value
      if (!undo || Date.now() > undo.expiresAt) return      // :129 ← 静默返回
      …
    }
    ```
    `lastImportUndo` 只在 `:131`（撤销成功）被置 null，**没有定时器、没有在失败分支里清**。
  - `ScheduleView.vue:484`：`:can-undo="Boolean(lastImportUndo)"`；`BatchImportModal.vue:405`：`<button v-if="canUndo" class="btn btn-ghost" @click="emit('undo')">撤销本次导入</button>`——过期后 `canUndo` 仍为 true。
  - 对照：Toast 通道也没兜住（`scheduleImportReview.js:116` 的 `showToast` 未传 `undoFn`），所以这是唯一入口。
- 建议修法：过期后给一条反馈再返回（`message.value = '撤销时间已过（30 秒）'`），或加一个 30 秒定时器把 `lastImportUndo` 置 null 让按钮消失，或在 `ScheduleView` 里传 `:can-undo="Boolean(lastImportUndo) && Date.now() < lastImportUndo.expiresAt"`（需要一个走秒的 ref 才能重算）。

### [P2] 批量识图部分失败：提示"N 张需要重试"，却没有重试入口

- 位置：`src/composables/scheduleOcrImport.js:281-293`（按钮条件 `src/components/TaskProgress.vue:77-82`、状态 `src/composables/taskProgress.js:133-147`）
- 现象：多张图片里部分失败时，进度卡写「已保留 N 张图片的结果、M 张需要重试」，但**重试按钮不会出现**——`finish(…, 'warning')` 会把 `canRetry` 置 false，而「重试当前步骤」只在 `task.canRetry` 为真时渲染（只有 `fail()` 那条路径会把它置真）。用户只能重新选择同一批文件（重新选文件确实可用，但提示指向的入口不存在）。同一张进度卡也没有任何"收起/关闭"按钮。
- 证据：
  - `scheduleOcrImport.js:281-293`：
    ```js
    batchOcrProgress.setStep('validate', failures.length ? 'warning' : 'completed', failures.length ? `${failures.length} 张图片需要重试` : '课程字段与结构检查完成')
    …
    batchOcrProgress.finish(
      failures.length ? `已保留 ${summaries.length} 张图片的结果，${failures.length} 张需要重试` : '全部图片识别完成，请确认预览',
      failures.length || reviewCount ? 'warning' : 'completed',
    )
    ```
  - `taskProgress.js:133-147`（`finish`）：`state.canCancel = false; state.canRetry = false`；对比 `fail()` 的 `:159` `state.canRetry = retry`。
  - `TaskProgress.vue:77-82`：动作行 `v-if="stalled || task.canCancel || task.canRetry || task.retainedResult"`，"重试当前步骤" `v-if="task.canRetry"`。
  - 连带死路：`retainedResult` 在整条批量路径上从未被置真（`scheduleOcrImport.js:193/278` 的 `fail` 都没传 `retainedResult`，`finish` 里 `:160` 恒为 false），所以「使用当前结果」按钮（`TaskProgress.vue:81` → `@continue-progress="continueBatchResults"`）**永远不会出现**，`continueBatchResults`（`scheduleOcrImport.js:304-306`）在这条路径上是不可达代码。
- 建议修法：把部分失败也走 `fail()`（传 `{ retry: true, retainedResult: Boolean(summaries.length) }`）让重试/继续两个按钮出现，或在 `finish` 后给进度卡补一个"知道了/收起"按钮。

### [P2] 批量录入：无效行没有就地修复入口，却会整批禁用「导入」

- 位置：`src/components/schedule/BatchImportModal.vue:149-150,302,412`
- 现象：只要有一行解析失败（`row.error`），主按钮 `导入 N 门课程` 直接 disabled，且该行**没有**任何修改/删除入口——「直接修改」按钮只挂在 `reviewRows`（`needsReview && !row.error`）上。识图/Excel 自动追加的行只能回到上方文本框手工找到并改写那一行原文，弹窗里也没有"跳到该行"或"忽略此行"。
- 证据：
  - `BatchImportModal.vue:149-150`：`const showRowError = …`；`:150` `const reviewRows = computed(() => props.rows.filter((row) => row.needsReview && !row.error))`；`:302` 的「直接修改」按钮位于 `v-for="row in reviewRows"` 的 `<li>` 内。
  - `:412`：`<button class="btn btn-primary" :disabled="!validCount || invalidCount" @click="emit('import')">导入 {{ validCount }} 门课程</button>`
  - 唯一能改写单行的 `replace-row`（`scheduleBatchText.js:97-116`）只由 `saveReviewEdit()`（`:188-195`）触发，而它要求 `editingSourceIndex`，后者只由 `startReviewEdit(row)`（`:172-186`）设置——同一批 `reviewRows` 限制。
  - 行内确实给出了失败原因（`:355-362` 的 `row.error`），所以这不是"不说"，而是"说了但没有可操作入口"。
- 建议修法：给 `row.error` 的行也提供「修改这一行」（把 `startReviewEdit` 的入口放宽到 `row.error`，`row.data` 为空时从 `cells` 兜底填草稿），并补一个「忽略此行」；或让 `导入` 只在 `validCount === 0` 时禁用，改为在提交前二次确认"将跳过 N 行"。

### [P2] 网格里完全重叠的两门课互相盖住，下面那门点不到

- 位置：`src/components/schedule/ScheduleGrid.vue:253-276`（冲突统计 `src/composables/schedule/useScheduleGrid.js:41-51`）
- 现象：冲突课程在同一个 `grid-column/grid-row` 单元里渲染（`z-index: 2`、无任何偏移或分栏），后出现的块画在上面；`background: c.color + '18'` 只有约 9% 不透明度，所以下面是"透出来"的——两门课的文字叠在一起读不出来，且点击只会命中上面那门。而"两门都保留"是导入流程明确提供的选项（`ImportConflictModal.vue:73`「两门都保留」），保留之后这个格子就永久处于这种状态。
- 证据：
  - `ScheduleGrid.vue:253-266`：
    ```html
    <div v-for="c in visibleCourses" :key="courseInstanceKey(c)" class="course"
      :class="{ conflict: conflictIds.has(courseInstanceKey(c)), … }"
      :style="{ gridColumn: c.displayDay + 2,
                gridRow: `${(periodIndexMap.get(c.start) ?? -1) + 2} / ${(periodIndexMap.get(c.end) ?? -1) + 3}`,
                background: c.color + '18', borderLeftColor: c.color, }" role="button" tabindex="0" …>
    ```
    同一天、同一时间段的两个课程元素落到**完全相同的网格区**；样式里只有 `.course { z-index: 2 }`（`:383`）与 `.course.conflict { outline: 2px dashed var(--danger) }`（`:396`），没有并排、错位或分层展开规则。
  - 冲突确实会同时出现两门以上：`useScheduleGrid.js:29-49` 把同一天所有课按节次两两比较，`ids` 里两条 id 都被收进 `conflictIds`，所以两门都会带 `.conflict`，但视觉上仍是叠在一起。
  - 说明：本次真机截图用的种子数据没有重叠课程，这一条是**由 CSS 与渲染结构推得**（无任何偏移规则 ⇒ 同格必然覆盖），未在真机取到"两门重叠课"的画面。
- 建议修法：给冲突块加可见的分裂呈现，例如 `.course.conflict` 用 `justify-self/width` 按冲突序号左右分栏（或加 `outline` 之外的偏移与半透明遮罩），并让点击命中区不被完全遮住；也可在冲突横幅里补一个"查看冲突并处理"的入口。

### [P2] 移动端单日视图空状态写死「今天没有课程」

- 位置：`src/components/schedule/ScheduleGrid.vue:183-184`
- 现象：单日视图可以用 ‹ › 翻到本周任意一天（`mobileDay`），但切到某一天没课时，空状态仍然说「今天没有课程」——那天不是今天。同一行的「添加课程」按钮加的是**当天**（`mobileDay`），所以文案与行为也不一致。
- 证据：
  - `ScheduleGrid.vue:174-186`：
    ```html
    <button class="day-nav" :disabled="mobileDay === 0" aria-label="前一天" @click="emit('mobile-day-change', -1)">‹</button>
    <div><strong>{{ mobileDayLabel }}</strong>
      <span v-if="mobileDay === todayIdx && viewWeek === currentWeek" class="mobile-today-mark">今天</span> …
    <div v-if="!mobileCourses.length" class="mobile-day-empty">
      <span>今天没有课程</span>
      <button class="btn btn-ghost" @click="openAdd(mobileDay, timeConfig.periods[0]?.id)">添加课程</button>
    ```
  - `useScheduleGrid.js:24`：`mobileDayLabel = ${DAYS[mobileDay.value]} · ${date}`——标题跟着 `mobileDay` 走，只有空状态文案不跟。组件自己已经有"是不是今天"的判据（`:178` 的 `mobileDay === todayIdx`），只是没用在这句文案上。
- 建议修法：`{{ mobileDay === todayIdx && viewWeek === currentWeek ? '今天没有课程' : `${mobileDayLabel} 没有课程` }}`（或统一改成「这一天没有课程」）。

### [P2] 1024px 下默认整周视图把「周日」挤出可视区，横向滚动条却在网格底部（首屏之外）

- 位置：`src/components/schedule/ScheduleGrid.vue:340-346`（断点判据 `src/views/ScheduleView.vue:87`）
- 现象：真机 1024×768 截图 `ui-audit/shots/tablet-schedule.png` 显示：周一…周六可见，**「周日」整列不在视口内**（周六也被右边缘裁掉一段），页面没有任何"还能往右滚"的提示。而这种宽度下默认就是整周视图（只有 ≤760px 才默认单日）。承载横向滚动的容器 `.timetable-wrap` 的高度等于整张表（12 节次时远高于 768px 视口），所以**横向滚动条位于网格最底部、首屏之外**——用户既看不到第七天，也不容易发现左右滚这个操作。桌面 1440 与 1920 下 7 列能放下，受影响区间大致是 760–1000px（平板 / 小笔记本）。
- 证据：
  - 截图 `ui-audit/shots/tablet-schedule.png`（1024×768）：表头依次是 周一/周二/周三/周四/周五/周六，右侧在第 6 列中间被卡片边缘截断。
  - `ScheduleGrid.vue:340-346`：
    ```css
    .timetable-wrap { overflow-x: auto; padding: 16px; }
    .timetable { display: grid; grid-template-columns: 84px repeat(7, minmax(96px, 1fr)); gap: 5px; min-width: 820px; }
    ```
  - `ScheduleView.vue:87`：`const mobileView = ref(... window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')` —— 1024px 落在 `week` 一侧。
  - 截图由 `ui-audit/audit-ui.mjs:395-397` 生成，带 `--hide-scrollbars`，所以首屏连滚动条残影都没有；即便不带该参数，滚动条也在 `.timetable-wrap` 的底边（视口之下）。
- 建议修法：三者择一——① 把默认单日的断点从 760px 提到 1024px 以下都默认单日（`ScheduleView.vue:87` 与 `.mobile-view-switcher` 的 760px 一起调）；② 给 `.timetable-wrap` 加首屏可见的横向可滚提示（右缘渐变遮罩 + "← 左右滑动查看七天"文案，或把滚动条钉在卡片顶部）；③ 把 `min-width: 820px` 降到 ~760px（`repeat(7, minmax(88px, 1fr))`）让 1000px 宽度内能容下 7 列。

### [P2] TimeGeneratePanel：午休/晚休的分钟输入框没有可访问名称

- 位置：`src/components/schedule/TimeGeneratePanel.vue:55-72`
- 现象：`午休` 与 `晚休` 两个 `label` 里各塞了**两个**表单控件（一个"第 X 节 后"的 select 和一个分钟数 input）。按 HTML 规范，`<label>` 的 labeled control 是它内部第一个可标注元素，也就是那个 select；后面的 number input **拿不到这个名字**，读屏只会念出一个无名的 spinbutton。相邻的其它 `gen-item` 都只有一个控件，所以这不是统一写法而是漏写。
- 证据：
  - `TimeGeneratePanel.vue:55-63`：
    ```html
    <label class="gen-item">
      <span>午休：第</span>
      <select v-model.number="gen.lunchAfterIdx" class="num"> … </select>
      <span>后</span>
      <input v-model.number="gen.lunchMin" type="number" min="0" max="300" class="num" />
      <span>分钟（0=不休）</span>
    </label>
    ```
    晚休同形（`:64-72`）。对照 `:34-40`（单一 select）、`:41-44`/`:45-49`（单一 input）都是"一个 label 一个控件"。
  - 组件内与父级都没有给这两个 input 补 `aria-label`（`grep aria-label TimeGeneratePanel.vue` 无命中）。
  - 现有审计探针抓不到这一类：`ui-audit/audit-ui.mjs:226` 的判据是 `el.closest('label')`，只要在 label 里就算"有标签"。
- 建议修法：把这两个 `label` 拆成 `<span>` 文本 + 两个各自带 `aria-label`（如 `aria-label="午休分钟数"`）的控件，或给两个 input 单独包 `<label>`。

### [P3] 触发计数把「组」写成了两两配对计数

- 位置：`src/composables/schedule/useScheduleGrid.js:41-51`（文案 `src/components/schedule/ScheduleGrid.vue:210`）
- 现象：`conflictCount` 每发现一对重叠就 +1，而横幅文案是「有 N 组课程时间冲突」。同一天里三门课互相重叠时会报「3 组」，实际只有一堆冲突。
- 证据：
  - `useScheduleGrid.js:41-51`：内层 `for (let j = i + 1; …) { if (right.start > left.end) break; count++ … }`——`count` 是**冲突对数**。
  - `ScheduleGrid.vue:209-211`：`⚠️ {{ viewWeekText(viewWeek) }}有 {{ conflictCount }} 组课程时间冲突（红框标出），请检查周次设置`。
  - 反例构造：某天有 A(1-2 节)、B(2 节)、C(2 节) 三门同时存在 → 对数 3，用户看到「3 组」，实际是同一时段的一堆。
- 建议修法：要么把文案改成「N 处时间冲突」，要么把统计改成按天/按时段聚类后计数（用并查集或按 `start` 归组）。

### [P3] 校对卡片中的按钮/输入在粗指针下仍低于项目自定的 44px

- 位置：`src/components/schedule/BatchImportModal.vue:598-599,606-607`（覆盖面 `src/style.css:394-400`）
- 现象：识图校对卡片里的「直接修改」「取消」「保存并重新校验」按钮是裸 `<button>`（无 `.btn`、无 `.tap-target`），样式只有 `padding: 4px 7px; font-size: var(--fs-10)`，粗指针下没有兜底规则，触屏上高度约 22px；卡片里的 `input/select` 同样只有 6-7px 内边距。项目自己的最小触控尺寸是 `--tap-min: 44px`（`style.css:151-153`），这些控件恰好落在兜底选择器的缝里。
- 证据：
  - `style.css:394-400`：
    ```css
    @media (pointer: coarse) {
      .btn:not(.chip):not(.link-btn),
      button.tap-target,
      [role='button'].tap-target,
      .setting-del { min-height: var(--tap-min); }
    }
    ```
  - 模板 `BatchImportModal.vue:302`/`:317`/`:318` 的按钮只有 `type`/`class="save"|""`，类名落在 `.review-course-title button, .review-edit-actions button`（`:598-599`，`padding: 4px 7px; font-size: var(--fs-10)`）上。
  - 反面对照（说明这不是"全站都没管"）：`Modal.vue:368` 的关闭键、`CourseManagerModal.vue:90` 的模板删除键都显式带了 `tap-target`；`style.css:398` 还为 `.setting-del` 单列了一条——说明本仓是靠**显式标记**兜底的，这两处漏标。
  - 需要说明的是，`style.css:390-393` 的注释确实声明"刻意排除 `.chip / .segmented / .link-btn / .toast-btn` 这类密集内联控件"，而校对卡片按钮在语义上接近该类别，只是不在名单里——所以这条我按 P3 记，属于"要按统一口径择一"的问题，不是明确违规。
- 建议修法：给校对卡片按钮加 `tap-target`（或在粗指针媒体查询里把 `.review-edit-actions button` 一并纳入），并给 `review-edit-grid` 的 `input/select` 一个 40-44px 的最小高度。

### [P2] 图片裁剪：图片未解码完成时点「裁切并识别」会静默失败

- 位置：`src/components/schedule/ImageCropModal.vue:110-124`
- 现象：`confirm()` 只用"选区百分比"算裁剪框，**没有校验 `img.naturalWidth/complete`**。对象 URL 的图片在弹窗出现的那一刻才开始解码，而「裁切并识别」按钮初始就是可用的（初值选区是整图 100%，`<4%` 的禁用条件不成立）。若用户在解码完成前点击：`sx/sy/sw/sh` 全为 0 → `canvas.width/height = 0` → `toBlob` 返回 null → `if (!blob) return`，**什么都不发生、也没有任何提示**（另一种可能是 `drawImage` 抛 `IndexSizeError`，同样没人接）。用户会觉得按钮坏了。
- 证据：
  - `ImageCropModal.vue:110-126`：
    ```js
    async function confirm() {
      const file = props.file
      const img = imageEl.value
      const crop = selection.value
      if (!file || !img || crop.right - crop.left < 4 || crop.bottom - crop.top < 4) return
      const canvas = document.createElement('canvas')
      const sx = Math.round(img.naturalWidth * crop.left / 100)
      …
      canvas.width = sw; canvas.height = sh
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95))
      if (!blob) return        // ← 静默返回，没有任何用户可见反馈
    ```
    全文没有 `naturalWidth` / `complete` 检查（`grep naturalWidth ImageCropModal.vue` 仅命中这两处乘法）。
  - 按钮初始可用：`:9` `selection = { left: 0, top: 0, right: 100, bottom: 100 }`，`:149` 的 `:disabled` 判据是 `selection.right - selection.left < 4 || …`，初值 100 ⇒ 可用。
- 说明（诚实标注）：触发条件是**竞态**（图片解码慢于用户点击），本轮未在真机复现；确定为事实的是"缺少解码完成校验，且失败路径静默返回"。
- 建议修法：`confirm()` 开头加 `if (!img.naturalWidth || !img.naturalHeight) { /* 给出提示并 return */ }`，或把按钮 `:disabled` 与 `img.complete && naturalWidth > 0` 绑定（`<img>` 上挂 `@load` 置一个 `imageReady` 标志）。

## 待确认（未能证实）

1. **所有 ≤760px 的真机结论未证实**。`ui-audit/shots/` 本轮没有 `phone-*`（只有一个并行审计进程在写 `desktop-*`/`tablet-*`，我自己的 `node D:\study-life\ui-audit\audit-ui.mjs routes` 因 `EADDRINUSE 127.0.0.1:4181` 启动失败——我没有抢占端口，也没有另起服务器）。因此以下判断目前只有 CSS 依据：`760px` 断点下默认单日视图（`ScheduleView.vue:87`）、「整周」视图 820px 网格靠 `overflow-x: auto` 横滚（`ScheduleGrid.vue:340-346`，1024px 已由 `tablet-schedule.png` 证实会挤出第七天）、`.seg` 控件在窄屏的收缩、`Modal` 底部抽屉与安全区（`Modal.vue:510-533` 的 `env(safe-area-inset-*)`）、`.head-btns` 的 44px/横向滚动（`ScheduleView.vue:695-704`）。要证实需要 `phone-schedule.png` / `phone-course.png` 与 `audit-ui.mjs` 的 DOM 指标（`overflowX / wide / clipped / small`）。
2. **本地词库会不会把正确的课名改错**：`scheduleOcrImport.js:250-251` 在识别后无条件调用 `applyOcrVocabulary`，它按编辑距离（≤1，键长 ≥7 时 ≤2）把课名/教师/教室**静默替换**成词库里的词（`ocrVocabulary.js:63-100`），只在进度卡的步骤详情里汇总成"已应用 N 个本地词库建议"。识别结果本身在预览里可以看到，但"这里本来是对的、被词库改过"没有逐条标记。要证实需要一次真机识图，用两个仅差 1 个字符的课名观察是否被改写。
3. **课程携带"当前作息里不存在的节次 id"时的网格定位**：`ScheduleGrid.vue:261-266` 对取不到的 start/end 用 `?? -1`，`grid-row` 会算成 `1 / 2`（表头行）或首尾倒置的区间。可达路径我未能证明：`removePeriod` 有"有课程在用就不许删"的守卫（`store/timeConfig.js:330-333`），数字型历史数据有一次性迁移（`timeConfig.js:208-236`）。要证实需要构造一条 `start: 'p99'` 的课程，观察它是否画到星期表头行上。
4. **完全重叠课程块的可点性**（见 P2 第 11 条）目前是由"同格 + 无偏移规则"推得，真机截图里的种子数据没有重叠课程；要证实需要一条"同一天同一节次两门课"的数据与截图。
5. **`.review-edit-actions button` 的触控尺寸**属于"要不要纳入 44px 口径"的判断，而不是纯粹的漏写（`style.css:390-393` 的排除声明）；我按 P3 记，等 Lead 定口径。

## 已核查确认无问题

以下都**实际读过源码/对照过注释与守卫**，确认不是缺陷（含本轮明确"看到但决定不报"的既定性写法）：

- `src/components/schedule/ScheduleGrid.vue`
  - roving tabindex（恰一格 `tabindex=0`、方向键夹边不回绕、Home/End、回车/空格等价点击）与 `tests/scheduleGridRoving.test.js` 的口径一致，注释 `:96-110` 与实现一致。
  - 点空格预填日期节次是**有意捷径**（另有「＋ 添加课程」，`ScheduleView.vue:340`），按背景要求不报。
  - 横向滚动**机制本身**是通的：`.timetable-wrap { overflow-x: auto }`（`:340`）在 scoped 特异性上压过全局 `.card`（`style.css:434-440` 并未设 `overflow`），固定列网格可横滚，也不存在虚拟滚动的取舍问题；**但可发现性有问题（1024px 挤出第七天），见下方 P2**。
  - 课程块 `role="button"` + `tabindex="0"` + Enter/Space（`:247-271`）：注释 `:247-252` 明确说明这是"给键盘用户补主入口"，与"空格用 roving"并存是有意取舍。
  - 空课表：84 个空格自带「添加课程」的可访问名（`cellLabel`，`:133-135`），底部有操作提示，不需要额外空状态。
  - 冲突标记：`.course.conflict` 红虚框（`:396`）+ 顶部横幅（`:209`），`aria` 与视觉都有表达；当前时间指示由"今天"列高亮 + `今天` 标签（`:215-222`）承担，本仓没有逐分钟的刻度设计。
- `src/views/ScheduleView.vue`：弹窗按需异步加载（`:31-38`，注释 `:29-30`）、五处 ConfirmDialog 字面量与 `tests/confirmDialogMigration.test.js` 的对账约定（`:67-79`）、周次 `span` 非交互 + `aria-live`（`:310-317`）、`.seg` 命中区用 `tap-target`（`:309`）、`semesterPreview`/`goWeek` 的边界钳制（`:161-173`）都正确。
- `tests/scopedChildReachability.test.js:271-275,290-292,319` 登记的 `ScheduleView → ScheduleGrid` 三条残留死规则（`.timetable`、`.course.conflict`、`.exception-tag.makeup`）**是只准缩小的棘轮，按背景要求不报**；`ScheduleView.vue:553-569` 那一段（含 `.skin-notebook`）与 `tests/cssRules.test.js:188-201` 的说明一致，属同一类既定残留。
- `BatchImportModal.vue`：`:308-309` 的 `period.number` **有值**——`periods` prop 来自 `batchPeriodOptions`（`ScheduleView.vue:478`），而它是 `numberedPeriodOptions(timeConfig.periods)`（`scheduleBatchText.js:90-95`），每个选项都被补上了 `number`（`courseParser.js:212-230`）。初始误判已排除。
- `scheduleOcrImport.js:266,284` 直接取 `item.table.diagnostics.reviewCount`（无 `?.`）**不会抛**：`selectBestTimetableExtraction` 的每条返回路径都带 `diagnostics`（`timetableLayoutParser.js:599-604`）。
- `TimeImportPlanModal.vue:105-111` 的 `TaskProgress` 没接 `@cancel/@retry/@continue/@wait`，但**不会渲染出死按钮**：`importProgress.start()` 未传 `cancel` ⇒ `canCancel=false`（`taskProgress.js:86`），运行中 `canRetry/retainedResult` 也都是 false，动作行整体不渲染（`TaskProgress.vue:77`）。唯一残余影响是运行期（约 `160+120+140×N+120ms`，N≤6 时约 1.2s）点 ✕ 无反应——`closeImportPlan` 在 `importRunning` 时提前返回（`timeImportPlan.js:71-74`），窗口极短，只记为观察，不列为问题。
- `CourseEditorModal.vue`：必填校验（`:111-115`）、`periodIndex` 反序自动交换（`:118`）、周次重叠实时 `role="alert"` 提示 + `aria-describedby`（`:178-189`）、色块按钮 `aria-label`/`aria-pressed`（`:201`）、删除走 `ConfirmDialog`（`ScheduleView.vue:398-405`）、归档可恢复（`:203`）均正确；`editingId` 下「＋ 在此格添加另一门课」与 `addAnotherInCell` 的周次顺延（`scheduleCourseForm.js:64-84`）符合注释意图。
- `CourseManagerModal.vue`：批量删除 / 清空 / 删模板三条破坏性操作都经 ConfirmDialog，且快照在弹确认**之前**取（`scheduleCourseManager.js:53-83` 有注释解释原因）；空状态、`<th scope>`、`aria-label="选择"`、复选框 `aria-label` 都在。
- `ExceptionsModal.vue`：`role="tablist"` + `useTabKeys` 方向键、`tabpanel aria-labelledby` 用 computed 规避悬空 id 守卫（`:44-64`）、`endDate < date` 与缺日期校验 + `aria-invalid` + 聚焦回跳（`:120-152`）、空状态（`:236`）都对。
  - 其中「删除」直接 `emit('remove', item.id)`（`:231`）没有二次确认（`store/schedule.js:49-55` 立即 splice，无撤销）——我**没有**把它列为问题：单条特殊日期的增删在同一个弹窗里可见、可立刻重加，与"清空课表/批量删除"的破坏量级不同；如果 Lead 要统一"破坏性操作一律确认"，这里是唯一缺口。
- `SemesterModal.vue`：`type="date"` + 隐式 `label`、非周一时给出归一化警告（`:15-16,33`）、无有效日期时禁用保存（`:42`）都对（预览不实时的问题见 P2）。
- `ImageCropModal.vue`：键盘操作（方向键平移 / Shift 收 / Ctrl 扩 / 首键播种）与 `:45-57` 的长注释、`aria-live` 读数（`:148`）、`aria-describedby` 提示（`:138`）、选区最小尺寸禁用（`:149`）都与 WCAG 2.5.7 的说明一致——按背景要求不作为问题。
- `RecognitionSchemeDetailModal.vue`：三层浮层"先关自己再开计划"的顺序（`:10-12` 注释 + `:149`）与 `Modal.vue` 的 `overlayStack` 机制一致；`detailFilter` 用 `role="group"`+`aria-pressed` 而非 tablist 是合理选择；`clearRecognition()` 一并复位计划（`recognitionSchemes.js:51-60`）不漏状态。
- `TimeGeneratePanel.vue` / `timeGenerate.js`：「覆盖当前方案」只写**草稿**（`timeGenerate.js:74-84` 写 `draft` + `draftDirty`），未保存不入库，且执行前有逐行 `from → to` 预览，不需要额外确认；`genPreview` 由 `timePlanTools` 统一互斥复位（`:86-92`）。
- `store/timeConfig.js`：`normalizeTimes` 的形状修复（`:53-111`，注释解释了"启动即白屏"的历史）、`removePeriod` 的占用守卫（`:330-333`）、`currentCampusId/currentSeasonId` 的回退链（`:364-383`）都正确。
- `settingsPolicy` 与课表工具的校区状态**不是两套**：`resolveSettingsPolicy()` 的 `campusId/seasonId` 直接取自 `currentCampusId()/currentSeasonId()`（`settingsPolicy.js:39-40`），所以 `selectScheduleCampus` 写 `timeConfig.currentCampus`（`scheduleCampusSeason.js:27-34`）会同步更新按钮高亮与 `ScheduleGrid` 的当前校区（初始怀疑已排除）。
- `store/schedule.js`：`courseInWeek` 的 `startWeek/endWeek/weekType` 口径、`weekLabel`（含"全学期/单/双"）、`coursesForDates` 的索引复用、补课/放假的 `scheduleDateContext` 与 `tests/scheduleDates.test.js`、`tests/scheduleSeasonRules.test.js` 一致。
- `courseImport.js` / `courseParser.js` / `excelTimetableParser.js`：失败路径都有**具体到行的原因**（`courseParser.js:326-345` 的 `缺少课程名称 / 未识别星期 / 未识别节次 / 周次超出范围`；`parseBatchLine` 同时产出 `data=null` 与 `error`），Excel 走 `list/grid` 双候选打分（`excelTimetableParser.js:134-146`），零命中时上游会抛「没有找到可识别的课程清单或星期表头…」（`scheduleOcrImport.js:162`）而不是静默成功。
- `timePlanDraft.js`：未保存守卫（`guardDraft` / `pendingDraftAction` / `tryCloseTimeEditor`）覆盖"切方案 / 切分区 / 关闭弹窗"三个入口，且注释解释了"取消时什么都不做"的原因；`saveDraft` 前有 `planHasError` 拦截（`:158-163`）。
- `CourseArchiveView.vue`（除上述 P2）：时间线标题的长文本有处理——`overflow-wrap: anywhere`（`:204-205`）、窄屏把三栏折成两栏（`:209-216`）、`<b v-else>` 给无跳转目标的记录兜底（`:163`）、`EmptyState :level="2"` 落在 `h1` 之下层级正确（`:168,171`）。
  - 顺带核到一处**同类无定义钩子**：`:130` 的 `class="page-header compact-page-header"` 在全仓没有任何样式定义（`grep '\.page-header' src` 只命中 `EventsView.vue:226`、`CourseArchiveView.vue:130`、`NotesView.vue:164` 三处模板用法，`style.css` 与各视图的 `<style scoped>` 里都没有对应规则）。真机截图显示的正是"标题在上、返回按钮另起一行左对齐"的未排版形态。三处一致，看起来是历史上被删掉的全局块留下的空钩子（与 `ScheduleView.vue:550-552` 记录的那次"样式块被删除器破坏"是同一类事故），**量级很小、只影响留白，不单独记为问题**，供 Lead 决定是否统一收口。