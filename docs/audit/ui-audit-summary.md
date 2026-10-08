# 全量 UI 界面检查报告（2026-10-07）

> 范围：整个应用（11 条路由 + 外壳 + 全部弹窗/面板），用户点名**重点检查登录/账号、更新、设置**三块。
> 版本：`2026年10月07日-版本8`，源码签名 `cfcb3076f2`。
> 门禁：`npm run check` → **exit 0**，**208 个测试文件 / 2223 条用例**，build ~960ms。
> 分域明细（5 份只读审计）：`ui-audit-shell.md`、`ui-audit-core-pages.md`、`ui-audit-schedule.md`、
> `ui-audit-ledger.md`、`ui-audit-data-sync.md`、`ui-audit-settings.md`；
> 独立对抗性复核：`ui-audit-verification.md`。

---

## 0. 这次是怎么查的（方法与证据标准）

三条互相独立的证据线，缺一条就会漏掉一类问题：

1. **真机渲染**：本机 Edge headless + 原生 CDP（Node 22 内置 WebSocket/fetch，**零新增依赖**）。
   脚本在仓库外 `D:\study-life\ui-audit\audit-ui.mjs`（静态服务器 + 设备模拟 + 触摸模拟）。
   采集量：
   - **4 档宽度 × 11 条路由 = 44 张路由截图**（1920×1080 / 1440×900 / 1024×768 / 390×844）；
   - **12 张重点弹窗截图**（登录 / 版本与更新 / 个性化 / 数据管理 / 快速记录设置 / 专注设置 / 搜索 / 更新说明）；
   - **26 张"逐页点开弹窗"截图** —— 这条是后补的，补的是一个真实的口子：
     路由截图只覆盖"页面渲染"，而**弹窗要真的点开才谈得上检查**。覆盖今日回放、添加待办、粘贴通知、
     添加重要日期（桌面/手机）、新建日程、新建清单、详细添加、分类管理、记一笔（桌面/手机）、添加课程、
     批量管理、导入课程表、作息设置、学期设置、快速记录（桌面/手机）、搜索、氛围与纪念日（桌面/手机）等。
     **这 26 个弹窗 0 个控制台错误、0 个 `[GlobalError:`**；
   - **2 张外壳告警截图**（桌面/手机）—— 见 §2 与 §5 的边界说明。
   每张同时抓横向溢出、越界元素、文本截断、重复 id、触控目标尺寸、无名称控件、无标签控件、控制台错误。
   - 关键坑 1（第一版就踩了）：`study_life_seen_release` 必须在**文档创建前**注入，
     否则首帧弹出的「✨ 已更新」浮层会把后面几十张截图全盖住，而"看起来有内容"依旧成立。
   - 关键坑 2（第二版踩的）：手机档必须开 `Emulation.setTouchEmulationEnabled`，
     否则 `@media (pointer: coarse)` 不成立，`style.css:394` 那条 44px 触控兜底不生效，
     量出来的"触控过小"**全是假阳性**。
2. **源码审查**：5 个并行只读审计（外壳 / 核心页面 / 课表 / 账本 / 数据同步 / 设置）。
   每条必须给 `文件:行号` + 证据，并显式写出「已核查确认无问题」与「待确认」——
   后两类是为了防止后来人重复看、以及把推断当结论。
3. **既有守卫**：改任何东西之前先看 `tests/` 里有没有守卫在守它。本仓库守卫密度极高，
   绕过守卫改行为是本项目最容易犯的错。
4. **独立对抗性复核**（后加）：验收自己修的东西。**它抓出了我自己 3 处没落实/落实错的地方**，
   见 §2 末尾「复核改写了什么」——这是本轮最值的一步。

**只报能证实的问题**：把"看起来奇怪"当结论之前先读附近注释——这个仓库里大量非常规写法是
**有意为之并写明了原因**（层叠阶梯数值、`.skin-notebook` 的写死色、`mood.js` 的静默降级、
`SwipeActionItem` 的 Tab 序、触控尺寸的刻意例外…）。5 份分域报告各自都排除了若干假阳性。

---

## 1. 用户点名的三块（重点）

### 1.1 登录 / 账号界面

界面本体（`components/AccountPanel.vue` + `components/data/AccountSyncPanel.vue`）质量很高：
注册/登录双模式、行内错误 + 顶部横幅、密码可见性开关、重发验证邮件的 60 秒冷却放在
`sessionStorage`（不随面板销毁归零）、提交中与网络忙碌分离、成功/失败后把焦点交给新标题、
服务端错误码到中文文案的映射表（含 `over_email_send_rate_limit` 这种冷门码）、
`account_unavailable` 时说清"这个版本没有账号服务"而不是"稍后再试"（避免假承诺）、
iOS 密码框关掉自动大写与拼写纠错、登录态用 `autocomplete="username"` 让密码管理器能绑定。
真机截图 `modal-account.png` / `modal-account-phone.png`：桌面是居中弹窗、手机是底部抽屉，
两档都无横向溢出、无文本截断、控件名称与层级正常。

**唯一可疑项最终判为"不改"**：邮箱输入框的 `aria-describedby` 在 `formError` 为空时仍引用
`#account-form-error`，而那个节点是 `v-if="formError"` 的——即存在**悬空引用**。
我先按"只引用当下真实存在的节点"改了一版，结果：
- `tests/accountPanel.test.js:85-94` 红：它**明确断言**这个字符串就是
  `'account-email-error account-form-error'`，注释写着"#account-form-error 之前在模板里存在却
  没有任何元素引用它"——这是**已登记的既定选择**，不是漏改；
- 顺带把 `ratchetHardcoding` 的 script 区颜色计数顶到 149：`#account-form-error` 里的 `#acc`
  被颜色正则 `#[0-9a-fA-F]{3,8}` 当成了颜色 —— 说明这个仓里连**写注释**都要看棘轮。

结论：悬空 `aria-describedby` 被浏览器与读屏**直接忽略**，无用户可见影响；收益为零而代价是
推翻一条有注释的既定决定 + 触碰颜色棘轮，故**如实保留原样**。`AccountPanel.vue` 最终**零改动**。

### 1.2 更新界面

`components/data/AppUpdateSection.vue` + `components/VersionUpdateModal.vue` +
`components/ReleaseNotesBrowser.vue` + `components/UpdateNotes.vue` + `composables/appUpdate.js`。

它是一整套显式状态机，代码里逐条写清了为什么：
- 语气（`updateTone`）与"是否需要手动重载"（`needsManualReload`）都是**状态**，不再从中文字符串正则反推
  ——原来的写法是"改一句提示就会改配色，还会删掉唯一的手动重载出口"；
- `waiting` 态显式发 `SKIP_WAITING`（否则 30 秒超时什么都不发生、也没有出口）；
- 超时/失败都收成**终态**（`finish`/`fail`），不留"进度卡一直转但没有按钮"；
- 注销 Worker 会触发 `controllerchange` 但 `controller` 为 null，已被显式排除（否则会在恢复流程上再叠一次刷新）；
- 强制恢复**保留** `study-life-ocr` 缓存（3.8MB 语言模型与"入口过期"无关）；
- 每次新检查清掉上一轮的 `manual-reload`/`error` 出口。

真机：`modal-update.png` / `modal-update-phone.png` 排版正常，≤520px 走底部抽屉两档（0.3/0.75），
四个按钮在窄屏改为各占一行（否则触控目标会被压到 `tap-min` 以下）；
`modal-release-notes-live.png` 里「✨ 已更新」的 10 条说明与「之前的更新」分组都正确，
版本徽标已是新值 `2026年10月07日-版本8`。

**遗留（P2，未改）**：手机端抽屉的**窥探档装不下它的主操作**。
`:sheet-detents="[0.3, 0.75]"`、390×844 下窥探档约 253px，而内容依次是标题行、两行说明、
版本徽标、两行解释、四个按钮 —— 截图里折线只到"当前应用版本…"那一段，**「检查更新」等按钮全在折线以下**。
用户为了一次"检查更新"必须先点「展开」或上拖一次。改 detents 会动到 `tests/modalSheet.test.js`
对 `.modal.style.height` 的精确断言，属"要带完整回归面"的那一类，故只记录。

**遗留（P3，未改）**：`appUpdate.js:303-332` 的强制恢复有"1 小时最多 2 次"的频率保护；
第 3 次点击时 `canForceRecover()` 为假，直接提示「**检测到新版本**，请关闭应用后重新打开」——
这条路径上**并没有做过任何版本比对**，是在断言一个没验证过的状态。

### 1.3 设置界面

问题最集中，也是唯一一个 P0；三块问题**本轮全部修完**：

- **[P0 → 已修] 节日与纪念日设置整块不可达。** `components/FestiveSettings.vue` 从加进仓库起，
  全 `src/` **只有测试**直接 import 它，Sidebar 从未挂载，手机「更多」里也没有这一格：
  「开关节日氛围 / 生日 / 开始使用日期 / 纪念日与农历纪念日」用户**在任何界面都点不到**。
  而 2183 条用例里有一条**正面**渲染它的测试（`festiveLunarAnniversaryUi.test.js` 直接 `createApp` 挂载）
  ——所以「这个面板工作正常」一直是绿的：**绿的是面板，坏的是入口**。
  → 按既有工具面板的同一套接线补上入口（懒加载 + 预热 + 桌面按钮 + 手机「更多」格 + 挂载点），
  新增守卫 `tests/shellToolEntries.test.js`（变异验证见 §3）。
  **补完后真机复核**：`dialog-festive-settings.png` 与 `dialog-festive-settings-phone.png` 都真的打开了
  （`modal=2`、控制台 0 错误）。手机档上内置节日对照表比视口宽 24px，但它在
  `.lunar-table-wrap { overflow-x: auto }` 里，**是容器内可横向滚动的宽表**（文档级 `overflowX=0`）——已核查，不是缺陷。
- **[P1 → 已修] 作息「恢复默认」没有二次确认，且屏幕上什么都不会发生。**
  原来直调 `resetTimesToDefault()`（重建**所有**季×校区的作息），而编辑器读的是 `draft`，
  同时违背 `:121` 自己写的"修改需点击保存才会生效"。
  → 改为挂起 `resetTimesTarget` + `ConfirmDialog`（文案写明"所有校区、所有作息季"、
  "与当前草稿是两件事、未保存修改会丢、无法撤销"），确认后重读草稿并给出 `role="status"` 提示。
- **[P1 → 已修] 作息导入失败零反馈。** 原来失败即把 `importRunning` 置回 false →
  计划弹窗立刻切回列表，而失败文案唯一的渲染点在**下层**弹窗（被盖住）。
  → 新增 `importFailed` 状态 + 计划弹窗内的失败态（`role="alert"` 原因 + 已回滚说明 + 「重试导入」/「返回计划列表」），
  并抑制下层同一句的重复播报。
- 另有 9 条 P2（恢复初始外观的确认框漏说主题色、清空名称后输入框空而数据未变、
  选中态只存在于 class 无 `aria-pressed`、专注通知权限失败会丢掉同一次保存里的其余修改、
  专注校验错误没接到字段、快速记录设置既无保存按钮也无"已自动保存"提示、励志语草稿无守卫、
  壁纸存储失败静默…），逐条见 `ui-audit-settings.md`，**本轮未改**（它们要么需要先定语义，
  要么属于"补交互"而不是"修缺陷"）。

---

## 2. 本轮修掉的问题（17 处 `src/` 改动）

### A. Lead 直接修（12 处）

| # | 位置 | 问题（真机/源码证据） | 修法 |
|---|---|---|---|
| 1 | `views/ExamsView.vue:503` | 模板调用**不存在**的 `reviewSummary(item)`（真函数是 `:180` 的 `reviewSummaryOf`，结果早已预计算在 `item.review`）。只要存在一门「学习」类未结束记录，渲染即抛 `TypeError`，列表整块不再渲染 → 真机「重要日期」页**只剩页头**；`[GlobalError:render]` 还会随 KeepAlive 在别的路由重复出现 | 改用 `item.review` |
| 2 | `components/schedule/ImportConflictModal.vue` | 冲突卡片把节次**内部 id** 直接印给用户（「新课程：高数 · 周一 · **p0至p1** · 1-8周」），同卡「实际冲突」行却用标签 | 新增 `periodTextById`（查 `periods` 标签）+ `courseSummary` 过滤空段，查不到**不回退显示 id** |
| 3 | `views/ledger-panels/QuickEntryModal.vue` + `views/LedgerView.vue` | 两层缺陷互相掩盖：① 面板**从来打不开**——模板读 `$attrs.showQuickRecord`，而父级传的是短横线 `:show-quick-record`；Vue 只对**已声明的 prop** 做 camelize 匹配，非 prop 属性进 `$attrs` 时**保留原键名**，于是那个表达式恒为 `undefined`；② 就算开了也**关不掉**——关闭走 `update:showQuickRecord`，父级没有监听 | ① 把 `showQuickRecord` 声明成 prop 并改读 prop；② 登记事件 + 页面监听 |
| 4 | `composables/ledgerView/useQuickEntryForm.js:240` | 金额非法时只 `amountEl.value?.focus()`，而这个 ref 在本页**从未绑定到任何元素**（LedgerView 没有解构它；弹窗里那个是同名的另一个局部 ref）→ 焦点回跳是空操作、也没有任何提示，点「记下」毫无反应 | 补 `notify('请先填写有效金额，例如 12.50')` |
| 5 | `components/Sidebar.vue` | 见 §1.3 的 P0 | 补入口 + 预热 + 挂载 |
| 6 | `composables/scheduleImportReview.js` | 「撤销本次导入」30 秒窗口只**在点击时**判断过期，状态从不清空 → 按钮一直挂着，点下去什么都不发生、也没有提示 | 加到期定时器清空状态 + 点击时兜底清理 + `onBeforeUnmount` 收尾 |
| 7 | `composables/cloudSyncTransfer.js:404` | 推送路径**先** `await res.json()` **再**判 `res.ok`。云端/网关返回非 JSON 时抛 SyntaxError，被外层 catch 接住后原样拼进用户提示 → 真机出现过 `⚠ Unexpected token '<', "<!doctype "... is not valid JSON（云端数据未发生变化）` | 新增 `readJsonOrNull`，与拉取路径（`:117`）和 `requestSpaceEndpoint`（`cloudSyncHttp.js:76`）同一口径 |
| 8 | `components/DataManager.vue` + `composables/dataManagerBackup.js` | 「从备份恢复」确认文案只说"课程、重要日期和待办"，实际按备份携带字段覆盖 **40 个存储键**。**第一版改成另一段写死清单，复核指出仍然漏说**日程/专注记录/课程打卡/心情记录/OCR 词表/作息/学期/调课/账本分类·汇率·预算·模板 | 不再写死：新增纯函数 `restoreBackupModuleLabels()`，从 `providedFields` × `STORAGE_KEYS` × `SYNC_MODULES` 反推真实范围，文案与它同源 |
| 9 | `views/TasksView.vue:997` | ≤760px 的 `width: calc(100% - 38px)` 被基础规则的 `flex: 1`（即 `flex-basis: 0%`）**盖死**，从未生效 → 真机 390px 上 `.task-main` 只剩 103px、标题 `clientWidth` 为 **0** | 改用 `flex: 1 1 calc(100% - 38px)` 表达同一意图（净增 0 行，不动文件上限） |
| 10 | `composables/ledgerView/useQuickEntryForm.js` | 「连续记」复位清单漏了 `splitCount` → 上一笔按 3 人分摊后，下一笔只要填金额就**静默继承** 3 人分摊；为这件事写的 `resetSplitState()` 一直**零调用** | 改用 `resetSplitState()` |
| 11 | `components/schedule/ScheduleGrid.vue:284` | 提示文案里残留 Markdown 强调号，用户看到 `或**聚焦后用方向键选中再回车**都能…` | 去掉星号 |
| 12 | `views/ScheduleView.vue` + `views/LedgerView.vue` + `views/NotesView.vue` | 三处模板用了 `.notice-success`，但这条类只在**别的组件**的 scoped 块里定义（scoped 不跨组件）→ 反馈条渲染成默认段落（正文黑字 + 默认外边距）。**最初只补了 ScheduleView，复核抓出另外两处** | 三处各补一条同声明规则 |

### B. 子代理 A：外壳多条告警互相遮盖（P1）

`src/App.vue`：5 条外壳级告警（安全模式 / 本机保存失败 / 本机保存恢复 / 同步 / 备份提醒）
**共用同一个 `top` + `left:50%`**，其中同步告警 `z-index:240` 会被任一 `z-index:241` 的条
**整条盖住**，连「重试同步」按钮都点不到（离线 + 距上次备份超 7 天是一条现实的共现路径）。
→ 收进一个 `position:fixed` 的纵向 flex 队列 `.global-alert-stack`（5 份重复的 `<Transition>` 合并成
一个 `TransitionGroup`）；子条改 `position:relative` 并**保留自己的 z-index 声明**（240/241 仍真实参与比较，
不是静态定位下的死声明）；槽位序号由 CSS `order` 消费；预留高度按条数计算。
**真机复核**：`shell-alert-backup-nudge.png`（桌面）与 `-phone.png`（手机）两次采样都读到
`inStack=true`、`position=relative`、`slot=0`、在视口内，预留高度 54 / 124 与条高吻合。

### C. 子代理 B：作息设置的两个 P1

见 §1.3 后两条。新增守卫 `tests/timeResetConfirm.test.js`（3 条）、
`tests/timeImportPlanFailure.test.js`（5 条），并做了 **7 次变异**（退回直调 reset → 3/3 红；
删 `loadPlanDraft` → 2/3 红；删 toast `role="status"` → 双红；catch 不置失败态 → 3/5 红；等）。

### D. 复核改写了什么（这一步抓出了我自己的错）

独立复核（`ui-audit-verification.md`）对 12 项逐条给结论：**9 项成立 / 2 项有保留 / 1 项只落实一半**。
它抓出的三件事已全部改正，记在这里是因为它们正是"看起来很对"的假修：

1. **第 12 项只落实一半**：我声称三处 `.notice-success` 都补了，实际只补了 ScheduleView —— 已补 LedgerView 与 NotesView。
2. **第 3 项（账本「用一句话记」）修错了方向**：我只接了关闭路径，而**面板根本打不开**
   （`$attrs` 键名是 kebab 而模板读 camel）——只接线关闭，等于给一扇打不开的门装了锁。
   已改成声明 prop，并加了一条**两个方向都断言**的守卫（只测"关了没"会被"没打开"伪装成绿）。
3. **第 8 项文案仍然漏说**：第一版是"换一段写死清单"，仍漏 8 类数据 —— 已改成从真源计算。

复核还指出 `componentEmitContract` 的剥注释正则有**两个可复现反例**（假红 `const a = 1// emit(…)`；
漏判 `const re = /\/\//g; emit(…)` 与模板串里的 `//`）。已重写成逐字符三态扫描（普通 / 引号内 / 正则内），
并把这两类反例**固化成夹具**；`<`/`>` 明确排除在正则起点之外（否则模板里的 `</div>` 会被当成正则开始，
吞掉成片真实模板代码——这是 §1.88 的教训）。写这版注释时我自己又踩了一次同类坑：
注释正文里直接写出那段正则，其中的"星号斜杠"提前结束了块注释，整个测试文件无法解析。

---

## 3. 新增/加固的守卫（8 个），每一个都做了变异验证

本项目既定要求：**先做守卫、再用变异证明它有判别力**（不红可能只是"打偏了"）。

| 守卫 | 判据 | 变异 → 结果 |
|---|---|---|
| `tests/viewRenderMatrix.test.js`（11 条） | 10 条路由**在有代表性数据的前提下**真实挂载：① 无 `[GlobalError:`；② `#main-content` 就绪且非空；③ **本页应出现的那条播种数据真的出现**（第③条不可省：ExamsView 那种坏法页头照样渲染，"内容非空"完全成立） | 把 `reviewSummary(item)` 改回去 → `/exams` 红（`TypeError: _ctx.reviewSummary is not a function`） |
| `tests/componentEmitContract.test.js`（6 条） | 组件 `emit('x')` / `$emit('x')` 的每个名字必须在同文件登记过（`defineEmits([...])` **或** options 的 `emits: [...]`）；剥注释用三态扫描器，含正则/模板串/HTML 注释的自证夹具 | 从 `QuickEntryModal.vue` 删掉 `'update:showQuickRecord'` → 立刻指出该文件 → 该事件 |
| `tests/shellToolEntries.test.js`（1 条） | 外壳渲染后侧栏存在可访问名称含「氛围与纪念日」的按钮；点击后出现 `role="dialog"` 且标题正确；再点关闭，浮层消失（**只测入口那一步**） | 把 `<FestiveSettings>` 的 `v-if` 置假 → 「点击入口后没有打开任何对话框」红 |
| `tests/quickEntryModalClose.test.js`（**扩写**，+1 条） | 账本内「⚡ 用一句话记」**先断言打开、再断言关闭** | ① 读回 `$attrs.showQuickRecord` → 「面板没有打开」红；② 去掉父级 `@update:show-quick-record` → 「点了 × 之后没有关闭」红 |
| `tests/restoreBackupScope.test.js`（7 条） | 恢复范围文案必须由真源算出：备份里有的模块都要出现、**没有的不许出现**（不能吓唬用户）、落在 `SYNC_MODULES` 之外的键归为「其它本机设置」；另有一条断言"判据与 `buildBackupRestoreValues` 的真实写入路径同源" | 退回写死清单 → 「旧文案漏掉的账本/清单/专注记录/外观/氛围」红 |
| `tests/shellAlertQueue.test.js`（6 条，子代理 A） | 渲染级：两条告警同时在 DOM、父节点是同一个队列容器、`--alert-slot` 严格递增 `[0,1]`、撤掉一条后收紧回 0；源码级：容器是唯一定位者、子条 `relative` 且不许 `fixed`/`top`、预留高度乘条数 | 所有条同槽位 → `[0,0] ≠ [0,1]` 红；子条退回 `fixed`+同 top → 源码断言红；`--alert-count` 固定 1 → 渲染级红 |
| `tests/timeResetConfirm.test.js`（3 条，子代理 B） | 确认框出现且文案含三要素、取消零副作用、确认后数据与**输入框**同步且 toast 有 `role=status` | 退回直调 → 3/3 红；删 `loadPlanDraft` → 2/3 红 |
| `tests/timeImportPlanFailure.test.js`（5 条，子代理 B） | 失败（throw 与"引擎未就绪"两路）都留在当前浮层、不再出现「确认并导入」、回滚一次、重试真的重跑并清错、两层只有一个播报点 | catch 不置失败态 → 3/5 红（弹窗切回列表 = 缺陷现场）；删 `role="alert"` → 1 红 |

**另外修了一条偶发的既有守卫**：`tests/appShellAnnouncements.test.js:70` 把
`expect(liveAlert.value).toBe('')` 挂在 `await settle()`（两个 rAF）之后，而播报实现是
"先同步清空、30ms 后写入"——机器一忙（208 个用例文件并行时就是这样）单帧就可能超过 30ms，
写入先落下，判据偶发变红。改成 `await nextTick()`（微任务里定时器不可能跑掉）后，
判据盯的是"**清空是同步发生的**"，与墙钟无关。**这不是把红调绿**：原断言要的性质仍在。

**棘轮变更（两处放宽，如实登记）**：`tests/ratchetHardcoding.test.js` 的 `LARGE_FILE_LIMITS`
把 `components/Sidebar.vue` 988 → **1004**（补一个用户根本点不到的入口必须落在 Sidebar），
`App.vue` 944 → **969**（子代理 A 先自己减了 13 行，再按实测登记）。两处都在注释里写明理由与"只准缩"。
`TasksView.vue` 那处修复被**刻意压成净增 0 行**，就是为了不为了改一行 CSS 去抬高一个文件上限。

---

## 4. 已确认、但**本轮没有修**的问题（附原因）

| # | 级别 | 问题 | 为什么本轮不修 |
|---|---|---|---|
| 1 | P2 | **待办 / 清单的滑动动作按钮是死控件**：揭开的按钮走 `emit('action', key)`，而 `TasksView.vue:618-624`（与 ListsView 同形）只监听 `@swipe`。不过 swipe 揭开时**已经**执行了动作（`:155` 在 `nextOpen` 那一刻就 `emit('swipe')`），所以主手势可用、只有那枚按钮是死的 | 这里有一个**产品决策**：滑动是"划过去即执行"（Gmail 式）还是"划开露出按钮再点"（Mail 式）。代码里两套都有，我没有单方面选一套——选错会把"划一下即完成"变成"划两下" |
| 2 | P1 | **SyncPanel「重新绑定此设备」实为立即解绑**：`SyncPanel.vue:94` 直接 `doDisconnect`，无确认，还会删掉 undo/lastKnownGood 快照；解绑后面板消失且全应用**没有重新绑定入口** | 牵涉两个决定："要不要确认"（是）与"解绑后从哪里重新绑定"（需要新入口或恢复密钥路径，而 6 位码/恢复密钥入口已按 `docs/supabase-auth.md:13` 移除）。这是产品决策 + 新接口 |
| 3 | P1 | **纪念日缺日期被静默丢弃，面板却写「修改即时自动保存」**（`festive.js:84-86` / `FestiveSettings.vue:380`） | 需要先定语义：**禁止空日期提交**（就地报错）还是**保留行但明确标注未保存**。静默丢弃是数据可靠性问题，改法会改用户已有的存储形状 |
| 4 | P1 | **冲突弹窗文案「未选择的项目不会提交」与实现相反**（实现要求每项都选满，`:246-250`），且失败反馈渲染在弹窗背后（`MergeConflictModal.vue:31` + `SyncPanel.vue:199`），弹窗内零反馈 | 两处都要改文案 + 把错误提到弹窗内；同时"要不要允许部分提交"是**行为决策**（当前实现拒绝部分提交） |
| 5 | P2 | 手机端数据管理分区导航 4 列只剩 3 键（`DataManager.vue:438`） | 纯视觉，一行 CSS，但会动 `DataManager` 的分区网格，与"数据管理"其它待修项一并做更省回归面 |
| 6 | P2 | 打印样式漏隐藏 6 类 `position:fixed` 浮层（`style.css:866-879`），与它自己写下的理由矛盾；`tests/printStyles.test.js:138-154` 的断言清单同样是那 9 个，所以一直没被发现 | 属"守卫自己漏了 6 个类"，要同时改实现与守卫清单；单独一轮更清楚 |
| 7 | P2 | 浏览器后退不关闭任何浮层（全仓 `popstate` 零命中） | 需要给浮层写历史栈，牵涉 `overlayStack` 与路由交互，属结构性改动 |

**P2/P3 未修项**（完整清单在 6 份分域报告里，含 `文件:行号` 与建议修法），典型几条：
课表 1024px 下「周日」被挤出、横向滚动条在首屏之外（真机 `tablet-schedule.png` 实测 12 个越界元素）；
笔记 0 条 + 无搜索词时空态标题却是「还没有匹配的笔记」且没有主按钮；
回放弹窗的日期/月份控件无可访问名称（AX 树 `name:""`，而 `formControlNames` 守卫把"被 label 包裹"直接放行）；
手机端「查看」同步空间弹层向左溢出 82px、编号被截断（真机 360px 实测）；
冲突选择按钮只有视觉 `selected`、无 `aria-pressed`（现有 `tabOrder` 守卫扫不到）；
`sl_reminder_log` 是僵尸键（在 `STORAGE_KEYS` 里但 `makeBackup` 不导出、`validateBackup` 不认）。

---

## 5. 覆盖面与证据边界（如实登记）

**看过并确认无问题的**（逐条理由在分域报告里，这里只列范围，避免后来人重看）：

- 外壳：skip link 首位与 `z-index:301`、唯一 `<main>`、`KeepAlive` + 滚动位置还原、
  Modal 的焦点陷阱/还原/滚动锁/`aria-modal`、`ActionSheet(110)`/`ContextMenu(130)`/抽屉(95)
  不参与 Modal 深度阶梯（**应有的优先级，不是缺陷**）、两条底部 toast 走坑位栈不互相压盖、
  Toast 与底栏 20px 间距、`src/**` 内 `vh`/`dvh` 孪生零缺漏、安全区 `env()` 全覆盖。
- 内核页面：4 档宽度零横向溢出、看板/月历键盘路径、弹窗接线、重复规则、
  5 处已有注释或报告登记的既定取舍。
- 课表：导入/识别/冲突/作息四条链路的状态机收尾出口、`period.number` 确实有值、
  `settingsSchedule`/`currentCampus` 同源、`table.diagnostics` 恒存在。
- 账本：`lastError` 兼作成功文案**是有意设计**、进度状态机收尾出口齐全、
  60 次 Tab 未逃出焦点陷阱、4 档视口零横向溢出、已有 6 处危险操作确认文案。
- 数据同步：`role="dialog"`/`aria-modal`/焦点陷阱、进度状态机收尾出口、`sl_*` 键语义未变。
- 设置：分区持久化、tab 键盘契约、标题层级、控件程序化名称、安全区、删除确认接线、
  `skin-notebook` 等刻意彩色组件。

**触控目标尺寸：剩下的命中经逐条核对后**全部**判为非缺陷**（这一步不能省——第一版 harness 没开触摸模拟，
量出来的"触控过小"全是假阳性）。归类：
- `input 13x13`：全部是**被 `<label>` 包裹的勾选框**（`.scope-item` / `.enable-row` / `.toggle-row` /
  `.module-row-main` 等）。真实点击目标是那个 label 整块，探针只量了 input 自身的盒子 —— **探针口径问题**。
- `button.theme-dot 18x18`：侧栏主题色圆点，`.theme-dots { gap: 7px }`，相邻中心距 **25px**；
  WCAG 2.5.8 的"间距例外"要求以目标为中心、直径 24px 的圆不与相邻目标相交，25 > 24 成立。
  且它只出现在 `>900px` 的桌面侧栏里，与 `style.css:390-393` 写明的取舍一致。
- `a.panel-link 64x16` / `a 52x16`（"查看待办 →"之类）：属同一类"独立文字链接、靠间距可分"的密集控件。

**明确没有采信的证据**（说清以免被当成结论）：

- 分域审计期间 `ui-audit/shots/` 被并发进程清空重跑过两次，有几位审计者拿到的"路由截图"其实盖着
  「✨ 已更新」浮层（第一版 harness 的 release 键运行时读不到 `globalThis.__STUDY_LIFE_RELEASE__`、
  写成了 `'x'`）。**他们据此得出的弹窗/外壳结论一律以源码 + 既有测试为依据**；
  §2 的全部结论来自修复后的最终一轮真机采样。
- **一处失败的尝试**：为把 ExamsView 那类缺陷**静态**扫出来，我另写了一个"模板调用脚本区不存在标识符"的
  扫描器；它的标识符抽取太粗（对 322 个合法调用全部误报），**输出直接丢弃、未用作任何结论**。
- **两条告警同时出现**这个场景**没有真机覆盖**：触发同步告警需要伪造同步状态，在没有后端的情况下做不到。
  真机只验证了单条告警在新队列容器里渲染正确（桌面 + 手机两次采样）；
  两条的**顺序**由 `tests/shellAlertQueue.test.js` 的渲染级判据守着，而"真的没画在一起"
  在 happy-dom（无布局）与本轮采样里都**没能证明**——这是这条修复遗留的边界。
- **iPad 横屏（1024px、粗指针）**：harness 只对手机档开了触摸模拟，平板档是 `pointer: fine`，
  所以"粗指针下侧栏主题圆点是否达 24px"是**源码级结论**而非真机结论。
- `pending` 状态的成功态同步路径（需要 mock 后端）有 5 条"待确认"，隐含在 `ui-audit-data-sync.md` 里，
  没有被当成缺陷。
- 一次工具坑（值得记）：用 `npm run check | Select-String … | Select-Object -First N` 查看输出时，
  `Select-Object -First` 会**提前终止上游管道**，`npm run check` 根本没跑完就"exit 0"了
  （dist 时间戳停在两小时前）。**验证门禁必须把输出重定向到文件再读**，不要用 `-First` 截流。

---

## 6. 复现方式

```bash
cd D:\study-life\study-life
npm run check            # lint + typecheck + 208 文件 / 2223 用例 + vite build → exit 0

# 真机 UI 采样（仓库外，零依赖；需要本机装有 Edge）
node D:\study-life\ui-audit\audit-ui.mjs routes    # 44 张路由截图 + DOM 指标
node D:\study-life\ui-audit\audit-ui.mjs modals    # 12 张重点弹窗
node D:\study-life\ui-audit\audit-ui.mjs dialogs   # 26 张"逐页点开弹窗"
node D:\study-life\ui-audit\audit-ui.mjs alerts    # 外壳告警（需 6 秒定时器）
node D:\study-life\ui-audit\audit-ui.mjs all
# 产物：D:\study-life\ui-audit\shots\*.png 与 *-report.json
```

> `audit-ui.mjs` 刻意放在**仓库之外**：它是临时工具，不参与源码签名、不会被误提交。
> 若要长期保留，建议移进仓库并补 `.gitignore` 规则（截图属于本项目隐私规则里"不提交"的一类）。
> `scratch-seg{,-2,-3,-4}.mjs`（仓库根、未跟踪）经复核确认**全仓零引用、内容全为虚构样例**，
> 判为一次性探针残留 —— **没有删除**，留给用户决定。