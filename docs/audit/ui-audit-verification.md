# 本轮修复的独立复核（对抗性）

复核时间：2026-10-07 14:42–14:55（Asia/Shanghai）
复核对象：Lead 本轮声称修好的 12 处 `src/` / `tests/` 改动
复核方式：`git diff` × 源码交叉核对 × **实证探针**（用仓库内 Vue 3.5.41 编译/运行真实模板、
按 ratchet 同一口径重算行数、跑真实测试），不只看"代码改了没有"
复核者未修改 `src/`、`tests/`、`release.config.js` 下任何文件；未执行 `git add/commit/push`。
本文件是本次复核**唯一**的新增文件。

---

## 结论摘要

| # | 改动 | 结论 |
|---|------|------|
| 1 | `ExamsView.vue` 模板 `reviewSummary(item)` → `item.review` | **成立** |
| 2 | `ImportConflictModal.vue` 新增 `periodTextById` / `courseSummary` | **成立** |
| 3 | `scheduleImportReview.js` 「撤销本次导入」到期收口 | **成立**（无测试保护，属有保留地成立） |
| 4 | `update:showQuickRecord` 已登记 + 页面已监听 | **有保留**：事件名确实对得上，但**它所属的那一层根本打不开**，接线接在一个到不了的出口上 |
| 5 | `useQuickEntryForm.js` 金额非法补 `notify` + `resetSplitState()` | **成立**（`splitCount` 复位是新的用户可见行为，无测试覆盖） |
| 6 | `Sidebar.vue` 补「氛围与纪念日」入口（六处接线） | **成立**（桌面入口已被端到端测试证实；手机「更多」格仅代码核对） |
| 7 | `DataManager.vue` 「从备份恢复」确认文案 | **有保留**：文案**漏说**了若干"是数据不是设置"的类别；`STORAGE_KEYS.reminderLog` 是永远不可能被恢复的僵尸键 |
| 8 | `cloudSyncTransfer.js` 推送路径改用 `readJsonOrNull` | **成立**（残留：`if (!response)` 放行"能解析但非对象"的 JSON；两条新分支无测试） |
| 9 | `ScheduleGrid.vue` 去掉提示里的 Markdown 星号 | **成立** |
| 10 | `ScheduleView.vue` + `LedgerView.vue` 各补一条 `.notice-success` scoped 规则 | **不成立（一半）**：ScheduleView 补上了；**LedgerView 没有补**，且 `NotesView.vue` 是同类未修的第三处 |
| 11 | `TasksView.vue:997` `.task-main` 改 `flex: 1 1 calc(100% - 38px)` | **成立**（纯 CSS 判读，无测试；真机为准） |
| 12 | `ratchetHardcoding.test.js` Sidebar 上限 988 → 1004 | **成立**（就本轮而言）；**但复核时该套件已红**，原因是并发修改中的 `TimeSettingsModal.vue` 涨到 839 行未登记 |

一句话总结：12 项里 9 项成立、2 项有保留、1 项只落实了一半。**没有一项是"代码看起来改了但其实没生效"的假修**，
唯一真正"没生效"的是第 10 项 LedgerView 那一半（改动根本不存在）。

---

## 逐项复核

### 1. `src/views/ExamsView.vue` —— 模板改成 `item.review`

- **结论**：成立。原缺陷（渲染即抛 `TypeError`，列表整块不渲染）的触发路径被堵住了。
- **依据**：
  - `ExamsView.vue:138-149` `visibleItems` 是 `computed`，`:147` 明确把 `review: reviewSummaryOf(item, grouped.get(item.id))` 预计算进每一项；
  - `ExamsView.vue:180-185` `reviewSummaryOf` 在无复习任务时 `return ''`（`:182`），因此 `:503` 的 `item.review ? '再安排 25 分钟复习' : '安排 25 分钟复习'` 在空串时落到「安排 25 分钟复习」——文案要求满足；
  - `ExamsView.vue:433` `:items="visibleItems"`，`:483` 也在用 `item.review`，两条消费点取的都是同一个预计算字段；
  - 全仓 `grep reviewSummary`：只剩 `:121` 的注释提到旧名、`:147` 的调用与 `:180` 的定义，**没有任何地方还调用 `reviewSummary(`**；
  - 实证：`tests/viewRenderMatrix.test.js` 用 `sl_exams` 播了 `category: '学习'` 且 `date: day(23)`（未过期）的记录（`tests/viewRenderMatrix.test.js:69-72`），断言「无 `[GlobalError:`、非路由占位、页面上真的出现『四六级考试』」。该文件 11 条全绿（本轮实跑）。
- **发现的新问题**：无功能问题。仅有注释残留：`:121` 仍写「`reviewSummary` 每次都要遍历整份待办表」，实际函数名已是 `reviewSummaryOf`，属文档级笔误。

### 2. `src/components/schedule/ImportConflictModal.vue` —— `periodTextById` / `courseSummary`

- **结论**：成立。内部 id 不再泄漏到界面，也不会留下多余分隔符。
- **依据**：
  - `props.periods` 的元素形状确为 `{id,label}`：`src/composables/store/timeConfig.js:22` `DEFAULT_PERIOD_LABELS.map((label, index) => ({ id: 'p' + index, label }))`，来源 `ScheduleView.vue:511` `:periods="timeConfig.periods"`；
  - `ImportConflictModal.vue:28-30` `periodTextById` 用 `props.periods.find(p => p.id === id)?.label || ''`，查不到返回空串且**不退回 id**；`:32-39` `coursePeriodText` 对 `!start && !end` 返回 `''`，`start===end` 或 `!end` 时只回一个标签；
  - `:46-48` `courseSummary` 用 `[...].filter(Boolean).join(' · ')`，任一段为空即整段略去——不会出现 `高数 · 周一 ·  · 1-8周` 或首尾悬挂的 `·`；
  - `props.days`（`:9`，`:47` `props.days[course.day]`）与 `weekLabel`（`:41-43`）未改动，行为不变；
  - `:66-72` `formatPeriods` 走的是**下标**访问（`props.periods[detail.periodStart]`），而 `detail.periodStart` 确实由 `src/composables/courseImport.js:32-37` 以数组下标产出，两套写法各自自洽。
- **发现的新问题**：无新增风险。既有理论小瑕疵（与本轮无关）：若 `formatPeriods` 因下标越界返回 `''`，`:93` 会渲染出「实际冲突：第1-8周 · 」这种尾随 `·`。当前 `periods` 与 `detail` 同源，不会发生。

### 3. `src/composables/scheduleImportReview.js` —— 撤销窗口到期收口

- **结论**：成立（逻辑与生命周期挂载都站得住），但**没有任何测试保护**，所以标为"有保留地成立"。
- **依据**：
  - `scheduleImportReview.js:1` 引入 `onBeforeUnmount`；`:53-64` `stopUndoTimer`/`scheduleUndoExpiry` 定义在 composable 内部（每次调用独立 `let undoTimer`），`:65` `onBeforeUnmount(stopUndoTimer)`；
  - 定时器在 `import` 成功路径才启动：`:141-142` 写入 `lastImportUndo` 后 `scheduleUndoExpiry()`，且 `scheduleUndoExpiry` 先 `stopUndoTimer()`，连续两次导入不会叠加定时器；
  - `:156-158` `undoLastCourseImport` 在**过期分支**也执行 `stopUndoTimer(); lastImportUndo.value = null`，成功撤销路径同样清空并停表；
  - 生命周期钩子的调用位置合法：`useScheduleImportReview` 的唯一调用点是 `src/views/ScheduleView.vue:131`，位于 `<script setup>` 顶层、setup 同步执行期（同文件 `:158-159` 自己也在用 `onDeactivated/onBeforeUnmount`），因此 `onBeforeUnmount` 能正确挂到 ScheduleView 实例上；
  - 按钮可见性链路完整：`ScheduleView.vue:484` `:can-undo="Boolean(lastImportUndo)"` → `BatchImportModal.vue:20` `canUndo` → `:405` `v-if="canUndo"` 的「撤销本次导入」按钮。定时器清空 ref 后按钮确实消失。
- **发现的新问题**（都不影响"修对没修对"，但影响可维护性）：
  1. 全仓 `grep undoLastCourseImport|lastImportUndo|can-undo|canUndo`（`tests/**`）**零命中** —— 这条 30 秒墙钟行为、定时器清理、过期清状态三件事全靠人工阅读保证，未来改动无回归网；
  2. 定时器只在"导入成功"时替换/启动；`showImportConflict` 关闭等路径不清表，但那是正确语义（到期窗口与面板无关）；
  3. 用了 `window.setTimeout`：本仓库前端只在浏览器/happy-dom 下运行，无 SSR 风险；若将来有 node 环境用例直接调用本 composable，`window` 会 ReferenceError（当前无此调用点）。

### 4. `QuickEntryModal.vue` + `LedgerView.vue` —— `update:showQuickRecord`

- **结论**：**有保留**。两个被点名的判据都成立，但这条修复接在一个**用户到不了的出口**上：那一层浮层根本打不开，所以"三条关闭路径没人接"这个前提本身不成立，修复后也仍未恢复可达性。
- **依据（判据成立部分）**：
  - 事件名两种写法确实能对上。实证：用仓库内 `@vue/compiler-dom` 编译 `<C @update:show-quick-record="x = $event" />`，产物是 `"onUpdate:showQuickRecord"`；而 `emit('update:showQuickRecord')` 走 `toHandlerKey(camelize(event))` 也是 `onUpdate:showQuickRecord`（Vue 对 `update:` 型监听还有 `hyphenate` 兜底）。`QuickEntryModal.vue:81` 已登记、`:315` 发出、`LedgerView.vue:964` `@update:show-quick-record="showQuickRecord = $event"` 接收；
  - `showQuickRecord` 是**可写 ref**：`useQuickEntryForm.js:22` `const showQuickRecord = ref(false)`，`:337` 导出，`LedgerView.vue:333` 从 `const { ... } = useQuickEntryForm({...})`（`:369-375`）解构，不是 computed；
  - `tests/componentEmitContract.test.js` 全绿（本轮实跑 5 个测试文件 50 条全过）。
- **依据（为什么说这条修复没生效）**：
  - `LedgerView.vue:963` 用 `:show-quick-record="showQuickRecord"`（kebab）传给 `QuickEntryModal`，而该名字**没有**声明在 `QuickEntryModal.vue:12-41` 的 `defineProps` 里，所以它落进 `$attrs`，**键名保持 kebab**：`$attrs['show-quick-record']`。
  - 组件模板读的却是驼峰：`QuickEntryModal.vue:311` `v-if="$attrs.showQuickRecord"`、`:312` `:open="$attrs.showQuickRecord"` → 恒为 `undefined` → `QuickRecordPanel` 永不渲染 → 点「⚡ 用一句话记」（`:214` → `emit('open-quick-record')` → `LedgerView.vue:959` → composable `openQuickRecord()` 置 `true`）**什么都不会发生**，✕/遮罩/Esc 那条新接好的关闭路径也就永远走不到。
  - 实证两条独立证据：(a) 编译 `:show-quick-record="v"` 得到 `{ "show-quick-record": v }`，Vue 只对**声明的 prop** 做 `camelize` 匹配（`node_modules/@vue/runtime-core/dist/runtime-core.cjs.js:5034` 是 `attrs[key] = value`，用的就是原始键名）；(b) 用仓库内 Vue 3.5.41 + `@vue/server-renderer` 真跑一个父子组件，读 `useAttrs()`：`attrs.showQuickRecord === undefined`、`attrs['show-quick-record'] === true`、`Object.keys(attrs) === ['show-quick-record']`。
  - 这是**既有缺陷**而非本轮引入（`git show HEAD` 里 `LedgerView.vue:810` 与 `QuickEntryModal.vue:286-287` 就是同一组写法），但本轮把它当成"关闭路径断了"来修，修完仍然点不开 → 本条结论只能是"有保留"。
- **发现的新问题 / 建议**：改成 `$attrs['show-quick-record']`，或干脆把 `showQuickRecord` 声明成 prop（后者更稳，且 `:311/:312` 可直接写 `showQuickRecord`）。另需注意：`componentEmitContract.test.js` 只校验"声明过"，不校验"父级监听/可达"，所以它在这条缺陷面前天然是绿的——这正是第 4 项能"看似修好"的原因。App.vue 里另有一条独立挂载（`src/App.vue:509`），属并发修改范围，本次未复核。

### 5. `src/composables/ledgerView/useQuickEntryForm.js` —— 金额非法提示 + 连续记复位

- **结论**：成立。两处都真的接上了，`resetSplitState()` 的效果与原来手写的两行语义一致且更好。
- **依据**：
  - `useQuickEntryForm.js:67-71` `resetSplitState()` 定义在同文件作用域内（`:362` 也导出），`:319` 在「连续记」分支调用；它做 `splitCount='1'`、`splitMine=''`、`splitMineIsDerived=true`。原代码是 `splitMine.value=''; syncSplitMine()`：由于紧邻的 `:300` 已把 `amountInput` 清空，`syncSplitMine()`（`:101-106`）会因 `amountToCents('') === null` 把 `splitMine` 置空 → **`splitMine` 结果完全一致**；额外多做的两件事（人数复位、派生标志复位）正是注释里说的静默继承 3 人分摊那一处，方向正确；
  - `amountEl` 在本页是空操作的说法属实：`LedgerView.vue:332-368` 的解构清单里**没有 `amountEl`**，所以 composable 里的 `amountEl` 从未绑定（弹窗内 `QuickEntryModal.vue:216` 的 `ref="amountEl"` 是同名局部 ref，两回事）；
  - `notify` 就是页面 toast，且**不会抛**：`LedgerView.vue:372` 传 `notify: showToast`，`LedgerView.vue:94-96` 的 `showToast` 只做 `toast.value = {...}`；
  - `:240-248` 非法金额分支现在 `focus()` 之后 `notify('请先填写有效金额，例如 12.50')` 再 `return false`，弹窗由页面按返回值决定是否收起（`:232` 文档也说明了返回值契约）。
- **发现的新问题**：
  1. `resetSplitState()` 把 `splitCount` 复位成 `'1'` 是**用户可见的行为变化**：连续记同一笔分摊的人每次都要重新填人数。这是有意为之（注释已解释），但没有任何测试钉住它——`grep resetSplitState|请先填写有效金额 tests/**` 零命中；
  2. `splitMineIsDerived=true` 会丢弃"编辑既有分摊记录时外部给定的份额"这一状态。在「连续记」场景下这是对的（已经新起一笔），但它是与原来两行不同的一处语义扩展，值得在发布说明里带一句。

### 6. `src/components/Sidebar.vue` —— 「氛围与纪念日」入口

- **结论**：成立。六处接线齐全且名字一致，桌面入口已被端到端测试证实能开能关。
- **依据（逐处点名）**：
  - 懒加载工厂 `Sidebar.vue:38` `loadFestiveSettings = () => import('./FestiveSettings.vue')`；
  - 异步组件 `:52` `const FestiveSettings = defineAsyncComponent(loadFestiveSettings)`；
  - 预热分支 `:130` `if (name === 'festive') void loadFestiveSettings()`；
  - 桌面按钮 `:564` `@click="showFestiveSettings = true"`（并 `@pointerenter/@focus` 预热）；开关 ref `:107` `const showFestiveSettings = ref(false)`；
  - 手机「更多」格 `:88` `{ key: 'festive', label: '氛围与纪念日', icon: '🎉' }`，分派 `:401` `else if (key === 'festive') showFestiveSettings.value = true`；
  - 挂载点 `:617` `<FestiveSettings v-if="showFestiveSettings" :open="showFestiveSettings" @close="showFestiveSettings = false" />`；
  - 被挂载方的契约也对：`FestiveSettings.vue:20` `defineProps({ open: Boolean })`、`:21` `defineEmits(['close'])`、`:239` `title="节日与纪念日设置"`；
  - `@pointerdown` 由长三元改成 `warmTool(item.key)`（`:517`）**没有变弱**：`mobileMoreGroups` 里出现的 key 只有 `search/appearance/festive/focus/quick-record/account/data/update`，其中除 `quick-record` 外 `warmTool`（`:124-132`）都有分支；`quick-record` 在改前改后都是 no-op。而且旧三元还漏了 `account/update/festive`，现在反而多预热了三个；
  - 删除 `checkingUpdate` 未留残引用（`grep checkingUpdate src/components/Sidebar.vue` 零命中）；`:517` 的 `:disabled` 一并移除，不会再引用已删变量。
  - 实证：`tests/shellToolEntries.test.js`（本轮实跑通过）走完"侧栏找得到『氛围与纪念日』→ 点击 → 等异步分块 → `.overlay [role="dialog"]` 标题含『节日与纪念日设置』→ 点关闭按钮 → 浮层消失"。
- **发现的新问题**：无。仅两点观察：(a) 手机「更多」那一格**没有测试**（`shellToolEntries` 只覆盖桌面按钮），六处里第 2/3/4/5 处靠代码核对；(b) 「检查更新」入口语义从"立即检查并 toast"改成"打开版本弹窗"（`showVersionUpdate`），这是本轮另一处独立改动，不在 12 项清单内，本次未深评。

### 7. `src/components/DataManager.vue` —— 「从备份恢复」确认文案

- **结论**：**有保留**。文案没有"多说"，但**确实漏说**了几类会被写回的数据；另有一处 `STORAGE_KEYS` 僵尸键。
- **依据（真实覆盖范围怎么算）**：
  - `dataManagerBackup.js:348` `buildBackupRestoreValues(data, backup.providedFields, STORAGE_KEYS)`；
  - `backupRestore.js:7-14` 只写 `fields.has(field) && data[field] != null` 的项，即 **`STORAGE_KEYS` ∩ 备份文件实际携带的字段 ∩ 归一化数据里存在**；
  - `providedFields` 取自**原始文件**的键（`dataManagerBackup.js:246` `const data = value.data`，`:252` `backupProvidedFields(data)`），因此不会出现"用默认值覆盖新模块"；
  - `dataManagerBackup.js:39-78` 的 `STORAGE_KEYS` 共 38 个键。
- **发现的新问题**：
  1. **漏说**（都会真的写回，但文案没点出）：日程 `sl_events`、专注记录 `sl_focus_sessions`、课程打卡 `sl_course_checkins`、OCR 识别词表 `sl_ocr_vocabulary`、心情记录 `sl_mood_log`、作息/校区/节次 `sl_timecfg`、学期 `sl_semester`、调课 `sl_schedule_exceptions`、课表备注 `sl_schedule_note`、账本分类/汇率/预算/模板（`sl_ledger_categories`/`sl_ledger_fx`/`sl_ledger_budget`/`sl_ledger_templates`）、快速记录设置 `sl_quick_record_settings`。新文案里的「日程」被并进「重要日期和待办」了吗？没有——`sl_events` 是独立模块；「心情记录」「专注记录」「打卡」都是数据而非"设置"，用「各项设置」兜不住。
  2. **僵尸键**：`sl_reminder_log`（`dataManagerBackup.js:77`）永远不可能被恢复——`validateBackup` 归一化后的 `data`（`:253-292`）里根本没有 `reminderLog` 字段，而 `buildBackupRestoreValues` 读的是归一化数据，所以它既不在 `providedFields` 命中数据里，也无法产出值。同时 `makeBackup`（`:94-132`）也没导出它 → 现状是"备份不含、恢复不写、`STORAGE_KEYS` 里挂着"。修法是二选一：补进导出+归一化（真恢复它），或删掉这个键。文案不写它是对的，但键留着会误导后来者。
  3. **没有多说**：文案里的「壁纸」有「只要这份备份里有就会被写回」限定，与 `applyRestoreBackup`（`:352-390`）只在 `data.__wallpaper_images` 存在时才动壁纸、否则直接 reload 的行为一致；「笔记」（`sl_quick_notes`）、「清单」（`sl_checklists`）、「课表模板」（`sl_course_templates`）、「固定账单与消费」（`sl_bills`/`sl_expenses`）都在真实范围里，没有问题。
  4. 恢复确认文案本身没有测试钉住（`grep 从备份恢复|恢复会 tests/**` 只命中不相关的用例），文案与实现的一致性只能靠人工维护。

### 8. `src/composables/cloudSyncTransfer.js` —— 推送路径 `readJsonOrNull`

- **结论**：成立。四条要求逐条对上，`responseError` 既有用法未受影响。
- **依据**：
  - `cloudSyncTransfer.js:105-111` `readJsonOrNull(res)` 尽力解析、失败返回 `null`；`:424` 推送路径改用它；
  - `res.ok === false` 且 body 是 JSON：`:427` `if (response?.conflict) applyCloudMetadata(response)` —— 冲突元数据仍能读回（对应 `tests/cloudSync.test.js:243-256`：409 + `{conflict:true,...revision:8}`，断言 `remoteRevision` 由 7 变 8，本轮实跑通过）；
  - `res.ok === false` 且 body 不可解析：`:430` `response?.error || '推送失败'` 给中文兜底，最终由 `:464-466` 渲染成「推送失败（云端数据未发生变化）」，不再是原来的 `Unexpected token '<'…`；
  - `res.ok === true` 且 body 不可解析：`:437-439` 在 `applyCloudMetadata` 之前抛 `makeHttpError(res.status, '云端返回了无法解析的响应，云端数据未发生变化', …, 'invalid-response')`，不会带着 `undefined` 往下走（下游确实要用 `metadata.revision`：`:447`、`:448`、`:450`）；
  - `responseError` 的既有用法没被碰：`:137` 仍是 `if (!res.ok) throw await responseError(res, '拉取失败')`，其实现 `cloudSyncHttp.js:38-48` 原样未改（本文件 diff 只动了推送段）。
- **发现的新问题**：
  1. 守卫是 `if (!response)`，只挡 `null`/`undefined`/其他 falsy。**能解析但非对象**的 JSON（`123`、`"x"`、`[]`、`true`）仍会走到 `applyCloudMetadata({...response})`；`applyCloudMetadata`（`cloudSyncState.js:350-373`）会把字段全部归一化成 `revision: null`，随后 `saveSyncBase({ baseRevision: null })`、`lastPushedDevice.pushedAt = null`。属于低危残留，但"无法解析"的措辞没覆盖它，可加 `typeof response !== 'object' || Array.isArray(response)` 一并挡掉。
  2. 两条新分支**都没有测试**：`grep readJsonOrNull|invalid-response|推送失败 tests/**` 零命中（现有用例只覆盖"非 2xx + 合法 JSON 冲突"这一条）。

### 9. `src/components/schedule/ScheduleGrid.vue` —— 去掉 Markdown 星号

- **结论**：成立。
- **依据**：`:278-284` 提示文案现在是「点击空白格子，或聚焦后用方向键选中再回车，都能快速添加，点击课程卡片可编辑」，`**` 星号已消失，句子可读。
- **同一 hunk 的顺带改动（一并核对）**：模板里 `timeConfig.campuses.find(c => c.id === timeConfig.currentCampus)` 改成了脚本预计算 `activeCampus`/`activeSeason`（`:20-21`），底层 `currentCampusId()`/`currentSeasonId()` 确实从 `src/composables/store/timeConfig.js:364`、`:374` 导出，且 `normalizeTimes`（`:66-80`）保证 `campuses/seasons/periods` 必为数组，不存在新的空值路径。行为上更稳（原写法在校区 id 失效时显示空串，新写法回落到第一个校区）。无新问题。

### 10. `src/views/ScheduleView.vue` + `src/views/LedgerView.vue` —— `.notice-success` scoped 规则

- **结论**：**不成立（两处只落实了一处）**。ScheduleView 补上了；**LedgerView 根本没有这条规则**（在改动前的 HEAD 里也没有），另发现 `NotesView.vue` 是同类未修的第三处。
- **依据**：
  - ScheduleView 半边成立：模板唯一使用点 `ScheduleView.vue:344` `<p v-if="focusMessage" class="notice-success" role="status">`；`:549` 是该文件唯一的 `<style scoped>`；新规则 `:573-576` 位于其中；同文件没有第二处使用该类的元素，裸类选择器也不会波及其它元素 → "没有与其它规则冲突到改变别的元素"成立。
  - LedgerView 半边**不成立**：模板 `LedgerView.vue:762` `<p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>`；`grep notice src/views/LedgerView.vue` 只命中 `:265/:278/:288/:295`（`focusMessage` 变量）与 `:762`，**没有任何 `.notice-success` 规则**；`git diff src/views/LedgerView.vue` 的样式 hunk 里也没有样式规则改动；该文件唯一的 `<style scoped>` 在 `:1161`。全站也没有兜底：`grep notice-success src/style.css` 零命中。
  - "该类样式在别处是 scoped 的"这一前提**正确**：`TasksView.vue:769`（scoped 块起于 `:748`）、`EventsView.vue:400`、`WeeklyReviewView.vue:216` 都定义在各自 scoped 块里。scoped 不跨组件，所以 LedgerView/ScheduleView 的段落此前是默认样式。
  - **第三处**：`NotesView.vue:194` 同样用了 `class="notice-success"`，同样**在任何地方都没有这条规则**（`grep notice src/views/NotesView.vue` 只命中这一行）。ScheduleView 的注释还错误地把 NotesView 列为"已定义该类的文件之一"——那句注释本身不准确。
- **发现的新问题**：LedgerView 与 NotesView 的「聚焦态/笔记提示」反馈条仍然是未着色的默认段落；建议按 `WeeklyReviewView.vue:216` 的同一行补两处（LedgerView 补在 `:1161` 的 scoped 块内，NotesView 补在它自己的 scoped 块内），并把 ScheduleView 那句注释里的 NotesView 删掉或改成"待补"。

### 11. `src/views/TasksView.vue:997` —— `.task-main` 改 `flex: 1 1 calc(100% - 38px)`

- **结论**：成立。
- **依据**：
  - 基础规则确实是 `TasksView.vue:843-846` `.task-main { flex: 1; min-width: 0 }` —— `flex: 1` 展开为 `1 1 0%`，因此原来那条 `width: calc(100% - 38px)` 在主轴尺寸上被 `flex-basis: 0%` 覆盖，**确实从未生效**；
  - 新的声明在 `@media (max-width: 760px)` 块内（`:984-1009`，`:997-999`），位置在基础规则之后、同特异度 → 现在真正参与计算（flex-basis = 容器内容宽 − 38px，剩下的 `flex-grow:1`/`flex-shrink:1` 照常）；
  - `.due`/`.more` 换行是设计内的：同块 `:992-995` 把 `.task` 设成 `align-items:flex-start; flex-wrap:wrap`，行内 `flex: 0 0 24px` 的 `.check`（`:821-826`）+ 12px gap 共 36px ≤ 38px 预留，`.task-main` 的假设主轴尺寸约等于整行剩余宽度，于是 `.due`（`:1000-1002`）与 `.more`（`:1003-1005`）落第二行，`.more { margin-left:auto }` 把它推到行尾；
  - 桌面端不受影响：文件里只有这一个媒体查询块且位于文末（`:984` 起，文件到 `:1010` 结束），`grep .task-main src/views/TasksView.vue` 只有 `:843`、`:898`（`.task-main p`）与 `:997` 三处，没有第二处媒体查询覆盖。
- **发现的新问题**：无。唯一保留是**没有测试断言这条布局**（既有守卫不查 flex/width 计算，真机宽度才是最终裁判）；另外 38px 的预留比实际 36px 多 2px，属原作者口径，不改。

### 12. `tests/ratchetHardcoding.test.js` —— Sidebar 上限 988 → 1004

- **结论**：就本轮改动而言**成立**；但复核时整个 `vitest run` 已因此项相关规则变红，**红灯来自并发修改中的文件，不是本轮改动**。
- **依据**：
  - 按测试同一口径（`text.split(/\r?\n/).length`，`ratchetHardcoding.test.js:243`）重算 `src/`：`components/Sidebar.vue = 1004`，**恰好等于登记上限 1004**（零余量）；其余 11 个 >800 行文件也都在各自上限内：`LedgerView.vue 1305 ≤ 1323`、`AppearanceSettings.vue 1115 ≤ 1115`、`TodayView.vue 1012 ≤ 1012`、`TasksView.vue 1011 ≤ 1011`、`style.css 947 ≤ 947`、`App.vue 944 ≤ 944`、`FocusPanel.vue 899 ≤ 899`、`ExamsView.vue 886 ≤ 886`、`QuickRecordPanel.vue 866 ≤ 866`、`LedgerHomePanel.vue 812 ≤ 812`；当时没有"未登记的大文件"。
  - 单人实跑 `tests/ratchetHardcoding.test.js`：23 条**全绿**（其中"超过 1200 行的文件必须登记在册""登记在册的文件也在自己的上限内""超过 800 行的文件逐个受上限保护"均通过）。
  - **复核过程中的变化**：14:49 单独跑该文件时绿，14:53 跑全套 `vitest run`（204 文件 / 2199 条）时变成 `1 failed | 2198 passed`，唯一失败就是这条：
    `AssertionError: 未登记的大文件：components/schedule/TimeSettingsModal.vue=839`。
    这就是任务里预告的并发修改文件之一（`git status` 里它从"未修改"变成 ` M`，行数由 800 以下涨到 839 且未登记上限）。因此：**本轮 12 项里的第 12 项本身没问题，当前红灯的责任在并发分支**。
- **发现的新问题**：
  1. `Sidebar.vue` 顶在 1004/1004，任何一行新增都会立刻让棘轮红——这条上限已经把"还有 1 行的余量"变成"零余量"，下一轮必须先减后加；
  2. `App.vue` 同样是 944/944、`TodayView/TasksView/AppearanceSettings` 也是贴着上限，而 `App.vue` 正在被并发修改，随时会顶破；
  3. 旧基线 `filesOver800Lines` 与 `expect(heavy.length).toBeGreaterThan(5)` 的下限哨兵被删了。虽然"扫描为空"仍会被 `expect(result.linesOf[file]).toBeLessThanOrEqual(limit)`（`undefined <= n` 为假）兜住，但"文件数合理"这一层自证力确实变弱了。

---

## 三条新增守卫的复核

**总评：三条都真的有判别力，不是空断言。但 `componentEmitContract.test.js` 的剥注释正则有可复现的假红/漏判两面洞，且三条都不校验"可达性"。**

### `tests/viewRenderMatrix.test.js` —— 判别力：强

- 三条判据叠加（`无 [GlobalError:` / 不是路由占位 / 播种数据真的出现在页面上，`:170-175`）恰好堵住"页头渲染出来就算过"的假绿——这正是原 `reviewSummary` 缺陷的形状（`:13-31` 说明写得很实）。10 条路由 + 1 条"未播种"基线，共 11 条，本轮实跑全绿。
- 弱点：每条路由只覆盖**一种**播种形状；键名/形状靠人手写对齐（`:50-56` 已自我声明），写错键会静默弱化，好在那条 `mustInclude` 会把它变成红。`vi.resetModules()` + 每路由整壳重挂，代价大但换来真实性。

### `tests/componentEmitContract.test.js` —— 判别力：有，但剥注释正则有两面洞

- 设计对：变异夹具（`:101-110`）证明"漏登记会被抓"，注释夹具（`:112-122`）证明"注释里的 emit 不算数"，还顺带认了 options 组件的 `emits: [...]`（`:66-68`，`AppearanceSettings.vue` 用的就是它）。本轮实跑通过。
- **反例 1（假红：真注释没被剥掉）**：`const a = 1// emit('ghost:event')`
  实测 `usedEvents` 返回 `['ghost:event']`。原因是头部字符类 `[^:'"\w]` 连**词字符**也排除，于是紧贴在数字/标识符后面的 `//` 不被当作注释起点（`foo()// …` 这种前面是 `)` 的能正常剥掉）。这类"注释紧贴代码"的写法一旦出现，守卫会报一个不存在的违规。
- **反例 2（漏判：把代码当注释吃掉，方向更危险）**：`const re = /\/\//g; emit('ghost:event')`
  实测返回 `[]` —— 正则字面量里的 `//` 前一个字符是 `\`，命中"注释起点"，把同一行后面的 `; emit('ghost:event')` 一起涂白，一个真·未登记的 emit 就此消失。同样：`` const u = `${b}//x`; emit('ghost:event') `` 也返回 `[]`。真绿需要"同一行还有别的东西"，属小概率，但它是**漏报**方向。
- **覆盖面的两个静默洞**（当前在 `src/` 里恰好都不存在，所以是潜在而非现实风险）：只认单引号字面量 —— `emit("x")`、``emit(`x`)`` 会被整条跳过（`grep 'emit("|emit(`' src/**` 零命中）；`defineEmits({...})` 对象语法不被认（`grep 'defineEmits({' src/**` 零命中，仓库只有数组写法）。另外动态拼接事件名本就不判，仓库里也没有（`grep 'emit(\s*[^'`]' src/**/*.vue` 零命中）——边界声明与现状自洽。
- **最大的结构性盲点**：它只校验"emit 的名字在同文件 `defineEmits` 里出现过"，**不校验父级有没有监听、更不校验这条路径可不可达**。第 4 项就是活例：`update:showQuickRecord` 已登记、页面已监听、测试全绿，而那一层浮层永远打不开。

### `tests/shellToolEntries.test.js` —— 判别力：强（但只覆盖桌面入口）

- 它测的正是"入口那一步"：侧栏按钮 → 点击 → 等 `defineAsyncComponent` 分块（100×10ms 轮询）→ `.overlay [role="dialog"]` 出现且标题含『节日与纪念日设置』→ 点 `button[aria-label="关闭弹窗"]` → 浮层从 body 消失（`:44-65`）。这足以挡住"按钮在但点不开"和"点了关不掉"两类。本轮实跑通过。
- 弱点：只覆盖桌面侧栏按钮，手机「更多」格那条路没有对应断言；`console.error` 被换成"遇 `[GlobalError:` 即抛"（`:29`）是好写法，但依赖 `#main-content/.overlay` 这类选择器与 10ms 轮询，冷缓存下理论上可能脆。

---

## 仓库卫生

### 1) `git status --short` 未跟踪文件逐条判断（未删除任何文件）

**该提交（源码 / 测试 / schema / 文档）：**

| 分类 | 文件 |
|---|---|
| 组件 | `src/components/AccountPanel.vue`、`DomainCsvImportButton.vue`、`ReleaseNotesBrowser.vue`、`VersionUpdateModal.vue`、`src/components/data/AccountSyncPanel.vue`、`src/components/task-views/TaskBoard.vue`、`TaskCalendar.vue`、`src/views/CourseArchiveView.vue` |
| composable | `src/composables/accountAuth.js`、`accountLocalData.js`、`accountSyncEngine.js`、`accountSyncIdentity.js`、`accountSyncLifecycle.js`、`accountSyncMode.js`、`accountSyncState.js`、`domainCsvImport.js`、`noticeSegments.js`、`reviewCharts.js`、`searchRelevance.js`、`taskViews.js` |
| services | `src/services/accountSync.js`、`src/services/supabase.js`（**读过了**：只从 `import.meta.env` 取 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`，并拒绝非 `sb_publishable_*`/非 `anon` 角色的密钥，无写死 secret） |
| 测试 | `tests/accountAuth.test.js`、`accountLocalData.test.js`、`accountPanel.test.js`、`accountSyncEngine.test.js`、`accountSyncLifecycle.test.js`、`accountSyncTransport.test.js`、`appUpdateActivation.test.js`、`componentEmitContract.test.js`、`conflictDetection.test.js`、`dataHealthStorage.test.js`、`ledgerSpendStats.test.js`、`noticeSegments.test.js`、`reviewCharts.test.js`、`searchEnhancements.test.js`、`shellToolEntries.test.js`、`taskRepeatRules.test.js`、`viewRenderMatrix.test.js` |
| schema/迁移 | `supabase/migrations/20261006165904_account_sync_snapshots.sql`、`20261006170651_account_sync_required_fields.sql`、`supabase/tests/account_sync.sql`（AGENTS.md 明确把 schema/migration 列入"可以提交"；扫过无 secret，只有 DDL/policy） |
| 文档 | `docs/audit/ui-audit-core-pages.md`、`ui-audit-data-sync.md`、`ui-audit-ledger.md`、`ui-audit-schedule.md`、`ui-audit-settings.md`、`ui-audit-shell.md`、`ui-audit-summary.md`（6 份分域 + Lead 汇总）、`docs/research/desktop-distribution.md`、`desktop-product-plan.md`、`docs/supabase-auth.md` |
| 配置样本 | `.env.example`（仅两行占位符：`https://your-project-ref.supabase.co`、`sb_publishable_replace_me`；`!.env.example` 的反忽略生效——`git status` 里它以 `??` 出现即为证据） |

**该提交（已跟踪、本轮被修改）**：`package.json`/`package-lock.json`（新增 `@supabase/supabase-js` 2.117.2）、`vite.config.js`、`release.config.js`、`scripts/bump-release.mjs`、`README.md` 等 86 个 M 条目。这些是程序本体，不在本次"未跟踪"判断范围内。

**不该进仓库（临时产物）：`scratch-seg.mjs` / `scratch-seg2.mjs` / `scratch-seg3.mjs` / `scratch-seg4.mjs`**

- 它们是什么：四个一次性手工探针，全部 `import` `./src/composables/noticeSegments.js`（`splitNoticeSegments` / `buildNoticeCandidates` / `MAX_NOTICE_SEGMENTS`），把若干**虚构**通知文本喂进去、`console.log` 分句与候选解析结果（`scratch-seg.mjs` 5 组 paste/voice 样例；`seg2` 8 组边界；`seg3` 段数上限/确定性；`seg4` 缩进、全角空格、候选字段）。
- 有没有被引用：**没有**。`grep -r scratch-seg`（含 `scripts/`、`package.json`、`vite.config.js`、`.github/`、`tests/`、`docs/`）**零命中**；`package.json` 的 scripts 里也没有。
- 内容安全性：样例里出现的「辅导员 张老师」「学号姓名」「实验楼301」等都是占位/虚构值，**不含真实用户数据、不含密钥**；所以风险是"仓库噪声 + 让读者以为它是项目脚本"，不是隐私。
- 判断：**临时产物，不该进仓库**。建议删除，或移出仓库（如 `D:\study-life\ui-audit\`）；若想留证，改写成 `docs/` 里的样例或并入已存在的 `tests/noticeSegments.test.js` 夹具更合适。**本次未删。**

**已在忽略名单、无需处理**：`supabase/.temp/cli-latest` —— `git check-ignore -v` 显示命中 `.gitignore:23:*.temp`，`git status --ignored` 显示 `!! supabase/.temp/`。写这段时值得留意的是：它是 Supabase CLI 的本地版本缓存，属运行时产物，靠 `*.temp` 侥幸覆盖；若哪天放在 `supabase/.temp/` 之外就需要单独加规则。

### 2) `study-life/AGENTS.md` 逐条核对

| 规则 | 结论 |
|---|---|
| 只提交程序本身（源码/组件/composable/service/parser/tests/配置/lock/构建/Actions/README/LICENSE/.gitignore/schema/migration/虚构 demo） | **符合**。新增的 40+ 个未跟踪文件全部落在这些类别里（上表）。 |
| 不提交运行产生的用户内容（课程表/作息/作业/待办/笔记/通知原文/OCR 历史/账单/专注记录/日程/同步数据/LocalStorage 导出/数据库/备份/上传件/日志/截图） | **符合**。`git status --untracked-files=all` 全量清单里没有任何 `.json`/`.db`/`.sqlite*`/`.png`/`.log`/导出/备份形态的文件；唯一的"内容形态"是 `docs/*.md` 文本报告。仓库根的 `备份文件/` 由 `**/备份文件/` 覆盖（见下）。 |
| 不提交真实姓名/学号/手机号/邮箱/住址/账号/用户·设备·同步 ID/Cookie/Session；测试数据必须虚构 | **符合**。对新文档与新增源码扫 `邮箱 / 1[3-9]\d{9} / 学号[:：]\d{6,}` 零命中；审计报告里出现的标识符都是 seed/夹具值（如 `我的 iPad`、`四六级考试`、`高等数学`）。 |
| 不提交 token/password/secret/连接串/私钥/`.env`；只允许无秘密的 `.env.example` | **符合**。扫 `sb_secret|service_role|eyJ[A-Za-z0-9_-]{10,}|sk-…|Bearer …|password\s*[:=]|apikey|SUPABASE_SERVICE` 只命中两处**说明文字**（`.env.example:1` 与 `docs/supabase-auth.md:23`，都是"禁止使用 secret / service_role key"）。真实 `.env` 被 `.gitignore:41` 忽略且不存在于工作区清单里。 |
| 重点忽略 `备份文件/`、`backups/`、用户数据/上传/导出目录、`.db`/`.sqlite*`、`node_modules/`、`dist/`、`coverage/`、缓存、临时文件、日志、测试产物、IDE 文件 | **符合**，逐条见 3)。 |
| 发布前要做完整检查（`git status`/`git diff`/`git diff --cached`/`git ls-files`、扫敏感信息、`.gitignore` 不是万能、历史扫描、输出检查结论） | **本次只做了一部分**：我看了 `git status`、逐个文件的 `git diff` 与全部未跟踪文件清单，但**没有**扫 Git 历史、也没有跑完整发布检查清单；`--cached` 为空（无暂存内容）。按规则这属于"还没到可以 add/commit/push 的状态"。 |
| 不确定就暂停；绝不为了发布删本地真实数据 | **遵守**：本次没有删除、移动、暂存任何文件。 |

一处与本规则无关但值得记的小问题：`docs/audit/ui-audit-shell.md` 等文档正文里引用了绝对路径 `D:\study-life\ui-audit\shots\`（仓库外的真机截图目录）。截图本身没进仓库（正确），但这段路径对别的机器无意义，属文档可移植性瑕疵，不是隐私问题。

### 3) `.gitignore` 结论（逐条实证）

`git check-ignore -v` 实测：

| 路径 | 结果 |
|---|---|
| `coverage/` | 忽略 ← `.gitignore:11:coverage/` |
| `dist/` | 忽略 ← `.gitignore:12:dist/` |
| `.playwright-cli/` | 忽略 ← `.gitignore:28:.playwright-cli` |
| `备份文件/` | 忽略 ← `.gitignore:33:**/备份文件/` |
| `node_modules/` | 忽略 ← `.gitignore:10:node_modules/` |
| `temp_vitest_cache/` | 忽略 ← `.gitignore:16:temp_vitest_cache/` |
| `.env` | 忽略 ← `.gitignore:41:.env` |
| `.env.example` | **不忽略**（被 `:43 !.env.example` 反忽略；`git status` 里以 `??` 出现即证） |
| `supabase/.temp/cli-latest` | 忽略 ← `.gitignore:23:*.temp` |

其余也已覆盖：`logs`/`*.log`、`test-results/`/`playwright-report/`/`screenshots/`/`traces/`、`*.tmp`/`*.temp`/`*.bak`、`.wrangler`、`**/backups/`、`*.backup.json`/`*.export.json`/`sl_*.json`、`*.db`/`*.sqlite*`、`/HANDOFF.md`、`/NEXT_PROMPT.md`、IDE 目录与 `*.sw?`。
两点观察：(a) `**/*backup*/` 只匹配名字里含小写 `backup` 的**目录**，已跟踪的 `src/composables/dataManagerBackup.js` 不受影响（大写的 `Backup` 也不匹配），无需处理；(b) 没有针对"仓库根散落 `*.png`"的规则——若将来把截图放到仓库内，需要补规则（AGENTS.md 也提示"发现新的运行时数据目录要同步补充 .gitignore"）。

---

## 复核边界（没复核到的、并发修改中的、需要真机才能定的）

1. **复核期间正在被并发修改、本次明确未复核**：`src/App.vue`、`src/components/schedule/TimeSettingsModal.vue`、`src/components/schedule/TimeImportPlanModal.vue`、`src/composables/timeImportPlan.js`。证据：14:42 首次 `git diff --stat` 里 `TimeSettingsModal.vue` / `TimeImportPlanModal.vue` / `timeImportPlan.js` 尚未出现，14:5x `git status` 里三者已变成 ` M`；`TimeSettingsModal.vue` 行数随之涨到 **839**，并**直接造成当前 `vitest run` 唯一一条红灯**（ratchet 未登记大文件）。Lead 的 12 处改动不涉及这四个文件，因此复核面与并发面不重叠。
2. **只做静态/编译/SSR 级验证、没有真机验证的**：第 11 项窄屏换行（`.due`/`.more` 是否恰好落第二行）、第 10 项补样式后的视觉效果、第 6 项入口在手机「更多」面板里的实际点开与滚动、第 5 项 `notify` 的 toast 呈现、深色主题与读屏顺序。这些只有 `happy-dom` + 源码判读，**真机/浏览器仍是最终裁判**。
3. **无测试保护、只能靠代码判读的改动**：第 3 项（30s 到期与定时器清理）、第 5 项（非法金额提示文案、`splitCount` 复位）、第 8 项两条新分支（非 2xx 非 JSON、2xx 非 JSON）、第 10 项新增样式、第 11 项布局、第 7 项确认文案与实现的一致性。
4. **技术性未证实项**：无。12 项全部给出了"成立/不成立/有保留"的判断，没有出现无法判定的条目。
5. **不在本次范围、未评**：`src/App.vue` 里那条独立的快速记录挂载（`App.vue:509`）、`src/components/DataManager.vue` 中同步面板改为 `AccountSyncPanel`/`showLegacySync` 的大改（只核到与第 7 项文案相关的部分：`makeBackup`/`validateBackup`/`applyRestoreBackup`/`buildBackupRestoreValues` 链路）、以及 `tests/*` 中 15 个被修改的既有用例。
6. **没有执行的命令**：`git add` / `git commit` / `git push` 一次都没有跑；`git rm --cached` 也没有；未删除任何本地数据或文件。