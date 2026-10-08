# 数据管理 / 同步 / 备份 UI 审计

> 历史记录：本文审计的是旧版同步空间面板。2026-10-07 起，产品只保留本地备份导出、从备份恢复和 Supabase 账号同步；设备码、绑定码、同步空间与二维码迁移已停用，旧 `/api/sync/*` 接口统一返回 410。下方关于 `SyncPanel` 和旧同步操作的观察仅供追溯，不代表当前入口或待修清单。当前产品边界见 `README.md` 与 `docs/supabase-auth.md`。

审计范围：`DataManager.vue`、`data/` 下除 `AppUpdateSection.vue` 外全部、`SyncPairingModal.vue`、`LocalTransfer.vue`、`DomainCsvImportButton.vue`，以及 `composables/` 下 `dataManager*`、`cloudSync*`、`accountSync*`、`autoSync*`、`sync*`、`conflictDetection.js`、`domainCsvImport.js`。只读，未改 `src/`、`tests/`。

真机取证：`D:\study-life\ui-audit\dm\shots\`（本机 Edge headless + CDP，脚本 `D:\study-life\ui-audit\dm-audit.mjs`，dist 为 2026-10-07 13:32 构建，新于所有相关源码）。关键截图已复制到 `D:\study-life\ui-audit\shots\`（`phone-data-manager*.png`、`phone-data-sync-*.png`、`narrow-data-sync-spaceid.png`、`desktop-data-manager.png`）。

## 结论摘要

1. 移动端同步空间弹层（SyncPanel）有一处**真机可复现**的横向溢出：「查看」弹层向左溢出 82px，空间编号被截断——根因是 `.space-summary` 只在内容宽度内布局（实测 93px 宽），`right:-4px` + `min-width:250px` 只能向左展开；同一根因让该行的上下分隔线也只是短短一截。
2. `SyncPanel` 的「重新绑定此设备」按钮实际上是**立即解绑**：单击即执行、无二次确认、还会删掉撤销快照与恢复快照；解绑后旧同步空间在本应用内没有任何重新绑定入口（6 位访问码与恢复密钥两条入口已按 `docs/supabase-auth.md:13` 移除）。文案与结果相反，是本轮最该先修的一条。
3. 推送失败时把浏览器原文错误直接渲染给用户：真机上出现 `⚠ Unexpected token '<', "<!doctype "... is not valid JSON（云端数据未发生变化）`。根因是 push 路径先 `res.json()` 再判 `res.ok`，而拉取路径（`cloudSyncTransfer.js:117`）与 `cloudSyncHttp.js:76` 都有防护，属于同文件内的写法不一致。
4. 「从备份恢复」的二次确认只说会覆盖课程/重要日期/待办，实际覆盖备份文件里包含的全部模块（账本、消费、清单、笔记、主题、壁纸、各类设置，共 40 个存储键）；备份范围与恢复范围都可由用户勾选，文案没有跟上。
5. 「云端暂时不可用 · 系统会稍后重试」对不可重试错误（`invalid-request` / `payload-too-large` / `version-mismatch`）是假承诺：`scheduleRetry` 会直接 return，状态停在 `error` 且不会再重试。
6. 冲突确认弹窗的说明「未选择的项目不会提交」与实现相反（未选满就拒绝提交），且拒绝时的错误文案渲染在**弹窗背后**的同步面板里，弹窗内毫无反馈；选中态也只用视觉 class，`aria-pressed` 缺失（现有守卫只覆盖 `role=group/radiogroup/tablist` 内的按钮，`.`merge-choice` 是普通 div，覆盖不到）。
7. 手机端分区导航是 `repeat(4, …)` 网格但只剩 3 个按钮（QR 迁移入口移除后未同步网格），真机实测 390px 下右侧空出一整列。
8. 弹窗内标题层级不一致：账号同步用 `h3`（与弹窗标题同级），同一位置的旧同步面板和其余分区都是 `h4`。
9. 已核查无问题的部分见末节（含 `lastError` 兼作成功文案、进度状态机的收尾出口、对话框语义与焦点陷阱等，均**不是**缺陷）。

## 问题清单

### [P1] 「重新绑定此设备」实为立即解绑：无确认、文案与结果不符、解绑后无重新绑定入口

- 位置：`src/components/data/SyncPanel.vue:94`、`src/composables/dataManagerSyncActions.js:356`、`src/composables/cloudSyncSpaceOps.js:400`、`src/components/DataManager.vue:78`
- 现象：授权失效（`credential-invalid` / `permission-denied`）时，状态卡上多出一颗「重新绑定此设备」，点一下**直接**调用 `doDisconnect()`：停止同步、清空绑定（`clearSyncSpaceSettings()`）、删除该空间的 `UNDO_KEY` 与 `LAST_KNOWN_GOOD_KEY` 快照，然后在数据管理里显示「已停止本设备同步，本地数据保留」。紧接着 `showLegacySync` 变为 false（`DataManager.vue:78`），整个旧同步面板被 `AccountSyncPanel`（登录/注册）替换——用户以为在"重新绑定"，拿到的是"解绑 + 入口消失"。
- 证据：
  - `SyncPanel.vue:94`：`<button … class="text-button sync-rebind-action" @click="doDisconnect">重新绑定此设备</button>`（同文件 `:168` 的同一操作走 `requestDisconnect` → 确认框，形成鲜明对照）。
  - `cloudSyncSpaceOps.js:400-416`：`disconnectCloud()` 清绑定并 `removeItem(syncStorageKey(UNDO_KEY…))`、`removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY…))`。
  - 无重新绑定出口：`confirmCreateSpace`(`dataManagerPairing.js:73`)、`connectCode`(`:48`)、`joinSpaceFlow`(`:175`)、`startClaimPairing`(`:155`) 全部无模板调用点；`docs/supabase-auth.md:13` 明确写「本地二维码迁移与新建、扫码加入旧同步空间的入口已移除」。
- 建议修法：该按钮改走 `requestDisconnect` 的确认框，并把文案改成「停止本设备同步」（说清会失去撤销/恢复快照）；若确实想提供"重新绑定"，需要在解绑后给出加入路径，否则不要用"重新绑定"这个词。

### [P1] 推送失败把浏览器原文错误渲染到界面（英文 + HTML 片段）

- 位置：`src/composables/cloudSyncTransfer.js:404`、`:436`，渲染于 `src/components/data/SyncPanel.vue:199`
- 现象：`pushToCloud` 先 `const response = await res.json()`（`req.json()` 未 try/catch），再判 `!res.ok`。当部署环境没有 `/api/sync/push`（静态托管回落到 `index.html`、反代/门户返回 HTML）时，`res.ok === true` 但解析必然抛 `SyntaxError`，被 `:436` 直接拼成 `${error.message}（云端数据未发生变化）` 交给 `lastError`，最终由 `SyncPanel.vue:199` 原样显示。
- 证据：真机截图 `D:\study-life\ui-audit\shots\narrow-data-sync-spaceid.png` 中可见 `⚠ Unexpected token '<', "<!doctype "... is not valid JSON（云端数据未发生变化）`（该场次已伪造合法绑定信息，`autoSyncEnabled: true`，启动后自动同步走到 push 分支）。对照写法：`cloudSyncTransfer.js:117` 先 `if (!res.ok) throw await responseError(...)`；`cloudSyncHttp.js:76` `try { response = await res.json() } catch {}`。
- 建议修法：push 路径改为「先判 `res.ok`，再用 try/catch 解析」；解析失败时给出中文兜底（含状态码），或复用 `accountSyncLifecycle.js:24` `accountSyncFailureMessage` 的"技术错误翻译"口径。

### [P1] 「从备份恢复」的确认文案没有说清会覆盖什么

- 位置：`src/components/DataManager.vue:286`，对照 `src/composables/dataManagerBackup.js:39`、`:88`、`:340`
- 现象：确认框写「恢复后将覆盖当前浏览器中的课程、重要日期和待办数据，是否继续？」，但 `STORAGE_KEYS`（`dataManagerBackup.js:39-78`）覆盖 40 个键：账本/消费/固定账单/清单/笔记/课程模板/打卡/主题/外观/壁纸/性能模式/节日/提醒记录……恢复时按 `backup.providedFields` 逐键写入（`:348` `buildBackupRestoreValues`），即备份文件里带了什么就覆盖什么。导出侧还允许用户勾选模块（`BackupSection.vue:19`），所以"会丢什么"完全取决于文本里没提的那些模块。
- 证据：`DataManager.vue:213-224` 的恢复预览只列了 9 项统计；确认文案只点名 3 类。`dataManagerBackup.js:349-351` 恢复前只做 `previous` 快照用于**失败回滚**，不做成功后的撤销。
- 建议修法：用 `selectedBackup.providedFields` / `summary` 动态生成后果说明，例如「将用该文件覆盖本机的课程、账本、清单、笔记等 N 类数据；文件中没有的模块保持原样」，并把「恢复后无法撤销」写进去。

### [P2] 「系统会稍后重试」对不可重试的错误是假承诺

- 位置：`src/composables/dataManagerStatus.js:90-91`，依据 `src/composables/autoSyncCoordinator.js:231`、`:355`
- 现象：`autoSyncState === 'error'` 时状态卡固定显示「云端暂时不可用 / 本机数据已保存，系统会稍后重试。」。但 `runSyncCycle` 的 catch 里，`syncErrorKind` 属于 `invalid-request`（HTTP 4xx）/ `payload-too-large`（413）/ `version-mismatch`（426）时，`scheduleRetry` 在 `shouldRetrySyncError()` 处直接 return，状态就停在 `error`，不会有任何自动重试；标题把客户端/契约问题说成"云端暂时不可用"也不准确。
- 证据：真机 `D:\study-life\ui-audit\shots\phone-data-sync-status.png` 显示该卡片原文；`autoSyncCoordinator.js:232` `return !['credential-invalid','permission-denied','invalid-request','payload-too-large','version-mismatch'].includes(kind)`；`:362-363` `setState('error', message); scheduleRetry(...)`；`cloudSyncState.js:194-200`（kind 映射）。
- 建议修法：按 `syncErrorKind` 分档。可重试的保留"稍后自动重试"；不可重试的改成「需要你处理」，413 明确提示"导出备份并清理大附件"（`accountSyncEngine.js:286` 已有同义的现成文案可对齐）。

### [P2] 冲突弹窗的说明与实现相反，且失败反馈落在弹窗背后

- 位置：`src/components/data/MergeConflictModal.vue:14`、`:31`，`src/composables/cloudSyncTransfer.js:246`，`src/components/data/SyncPanel.vue:199`
- 现象：弹窗开头写「…未选择的项目不会提交」，提交按钮 `提交已选决策` 也没有禁用条件；但 `resolvePendingMerge` 在存在未决冲突时直接 `showError('仍有 N 个冲突未选择处理方式')` 并 return。错误写进 `lastError` 后由 `SyncPanel.vue:199` 渲染——而 `SyncPanel` 在被 `MergeConflictModal`（`DataManager.vue:211`）盖住的下层，用户点提交后视觉上没有任何变化。
- 证据：`MergeConflictModal.vue:31` `@click="commitConflictChoices"`（无 `:disabled`）；`cloudSyncTransfer.js:246-250`；`MergeConflictModal.vue` 全文件没有任何 `role="alert"`/错误显示。
- 建议修法：二选一并让两边一致——(a) 允许部分提交（文案不变，实现改为只提交已选项）；(b) 保持"必须全部选择"，则按钮禁用 + 弹窗内提示「还有 N 项未选择」，并把错误显示在弹窗内。

### [P2] 冲突选择的选中态只有视觉 class，读屏无法得知选了哪一项

- 位置：`src/components/data/MergeConflictModal.vue:27-28`
- 现象：两个按钮用 `:class="{ selected: conflictChoices[key] === 'local' }"` 表达选中，没有 `aria-pressed`/`aria-checked`；`MergeConflictModal.vue:79-82` 只用 `.selected` 换底色。
- 证据：仓库自己的守卫 `tests/helpers/tabOrder.js:213-224` 只在 `role="group|radiogroup|tablist"` 容器内查"有选中 class 却无 ARIA"，而 `.merge-choice`（`MergeConflictModal.vue:26`）是普通 `div`，因此这条规则**覆盖不到**此处。对照：`SyncPairingModal.vue:214-215` 用 `:aria-pressed`，`AccountSyncPanel.vue:108` 用 `radio`。
- 建议修法：加 `:aria-pressed`，或直接改成 `fieldset` + `radio`（与账号同步面板一致）。

### [P2] 手机端「查看」同步空间编号的弹层向左溢出 82px，编号被截断

- 位置：`src/components/data/SyncPanel.vue:117`（`.space-summary` 结构）、`:684`（`.space-id-detail` 绝对定位）、`:790`（窄屏 `min-width:min(250px,100vw - 76px)` + `right:-4px`）
- 现象：手机上点「查看」，弹层从视口左边界之外开始展开，空间编号的前 8 个字符被切掉（只剩 `KLM`），用户拿不到完整的同步空间编号。
- 证据（360×640 真机 CDP 实测，均 rel. viewport）：
  - `summary`（`.space-summary`）`[71,164]`，宽 **93px**——它是 `display:flex; align-items:flex-start` 的 `.section-copy` 里的子项，按内容收缩，因此 `justify-content:space-between` 不生效、行内上下两条 `border` 也只有 93px 宽（截图里就是断的）。
  - `.space-id-detail` `[left=-82, right=168, width=250]`；`code` `[left=-71, right=19]`（89px 宽）。
  - `.modal-body` `scrollWidth === clientWidth === 360`，负方向溢出不可滚动 → 左侧 82px 永久不可见。
  - 截图 `D:\study-life\ui-audit\shots\narrow-data-sync-spaceid.png`：弹层只显示 `KLM  复制编号`。
  - 390px 探针同样得到 `[-82,168]`；桌面 1440px 正常（`[269,489]`）。
- 建议修法：给 `.space-summary` 加 `width:100%`（顺带修好分隔线）；或窄屏把 `.space-id-detail` 改成 `right:auto; left:0`／直接在行内展开而不是浮层。

### [P2] 手机端分区导航是 4 列网格却只有 3 个按钮

- 位置：`src/components/DataManager.vue:155-159`（3 个 button）与 `:438`（`grid-template-columns:repeat(4,minmax(0,1fr))`）
- 现象：390px 手机上导航条右侧空出一整列，每个按钮只有容器宽度的 1/4（约 87px），文字空间被白白挤掉；360px 同样。
- 证据（真机）：390px `gridTemplateColumns = "86.5px 86.5px 86.5px 86.5px"`，按钮 `[备份:87@16, 同步:87@107, 恢复:87@197]`，而导航条宽 366px；截图 `D:\study-life\ui-audit\shots\phone-data-manager.png`、`phone-data-manager-bottom.png` 右侧可见空档。
- 建议修法：改成 `repeat(3, …)`。

### [P2] 数据管理弹窗内标题层级不一致（账号同步 h3 与弹窗标题同级）

- 位置：`src/components/data/AccountSyncPanel.vue:85`（`<h3 :id="headingId">账号同步</h3>`），对照 `BackupSection.vue:15`、`CalendarExportSection.vue:80`、`DataHealthCard.vue:12`、`RestoreSection.vue:11`、`SyncPanel.vue:79`（均为 `h4`）、`Modal.vue:357`（弹窗标题默认 `h3`）
- 现象：同一个弹窗里，五个分区是 h4，唯独"账号同步"是 h3，与弹窗标题"数据备份与恢复"平级；换到旧同步分支时同一位置又变成 h4（`已有设备同步`），即同一槽位两种层级。读屏的大纲会把它读成弹窗的兄弟而不是分区。
- 证据（真机 DOM 大纲）：`H3 数据备份与恢复 → H4 导出本地数据 → H4 导出到系统日历 → H4 数据健康 → H4 从备份恢复 → H3 账号同步`；绑定旧空间时同一位置为 `H4 已有设备同步 → H5 …`。
- 建议修法：`AccountSyncPanel` 的标题降到 `h4`（`AccountPanel.vue:262` 的 `compact` 用法需一并确认），或给 DataManager 的 Modal 传 `titleLevel: 2` 并让所有分区升到 h3。

### [P2] 「恢复同步前数据」（危险动作）没有二次确认，也没说明会覆盖什么

- 位置：`src/components/data/SyncPanel.vue:133` → `src/composables/dataManagerSyncActions.js:179` → `src/composables/cloudSyncState.js:314`
- 现象：`syncRecovery.status === 'recovery-required'` 时出现的红色按钮「恢复同步前数据」直接 `restoreSyncRecovery()`：用同步前快照覆盖本机值并清掉 commit marker / lastKnownGood。单击即执行，没有任何确认框，面板文案（`SyncPanel.vue:132` = `syncRecovery.message`）也没说"当前本机数据会被覆盖、同步中断后新写的记录会丢"。
- 证据：同文件 `:168` 的"停止本设备同步"走 `requestDisconnect` 确认框；`DataManager.vue:242-290` 共 5 个 `ConfirmDialog`（创建空间/升级/重新校准/移除设备/从备份恢复），**不含**这一条；`cloudSyncState.js:319` `await restoreLastKnownGood()`。
- 建议修法：走 `ConfirmDialog`（danger），文案写清"将用同步前快照覆盖当前本机数据，同步中断后新写入的记录会丢失"；`撤销上次拉取`（`SyncPanel.vue:149`）可保留无确认，但 tooltip 已说明目标时间，属可接受惯例。

### [P3] 旧二维码迁移的组件已成死代码，且文档清单仍把它算作功能

- 位置：`src/components/data/TransferSection.vue`（全文）、`src/components/LocalTransfer.vue`（全文）
- 现象：两者在 `src/` 内**没有任何 import**（`grep -r "TransferSection\|LocalTransfer" src/` 只命中 `LocalTransfer.vue` 自己 import 的 `localTransfer.js` 和一条注释）。入口移除是有意为之：`docs/supabase-auth.md:13` 写明入口已移除，`tests/dataManagerRestoreNav.test.js:81` 还断言 `#data-transfer` 必须不存在。同一批不可达的还有 `DataManager.vue:242-250` 的「创建同步空间」确认框（只由 `dataManagerPairing.js:73` `confirmCreateSpace` 打开，而它无调用点）与 `connectCode`/`joinSpaceFlow`/`startClaimPairing`（`:48`/`:175`/`:155`）。
- 证据：`docs/audit/file-review.md:194` 仍把 `LocalTransfer.vue`（582 行）登记为"QR 码本地迁移"功能。
- 建议修法：删除死文件或加"已停用"标注，并更正 `docs/audit/file-review.md`；`dataManagerPairing.js` 里无人调用的导出建议一并清理（注意别破坏 `tests/modalSections.test.js` 对 `LocalTransfer.vue` 的静态判据）。

### [P3] 长任务完成后的进度卡没有关闭出口

- 位置：`src/components/TaskProgress.vue:77`、`src/composables/taskProgress.js:133`
- 现象：`finish()` 只在任务从未 visible 时把 `active = false`；已经 visible 的长任务完成后 `active/visible` 仍为 true，而按钮区只在 `stalled || canCancel || canRetry || retainedResult` 时渲染——普通成功态三者皆 false，于是"已完成"卡片一直留着，没有任何关闭/收起按钮。`syncProgress`/`backupProgress` 都是模块级单例（`dataManagerSyncActions.js:45`、`dataManagerBackup.js:23`），重开数据管理仍会显示上一次的完成卡。
- 证据：源码可证；**未能在真机复现**成功同步/长备份（本机没有同步后端），见「待确认」。
- 建议修法：成功态补一个「完成」/自动收起（可复用 `@continue` → `reset()` 通道）。

### [P3] 手机端多个控件小于仓库自己的 44px 触控目标

- 位置：`style.css:394-400`（粗指针兜底只覆盖 `.btn:not(.chip/.link-btn)`、`.tap-target`、`.setting-del`）与 `SyncPanel.vue:119`/`:148`/`:153`/`:105`、`DataManager.vue:185`
- 现象（360–390px 真机实测高度）：`button.scope-toggle`「清空/全选」43×30、`button.switch` 自动同步开关 48×28、`button.icon-button`「✎ 重命名当前设备」30×30、`summary`「查看」24×16、`button.text-button`「复制编号」48×24、`summary`「选择从云端拉取的数据范围」132×23。这些类都不在粗指针 44px 规则的目标选择器里，在真机上也不会被兜底放大。
- 证据：真机 PROBE（`dm-audit.mjs`）逐元素 `getBoundingClientRect`；`tests/touchTargetHooks.test.js:5-12` 明确说仓库**拒绝**"用字号/padding 推算像素高度"，所以这里给的是真机实测值而不是推算值。
- 建议修法：把 `.scope-toggle` / `.text-button` / `.switch` / `.icon-button` 接入 `--tap-min`（或加 `.tap-target`）；至少在窄屏把「查看」从 24×16 放大。

### [P3] 数据健康卡没有加载/忙碌态，首次打开会先渲染 0 值

- 位置：`src/components/data/DataHealthCard.vue:12`（刷新按钮无 `:disabled`/`aria-busy`）、`src/composables/dataManagerStatus.js:27`（初值全 0）、`src/components/DataManager.vue:131`（打开时 `refreshDataHealth()`）
- 现象：`dataHealth` 的初值是 `{keys:0, bytes:0, …}`，`refreshDataHealth` 要 `await navigator.storage.estimate()` 才整体赋值，所以首次打开会短暂显示「0 项 / 0 B」；刷新按钮在请求飞行中仍可连点（无守卫），`estimate()` 失败被 `try{}catch{}` 静默吞掉。
- 证据：`dataManagerStatus.js:173-201`。第二次打开因为模块级缓存不再闪。
- 建议修法：加 `loading` 态（按钮 `:aria-busy` + 卡片骨架）即可，不必改数据口径。

### [P3] `detectCourseConflicts` 的入参守卫用了不存在的字段（当前无调用方，潜伏）

- 位置：`src/composables/conflictDetection.js:90`，对照同文件 `:46-48` 的注释与 `src/composables/domain/commands.js:504-505`
- 现象：`if (!newCourse?.day || !newCourse?.startPeriod || !newCourse?.endPeriod) return []`，但课程对象只有 `start` / `end`（`commands.js:504` `start: Number(value.start) || 1`），所以任何真实课程进来都会立刻返回空数组——`getCourseTimeRange` 里那段"节次 id 对齐"的修复因此永远不会被执行到。
- 证据：`src/` 内只有 `detectTaskEventConflicts`/`getConflictSummary` 被 `EventsView.vue:11`、`TasksView.vue:20` 使用；`detectCourseConflicts`/`detectAllConflicts` 无调用方（同文件 `:24-26` 的注释也承认这条链路没有调用方）。
- 建议修法：守卫改成 `start`/`end`（与 `:46-48` 的注释一致），或在接线前标注为未启用。

## 待确认（未能证实）

1. **需要真实同步后端/多设备的路径**：创建/升级同步空间、「添加设备」配对的完整成功路径、手动拉取/推送成功、`MergeConflictModal` 的实际渲染、重新校准、「恢复同步前数据」的实际覆盖结果。本机只能起静态 `dist`（`/api/sync/*` 一律回落到 `index.html`），因此上述界面的**成功态**都没有真机截图。要证实：需要一个返回 JSON 的 mock 后端（或 `tests/dataManagerSync.test.js` 那样的 fetch stub 真机化）。
2. **P3「完成卡无出口」**：需要一次真实的长任务成功结束（含壁纸的备份导出，或一次成功的 pull/push）才能拍到"已完成且无按钮"的卡片；本机 `dist` 下壁纸为空、同步无后端，未复现。
3. **P1-1「重新绑定此设备」的解绑后果**：我按 `disconnectCloud()` 的实现推断"删掉撤销/恢复快照 + 面板消失 + 无重新绑定入口"，未真机点击验证（需要把 `connectionState` 置成 `credential-invalid`，本机无法制造该服务端响应）。要证实：stub `/api/sync/space/verify` 返回 401 后真机点一次。
4. **不含壁纸的恢复有个"无反馈窗口"**：`dataManagerBackup.js:353` 只有 `hasWallpapers` 时才 `backupProgress.start(...)`，否则 `await restoreStoredValues()` 期间界面无任何忙碌指示、随后立刻 `location.reload()`（`:389`）。是否真的会被用户感知，取决于本机数据量；要证实需要一个真实的大备份文件与 `Input.setFileInputFiles` 真机导入（本轮未做，因为要现造带 `checksum` 的 v9 备份文件）。
5. **`AccountSyncPanel` 的 `h3` 是否在别的宿主里有意义**：它还被 `AccountPanel.vue:262`（`compact`，账号面板）使用，那里父级标题层级我没审（不在本轮范围）。改层级前需要看一眼账号面板的标题结构，否则可能把那边改坏。

## 已核查确认无问题

- **`lastError` 兼作成功文案不是 bug**：`cloudSyncState.js:516-521` `showSuccess()` 刻意把成功文案写进 `lastError`（`clearSyncError()` + `syncStatus='success'`），`SyncPanel.vue:198` 按 `syncStatus` 分流成 `.success`，2.6s 后回落 `idle`。看起来"成功态显示 lastError"是有意设计，别改。
- **进度状态机的收尾出口齐全**：`taskProgress.js:133`（finish）/`:149`（fail + `canRetry`）/`:165`（cancel 自己置 `cancelled` 再调 cancel 回调，且吞掉晚到的 finish/fail）；`TaskProgress.vue:77-82` 提供「继续等待 / 取消任务 / 重试当前步骤 / 使用当前结果」。`runSync` 的中止分支（`dataManagerSyncActions.js:230`）不会把任务卡在 `running`。
- **对话框语义与焦点管理**：真机确认 `[role=dialog][aria-modal=true]` 且 `aria-labelledby` 解析到「数据备份与恢复」；打开后初始焦点落在 `✕`（安全默认，不落在危险键）；连按 60 次 Tab 焦点始终留在弹窗内（`focusTrail` 两次采样 `insideModal=true`），`Escape` 只关最上层。DataManager 另外给内层拉取/推送确认框显式聚焦「取消」（`DataManager.vue:123-127`）。
- **已有二次确认的危险操作**：创建空间（`DataManager.vue:242`）、升级为自动同步（`:252`）、重新校准（`:262`）、移除设备（`:272`）、从备份恢复（`:282`）、停止本设备同步（`:189`）的文案都说明了"本机数据不删除/仅本设备"这类后果；`{ cancelLabel/tone }` 也按语义区分。
- **错误/成功/空状态的显式出口**：`DataManager.vue:226-227`（`role=status` / `role=alert`）；`CalendarExportSection.vue:61` 空范围提示、`:67` 导出失败提示；`DomainCsvImportButton.vue:54` 无新记录、`:57` 读取失败、`:86` 超 2000 行截断、`:96` `role=alert`、`:101` 无行时按钮禁用；`AccountSyncPanel.vue:100-102` 错误 + `重试账号同步` 出口。
- **`AccountSyncPanel` 的状态文案覆盖完整**：`accountSyncStatus` 的全部取值（`signed-out/preparing/checking/syncing/pending/offline/synced/conflict/error/disabled/paused`，见 `accountSyncEngine.js` 的 17 处 `setState` 与 `accountSyncLifecycle.js:49`）在 `AccountSyncPanel.vue:22-27` 的映射表里一一有对应，没有落到兜底文案的取值。
- **`SyncPairingModal` 的失败态是有守卫的**：`:225-234` 保留弹窗、`role=alert` 显示后端文案、提供「重新生成」；`tests/dataManagerSync.test.js:146-195` 用 401/429/500 + 重试成功三类用例钉住"不渲染空二维码、错误可见、重试只发一次请求"。`:230` 的"请稍后重试"是后端无文案时的兜底，与可点的重试按钮同屏，故不报。
- **窄屏溢出与可访问名称**：4 档宽度（1440/1024/390/360）真机 `documentElement` 横向溢出均为 0，弹窗内无匿名按钮、无缺标签控件；`Modal.vue:445`/`:531` 用 `env(safe-area-inset-*)` 处理刘海/底部安全区；`.data-section` 的 `scroll-margin-top:58px`（`DataManager.vue:467`）由 `tests/focusObscured.test.js` 登记。
- **手机端分区导航不会改写路由**：`DataManager.vue:92-101` 用组件内 `scrollIntoView` 而不是 `#hash` 锚点（hash 路由下锚点会命中 404），`reducedMotionScroll`/`focusNavigation` 门控 `behavior`，`tests/dataManagerRestoreNav.test.js:57-72` 守卫。
- **备份/恢复的数据正确性面**：`dataManagerBackup.js:229-294` v1–v9 校验、v7+ 强制 checksum、`errors` 有中文文案；失败时 `:391-404` 回滚 localStorage 与壁纸并给出 `role=alert` 错误；`markBackedUp()` 在导出后调用。
- **`TransferSection`/`LocalTransfer`**：入口已按 `docs/supabase-auth.md:13` 有意移除（`tests/dataManagerRestoreNav.test.js:81` 有断言），因此不按"功能缺失"报；其脚本侧状态机（生成进度、取消、扫码进度、导入取消、`hasTransferUndo` 回滚）阅读后自洽，但作为死代码未做真机验证。
- **`accountSyncMode`**：开关只写 `study_life_account_sync_mode`（非 `sl_*`），注释解释了为何不进同步负载——与项目约束一致。
- **`conflictDetection` 的日程/待办冲突**（`detectTaskEventConflicts`）取值形状正确（`dueDate/date`、`dueTime/time`、`endTime`），已被 `EventsView`/`TasksView` 接入并有 `tests/conflictDetection.test.js`。
- **`dataHealth*` 没有独立 composable**：容量口径 `LOCALSTORAGE_BUDGET_BYTES`/`dataHealthFillRatio`/`dataHealthLevel` 都在 `dataManagerStatus.js:32-52`，`tests/dataHealthStorage.test.js` 覆盖；`navigator.storage.estimate()` 的 quota 失真问题已在 `:34-38` 注释说明并改用自算口径，不是缺陷。
