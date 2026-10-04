# 需求提示词（交给下一个 AI 会话）

> **⚠ 状态标注（第五十四轮加上，正文一字未改）**：**本文件是一张已经完成的历史需求单，不是待办。**
> 下面两项需求**都已实现**，**不要按它重做**：
> - **需求一（云同步"只选择要拉取的内容"）已完成**：`DataManager.vue` 已有 `SYNC_MODULES` 模块勾选框、全选/清空、"未勾选的模块保持原样"的说明与 `selectedPullModules` 门禁；`cloudSync.js` 的 `pullFromCloud({ keys })` 走 `normalizePullKeys`，未勾选模块的云端值被直接忽略、本地保持原样（`saveUndo` 也只覆盖被改动的键）。
> - **需求二（语音识别不可用）已完成**：`voiceInput.js` 的能力探测已覆盖 `SpeechRecognition` / `webkit` / `moz` / `ms` 四种前缀，并按错误码给出友好文案（含"需要联网"）；`QuickRecordPanel.vue` 在不支持的环境下显示"当前浏览器不支持语音识别"的降级提示而不是报错。
>
> 另外正文里的数字是**当时**的实况（例如第 11 行写的"vitest 187 条全绿"）——现在早已不是这个规模。**当前的交接文档是 `HANDOVER.md`**（它才是必读的那一份），本文件只作历史记录保留。

> 你可先读同目录 `HANDOFF.md` 了解「氛围 / 回顾 / 快速录入 / 智能归类」四模块的已完成背景、数据契约与发布状态。本文件是两个**新需求**的输入，请按顺序实现并遵守全部硬约束。

---

## 项目底座（必读）

- 路径：`D:\study-life\study-life`
- Vue 3（`<script setup>` + JavaScript，非 TS）· Vue Router（hash）· Vite · vite-plugin-pwa · Cloudflare Pages Functions + Durable Objects
- 门禁命令：`npm run lint` / `npm run typecheck` / `npm test`（vitest，187 条全绿）/ `npm run build`；全部通过才算完成
- 发布：`node scripts/bump-release.mjs --notes "说明一|说明二"` → `npm run build` →（收到用户部署指令后）`npx wrangler pages deploy dist --project-name=study-life --branch=main`

## 硬约束（违反即不合格）

1. 不新增任何 npm 依赖；不接入任何外部网络服务（语音识别只用浏览器本地 Web Speech API，失败降级）。
2. 全离线优先：不允许后台轮询 / 常驻定时器；云同步保持「严格手动」——连接 ≠ 拉取 ≠ 推送，任何数据上行/下行只由用户点击触发。
3. 不修改既有 `sl_*` 键语义；新键一律 `sl_` 前缀；数据写入前必须归一化。
4. 不改变路由 hash 方案；云同步仍走 DataManager 的既有同步页签，不新增路由。
5. 风格：`<script setup>` + JS；CSS 复用 `--primary/--card/--border` 等变量与 `.btn/.card/Modal`。

---

## 需求一：云端同步——「只选择要拉取的内容」

### 现状（已实现，可复用，勿重写）

- 数据键清单：`src/composables/cloudSyncData.js` 的 `SYNC_DEFAULTS` / `SYNC_KEYS`（约 29 个 `sl_*` 键）。
- 拉取入口：`src/composables/cloudSync.js` 的 `pullFromCloud()` —— 目前是**全量**：解密 → `sanitizeSyncPayload` 校验 → `applyRemoteValues` 应用 → 合并策略见 `cloudSyncData.js` 的 `mergeSyncValue`（数组按 `id` + `updatedAt` 选新，对象递归合并）。
- 已有撤销：`undoLastPull()` + `snapshotStates` / `saveUndo`（只快照实际改动的键）。
- UI：`src/components/DataManager.vue`（同步页签里已有「连接 / 拉取 / 推送 / 撤销」）。

### 目标

把「从云端拉取」改成**可选范围拉取**：用户点击拉取前，能勾选「本次要同步的数据模块」，只对勾选的模块执行 解密 → 校验 → 合并 → 应用；未勾选的模块保持本地原样、完全不动。

### 具体要求

1. 设计一个「模块 → 键」的静态分组（建议分组，可微调）：
   - 课程与课表：`sl_courses / sl_course_templates / sl_timecfg / sl_semester / sl_schedule_exceptions`
   - 待办：`sl_tasks`
   - 倒计时：`sl_exams / sl_countdown_show_past`
   - 清单：`sl_checklists`
   - 账本：`sl_bills / sl_expenses / sl_ledger_categories / sl_ledger_freq`
   - 吃什么：`sl_food_places / sl_food_history`
   - 外观与主题：`sl_theme / sl_custom_theme_color / sl_auto_wallpaper_color / sl_wallpaper_accent / sl_appearance / sl_wallpaper_config`
   - 氛围与心情：`sl_festive_config / sl_mood_log`（**注意：这俩是本次四模块新增，当前尚未被 `SYNC_DEFAULTS` 收录**，请一并纳入分组与同步清单）
2. `pullFromCloud()` 支持传入 `keys`（要拉取的键子集，默认全量保持向后兼容）；只对选中键走 `sanitizeSyncPayload` → `mergeSyncValue` → 应用，撤销快照也只覆盖被改动的键。
3. UI 在 DataManager 同步页签「从云端拉取」前增加可勾选的模块多选框（默认全选，可一键全选/清空）；确认后再执行拉取。触控区域 ≥ 40px。
4. 推送仍全量（保持现状，避免云端数据不完整），除非你不破坏语义地顺带支持可选推送。
5. `mergeSyncValue`、`sanitizeSyncPayload`、`validateSyncPayload`、`undoLastPull`、revision 冲突保护、加密/解密流程**全部保持不变**，只做「拉取范围」的过滤与 UI。
6. 补充/更新云同步相关单测：覆盖「只拉取某几个模块时，未勾选模块本地值被原样保留」的断言。

---

## 需求二：修复语音识别不可用

### 现状（已实现）

- `src/composables/voiceInput.js`：`speechRecognitionAPI()` 返回 `window.SpeechRecognition || window.webkitSpeechRecognition`；`isSupported()`；`transcribe()` 返回可 `start/stop/abort` 的控制器，不支持时返回 `null`。
- UI：`src/components/QuickCapturePanel.vue` 中 `voiceSupported = isSupported()`，按钮 `v-if="voiceSupported"`，不支持时只显示输入框、不报错。

### 问题与排查方向

用户反馈「语音识别现在不可用」。请先定位根因，再选择最小修复：

1. **优先排查浏览器能力，而非代码**：Web Speech API 的 `SpeechRecognition` 在 Chrome/Edge 可用，**桌面版 Firefox 不支持**；且仅在 HTTPS 或 localhost（安全上下文）下暴露。请确认是不是浏览器/协议原因。
2. 检查 `isSupported()` 判断是否遗漏了 `window.webkitSpeechRecognition` 之外的前缀（如个别 WebView 的 `SpeechRecognition` 缺失但存在事件式降级路径）。
3. 检查 `transcribe()` 的事件绑定（`onresult/onerror/onend`）是否有未捕获异常，是否在 `start()` 抛错时静默失败了却无 UI 反馈。
4. 目标行为：支持环境 → 可正常识别并把结果回填到输入框触发 `capture()` 归类；不支持环境 → 隐藏/禁用语音按钮并给出**一次性友好提示**（如「当前浏览器不支持语音识别，请手动输入」），不报错、不白屏。

### 完成标准

- 明确根因并修复；`voiceInput` 增加/更新单测（mock `window.SpeechRecognition` 存在与缺失两种情况）。
- 不支持环境零报错、有友好降级；支持环境端到端可用。

---

## 验收总门禁

- `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` 全绿。
- 选择性拉取：勾选 A 模块拉取后，未勾选的 B 模块本地数据逐字节不变。
- 语音识别：不支持环境不报错有提示，支持环境可识别。
- 完成后：更新 `HANDOFF.md` 与 `release.config.js` 版本说明（`node scripts/bump-release.mjs --notes "..."`），构建通过后**停下等部署指令**，不主动 `wrangler deploy`。