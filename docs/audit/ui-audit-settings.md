# 设置类界面 UI 审计（外观 / 氛围 / 作息 / 专注 / 快速记录）

审计范围：`src/components/AppearanceSettings.vue`、`FestiveSettings.vue`、`schedule/TimeSettingsModal.vue`、
`schedule/TimeBaseSettings.vue`、`FocusSettings.vue`、`QuickRecordSettings.vue`，以及
`settingsPolicy.js` / `appearance.js` / `theme.js` / `modalSections.js` / `wallpaperStorage.js` /
`festive.js` / `atmosphereStore.js` / `performanceMode.js` / `focusTimer.js` 中与设置有关的部分。
**只读审计**：未修改 `src/` 与 `tests/` 下任何文件。

## 结论摘要

1. **P0：`FestiveSettings.vue`（节日与纪念日设置）在应用里没有任何入口**。全 `src/` 只有测试 import 它，
   因此「启用节日氛围 / 生日 / 纪念日 / 农历纪念日 / 祝福语语言」五组设置**用户完全够不到**。
2. **P1：作息方案的「↺ 恢复默认」是即时破坏性操作**——无二次确认、绕过草稿系统直接改写正式数据，
   而且**屏幕上什么都不会变**（编辑器读的是草稿），用户看不到自己刚刚清掉了所有校区 × 作息季的时间。
3. **P1：纪念日只填名称、没选日期时会被持久化层丢掉**，但面板底部写着「✓ 修改即时自动保存」，
   关闭再打开该行就消失（农历纪念日的空名称同理）。
4. **P2 共 10 条**（另有 1 组 P3），集中在四个主题：破坏性操作的文案与后果不一致、反馈不可见/读屏听不到、
   选中态只存在于视觉 class、存储失败路径静默或抛英文原文。
5. 「可见反馈」在本区域有**三套并存的做法**：按钮式保存（专注 / 作息草稿 / 励志语文字）、
   即时生效无提示（快速记录设置全部项）、即时生效有提示（节日设置写「✓ 修改即时自动保存」、
   作息有 `settingsToast`）。快速记录设置属于**既无按钮也无提示**的一类，用户无法判断是否已生效。
6. 与既有守卫的关系：`tests/errorAnnouncement.test.js` 的成功消息类名集合是
   `['success','notice-success']`（:36-38），**不包含** `settings-toast`，所以作息弹窗那条
   「没有实时区域」的成功提示没有被守卫拦住；`tests/tabOrderAndNames.test.js` 只覆盖 10 个路由页，
   **不覆盖任何弹窗内部**，所以外观弹窗里两组「选中态只在 class」也没有被拦住。
7. 已核对后**确认没问题**的项见文末，包括分区持久化语义、tab 键盘契约、标题层级、
   表单控件程序化名称、安全区内边距、删除类操作的二次确认接线、`skin-notebook` 等刻意彩色组件。
8. 项目**明确拒绝**「用字号+padding 推算触控目标不足 44px」这类判据（`tests/touchTargetHooks.test.js:5-8`），
   本报告遵守该口径，不报触控目标尺寸推算。

---

## 问题清单

### [P0] 节日与纪念日设置面板没有任何入口，整块设置不可达

- 位置：`src/components/FestiveSettings.vue:1`（组件本体）、`src/components/Sidebar.vue:32-46`、`src/components/Sidebar.vue:595-601`
- 现象：该设置弹窗（开关节日氛围、生日、开始使用日期、公历纪念日、农历纪念日、祝福语语言）
  在整个应用里**没有被任何地方 import 或挂载**，用户无法打开它。它带 `sl_festive_birthday_full`、
  `sl_festive_lunar` 两个新键的完整读写逻辑，以及 `narrativeLang`（祝福语语言）的唯一修改入口，
  全部处于「代码存在、界面不可达」状态。
- 证据：
  - 全 `src/` 搜 `FestiveSettings` 只命中该文件自身的模板类名与样式类名（`:240`、`:389`），没有任何 import。
  - `Sidebar.vue:32-46` 的懒加载设置面板清单是 AccountPanel / DataManager / VersionUpdateModal /
    AppearanceSettings / QuickRecordSettings / FocusSettings / SearchPanel —— 没有它。
  - `Sidebar.vue:595-601` 实际挂载的 7 个浮层里也没有它。
  - 路由层 `src/router/routePreload.js:3-12` 的 10 条路由同样没有设置页，只有测试直接 import：
    `tests/festiveLunarAnniversaryUi.test.js:18`、`tests/narrativeI18n.test.js:20`。
  - `src/composables/appearance.js`/`Sidebar.vue` 里也不存在「名字 → 组件」的动态映射，
    所以不存在被变量名绕过的可能。
  - 该面板的文案曾被当作「用户看到的开关文案」引用（`docs/archive/UX_AUDIT_176_REPORT.md:2734`），
    说明这一轮之后入口丢失或从未接上。
- 建议修法：在 `Sidebar.vue` 按 `AppearanceSettings` 的既有模式补一条懒加载 + `v-if` 挂载
  （同一个 `data-item` 区，或放进外观弹窗里作为新分区并同步 `modalSections.js` 的语义），
  并补一条守卫：**每个 `src/components/*Settings.vue` 必须被某个组件/路由 import**（否则报红）。

### [P1] 作息「恢复默认」无二次确认、直接改正式数据，且界面上没有任何变化

- 位置：`src/components/schedule/TimeSettingsModal.vue:129-132`（处理器）、`:307`（工具条按钮）、`:491`（草稿条按钮）；`src/composables/store/timeConfig.js:345-362`；`src/composables/timePlanDraft.js:71-81`、`:188-202`
- 现象：点「↺ 恢复默认」/「恢复默认时间」后**不弹确认框**，直接调用 `resetTimesToDefault()`，
  把**所有作息季 × 所有校区**的时间整体替换为内置默认值。而弹窗里的时间列表渲染的是**草稿**
  （`planSections` 读 `draft`），草稿不会被重新加载，所以：用户点下去**看不到任何变化**、
  `draftDirty` 也不会变，直到关闭再打开弹窗才会看到数据已被清空。同一张弹窗的提示文字却写着
  「修改需点击保存才会生效」（`:121`），草稿条在非脏态还把「保存」换成「恢复默认时间」（`:491`），
  两者互相矛盾。该操作没有撤销入口（撤销只覆盖导入，见 `:311-314` 的导入结果横幅）。
- 证据：
  - `TimeSettingsModal.vue:129-132`：`function onResetTimes() { settingError.value=''; resetTimesToDefault() }`
    —— 没有 `ConfirmDialog`、没有 `loadPlanDraft`、没有成功提示。
  - `timeConfig.js:345-362`：`const times = {}` + 双层 `for (season) for (campus)` 全量重建 `cfg.times = times`。
  - `timePlanDraft.js:74-78`：`loadPlanDraft` 会把 `timeConfig.value.times[season][campus]` 拷进 `draft`；
    而 `onResetTimes` 不调用它 —— 界面因此停留在旧值。
  - `timePlanDraft.js:188-202`：`planSections` 的每一行 `{ period, index, ...draft.value[i] }`，数据源确实是 `draft`。
  - 按钮与「＋ 新建 / 导入」「⧉ 复制已有方案」「± 批量调整」同排相邻（`:303-308`），误触成本高。
  - 本仓已有的正确对照：同一弹窗的「放弃未保存的修改」用 `ConfirmDialog`（`:510-519`），
    外观设置的三个破坏性操作也都有确认框（`AppearanceSettings.vue:555-583`）。
- 建议修法：接 `ConfirmDialog`，文案写明「会把**所有校区 × 作息季**的时间恢复为内置默认值，
  当前未保存的修改也会丢失」，确认后执行 `resetTimesToDefault()` + `loadPlanDraft(...)` + `showToast`，
  让界面立刻反映结果；或明确把它改成「把当前草稿重置为默认值」，不写正式数据。

### [P1] 纪念日缺日期（农历缺名称）会被静默丢弃，而面板承诺「修改即时自动保存」

- 位置：`src/components/FestiveSettings.vue:101-114`（新增/改日期）、`:297-303`（名称输入 `@input="commit"`）、`:380`（`.saved-hint`）；`src/composables/festive.js:82-87`；`src/composables/lunarAnniversaries.js:169-178`
- 现象：点「＋ 添加纪念日」新增一行后**只填名称、没选日期**时：
  - 行留在界面上（`anniversaries` 是独立 ref，`commit()` 不会回读它），
  - 但 `commit()` 写回的 `festiveConfig` 被 `normalizeFestiveConfig` 过滤掉这一行（日期非法），
  - 面板底部始终显示「✓ 修改即时自动保存」，
  - 关闭再打开（或刷新）后 `syncFromConfig()` 重读配置，**这一行消失，用户输入的名称丢失**。
  农历分区同理：`normalizeLunarAnniversary` 会丢弃**名称为空**的条目，而只有名称为空的行才是
  「刚新建、还没起名」的常态，用户先改月份/日期再改名时，中间那一步是不落盘的。
- 证据：
  - 运行 `normalizeFestiveConfig({ enabled:true, birthday:'08-08', anniversaries:[{date:'',label:'在一起'},{date:'02-14',label:'在一起'}] })`
    实测结果 `anniversaries = [{"date":"02-14","label":"在一起"}]` —— 无日期的行被丢弃。
  - `festive.js:84-86`：`.filter((item) => item && isRealMonthDay(String(item.date ?? '')))` → `.filter((item) => item.label)`。
  - `FestiveSettings.vue:109-114` `setAnniversaryDate` 与 `:302` 名称 `@input="commit"` 都会走 `commit()`（`:92-99`）。
  - `FestiveSettings.vue:233` 打开时 `syncFromConfig()` → `:67` `anniversaries.value = toRows(cfg.anniversaries)`。
  - `lunarAnniversaries.js:169-171` 的注释明说「标签为空的条目不写入存储」，但面板并没有把这条口径告诉用户，
    反而用 `:380` 的 `saved-hint` 统一承诺即时保存；`:314` 的分区提示只讲「按农历月日每年重复」，没讲必填。
  - 面板没有逐行校验提示（对比农历行的 `lunarResolveText` 会给明确状态，公历行没有等价物）。
- 建议修法：二选一——(a) 让 `commit()` 保留未填日期的行（在归一化前补一个「草稿行」口径），
  或 (b) 在行内给出必填提示（缺日期/缺名称时标红并说明「未填写日期，不会保存」），
  并在 `.saved-hint` 上区分「已保存 / 有未保存内容」。
- 附注：该问题当前被 P0 挡住（面板不可达），入口一接通即成为用户可见的数据丢失，故仍按 P1 记录。

### [P2] 「恢复初始外观」确认框漏说「主题色会被重置」

- 位置：`src/components/AppearanceSettings.vue:575-583`（确认框文案）、`:456-457`（按钮旁的说明）、`:303-322`（实际动作）
- 现象：确认框写「本机壁纸、励志语、首页排序、页面皮肤和滑动操作都会重置」，
  但 `confirmResetAllAppearance()` 还会把 `themeKey` 改回 `'blue'`、`autoWallpaperColor` 关掉、
  `wallpaperAccent` 改回 `#456fe8`（`:310-312`）。**同一屏**的按钮说明却写着
  「重置壁纸、主题色、励志语……等所有个性化设置」（`:457`）——两处文案对同一动作的说法不一致，
  而用户按下的那一刻看到的是确认框那一份（少说了主题色）。用户会丢掉自己挑的主题色而没有被告知。
- 证据：`:579` 的 `message` 字符串不含「主题」；`:457` 的 `.action-hint` 含「主题色」；
  `:312` `themeKey.value = 'blue'`；`theme.js:14` `themeKey` 是 `sl_theme` 键；`:311` `wallpaperAccent.value = '#456fe8'`。
- 建议修法：确认框文案与 `:457` 对齐（补「主题色与壁纸取色」），或把 `themeKey` 的重置从该动作里摘出去。

### [P2] 作息弹窗的成功提示不是实时区域，读屏用户听不到「已保存」

- 位置：`src/components/schedule/TimeSettingsModal.vue:246-248`
- 现象：`timeSettingsShared.js` 的 `showToast()` 共 6 处调用（保存草稿 `timePlanDraft.js:171`、
  复制方案 `timePlanTools.js:83`、导入与撤销 `timeImportPlan.js:140`/`:156`、放弃识别 `recognitionSchemes.js:65`、
  粘贴识别完成 `TimeSettingsModal.vue:194`），它们渲染成的 `<p class="settings-toast">✓ …</p>` **没有
  `role="status"`，也没有 `aria-live`**。它是 `v-if` 插入/移除的节点，读屏不会播报，
  而 3.2 秒后自动消失（`timeSettingsShared.js:27`）——视觉用户看到绿条，读屏用户以为点击没反应。
- 证据：
  - `TimeSettingsModal.vue:246-248`：`<Transition name="toast"><p v-if="settingsToast" class="settings-toast">✓ {{ settingsToast }}</p></Transition>`。
  - 同仓库的既定分工写得很清楚：`AppearanceSettings.vue:538-540` 的注释「成功用 `role="status"`（礼貌播报），
    失败才用 `role="alert"`」并已实现；`errorAnnouncement.test.js:60-70` 的判据是「成功提示必须 `role="status"`」。
  - 但该守卫的成功类名集合是 `['success','notice-success']`（`tests/errorAnnouncement.test.js:36-38`），
    `settings-toast` 不在其中，所以这条**没有被守卫覆盖**（属于判据的类名集合与仓库脱节）。
  - 同弹窗的错误提示反而是合规的：`TimeSettingsModal.vue:245` 有 `role="alert"`；
    `TimeBaseSettings.vue:209` 的生效日期冲突提示也有 `role="alert"`。
- 建议修法：给该 `<p>` 加 `role="status"`；并把 `settings-toast` / `saved-hint` 一类类名并入
  `errorAnnouncement.test.js` 的成功类名集合（或改成通用钩子），否则同类漏接还会再发生。

### [P2] 反馈提示不随内容滚动：作息弹窗的错误与外观弹窗的成功消息都在视野之外

- 位置：`src/components/schedule/TimeSettingsModal.vue:244-248`（`settingError` / `settingsToast`）、`:580-593`（`.settings-toast` 的 sticky）、`:747-764`（`.draft-bar.sticky`）；`src/components/AppearanceSettings.vue:540`
- 现象：
  - 作息弹窗里**成功**提示是 `position: sticky; top: 0; z-index: 3`，**错误**提示（`settingError`，
    基础设置区的校区/作息季/节次校验失败都会写它）**没有 sticky**，位置固定在弹窗内容顶部。
    而 `.modal-body` 是独立滚动容器（`Modal.vue:440-446`）。基础设置是三个长列表
    （校区 / 作息季 / 节次），用户在「节次」区底部点「＋ 添加」时名称留空，错误出现在**已经滚出视野的上方**，
    屏幕上表现为「点了没反应」（读屏能听到 `role="alert"`，视觉用户看不到）。
  - 外观弹窗的成功/错误消息在 `:540`，位于**所有分区的最后**。壁纸分区的「上传照片」在分区顶部（`:435-442`），
    上传完成的消息出现在预览、滑杆、一键恢复按钮**之下**，需要滚动才看得到。
- 证据：
  - `TimeSettingsModal.vue:580-583` `.settings-toast { position: sticky; top: 0; z-index: 3; }` 对比 `:245`
    `<p v-if="settingError" class="error" role="alert">` 无任何定位。
  - `tests/focusObscured.test.js:145` 已把 `.settings-toast` 登记为「sticky 面」，同一份登记里没有 `settingError`。
  - `Modal.vue:440-442` `.modal-body { min-height: 0; overflow-y: auto; }`。
  - `TimeSettingsModal.vue:754-764` 底部草稿条自己做了 `position: sticky; bottom: 0` —— 说明「关键反馈要吸边」
    这条做法在本文件里是清楚的，只是没套用到错误提示上。
- 建议修法：给 `settingError` 同样的 sticky 处理（或把区块级错误下移到触发它的那一组旁边）；
  外观弹窗的消息改到 `.modal-body` 顶部 sticky，或按分区就近显示。

### [P2] 清空校区 / 作息季 / 节次名称后，输入框显示为空但数据没变，也没有任何提示

- 位置：`src/components/schedule/TimeBaseSettings.vue:184-189`、`:213-219`、`:264-269`；`src/composables/store/timeConfig.js:258-261`、`:300-305`、`:325-328`
- 现象：这三个名称输入用 `:value="…"` + `@change` 提交。把名字删空并失焦时，`renameCampus` /
  `renameSeason` / `renamePeriod` 都**忽略空名称**（不写数据），但 DOM 里的输入框**保持为空**
  （绑定的数据没变 → Vue 不会把它写回），也不报错。用户以为改名成功了，实际数据未变，
  下次打开弹窗又变回原名——「改了却没生效，且毫无提示」。
- 证据：
  - `TimeBaseSettings.vue:188` `@change="renameCampus(campus.id, $event.target.value)"`；
    `timeConfig.js:260` `if (campus && name.trim()) campus.name = name.trim()` —— 空值直接 return，无返回值也无错误。
  - 同一文件里**已经有正确处理这个问题的先例**：生效日期字段在格式非法时显式回写 DOM
    （`TimeBaseSettings.vue:130` `if (input) input.value = season.startDate || ''`），
    并且 `:222`/`:343-346` 还有 `invalid` 视觉态；名称字段没有等价处理。
  - 新增名称用的是 `v-model`（`:199`、`:252`、`:283`），是受控的 —— 说明差异只在编辑既有项这条路径。
- 建议修法：`@change` 处理函数在拒绝时把 `$event.target.value` 回写为 `campus.name`（照抄日期字段的写法），
  并给出提示（「名称不能为空，已恢复原值」）；或把既有项也改成 `v-model` + 校验回调。

### [P2] 壁纸目标列表 / 模式切换的选中态只存在于 class，读屏听不出选的是哪个

- 位置：`src/components/AppearanceSettings.vue:427`（目标列表）、`:429`（跟随全站 / 单独设置 / 此页关闭）
- 现象：`<aside class="target-list">` 的 7 个页面按钮与 `.mode-row` 的 3 个模式按钮，
  选中态只有 `:class="{ on: … }"`，**没有 `aria-pressed` / `aria-selected` / `aria-current`** 任何一个。
  读屏用户无法知道「现在正在编辑哪一页的壁纸」「当前是跟随全站还是单独设置」。
  同一弹窗的主题色格（`:397` `:aria-pressed="themeKey === key"`）和皮肤单选（`:423` 用 `type="radio"`）
  都正确暴露了状态，属**文件内部不一致**。
- 证据：
  - `:427`：`<button v-for="(target, key) in WALLPAPER_TARGETS" :key="key" :class="{ on: selectedTarget === key }" @click="chooseTarget(key)">{{ target.label }}</button>`
  - `:429`：`<div v-if="!isGlobal" class="mode-row"><button :class="{ on: targetConfig.mode === 'inherit' }" …>`
  - 本仓自己定义过这条判据：`docs/archive/UX_AUDIT_176_REPORT.md:1403-1405`「若用 class 标记选中态
    （`on`/`active`/`selected`/`checked`/`current`）却没有 `aria-pressed`/`aria-checked`/`aria-selected`/`aria-current`
    中任何一个，就是『选中态只存在于视觉里』」；第二十六/二十八轮据此修过侧栏主题点与 6 组筛选控件。
  - 现有守卫拦不到它：`tests/tabOrderAndNames.test.js` 的定位是「挂载外壳走真实路由的 10 个页面」（见
    `docs/archive/UX_AUDIT_176_REPORT.md:3435`），**弹窗内部不在其内**（该测试文件里搜不到 `Appearance`/`Modal`）。
- 建议修法：两组补 `role="group"` + `aria-label` + `:aria-pressed`（与 `AppearanceSettings.vue:397`
  及仓库既有写法一致：`role="group" aria-label="壁纸目标" :aria-pressed="selectedTarget === key"`）。

### [P2] 专注设置：通知权限失败时其余修改不保存，但文案读起来像已生效

- 位置：`src/components/FocusSettings.vue:52-74`、`:75-83`
- 现象：点「保存设置」时，若勾了「系统通知」而权限不可得（浏览器不支持 / 用户拒绝 / 请求抛异常），
  代码把 `draft.systemNotificationEnabled` 置 false、写一条错误并 **`return`**——
  **`settings.value` 没有被写入**。也就是说：用户同时改过的 4 个快捷时间、每组轮数、声音/震动全部没保存，
  而错误文案是「当前浏览器不支持系统通知，**已关闭该选项**；声音和震动仍可使用」，
  读起来像「设置已应用、只是通知关了」。用户此时关闭弹窗，所有修改静默丢失。
- 证据：
  - `:52-57`：`if (!('Notification' in window)) { draft.value.systemNotificationEnabled = false; error.value = '当前浏览器不支持系统通知，已关闭该选项；声音和震动仍可使用'; return }`
  - `:62-67`（权限被拒）、`:69-72`（请求抛异常）同样是 `return`，落库语句 `:75-82` 在其后。
  - 勾选框自己的说明写的是「需要浏览器通知权限；**未授权时自动跳过**」（`:116`）——「跳过」暗示其余设置照常保存，
    而实现是**整次保存中止**，文案与行为相反（`modal-focus-settings.png` 真机渲染可见该行文案）。
  - 弹窗里没有任何「还有未保存的修改，请再次点击保存」的提示（错误文案里也没有）。
- 建议修法：文案补一句「其他修改尚未保存，请再点一次『保存设置』」，或把「通知不可用」做成
  非阻塞项（关掉开关后继续保存其余字段，再单独提示通知已关闭）。

### [P2] 专注设置的校验错误没有接到字段上，且修正后不会消失

- 位置：`src/components/FocusSettings.vue:38-51`、`:94-99`、`:105-106`、`:119`
- 现象：轮数、快捷时间的校验失败只写一条 `error`（`:119`，`role="alert"`，能播报），但
  - 出错字段没有 `aria-invalid`，也没有 `aria-describedby` 指向错误文案；
  - 焦点不移动到出错字段（停在「保存设置」按钮上）；
  - 错误与字段之间没有程序化关联，4 个快捷时间输入框长得一样，读屏用户听到「4 个常用时间不能重复」
    也不知道该改哪一个；
  - `error` 只在弹窗重新打开时清空（`:32`），用户把值改对之后红字仍在，直到再次点保存。
  - 这是本仓库**自己定过标准**的一类接线：`tests/formValidationA11y.test.js:10-19` 明确要求
    「标记字段无效 + `aria-describedby` 关联 + 焦点回到出错字段」三条，并在
    `EventsView` / `LedgerView` / `NotesView` 上落实、由守卫看住——但该测试只覆盖那三个视图，
    **专注设置、快速记录设置都不在其中**。
- 证据：
  - `:96` `<input v-model.number="draft.quickTimes[index]" type="number" min="5" max="180" …>` —— 无 `aria-invalid`/`aria-describedby`；
    `:106` 轮数输入同理（它靠 `<label for="focus-rounds">` 有名称，但同样没有错误关联）。
  - `:119` `<p v-if="error" class="error" role="alert">{{ error }}</p>` 是唯一出口，位置在全部控件之后。
  - `tests/formValidationA11y.test.js:91-150` 的三条用例只针对 `EventsView` / `LedgerView` / `NotesView`。
- 建议修法：按 `EventsView` 的既有写法接线（`:aria-invalid`、`:aria-describedby`，
  保存失败时 `focus()` 到首个出错字段），并在字段变化时清掉 `error`。

### [P2] 快速记录设置既没有保存按钮，也没有「已生效」提示

- 位置：`src/components/QuickRecordSettings.vue:8-18`、`:22-35`
- 现象：该面板 6 项设置（剪贴板提示、时区、默认账户、三个提醒分钟数）全部**即时写盘**，
  但界面上**既没有保存按钮，也没有任何「修改已自动保存」的提示**。用户改完不知道是否生效，
  会去找保存按钮 / 反复点开关。而同一区域的其它设置面板各有明确做法：
  专注设置与作息草稿是按钮式保存（`FocusSettings.vue:120-123`、`TimeSettingsModal.vue:488-494`），
  节日设置与本地迁移写「✓ 修改即时自动保存」（`FestiveSettings.vue:380`）。
  这是本区域「两种模式混用」最典型的一处：用户在同一个侧栏里点开不同设置面板，
  遇到的行为互不相同且没有任何提示区分。
  另外提醒分钟数是**逐键落盘**（`v-model.number` + computed setter → `updateSettings`），
  输入「1440」的过程中会依次写入 1 / 14 / 144 / 1440，清空输入框会被当成 0（= 到点才提醒），
  全程没有任何提示或校验反馈。
- 证据：
  - `:8-10` `updateSettings` 直接 `settings.value = { ...settings.value, ...patch }`；`:14-18` 四个 computed 的 setter 都走它。
  - 模板 `:22-35` 只有 `<label>` 与 `<select>` / `<input>`，没有任何按钮或状态文字；
    `<p class="hint">` 讲的是通知权限与全局入口，不是「已保存」。
  - `:12` `Math.max(0, Number(value) || 0)` —— 空值被静默转成 0。
  - 对照：`tests/accessibleNames.test.js` / `formValidationA11y.test.js` / `errorAnnouncement.test.js`
    都不覆盖本组件（`grep QuickRecordSettings tests/` 无结果），所以这条既没有接线也没有守卫。
- 建议修法：给面板加一行与节日设置同款的状态提示（例如「✓ 修改已自动保存」，
  并在空值时回填默认值而不是静默变成 0），或在底部加「保存」按钮并改为草稿式；
  两种模式任选，但要在面板内说明清楚。

### [P2] 外观设置：励志语改了不点「保存文字」就关闭，会被无提示地丢弃

- 位置：`src/components/AppearanceSettings.vue:103`、`:121-131`、`:465-471`、`:393`
- 现象：「今天页文字」分区里，`showQuote` / 显示方式 / 固定条 / 个人签名都是即时生效，
  只有励志语多行文本需要点「保存文字」（`:470`）。而 `quoteDraft` 是个纯本地草稿（`:103`），
  打开弹窗时会被存储值**重新覆盖**（`:128` `quoteDraft.value = appearance.value.quotes.join('\n')`），
  关闭路径 `@close="emit('close')"`（`:393`）**没有任何未保存守卫**。用户改完文字直接按 Esc/✕，
  这段输入不会保存，也没有「有未保存内容」的提示——下次打开/刷新后内容回到旧值。
  同仓库的作息弹窗对同一情形有完整守卫（`TimeSettingsModal.vue:510-519` + `timePlanDraft.js:182-185`
  的「放弃未保存的修改」确认框），外观设置缺这一层。
- 证据：
  - `:121-131` 的 watcher 在每次打开时把 `quoteDraft` 重置为存储值；`:375-381` `saveQuotes()` 是唯一写回路径。
  - `:467` `<textarea v-model="quoteDraft" rows="9" …>` 与 `:470` `<button class="btn btn-primary" @click="saveQuotes">保存文字</button>`。
  - `:393` `<Modal :open="open" … @close="emit('close')">` —— 直接关闭，无脏检查；
    `Sidebar.vue:598` 用 `v-if` 挂载，关闭即销毁，草稿必丢。
  - 同分区里 `:466`、`:468`、`:469` 三项是即时写 `appearance.value` 的，用户无法从界面上分辨哪种要保存。
- 建议修法：给 `quoteDraft` 加脏标记 + 关闭前确认（照抄作息弹窗的 `ConfirmDialog` 做法），
  或改成即时保存（`@input` 防抖写回 `appearance.value.quotes`）并去掉「保存文字」按钮。

### [P2] 壁纸存储的失败路径：要么静默降级，要么把浏览器的英文报错直接显示出来

- 位置：`src/components/AppearanceSettings.vue:211-231`、`:244-270`、`:335-345`、`:351-362`、`:432`、`:441`；`src/composables/wallpaperStorage.js:11-21`、`:47-55`、`:57-65`、`:67-75`
- 现象：需求要求「上传失败 / 存储配额满 / 不支持的浏览器 API」都有明确提示，现状是四种失败各不相同：
  1. **读取失败静默降级**：`loadPreview()` 的 `catch` 什么都不提示，把预览清空并把 `hasOwnImage` 置 false
     （`:223-230`），预览卡片于是显示「尚未选择图片」（`:432`），同时「删除壁纸」按钮因 `v-if="hasOwnImage"`（`:441`）**消失**。
     IndexedDB 读失败（或 API 不可用）时，用户会以为壁纸没了、也失去了删除入口。
  2. **上传失败显示英文原文**：`error.value = reason.message`（`:265`）。
     `setWallpaper` 的失败来自 `request.error`（`wallpaperStorage.js:50`），是浏览器的 `DOMException`，
     `.message` 形如 `The quota has been exceeded.` —— 中文界面里出现英文配额报错，且没有「清理壁纸/换个更小的图」这类指引。
  3. **删除/一键恢复失败完全静默**：`confirmRemoveImage`（`:335-345`）与 `confirmResetAllWallpapers`
     （`:351-362`）**没有 `catch`**。确认框已经关闭，一旦底层 reject（IndexedDB 不可用、事务中止），
     界面既不显示成功也不显示失败，用户只会看到壁纸还在（或没变），无任何线索。同一动作组里
     `confirmResetAllAppearance`（`:303-322`）是有 `catch` + 中文提示的，属文件内部不一致。
  4. **无 IndexedDB 特性检测**：`wallpaperStorage.js:13` 直接 `indexedDB.open(...)`。
     在不提供该 API 的环境里 `indexedDB` 未定义 → Promise 执行器抛 `ReferenceError` → 上传报错文案
     是 `indexedDB is not defined`（英文），预览则如前一条静默。
     上传按钮在这类环境下始终可用（`:438`），没有任何前置提示。
- 证据：以上行号逐一对应；`wallpaperStorage.js` 全文件没有把 `DOMException.name`（如 `QuotaExceededError`）
  翻译成用户可读的中文，也没有 `typeof indexedDB === 'undefined'` 之类的判断（全文 316 行无此分支）。
  `compressWallpaper` 反而**有**中文文案（`wallpaperStorage.js:153`「请选择图片文件」、`:174`「当前浏览器无法压缩这张图片」），
  说明中文兜底是既定做法，只是写盘与读盘的失败路径没有覆盖。
- 建议修法：`loadPreview` 的 catch 里给出「读取本机壁纸失败」的状态（不要伪装成「尚未选择图片」）；
  给两个缺少 catch 的确认动作补 `catch` + `settingError` 式提示；
  把 `QuotaExceededError` / `indexedDB` 缺失翻译成中文并给出下一步；上传前做一次能力检测。

---

### [P3] 若干可确认但影响很小的问题

1. **拖拽光晕写死了品牌蓝**：`AppearanceSettings.vue:1040-1042` `.module-row.dragging { border-color: var(--primary); box-shadow: 0 4px 14px #456fe82e }`
   —— 边框跟主题走，光晕固定蓝色，紫色/粉色/自定义主题下拖拽时会出现蓝色投影。
   建议改为 `color-mix(in srgb, var(--primary) 18%, transparent)`（同文件 `:592`、`:687` 已有同款写法）。
   注：该 hex 计入 `tests/ratchetHardcoding.test.js` 的 `styleColors` 总账，不是白名单项。
2. **「流畅优先」的说明与实现不符**：`AppearanceSettings.vue:408` 写「自动会在低性能、**低电量偏好**或
   『减少动态效果』时关闭高成本视觉效果」，而 `performanceMode.js:24-36` 实际判断的是
   `deviceMemory` / `hardwareConcurrency` / `connection.saveData`（省流量）/ iOS / `prefers-reduced-motion`，
   **没有任何电池相关判断**。建议改成「省流量模式」或补上电池判断。
3. **提醒分钟数没有上限**：`QuickRecordSettings.vue:28-30` 只有 `min="0" step="5"`，
   setter（`:12`）只做 `Math.max(0, …)`，输入 100000 也会保存且没有任何提示。
4. **清空励志语后保存会静默恢复默认一条**：`AppearanceSettings.vue:376-380` —— 删空全部内容再点保存，
   会被替换成「今天也要漂亮通关。」并提示「已保存 1 条文字」，用户的「清空」意图被静默推翻。
5. **时间行错误提示的层级/关联**：`TimeSettingsModal.vue:475` 的 `plan-row-error`（逐行标记）
   按既有决定不做实时区域（`tests/errorAnnouncement.test.js:14-18` 有明确理由，**不再报**），
   但它与输入框之间也没有 `aria-describedby`；`:478` 的整段提示同样只在视觉上汇总。
   若要与错误播报口径统一，可在保存时把「存在时间问题」写进 `settingError`（该路径已存在：`timePlanDraft.js:161`）。

---

## 真机渲染事实（Edge 无头，1440×900 / 390×844，浅色默认主题）

截图来自 `D:\study-life\ui-audit\shots\`，由仓库既有的 `ui-audit/audit-ui.mjs` 生成
（本轮读取时脚本正被并发的另一次 `audit-ui.mjs all` 运行重写目录，见最后一条）。

1. **`modal-appearance.png`（1440×900，主题与课表分区）**：「🎨 个性化外观」弹窗，
   `role="tab"` 一行 5 个（主题与课表 / 本地壁纸 / 今天页文字 / 首页布局 / 滑动操作）不换行、无截断；
   主题色 6 格（蓝色选中，跟随系统/自定义为虚线空环）；「流畅优先」「高对比度」两行右侧 select 对齐；
   底部「课表显示」三张皮肤卡在弹窗下缘被裁切 —— 即 `.modal-body` 确实是独立滚动区（`Modal.vue:440-442`），
   与 P2「反馈提示不随内容滚动」的前提一致。
2. **`modal-focus-settings.png`（1440×900）**：「⏱ 专注设置」= h3，分区标题「常用快捷时间 / 番茄轮次 /
   完成提醒」= h4，层级正确；4 个快捷时间输入与「恢复默认 15/25/45/60」、每组轮数、3 个开关、
   底部「取消 / 保存设置」都在同屏且无横向溢出；「系统通知」行可见文案「需要浏览器通知权限；未授权时自动跳过」，
   与上面那条 P2（未授权会中止整次保存）形成文案—行为反差。
3. **`modal-appearance-phone.png`（390×844）**：窄屏下弹窗以底部抽屉出现（0.55 档），
   标题行右侧是「展开 / ✕」；5 个分区标签换成 3 行（2/2/1），**文字完整、无截断**；
   主题色自动变 3 列 × 2 行。**该截图里同时出现「更多功能」面板，是审计脚本的产物、不是缺陷**：
   `audit-ui.mjs:365-371` 在手机场景先 programmatic 点开「更多」再 `document.querySelector('.appearance-item').click()`，
   而真实用户路径走 `openMobileTool('appearance')`，它在打开前会先 `closeMobileMore()`
   （`src/components/Sidebar.vue:386-389`）。请勿据此"修复"侧栏。
4. **`modal-quick-record-settings.png` 未能读取**：读取瞬间该文件已被并发的另一次 `audit-ui.mjs all`
   （进程 `node audit-ui.mjs all`，14:02 起重写 `shots/`）删除，因此「快速记录设置」一节
   **仅有源码证据**（`:22-35` 模板里确实没有保存按钮、没有状态提示，这点不依赖截图）。
5. **指标口径提醒（避免误用 `all-report.json`）**：脚本的 `small`（触控过小）列表**上限 14 项**且按文档顺序扫描，
   四个设置弹窗场景的前 14 项全是页面级元素（侧栏折叠按钮、侧栏主题圆点、首页「查看/完成」链接），
   所以**不能**用它判断弹窗内部的触控尺寸；`modalCount: 2` 表示恰好一个弹窗（`.overlay` + `.modal` 各计 1），
   据此可确认四个场景的弹窗都真的打开了。手机场景 `small` 里出现的 4 个 `13×13` 的 `input`
   是外观弹窗里的 1 个 checkbox + 3 个 radio，它们都被 `<label>` 包裹（点击域是整行），
   且项目明确拒绝按像素推算触控目标（`tests/touchTargetHooks.test.js:5-8`），故不报。

---

## 待确认（未能证实）

1. **深色主题下「主题色」圆的白色描边环**：`AppearanceSettings.vue:667-671`
   `.theme-dot { box-shadow: 0 0 0 2px #fff, 0 0 0 3px var(--border) }`。
   深色主题（`--bg: #121826`）下这圈恒白的 2px 内环与 `--card` 的对比、以及「跟随系统/自定义」两项
   `background: transparent` 时的观感，需要在深色主题下截一张外观弹窗才能判定是不是缺陷。
   现有 `ui-audit` 截图套件只跑浅色默认主题（`audit-ui.mjs` 的 `seedScript` 不写主题键）。
   **需要的证据**：预置 `sl_theme='system'` + `matchMedia('(prefers-color-scheme: dark)')` 的截图（或 CDP
   `Emulation.setEmulatedMedia`）。
2. **手机抽屉 0.55 档的首屏容量**：`modal-appearance-phone.png` 显示首档只露出「5 个分区标签（3 行）+
   主题色前两行」，`主题色第三行 / 流畅优先 / 高对比度 / 课表显示` 需要滚动或点「展开」才能看到。
   功能上没问题（`.modal-body` 可滚、有「展开」按钮），是否要把首档从 0.55 提到 0.62 属于产品取舍，
   需要设计口径才能定；本报告不把它算作缺陷。
3. **`settingsToast` 自动消失（3.2s）对认知障碍用户是否偏短**：`timeSettingsShared.js:27`。
   这与 WCAG 2.2.1 相关但属判断题，需要产品对提示时长的口径。
4. **作息「恢复默认」的产品意图**：它到底是「把当前草稿重置为默认值」还是「把所有方案的数据重置」？
   `timeConfig.js:345-362` 做的是后者，而按钮的位置（草稿条上、非脏态、替代「保存」的位置）
   更像是前者。无论取哪个，当前实现都需要改（见 P1），但改法取决于这个答案。
5. **`AppearanceSettings` 的状态消息跨分区常驻是否会造成误读**：`message`/`error` 只在打开、
   切换目标、上传时清空（`:129-130`、`:235-236`、`:249-250`），切换到别的分区后上一段的
   「已压缩为…」「壁纸已删除」仍留在页脚。属轻微；是否需要「切换分区即清空」需要产品口径。

---

## 已核查确认无问题

以下均逐个读过源码（含附近注释）与相关守卫，**未发现问题**，或确认属于已决策项：

1. **分区持久化语义**（`modalSections.js:1-46`）：模块级 ref、关闭再打开回到上次分区、刷新回默认。
   与 `tests/modalSections.test.js` 的断言（不得重置 `tab.value='theme'`、不得用组件内 ref，见 `:203`、`:209`）
   完全一致，属已决策项，不报。
2. **tab 键盘契约**：`tabKeys.js:27-63` 实现了 roving tabindex（`:36`）、←/→ 环绕（`:44`）、Home/End（`:45-46`）、
   焦点跟随（`:59-60`）与「否决时不移焦点」（`:56`）；三处 tablist 全部接入
   （`AppearanceSettings.vue:84-90`、`TimeSettingsModal.vue:115-119`、`:140-146`），
   且被 `tests/tabKeys.test.js`、`tests/tabPanelSemantics.test.js` 看住。5 个 tab 与 2+2 个 tab 的面板
   都有 `role="tabpanel"` + 静态 `aria-labelledby`（`:394-395`、`:271`、`:483`）。
3. **标题层级**：`Modal.vue:357` 默认渲染 `h3`；`FocusSettings.vue:91/104/113`、
   `TimeBaseSettings.vue:182/206/260`、`FestiveSettings.vue:351` 一律用 `h4`，无跳级、无倒挂
   （`Modal.vue:44-46` 的 `titleLevel` 是给「弹窗内还有 h2 分区」的例外准备的，本区域未用到）。
4. **表单控件程序化名称**：逐个核对——`FocusSettings.vue:94-96`（快捷 N 分钟）、`:105-106`（`for="focus-rounds"`）、
   `QuickRecordSettings.vue:24-30`（label 包裹 + `<b>`/`<small>` 文本）、`TimeBaseSettings.vue:187/199/217/224/252/253/267/283`
   （`aria-label` 全部带中文，含「校区名称：X」这类带当前值的写法）、`FestiveSettings.vue:253/261/272/294/301/322/325/328`
   （`for` 或 `aria-label`）、`TimeSettingsModal.vue:384/388/464/471` 与 `:333/337/340/356`。
   未发现无名称控件。
5. **`env(safe-area-inset-*)`**：本区域的弹窗本体由 `Modal.vue` 统一处理（`:445`、`:449`、`:525`、`:531`），
   `ActionSheet`（外观的换壁纸菜单）也有（`ActionSheet.vue:168`、`:178`），设置组件自身不需要再写。
6. **删除类操作的二次确认接线**：删除壁纸（`:555-563`）、恢复全部壁纸（`:565-573`）、恢复初始外观（`:575-583`）、
   删除校区（`TimeBaseSettings.vue:288-296`）、删除作息季（`:298-306`）、放弃未保存修改（`TimeSettingsModal.vue:510-519`）
   都走 `ConfirmDialog`，`@confirm/@close` 指向本文件声明过的函数，符合 `tests/confirmDialogMigration.test.js`
   的静态对账（`:298-317`）；「无自定义壁纸不弹确认」的短路链（`:324-333`）与注释一致。
7. **`resetWallpapersOnly()` 不动主题色**：`appearance.js:136-139` 只重置 `wallpaperConfig`；
   与 `AppearanceSettings.vue:455` 的说明「仅重置壁纸图片与设置，不影响主题色、励志语等其他个性化」一致，不报。
8. **专注快捷时间默认值**：`FocusSettings.vue:100` 的「恢复默认 15/25/45/60」与
   `focusTimer.js:4` `quickTimes: [15,25,45,60]` 一致，文案没有写错；`normalizeFocusSettings`（`:22-46`）
   对越界/不足 4 项/重复的处理与 `:38-51` 的校验口径一致（不会互相打架）。
9. **`settingsPolicy` 的时区与提醒语义**：`settingsPolicy.js:15-19` 的选项与 `:23-26` 的 `validTimezone`
   白名单一致；「0 = 到点才提醒」与 `:60-69` 的 `defaultReminderMinutes`（空值回退默认、显式 0 才表示到点）一致，
   `QuickRecordSettings.vue:32` 的说明没有落空。
10. **刻意彩色组件**：`.skin-notebook`（牛皮纸 + 楷体 + 写死 `#735f39`）与 `.date-tile` 保持原样，
    未按主题色建议改动；`AppearanceSettings.vue:44-57` 里 success/primary/danger/muted 的写死色
    有逐条注释说明为什么暂时不能迁令牌（阶段7 遗留项），属已决策项。
11. **触控目标尺寸**：按项目口径**不做**「字号 + padding 推算像素高度」的判断
    （`tests/touchTargetHooks.test.js:5-8` 明确拒绝该判据）；本区域内所有可点击元素都是真 `<button>`，
    没有「声明了 `role="button"` 却没接 `btn`/`tap-target`」的漏接（`:177-187` 的全仓扫描为绿）。
12. **存储键与依赖约束**：本次审计未发现新增 `sl_*` 键语义变化（`FestiveSettings.vue:33` 的
    `sl_festive_birthday_full`、`:128` 的 `sl_festive_lunar` 都是既有键，形状与 `normalizeLunarAnniversaries` 一致），
    未发现新增 npm 依赖或外部网络调用，hash 路由方案未被触及。
13. **农历纪念日的 id 稳定性**：`FestiveSettings.vue:132-152` 保留存储中的 id、仅在缺失/重复时补号，
    与注释里「同步/备份按 id 对账」的理由一致，未发现每次打开都换 id 的问题。
14. **窄屏布局**：390×844 真机渲染（`modal-appearance-phone.png`）下，外观弹窗的分区标签换 3 行后
    文字完整、无截断、无横向溢出；主题色网格 3 列；内容滚动全部发生在 `.modal-body` 内部，
    整页没有横向滚动（探针 `overflowX: 0`、`clipped: []`）。`AppearanceSettings.vue:1000-1026` 的窄屏规则
    （分区标签改 2 列、壁纸目标列表改横向滚动、`.control-grid` / `.quote-row` / `.skin-options` 改单列、
    `.upload-row` 改纵排）与渲染结果一致。