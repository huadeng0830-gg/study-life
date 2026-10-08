# 账本 UI 审计

> 范围：`src/views/LedgerView.vue`、`src/views/ledger-panels/*`、`src/composables/ledger*.js`、`src/composables/ledgerView/*.js`
> 方式：源码阅读为主（`read`/`grep`/`glob`），辅以 `ui-audit/shots/{desktop,wide,tablet,phone}-bills.png`（Edge 无头渲染）与 `ui-audit/all-report.json`（同一次四档抓取的 DOM 指标）。
> 本轮**未修改 `src/` 与 `tests/` 下任何文件**。

## 结论摘要

1. **P1 ×2，都在「记一笔」这条主链路上**：金额非法时**没有任何提示**（提示语缺失，且"焦点回跳"绑在一个从未挂到 DOM 上的 ref 上）；账本内打开的「⚡ 用一句话记」面板**关不掉**（✕ / 遮罩 / Esc 只 emit 一个无人监听的事件）。
2. P2 ×7：翻月不清月历选中日导致显示「2月31日 · 0 笔」；预算「接近预算」只剩颜色、没有文案（预算弹窗却承诺了这条提醒）；「我承担」只读输入框的程序化名称写着"可手改"；固定账单表单金额前缀硬编码「¥」与同屏币种选择器冲突；「连续记」静默继承参与人数；搜索/筛选无结果时复用「还没有记录」空状态；等。
3. 第三十七轮以来的既有取舍**基本完好**：`SwipeActionItem` 的 `-140px`、feed 投影 key 顺序、`.pending-row` 不给 `role`、分类/账单的弹窗校验接线、`VirtualList` 行高、退款/分摊口径说明都与注释及测试口径一致，本轮不作改动建议。
4. 真实缺陷集中在**「提示缺失」**与**跨组件事件没接上**两类——与仓库历史上反复出现的两类形状（"某个 ref 只有 composable 持有"、"emit 了但没人监听"）完全同源。
5. 弹窗基础能力（Escape / 遮罩 / 焦点陷阱 / 焦点归还 / 层叠顺序 / 提示可见性）经核查无问题：Toast 的 `z-index:200` 高于浮层的 `100+depth`，所以弹窗开着时的校验提示不会被遮住。
6. 真机侧：`ui-audit/shots/{desktop,wide,tablet,phone}-bills.png` 与 `ui-audit/all-report.json` 里 `/bills` 的四档指标**全部通过**（`overflowX=0`、无越界元素、无文本截断、无重复 id、无匿名按钮、无未标注控件），账本页在 390 / 1024 / 1440 / 1920 四档都是一张"干净"的页面；唯一没被解释的是搜索行上那颗按源码不该出现的「清除」（见「待确认」第 7 条）。
7. 现有守卫的分布提示了缺口所在：`tests/formValidationA11y.test.js` 只盯固定账单表单，`tests/quickEntryModalClose.test.js:157-168` 只断言"弹窗不关、没落库"，**没有一条断言「记一笔」的金额错误提示**。
8. 范围边界：`/bills` 的控制台在四档宽度下都带着一条 **ExamsView 的渲染错误**（`TypeError: t.reviewSummary is not a function`，`all-report.json` 里 `/bills` 与 `/exams` 各 4 次命中）；它与账本代码无关，已由并行探针 `ui-audit/probe-core.mjs` 单独确认，本报告只作记录、不计入账本问题。

## 问题清单

### [P1] 「记一笔」金额非法时零反馈：提示语缺失，焦点回跳是空操作

- 位置：`src/composables/ledgerView/useQuickEntryForm.js:240`（另见同文件 `33`、`309`、`337`）、`src/views/ledger-panels/QuickEntryModal.vue:85,210`、`src/views/LedgerView.vue:332-375`
- 现象：金额是「记一笔」唯一的必填项。留空、或输入 `1.005` / `abc` 这类非法值时点「记下」，弹窗不关闭、列表不新增，但界面上**没有任何文字、颜色或抖动反馈**——用户看到的就是"点了没反应"，无处知道该改什么。
- 证据：
  - `useQuickEntryForm.js:237-241`：
    ```js
    const amount = normalizeAmount(amountInput.value)
    const name = nameInput.value.trim()
    try {
      if (amount === null) { amountEl.value?.focus(); return false }
    ```
    只有 `focus()`，**没有 `notify()`**；而同一个函数里分摊分支是 `if (draft.error) { notify(draft.error); return false }`（250、255 行），金额分支与它形成明确对比。
  - `amountEl` 是"空操作"：它在 `useQuickEntryForm.js:33` 声明、`337` 导出，但 `LedgerView.vue:332-375` 的解构清单里**没有它**（332-369 行列了 30 多个 ref，独缺 `amountEl`），`QuickEntryModal.vue` 也没有 `amountEl` prop。Modal 里 `ref="amountEl"`（85 声明、210 绑定）是该组件自己的另一个 ref，模板与脚本从未读取它。全仓 `amountEl` 命中只有这 6 处（`QuickEntryModal.vue:85/210`、`useQuickEntryForm.js:33/240/309/337`）。→ 金额非法时焦点实际停在原来的「记下」按钮上。
  - 同一条"焦点回跳"意图在连续记分支 `309` 行 `amountEl.value?.focus()` 上同样是空操作，所以「连续记」保存后焦点也不会回到金额框，用户必须再点一次输入框。
  - `normalizeAmount` 的判据（`src/composables/ledger.js:51-77`）确实会拒掉空值与超过两位小数的输入，所以这不是"校验没跑"，而是"跑了但不说"。
  - 守卫缺口：`tests/quickEntryModalClose.test.js:157-168` 的用例名是「金额非法时不能关闭弹窗：否则用户刚填的内容会全部丢掉」，断言只有 `expenses.value.length === 0` 与"弹窗还在"，**没有任何错误文案断言**。
- 建议修法：在 `amount === null` 分支补 `notify('金额不能为空，且最多两位小数')`（与 `useTransactionDetail.js:93` 的文案同源），并让弹窗内联提示也有一条（例如金额框下方 `role="alert"`，与 `BillFormModal.vue:120` 的 `#bill-form-error` 同一形状）。若要保留焦点回跳，需要把 QuickEntryModal 的 `amountEl` 通过 `defineExpose` 暴露给页面、或把聚焦逻辑移进 Modal 内部（`watch(() => props.savingExpense)` 之类）。

### [P1] 账本内打开的「⚡ 用一句话记」面板关不掉（✕ / 遮罩 / Esc 全部失效）

- 位置：`src/views/ledger-panels/QuickEntryModal.vue:304-310`、`src/views/LedgerView.vue:904-964`
- 现象：在「记一笔」里点「⚡ 用一句话记」打开快速记录面板后，点右上角 ✕、点遮罩、按 Esc **都不会关闭**；唯一出口是成功保存一笔记录。手机上面板是底部抽屉（sheet）形态并接管焦点与滚动锁，用户会被困在其中，只能刷新页面。
- 证据：
  - `QuickRecordPanel` 是**受控**组件：`defineProps({ open, ... })`（`src/components/QuickRecordPanel.vue:12-16`）、`defineEmits(['close','saved'])`（17）、模板 `@close="requestClose"`（568）→
    ```js
    function requestClose() { if (saving.value) return; emit('close') }   // 260-263
    ```
    它自己不改变 `open`，必须父层把它置 false。
  - 账本侧父层是 `QuickEntryModal.vue:304-310`：
    ```html
    <QuickRecordPanel v-if="$attrs.showQuickRecord" :open="$attrs.showQuickRecord"
      @saved="onQuickRecordSaved" @close="$emit('update:showQuickRecord', false)" />
    ```
    `update:showQuickRecord` **既不在 48-81 行的 `defineEmits` 列表里**，`LedgerView.vue:904-964` 这一整块绑定里也**没有 `@update:show-quick-record`**：全仓 grep `update:showQuickRecord` 只命中 `QuickEntryModal.vue:309` 这一处，没有任何监听者。
  - 对照仓库里同一组件的正确接线：`src/App.vue:579-585` 是 `v-if="showQuickRecord" :open="showQuickRecord" @saved="onQuickRecordSaved" @close="closeQuickRecord"`，配 `App.vue:302` 的 `function closeQuickRecord() { showQuickRecord.value = false }`。账本侧缺的正是这一句。
  - 现存的唯一关闭路径是保存成功：`@saved` → `emit('quick-record-saved')` → `LedgerView.vue:961` → `useQuickEntryForm.js:150-158` 里的 `closeQuickRecord()`。
  - 这一处和仓库里已被修过的两个同类缺陷（`LedgerView.vue:389-393` 的 `@close="closeQuick"`、`LedgerView.vue:966-969` 的 computed 赋值）是同一形状：**开关归谁所有、由谁置 false** 没对齐。
- 建议修法：在 `LedgerView.vue` 的 `<QuickEntryModal>` 上补 `@update:show-quick-record="showQuickRecord = $event"`（并把 `update:showQuickRecord` 登记进 `defineEmits`）；或把 `QuickEntryModal.vue:309` 改成走 composable 的收尾函数 `@close="closeQuickRecord(); $emit('update:showQuickRecord', false)"`。

### [P2] 回顾分区翻月不清除月历选中日，界面显示不存在的日期

- 位置：`src/composables/ledgerView/review.js:20-26`（`shiftMonth`）对照 `27-33`（`jumpToMonth`）；渲染处 `src/views/ledger-panels/ReviewPanel.vue:250-284`
- 现象：在有 31 天的月份点选 31 日，再用「‹」翻到 2 月或 4 月，月历下方的详情区照样显示「**2月31日** / 0 笔 · ¥0.00」，而日历里没有任何格子处于选中态——界面在陈述一个不存在的日期。
- 证据：
  - `review.js:20-26`：
    ```js
    function shiftMonth(delta) {
      const [y, m] = reviewMonth.value.split('-').map(Number)
      const d = new Date(y, m - 1 + delta, 1)
      reviewMonth.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
      resetReviewCategoryView()      // ← 只重置 expandedCategory / showAllReviewCats（107-110）
    }
    ```
    **没有 `selectedDay.value = null`**；而 `jumpToMonth`（27-33）明确写了 `selectedDay.value = null`，两条换月路径口径不一致。
  - `selectedDayInfo`（175-185）对越界日期不判空：`items = dayItems.get(31) ?? []`、`total = day?.total ?? 0`，`label` 直接由 `reviewMonth + selectedDay` 拼出。
  - 模板 `ReviewPanel.vue:262` 是 `v-if="selectedDayInfo"`，而 `selectedDayInfo` 只要 `selectedDay` 非 0 就是真值，因此详情块照常渲染。
- 建议修法：`shiftMonth` 补 `selectedDay.value = null`（与 `jumpToMonth` 对齐）；更稳的写法是在 `selectedDayInfo` 里加一句"日期必须落在当月天数以内"，这样将来任何换月路径都不会再漏。

### [P2] 预算「接近预算」只剩颜色，没有文案；预算弹窗的承诺在 UI 上不存在

- 位置：`src/views/ledger-panels/LedgerHomePanel.vue:116,120,137-153,492-493`；`src/views/ledger-panels/BudgetSettingsModal.vue:9`；`src/composables/ledgerBudget.js:156-166`
- 现象：用掉 80% 预算时，预算卡上的文字（`N% 已用` / `还可用 ¥X`）与"预算内"状态**逐字相同**，唯一差别是进度条从 primary 变成 warning。也就是"你已经接近预算了"这条信息**完全靠颜色传达**（WCAG 1.4.1 用法问题）。而预算弹窗的说明文字明确写着"达到 80% 时提醒「接近预算」，超出后提醒「已超预算」"——后半句有文案（`已超出 ¥X`），前半句没有。
- 证据：
  - `LedgerHomePanel.vue:116`：`:class="budgetAlert ? \`is-${budgetAlert.level}\` : 'is-unset'"`，而 `level` 在**整个文件里只出现这一次**（120 行的百分比文案、137-151 行的 `已超出/还可用` 都不看 level）。级别差异只有 492-493 行的两条颜色规则：
    ```css
    .budget-card.is-near .budget-meter i { background:var(--warning) }
    .budget-card.is-over .budget-meter i { background:var(--danger) }
    ```
  - 讲"接近预算"的文案函数 `budgetAlertText`（`ledgerBudget.js:156-166`，`level === 'near'` 时输出「本月已用 85% 预算：还剩 …」）在 `src/` 下**零调用**：grep `budgetAlertText|budgetPaceText` 只命中 `ledgerBudget.js` 自身与 `tests/ledgerBudget.test.js`、`tests/ledgerBillsAndPacing.test.js`。即文案与 UI 是两份互不相干的实现。
  - `BudgetSettingsModal.vue:9` 的承诺原文：「只做月度总额预算…达到 80% 时提醒「接近预算」，超出后提醒「已超预算」。」`BUDGET_NEAR_RATIO = 0.8` 也在 `ledgerBudget.js:22`。
- 建议修法：`level === 'near'` 时在 `budget-card-foot` 或标题行补一句「已用 N%，接近预算」——最省事的做法是直接渲染 `budgetAlertText(budgetStatus(...))`，让文案与阈值回到同一个出处，别让 `budgetAlertText` 继续做孤儿。

### [P2] 「我承担」是只读输入框，程序化名称却写着「可手改」

- 位置：`src/views/ledger-panels/QuickEntryModal.vue:287-289`（相邻问题：`229-230`、`285`）
- 现象：读屏用户听到的是"我在这一笔里承担的份额（自动计算，**可手改**）"，而该控件带 `readonly`，用键盘/触屏都改不了——程序化名称在教用户做一件做不到的事。同一区块还有一组名称错位：名称输入框的 `aria-label` 是"备注或用途"（229 行），真正的备注输入框才是"备注"（285 行），两个框的 `placeholder` 又完全相同（都是"买了什么？可不填"），视觉与读屏都难以区分。
- 证据：
  - `QuickEntryModal.vue:288`：`<label>我承担<input … aria-label="我在这一笔里承担的份额（自动计算，可手改）" readonly /></label>`
  - 只读是**设计意图**而非疏漏：`src/composables/ledgerView/useQuickEntryForm.js:52-53` 注释写着"界面上它是只读的（用户不能手填），所以正常情况下它**永远**应该等于按分等分算出来的那一份"。所以错的是那句 aria-label。
  - 名称/备注：`229` 行 `aria-label="备注或用途"` + `placeholder="买了什么？可不填"`；`285` 行 `aria-label="备注"` + `placeholder="买了什么？可不填"`。
- 建议修法：aria-label 改为「我承担的份额（自动计算，只读）」；名称框改叫「记录名称」并把 placeholder 区分为"例如：午饭、地铁"之类，备注框沿用现在的"买了什么？可不填"。

### [P2] 固定账单表单的金额前缀硬编码「¥」，与同一表单里的币种选择器自相矛盾

- 位置：`src/views/ledger-panels/BillFormModal.vue:38`（`<b>¥</b>`）与同文件 `100-105`（币种下拉）；列表侧 `src/composables/ledgerView/bills.js:42-44`
- 现象：这个表单允许给账单选 USD / EUR 等币种（模板套用与编辑都会带上 currency），金额框左侧却永远印着一个写死的「¥」。用户把币种设成 USD 后，表单里看到的是「¥ 9.99」，保存后列表里显示的是 `$9.99`——同一笔账单在同一个流程的两端用了两种货币符号。
- 证据：
  - `BillFormModal.vue:38`：`<div class="bill-money-input"><b>¥</b><input … placeholder="0.00" aria-label="固定账单金额" /></div>`——`<b>` 里没有任何条件绑定。
  - `BillFormModal.vue:102-104`：`<select v-model="billForm.currency" aria-label="固定账单使用的币种"><option v-for="code in currencyChoices(fx, [billForm.currency])" …>`；保存时 `currencyField(f.currency)`（298-301）会把非基准币种写进账单。
  - 列表侧按币种渲染：`bills.js:42-44` `moneyWithCurrency(bill?.amount, bill?.currency)`；符号表见 `src/utils/formatters.js:94-111`（USD→`$`、EUR→`€`、未收录币种回退成"代码+空格"）。`moneyRow` 自身是写死 `¥` 的（`formatters.js:76-86`）。
- 建议修法：把前缀改成随 `billForm.currency` 变化的符号（从 `formatters.js` 导出一个 `currencySymbol(code)`，`moneyWithCurrency` 内部复用它），或至少在非基准币种时把前缀清空、只靠 placeholder 提示。

### [P2] 「连续记」静默继承上一条的「参与人数」

- 位置：`src/composables/ledgerView/useQuickEntryForm.js:291-310`（复位清单）、同文件 `67-71`（`resetSplitState`）
- 现象：点「连续记」保存成功后，金额/名称/备注/账户/日期/时间/分类/建议分类/币种都复位了，**唯独参与人数没复位**。若上一条按 4 人记的，下一条只填金额保存，会静默按 4 人写出一条分摊记录：列表金额列显示 1/4（如 ¥25 而不是 ¥100）、副标题多出"已分摊 4 人 · 共 ¥100"——用户会以为金额记错了。
- 证据：
  - 291-310 行的复位清单里没有 `splitCount.value = '1'`，也没有调用 67-71 行那个**就是为这件事写好的**函数：
    ```js
    function resetSplitState() { splitCount.value = '1'; splitMine.value = ''; splitMineIsDerived = true }
    ```
    grep `resetSplitState` 全仓只命中定义与导出（`useQuickEntryForm.js:67/351`），**没有任何调用方**。
  - `syncSplitMine()`（101-106）在金额为空时会把 `splitMine` 置空，但 `splitCount` 保持不动；下一次 `saveExpense` 的 247-251 行会因 `people > 1` 而写出 `split`。
- 建议修法：若"同一群人连续记账"不是产品意图，就在复位清单里调 `resetSplitState()`；若是意图，则应把人数显式保留在弹窗主区域并说明（"沿用上一条的 4 人分摊"），不要让它在折叠的「更多」里悄悄生效。

### [P2] 搜索/筛选无结果时复用「还没有记录」空状态，且空状态里没有清除出口

- 位置：`src/views/ledger-panels/LedgerHomePanel.vue:252-261`；状态来源 `src/composables/ledgerView/feed.js:50-69,150`
- 现象：只要列表项为空就渲染「还没有记录 / 第一笔不用很认真，记下刚刚花的钱就可以。」+「＋ 记一笔」。账本里明明有账、只是当前搜索或筛选没命中时，这句话是错的，且空状态里没有"清除筛选"的按钮——用户唯一的线索是去上面那行找「清除」，而只输入搜索词时连「清除」都不出现（见下一条证据）。
- 证据：
  - `LedgerHomePanel.vue:252`：`<div v-if="feedItems.length === 0" class="feed-empty">` 后面直接跟死文案（253-260），没有区分"库为空"与"筛选为空"。
  - `feed.js:64-66` 的 `filtersActive` 判断里**不含搜索词 `q`**：
    ```js
    fRange.value !== 'all' || fCat.value || fAccount.value || fMin.value !== '' || fMax.value !== ''
      || fKind.value !== 'all' || fDirection.value !== 'all' || fFrom.value || fTo.value
    ```
    而 `LedgerHomePanel.vue:207` 的「清除」按钮是 `v-if="filtersActive"` → 只输入了搜索词时「清除」不渲染；`clearFilters()`（`feed.js:67-69`）也不清 `q`，所以点了「清除」搜索结果仍在。
- 建议修法：用 `filteredExpenses.length === 0 && 账本非空`（或 `q`/`filtersActive`）分流成「没有符合条件的记录」+ 一个「清除搜索与筛选」按钮（同时清 `q`），把原来的文案留给真正空库的场景。

### [P3] 首页筛选面板：5 列栅格装 6 个控件，末行孤一个

- 位置：`src/views/ledger-panels/LedgerHomePanel.vue:220-241`（6 个控件）与 `646-649`（`grid-template-columns:repeat(5,1fr)`）
- 现象：分类下拉、账户下拉、金额≥、金额≤、来源下拉刚好占满第一行，「收支类型」被挤到第二行且只占 1/5 宽。>760px 的桌面端能看到这块留白；`max-width:760px` 是 2 列、`520px` 是 1 列，都是整行，所以只有桌面档不整齐。
- 证据：`.filter-line` 下有 6 个子元素（221、225、229、230、231、236 行），栅格列数是 5（647 行）；`LedgerHomePanel.vue:789-790` 的响应式规则只改列数（2 列、1 列），没有补一句针对 6 个控件的规则。
- 建议修法：桌面档改 `repeat(3,1fr)`（两行各 3 个）或 `repeat(6,1fr)`（控件再窄一点），保持每行填满。

### [P3] 金额区间筛选用「记录总额」，列表却显示「我承担的份额」

- 位置：`src/composables/ledger.js:165-166,181-182`；显示侧 `src/composables/ledgerView/feed.js:146-149`
- 现象：一条 200 元 5 人分摊的记录，列表里显示 `-¥40.00`（`personalAmount`），但用「金额≤50」筛选时它**不会出现**（按 200 比较）。同屏的日期头（`feed.js:71-88`）又按份额汇总，于是"筛选口径 / 行内金额 / 日期头"三处不齐。
- 证据：`filterLedgerTransactions` 的 min/max 走 `amountToCents(min)` 与 `ledgerAmountCents(item, …)`，而 `feed.js:51-61` 调用时**没有传 `amountOf`**（该参数在 `ledger.js:162` 已经存在，`ledger.js:169` 会用它替换金额来源）；显示侧 `feed.js:146-149` 的 `feedAmount` 用的是 `personalAmount`。
- 建议修法：`feed.js` 里给 `filterLedgerTransactions` 传 `amountOf: mySpendCents`，或在筛选控件上标明"按记录总额筛选"。若刻意按总额筛（例如"找回那笔 200 的"），就把这条口径写进筛选面板的说明文字。

### [P3] 两处图标关闭按钮没接 `tap-target`，粗指针下仍是 26×26（实测）

- 位置：`src/views/ledger-panels/LedgerHomePanel.vue:180`（待处理账单的「✕ 暂时隐藏这条账单提醒」）、`src/views/ledger-panels/BillFormModal.vue:17`（删除账单模板的 ✕）
- 现象：这两个 ✕ 在手机上只有 26×26 命中区，而同类的图标关闭按钮都拿到了 44px 兜底：弹窗关闭（`src/components/Modal.vue:368` 的 `.close.tap-target`）、回顾页翻月（`ReviewPanel.vue:108,110` 的 `.mn-btn.tap-target`，第四十三轮专门为此加过）、Toast 关闭（`Toast.vue` 的 `.toast-close.tap-target`）。同类控件两套标准。
- 证据（真机实测）：`ui-audit/all-report.json` 的 `/bills` 四档指标里，`small` 列表包含 `button.p-close 26x26 "✕"`（desktop/wide/tablet/phone 四档都在）；判定规则见 `ui-audit/audit-ui.mjs` 的 PROBE 第 4 项（高 < 阈值即登记）。CSS 侧的兜底规则是 `src/style.css:390-401`：只给 `.btn:not(.chip):not(.link-btn)` / `button.tap-target` / `[role='button'].tap-target` / `.setting-del` 设 `min-height: var(--tap-min)`，`.p-close` 不在其中。
- 备注（避免误报）：`26×26` **仍高于 WCAG 2.5.8 AA 的 24×24 下限**，所以这不是无障碍违规，而是"与仓库自己 44px 惯例不一致"；`.segmented`（账本三个分区 tab，实测 51×28 / 76×28 / 51×28）与 `.link-btn`（汇率设置 / 设置预算 / 清除，实测 66×26 / 66×26 / 42×26）都被 `style.css:392` 的注释**明确排除**，属于已决策项，本报告不作建议。
- 建议修法：给这两处 `.p-close` 加上 `tap-target` 类（与 `Modal.vue:368` 同一写法），或把它们并入 `style.css:395-398` 的列表。

### [P3] 死类 `has-fab`：没有任何样式或脚本消费者

- 位置：`src/views/LedgerView.vue:752`：`<div class="page" :class="{ 'has-fab': tab === 'ledger' }" @click.capture="closeSwipe">`
- 证据：全仓 grep `has-fab` **只命中这一处**；`src/style.css` 与 `src/App.vue` 里没有对应规则。底部留白实际由外壳负责：`App.vue:833-840` 的 `.content { padding-bottom: calc(86px + env(safe-area-inset-bottom)) }`（配合 `floatingStack` 的 `--stack-offset`），所以目前**没有可见后果**，纯属死绑定。
- 建议修法：删掉该绑定；若它原本想为悬浮「＋ 记一笔」在账本分区额外留位，就补上真正的规则并在真机上核对末行是否被浮动按钮压住。

### [P3] 记一笔的分摊预览有两份实现，传进去的那份根本没被使用

- 位置：`src/views/ledger-panels/QuickEntryModal.vue:101-116`（本地实现）与 `12-41`（没有 `splitPreview` prop）；`src/views/LedgerView.vue:925`；`src/composables/ledgerView/useQuickEntryForm.js:87-99`
- 现象：`LedgerView.vue:925` 把 `:split-preview="splitPreview"` 传给弹窗，但该组件**既没有声明这个 prop，也没有像 `$attrs.showQuickRecord`（305 行）那样去读它**；模板 290 行渲染的是本地 `localSplitPreview`。结果是 composable 里那份每次渲染都算一遍再丢掉，而且两份文案已经不一致：单人时 composable 输出「单人记录，无需分摊」（`useQuickEntryForm.js:96-98`），弹窗输出「单人承担 ¥X」（`QuickEntryModal.vue:113-115`）。
- 证据：`QuickEntryModal.vue:12-41` 的 props 列表里没有 `splitPreview`；`useQuickEntryForm.js:87-99` 的 computed 有很长的注释解释"为什么不能在这里写状态"，说明它曾经是唯一出处。
- 建议修法：二选一——把 `splitPreview` 声明成 prop 并用它渲染（同时删掉本地的 `localSplitPreview` 与镜像 ref），或删掉 composable 里的 `splitPreview` 与对应 `:split-preview` 绑定，只留一份文案。

## 待确认（未能证实）

1. **390px 宽下「多月收支走势」的 12 个月份标签是否被裁切。** `ReviewPanel.vue:600` 给月份标签设了 `overflow:hidden; white-space:nowrap`（无省略号），`621` 行在 ≤760px 又把它压到 `font-size:8px`。按 390px 视口反推：`.content` 左右各 14px、卡片 padding 16px → 约 21px/列，而「10月」在 8px 下约 17px，**理论上放得下**，但卡片在窄屏下是否还有别的内边距、以及中文字形实际宽度我无法从源码断言。需要的证据：一张 390px 下「回顾」分区的真机截图，或对该元素实测 `scrollWidth > clientWidth`（`ui-audit` 脚本目前只截 `/bills` 的账本首页，不含回顾分区）。
2. **底部安全区是否被重复计入。** `Modal.vue:531` 在 ≤520px 给 `.modal-body` 设了 `padding-bottom: calc(18px + env(safe-area-inset-bottom))`，而表单的粘性操作条又自带 `padding:12px 16px calc(12px + env(safe-area-inset-bottom))`（`BillFormModal.vue:454`、`FxSettingsModal.vue:155`、`BudgetSettingsModal.vue:122`）。粘性定位下容器 padding 与自身 padding 的叠加关系需要真机（带 Home 指示条的机型）确认是否会多出一段空白；需要安全区模拟截图。
3. **重复记账提示里的「取消」会清空名称框。** `QuickEntryModal.vue:245`：`@click="$emit('update:dupWarn', false); $emit('update:nameInput', '')"` —— 名称被清空、金额保留。这可能是"打断重复"的有意设计（仓库里 `grep dupWarn|forceDup` 在 `tests/` 下零命中，源码也没有注释说明），需要产品口径确认；若是有意为之，建议补一句注释并同时清金额或提示用户。
4. **`:split-preview` 这个未声明的 prop 是否会在 dev 控制台产生 Vue 警告。** 按 Vue 的 attrs 继承规则，QuickEntryModal 的根是 `Modal` 组件（attrs 会继续下传），而 Modal 的根是 `Teleport`（不继承非 prop 属性，dev 下会告警 "Extraneous non-props attributes"）。全仓 13 处 DOM 用例都在 `beforeEach` 里直接 `vi.spyOn(console, 'warn').mockImplementation(() => {})` 把警告吃掉了（`ledgerFeaturesDom.test.js:40`、`ledgerSplitDisplay.test.js:69`、`quickEntryModalClose.test.js:29`…），只有 `searchEnhancements.test.js:189/387` 收集并断言 `warnings === []`，而它不覆盖账本页——所以**没有任何守卫会暴露这条警告**。需要跑一次 dev 控制台或临时捕获 `console.warn` 才能证实（本轮不允许改测试，故未验证）。
5. **窄屏（≤520px）下的弹窗、筛选面板与回顾分区仍无真机截图。** `phone-bills.png` 已生成并核对（见「已核查」），但 `ui-audit.mjs` 只截 `/bills` 的**账本首页**、不展开筛选面板也不切到回顾分区，所以"记一笔 / 记录详情 / 汇率 / 预算弹窗在 390px 下是否溢出、底部安全区是否被底栏遮挡、回顾走势图是否被裁切"这几条仍然只有 CSS 源码依据。需要的证据：一组 390px 下打开这些弹窗与回顾分区的截图（或 DOM 实测 `scrollWidth/clientWidth`）。
6. **`has-fab` 若补上样式会不会与全局 `--stack-offset` 打架。** 需要先确认它原本的意图（git 历史/设计稿），否则不宜直接删除或补规则。
7. **截图与真机指标里都出现了一个"按源码不应渲染"的「清除」按钮（证据冲突，尚未解释）。** `shots/{desktop,wide,tablet,phone}-bills.png` 里搜索行右侧都同时有**浅蓝底（ghost）的「筛选」**和蓝字「清除」；`all-report.json` 的四档 `/bills` 指标里也都实测到 `button.link-btn 42x26 "清除"`（desktop/wide/tablet/phone 全中）。这**不是**偶发点击：每个视口都是全新文档（`audit-ui.mjs:138-143` 是整页 `Page.navigate`），播种脚本只写 localStorage（`audit-ui.mjs:261-310`），PROBE 全程只读（`audit-ui.mjs:164-253`，无任何 click/evaluate 副作用）。而按当前 `dist`（13:32 构建，晚于所有相关源码改动；`assets/` 下同名 chunk 只有一份）：
   - `LedgerView-DVGo-Cy9.js` 的编译产物是 `t.filtersActive ? <button class="link-btn">清除</button> : 空`，即「清除」只在 `filtersActive` 为真时渲染；同文件里唯一的 2 字「清除」按钮全仓只有 `LedgerHomePanel.vue:207` 一处（`grep '>\s*清除\s*<'` 只命中它）；
   - `filtersActive` 的编译产物与 `feed.js:64-66` 逐字一致：`fRange!=='all' || fCat || fAccount || fMin!=='' || fMax!=='' || fKind!=='all' || fDirection!=='all' || fFrom || fTo`，九个 ref 全部初始化为 `''`/`'all'`（`feed.js:36-44`）；
   - 这九个 ref 在编译产物里**只被 `onUpdateF*`（子组件事件）赋值**（逐个 grep `Oe.value=`/`X.value=`/`Pe.value=`… 各只有 1 处，且都在 `onUpdateF*` 回调里），没有任何初始化、URL 或存储读取路径；账本也没有任何筛选持久化键（dist 里 `sl_*` 键清单里没有 filters 相关项），`q` 也不参与 `filtersActive`；
   - 同一份报告里 `can-expand-feed` 为假（页面上确实没有「查看全部」链接），说明父组件传下去的布尔 prop 并没有被字符串化。
   → 源码侧推不出"它会渲染"，真机侧四次都测到它在。需要的最小复现证据：在 390px 下加载 `/#/bills` 后在页面内 dump 这九个 ref 与 `filtersActive` 的实际值（`document.querySelector('.link-btn')` 是否命中「清除」也一样有效）。若最终证实在**全新加载**下确实会出现，它本身就是一条 P2：`筛选`永久呈激活态、`清除`点了没有东西可清。

## 已核查确认无问题

以下均为实际读过的文件与界面，逐项给出口径或证据；**结论是"查完确认没问题"，不建议改动**。

- **固定账单表单的校验接线**（`BillFormModal.vue:31-33,46-48,71-81,120`）：`aria-invalid` / `aria-describedby="bill-form-error"` / `role="alert"` / 出错字段自动聚焦四件套齐全，金额错误文案「金额需大于 0，且最多保留两位小数」与 `normalizeAmount`（`ledger.js:51-77`）判据一致；`tests/formValidationA11y.test.js:110-140` 已按真实点击钉住"只有出错字段被标红"。
- **汇率 / 预算弹窗的输入校验与错误呈现**：`FxSettingsModal.vue:73-95`（币种必须三位字母、不能是基准币种、不能重复、汇率必须 > 0，逐项中文报错，错误行 `.bill-error` 带 `role="alert"`）；`BudgetSettingsModal.vue:51-65`（`saveBudget` 抛错被捕获为内联错误，不再冒泡），输入支持千分位与「¥」前缀（`ledgerBudget.js:25-34`）。
- **弹窗基础能力**：`Modal.vue:268-276`（Escape 只在最上层生效并 `preventDefault`）、`336`（`@click.self` 点遮罩关闭）、`275`+`overlayStack.trapTabKey`（Tab 焦点陷阱）、`292-315`（关闭后把焦点还给打开它的元素，且多层时回到下一层）、`383-395`（层叠按打开顺序递增）。
- **弹窗开着时的校验提示可见性**：`Toast.vue` 是 `position:fixed; z-index:200`，`.overlay` 是 `100 + min(深度,9)`（`Modal.vue:390-395`）→ 退款失败、同名批量分类失败等走 `notify()` 的错误**不会被弹窗遮住**，这是本轮特意核实的一条（因为账本有大量错误只走 toast）。
- **「保存中关闭保护」**：账本侧所有保存路径（`saveExpense` / `saveDetailEdit` / `confirmRefund` / `saveBill` / `saveFx` / `commitBudget`）都是**同步完成**的（`saveExpense` 虽标了 `async`，但内部没有 `await` 间隙），`savingExpense` 只用于禁用按钮，不存在"提交到一半被 Esc 关掉"的窗口；快照式导出（`export.js:243-256`）反而是全仓唯一有真实 await 的地方，它已经用同一份 items 快照规避了不一致。
- **列表与长列表**：`VirtualList` 固定行高 + `feedItemHeight` 用**绝对 index** 判断首行（`LedgerHomePanel.vue:263-275`、`feed.js:97-102`），与 `tests/ledgerScrollPerformance.test.js` 的 key 顺序断言同源；`SwipeActionItem` 的 `translate3d(-140px,0,0)` 与文案是**测试硬断言**，本轮未改动也不建议改。
- **滑动操作的可发现性与替代路径**：列表行本身是"打开详情的唯一入口"，已补 `role="button"` + `tabindex` + Enter/Space 与 `tap-target`（`LedgerHomePanel.vue:305-315`），行内注释说明了为什么可以安全加 `role`（动作按钮是兄弟节点）；滑动手势之外，详情面板里的编辑 / 完整编辑 / 再记一次 / 退款 / 删除都是真按钮，键盘全程可达；删除即时生效但带「撤销」toast（`useTransactionDetail.js:190-206`），与滑动删除同一口径。
- **固定账单面板**：编辑入口是**真按钮**、动作按钮在其外（`BillsPanel.vue:53-77`，注释解释了 `role="button"` 会抹掉内层按钮语义）；空态、待支付/之后/已暂停三组、暂停态、`跳过本次`/`已支付` 文案齐全；`billStatus` 的逾期/今天/明天/还有 N 天文案与 `.today` 强调样式对应（`bills.js:27-36`、`BillsPanel.vue:221-223`）。
- **回顾分区**：分类第 6 名以后有「展开其余 N 个分类」（`ReviewPanel.vue:240-241`）、展开中的分类即使排在 5 名外也不会被截掉（`review.js:96-104`）；占比分母用"分类合计"避免 >100%（`review.js:88-93`）；退款与毛/净额差异、多币种不折算都写在下钻说明里（`ReviewPanel.vue:154,191-193,200`）；月历格子有 `aria-label`（几月几日 / N 笔账目 / 无账目）与 `aria-pressed`（`ReviewPanel.vue:93-97,251-258`）。
- **图表（`reviewCharts.js` + `ReviewPanel.vue`）**：全 0 时 `trendMax === 0` → 所有柱高 `0%`（`ReviewPanel.vue:45,58-62`），不会出现 NaN/Infinity 或撑破容器；支出净额为负用 `trend-expense-negative`（danger 色）**并有图例与逐月 `aria-label`/`title`**（129、137 行），不是"仅靠颜色"；`monthly-trend-bars` 用 `grid-template-columns` 显式绑定列数（128 行），不会因 6/12 档切换溢出；趋势数据由 `summarizeLedgerMonthsInBase` **一次扫描**产出（`review.js:136-158`），不会逐月重扫。
  - 说明：`reviewCharts.js` 本身服务的是**周回顾页**（热力图/完成率折线/心情×专注/专注时段），不属于账本回顾；通读后未发现账本 UI 相关缺陷，其四条硬边界（心情三键、复用 `selectWeeklyTaskSummary`、`taskRatePercent` 单一出处、时区走 `policyDateKey`）都有注释与测试守卫。
- **多币种 / 缺汇率口径**：缺汇率的记录被**排除出合计**并在文案里如实报出币种与笔数（`ledgerFx.js:203-221,320-327`；`ReviewPanel.vue:49-56` 的 `trendCurrencyNote`）；基准币种记录不产生折算行（`fxRateNote` 首行判 `hasForeign`）；汇率日期缺失时写"未记录日期"；汇率上下界 `1e-6 ~ 1e8` 有注释解释（防静默归零 / 防 Infinity）。
- **预算口径**：超支与未设预算是两套文案（`已超出 ¥X` vs `尚未设置`）；`role="meter"` 带 `aria-valuemin/max/now/valuetext`（`LedgerHomePanel.vue:125-136`）；日均额度按当月真实天数摊（`ledgerBudget.js:113-137`），剩余为负时首页显示 ¥0.00 而不是负数（`LedgerHomePanel.vue:147-150`，超支金额由上一行"已超出 ¥X"承担，不会自相矛盾）。
- **分摊**：`splitCentsEvenly` 保证 Σ份额**精确**等于总额（`ledgerSplit.js:18-30`）；人数为 1 时不写 `split` 字段（`useQuickEntryForm.js:243-257`，注释解释了为什么）；退款上限按"我承担"算（`useTransactionDetail.js:208-216`）；列表副标题交代总额与人数、详情顶部交代"上方是总额"（`feed.js:110-126`），两个口径同屏不打架。
- **账单模板**：白名单不含 `nextDate`（`ledgerTemplates.js:33-49`），套用后 `billTemplateId` 立即复位以便重复套用（`BillFormModal.vue:229-233`），同名模板按 id 覆盖而不是堆叠（`ledgerTemplates.js:77-93`），删除模板只影响模板库。
- **分类管理弹窗**：空名/超长（32）/同名校验、隐藏时至少保留一个可用分类、有历史交易不可删且给出笔数、关联规则随删除清理（`LedgerView.vue:614-743`）；图标选择器的 `aria-expanded`/`aria-controls`/`aria-pressed` 与 `role="group"` 齐全（1056-1111）；反馈行 `role="status" aria-live="polite"`（1125）；分类改名走 `PromptDialog` 而非 `window.prompt`（1133-1144，注释解释了浮层顺序的原因）。
- **导出**：CSV 做了公式前缀中和（`export.js:224-228`，注释解释了为什么加引号不够）、空数据有提示（231、245）、xlsx 有列宽/数字格式/`!autofilter`（257-271）、汇总按币种分列不做跨币种相加（`export.js:80-120`）、导出的明细与汇总用同一份快照（251-256）。
- **空状态**：首页 feed 空态（`LedgerHomePanel.vue:252-261`）、固定账单空态（`BillsPanel.vue:30-38`）、回顾空态（`ReviewPanel.vue:140-146`）、汇率列表空提示（`FxSettingsModal.vue:16`）、分类管理空提示（`LedgerView.vue:1053`）都存在；预算未设置时不渲染 meter，只留一句设置引导（`LedgerHomePanel.vue:116,125-136,153`）。
- **标题层级**：`LedgerView.vue:755` 是页内唯一 `h1`（"账本"），各面板的分区标题是 `h2`（`LedgerHomePanel.vue:163,189,248,330`、`BillsPanel.vue:42,82,113`、`ReviewPanel.vue:122,198,245`），`Modal.vue:357-359` 的弹窗标题默认渲染成 `h3`——没有父子倒置。`tests/renderedHeadingOrder.test.js:43,86-106` 用真实路由表逐页断言"h1 在 main 内、无跳级"，账本页在这条守卫之内。
- **底部留白 / 安全区**：外壳 `.content` 在 ≤760px 给 `padding-bottom: calc(86px + env(safe-area-inset-bottom))`（`App.vue:833-840`），足以避开底栏与悬浮按钮；`Modal` 的头部/底部也已处理 `env(safe-area-inset-*)`（`Modal.vue:445,449,525,531`）。
- **真机指标（`ui-audit/all-report.json`，四档 `/bills`）**：`overflowX=0`、`wide=0`（无越界元素）、`clipped=0`（无文本截断）、`dupIds=0`、`nameless=0`、`unlabeled=0`——账本首页在 390 / 1024 / 1440 / 1920 四档全部通过这六项机械检查；`modalCount=0`（无残留浮层）。唯一登记在 `small` 列表里的账本元素是分区 tab（`.segmented`，28px）、`.link-btn`（26px）与 `.p-close`（26×26）——前两类是 `style.css:390-401` 注释里**明确排除**的已决策项，`.p-close` 已单列为上文的 P3。
  - 需要注意：同一次报告里 `/bills` 四档都带着一条 **ExamsView** 的渲染错误（`TypeError: t.reviewSummary is not a function`，`/exams` 同样四档命中），它不属于账本代码；账本页本身没有被这条错误打断（截图正常、无错误浮层），该问题由 `ui-audit/probe-core.mjs` 单独跟踪。
- **真机截图核对**：本轮实际看过 `shots/desktop-bills.png`、`wide-bills.png`、`tablet-bills.png`（第一次抓取，被首启「已更新」发布说明弹窗覆盖大半）与 `phone-bills.png`（390×844）。四张里账本首页的顶部标题行、分区 tab、花费概览（今天/本周/本月三块并排，`moneyHero` 未溢出）、本月预算卡（"尚未设置 / 设置预算"）、快速记账行（"刚刚发生了什么？"，窄屏下按钮独占一行）、搜索行、「最近记录」空态（"还没有记录 / 第一笔不用很认真，记下刚刚花的钱就可以。"）**布局正常：无横向溢出、无裁切；手机截图里底部 tab 栏（首页/课程/记录/账本/更多）固定在底部，没有压住"还没有记录"空态卡片**（与 `App.vue:833-840` 的 `.content` 底部 86px 内边距一致）。
  - 需要说明的两点：① 截图里的账本是**空账本**——`audit-ui.mjs:296-300` 播种的是旧键 `sl_ledger`（`{type:'expense'}` 形状），而账本页读的是 `sl_expenses`（`direction` 形状），两者不是同一个键，所以这部分播种数据不会被渲染，"¥0.00 / 还没有记录"是真实结果而非缺陷；② 四张图的搜索行右侧都出现了 ghost 态「筛选」+ 蓝字「清除」，按源码这需要 `filtersActive` 为真——已单列到「待确认」第 7 条，**不作为缺陷上报**。
  - 因此，筛选面板展开态、三个分区中的「固定账单」「回顾」、以及各弹窗内部布局这四处**没有可用的真机截图**，相关结论一律以源码为依据。