# 176 项交互/体验审计落地报告

> **交接入口**：如果你是从别人手里接过这个仓库的，请先读根目录的 **[`../HANDOVER.md`](../HANDOVER.md)**（现状、未完成清单、环境与工具坑、继续工作的流程）。本文档是逐轮的工作记录。

审计范围：176 项，覆盖交互手感、移动端专项、信息架构、数据安全、可访问性、主题与令牌、同步与存储、以及各页面/组件的深度项。

本报告只写**已验证**的结论。所有证据都来自对 `D:\study-life\study-life` 源码的实读与实跑，给出的 `file:line` 是改动前或改动位置。

## 0. 验证状态

```
npm run check      # lint + typecheck + 195 测试文件 / 2047 测试 + vite build  → 全绿（exit 0）
npm run audit:contrast   # 6 套调色板 × 144 组配色 → 全部达 WCAG AA
```

**当前重构快照（2026-10-08）**：`npm run check` 全绿，195 个测试文件 / 2047 项测试通过；生产构建成功。当前版本为 `2026年10月08日-版本1`，源码签名 `e2e6c8c7fc`。下方 170 文件 / 1781 用例为原始审计阶段结束时的历史计数。

- 测试：**170 文件 / 1781 用例通过**（全量复跑无偶发；上一轮曾连跑 3 次确认 112/969 稳定。累计新增 935 条（428 + 第五十二轮的 43 + 第五十三轮的 132 + 第五十四轮的 281 + 第五十四轮补做的 46 + 第五十四轮末（收尾补做）的 5（剥注释器的正反夹具：正则字面量后的注释必须剥掉、逐字复刻的旧实现必须在同一份输入上失败）；第五十四轮新增 19 个测试文件：confirm 迁移、抽屉手势与抽屉、农历核心/纪念日/面板/首页、账本 FX/预算/模板/分摊/回归/DOM、设计令牌导出、浮层分区、聚焦态返回、周年动画、叙事多语言（含语言开关接线）、镜像与存储源一致性；第三十三轮起每轮新增的文件数已逐轮标注）：对比度回归与实色底守卫、近白硬编码底守卫、死样式钩子守卫、浮层堆叠、计算类缺陷、读屏播报、时间戳与闰日、同步通道加固、影子副本耐久性、加载态接线、备份完整性、动效令牌一致性、表单错误接线、表单控件可访问名称棘轮、主题调色板来源锁定与幽灵按钮基础态、键盘可达性守卫、自动同步注册幂等守卫、展开/收起状态守卫、地标角色命名与 skip link 守卫、反馈播报与 ARIA 悬空引用守卫、表格语义守卫、程序化平滑滚动门控守卫、被隐藏的实时区域守卫、aria-hidden 含可聚焦元素守卫、嵌套控件守卫与账单行 DOM 测试、**单一 main 地标守卫与 404 DOM 测试、**浮层 Escape 守卫与 Sidebar 运行时测试、时区策略日期一致性测试、常驻播报通道守卫、App 外壳夹具（渲染 DOM 级断言）、渲染 DOM 级标题顺序守卫与路由表抽取、渲染后 Tab 顺序与可访问名称守卫、**标签页面板语义守卫**）
- 构建：PWA 预缓存产物正常生成
- 发布说明：`release.config.js` 依次新增 `2026年09月19日-版本3`～`-版本8`、`2026年09月20日-版本1`～`-版本51`，签名与源码一致（构建闸门强制）

## 1. 本轮实际改动

### 1.1 修掉的真实缺陷（用户可感知）

| 缺陷 | 证据 | 影响 |
| --- | --- | --- |
| 账本页「撤销」按钮从不渲染 | `LedgerView.vue` 的 `showToast(message, {actionLabel, undoFn,…})` 被 3 处按位置传参（`showToast(msg, () => …)`、`showToast(payload.message, payload.undo, 6000, …)`）→ 解构落回默认值 → `Toast.vue` 的 `v-if="actionLabel"` 恒假 | **删除交易、快速记录保存后的撤销静默失效** |
| 账本页卸载抛错并泄漏监听器 | `onBeforeUnmount` 里 `window.clearTimeout(toastTimer)`，而 `toastTimer` 在本文件从未声明（只存在于 `globalError.js`）→ `ReferenceError` 使紧随其后的两个 `removeEventListener` 永不执行 | 每次离开账本页泄漏 scroll/blur 监听器 |
| 周重复待办生成不可靠 | `taskRecurrence.js` 用 `t${now.getTime()}` 当 id；`commands.js` 先写 `repeatGeneratedAt` 再生成（生成失败则永不重试）；`updateTask` 写 `done:true` 完全绕过重复生成 | 撞 id 导致同步合并互相覆盖；勾选完成为待办不产生下一期 |
| 自定义主题残留上一套主题变量 | `theme.js` 的 custom 分支只 `removeProperty` 5 个变量，具名分支清 16 个 | 从「跟随系统（深色）」切到自定义主题会残留深色底 `#0f1420` 与暗色 `--danger` |
| 浅色强调色配白字读不出来 | 壁纸取色直接作为 `--primary` 实底，白字写死 | 浅黄/米白壁纸下按钮文字几乎不可读 |
| 千分位金额解析错误 | `ledger.js` 的 `parseNatural` 正则不含逗号，惰性前缀退到逗号后 | `午饭 1,234.56` → 名称「午饭 1,」、金额「234.56」 |
| 提醒时间留空被当成「提前 0 分钟」 | `settingsPolicy.js` 的 `Number(null) === 0`、`Number('') === 0` 通过 `>= 0` 校验 | 未填提醒时等于到点才提醒，而不是用设置里的默认值（1440/30/1440） |
| 未绑定云同步的用户断网看到误导提示 | `autoSyncCoordinator.js` 的 offline 事件无条件 `setState('offline')` | 没用云同步的用户会看到「联网后会继续同步」 |
| 账本交易流日期分组行高跳动 | `feedItemHeight` 用构建期位置快照 `item.first`，而 feed 的 key 是 `day:日期`（不含位置） | 新增更近一天时同 key 节点被复用，行高原地跳 14px |
| 减少动效下仍渲染 18 个装饰粒子 | `App.vue` 的装饰层只受 `festiveToday?.decor` 控制 | CSS 只把动画压到 0.01ms，节点仍在 DOM 与合成层里 |
| 侧栏 10px 分组标题对比度 2.60:1 | `Sidebar.vue`、`DataManager.vue` 写死 `#98a1b2` | 白色侧边栏上几乎看不清 |
| **回顾把笔记算到错误日期** | `retrospective.js` 4 处 `String(createdAt).slice(0, 10)` 取的是 **UTC** 日期，而业务的 `date` 字段走 `policyDateKey`（本地/配置时区）；`createdAt` 为毫秒数字时更会得到空串 | UTC+8 的 00:00–08:00 笔记被算进前一天；数字型 createdAt 的笔记**从所有日期里消失** |
| **闰日生日/安装周年整年不命中** | `festive.js` 用 `cfg.birthday === md` 直接比字符串 | `02-29` 在非闰年永不命中，第一周年不显示；下次命中要等到 2028，年数直接变成 4 |
| **账本「常记」权重归零** | `ledger.js` 的 `Date.parse(expense.createdAt)`；`LedgerView.vue` 的重复记账提醒同款写法 | 数字型 createdAt → `NaN` → 最近使用加权失效、重复提醒永不触发 |
| **影子副本写入失败永久丢更新** | `dataVault.js` 先 `pendingMirrorWrites.clear()` 再写；失败只调错误回调，不重排 | 该键的 IndexedDB 安全副本一直停在旧值，要等用户下次恰好再改同一个键才可能被纠正 |
| **备份完整性校验可被绕过** | `DataManager.vue:1116` 只在 `value.checksum` 恰好存在时才校验 | 把 JSON 里的 `checksum` 字段整段删掉，一份被改过的备份就能正常导入 |
| **按钮加载态从未显示过** | `style.css` 定义了 `.btn[aria-busy='true']` 的 spinner 与重复点击拦截，但整个 `src` 没有一处设置过 `aria-busy` | 该规则自始至终未生效；加载中的按钮和普通禁用按钮看起来一样 |
| **抽屉速度判定按个数截断** | `sheetDrag.js` 只保留 6 个采样点、取首尾算速度 | 低帧率设备上窗口跨到数百毫秒把快甩平均成慢速；甩完停住再松手仍被判成甩动，误关抽屉 |
| **长按菜单危险项深色主题不可读** | `ContextMenu.vue` 悬停写死 `#feecec` | 深色主题下浅粉底配亮红字 |

### 1.2 可访问性

- **配色按 AA 全量校准**（详见 `DESIGN_TOKENS.md`）：
  - `--ink-faint` `#7d879e` → `#626d84`（页面底色上 3.36 → 4.70:1）
  - `--danger` `#ef4444` → `#c62828`（3.76 → 5.62:1，文字与实底两个方向同时达标）
  - `--primary` `#456fe8` → `#3d63d8`（实底白字 4.48 → 5.28:1，主色浅底上 4.00 → 4.71:1）
  - 紫 `#8b5cf6` → `#7a37e8`、绿 `#0ea271` → `#0a7a54`、粉 `#ec4899` → `#c02070`
  - 新增 `--on-primary` / `--on-danger`：深色主题的实底是亮色，白字只有 3.17/2.78:1，改用深色文字（6.71/7.44:1）
  - 待办优先级/截止/课程标签的写死色一并达标（`#d43f3f`→`var(--danger)`、`#7b55d4`→`#6a45c4`、`#b86b16`→`#9a560c`）
- **新增 `npm run audit:contrast`**：解析 CSS/JS 调色板 → 计算真实组合的对比度 → 不达标即退出码 1；`--json` / `--all` / `--tokens` 三种输出。`tests/contrastAudit.test.js` 把同一套检查并入测试套件。
- **新增常驻读屏播报区**（`src/composables/liveRegion.js` + `App.vue` 中的 `role="status" aria-live="polite" aria-atomic="true"`）：原来各页面的 `role="status"` 都与文本同时 `v-if` 插入，VoiceOver 对"插入即带内容"的 live region 播报不可靠；现在改为常驻容器只改文本，并接上路由切换播报。路由增加 `meta.title`，标签页标题由「学习生活台 · N 项待办」改为带页面名。
- **标题层级可配置**：`EmptyState` 新增 `level` prop、`Modal` 新增 `titleLevel` prop；8 处页面级空状态改为 `h2`，`TasksView` 列表项 `h3`→`h2`，`NoticeUnderstanding` 弹窗标题显式 `h2`，消除 `h1 → h3` 跳级。
- **新增外观设置「高对比度」开关**：与系统 `prefers-contrast: more` 协同（系统开了就生效，应用内也开了同样生效，显式关闭才压制系统），存储用独立键 `sl_high_contrast`，不触碰 `sl_appearance` 的结构。
- **搜索结果显示关键词高亮**：按切片渲染 `<mark>`，**不使用 `v-html`**——标题来自用户数据，拼 HTML 会引入注入面。

### 1.3 交互与响应

- **底部浮层不再互相压盖**：新增 `src/composables/floatingStack.js`，页面 `Toast`、快速记录提示、全局错误提示共用一套坑位栈，同时出现时依次向上错开（`--stack-offset`），并保留移动端 `86px` 的底部导航避让。
- **浮层焦点查询不再强制样式计算**：`overlayStack.js` 的 `focusableWithin` 改用 `checkVisibility()`，避免每次 Tab 为全部候选元素逐个 `getComputedStyle`。
- **滚动锁记录并还原进入前的内联 `overflow`**：原来无条件写回 `''`，会把锁之前就存在的内联值抹掉；嵌套弹窗按任意顺序关闭都不会出错。
- **主题色 meta 加固**：自定义主题色可能非法或为空，现在统一做 hex 校验并回退默认蓝；`meta[name=theme-color]` 缺失时补建。
- **深色背景提亮** `#0f1420` → `#121826`，卡片 `#181e2e` → `#1b2233`。
- **危险按钮改为主题感知**：`.btn-danger` / `.link-btn.danger:hover` 用 `color-mix` 混出底色，暗色主题不再出现"浅粉底 + 浅红字"。
- **存储事件只处理 localStorage**：`storage` 事件对 `sessionStorage` 也会触发，原来会误取消待写入并覆盖内存值。

### 1.4 时间语义与索引健壮性（第二轮）

- **统一时间戳解析**：新增 `settingsPolicy.timestampOf()` 与 `createdDateKey()`。前者把数字、数字字符串、ISO 字符串统一成毫秒数（空值与垃圾值归零而不是 `NaN`），后者按**应用时区**取日期。5 处读取点（`retrospective.js` × 4、`ledger.js`、`LedgerView.vue`）全部改走它。
- **闰日与死配置**：`festive.js` 新增 `sameMonthDay()`，`02-29` 在非闰年落到 `02-28`，安装周年因此能正确算出「满一年」；`normalizeFestiveConfig` 改用 `isRealMonthDay` / `isRealFullDate` 做真实日历回读校验，`02-31`、`04-31`、`2026-02-29` 这类永远不触发的配置被丢弃。
- **`builtInFestivalTable` 年份兜底**：`anchorYear` 不再用默认参数直接取系统时钟；`Number('') === 0` / `NaN` 过去会得到一张 `-6..6` 的全空表，现在退回当前年。
- **情绪聚合纯增量**：`monthMoodSummary` 新增 `days` / `countsByMood` / `dominantMood` / `unknownMoods`，并新增 `isKnownMood()`。原有五个字段与 `weatherOfMood` 的返回值**完全不变**——返回值直接参与 `counts[...] += 1`，改键名会让计数变 `NaN`。
- **账本索引读取器全函数化**：`ledgerPeriodStatsFromIndex` / `ledgerMonthIncomeFromIndex` / `ledgerWeekTotalFromIndex` / `ledgerMonthCategoryTotalsFromIndex` / `computeFrequentFromIndex` 通过 `indexMap()` 兜底，残缺或未构建的索引返回空统计而不是抛 `TypeError` 打挂整个视图。
- **虚拟列表行高滞回**：采样高度变化小于 4px 时不再写回 `measuredHeight`，切断「改高度 → 根节点位置变 → ResizeObserver 重测 → 再改高度」的抖动回环。

### 1.5 数据安全与同步加固（第二轮）

- **影子副本失败不再丢更新**：`dataVault.js` 失败批次重新排队（不覆盖更新的值），并引入 240ms → 30s 的指数退避——没有退避的话「失败 → 重排 → 立即再试」会变成每 240ms 转一圈的死循环，在隐私模式下持续敲 `openVault` 并刷错误回调。新增 `pagehide` / 页面隐藏时的补写，覆盖「防抖窗口内直接切走」这一场景。
- **跨标签页消息加固**：`broadcast()` 带 `v: 1` 与 `spaceId`，接收侧丢弃版本不符、属于另一个同步空间、`source` 是自己的消息；来自其他标签页的错误文本截断到 200 字符再进 UI。`broadcast()` 现在返回布尔值。
- **`syncNow()` 不再返回假成功**：本标签页不是 leader 又没有可用的 `BroadcastChannel`（隐私模式 / 企业策略禁用）时，请求根本发不出去；原来返回 `true` 会让按钮显示「已同步」而实际零请求。现在返回 `false` 并给出原因。
- **CAS 冲突短退避**：两个标签页同时推送会互相顶掉对方的 CAS，立刻重试往往再次相撞。新增 150–500ms 随机错开；秒级以上的退避仍由外层 `scheduleRetry` 负责，避免手动同步卡住十几秒。
- **备份校验和强制化**：v7+ 的导入必须带校验和（`value.version >= 7 && !checksum` 直接拒绝），v1–v6 的老备份与应急导出照旧可恢复。

### 1.6 加载态与手势手感（第二轮）

- **`aria-busy` 接线**：为快速记录（4 处）、外观设置（2 处）、课表导入冲突（2 处）、同步配对（1 处）的异步按钮补上 `:aria-busy="busy || undefined"`。用 `|| undefined` 而不是直接绑布尔值，是为了让 Vue 在空闲时**移除**该属性——渲染成 `aria-busy="false"` 虽然合法但读屏不会给任何反馈。同时修正 `style.css` 里指向不存在模块 `composables/buttonGuard.js` 的注释（键盘重复提交实际由按钮自身的 `:disabled` 保证）。
- **抽屉速度时间窗口**：`dragVelocity(samples, now)` 只统计最后 100ms 的采样；窗口内只剩一个点时退回倒数第二个点（采样稀疏时宁可略微低估，也不要因 `dt = 0` 把真实甩动判成静止）；新增「最后一次移动后超过 100ms 才松手 = 静止」，避免甩完停住再松手误关抽屉。`Modal.vue` 已传入释放时刻。
- **长按菜单离场过渡**：补 `<Transition name="context-menu">`，向 `transform-origin`（触点方向）收缩淡出；`prefers-reduced-motion` 与「流畅优先」下由 `style.css` 的全局规则压到 0.01ms，等同于直接消失。危险项悬停底色改用 `color-mix(in srgb, var(--danger) 12%, var(--card))`。

### 1.7 动效令牌真正落地（第三轮）

`style.css` 顶部原本就写着「此前各组件硬编码 0.13s~0.3s 与各不相同的缓动，手感不一致」，并定义了 `--dur-*` / `--ease-*`。但迁移只做了一半：**14 个组件里仍有 46 处裸时长与裸缓动**，于是同一类悬停反馈在不同页面分别是 130 / 140 / 150 / 180ms，令牌形同虚设。

- 按 `90ms / 150ms / 220ms / 320ms` 的刻度逐条归位（`0.1s→--dur-instant`、`0.13–0.16s→--dur-fast`、`0.18–0.2s→--dur-base`、`0.3s→--dur-slow`）。
- 原来只写时长、没写缓动的声明补上 `var(--ease-standard)`——否则会退回浏览器默认的 `ease`，而那正是要消除的不一致。
- **不碰的**：循环动画的周期（`skeleton-shimmer 1.5s`、`task-spin 1.1s`、`es-breathe 4.2s`）、一次性注意力脉冲（`focus-target-pulse 2.4s`）、以及 `transition-duration/animation-duration: 0.01ms !important` 这条降级规则。把它们硬塞进 90–320ms 的交互刻度只会更差。
- `SwipeActionItem.vue` 的 `transform 180ms` 保留：它的注释说明该值与 190ms 的收尾清理定时器配对，改一边就必须改另一边，属于局部时序而非交互刻度。
- 新增 `tests/motionTokens.test.js`（4 条断言）：交互声明不得出现 90–400ms 裸时长；CSS 令牌值必须与 `motion.js` 的 JS 常量一致；`DESIGN_TOKENS.md` 里提到的每个 token 必须真实存在。**已用注入违规的方式验证过它会失败**，不是一条永远通过的守卫。

顺带修掉一处我自己引入的文档缺陷：`DESIGN_TOKENS.md` 初稿把令牌名写成了 `--dur-deliberate` 与 `--ease-exit`，而实际是 `--dur-reveal`，且根本没有 exit 缓动。新测试的第 3 条断言正是为这类漂移准备的。

### 1.8 其他清理（第三轮）

- `FocusPanel.vue` 解构了从未使用的 `focusSessions`。
- `voiceInput.js` 的文件头注释说「只用浏览器本地 Web Speech API，不接任何外部服务」，与运行时的 `语音识别需要联网` 提示互相矛盾。两者其实都对，但会被误读成「语音输入可离线用」：应用确实没有自有后端、不带 key、不请求第三方端点，而 Chrome/Edge/Safari 对这个 API 的实现会把音频送到厂商云端识别，所以断网时会以 `network` 错误失败。注释已改写为「无自有后端 ≠ 完全离线可用」，并指向离线场景该走手动输入 / OCR。
- 三处 `<img>` 加了 `decoding="async"`（迁移二维码、同步绑定二维码、课表裁切原图）。**没有加 `loading="lazy"`**：这三张图都是当下就要显示的内容（用户正对着二维码扫、裁切框要立刻读到图），懒加载只会延迟渲染，收益为负；真正该省的是主线程解码。

### 1.9 表单错误终于能被读屏听见（第四轮）

`style.css:182` 定义了 `[aria-invalid='true']` 的无效态样式，注释还写着「同时支持手写类名 / aria-invalid，供自定义校验逻辑复用」——但全仓**没有任何一处设置 `aria-invalid`**，`aria-describedby` 更是零使用。和上一轮的 `aria-busy` 是同一类缺陷：样式钩子写好了，接线从没做。于是校验失败时：

- 输入框不会被标成无效，那条 CSS 从未生效；
- 错误文案只是「恰好出现在附近」，与出错的字段没有程序化关联；
- 焦点停在提交按钮上，读屏用户得自己在表单里找回出错的字段。

三处表单（笔记正文、固定账单 4 个字段、日程内容）都改成一个 `setXxxError(message, field)` 单一入口，保证「错误文案」与「出错字段」两个状态不会各自漂移，并在字段校验失败时把焦点移回该字段。**保存失败（笔记已删除、落盘失败、异常抛出）刻意不带 field**：那是操作失败，不是输入有问题，把输入框标红会误导读屏用户。

新增 `tests/formValidationA11y.test.js`（真实挂载视图 + DOM 断言）：字段被标 `aria-invalid="true"`、`aria-describedby` 指向真实存在的错误段落、`document.activeElement` 回到出错的字段、账本表单填好名称后错误从「名称」正确转移到「金额」。

> **记录一个测试环境的坑**：这个测试最初约一半概率随机失败，现象是「点了保存但没反应」。根因不在产品：`LedgerView.vue:1000` 有 `@click.capture="closeSwipe"`，捕获阶段的 Vue invoker 一定先跑并给事件打上 `e._vts = Date.now()`；按钮自己的 `@click` invoker 随后检查 `if (e._vts <= invoker.attached) return` —— 这条是 Vue 防止同一事件被父子重复处理的正经守卫。测试在按钮挂载的**同一毫秒**内点击，撞上这条守卫的概率就正好是抛硬币（`Date.now()` 只有 1ms 分辨率）。真实用户点击距离元素挂载至少几十毫秒，产品侧不存在这个问题。修法是测试里点击前等 8ms，并把原因写进了注释。

### 1.10 暗色主题下「实色底 + 写死白字」的 15 处（第四轮）

第一轮为暗色主题引入了 `--on-primary` / `--on-danger`（暗色下 `--primary`/`--danger` 本身是亮色，白字只有 3.17:1 / 2.78:1），并在 `tests/contrastAudit.test.js` 里逐个主题断言这两个令牌与各自实底的对比度 ≥ 4.5:1。令牌本身是对的——**问题是没人消费它们**：`--on-danger` 使用次数为 0，`--on-primary` 只有 `.btn-primary` 一处。

于是暗色主题下这些地方是「亮底 + 白字」，几乎读不出来：

- 一键：`.filter-tab.on`、`.seg button.on`（课表两处）、`.tab-btn.on`（两处）、`.today-tag`（两处）、`.file-button`（三处）、`.merge-choice .selected`、`.review-edit-actions button.save`、`.review-action:hover`、`.quick-add-button:hover/.active`、`.task-pill`、`.mic.on`、`.swipe-action` 的 primary/danger 变体。
- 顺带修掉一个独立的 AA 失败：`.swipe-action.success` 的固定绿 `#14966d` 配 12px 白字只有 3.74:1（AA 要求 4.5:1），压深到 `#0f7a58` 得 5.3:1。

真正让这件事收敛的是新增的守卫：`tests/contrastAudit.test.js` 现在会扫描所有 `.css` 与 `.vue` 的 style 块，只要同一条规则里同时出现 `background: var(--primary|--danger)` 与写死的 `#fff` 就报错，并断言两个 on-* 令牌确实被消费（不是只定义不用的死令牌）。这条守卫第一次跑就抓出 **9 处**我单行 grep 漏掉的跨行规则，另有 6 处是同一行写法先被手工找出来的。

### 1.11 暗色主题下的「白块」（第五轮）

暗色主题是真实生效的：`theme.js:145` 直接按 `prefers-color-scheme` 设 `:root[data-theme='dark']`，深色下 `--card` 是 `#1b2233`。但全仓有一批**写死的近白底色**，在深色主题里会变成白块，配上同样跟着主题变浅的文字，几乎读不出来。

先用「同一条规则里既有主题相关文字色、又有硬编码浅底」这个判定条件扫出 **18 处**（`.filter-tab.on`、`.seg button.on`、`.tab-btn.on`、表格 `th`、`.list-tab`、`.cell-chip`、`.summary-chips span` 等），全部改掉；再按同一条件复查，又抓出 7 处（`.due.overdue`、`.cell-chip.clash`、`.batch-mobile-head em` 等）和 2 处渐变（`TimeSettingsModal` 的吸底操作条 `linear-gradient(…, #fff 34%)` 会在深色主题下铺一条白条、`ExamsView` 的置顶卡渐变）。

真正把这类问题收口的是继续扩大判定面：**近白底（原来是一张十六进制清单，#fff / #fafbfd / #f9fafd 等）必须用 `--card` / `--bg-tint` 令牌**。按这条清掉 27 处面板、输入框、弹层、表格与进度条底色。替换在浅色主题下基本无变化（`#fafbfd` 与 `#f9fafd` 差 1/255），**主要改的是深色主题的表现**。

> **修正（第六轮复核后）**：这一段原来写的是「纯近白底（`#fff / #fffafa / #fafbfd / #f9fafd / #eef2fb` 等）」和「替换在浅色主题下等价，只改深色主题」。两句都有错：
> 1. **`#fffafa` 与 `#eef2fb` 从来不在那张清单里**，清单实际是 `#fff|#ffffff|#fafbfd|#f9fafd|#fafafa|#fbfbfb|#f8f9fa`。所以「已覆盖」是假的——`#fffafa` 在 `Toast.vue` 与 `TimeSettingsModal.vue` 各有一处真实命中，`#fdfdff` 在 `ListsView.vue` 有一处，深色下同样是白块却一路放行。这三处已在第六轮修掉，清单式判据也换成了「解析色值后按近中性+高亮度判定」。
> 2. **「浅色主题下等价」对高对比度不成立**：`:root[data-contrast='high']` 与 `@media (prefers-contrast: more)` 都把 `--bg-tint` 改成 `#eef1f7`，所以那些 `#f9fafd → var(--bg-tint)` 的替换在高对比度浅色下会让面**变暗**（Δ 约 (11,9,6)）。这是**高对比度模式想要的效果**（该调色板刻意把中性面拉开），不是回归——但把它说成「等价替换」是错的。另外 `:root[data-contrast='high'][data-theme='dark']` 把 `--bg-tint` 设成了 `#1b2333`，**与 `--card` 同值**，也就是说深色高对比度下 `--bg-tint` 与卡片完全同色、层次消失。这是既有问题，不在本轮改动范围内，已记录在 §4。

刻意保留的「永远浅色」控件（各有理由，且都在守卫的允许清单里）：

- `.switch span` / `.switch-track i`：开关滑块，白滑块配深色轨道是通用约定，跟着主题走反而看不见。
- `.item-check` / `.check`：勾选框的勾是写死白色，未勾选面必须保持浅色。
- 另外**不改**那些「写死深色文字 + 写死浅色底」的自洽组合（如 `.exception-tag` 的 `#b13f3f/#feecec`、`TaskProgress` 的 `#17785c/#eefaf6`、`.skin-notebook` 的牛皮纸底配 `#735f39` 楷体、`.date-tile` 的深蓝字配淡紫底）。它们在两套主题下都读得清；把它们也套上主题令牌，等于把刻意的彩色小标签全部洗成中性色，是审美倒退而不是修复。

### 1.12 触控目标钩子接线 + 死钩子清理（第五轮）

`style.css` 里躺着两个**零使用**的触控目标钩子：`.icon-btn`（桌面 32×32、粗指针放大到 44×44，hover/focus/active 三态齐全）和 `button.tap-target`（给非 `.btn` 按钮的 44px 选择加入）。与此同时，全站那些「只有一个 ✕」的关闭/删除按钮分别是 24 / 26 / 30 / 32px，都拿不到这个放大——弹窗关闭、通知关闭、模板删除、设置行删除在手机上全是小目标。

- 给 6 个一次性出现的按钮补上 `tap-target`：`Modal.vue` 的 `.close`（每个弹窗都有）、`Toast.vue` 的 `.toast-close`（24px，全站最小）、`App.vue` 的两条横幅关闭（26px）、`CourseManagerModal` 的 `.template-delete`、`Sidebar` 「更多功能」的关闭。

> **修正（第六轮复核后）**：① `App.vue` 其实有**三条** `global-error-close` 横幅关闭按钮（`:297` / `:314` / `:341`），只改了两条，第三条「忽略此提示」在粗指针下仍是 26×26——同一处修复做了一半。已在第六轮补上。② 这一节说的「44px 命中区」不准确：`src/style.css` 的粗指针规则只设 `min-height`，**从不设 `min-width`**，所以实际是 24×44 / 26×44 / 30×44 / 32×44。这满足 WCAG 2.5.8（AA 要求 24×24），但达不到 2.5.5（AAA）/ Apple HIG 的 44×44。要真正到 44×44 需要加 `min-width`，而不少这种按钮是绝对定位或挤在 flex 行里，加宽会影响布局，因此本轮**有意不加**，只把说法改正。
- `TimeSettingsModal` 的 `.setting-del` 有 4 个实例，逐个加类不如按类处理，直接把它加进粗指针规则。
- `.icon-btn` 与 `.tap-target` 是两套重叠机制，而后者才真正被用上，于是删掉 `.icon-btn`、它那条粗指针规则，以及 `@media (forced-colors: active)` 里对它的两处引用（改为 `button.tap-target`，强制颜色模式下的边框与焦点环不会因此丢失）。

同一轮还删掉另外三处同类死钩子，并**为这一类缺陷加了守卫**：`.btn.is-loading`（两处，异步按钮全都改用 `:aria-busy` 了）、`input.is-invalid` 系列（程序化校验现在统一走 `aria-invalid='true'`）、`.cvi-auto`（面板级 `content-visibility`；组件当前粒度只到卡片 `.cvi-card`，把 `content-visibility` 铺到含交互行的列表上会影响 `scrollIntoView` 与锚定，收益未实测就不铺开）。新的 `tests/styleHooks.test.js` 断言 `style.css` 里定义的每个工具类都必须在别处被引用，例外清单为空；已用注入 `.zz-dead-hook` 的方式验证过它会失败。

### 1.13 可访问名称、无动作按钮与 closeRatio 死角（第六轮）

本轮用三个并行子代理分工（可访问名称 / 死令牌家族 / 对抗性复核），我自己负责整合与闸门。

**只有符号的按钮没有可访问名称。** 全仓扫出 5 处内容只有一个符号、又没有 `aria-label`/`title` 的按钮：专注面板的自定义时长「＋」、账单页的翻月「‹」「›」、课表页的翻周「‹」「›」。读屏会把这些念成符号本身或干脆只念「按钮」，方向信息完全丢失。全部补上中文 `aria-label`（「自定义专注时长」「上一个月」「下一个月」「上一周」「下一周」），并顺带标记 `tap-target`——它们中 `mn-btn` 只有 32×32，在手机上够不到 44px 命中区。

**数字念不出单位。** 清掉符号类之后还剩两个相邻问题：专注时长芯片的可访问名称是裸数字「25」（读屏不说分钟），账单月历格子的名称是裸日期数字「5」（不知道几月、也听不出这天有没有账）。分别补上「25 分钟」与「9月5日，2 笔账目，合计 ¥…」。月历格子还加了 `aria-pressed` 暴露选中态——选中此前只存在于 `.selected` 这个视觉类里。另外把 `.time-chips` 的 `aria-label` 从无效状态救回来：`aria-label` 加在普通 `div` 上会被忽略，补了 `role="group"` 才真正生效。

**没有动作的按钮。** 课表工具栏的周次标签是一个没有任何 `@click`、也没有 `disabled` 的 `<button>`——它按下去什么都不会发生，却占着一个 Tab 停靠点，读屏还会念「第 5 周 按钮」暗示可以点。全仓扫描确认只有这一处，改成非交互的 `<span>` 并同步 CSS（原来的 `.seg button.wn` 依赖 `.seg button` 提供 flex 项、内边距与字号，改成 span 后必须自带）。顺带加 `aria-live="polite"`：翻周按钮自身内容不变，只有这个标签会变，它是读屏用户唯一能知道「现在第几周」的来源。

**`sheetDrag.js` 的 `closeRatio` 是个死旋钮。** 它一直有 `closeRatio` 参数（默认 0.7）和一段解释它的注释，但**没有任何调用方传过它，也没有任何测试碰过它**——`Modal.vue` 声明了 `sheetDetents` 却没声明 `closeRatio`。现在把它做成 `Modal` 的 prop 并转发，四个用 sheet 的页面目前都刻意保留默认值（把选择权交回调用方，而不是替它们猜一个值）。`tests/modalSheet.test.js` 新增一条**行为**测试：同样的拖拽（400→260）在默认阈值下关闭、在 `closeRatio: 0.5` 下回摘要档；`tests/sheetDrag.test.js` 补了脏阈值与越界阈值的夹取行为。**已用摘掉转发的方式验证过这条测试会失败**。

**顺带修掉子代理测试里的一个解析 bug。** 子代理写的 `tests/accessibleNames.test.js` 用手写引号状态机提取 `<button>` 标签（为了绕开 `:disabled="a >= b"` 里 `>` 截断匹配的坑），但它没有剔除 HTML 注释——我的注释里出现了「button」这个词，扫描器就把注释当成一个真实标签，测试随即误报。已在状态机入口加 `stripComments`，并补了一条注释说明「任何基于源码的结构性断言都必须先剥注释」。

> **记录一次我自己的操作失误**：做「摘掉属性验证测试会失败」的变异测试时，我用 `-replace` 直接改写 `LedgerView.vue`，之后只把备份的**测试文件**复制回去，忘了恢复源文件，导致 `aria-label="上一个月"` 一度真的丢失。发现后立刻补回（两个翻月按钮都已核对）。此后所有变异测试改为「先 `Copy-Item` 备份目标文件 → 变异 → 跑 → `Copy-Item` 还原」，并在收尾时确认无 `.bak` 与临时标记残留。

### 1.14 独立复核找出的错，以及据此修掉的真缺陷（第六轮）

前五轮的所有结论都是我自己写的，**没有第二双眼睛**。第六轮专门起了一个子代理做对抗性复核：只给它我的结论清单，让它自己去读源码、自己重做注入实验，明确要求它找出过度声称与不成立之处。它确实找出了三处**我说错了**的地方（上面两条修正 + §4 的等价性），另外还定位出几个真缺陷。逐个说：

**`var(--success)` 是一个从未定义过的令牌。** `ExamsView.vue` 的 `.review-message`（「已安排 25 分钟复习」的确认提示）写着 `color: var(--success)`，而全仓从来没有定义过 `--success`。按 CSS 规范，`var()` 引用了未定义的属性会让整条声明**失效并回退成继承值**——所以那句提示一直没有变绿，作者的意图是静默失效的。子代理在独立扫描里也把 `--success` 列进了「被 `var()` 读但无定义」的孤儿清单，两条路径互相印证。现在 `--success` / `--warning` 已在 `:root` 与 `:root[data-theme='dark']` 定义，这条提示真正变绿了。

**语义色全站写死，其中三对连浅色主题下都不达 AA。** 修 `--success` 时顺着查出：全仓有 **33 处**语义绿/琥珀色是硬编码的（`#07805d` / `#0d9463` / `#9a6414` / `#17785c` …）。用项目自己的 `contrastRatio` 逐对验算后发现，其中几对**在浅色主题下就已经不达标**：

| 位置 | 配色 | 对比度 | AA |
|---|---|---|---|
| `Toast .toast-success` | `#0d9463` on `#effaf6` | **3.62:1** | ✗ |
| `Toast .toast-warning` | `#9a6414` on `#fef3c7` | **4.48:1** | ✗ |
| `DataManager .btn-push` / `AppearanceSettings` 成功色 | `#07805d` on `#e7f8f1` | **4.49:1** | ✗ |

`npm run audit:contrast` 一直报「全部达标」——因为它只审**调色板之间**的组合，组件里写死的「文字+浅底」它根本看不见。这也解释了为什么这些失败能一直存活。本轮把 `Toast` 三种提示（`--success` / `--warning` / `--danger`，底色改为 `color-mix(in srgb, var(--x) N%, var(--card))`）做成主题相关，对比度变成浅色 4.88 / 5.16 / 4.96:1、深色 6.72 / 6.72 / 5.12:1；并把审计脚本扩到语义色，`npm run audit:contrast` 的覆盖面从 60 组升到 **90 组**。

**三处残留的近白底。** `Toast.vue` 的 `.toast-error`（`#fffafa`）、`TimeSettingsModal.vue` 的 `.plan-item.blocked`（`#e5b4b4` + `#fffafa`，深色下整条目变白块，而兄弟条目用的是 `var(--card)`）、`ListsView.vue` 的 `.list-tab:hover`（`#fdfdff`，浅色下与卡片几乎无差别、等于没有悬停反馈，深色下是白块）。另外 `DataManager` 的 `.sync-status`（`#f5f7fb`）、`.conn-meta-item code`（`rgba(255,255,255,.7)`）、`ImportConflictModal` 的 `.conflict-match`（`rgba(255,255,255,.72)`）、`ListsView` 分段控件的 `#eef1f7` 轨道与半透明白悬停也一并改掉。

**一处组件内的死 CSS。** `ScheduleView.vue` 的 `.setting-del` / `:hover` / `:disabled` 三条规则定义在它的 scoped 样式里，但这个组件的模板**从不渲染这个类**（删除按钮早已搬进 `TimeSettingsModal`，由后者自己的 scoped 样式负责）。已删除并留了解释性注释。这类「组件内死类」现有的 `tests/styleHooks.test.js` 覆盖不到——它只查 `style.css` 里定义的类。

**守卫的判定力现在是有证据的。** 近白底那条守卫从「十六进制清单」重写成「解析色值（hex 3/4/6/8 位、`rgb()`、`white` 关键字）后按近中性（通道极差 ≤ 6）+ 高亮度（相对亮度 > 0.85）判定」，并剥掉 `var()` 里的兜底值、忽略全透明色。实测注入六个探针：`#fffafa` / `rgb(255,255,255)` / `white` / `#ffffffff` **全部被抓住**，而 `var(--bg, #f6f7fb)`（兜底值）与 `rgba(255,255,255,0)`（全透明渐变端）**正确放过**。审计脚本也用注入实验验过：把浅色 `--success` 改成过亮的 `#8fd9bf`，`npm run audit:contrast` 立刻报 10 组失败（退出码 1），改回后 90 组全绿。

**已知仍未覆盖的假阴性（复核结论，诚实记录）。** 本轮的守卫加固只关掉了「清单不全」这一类，下面这些**仍然抓不到**，不要误以为已经万无一失：跨规则的「父规则给底、子规则给字」；`background-image`（白色渐变）；`color-mix()` 里包着的 `var(--primary)`（守卫要求它紧贴 `background:`）；模板内联 `style="background:#fff"`（采集器只读 `<style>` 块）；`color: var(--muted)` 这类非语义文字色配近白底；以及 `transition-duration: 0.25s` 这种长写属性绕过动效令牌守卫（现有正则显式排除了 `-duration`）。另外守卫 (b) 的 0.6 亮度阈值是任意取的，不是可读性判据。

**两条「为了满足守卫而改代码」的记录，需要你知道。** ① 子代理在处理 `--dur-reveal` 时无法删除它（`tests/motionTokens.test.js` 断言它必须存在且等于 `MOTION.reveal`），于是给 `style.css` 新增了 `::view-transition-group(root) { animation-duration: var(--dur-reveal) }` 来制造一个真实消费者。这是一个**真实的行为改动**（该伪元素的 UA 默认是 250ms）：在支持 `transition.ready` 的浏览器里总时长不变（JS 的 WAAPI 本来就跑 420ms），但在不支持的环境里圆形扩散会从 250ms 变成 420ms。它没有破坏任何测试，方向也不荒谬，但「守卫驱动产品行为」这件事本身值得警惕。② `--atmosphere-decor` 被 `festive.js` 写入却从没有任何 `var()` 读取它（实际用的是 `[data-decor='snow']` 属性选择器），是死令牌，但定义在守卫范围之外，本轮未处理。

### 1.15 表单控件与可见标签的关联，以及「只有颜色没有名字」的色块按钮（第七轮）

**问题**：项目里大量使用这种写法——

```html
<div>
  <label>目标日期 *</label>
  <input v-model="form.date" type="date" />
</div>
```

`<label>` 既没有 `for`、也没包住控件，于是**标签与控件没有任何程序化关联**。两个后果都是真实可感知的：读屏用户聚焦控件时只听到「编辑框」，不知道它是「目标日期」还是「具体时间」（`<select>` 最严重，选项读出来也没有上下文）；手机上**点标签文字不会聚焦控件**，必须精准点到输入框本身。

**规模**：用引号感知的扫描器（能正确跳过字符串里的尖括号，并用真正的 `<label>` 区间包含判断，而不是「附近有没有 label」这种近似）在 `src/` 里扫出 **221 个表单控件，其中 78 个没有任何程序化关联**——39 个连兜底名称都没有（`<select>`、`type="date"`、`type="time"`、`type="range"` 连 placeholder 都写不了），以及 39 个只有 `placeholder` 兜底（placeholder 在输入后即消失，且对比度通常偏弱）。扫描器本身做过判定力验证：把一个控件的 `<label>` 包裹拆掉后必须能抓到它（实测命中数从 0 跳到 79），否则「0 findings」毫无意义。

**修法**：**只用 `id` + `for`，不动 DOM 结构**。把控件包进 `<label>` 是更短的写法，但这些控件的布局靠 `.form-row label` / `.form-row input` 这类选择器与 flex/grid 子项关系撑着，包一层会让 `label` 变成真正的布局盒子、控件继承 label 的字号与颜色，视觉回归风险大且需要真机验证；`id`/`for` 只加属性，零布局影响，同时把「点标签聚焦控件」一并修好。没有 `<label>` 元素的少数几处（只有 placeholder 的行内输入框、旁边是 `<span>` 且样式精确挂在 `.fact-editor span` 上的编辑框）用 `aria-label`，文案与可见文字一致。

**已完成**：`ExamsView` 8 处、`TasksView` 8 处、`ListsView` 9 处、`CourseEditorModal` 11 处、`SemesterModal` 1 处、`NoticeUnderstanding` 2 处，另有 `LocalTransfer` 2 处密码框与 `QuickRecordPanel` 2 个 textarea 补 `aria-label`（这两处上方只有 `<h4>`/`<b>` 标题而非 `<label>`，标题不会给控件命名）。合计 **43 处**，扫描器从 78 降到 **35**。

**色块按钮只有颜色、没有名字**：`CourseEditorModal` 的「标记颜色」是一组 `<button class="swatch">`，颜色完全由 `background` 表达，元素里一个字都没有——读屏用户听到一串无名按钮，只能靠试；选中态也只靠 `.picked` 这个 class 表达，没有暴露给辅助技术。已补中文颜色名（`标记颜色 琥珀色` 这样）与 `:aria-pressed`。这类按钮全仓只有这一处（另一个 `.color-swatch` 是装饰性 `<span>`，旁边的取色器本来就有 `aria-label`），已用「空按钮且无 `aria-label`/`title`」的全仓扫描确认没有第二处，并验证该扫描确实会命中修复前的那一行。

**独立复核**（不是自证）：静态 `id` 全仓 **54 个、零重复**，静态 `for` **42 个、零悬空**（每个都能找到同文件的 `id`）；新加静态 id 的组件（`CourseEditorModal` / `SemesterModal` / `ExamsView` / `ListsView` / `TasksView`）**都只被渲染一次**，不存在运行时重复 id（唯一被多处渲染的 `QuickRecordPanel` 走的是 `aria-label`，其唯一的静态 id 是既有的 `<datalist>`）；抽查 `ExamsView` 的 8 组配对，`for` 与控件一一对应、id 前缀统一、文案与字段语义相符；`ExamsView.vue` 是全仓唯一的 CRLF `.vue`，经比对 diff 规模（179/77，不是 856 行整文件重写）确认这是**改动前就存在**的状态，未被本次编辑翻转。

### 1.16 跨规则的对比度缺陷：审计脚本结构上看不见的那一类（第七轮）

`tests/contrastAudit.test.js` 与 `scripts/audit-contrast.mjs` 都是**逐条规则**判断的，于是有一整类缺陷它们永远抓不到：**文字色在一条规则里、背景在另一条规则里**。比如

```css
.btn-pull { color: var(--primary); background: var(--primary-soft); }
.btn-pull:hover:not(:disabled) { background: #e1e9ff; }   /* 深色主题下 #5a8cff 配 #e1e9ff = 2.61:1 */
```

两条规则各自看都没问题（一个有令牌字色、一个是普通背景），合起来在深色主题下是**几乎读不出来的按钮**。我按「同族里既有令牌变体、又有写死色变体」「底跟主题令牌、文字却写死」「文字写死、自带底写死但父级是主题面」三种口径分别扫了一遍全仓，定位并修掉：

| 位置 | 问题 | 改后 |
|---|---|---|
| `LocalTransfer .qr-placeholder span` | 70px 占位图形 `#cbd3e4` 配 `.qr-panel` 的 `var(--bg-tint)`，**浅色下 1.44:1** —— 70px 的图形也要求 3:1，等于浅色主题里这个占位符根本看不见（深色 11.58:1，说明取值时只对着深色相机框调过） | `var(--ink-faint)`：浅 4.98 / 深 5.39 |
| `FocusPanel .focus-done-hint` | `#087a58` 配 `var(--card)`，深色 2.97:1（13px/600 = 正文，门槛 4.5） | `var(--success)`：浅 5.63 / 深 8.15 |
| `LocalTransfer .success` | 同上，深色 2.97:1。它的兄弟 `.error` 本来就是 `var(--danger)` | `var(--success)` |
| `QuickRecordPanel .success` | 同上，深色 2.97:1 | `var(--success)` |
| `QuickRecordPanel .unknown-tip / .uncertain-tip / .category-tip` | `#9a651d` 配 `background: var(--card)`，深色 3.21:1 —— 正是「底跟主题、字写死」的典型 | `var(--warning)`：浅 5.91 / 深 8.20 |
| `QuickRecordPanel .question` | `#9a651d` 无自己底色，落在主题面板上，深色 3.21:1 | `var(--warning)` |
| `NoticeUnderstanding .clipboard-message` | 同上，深色 3.21:1 | `var(--warning)` |
| `NoticeUnderstanding .confidence.high / .medium` | `#258365` / `#a96712`，深色 3.41 / 3.50:1。**同一条规则里的 `.confidence.low` 本来就是 `var(--danger)`**，说明这三个本来就该是令牌，只有两个漏了 | `var(--success)` / `var(--warning)` |
| `App .global-sync-alert span` | `#8d744c` 配该提示条**写死的**暖底 `#fffaf0` = 4.26:1（11px 正文不达 AA） | 族内加深为 `#836a44`：4.91:1，色相不变 |

**三处查证后判定「不是缺陷」，没有动**（这是这轮里同样重要的部分）：

- `FocusPanel .focus-clock.overtime`（`#0ea271`）：我的扫描按 4.5 门槛把它标了出来，但这个时钟是 `font-size: clamp(30px, 3vw, 38px)` —— **属 WCAG 大字，门槛是 3:1**，实测浅色 3.27、深色 4.86，两套主题都达标。扫描器不读字号，这是它的已知假阳性。
- `LocalTransfer .camera-empty`（`#cbd3e4`）：它的父级是 `.camera-box { background: #172033 }`（写死的深色相机框），配上去 10.83:1，是刻意保留。上面那条 `.qr-placeholder span` 之所以是缺陷，正是因为它长得一样却落在浅色的 `.qr-panel` 里。
- `DataManager .sync-preview-details` 与 `.sync-preview-card small`：父级是 `.sync-preview-card` 那块**写死的浅蓝卡片**（`#f1fbfe`/`#236175`/`#b9ddea`），属于"刻意的彩色小面板"一族。这里有个**关键陷阱**：把它换成 `var(--ink-soft)` 会**帮倒忙** —— 深色主题下 `--ink-soft` 是浅色 `#b2bdd0`，压在写死的浅蓝底上只有约 1.5:1，会把一个本来可读的面板彻底弄坏。正确做法是在这一族内部加深写死值。`.sync-preview-card small` 的 `#5d8290` 在 `#f1fbfe` 上只有 3.95:1，确实不达标（已交给同批处理）。

**顺带把审计脚本的覆盖面补上**：语义色大量出现在「没有自己底色」的规则里（提示文字、金额、状态标签），底常常是 `--bg-tint` 区块，而 `--bg-tint` 在高对比度浅色下是 `#eef1f7`（比默认的 `#f9fafd` 深），是相关组合里最紧的一档。已把「语义色 / `--bg-tint`」三组加进 `audit-contrast.mjs`，配色组合数从 90 升到 **108**，全部达标（最紧的一组是 `--success` 配高对比度浅色 `--bg-tint` 的 4.98:1）。

### 1.17 守卫自己出了会「一直报绿」的缺陷：绿色与粉色主题从未被审计（第八轮）

这一轮最值得记的不是修了哪个颜色，而是**发现对比度守卫本身失效过**。

`scripts/audit-contrast.mjs` 的 `blockFor()` 从 `style.css` 里取主题块，写法是

```js
new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`)
```

它要求块尾必须是「换行 + 右花括号」。而 `style.css` 顶部有一组单行规则：

```css
:root[data-theme='purple'] { --focus-solid: #6d28d9; }
:root[data-theme='green']  { --focus-solid: #0a7a56; }
:root[data-theme='pink']   { --focus-solid: #be185d; }
```

查 `green` 时正则从 L106 的 `{` 起算，非贪婪地一路找到第一个「换行 + `}`」才收尾——而那个 `}` 属于**下面紫色主题块**。后果：

- `themePalettes()` 里紫色、绿色、粉色的 `--primary` **完全相同**（都是紫色的 `#7a37e8`）
- 真实的绿 `#0a7a54`、粉 `#c02070` **从来没有进过审计**
- 而审计每天都在报「全部达标」

**一个把 A 主题当 B 主题审的守卫，会一直报绿。** 这比任何一个具体的颜色缺陷都严重，因为它让「全绿」这个信号本身失去了意义。已改为花括号配对 + 按 CSS 级联顺序合并，并验证三个主题现在各不相同（真实值已写进测试）。

顺带把审计的覆盖面补上：新增「语义浅底上压着**另一个**令牌的文字」（给评估器加了 `tint` 选项，此前底与字必须同源才能表达）与悬停态浅底，检查组合 **108 → 144 组**。

**并纠正了一处由此引发的误判。** 迁移子代理据此前的解析结果报告说「幽灵按钮基础态在 blue/purple/green/pink 四个主题下都不达 AA（2.95–4.00），需要令牌层修复」。核查后证伪：它用的是 `theme.js` 的 `THEMES[*].primary`（green `#0ea271`、pink `#ec4899`），而运行时具名主题走 `theme.js` 的 `else` 分支——只设 `dataset.theme` 再 `clearThemeVariables()`，颜色**全部来自 `style.css`**；`THEMES[*].primary` 只用于写 `<meta name="theme-color">`。真实的 `--primary` / `--primary-soft`：蓝 4.72 / 紫 5.22 / 绿 4.82 / 粉 4.95 / 高对比度 4.72 / 深色 4.84 —— **六个主题全部达标**，不需要任何令牌层改动。（同时也说明我之前那句「全部达标」虽然结论对，但理由是错的：当时绿/粉正被当成紫色审。）

这两件事各留了一条永久断言：三个具名主题的 `--primary`/`--primary-soft` 必须**互不相同且等于 `style.css` 里的写定值**（只断言「达标」抓不到这个 bug），且不得把 meta 色当令牌。

### 1.18 同一批剩下的「写死灰字」与死 CSS（第八轮）

上一节的三处由于是**灰色**（不是绿/琥珀）而没进迁移子代理的范围，仍留在我名下，本轮清掉：

| 位置 | 问题 | 处理 |
| --- | --- | --- |
| `DataManager .sync-hint` | 写死 `#8590a6`：浅色主题 **3.21:1**（落在 `--bg-tint` 区块上是 3.00:1），11px 正文远不到 AA；深色反而是 4.94:1 —— 一处**只坏了一套主题**的漏网 | 换 `var(--ink-faint)`：六套主题在 `--card`/`--bg`/`--bg-tint` 上都是 4.85–8.87 |
| `DataManager .conn-times i` | 同一个 `#8590a6`，底是 `var(--bg)`，浅色 3.00:1 | 同上 |
| `DataManager .device-history` | `#5e6f85`：浅色 5.14 达标、深色 3.09 不达 | **它其实是死 CSS**（全文件只有样式块里有这个类，模板从未渲染）→ 直接删规则，而不是去修一个永远不会显示的颜色 |

顺带清掉同文件的另外四条死规则：`.conn-head`、`.conn-badge`、`.conn-meta-item`、`.conn-meta-item code` —— 模板早已改写成只渲染 `.conn-times` + `.relationship-state`，这四条在全文件只出现在样式块里。这也是**本轮唯一一次把「子代理迁移过的规则」删掉**：它照着颜色清单把这四条一并迁到了 `--success`，而它们根本不会显示；说明「按颜色清单批量迁移」这种做法的固有风险是**无法区分活代码和死代码**。

（这一类仍然没有守卫：`tests/styleHooks.test.js` 只扫 `style.css`，组件内的死 CSS 只能靠人看。§5 第 13 条记录了原因——Vue 运行时过渡类、`:deep()`、动态拼接类名、prop 传入变体类四类假阳性规模都不小，要做成断言必须先设计例外机制。）

### 1.19 键盘可达性：账本页最常用的两个操作，键盘完全够不到（第九轮）

前几轮把「可访问名称」修完了（§4 第 16 条），但**名称**只是「读屏知道这是什么」，
还有另一半：**键盘能不能操作它**。这轮换了个角度扫——找「只有鼠标能触发」的元素。

**缺陷本身**：账本页有两类行，点击是它们的**唯一**入口：

```html
<div class="feed-item" @click="openDetail(e.transaction.id)">      <!-- 打开交易详情 -->
<div class="card bill-row" @click="openBillForm({}, bill.id)">     <!-- 编辑固定账单 -->
```

这类元素不在 Tab 序里、读屏不会读成可点击、回车与空格都没有反应。而：
- 交易详情是详情/编辑/再记一次/退款/删除的**总入口**；
- 固定账单行右侧的按钮组只有「已支付 / 跳过本次」，**没有编辑**。

也就是说账本页最常用的操作对键盘用户完全不可用（WCAG 2.1.1，AA 级）。修复方式是补上
「可点击元素的三件套」——`role="button"`（读屏认得）、`tabindex="0"`（Tab 到得了）、
`@keydown.enter` / `@keydown.space`（按得动），外加动态 `aria-label`。共 5 个元素：
打开交易详情 2 处（账本列表 1176、日历当日明细）、编辑固定账单 3 处（即将到来/之后/已暂停）。
**DOM 结构与样式一律没动**（只加属性）。可以安全加 `role="button"` 的理由：外层
`SwipeActionItem` 把动作按钮渲染成这些行的**兄弟节点**，不会形成「按钮里套按钮」的非法嵌套。

**同时修掉一个相反方向的问题**：那些侧滑动作按钮只靠位移藏起来，收起时仍在 DOM 且**仍可聚焦**
——键盘用户会 Tab 到一排看不见的「编辑 / 删除」上（WCAG 2.4.7 焦点可见）。现在它们的
`tabindex` 跟随 `open` 属性在 `-1` 与 `0` 之间切换。这不会让编辑/删除对键盘消失：每一行现在
都能聚焦回车进详情，详情面板里有全部真按钮。

**新增守卫 `tests/keyboardReachability.test.js`**，判据三条同时成立才算缺陷：标签是可点击容器
（`div`/`span`/`li`/`td`/`tr`）、带**动作型** `@click`（只做传播控制的 `.stop`/`.self`/`.capture`
不算）、缺少三件套中的任意一件。

第四条判据是这条守卫能做到**零硬编码**的关键：如果同一个动作**表达式**在本文件里已经落在可聚焦
元素上，就认为键盘已经走得到。于是「点待处理账单行 = 切到账单标签页」自动豁免——同一表达式
`tab = 'bills'` 就在旁边 `role="tab"` 的真按钮上。一条需要人不断往例外清单里加名字的守卫，
最后一定会被加名字加到失效；让判据自己证明等价性，比维护清单可靠。

例外清单只有 3 条，都是**字符串比较认不出、但确实等价**的情形，每条都写明另一个键盘入口：
课程格与移动端课程行是同一个 `openEdit`（只是循环变量名叫 `course` 而这里叫 `c`）；
点课表空格是「按格预填」的捷径（`7×N` 个格子全做成 Tab 停靠点会造出几十个 Tab 步骤，
网格的正确做法是 roving tabindex + 方向键，属交互设计决策）；点考试卡片等价于卡片自带的
「更多操作」按钮 → 菜单里的「编辑」。**清单带自我淘汰机制**：某条不再被扫到时测试会失败，
不会随代码变化悄悄烂掉。

判定力做了三重自证：7 条夹具（3 条必须抓、4 条必须放行，含「属性值里的 `>` 不得骗过引号感知」）、
扫描规模断言（53 个 `.vue` / 3083 个开标签 / 478 个带 `@click` 的标签，全部必须大于阈值——
正则写坏时的假绿比漏报更危险）、以及拆掉 `.cd-row` 三件套的变异实验（精确报出
`views/LedgerView.vue → openDetail(e.id)`，还原后 12/12）。

**顺带抽出 `tests/helpers/vueTemplate.js`**：遍历 `.vue`、剥注释与 `<style>` 取模板、按引号感知
切标签这三件事，现在由「表单命名」「键盘可达性」「展开/收起状态」「地标角色命名」「反馈播报与 ARIA 引用」「表格语义」六条守卫共用。引号感知是必需的，不是洁癖——
`:disabled="a >= b"` 这类属性值里就有 `>`，用朴素正则会提前截断，然后被截断的半段看起来
「没有 aria-label」，守卫开始报假警，而报假警的守卫最后一定会被人关掉。

（`reducedMotionScroll` 是另一类扫描目标：它扫的是 **JS 源码**而不是模板，所以自带一套
「剥注释 + 取最内层括号表达式」的解析，没有复用上面这个模板扫描器——两者的坑不一样，
硬合并只会让两边都变模糊。）

**判据自己也犯过一次错，值得记下**：第一版在构建「已可达」集合时误套了传播过滤，于是
`<button @click.stop="openSchemeDetail(x)">` 这个**真按钮**被排除在外，`TimeSettingsModal` 里
「卡片 + 紧邻的查看/编辑按钮」这一对等价入口被判成了缺陷。`.stop` 只影响冒泡，不影响元素本身
可不可点——判定器把自己该认的等价入口给排除了。

### 1.20 页面标题从 h1 直接跳到 h3（第十轮）

读屏用户最常用的导航方式之一是「按标题跳转」，标题层级断档会让这个目录少一档。
清点下来三个页面有断档：`LedgerView`（h1 + h3×9 + h4×1）、`ListsView`（h1 + h3）、
`ScheduleView`（h1 + h3×3）——区块标题都是 h3，而页面标题是 h1，中间没有 h2。

**这不是「按规范该这么写」，而是一致性问题**：`TodayView`（h1 + h2×3 + h3）、`TasksView`（h1 + h2）、
`WeeklyReviewView`（h1 + h2）的区块标题本来就是 h2。同一套界面里，同样的区块标题在有的页面是 h2、
在有的页面是 h3，读屏给出的目录结构就不一致。

**改之前先确认改标签不会动外观**，这一步是重点：

- `style.css` 有全局 `* { margin: 0; padding: 0; box-sizing: border-box }` 重置，标题的默认外边距已被抹掉；
- `style.css` 里**一个 `h1`–`h6` 选择器都没有**，所以没有全局的标题字号规则；
- 三个页面里 `.block-title`、`.feed-day`、`.page-title` 都是**类选择器且显式写了 `font-size`**，
  换标签不经过任何按标签匹配的样式。

改完：`LedgerView` 变成 h1 → h2×9 → h3，`ListsView` h1 → h2，`ScheduleView` h1 → h2×3。

**但有两处按标签写的选择器必须跟着改**，否则样式会静默掉：`ListsView` 的 `.list-head h3`
和 `ScheduleView` 的 `.schedule-settings h3`。两处都已在原位置留注释写明「这个选择器按标签写，
改标题层级时必须同步改这里」，并把「区块标题为什么是 h2 而不是 h3」的理由写在旁边。

**我的扫描器在这条上误报过一次，值得记下**：`EmptyState.vue` 和 `Modal.vue` 被报成
h2 → h4 跳跃，但它们的三个标题是 `v-if` / `v-else-if` / `v-else` 的**互斥分支，一次只渲染一个**，
按源码数标签会把「同一位置的三种可能」当成「同时存在的三级」。反过来看，这两个组件恰好做对了：
它们把层级做成可配置（`level` / `titleLevel`，默认 3），因为一个可复用组件的正确层级本来就取决于
调用方——`MemoryView`、`SearchPanel`、`TasksView` 等 8 处传 `:level="2"`，`NoticeUnderstanding`
传 `:title-level="2"`，其余场景用默认值 3。

**因此这条没有加守卫**：按文件数标签无法区分互斥分支与同时存在，而对**组件**来说正确层级取决于调用方，
写出来必然产生假警报——会报假警的守卫最后一定会被人关掉。真正准确的做法是渲染后检查 DOM 标题顺序，
但那需要给 9 个视图各搭一套 router + store 挂载环境，成本明显高于收益，记在 §4 作为候选。

### 1.21 一次偶发失败的根因：重复注册叠出监听器（第十轮）

改完标题后 `npm run check` 失败过一次：`tests/autoSyncTask.test.js > 一次同步跑完只留一条结果`
报 `expected 2 to be 1`。单独跑 3 次全过、全量复跑也全过——**偶发，而且与标题改动无关**。

根因不在测试的写法，而在产品代码的一个坑：`registerAutoSyncTask()` 每次调用都新建一个
`watch(autoSyncState, …)`。`registerTask` 会按 id 覆盖注册表里的任务项，**但 watch 不在注册表里**，
所以重复调用会叠出多个监听器，每个都在状态跃迁时调一次 `recordTaskResult`。
而 `recordTaskResult` 的去重键是 `id + at`，`at` 是**毫秒时间戳**：
多次调用落在同一毫秒才碰巧合并，跨毫秒就是两条。于是「重复注册」这个前提一旦成立，
失败与否就取决于机器负载——全量并行跑才容易撞上。

**先证明，再修**。写了个临时用例：注册 3 次、每次跃迁之间真实 `sleep(5)`，结果记了 **2 条**，
两条的 `at` 相差正好 **1 毫秒**（`…578` / `…577`）——诊断成立。（该临时文件验证后已删除。）

修法是让注册**幂等**：用一个模块级句柄记住上一次的 `watch` 停止器，重复注册先停掉上一个；
返回的注销函数只在句柄仍指向自己时才清空，避免注销旧句柄把新监听器的句柄抹掉。
应用里只在启动时注册一次，正常路径本来踩不到，但这属于很容易踩的坑，堵上比留着好。

**守卫的第一次尝试是失败的，这一步比结论更值得记**：我一开始把回归测试写成「真实 sleep 跨过毫秒边界，
断言结果条数为 1」。做变异实验（撤掉 `stopPreviousWatch?.()`）时它**仍然 12/12 通过**——
因为叠出来的监听器是在同一微任务批次里刷新的，多数落在同一毫秒、被去重掩盖了。
**一条对目标缺陷没有检测力的守卫，等于没有守卫**，而且它自己还会成为新的偶发源。

所以换成了与时间戳无关的判据：spy `recordTaskResult`，断言**调用次数**。监听器几个就调几次，
跨不跨毫秒都一样。这 4 条用例锁在 `tests/autoSyncRegistration.test.js`（单独成文件，避免
`vi.mock` 影响原来那 11 条用例）。变异实验结果：撤掉修复 → **4 条全部失败**（1 vs 3 次、2 vs 8 次），
还原后 4 条全绿。其中一条是**判定力自证**：手工再叠一个结构完全相同的监听器，必须变成 2 次——
如果哪天有人把断言改回「只看结果条数」，这条会先失败。

### 1.22 「按了没反应」的按钮：13 处展开/收起没有告诉读屏当前状态（第十一轮）

页面里有大量「查看历史」「打开筛选」「更多」这类按钮，按一下就在原地把一段内容摊开或收起。
它们**视觉上**没问题——内容出来了，眼睛看得见。但读屏用户听到的只是一个普通的
「查看历史，按钮」：按下去之后名字不变、状态不变，**没有任何信息告诉他内容已经展开**，
再按一次是不是收起也无从判断。对只能靠读屏操作的用户，这是一个「按了没反应」的按钮。

加一个 `aria-expanded` 就能让它读成「查看历史，按钮，已展开」（WCAG 4.1.2 名称/角色/值）。
全仓 `aria-expanded` 原本只有 6 处（其中还有弹窗拖拽手柄、移动端「更多」菜单等），
而**原地翻转布尔**的控件有 13 个——11 个是缺的：

`DataManager` 展开全部设备、`InboxPanel` 展开收件箱、`NoticeUnderstanding` 展开处理选项、
`Sidebar` 折叠侧边栏、`ExamsView`/`TasksView` 查看历史、`LedgerView` 筛选/更多分类/更多、
`ScheduleView` 已归档课程、`TodayView` 展开收件箱。

**判据刻意收窄，只认一个签名**：`@click` 表达式里赋值左侧的标识符，在同一表达式里以
`!同一标识符` 出现（`showHistory = !showHistory`）。这条窄判据换来的是零假警：打开弹窗的
`showSemester = true`、关闭的 `showBillForm = false` **不该**用 `aria-expanded`（弹窗有
`aria-modal` 和焦点转移，语义不同），而它们都不含 `!标识符`，自然被排除。
连「赋成别的东西的取反」（`showFilters = !filtersActive`）也只因两边标识符不同而放行——
判据窄只会漏报，判据宽会报假警，而报假警的守卫最后一定会被人关掉。

**一处需要判断方向的**：`Sidebar` 的折叠按钮内部标志叫 `collapsed`，而 `aria-expanded`
描述的是「是否已展开」，所以绑定必须写成 `:aria-expanded="!collapsed"`。这是全仓唯一
取反的一处，已在模板上方留注释说明，免得下一个改的人顺手改成 `collapsed`。

**刻意不做的事**：不要求 `aria-controls`。它要指向被控元素的 id，而这些展开内容大多没有 id，
为它造 id 属于为属性而属性；且屏幕阅读器对它的支持一直不一致。本轮只做「状态能被读出来」
这一件真正影响使用的事。

**已知漏报，且是刻意接受的**：写成三元表达式的翻转
（`expandedId = expandedId === draft.id ? '' : draft.id`）不含 `!标识符`，不被判据覆盖。
全仓只有 1 处（`QuickRecordPanel` 的「修改/收起」），已经手工补上
`:aria-expanded="expandedId === draft.id"`，但**守卫盯不住它的回归**。不把三元纳进来的原因：
`X = X === … ? … : …` 这个形状里，「原地展开收起」和「切换视图模式」
（如 `mobileView = mobileView === 'day' ? 'week' : 'day'`）长得完全一样，而后者该用
`aria-pressed` 或什么都不用，**不是** `aria-expanded`——判据为多抓 1 处而放宽，就会开始对着
模式切换按钮报假警。宁可漏报这 1 处，也不要一条会喊狼来了的规则。

**这个判断有实测支撑**：把判据临时放宽到三元写法后扫全仓，多出来的正是这 2 处——
`LedgerView` 的日历选日（`selectedDay = selectedDay === cell.day ? null : cell.day`，该用
`aria-selected`）和 `ScheduleView` 的日/周视图切换（`mobileView = mobileView === 'day' ? …`，
该用 `aria-pressed`）。也就是说放宽判据并不能多抓 1 处真缺陷，只会多出 2 处假警。
最终数据：17 个「原地翻转或自引用三元」控件里 15 个带 `aria-expanded`，剩下 2 个正是上面这两类。

守卫是 `tests/disclosureExpanded.test.js`（13 条）：8 条夹具证明判据抓得住该抓的、放得开
不该抓的（含「引号感知：属性值里的 `>`」与「两边标识符不同不算翻转」两条精度测试），
4 条全仓断言（违规为 0、例外清单自我淘汰、扫描规模下限、13 处全部已说状态）。
注入验证：摘掉 `TodayView` 那处的 `aria-expanded` → **2 条失败并精确报出**
`views\TodayView.vue → showInbox = !showInbox`，还原后 13 条全绿、无 `.bak` 残留。

### 1.23 课表周视图的课程块，键盘用户原本够不到（第十二轮）

这一条在第九轮就定位了，但当时没动，理由写在守卫的例外清单里：**「移动端单日视图的课程行是
同一个 `openEdit`，键盘在那里能编辑课程」**。第十一轮收尾时回头核对，发现这个理由站不住：

- `ScheduleGrid.vue` 的移动端分支是 `v-if="mobileView === 'day'"`、桌面周视图是 `v-else`，
  **两者互斥**——那个 `<button class="mobile-course-row">` 在桌面周视图下根本不渲染；
- `CourseManagerModal`（「批量管理」）只有全选 / 创建副本 / 删除选中 / 清空 / 模板，
  **没有编辑单个课程的能力**；
- `ScheduleView` 里没有别的课程列表；`@open-edit` 正是从网格发上来的事件。

也就是说，桌面周视图下「编辑这门课」的唯一直接入口，就是那个只挂了 `@click` 的
`div.course`。键盘用户并非完全无路可走——`ScheduleView.vue` 的注释写得很清楚
「桌面端其实可以正常切到单日视图，入口是更多设置 → 显示」，绕过去之后那一支的 `<button>`
就能用了——但**主入口对键盘是关着的**，要编辑课程得先猜到要切视图模式。这不是「有等价入口
所以不算缺陷」，而是「等价入口藏在两步之外」。已给课程块补上三件套：

```
role="button" tabindex="0"
@keydown.enter.prevent="openEdit(c)"  @keydown.space.prevent="openEdit(c)"
```

不加 `aria-label`：块内的「课名 + 周次 + 地点」本身就是可访问名称，加显式 label 反而会把
这几项覆盖掉。这与移动端课程行的做法一致（那边也是靠内容当名称）。

**顺带把例外清单从 3 条缩到 2 条**——删掉的就是这条理由站不住的 `openEdit(c)`。
守卫的自证断言（「例外清单里每一条都仍对应一个真实例外」）正是让这种过期理由浮出来的机制：
补上三件套后该条不再被扫到，断言就会失败，逼着人回来删。

**空格 `.tt-cell` 刻意保持点击专用，并且加了反向断言守住这个「刻意」**：一个 12 节的学期周
就是 7×12 = 84 个格子，全做成 Tab 停靠点会让键盘用户按几十次 Tab 才穿得过课表，比现状更糟。
真正的解法是 roving tabindex + 方向键的网格模式，属于交互设计改动。所以守卫里新增一条用例
**断言 `.tt-cell` 没有 `tabindex`、没有 `role="button"`**——如果哪天有人当它是漏改顺手加上，
这条会失败并把人挡下来。同时 `ScheduleGrid.vue` 的模板里也留了注释说明这个取舍。

注入验证：摘掉课程块的三件套 → **2 条失败**，其中主扫描精确报出
`components/schedule/ScheduleGrid.vue <div …> → openEdit(c)`，还原后 14 条全绿、无 `.bak` 残留。

### 1.24 角色命名、skip link，以及一条守卫的「假绿→假警→精确」三步（第十三轮）

这一轮从「带 `role` 的容器有没有可访问名称」切入，顺带挖出两个真缺陷、一个缺失，
以及一次值得记下来的守卫返工。

**（一）两个角色没有名字。** 普查全仓 62 个带 `role` 的元素，需要名称的角色里有两个是空名：

- `ContextMenu.vue` 的 `<div role="menu">`：读屏只念「菜单」，不说是哪个菜单。
  修法与 `Modal`/`ActionSheet` 完全一致——有可见标题就让 `aria-labelledby` 指过去，
  `title` 没传时（目前只有考试页传）退化成 `aria-label="操作菜单"`，不留空名。
- `TimeSettingsModal.vue` 的 `<div class="tab-bar" role="tablist">`：同页另两个 tablist
  （`AppearanceSettings` 的「个性化设置分区」、`LocalTransfer` 的「二维码迁移方式」）
  都带 `aria-label`，只有这里漏了。补 `aria-label="设置分区"`。

**（二）缺失：应用没有 skip link（WCAG 2.4.1 绕过区块）。** 侧边栏有十几个导航项，
键盘用户每换一页都得先 Tab 穿过它们才到正文——这是纯键盘用户最常用的第一颗「按键」。
已加：`<a class="skip-to-content" href="#main-content">` 作为 `.layout` 的第一个子元素，
`<main>` 加 `id="main-content"` 与 `tabindex="-1"`。两个细节是必需的：

- 视觉隐藏用 `transform: translateY(-120%)` 而**不是** `display: none`——后者会让它脱离
  Tab 序，永远聚焦不到，skip link 就白写了；
- `<main>` 的 `tabindex="-1"`：只给 id 的话各浏览器行为不一致，有的只移动「顺序焦点起点」
  而不移动焦点。

**（三）顺带核实的两个「疑似缺陷」，结论都是不用改**：

- **`aria-current` 全仓源码 0 处**——但这不是缺陷：`Sidebar` 用的是 `<router-link>`，
  而 vue-router 4 在精确激活时会自动渲染 `aria-current="page"`
  （`node_modules/vue-router/dist/vue-router.mjs`：`"aria-current": link.isExactActive ? props.ariaCurrentValue : null`，
  `ariaCurrentValue` 默认 `'page'`）。**如果只看源码就"修"，反而会加一个冗余属性。**
- **孤儿 tab**：`role="tab"` 必须位于 `role="tablist"` 之内，否则是无效 ARIA。
  配对扫描（带嵌套栈）全仓 0 处孤儿，14 个 tablist 都被正确包着 ✓。

**（四）守卫返工记：假绿 → 假警 → 精确。** 新守卫 `tests/landmarksAndRoles.test.js` 有两条规则，
第二条（skip link 必须排在最前）**连着错了两次**，两次都不是笔误而是判据设计问题：

1. **第一版：跨两次 `openTags` 调用比较元素对象身份。** `openTags` 每次调用都产出全新对象，
   所以「找不到第一个可聚焦元素等于 link」这个判断恒为真，夹具立刻报错。改成在同一个 `tags`
   数组里比**下标**。
2. **第二版：假绿。** 判据是「它前面有没有可聚焦的标签（button/a/…）」。把 skip link 挪到
   `<Sidebar />` 之后做变异实验——**仍然全绿**。原因是 `<Sidebar />` 是自闭合组件，
   源码级扫描看不见它内部渲染出的十几个导航项，而组件标签本身既不是 button 也不是 a。
   也就是说这条守卫对「skip link 被埋到侧边栏后面」这种回归**完全没有检测力**。
3. **第三版：假警。** 改成「前面不能有任何组件或地标」，结果真实仓库立刻报出
   `它前面还有 <WallpaperLayer>`。核实 `WallpaperLayer.vue`：模板只有两个纯装饰 `<div>`、
   零可聚焦元素，放在 skip link 前面**完全无害**。
4. **定稿：递归查组件内部。** 组件名解析到真实 `.vue` 文件，递归（带去重与深度上限）判断
   「渲染出来会不会含可聚焦元素」，只有会含的才算挡路。于是 `WallpaperLayer` 放行、
   `Sidebar` 拦下，**既不要白名单，也不放过真回归**。刻意不看 `aria-hidden`：它**不会**
   把元素移出 Tab 序，所以「aria-hidden 里包着按钮」依然截得住键盘用户，依然算挡路。

**教训与上一轮的「调用次数断言」是同一条**：一条对目标缺陷没有检测力的守卫等于没有守卫，
而**只有变异实验能发现这一点**——两次都是我先把变异跑出来才知道判据是假的。
反过来，判据收得太紧会造出假警，假警的守卫最后一定会被人关掉。所以定稿不但有
「Sidebar 必须拦下」的检测力测试，还配了「WallpaperLayer 必须放行」的精度测试，
以及一条「递归函数不是恒返回 false」的核实断言。

### 1.25 「红字出现了，听觉上世界毫无变化」——21 处哑巴反馈（第十四轮）

这一轮从「表单错误对读屏可见吗」切入，结果是**整个仓库最成体系的一类缺陷**。

**（一）仓库里早就有成熟约定，只是没被贯彻。** `NotesView` / `LedgerView` / `EventsView`
三处都已实现完整的五件套，代码里甚至留了注释说明这是一套约定：

```
// 与 NotesView / LedgerView 同一套约定：记录是哪个字段不过，用于 aria-invalid 与焦点回跳。
// 单一入口，保证 X / XField 不会各自漂移。
function setXError(message, field = '') { … nextTick(() => input.value?.focus()) }
```

即：① `errorField` 状态；② 控件 `aria-invalid`；③ 控件 `aria-describedby`；④
`<p :id role="alert">`；⑤ `nextTick` 把焦点移回出错的字段。**没跟上的是另外三个表单**：

| 文件 | 校验字段 | 缺什么 |
|---|---|---|
| `CourseEditorModal.vue` | 课程名称（`请填写课程名称`）、周次冲突 | 五件套全缺，错误还渲染在表单**最底部** |
| `ExceptionsModal.vue` | 开始/补课日期、结束日期（3 个日期输入） | 五件套全缺，有**两个**校验字段 |
| `ListsView.vue` | 清单名称、物品名称（两个弹窗各一个） | 五件套全缺；物品名称输入框连 `@input` 清错误都没有 |

补的时候有一处判断值得记下：`ExceptionsModal` 有两个校验字段，**必须**引入 `field` 状态
（否则会出现「错误在结束日期却标了开始日期」）；而 `ListsView` 两个弹窗**各只有一个**必填字段，
`aria-invalid` 直接跟着错误字符串走即可，不存在标错字段的空间——**该省的状态就省**，
否则就是照抄形状而不理解它为什么存在。

**（二）更大的一类：21 处反馈消息根本不会被播报。** 顺着错误查下去发现，`v-if` 存亡的错误提示
如果不带 `role="alert"` / `aria-live`，读屏用户点完保存**什么都听不到**——视觉上红字出现了，
听觉上世界毫无变化。普查结果：

- **16 处错误提示是哑巴**：`清单编辑`、`课程编辑`、`课程批量管理`、`作息设置`×3、`数据管理`×2、
  `导入冲突`、`批量导入`、`外观设置`、`专注设置`、`专注面板`、`本地互传`×2、`考试`、`待办`、`任务进度`。
  已全部补 `role="alert"`。
- **5 处成功提示是哑巴**（`数据管理`×2、`本地互传`、`待办`×2），补 `role="status"`——
  注意成功**不能**用 `role="alert"`：那是断言式播报，会把「已保存」当成警报打断用户。
  `TasksView:435` 本来就是这个写法，说明约定存在，这几处只是漏了。

**（三）三分之一的命中是假阳性，必须逐条甄别。** 普查脚本一口气报出 29 处「无播报路径」，
但其中 13 处**不该改**：

- `:class="{ invalid: row.error }"`、`:class="{ 'has-error': rowError(i) }"` ——**纯样式绑定**，
  根本不是消息（它们没有 `class=` 属性，只是类名里含 `error` 字样）；
- `error-message` / `error-icon` ——同一条消息的**内部零件**（外层那行才是消息）；
- `error-text`（「N 行需修改」汇总）、`batch-error-row` / `plan-row-error` / `plan-error-tip`
  ——**表格里逐行的标记**；
- `global-error-close` ——关闭按钮。

**逐行标记刻意不做实时区域**：它们随着每次敲键变化，做成 `aria-live` 会疯狂播报，
比不播报更糟。它们是表格内容的一部分，用户逐行导航时自然会读到。这个取舍写在守卫的文件头与报告里，
而不是用白名单糊过去——**判据因此可以做到零例外清单**（只认消息类名集合，且只看静态 `class=`）。

**（四）批量脚本误伤了一次，反而验证了成功/失败的语义区分。** 我用「按行号定位 + 该行第一个
`class="…"`」的脚本批量补 `role="alert"`，`AppearanceSettings` 那行恰好把成功与失败写在**同一行**：

```html
<p v-if="message" class="success">{{ message }}</p><p v-if="error" class="error">{{ error }}</p>
```

脚本命中了行内第一个 `class=`，于是把 `role="alert"` 加到了 **success** 上。这提醒了两件事：
一是**批量改写必须逐条复核结果**（我复核时立刻发现了）；二是成功/失败的播报强度本来就该不同。
已改为 `success → role="status"`、`error → role="alert"`，并加注释说明别再加错。

**（五）守卫：零例外清单 + 悬空引用检查。** `tests/errorAnnouncement.test.js` 两条规则：

1. **反馈消息必须可播报**。错误用 `alert`、成功用 `status`；类名集合外的（内层零件、
   逐行标记、样式绑定）天然不进判据，所以没有例外清单要维护。
2. **ARIA 引用不得悬空**。`aria-describedby="x"` 指向不存在的 id 是**静默失败**：属性看着配了，
   读屏什么也读不到。判据把静态值和绑定表达式里的字符串字面量都取出来逐个核对。

这条守卫**自己也被夹具抓到一个缺陷**：早期版本没区分「未绑定值」与「绑定表达式」，
于是 `:aria-labelledby="titleId"` 里的**变量名被当成 id**，报出假悬空。夹具里那条
「写变量应跳过」的用例把它挡了下来，定稿改为：未绑定 → 整个值是 id 列表；绑定 → 只认字符串字面量。

三个变异全部报红：摘掉一处 `role="alert"` → 1 条失败；把成功提示改成 `role="alert"` → 1 条失败
（报「误用了 alert」）；把 `aria-describedby` 指向 `course-editor-errorTYPO` → 1 条失败
（精确报出「找不到该 id」）。

### 1.26 表格语义，以及一次「普查基本全清」的如实记录（第十五轮）

**这一轮的实际改动比前几轮小得多，原因值得写清楚：我扫的七个结构性缺陷类，六个是干净的。**
如实记录负面结果，比为了凑数去「修」不是问题的地方重要。

**（一）六项结构性普查，全部 0 处**（用带嵌套栈的扫描，不是正则逐行匹配）：

| 检查项 | 为什么值得查 | 结果 |
|---|---|---|
| 重复 `id` | 会破坏 `label for` / `aria-describedby` / `getElementById` | **0** |
| `<label for>` 指向不存在的 id | 点标签不聚焦控件，静默失效 | **0** |
| `aria-hidden="true"` 子树里含可聚焦元素 | 对读屏藏起来却仍能被 Tab 到，是 ARIA 违规 | **0** |
| 嵌套交互元素（`<button>` 套 `<button>`、`<a>` 套 `<button>`） | HTML 非法 + 焦点行为不可预期 | **0** |
| 静态 `id` 写在 `v-for` 内 | 源码里只出现一次，运行时渲染出多个相同 id——**上面那条「重复 id」查不到它** | **0** |
| `<a>` 缺 `href` / `href="#"` / `href=""` | 不可聚焦却长得像链接；`#` 会跳回页首 | **0** |

另外两项也查了、也干净：全仓只有 **2 个 `<form>`**，其中唯一「没有 `type` 的 `<button>`」
就是早前已核实**按设计正确**的 `ListsView` 添加按钮（`<form @submit.prevent>` 里的唯一按钮，
靠隐式提交实现回车添加）。

**（二）触摸目标：约定已经很完善，我没有改。** `style.css` 里有 `--tap-min: 44px` 令牌，
`@media (pointer: coarse)` 统一给 `.btn`、`button.tap-target`、`[role='button'].tap-target`、
`.setting-del` 兜底，`.tap-target` 实际使用 15 处；而且代码里**明确记录了排除项**：

> 刻意排除 `.chip` / `.segmented` / `.link-btn` / `.toast-btn` 这类密集内联控件：
> 它们靠间距而非尺寸达成可分性，强行放大反而会挤爆筛选行。

我按「自定义类名按钮是否被规则覆盖」筛出 185 个候选，但逐个查 CSS 后发现绝大多数自带尺寸
（其中 `(无 class)` 那一桶基本是 `:class` 动态绑定的假阳性）。剩下的几个（`.nav-item` 桌面专属、
`.recent-chip` 属已记录的密集内联类、`.course` 由网格定位给尺寸）都站得住。
**用字体大小和 padding 去推算像素高度、再断言「不足 44px」，是我这轮特意没做的事**——
那种结论不可靠，属于「假警的守卫最后一定会被人关掉」那一类。

**（三·补）第四十三轮又清了一遍"接了 role、没接钩子"的那一类。** 当年的做法是人工筛，所以它的**盲区**是后加的 `role="button"`：粗指针 44px 兜底的目标选择器是 `[role='button'].tap-target`，写了 `role="button"` 却没接钩子，在手机上就拿不到兜底。第三十九轮起全仓只有 4 个 `role="button"`，其中 **2 个是真漏接**，已接上：`LedgerView` 的 `.feed-item`（`height:100%` + `padding:11px 8px`）与 `.cd-row`（只有 `padding:6px 0`、没有任何 `min-height`，声明高度约 32px，手机明显偏小）。另 2 个记账不放：`ScheduleGrid` 的 `.tt-cell` **自带** `min-height:48px`（skin-timeline 下 54px，本来 ≥44，接钩子是空操作），`.course` 的高由**网格行轨道**决定、加 `min-height` 有溢出轨道的风险。并加了守卫 `tests/touchTargetHooks.test.js`（零漏接 + 例外自我淘汰 + 约定本身必须在 + 规模棘轮）。**顺带更正一处数字**：本节早先写的"`.tap-target` 实际使用 15 处"是**提到 tap-target 的行数**（含注释），按开标签解析出的**元素数**是 12 个，本轮接上 2 个后为 14 个——守卫按元素数棘轮，因为注释多写几个字不该让守卫变绿。

**（三）实际改动：表格语义。** 这里我要如实区分「缺陷」与「最佳实践」：

- 三个 `<table>`（农历对照表、导入预览表、课程批量管理表）**都正确用了 `<thead>`/`<tbody>`**，
  表头行明确，所以缺 `scope` **不是缺陷**——读屏能从 `<thead>` 推断出这是列表头。
  但显式声明是 WCAG **H63** 的做法，对导入预览表这种「8 列 + 额外错误行」的复杂结构有实际价值。
  已给全部 18 个 `<th>` 补 `scope="col"`（17 个列表头 + 1 个行表头）。
- **空 `<th>` 是真问题（虽小）**：课程管理表的首列表头是「选择」列（下面每行一个复选框），
  视觉上就该留空，但空 `<th>` 会让读屏把整列念成无名的表头。已补
  `<th scope="col" aria-label="选择">`——**内容为空可以，名称不能为空**。
- **行表头是真改进（WCAG 1.3.1）**：农历对照表是「年份 × 节日」矩阵，第一列的年份是**行标签**。
  原来是 `<td class="year">`，读屏在格子里横向移动时只会念出一列孤立的日期；改成
  `<th class="year" scope="row">` 之后会念出「2026 春节 …」。

**（四）改行表头时差点留下一个视觉回归。** 这条值得单独记：`.lunar-table` 的样式里有一条

```css
.lunar-table tbody tr:first-child td { border-top: 0; }
```

它**只匹配 `td`**。年份列一旦变成 `<th>`，首行的年份格就重新长出上边框——表格左上角会多一道线。
已同步改成 `tr:first-child th, tr:first-child td` 并加注释。改之前我先确认了另外两点，
所以视觉上不会有别的变化：共用规则 `.lunar-table th, .lunar-table td` 已经设了 `text-align: center`，
而 `:first-child` 规则本来就给了 `font-weight: 700`——**裸 `<th>` 的 UA 默认「加粗 + 居中」
在这里恰好等于原样式**，这也是我敢改的前提。（另外 `vertical-align` 由 `baseline` 变为 `middle`，
单元格是单行 + 7px padding，无可见影响。）

新增守卫 `tests/tableSemantics.test.js`：每个 `<th>` 必须有 `scope`；空 `<th>` 必须有
`aria-label`/`labelledby`；有多个 `<tr>` 的表格不能没有任何 `<th>`。三个变异全部报红
（摘掉一个 `scope` → 1 条失败；空表头去掉 `aria-label` → 1 条失败；年份列改回 `<td>` → 1 条失败），
还原后 7 条全绿、0 残留。判据的边界写在文件头：**「哪一列本该是 `<th>`」无法自动化**，
那是语义判断，判据只保证「已经是 `<th>` 的都有 `scope`」。

### 1.27 「减少动态效果」管不到 JS：4 处平滑滚动仍在动（第十六轮）

**（一）CSS 的降级规则对显式 `behavior: 'smooth'` 无效——这条原理仓库自己写过。**
`motion.js` 的文件头就写着：

> 被 CSS 降级规则覆盖的只有 CSS transition/animation，JS 驱动的动画（View Transition、rAF、WAAPI）
> 不受影响，所以凡是从 JS 发起的动效都要先问 `animationsEnabled()`。

`style.css` 里确实有一条全局兜底（`* { scroll-behavior: auto !important; animation-duration: 0.01ms !important }`），
但它改的是 `scroll-behavior` **属性**；`scrollIntoView({behavior:'smooth'})` 这类调用里**显式给出的
behavior 优先于**该属性。`VirtualList.scrollToIndex` 是写对了的样板（第 119 行还留了注释解释原因），
**但另外 4 处漏了**——而且都是用户能明显看到的位移：

| 位置 | 用户什么时候会看到它 |
|---|---|
| `focusNavigation.scrollAndHighlight` | **全应用最频繁**的程序化滚动：从首页跳到某条笔记 / 某笔账单 / 某门课 |
| `DataManager.jumpToSection` | 点「备份 / 同步 / 互传 / 还原」跳分区，数据管理页很长 |
| `WheelPicker.scrollToIndex` | 滚轮选择器整列滚动，**视觉位移最大**（松手吸附、上下翻一格都走它） |
| `main.js` 路由 `scrollBehavior` 锚点分支 | 带 `#hash` 的导航 |

修法按「单一入口」取舍：`WheelPicker` 的 4 个调用点（`scrollToIndex(next, 'smooth')`）**没有逐个改**，
而是把门控放进它唯一的程序化滚动入口 `scrollToIndex` 里——一处改动覆盖全部调用点，
写成与 `VirtualList` 完全相同的形态（`behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior`）。
另外三处是一行三元（`animationsEnabled() ? 'smooth' : 'auto'`）。

`animationsEnabled()` 的覆盖范围比 `prefers-reduced-motion` 更宽——它还包含设备偏弱（≤4 核 / ≤4GB / 省流量）
和用户手动选的「流畅优先」（`sl_performance_mode`），所以这一改同时服务了性能与无障碍两个诉求。

**（二）降级必须只降级「动画」，不能把功能一起降掉。** 所以每处都写成了
`smooth → auto` 而不是「不滚动」：位置照样跳过去，只是不再有滚动过程。
运行时测试专门锁了这一点（`两种模式下都仍然完成了定位`）。

**（三）守卫：源扫描 + 运行时，两层。** `tests/reducedMotionScroll.test.js`：

1. **规则一（精确）**：`behavior: 'smooth'` 这种**直接赋值字面量**，必须在它所在的**括号表达式**内
   出现 `animationsEnabled()`。门控后的写法 `behavior: animationsEnabled() ? 'smooth' : 'auto'`
   不再是「赋值字面量」，所以本规则只在**没门控**时命中——这正是检测力的来源。为了划准范围，
   写了 `enclosingExpression()` 取最内层括号表达式，而不是模糊的「附近几行」。
2. **规则二（粗但零假阳性）**：任何提到 `'smooth'` 的文件都必须引用 `animationsEnabled()`。
   这条专为**透传**形态而设——`scrollToIndex(next, 'smooth')` 把字面量当参数传给自己的滚动函数，
   规则一结构上看不见。它不看具体位置，所以可能有假阴性，但不会有假阳性，当前全仓命中 0、无需例外清单。
3. **运行时**：直接改 `performanceMode` 再调 `scrollAndHighlight`，断言传下去的 behavior
   分别是 `'auto'` 与 `'smooth'`。**源扫描只能证明「写了门控」，证明不了「门控真的生效」**，
   所以这一层不能省。

「允许动效」那一支本来就有既有测试守着（`dataManagerRestoreNav.test.js:69` 断言 `behavior: 'smooth'`）——
补上「减少动效」这一支之后两支才都锁住。**这一点是这次改动首要的风险**：降级不能把所有人的平滑滚动一起降了。

**（四）验证。** 四个变异全部报红：三处三元退回字面量 → 规则一逐条精确报出作用域
（`DataManager.vue → { block: 'start', behavior: 'smooth' }` 等）；`WheelPicker` 去掉门控与 import → 规则二报出该文件；
再单独把 `focusNavigation` 的门控摘掉 → **运行时测试也失败**（`强制「流畅优先」时，聚焦跳转改为瞬时定位`），
证明那三条运行时用例不是碰巧通过的。还原后 14 条全绿、0 残留。

**（五）一个自查更正的笔误**：改 `WheelPicker` 时我把 `wheelScrollTopForIndex` 误写成了
`wheelScrollTopForValueIndex`。因为紧接着核对了调用点与 `wheelPicker.js` 的导出名单，当轮就改回了——
这类改名笔误不会报错（`undefined` 调用要到运行时才炸），只能靠「改完全文核对符号名」发现。

### 1.28 实时区域不能藏在 `v-show` 里（第十七轮）

**（一）问题：`display:none` 的元素根本不在无障碍树里。**
顺着第十四轮的成果往下问一句「我补的那些 `role="alert"` 真的会被播报吗」，查出一类新缺陷：
**实时区域落在被隐藏的子树里时，属性写着却一个字也播不出来。**

实测到一例真缺陷：**作息设置弹窗的 OCR 进度与导入错误**，原本住在
`v-show="settingsTab === 'plans'"` 的作息方案区里。OCR 要跑好几秒，用户几乎一定会切到
别的标签页去等——一切走，这个区就是 `display:none`：

- 进度看不到（OCR 还在跑，界面却毫无反应）；
- 失败信息与 **`图片质量提示`**（`importError` 里拼进去的 `quality.warnings`）既看不到也听不到；
- `switchSettingsTab` **不会**清理 `importError`，所以这条错误会一直挂在隐藏区里。

已把 `<TaskProgress>` 与内联错误提到**标签区之外**，与同文件里 `settingError` 同级——
这不是新发明的结构，这个文件本来就把通用错误放在标签区上方。

**（二）`v-if` 不算，`v-show` 才算——这个区别是判据的核心。**
`v-if` 为假时元素**不存在**于 DOM，实时区域压根没渲染，只在真正显示时才存在，没有缺陷。
`v-show` 为假时元素**留在 DOM 里但 `display:none`**，于是「内容后来变了」这件事发生在
一个不可播报的节点上。判据因此只认 `v-show`。

还有一个对称的区分：**隐藏者写在实时区域自己身上**时，
- `aria-hidden="true"` / `hidden` → 这个区域永远不会播报 → **算缺陷**；
- `v-show` → **不算**：区域被隐藏与它未被显示本来就是同一件事，显示出来时它就在无障碍树里。

这两条区分都写进了判据注释与夹具，不是靠「反正现在命中 0」蒙过去的。

**（三）平扫漏掉了最典型的一例，所以判据必须递归进子组件。**
第一版平扫**只报出了同区的那个 `<p role="alert">`，漏掉了 `<TaskProgress>`**——
它在父模板里只是个自闭合标签，`role="alert"` 在它自己的模板里。
这正是我早前在报告里记过的边界（「源码扫描看不见子组件渲染出来的东西」），
所以这次直接复用第十三轮为 skip link 写的组件递归思路，抽出共享的
`makeComponentResolver` / `componentNameOf` / `isComponentTag`。

变异 A 单独把 `<TaskProgress>` 放回 `v-show` 区（内联错误留在外面）——**只有递归路径能抓到**，
它确实报了：`<TaskProgress>（组件内部）藏在 section（模板第 28 行，v-show）`。
变异 B 把内联错误放回去，报 `<p>（元素自己）藏在 section`。两条路径各有实证。

**（四）顺手清理了一处重复：带嵌套栈的模板遍历。**
这轮和上两轮的普查都在手搓同一个「开/闭标签 + 祖先栈」遍历，已收进
`tests/helpers/vueTemplate.js` 的 `walkElements()`（产出 `{ tag, attrs, raw, line, ancestors, selfClosing }`）。
同时把组件解析相关的三个小工具也移进共享模块，`landmarksAndRoles.test.js` 改为复用，
删掉本地副本（该文件 320 → 300 行，重构后 14 条测试仍全绿，其余 5 条共用辅助的守卫 60 条也全绿）。

**（五）一个自查记下的坑**：写变异脚本时用文本搜索定位 `v-show="settingsTab === 'plans'"`，
结果**先命中了我在代码里写的解释性注释**（注释里也引用了这个选择器），定位失败。
改成按真正的 `<section` 标签定位才对。解释性注释会让朴素的文本搜索失效——
这也是判据要区分「标签」与「注释文字」的同一个道理。

**（六）验证**：新增 `tests/hiddenLiveRegion.test.js` 7 条。全仓断言 = 0 处；两条变异各报出对应路径；
夹具覆盖三种藏匿（`aria-hidden` / `hidden` / `v-show`）、组件递归、自身隐藏者、
以及 `v-if`／可见区域／装饰组件／兄弟节点四类不误报。

### 1.29 `aria-hidden` 与「可聚焦元素」的错配（第十八轮）

**（一）先查了一个被点名过、却一直没人守的缺陷类别。**
`landmarksAndRoles.test.js` 里 `rendersFocusable()` 的注释早就写明：`aria-hidden` 只把元素移出
**无障碍树**，**不会**移出 **Tab 序**，所以「`aria-hidden` 里包着一个按钮」会造成最糟的一种组合——
键盘用户 Tab 进去、焦点框出现在看得见的地方，读屏却一个字都不念。注释把这称为
「**那本身是另一个缺陷**」。也就是说：这个类别被点名过、被解释过，只是一直没有守卫。
这一轮把那条注释指向的守卫补上了：`tests/ariaHiddenFocusable.test.js`。

全仓 26 个 `aria-hidden="true"`（图标、装饰层、滚轮高亮带……），**实测 0 处**含可聚焦元素：
这条缺陷在仓库里确实不存在。但「不存在」和「守得住」是两件事，现在都有变异实证。

**（二）写这条守卫时，我自己的代码里连出两个「假绿」——都由变异/夹具抓出来。**
1. **辅助函数 `walkElements` 的身份 bug。** 它 `yield` 一个字面量、又 `push` 另一个字面量当栈节点，
   于是 `d.ancestors.includes(el)` **恒为假**——祖先对象和已产出的对象只是长得一样，不是同一引用。
   后果是「后代」判定全部落空：**我先前那次 `aria-hidden` 普查报告的「全仓 0 处」是真空出来的**，
   不是真结论。夹具把它抓了出来（主仓断言全绿、夹具却红）。
   这与我在第十三轮记过的坑是同一个：`openTags` 每次产出全新对象，比较必须用下标、不能用引用。
   修法是先建 node、`yield` 它、再把它压栈——现在 `ancestors` 里就是**同一批对象**。
   （第十七轮的守卫用的是 `.attrs` 属性访问而不是身份比较，所以那一轮的结论不受影响。）
2. **判据漏掉了最常见的写法：`aria-hidden` 直接盖在组件自己身上。**
   我最初只在**后代**循环里做组件递归，而 `<Sidebar aria-hidden="true" />` 是自闭合的、没有后代，
   于是整个漏掉。变异实验（把 `aria-hidden` 加到 `<Sidebar>` 上）居然全绿，才暴露出来。
   已补上自检分支 + 夹具。**两次都是「变异/夹具说红、主仓说绿」——这正是它们的作用**：
   一条判据如果只有主仓断言，它既可能是真干净，也可能是探测器根本不动。

**（三）顺手修掉一条会误导排错的行号。**
`templateOf` 剥注释时直接删掉整段，导致模板内行号是「剥完之后的相对行号」：
`.tab-bar` 明明在文件第 1027 行，守卫却报 `@5`。现在剥除时用**等量换行补齐**，
模板内行号**等于文件行号**（skip link 报 273 = 真实 L273，`<Sidebar@274>` = 真实 L274）。
报错信息是给人看的，指不到位置的行号等于没给。

**（四）清掉一处恒真的死条件。**
`TimeSettingsModal.vue` 曾有 `<div v-show="genPreview !== null || true" class="gen-body" v-if="1">`：
两个条件都永远为真，元素其实无条件渲染。它不只是冗余——**它看起来像在门控**，
而这种「假装有门控」的写法正是上一轮那类缺陷（实时区域被藏在 `v-show` 里）的伪装。
已改为无条件渲染并留注释说明为何不能把条件加回来。
（判断记录：这类死条件全仓只有 1 处，严重度低，因此**没有**为它单开守卫——
把一个判据过度拟合到单例上，收益不如它带来的维护噪音。）

**（五）另外四类经典项实测全清**（都是可以精确判定、此前没有系统查过的）：
3 个 `<img>` **全部**有有意义的 `alt`（课程表图片/迁移二维码/同步二维码）；
`tabindex` 正数 **0 处**（不会打乱自然 Tab 序）；`target="_blank"` **0 处**；
内联 `<svg>` **0 处**（图标是 emoji/文字）；`touch-action` 在需要的地方都设了
（`SwipeActionItem` 是 `pan-y`，纵向滚动让给页面、横向滑动自己接管——写对了）。

**（六）一个查了、分析后决定不改的点：筛选器用了 `role="tablist"` / `aria-selected`。**
全仓 `role="tab"` 25 处、`role="tabpanel"` **0 处**、`aria-controls` **0 处**。分两类：
- **真标签页**（切换内容面板：个性化的三个分区、二维码迁移、设备绑定、作息设置的三组、安排类型）：
  缺 `role="tabpanel"`，标签与面板没有程序化关联。
- **筛选器**（过滤同一个列表：待办筛选、作息识别结果筛选）：按 APG，这类更该是
  `role="group"` + `aria-pressed` 的切换按钮——用 `role="tab"` 会让读屏念「标签页」，
  让用户以为会切面板。而且标签页模式要求**只有选中项可 Tab**（游走式），
  这两处实际是全部可 Tab：**角色与焦点模型都不符**。

分析后**没有改**，理由是具体的：`phase1Regression.test.js` 第 25–27 行**锁住**了
`role="tablist"` 与 `:aria-selected="filter ===`（该文件本会话未改动，是仓库自己的既有决定），
而筛选器用 `aria-selected` 虽有争议、在不少设计系统里**可辩护**，属于判断题而非缺陷；
仓库里 `aria-pressed` 也已有既定用法（`LedgerView.vue` 的日期格，附注释说明选择理由）。
推翻一个被回归测试锁住的既有决定，需要比「另一种写法更贴 APG」更强的理由。
**未做而非漏做**：已记入 §4 待决项，若要推进需先定「筛选器算不算标签页」这一产品语义。

### 1.30 伪按钮包着真按钮：账本固定账单行（第十九轮）

**（一）承接第十八轮那条被修正的结论，去重跑第十五轮的六项普查——找出了一个真缺陷。**
第十八轮发现「`aria-hidden` 子树含可聚焦元素」那项在第十五轮是**真空结论**（探测器用对象身份比较，
而遍历器压栈时新建对象，`ancestors.includes()` 恒为假）。那六项里还有一项同样依赖祖先判定——
**嵌套交互元素**。用修好的工具重跑，它报了 5 处，去掉我判据自身的假警（`listbox` **拥有** `option`
是正确结构，不是嵌套）后，剩下 **3 处真缺陷**，全在 `LedgerView.vue` 的固定账单行：

```html
<div class="card bill-row" role="button" tabindex="0"
     :aria-label="`编辑固定账单「${bill.name}」`" @click="openBillForm({}, bill.id)" @keydown.enter…>
  …
  <button @click="markPaid(bill)">已支付</button>
  <button @click="dismissPending(bill); skipOnce(bill)">跳过本次</button>
</div>
```

按 ARIA 规范，`button` 的子节点是 **presentational**——内层按钮的**语义被抹掉**：
读屏既听不到「已支付 / 跳过本次 / 恢复」是独立控件，还会把行名拼成
**「编辑固定账单「水费」 已支付 跳过本次」**。键盘用户 Tab 到这里听到的是一个按钮，
却实际有三个动作、其中两个无法获知。

**（二）修法：编辑入口改成真按钮，动作按钮做它的兄弟。**
```html
<div class="card bill-row" @click="openBillForm({}, bill.id)">   ← 行保留 @click（点空白处也能编辑）
  <button type="button" class="bill-main" :aria-label="`编辑固定账单「${bill.name}」`"
          @click.stop="openBillForm({}, bill.id)">              ← 真按钮，只包名称与金额
    <div class="b-main">…名称/日期…</div>
    <div class="b-amount">…金额…</div>
  </button>
  <div class="b-actions" @click.stop>                            ← 兄弟，语义完好
    <button>已支付</button><button>跳过本次</button>
  </div>
</div>
```
三个细节都是有理由的，不是随手写的：
- **行上的 `@click` 保留**：鼠标点行内边距（不是按钮的那圈 padding）仍能编辑，
  行为与改动前一致。这不违反键盘可达性判据——那条判据本来就有「同一动作表达式已落在
  可聚焦元素上则豁免」的通道，它注释里举的正是「卡片 + 紧邻的查看/编辑按钮」这种配对。
- **按钮上的 `@click.stop` 是必需的**：否则点按钮会冒泡触发外层行的 `@click`，同一动作执行两次。
- **CSS 由三列改两列**：`.bill-row` 原本是 `minmax(0,1fr) auto auto`（名称/金额/动作），
  现在名称与金额进了按钮内部，所以行改为两列，按钮内部再分两列、间距同为 12px——
  逐项对齐原排布，视觉不变。窄屏同步改为单列（留一列会空出半行、金额也贴不到最右边）。
  按钮必须重置浏览器默认外观（`padding/border/background/font/text-align`），否则整块变形。

**（三）没有再犯「只改源码不验效果」的错：加了渲染 DOM 级测试。**
`LedgerView` 已经能被 `createApp` 直接挂载（`ledgerViewStartup.test.js` 就是这么做），
所以没有理由只停在文本层面。新增 `tests/ledgerBillRowDom.test.js`：预置 `sl_bills` 后真实挂载，
断言 **每行都有一个 `<button.bill-main>`（`tabIndex === 0`、有 `aria-label`）、它内部
没有任何真实控件、`.b-actions` 是它的兄弟、行本身不再有 `role`/`tabindex`、
名称与金额仍留在按钮内**。
> 注：`useStoredRef` 按 key 全局缓存（`store/core.js:304`），`sl_bills` 首次挂载后不再读
> localStorage，所以这个文件只能有一个 `it`，数据必须在首次挂载前就位——这一点写在文件头。

**（四）三条变异，各自证明一条独立断言。**
| 变异 | 期望变红的断言 | 实测结果 |
|---|---|---|
| 给 `.b-actions` 加 `role="button"`（它里面有真按钮） | 全仓 `findNestedControls` 普查 | ✅ `views/LedgerView.vue <div@1272> button 里含 button@1273、button@1274` |
| 给「已暂停」行加回 `tabindex="0"` | 只该由反向断言抓到（普查抓不到） | ✅ 只有「固定账单行」那条变红，普查仍绿 |
| 把动作按钮组移**进**编辑按钮内部 | DOM 测试的「编辑按钮里不该有控件」 | ✅ 失败信息正是真实症状：`宽带已暂停 · 下次 …¥60.00恢复：编辑按钮里不该有控件` |

**（五）新增判据收口整类**（`keyboardReachability.test.js` 的 `findNestedControls`）：
任何**带交互角色**（`button/link/checkbox/radio/switch/tab/option/menuitem…`）或**原生交互元素**
都不得包含真实表单控件。刻意**不**把 `listbox` 算作父级——它拥有 `option` 是正确结构，
算进去会直接假警（这条边界由判据自己的夹具钉住）。全仓实测 **0 处**。

**（六）六项普查的最终状态**（都用修好的工具重跑）：重复 `id` **0**、`<label for>` 悬空 **0**、
嵌套交互元素 **3→0（本轮修掉）**、静态 `id` 在 `v-for` **0**、无 `href`/`href="#"` 的 `<a>` **0**、
`aria-hidden` 含可聚焦元素 **0**。
> 补充说明：`<a>` 全仓只有 1 个（skip link），其余链接都是 `<RouterLink>` 组件——
> 所以「链接有没有真 href」这条实际覆盖面很窄，`RouterLink` 必然渲染 href，不存在该类缺陷。

### 1.31 404 页嵌套 `main`：路由视图重复声明外壳地标（第二十轮）

**（一）真缺陷。** 顺着「重复地标是否可区分」这条线扫全仓（53 个 `.vue`、14 个顶层地标），
查出 `NotFoundView.vue` 自己就是 `<main class="route-not-found">`——而它是**路由组件**
（`main.js:167` 的 `/:pathMatch(.*)*`），经 `<router-view>` 渲染在 `App.vue` 的
`<main id="main-content">`（L281-289）**内部**。于是渲染出的文档里出现**嵌套 main**：

1. HTML 规范：一个文档只能有一个 `main`，且 `main` 不能是 `main` 的后代；
2. 读屏的地标导航里冒出两个「主内容」，用户无从分辨；
3. 内层那个按规范是无效的，**部分实现直接忽略它**——404 页的内容就失去了区域。

**（二）修法**：改成 `<div class="route-not-found">`。
它的样式全走 `.route-not-found` 类选择器（没有把 `main` 当选择器），所以**外观不变**；
`<h1>页面不存在</h1>` 保留，App 的 `<main tabindex="-1">` 仍是 skip link 的落点。

**（三）变异实证：这个缺陷在运行时是真的，不只是理论。** 把代码改回 `<main>` 后，
渲染 DOM 实测 `querySelectorAll('main')` 返回 **2**：

```
AssertionError: expected …(2) to have a length of 1 but got 2
```

两条守卫同时变红（源码侧 + DOM 侧），还原后 18/18 全绿、0 残留。

**（四）新增守卫**（`landmarksAndRoles.test.js`）：**只有应用外壳可以声明 `main`**。
`main` 标签与 `role="main"` 都算（变异 B 用 `role="main"` 验证过，精确报出
`views/TodayView.vue <div@308>`）；其余文件一个都不能有。并**自证不空转**：
外壳必须恰好有一个 `main` + 扫描规模下限（>45 文件）——否则这条可能只是"没扫到"。
夹具覆盖：`main` 标签、`role="main"`、修好后的 `div`、`role="mainx"`、
`class="main-content"`，以及**注释里的样例代码**（走真实管线 `templateOf` 证明上游已剥注释）。

**（五）补一个渲染 DOM 级测试**（`tests/notFoundViewDom.test.js`）：复刻 App.vue 的结构
（`<main id="main-content">` 里挂路由视图）后挂载真实 `NotFoundView`，断言文档里仍只有
一个 `main`，且 404 的内容、类名、`h1`、`404` 字样、返回首页真链接都在。
`createWebHashHistory` 是按真实路由方案选的，不是随手挑的。
> 这个测试同时补了一个覆盖空白：**在此之前没有任何测试渲染过 404 页**——
> 而我恰好改了它的标签，没有这层验证就等于"改完不知道坏没坏"。

**（六）用修正语义重扫全仓地标，确认没有遗漏。** 上一版扫描器把**嵌在 `<main>` 里的
`<header>`** 也算成 banner（规范里嵌在 article/aside/main/nav/section 内的 header/footer
**不是**地标），属假警方向。修正后（另加「无名的 `<form>` 不是地标」「显式 role 覆盖原生语义」）：
53 个文件共 14 个顶层地标，**无不可区分的重复**。

**（七）两处经核实后「不改」**：
- **路由切换不移动焦点**：`App.vue:196-197` 写明了这是有意的选择——"单页应用切换路由时
  焦点不动，没有播报的话键盘/读屏用户察觉不到已经换页了"。播报（`announce` + 路由标题）
  与 `document.title` 都做了，属可辩护做法，且理由在代码里，不是漏改。
- **`Sidebar.vue` 有两个 `<nav>`**（L164 桌面、L183 手机）：各有**不同**的 `aria-label`
  （"主要导航"/"手机主要导航"），满足"多个同类地标必须各自可命名"的要求，可区分。

### 1.32 「更多功能」浮层缺 Escape 出口，以及一条**不健全守卫**被自己的变异实验抓出（第二十一轮）

**（一）先扫了五类"移动端/表单项"，全部合格（记录在案，不是缺陷）。**
`viewport` 是 `width=device-width, initial-scale=1.0, viewport-fit=cover`，
**没有** `user-scalable=no`/`maximum-scale`（WCAG 1.4.4 允许缩放）；`env(safe-area-inset*)`
在 12 个文件里出现 20 次（刘海屏/home indicator 都让开了）；3 个 `<img>` 全有 `alt`；
2 个 `<form>` 都带 `@submit.prevent`；`type="number"` 本身已给出数字键盘，
`inputmode` 另有 13 处显式声明。

**（二）监听器与观察器一类也合格。** 9 个用到 `addEventListener` 的文件
`add`/`remove` 全部成对；`ResizeObserver` 只在 `VirtualList` 用了一次；定时器
`clearInterval`(7) 多于 `setInterval`(6)、`clearTimeout`(46) 多于 `setTimeout`(32)。
`Modal.vue` 一开始显示 `add=4 / remove=2` 看着像泄漏，实际是**我正则的假象**：
它有两处写成 `removeEventListener?.('…')` 的可选调用，`removeEventListener\(` 匹配不到，
而运行时是 4/4 成对的（`viewportListening` 幂等标志 + `onBeforeUnmount(cleanup)`）。
`:key="index"` 那 12 处也逐条看过：多数是对象键（`(item, key) in OBJ`，`key` 是稳定字符串）
或静态列表，不存在串状态风险。

**（三）真缺口：`Sidebar.vue` 的「更多功能」浮层按 Escape 不关。**
`Modal`、`ActionSheet`、`ContextMenu` **三个浮层都处理 Escape**，只有这个自造浮层漏了——
键盘用户必须一路 Tab 到「关闭更多功能」那个 × 才能收起来。这不是新立的规矩，
而是**与仓库自身约定不一致**。已按同一约定补上，并做**焦点归位**：

```js
function onMoreSheetKeydown(event) {
  if (event.key !== 'Escape' || !showMobileMore.value) return
  const focusWasInside = !!moreSheetEl.value?.contains(document.activeElement)
  showMobileMore.value = false
  if (focusWasInside) moreTriggerEl.value?.focus()
}
```
- **焦点必须归位**：浮层一关，里面的元素就从 DOM 消失，焦点会掉到 `body` 上，
  键盘用户等于被丢回页面开头。
- **但只在焦点原本就在浮层里时才拉回来**，否则会把用户在别处的焦点抢走。
- 只挂一个常驻监听（侧边栏本来就一直在挂载状态），用 `showMobileMore` 判断。
  确认过 `App.vue` 的全局 keydown 只管 Ctrl+K 与数字 1-6，**不碰 Escape**，不冲突。

**（四）运行时测试**（`tests/sidebarMoreSheetEscape.test.js`，真实挂载 `Sidebar` 派发 keydown）：
关闭生效 + 焦点归位 + 两条**精度**（浮层没开时无动作；焦点在别处时不抢）。
变异实验：A 让处理器不认键 → 2 条红；B 去掉"焦点原本在浮层里"的判断 →
**只**第三条红，证明精度断言不冗余。
> 附带一个测试环境知识：浮层是 `v-if` 包在 `<Transition>` 里的，状态翻转后元素
> **不会立刻**从 DOM 消失（要等离场；无 CSS 时长时 Vue 靠 `nextFrame`，即两次 rAF）。
> 不补这两帧会把"Escape 没生效"误判成缺陷——实测确认。

**（五）新守卫 `tests/overlayEscape.test.js`：自造浮层必须有 Escape 出口。**
类名含 `mask/overlay/sheet/backdrop/popover`（要求落在 `-`/空格/首尾的**词**边界上，
所以 `damask` 不算）或角色是 `dialog/alertdialog/menu/menubar` 的，源码里必须有 Escape 处理；
用了 `<Modal>`/`<ActionSheet>` 的自动放行（它们自己处理，重复实现反而打架）；
`role="listbox"` 刻意不收——`QuickRecordPanel` 的分类选择器是**内联展开**，不是浮层。

**（六）这一轮最有价值的部分：变异实验抓出了我自己的守卫不健全。**
第一版判据只搜 `Escape` 这个词。变异实验（把 Sidebar 的处理器删掉、注释里仍留着
"Escape"字样）**判据照样全绿** ✗ —— 也就是说它只证明「文件里有人提过 Escape」，
证明不了「按键真的被处理」。这正是我前几轮一直在纠正别人的那类问题，轮到我自己头上了。
两步修正：
1. 要求**真实比较写法**（`===` / `==` / `!==` / `!=`，两侧都算，另加 `case 'Escape':`），
   并且只在**剥掉注释之后**的代码里找（新增 `stripComments`，同时处理 JS 注释、
   HTML 注释，且保留字符串内容）。修完之后，同一条变异**变红了**。
2. 放宽过程中签名又过窄：`Sidebar` 自己用的是 `!== 'Escape'`，只认 `===` 会把**已经修好**
   的代码报成缺陷（假警方向）。补上反向比较后恢复正常，并在夹具里把
   `!==` 与 `case` 两种写法都钉住。
3. 另加两条夹具钉住"不健全"本身：**注释里提到 Escape** 不算、**字符串 `'Escape'`** 不算。
4. 自证不空转：断言真的点出了 ActionSheet / ContextMenu / Modal / Sidebar 四个已知浮层，
   并且判据写坏时这条会失败（实测：把类名关键词改成永不匹配 → 该断言与夹具同时变红）。

### 1.33 课表模板的「保存日期」走设备时区，与应用时区策略不一致（第二十二轮）

**（一）先扫了两类"最容易埋静默数据错误"的写法，都合格（记录在案）。**
- **金额**：全仓**没有**裸浮点金额运算（`.amount + .amount`、`.amount * x` 各 0 处）、
  没有 `parseFloat`；`toFixed` 6 个文件都是显示格式化，`* 100` 6 个文件都是进度百分比。
- **日期键推导**：全仓**没有** `toISOString().slice(0,10)` 这类"用 UTC 日期当业务日期"的写法
  （0 处），也没有 `new Date().getDate()/getMonth()` 这类用设备日期当"今天"的写法（0 处）。
- `LedgerView` 的月份加减（`shiftMonth`）与月历首日星期几（`calendarCells`）用的是
  `new Date(y, m-1+delta, 1)` + `getFullYear/getMonth/getDay`——这不是上面那类 bug：
  它是把 `Date` 当**纯日历计算器**（本地构造、本地读回，等价于模运算），
  而"某月一号是星期几""某月有几天"是**时区无关**的日历事实，不泄漏 instant 语义。**判定正确，不改。**
- `ExceptionsModal.vue:44-47`、`WeeklyReviewView.vue:30` 同理（后者还显式拼了 `T00:00:00`
  按本地午夜解析）——输出与任何时区策略下的日历日一致，**判定正确，不改**。

**（二）真缺陷：`CourseManagerModal.templateDate` 按设备时区渲染纯日期标签。**
```js
// 旧：模板的 createdAt 是 ISO 时间点（courseTemplates.js:24 用 new Date().toISOString() 写入）
function templateDate(value) { return new Date(value).toLocaleDateString('zh-CN') }
```
`toLocaleDateString` 走**设备**时区，而全应用其它日期都走 `policyDateKey` / `formatAppDate`
（用户在设置里选的时区，可选 `local` / `Asia/Shanghai` / `UTC`）。用户把时区配成非设备时区时，
这个**纯日期**标签会与全应用差一天，出现"模板保存于明天"这种自相矛盾的显示。

**这不是新立的规矩**：仓库专门写了 `createdDateKey`（`settingsPolicy.js:118`）做
"createdAt → 日期键"这件事，它上面 L113-116 的注释描述的就是这个坑
（"…在 UTC+8 的 00:00–08:00 两者会差一天…"）——只是这里漏用了。已改为：
```js
function templateDate(value) {
  const key = createdDateKey(value)                     // createdAt → 策略时区下的日期键
  return key ? formatAppDate(key, { withWeekday: false }) : ''
}
```
顺带修掉旧写法的**第二个毛病**：`createdAt` 非法时旧代码会渲染出 **"Invalid Date"**，
现在走 `createdDateKey` 的守卫返回空字符串。

**（三）刻意保留：`DataManager` 的 4 处同步时间点标签不改。**
`fullTime` / `fmtTime` 的入参全是同步时间点（`lastSeenAt`、`remoteUpdatedAt`、
`lastBackupAt`、`lastSyncedAt`、`lastCheckedAt`），`LocalTransfer.vue:500` 也一样。
它们显示的是**带时刻的时间点**，而用户对"这台设备几小时前活动过"的参照本来就是**设备时钟**；
应用的时区策略管的是"哪一天"（日界语义），不是"几点"。所以按设备时区渲染是合理的，
改成策略时区反而会让"刚刚同步过"读起来别扭。**判定为正确，不改**，理由记在这里。

**（四）测试 `tests/courseTemplateDate.test.js`（真实挂载 + 两个时区各断言一次）。**
挂载 `CourseManagerModal` 时踩到一个坑：`Modal` 用 `<Teleport to="body">`，
内容不在挂载点里，必须从 `document.body` 查（第一次写成 `host.querySelector` 得到 `null`）。
断言设计有一处**必须解释**的细节：只断言一个时区是不够的——
本机设备时区是 UTC+8，若只断言 `UTC` 那次，把实现偷懒改成
`new Date(v).toISOString().slice(0,10)` 恰好给出**同样结果**，测不出来
（这正是我第一版测试的真实失误：变异 B 当时**没变红**）。
所以对两个非 `local` 时区**各断言一次**，并加两条**区分力自检**：
"至少一个策略时区与设备不同" 与 "`Asia/Shanghai` ≠ `UTC`"。
两条合起来才能保证两类变异都跑不掉——一条防"按设备时区渲染"，一条防"偷懒取 UTC"。

**（五）变异实验四例**（正确实现全绿后再逐条打坏）：

| 变异 | 结果 |
| --- | --- |
| A 改回 `new Date(value).toLocaleDateString('zh-CN')`（旧写法） | ✅ 变红（UTC 时区那条 + "Invalid Date" 那条） |
| B 偷懒取 `toISOString().slice(0,10)` 当日期键 | ✅ 变红（`Asia/Shanghai` 那条） |
| C 忽略策略时区（传 `'local'`） | ✅ 变红 |
| D `value && createdDateKey(value)` | 绿 ——**正确结果**：这是**等价变异**，与正确实现行为完全相同，不该硬去抓 |

> 记一条方法论：变异实验的结果不是"越红越好"。D 这种**等价变异**变绿恰恰说明判据没有
> 捕捉无关的写法差异（否则维护者会被无意义的改动逼着改测试）。要区分的是
> "**抓不住真缺陷**"（B 第一版就是这样，必须修）和"**抓不住等价变异**"（本来就该绿）。
>
> 另记一个 PowerShell 教训：变异脚本里用 here-string 传含**反引号**的模板字符串
> （`` `${d.getFullYear()}-…` ``）会被 PowerShell 当转义符吃掉，把源文件写坏，
> 结果是 `no tests`（收集到 0 个用例）而不是变红——**"没变红"和"根本没跑"必须分清**，
> 否则会把无效实验误读成"判据抓不住"。改用 .mjs 文件传参即可。

### 1.34 全局错误提示的播报不可靠：最该被听见的一条走的是最不可靠的通道（第二十三轮）

**（一）先核实了两类健壮性说法，其中一条是"我差点误报"的经历。**
- **存储值损坏**：`useStoredRef` 读失败有 try/catch 回退并上报 ✓，`normalizeStoredValue`
  按默认值形状修复（数组/对象/原始类型逐类判断，数字键对象还原成数组，并回传 `repaired`）✓
  —— 这一类**不是缺陷**。
- **全局错误兜底**：我第一次扫"有没有 `app.config.errorHandler`"时**扫错了范围**
  （只扫 `.vue` 与 `main.js` ✗，且正则用的是 `errorHandler`，匹配不到
  `installGlobalErrorHandling` 这个名字 ✗），于是差点报出"应用没有全局错误处理"这个**假缺陷** ✗。
  实际 `main.js:191` **确实**调用了 `installGlobalErrorHandling(app)` ✓，
  `unhandledrejection` 也接上了 ✓ —— **这一类是干净的**。
  > 记一条教训：扫描结论的可信度**只等于模式本身**。"0 处"必须连同"我找的是什么写法"一起说，
  > 否则一个漏掉 `.js` 文件或大小写差异的正则就能凭空造出一个缺陷。

**（二）真缺陷：错误提示有一条不可靠的播报通道，而且是唯一的一条。**
`liveRegion.js` 开头明确记着：`v-if` 插入的"新节点带内容"，VoiceOver 一类读屏
**可能一个字都不播**（有些实现只监听既有节点的文本变化）。仓库因此造了**常驻**播报区，
并把它用在了路由切换上（`App.vue:204`）——但**全局错误提示只有 toast 上那个
`role="alert"`**（`v-if` 插入，正是踩坑的那种写法）。偏偏出错是全应用最需要被听见的时刻：
用户眼前页面已经坏了，如果连听也听不到，就彻底不知道发生了什么。
App.vue 里三处 app 级提示（安全模式、持久化失败、全局错误）**全都是 `v-if` 插入的 `role="alert"`**。

**（三）修法：把播报接进错误管线，而不是散在 App.vue 的 watcher 里。**
```js
// liveRegion.js：新增常驻的 assertive 通道
export const liveAlert = ref('')
export function announceAlert(message, { clearAfter = 0 } = {}) { … }

// globalError.js：错误管线自己负责播报（这样不用挂载整个 App 就能验证）
function report(kind, error, info) {
  lastGlobalError.value = { … }
  announceAlert(GLOBAL_ERROR_NOTICE)   // ← 新增
  …
}
```
- **两条通道各用一套定时器**：共用的话，一句"某页面已打开"（礼貌）会把刚刚排队的错误播报
  挤掉，而那恰恰是最不能丢的一条。有专门的测试钉住这件事。
- `App.vue` 新增常驻的 `role="alert" aria-live="assertive" aria-atomic="true"` 容器（`sr-only`）✓。
- 全局错误 toast **去掉 `role="alert"`**：它随状态插入，语义上本来就该由常驻通道承担；
  去掉后也顺带避免"播报区 + toast"把同一句话念两遍。toast 本身与两个按钮照旧。
- toast 文案改为直接渲染 `GLOBAL_ERROR_TITLE` / `GLOBAL_ERROR_BODY`，
  播报句由这两个常量拼成 —— **视觉与听觉不可能各说一套**，并有守卫钉住"不许出现硬编码副本"。

**（四）测试 `tests/globalErrorAnnouncement.test.js`（9 条）。** 驱动方式与既有
`globalError.test.js` 一致（`installGlobalErrorHandling({config:{}})` 拿 `errorHandler` 入口）✓：
渲染错误与 Promise 拒绝都走紧急通道、**不占用礼貌通道**（精度）、连错两次仍会播报
（"先清空再写入"的意义）、两条通道互不打断、`clearAnnouncement` 清两条。
另含两个守卫：**播报通道必须常驻**（`sr-only` 的实时区域不得带 `v-if`/`v-show`/`aria-hidden`/`hidden`）
与**文案同源**（App.vue 不得出现硬编码文案副本）。

> 夹具当场抓出了我守卫的第一版漏洞：只认 `role="alert|status"` 会**漏掉仅用 `aria-live`
> 声明的区域**（`<div class="sr-only" aria-live="polite" aria-hidden="true">` 直接漏过 ✗）。
> 已按 `hiddenLiveRegion.test.js` 的同口径（role **或** aria-live）修正。

**（五）变异实验六条全红，且失败条数精准对应**：

| 变异 | 结果 |
| --- | --- |
| A 删掉 `announceAlert` 调用（错误不再紧急播报） | ✅ 4 条红 |
| B 错误发到礼貌通道（级别不够） | ✅ 4 条红 |
| C 两条通道共用定时器（紧急播报会被挤掉） | ✅ 4 条红 |
| D 播报区改成 `v-if` 插入 | ✅ **1** 条红（常驻守卫） |
| E 播报区降级成 `polite` | ✅ **1** 条红（级别断言） |
| F toast 文案改回硬编码 | ✅ **1** 条红（同源守卫） |

**（六）刻意未做（同一类，留在待办）**：`App.vue:293` 安全模式提示与 `:300` 持久化失败提示
同样是 `v-if` 插入的 `role="alert"` ✗，出于同样的理由也该走常驻通道。
它们由 App 的状态标志驱动、不在错误管线里，要验证得先有**挂载整个 App 的测试夹具**
（这与 §4 里"渲染 DOM 级标题顺序守卫""真实 Tab 顺序守卫"缺的是同一件东西）。
本轮先把**错误管线**这条闭合（可独立验证 ✓），这两处连同 App 级夹具一起留待后续。

### 1.35 闭合同一类：外壳里另外六处提示也走常驻播报；并补上"能挂载整个外壳"的夹具（第二十四轮）

**（一）上一轮只修了错误管线，外壳里还剩六处同样形状的提示。**
`App.vue` 的模板里，除了全局错误 toast，还有五处外壳级提示 + 一个成功 toast，
**全都是 `v-if` 插入的新节点自带 `role="alert"` / `role="status"`**：

| 位置 | 提示 | 级别 | 驱动状态 |
| --- | --- | --- | --- |
| `App.vue:299` | 本机安全模式 | alert | `localSafeMode` |
| `App.vue:306` | 本机保存需要注意 | alert | `persistenceState.status === 'error'` |
| `App.vue:314` | ✓ 本机保存已恢复 | status | `persistenceState.status === 'recovered'` |
| `App.vue:317` | 自动同步状态（冲突/离线/需恢复/云端不可用） | status | `autoSyncState` |
| `App.vue:323` | 已有 7 天未备份 | status | `showBackupNudge` |
| `App.vue:401` | ✓ 快速记录成功 | status | `quickRecordToast` |

现在模板只负责画出来，发声统一交给外壳里**常驻**的播报区：错误走 assertive、
提醒与成功走 polite；行内 `role` 一律去掉，顺带避免"播报区 + 提示条"把同一句念两遍。

**（二）新增基础设施：`tests/helpers/mountApp.js`（能挂载整个应用外壳）。**
这几处提示由外壳自己的状态驱动，**不挂载就没法把它们推到"该提示"的状态**。
夹具用**桩路由**（`App.vue` 只提供外壳，断言外壳不该顺手拉起全部懒加载视图）、
提供 `settle()` 与 `unmount()`，并在文件头写明"用完必须卸载，否则播报内容会漏到下一个用例"。
> 这件基础设施同时解开了 §4 里两项长期待办：**渲染 DOM 级标题顺序守卫**与
> **真实 Tab 顺序守卫**——此前它们缺的正是"能把 App 挂起来"。
> 冒烟结果：外壳在 happy-dom 里挂载成功，跳过链接 ✓、唯一 `<main>` ✓、两条常驻播报通道 ✓
> 都在渲染结果里（第二十轮那条"唯一 main"守卫在**渲染后**同样成立）。

**（三）顺带删掉一处重复代码。** 自动同步提示的标题与正文原先**各写一遍同样的嵌套三元链**
（改一处漏一处），现在集中成 `autoSyncNotice` 计算属性，模板与播报共用。

**（四）两个"监听什么"的坑，都写进注释了。**
- 自动同步提示若监听那个**每次重算都是新对象的提示对象**，内容没变也会反复播报 ✗
  → 改为监听**文本**（`autoSyncNoticeText`）✓，测试里专门钉住"重算不重复播报"。
- 快速记录提示若挂在 `Boolean(quickRecordToast)` 上 ✗：**连记两笔时 toast 一直显示、
  布尔值不变，第二笔的播报就丢了** ✗ ✓ → 改为监听**消息文本** ✓。

**（五）零例外守卫**（`tests/appShellAnnouncements.test.js`，7 条）：
- **外壳模板里只剩两条常驻播报通道**（断言实时区域恰好 2 处且都是 `sr-only`）——
  零例外，不需要白名单 ✓；
- **提示条文案不得在模板里留硬编码副本**（逐个常量核对）。

**（六）变异实验七条全红**：

| 变异 | 结果 |
| --- | --- |
| A 安全模式提示条改回行内 `role="alert"` | ✅ 2 条红（守卫 + "role 为 null"断言） |
| B 模板里写死安全模式文案 | ✅ 1 条红（同源守卫） |
| C 删掉安全模式的播报 watcher | ✅ 1 条红 |
| D 本机保存失败改用礼貌通道（级别不够） | ✅ 1 条红 |
| E 同步提示改监听对象（内容没变也重复播报） | ✅ 1 条红（精度） |
| F 快速记录 toast 改回行内 `role="status"` | ✅ 1 条红（守卫） |
| G 保存恢复改用紧急通道（把好消息当警报喊） | ✅ 1 条红 |

**（七）刻意不做的部分（写清楚，不含糊）**："7 天未备份"与自动同步状态这两处在挂载期由
计时器/同步协调器驱动，测试里**不去伪造它们的时序**（伪造时序比不测更容易变成假绿 ✗）；
它们的**标记与文案**由上面的守卫覆盖（无行内 role、文案取自常量 ✓），
行为则由 `needsBackup` / `autoSyncState` 各自已有的测试覆盖 ✓。

### 1.36 渲染 DOM 级标题顺序守卫；顺带修掉 router-view 被套进 Transition 的真实缺陷（第二十五轮）

**（一）新增守卫：把真实页面渲染出来再查标题顺序。**
先补上一件必需的基础设施：把路由表从 `main.js` 抽成 **`src/router/routes.js`** ✓。
理由是**路由是数据**——守卫必须针对**同一份**真实路由断言，另抄一份必然随实现漂移，
那就不是守卫了（`main.js` 只负责装配，懒加载与失败兜底行为一字未改）。
标题判定放进 `tests/helpers/renderedHeadings.js`。

守卫逐个打开 **10 个真实页面**（含 404 兜底 ✓），检查：

| 规则 | 为什么 |
| --- | --- |
| 页面内容里恰好一个 `h1` | 读屏用户靠它确认"这是哪一页"；0 个或 2 个都会含糊 |
| `h1` 必须是**第一个**标题 | 否则按标题跳转时第一个落点是半截的小节 |
| 相邻标题不得跳级 | `h2 → h4` 让"按标题跳转"出现断层 |
| 整个文档里 `h1` 不得跑到 `main` 之外 | 防止顶级标题散落到页面之外 |

**（二）真实缺陷：`<router-view>` 被放在 `<Transition>` 里。**

`App.vue` 原来写成 `<Transition name="page" mode="out-in">` 包住 `<router-view v-slot=…>`——
**vue-router 4 明确不支持这种写法**（正确形式是 router-view 在外、Transition/KeepAlive 在
`v-slot` 内部）。后果有两个，都是"界面看着还行、代码已经写错"的类型：
1. **每次切路由都在控制台打一条警告**；
2. 过渡与 `keep-alive` 的包含关系不按作者预期生效——作者以为有页面切换动画。

已按官方写法改正 ✓，并新增守卫：**导航过程中不得出现
`router-view` / `transition` / `keep-alive` 相关的框架警告** ✓。
> 这条缺陷是靠"挂载整个外壳、打开真实路由"才看见的：静态扫描永远看不到运行时警告。

**（三）诚实纠错：账本页的 `h3` 空态**不是**跳级。**
本轮开工时我按静态推断认定"`h1` 之下出现 `h3` 就是跳级"（`LedgerView` 三处 `EmptyState`
没传 `:level` → 默认 `h3`），**这个判断是错的** ✗。渲染后的真实序列是：

```
h1:账本  →  h2:最近记录  →  h3:还没有记录
```

空态 `h3` 正好挂在"最近记录"这个 `h2` 小节之下，**层级正确** ✓；
空态组件"默认 h3、在页面 h1 直下时显式传 `:level="2"`"的设计与 8 处调用点的用法都是对的 ✓。
**静态推断不等于渲染结果**——这正是本守卫存在的意义。
10 个真实页面的完整序列（今天 `h1→h2→h2`、课程表 `h1`、待办 `h1→h2`、重要日期 `h1→h2`、
日程 `h1→h2`、清单 `h1→h2`、账本 `h1→h2→h3`、回顾 `h1→h2`、笔记 `h1→h2`、404 `h1`）
**全部不跳级** ✓。

**（四）两个坑，都写进注释了。**
- **懒加载要等真实时间**：视图的模块图很大（OCR、表格解析…），从导航到渲染约需 **200ms**。
  只等两帧 `rAF` 会在 `route-fallback` **加载占位**上就收工，然后报"一个标题都没扫到" ✗——
  那是**守卫跑得太早**，不是"守卫在守空气"。两者必须分清，所以代码里同时保留了
  真实时间轮询与规模自证（页面数 ≥9、标题数 ≥9）。
- **判定函数不能从测试文件 `import`** ✗：那会连带执行它的顶层代码、注册并运行它的用例，
  是"两个测试文件互相污染"的经典写法（我这次就踩了，于是把 helpers 抽了出来）。

**（五）"全绿"有两种：退出 0 的，和退出 1 的。**
本轮 `npm run check` 一度返回 **1**，而 lint / typecheck / test / build **单独跑全是 0** ✗。
真相是一个**未处理的**异步错误：

```
TypeError: … Received 'file:///@vite-plugin-pwa/virtual:pwa-register'
```

本守卫加载**真实页面**时碰到了 `appUpdate.js` 里的构建期虚拟模块 `virtual:pwa-register`，
于是所有用例照旧全绿、vitest 却因未处理错误整体退出 1，表现为**"偶发检查失败"** ✓。
修法是照仓库既有约定（`backupIntegrity` / `dataManagerRestoreNav` / `dataManagerSync`
三个测试都是这么写的 ✓）显式 mock；坑已写进 `mountApp.js` 的文件头——**桩路由的测试碰不到它，
挂真实路由的必须 mock**。
> 教训：只看"Tests N passed"不足以判断全绿，必须看 **exit code**。

**（六）顺带清理与一个记录在案的工具缺口。**
抽取路由表后 `main.js` 里留下 7 个死导入（`defineComponent` / `shallowRef` /
`onBeforeUnmount` / `ref` / `h` / `routeLoaders` / `RouteFallback`），已清掉 ✓。
**但 lint 全程没报过它们**——`eslint.config.js` 只用了 `eslint-plugin-vue` 的 `flat/essential`
加几条基础规则，**没有开 `no-unused-vars`** ✗。
探针显示全库有 **54 处**未使用，**本轮刻意不开** ✓，理由具体：
其中有 `const courses = useStoredRef('sl_courses', [])` 这类**刻意的预热注册** ✗
（删掉会改变启动行为），而 `<script setup>` 里仅被模板使用的组件又会被误报 ✗。
开这条规则需要先区分"真死代码"与"预热/注册"，是独立一轮的量，这里只记录缺口本身。

**（七）变异实验三条全红**：

| 变异 | 结果 |
| --- | --- |
| A 把 `router-view` 放回 `Transition` 里（本轮修掉的真实缺陷） | ✅ 1 条红（框架警告守卫） |
| B 重要日期空态去掉 `:level="2"`（造出 `h1 → h3` 真跳级） | ✅ 1 条红（跳级规则） |
| C 在判定函数里挖洞：不再检查 `h1` 数量 | ✅ 1 条红（夹具自证抓住） |

**（八）已知边界（写清楚）**：判定可见性靠遍历祖先的
`display:none` / `visibility:hidden` / `hidden` / `aria-hidden="true"`——
`v-show` 隐藏的标签页面板因此不会污染标题序列（课程表等页面正是这么切标签的）；
**纯靠样式表类名隐藏**的标题看不到，属于已知边界。

### 1.37 渲染后的 Tab 顺序与可访问名称守卫；修掉"选中态只存在于视觉里"的真实缺陷（第二十六轮）

**（一）补的是哪块空白。** 仓库已有三个相关守卫，覆盖的都是别的角度：
`formControlNames.test.js` 是**静态**扫表单控件、而且带**存量棘轮**（有 baseline 上限）；
`keyboardReachability.test.js` 只扫"只有鼠标能触发"的 `div`/`span`/`li`/`td`/`tr`；
`accessibleNames.test.js` 只针对少数具体组件。
**"渲染后全站、按钮与链接这类非表单控件、以及 Tab 顺序本身"此前没人管** ✓。

为什么必须渲染后查：全站源码里只有 **1 个** `<a>`——导航全是 `<RouterLink>`，
只有渲染之后它们才变成真正可聚焦的 `<a href>` ✓。

**（二）真实缺陷：侧栏主题色的选中态只存在于视觉里。**

| 位置 | 标记 | 问题 |
| --- | --- | --- |
| `Sidebar.vue:326` 侧栏 6 个主题按钮 | 只有 `class="on"` ✗ | **没有任何 ARIA** |
| `AppearanceSettings.vue:345` 个性化面板同一功能 | `:aria-pressed="themeKey === key"` ✓ | 正确 |

于是**同一个功能**（选主题色）在一处暴露、一处不暴露 ✗：读屏用户聚焦这些按钮时
只会听到"蓝色主题/紫色主题…"，**听不出现在选的是哪一个**（WCAG 4.1.2 的"值"）。
已按**仓库自己已有的写法**补上 `:aria-pressed` ✓——
这属于"与仓库内部约定不一致"，和前面几轮找到的真缺陷是同一类来源。

**（三）新增一条可推广的规则。**
成组可选项（`role="group"` / `radiogroup` / `tablist`）里的 `<button>`，
若用 class 标记选中态（`on` / `active` / `selected` / `checked` / `current`）
却没有 `aria-pressed` / `aria-checked` / `aria-selected` / `aria-current` 中任何一个，
就是"**选中态只存在于视觉里**" ✗。
边界写清楚：`<a>` **排除**在外（导航的 `active` 由 `aria-current` 表达，是另一套语义）；
选中态 class **卡前后词边界**，所以 `router-link-active`、`current-theme` 这类复合名不误判；
判定依赖 class 命名习惯（这是约定而非强制）属于**已知边界**。

**（四）本守卫验证的是什么，以及它不验证什么（诚实边界）。**
测试环境里**没有加载样式表**，因此**靠 CSS 媒体查询隐藏的部分看不见**——
例如手机底部导航（`mobile-nav-item`）和桌面侧栏导航项会**同时**出现在扫描结果里。
所以这条守卫验证的是**与 CSS 无关的 Tab 顺序不变量** ✓：

| 判据 | 本轮结果 |
| --- | --- |
| 没有 `tabindex` 大于 0 的元素（正数会插队到自然顺序之前） | 0 处 ✓ |
| 没有可交互元素被 `tabindex="-1"` 排除在 Tab 序之外 | 0 处 ✓ |
| 每个可交互元素都有可访问名称 | 0 处 ✓ |
| 渲染后没有不带 `href` 的 `<a>`（`RouterLink` 少了 `to` 就是这样） | 0 处 ✓ |
| 跳过链接是**第一个** Tab 停靠点，且指向真实存在的 `main` | 10/10 页 ✓ |
| 同一页里 id 不重复 | 0 处 ✓ |

**它不声称验证完整的"真实 Tab 顺序"**——那需要真实样式表参与计算 ✗。

**（五）我的夹具两次抓住我自己。**
1. `<main tabindex="-1">` 一开始被我的判据误报成"可交互元素被排除" ✗——
   而**非交互标签**上的 `tabindex="-1"` 正是**跳过链接落点**的标准写法
   （`App.vue:349` 的注释就写着这个理由）。判据已改为只对**可交互标签**报这一条 ✓。
2. 夹具里用**下标算术**取按钮（`buttons.slice(-2)`）导致断言整体错位 ✗——
   已改为**全部用选择器** ✓。夹具用下标，等于把断言绑在无关的渲染顺序上。

**（六）变异实验五条全红——其中两条最初没变红，但性质完全不同：**

| 变异 | 最初结果 | 追查后的真相 |
| --- | --- | --- |
| A 撤掉侧栏主题按钮的 `aria-pressed` | ✅ 1 条红 | 正是本轮修掉的真实缺陷 |
| B 把 `main` 的 `tabindex="-1"` 改成 `"2"` | ❌ 没红 | **根本没改到**：`tabindex="-1"` 在 `App.vue` 里第一处出现在**注释**中，替换打偏了；换精确靶子后 ✅ 1 条红 |
| C 去掉跳过链接的 `href` | ✅ 2 条红 | 跳过链接断言 + 无 href 链接断言 |
| D 判定函数挖洞（名称恒有兜底值） | ✅ 2 条红 | 夹具抓住 |
| E 选中态规则丢掉**词尾**边界 | ❌ 没红 | **夹具真空档**：只验了前边界（`router-link-active`），没验 `current-theme` 这类前缀复合名；补夹具后 ✅ 1 条红 |

> **"没变红"必须与"没改到"分清**：B 是变异没落地，E 才是守卫真缺口。
> 两者混为一谈，就会把"工具没跑"当成"代码没问题"。

**（七）证据规模**：10 个真实页面共扫到 **381 个**可聚焦元素（每页 33–46 个），
其中进入 Tab 序的 371 个；首页真实 Tab 顺序前六位是
跳过链接 → 首页 → 课程 → 账本 → 待办 → 重要日期 ✓。

### 1.38 补齐标签页面板语义；查出并修掉 tablist 子元素不是 tab 的硬性违规（第二十七轮）

**（一）勘察到的缺口：面板语义一个都没有。**
全站有 10 处 `role="tablist"`、**32 个** `role="tab"`，而 `role="tabpanel"` **0 个**、
`aria-controls` 也 **0 个** ✗。也就是读屏会念「标签页 1/3、已选中」，
但**这块标签页控制的内容没有被标记成面板**，面板与 tab 的程序化关联是断的
（WCAG 1.3.1 信息与关系、4.1.2 名称/角色/值）✗。

**（二）其中一处是硬性违规，不是"最佳实践缺失"。**
`ExceptionsModal.vue` 的 `role="tablist"` 里，两个子按钮**根本不是 `role="tab"`** ✗——
只有 `:class="{ on: … }"` 和 `:aria-selected` 都没有 ✗。ARIA 要求 `tablist` 拥有 `tab` ✓，
这是明确的违规 ✓。已补上 `role="tab"` + `:aria-selected` + `id` ✓，
并把共用的 `.exception-form` 标成面板 ✓。

**（三）本轮补齐的范围（只动属性，零结构改动）。**
只补**面板容器已经存在**的分区 ✓：

| 文件 | 分区 | 面板 |
| --- | --- | --- |
| `AppearanceSettings.vue` | 主题/壁纸/文字/布局/滑动 | 5 个面板 ✅ |
| `LocalTransfer.vue` | 发送/扫码接收 | 2 个面板 ✅ |
| `LedgerView.vue` | 账本/固定账单/回顾 | 3 个面板 ✅ |
| `TimeSettingsModal.vue` | 作息导入方式 | 2 个面板 ✅ |
| `ExceptionsModal.vue` | 安排类型 | 1 个共用面板 ✅ |

**（四）为什么没有加 `aria-controls`——这是一个有意的取舍。**
这些面板是 `v-if` 切换的 ✓，未选中时**并不在 DOM 里** ✗。给未选中的 tab 加 `aria-controls`，
只会得到一个**指向空气**的引用 ✗——比不加更糟 ✓。所以改用反向关联：
面板带 `aria-labelledby` 指回**当前选中**的 tab ✓，而那个 tab 一定在 DOM 里 ✓，
引用必然解析得到 ✓。

**（五）还没补的部分，写清楚而不是用白名单糊过去。**
剩下的是**没有面板可指的筛选控件** ✗（`TasksView` 待办筛选、`EventsView` 日程状态、
`ListsView` 侧栏分类、`LedgerView` 的分类方向/分类视图、`TimeSettingsModal` 的识别结果筛选 ✗），
以及**标面板需要动结构**的两处 ✗（`MemoryView` 的范围选择器与内容交叠、
`SyncPairingModal` 的两个分支是状态而非面板 ✗）。
`TasksView` 还额外被 `phase1Regression.test.js:25` 锁定必须保留 `role="tablist"` ✓，
要改语义得先做产品决策 ✓。守卫对这部分只做**数量冻结（只减不增）** ✓，并在清单里逐条写明原因 ✓。

> 顺带更正一条我上一轮的笔记：先前记的"被 `phase1Regression` 锁住所以不能补"**不准确** ✗。
> 那把锁只**要求**存在 `role="tablist"` 与 `aria-selected` ✓，**并不禁止**补 `aria-controls`/`role="tabpanel"` ✓——
> 补全语义与那把锁相容 ✓。真正被锁住的只是"把 `TasksView` 的筛选控件改回 group"这一种做法 ✗。

**（六）新守卫两件套：清单 + 渲染后引用解析。**
`tests/tabPanelSemantics.test.js`（6 条）✓：

| 判据 | 性质 |
| --- | --- |
| 全站 tab/tabpanel 分布与清单一致：**清单外的文件出现 tab 要报**、已补齐的面板**不许丢** | 静态，防扩散 ✅ |
| 已补齐的分区：每个 tab 带 `id`、每个面板带 `aria-labelledby` | 静态 ✅ |
| **渲染后**每个 tabpanel 的 `aria-labelledby` 都指向**当前选中**的 tab | 渲染 ✅ |
| 点遍账本页每个分区 tab，引用必须跟着切换 | 渲染 ✅ |

**（七）变异实验六条全部符合预期**（含三条修正了我自己的预期 ✗）：

| 变异 | 结果 |
| --- | --- |
| A1 清单外文件（`NotesView`）新增 `role="tab"` | ✅ 1 红 |
| A2 清单里的文件把 tab 全删掉 | ✅ 1 红（提示清理清单）|
| B 悄悄拿掉一个已补齐的 tabpanel | ✅ 1 红 |
| C 面板丢掉 `aria-labelledby` | ✅ 1 红（我原以为 2 红 ✗——该面板在弹窗里，渲染守卫本就看不到 ✓）|
| D 引用指向**未选中**的 tab | ✅ **2** 红（比我预计的更强 ✓）|
| E 引用指向不存在的 id | ✅ 1 红 |

> 其中 A1 第一次没红，原因值得记下来：我加的是 `data-zz-extra` ✗，
> 对"计数清单"而言那是**等价变异** ✓——守卫本就不该关心任意属性 ✓，变绿是**正确**的 ✓。
> 换成"往清单外文件里塞一个 `role="tab"`"才真正打到判据 ✓。
> **"没变红"要先分清是"守卫没打到"还是"变异本来就不该红"** ✓。

### 1.39 夹具里的三个真问题：路线泄漏、等待判据、以及它让上一轮扫错了页面（第二十七轮）

这一轮大部分时间花在**测试夹具**上，但三个都是真问题 ✓，不是"为了过测试"的调整 ✗。

**（一）hash 路由跨测试泄漏——最严重的一个。**
`mountApp` 用 `createWebHashHistory()` ✓，而它只在 `hash !== '/'` 时才 `replace(hash)` ✗——
**恰恰在默认值 `'/'` 上跳过了归位** ✓。于是上一个测试最后停在 `#/不存在的地址` 时，
下一个 `mountApp` 会**从 404 页开始** ✗；随后离开 404 页的过渡会卡住 ✗，
`#main-content` **永久为空**（既没有视图也没有加载占位 ✗），
任何等待"视图就绪"的守卫都会跑满 400 次轮询直到 5 秒超时 ✗。
已改为**无条件** `replace(hash)` ✓。

**（二）等待判据：先错在"太容易满足"，后错在"永远满足不了"。**
- 最初只等"加载占位消失" ✗——**旧页面本来就没有占位** ✓，
  于是守卫在**上一个页面**上就收工了 ✗（这正是"守卫跑得太早"）。
- 改成"DOM 连续两次完全一致" ✗——实测各页面稳定期只有 **2~4 次**轮询 ✓，
  要求"连续 3 次一致"就**永远等不到** ✗（表现为每页跑满 400 次轮询 ✗）。
- 最终判据 ✓：**视图根节点身份变过** ✓（不受页面内文字/时钟持续更新的干扰 ✓）
  **且** `main` 已就绪（有内容、且不是 `.route-fallback` 占位）✓。
  另外踩到一条：**根节点必须在 `push` 之前抓** ✗——模块已被缓存时视图会在 `push` 期间
  就同步换好 ✓，在 `push` 之后抓到的"旧节点"其实已经是新视图 ✗，
  "必须变过"同样永远不成立 ✗。

> 这三步的教训合起来是一句：**等待判据必须同时挡住"太早"和"永远等不到"两侧** ✓，
> 而判据错的时候，现象的差别是**超时**还是**断言失败** ✗——不能混着看 ✓。

**（三）它让上一轮的证据扫在了错误的页面上（诚实更正）。**
`tests/tabOrderAndNames.test.js` 是第二十六轮写的 ✓。由于上面第（一）条的泄漏 ✓，
它在**多测试同文件**运行时，部分导航实际停在**上一个页面** ✗——
也就是说第二十六轮那份"10 页、6 条不变量全 0 问题"的证据 ✓，**有一部分是在错页面上量出来的** ✗。
修正夹具后重跑 ✓，其中一条立刻报出真缺陷 ✓（见 1.40）✓；
把那个缺陷修掉之后，六条不变量在**正确页面**上重新全部为 0 ✓——
结论方向没变 ✓，但**上一轮的证据强度被我高估了** ✗，这里更正 ✓。

### 1.40 又一个"选中态只存在于视觉里"：专注时长按钮（第二十七轮）

夹具修正后立刻抓到 ✓：首页「专注时间」组（`FocusPanel.vue:472` `role="group"` ✓）里的
两个按钮都只有 `:class="{ on: … }"` ✗，**没有任何 ARIA** ✗：

| 按钮 | 问题 |
| --- | --- |
| 快捷时长 `25 / 45 / 60…`（L478-486）| 只有 `class="on"` ✗，读屏听不出当前选的是哪个 |
| 自定义时长 `＋`（L490）| 同上 ✗ |

已按仓库既有写法补 `:aria-pressed` ✓（与 `AppearanceSettings`、第二十六轮修的侧栏主题点一致 ✓）。
注意这段代码的注释写着"`role="group"` 是为了让外层的 `aria-label` 真正生效" ✓——
**方向是对的 ✓，只是没顺手把选中态一起暴露出来** ✗，和第二十六轮那个缺口的来源一模一样 ✓。

### 1.41 一条守卫的已知误报：ARIA 悬空引用检查会把表达式里的字面量当成 id（第二十七轮）

`ExceptionsModal` 的面板需要**动态**的 `aria-labelledby` ✓。
若直接写在模板里：`:aria-labelledby="form.type === 'off' ? 'exceptions-tab-off' : 'exceptions-tab-makeup'"` ✗，
则仓库既有的**静态悬空引用守卫**会把表达式里的 `'off'` 也当成一个 id 去核对 ✗，报出**假悬空** ✗。

处理方式是**绕开**而不是放宽守卫 ✓：把选择逻辑挪进具名 `computed` ✓
（`activeTypeTabId` ✓），模板里只剩一个标识符 ✓。
理由是这类守卫**宁可误报也不要漏报** ✓（漏报会让真正的悬空引用上线 ✓），
所以保留它的保守行为 ✓，把这条**已知边界**记在这里 ✓。

### 1.42 把 6 组"没有面板的筛选控件"从 tab 语义收敛为 group + aria-pressed（第二十八轮）

**（一）问题：读屏被告知了一个不存在的契约。**
第二十七轮补齐面板语义时确认 ✓：全站有 10 处 `role="tablist"` ✓，其中 6 处**根本没有面板** ✗ —
它们是筛选控件 ✓（待办筛选、日程状态、侧栏清单分类、账本分类方向/分类视图、作息识别结果筛选 ✓）。
用 tab 语义意味着读屏会念「标签页 1/4」✓，并让用户期待**方向键切换面板** ✓——
而这里既没有面板可切 ✗、也没有实现那套键盘模型 ✗（ARIA APG 的 tabs 模式是"一组分层的内容区"✓）。
这是**误用** ✓，比"缺个最佳实践"更实：它对外宣告了一个不存在的交互契约 ✓。

**（二）修法：换成仓库里已经用了 4 处的写法。**
`role="group"` + `aria-pressed` ✓——`FocusPanel` 的「专注时间」、侧栏主题点、
外观设置面板、课程编辑器的选项都是这个组合 ✓✓。
选它而不是 `radiogroup` + `aria-checked`：单选的语义上 radiogroup 更贴 ✗，
但 `aria-pressed` 与仓库既有约定一致 ✓，且我的选中态守卫已经覆盖 `role="group"` ✓✓。
（`radiogroup` 需要方向键模型 ✓，那是另一件更大的事 ✓，记在这里备查 ✓。）

| 文件 | 原语义 | 现语义 |
| --- | --- | --- |
| `TasksView.vue` 待办筛选 | `tablist` + 4 × `tab`/`aria-selected` | `role="group" aria-label="待办筛选"` + `:aria-pressed` ✅ |
| `EventsView.vue` 日程状态 | `tablist` + `v-for` tab | `role="group"` + `:aria-pressed` ✅ |
| `ListsView.vue` 清单分类 | `<aside role="tablist">` | `role="group"` + `:aria-pressed` ✅ |
| `LedgerView.vue` 分类方向 / 分类视图 | 2 + 4 个 tab | `role="group"` + `:aria-pressed` ✅ |
| `TimeSettingsModal.vue` 识别结果筛选 | `tablist` + 2 个 tab | `role="group"` + `:aria-pressed` ✅ |

结果：`role="tab"` 从 **32 个降到 18 个** ✓，`tablist` 文件从 10 个降到 **7 个** ✓，
`aria-pressed` 从 13 处增到 **22 处** ✓。

**（三）顺带白拿一个"完美配对"。**
`LedgerView` 原来是 9 个 tab / 3 个面板 ✗（6 个是筛选 ✗）✓；
收敛后正好 **3 个 tab / 3 个面板** ✓，于是它从守卫的"欠账"升级为 **`done: true`** ✓，
其中每个 tab 的 id 都必须真的被某个面板的 `aria-labelledby` 引用到 ✓。

**（四）我改了 `phase1Regression` 里一条锁定期望——说明理由。**
那条测试原文断言 `TasksView` 必须含 `role="tablist"` 和 `:aria-selected="filter ===` ✗。
第二十七轮我把它当成"不许改"的约束 ✗——**那是误读** ✓：

> 它锁的是**本意**（"高频切换控件要有语义化角色，并暴露选中状态" ✓），
> 只是**把实现方式写死成了 tablist** ✗。收敛成 `group` + `aria-pressed` **同样满足本意** ✓，
> 而且更准确 ✓。所以我把断言改成锁本意 ✓：
> `role="group" aria-label="待办筛选"` ✓ + `:aria-pressed="filter ===` ✓ + **`not.toContain('role="tablist"')`** ✓，
> 同时给真标签页（账本分区）**加了一条** `role="tabpanel"` 断言 ✓——这条锁比原来**更强** ✓，不是更松 ✓。

**（五）新增一条零豁免的成对规则。**
守卫原来只数 `role="tab"` 按钮 ✓ ——于是有个真缺口 ✗：
把容器改回 `role="tablist"` 却**一个 tab 都不留** ✗（正是第二十七轮在 `ExceptionsModal` 修掉的那类硬性违规 ✓），
存量清单**不会响** ✗。新增规则 ✓（今天全站都满足 ✓，所以是零豁免 ✓）：

| 判据 | 今天 |
| --- | --- |
| 有 `role="tablist"` 就必须有 `role="tab"` | 7/7 文件满足 ✅ |
| 有 `role="tab"` 就必须在某个 `tablist` 里 | 全部满足 ✅ |
| 有 `role="tabpanel"` 就必须有 `role="tab"` | 全部满足 ✅ |

**（六）变异实验（含两条修正我的预期 ✗）：**

| 变异 | 结果 |
| --- | --- |
| M1 把待办筛选改回 `role="tablist"`（一个 tab 都不留） | ✅ 3 红（成对规则 + 收敛锁 + `phase1Regression`）|
| M2a 拿掉"全部"这一项的 `:aria-pressed`（它默认没被选中） | ✅ 1 红（只有**逐项点击**那条抓得到，见 1.43）|
| M2b 拿掉默认选中项（unplanned）的 `:aria-pressed` | ✅ 1 红 |
| M3 面板引用了另一个 tab 的 id | ✅ 3 红（渲染 2 + 静态"每个 tab id 都要被引用"1）|
| M4 拿掉账本页一个 tabpanel | ✅ 2 红 |
| M5 在筛选组里塞一个孤立 `role="tab"` | ✅ **3** 红（我原以为 4 ✗：`ListsView` 不在"已补齐"名单里，结构缺 id 那条本就不该红 ✓）|

### 1.43 选中态守卫的真实盲区：只扫"当前渲染状态"会漏掉没被选中的那一项（第二十八轮）

M2 第一次跑时**红了 0 条** ✗ ——我改的是"全部"这个筛选按钮 ✓，但它**当前没被选中** ✓，
于是 `class="{ on: false }"` 根本不渲染 class ✓，扫描自然看不到 ✗✓。

这是守卫的**真实局限** ✓：它能验证"被选中的那一项把状态暴露出来了" ✓，
但验证不了"**每一项**的绑定都写对了" ✗。
侧栏主题点与专注时长按钮那两次真缺陷都属于"整组都缺" ✓（静态扫描就能看到 ✓），
而"只缺某一项"的写法同样会让读屏在**选中它之后**失去选中信息 ✗。

补法 ✓：新增一条**逐项点击**的守卫 ✓——遍历页面上每个 `role="group"`/`role="tablist"` ✓，
把每一项**都点一遍** ✓，每点一次复查一次 `selectionStateIssues` ✓，
并带规模自证（至少点到 10 个项 ✓，否则等于没点 ✓）。
补完之后 M2a / M2b **各 1 红** ✓，盲区封闭 ✓。

> 这条和前面几轮反复出现的教训是同一条：**"没变红"要先分清是"守卫没打到"还是"变异本来就不该红"** ✓。
> M2 第一次没红是**守卫没打到** ✓（真盲区 ✓，已修 ✓）；
> 而第二十七轮的 A1 没红是**变异本来就不该红** ✓（等价变异 ✓）。两者结论完全相反 ✓。

### 1.44 标签页欠账清零：最后三组补齐/收敛，守卫从"清单棘轮"升级为零豁免（第二十九轮）

**（一）判据（沿用上一轮同一把尺）。**
控件选的是**稳定内容面板** → 补 `role="tabpanel"` ✓；
内容是**被重塑的 / 状态机** → 收敛为 `role="group"` + `aria-pressed` ✓。

| 位置 | 勘察结果 | 处理 |
| --- | --- | --- |
| `TimeSettingsModal` 设置分区 | 真面板切换：`plans` 是 `<section v-show>`，`base` 是 `<template v-if>` **包着 3 个 section** | 补 tabpanel ✅ |
| `MemoryView` 回放时间范围 | tab 同时重塑日期选择器与列表，无稳定面板 | 收敛为 group ✅ |
| `SyncPairingModal` 设备绑定方式 | 内容是状态机（`tab` **且** `pairing`/`mode` 共同决定）| 收敛为 group ✅ |

**（二）一个差点踩进去的视觉回归。**
`base` 面板原来是 `<template v-if>` ✗——`<template>` **不能承载 role** ✓，
所以必须换成一个包裹元素 ✓。但父级 `.settings` 是 `display:flex; flex-direction:column; gap:18px` ✗：
原来三个 `section` 是它的**直接子元素** ✓，靠这个 `gap` 分隔 ✓；
换成包裹层后 `.settings` 只看到一个子元素 ✗，**三个 section 之间的间距会从 18px 塌成 0** ✗。
所以同时补了一条**等价格式规则** ✓：

```css
/* base 面板的包裹层必须复制 .settings 的纵向排布与间距 */
.settings-panel { display: flex; flex-direction: column; gap: 18px; }
```

改动前特意确认了没有 `.settings > section` 这类**子选择器**依赖 ✓（否则插一层就全废 ✗）。

**（三）一个我拒绝"绕过守卫"的地方。**
面板要用 `aria-labelledby` 指回各自的 tab ✓，而那两个 tab 原本是
`v-for="(hint, tab) in tabHints"` ✗——id 只能动态生成 ✗，
于是**静态悬空引用守卫**报 `time-settings-tab-plans` 找不到该 id ✗（实测确认 ✓）。

第二十七轮遇到同类冲突时，我把字面量挪进 `computed` 绕开了守卫 ✓——
那一次是正当的 ✓，因为那个标签**确实**依赖运行时状态（`form.type` ✓）。
但 `plans` / `base` 是**静态**的两个分区 ✗，把它们藏起来等于让守卫
**无法核对一个本来可以对核对的关系** ✗。所以这里改成
**两个显式按钮 + 静态 id** ✓：

```html
<button id="time-settings-tab-plans" role="tab" :aria-selected="settingsTab === 'plans'" …>
```

代价是多了两行重复标记 ✓（分区固定就是两个 ✓，提示文字仍由 `tabHints` 提供 ✓）。
**同样是"改到守卫能过"，区别在于：是在保留可验证性的前提下改结构，还是把信息藏起来** ✓。

**（四）欠账归零，清单棘轮退役。**
最终全站只剩 **5 个 `tablist`** ✓（第二十七轮开始时是 10 个 ✓），
`tab=16 / tabpanel=15` ✓，全部是真标签页、全部有面板 ✓。
（这里我上一轮把数字写早了 ✗：`TimeSettingsModal` 的两个分区从 `v-for` 换成显式按钮后
多出一个 `role="tab"` 标签 ✓。16 个 tab 对 15 个面板是正常的 ✓——
`ExceptionsModal` 的两个 tab **共用一个**表单面板，面板的 `aria-labelledby` 指向当前选中的那个 ✓。）
于是那条"存量清单（只减不增）"失去了存在意义 ✓，换成**零豁免**的规则 ✓：

| 判据 | 规模自证 |
| --- | --- |
| 每个 `role="tab"` 必须带 `id` | — |
| 每个 `role="tabpanel"` 必须带 `aria-labelledby` | — |
| 静态标签下，每个 tab 的 id **必须真的被某个面板引用到** | 至少核对 10 对引用，否则算"守空气" ✅ |
| 有 `tablist` ⇔ 有 `tab`；有 `tabpanel` ⇒ 有 `tab` | 零豁免 ✅ |
| 已收敛为 group 的 **5 个文件**不得再出现 tab 语义 | 零豁免 ✅ |

> 唯一保留的跳过项是**机制限制**而不是豁免名单 ✓：
> `ExceptionsModal` 的面板标签由 `computed` 按 `form.type` 决定 ✓，
> 静态解析不到 ✓——这条在代码里写明"不假装检查" ✓。

**（五）变异实验四条（两条又低估了守卫 ✗）：**

| 变异 | 结果 |
| --- | --- |
| N1 拿掉 plans 面板的 `aria-labelledby` | ✅ 1 红 |
| N2 拿掉 plans tab 的静态 id | ✅ 2 红（完整性 + 悬空引用）|
| N3 `MemoryView` 改回 tab 语义 | ✅ **3** 红（我预期 2 ✗：还踩了"有 tab 却不在 tablist 里"那条 ✓）|
| N4 `SyncPairingModal` 改回 tablist | ✅ **2** 红（我预期 1 ✗：忘了收敛锁现在也覆盖它 ✓）|

**（六）一处没有守卫的改动，如实记下。**
`.settings-panel` 那条 CSS 等价规则**没有守卫** ✗——
happy-dom 不算布局 ✓，加一条"某类必须有某种 CSS"的断言属于测实现细节 ✗。
它靠的是改动前的选择器排查 + 规则与父级逐字对齐 ✓，属于**未受守卫保护的改动** ✓。

### 1.45 标签页键盘契约：从"只有 role"到真的能用方向键（第三十轮）

**（一）缺口：我前几轮自己留下的那一半。**
第二十七～二十九轮把 tab 语义清理得很干净 ✓（5 个 tablist、全是真标签页、都有面板 ✓），
但 APG 标签页契约有**两半** ✓，我只做了一半 ✗：
`role="tab"` 还宣告着"组内用 ←/→ 切换、只有一个 Tab 停靠点" ✗，
而全站**没有一处**处理方向键 ✗、也没有 roving tabindex ✗（实测确认：只有 `WheelPicker` 有自己的方向键 ✓）。
——这和我第二十八轮批评"筛选控件宣告了不存在的面板契约"是**同一类问题** ✓。

**（二）新增 `useTabKeys`（`src/composables/tabKeys.js`）。**
按渲染顺序传入 keys、当前选中项、以及一个 `select` 回调 ✓，返回
`onKeydown`（挂在 tablist 上 ✓）与 `tabIndexFor`（挂在每个 tab 上 ✓）：

| 键 | 行为 |
| --- | --- |
| ← / → | 在组内移动并**环绕**（APG 官方示例就是环绕 ✓），移动即切换（automatic activation）|
| Home / End | 直达两端 |
| 其它键 | 直接放行，不吞掉别人的快捷键 ✅ |

方向键与 Home/End 都要 `preventDefault` ✓——Home/End 默认会**滚动页面** ✓、方向键默认会移动插入符 ✓。
实现上不需要额外的 ref ✗：焦点靠 `event.currentTarget.querySelectorAll('[role="tab"]')[next]` 定位 ✓，
天然只作用于**这个** tablist ✓。

**（三）接缝：切换可能被否决。**
`TimeSettingsModal` 的 `switchSettingsTab` 有草稿守卫 ✗
（`if (draftDirty.value && !guardDraft()) return` ✓）——键盘**不能绕过**它 ✓（这是对的 ✓），
但如果否决后仍然移动焦点 ✗，焦点就会停在一个**并未选中**的 tab 上 ✗，
与 roving tabindex 的状态自相矛盾 ✓。所以让 `select` 可以返回 `false` ✓，
composable 收到 `false` 就不动焦点 ✓；`switchSettingsTab` 相应改成**返回布尔** ✓。

**（四）一处"锁实现方式"的守卫，按本意改了（并变强了）。**
装上 roving tabindex 后，`tabOrderIssues` 立刻报红 ✗：
「可交互的 `<BUTTON>` 带 `tabindex="-1"`：键盘用户 Tab 不到它」✗×2 ✓。
而这条规则的**本意**是"键盘用户**用任何方式都到不了**" ✓——
roving 组里的成员是**靠方向键到达**的 ✓（这正是该模式的正确形态 ✓）。
所以放行这类元素 ✓，但豁免必须带**硬前提** ✓：

> 组里必须真的留着一个 Tab 停靠点 ✓。**整组都是 `-1`** 才是真陷阱 ✓✓。

顺带修了一个真实小缺陷 ✓：那条 `-1` 报错信息**没带元素描述** ✗——
同一页有两个按钮时两条报错一模一样 ✗，根本分不清是哪个 ✓（我上一轮排查账本页时就吃了这个亏 ✓）。
现在会报成 `可交互的 <BUTTON#ledger-tab-bills…>` ✓。

**（五）变异实验五条（含一条我预计**不会**变红的 ✓）：**

| 变异 | 结果 |
| --- | --- |
| P1 拿掉账本的 `@keydown` | ✅ **3** 红（我预期 2 ✗：忘了自己同时在 `tabOrderAndNames` 加了一条渲染级方向键守卫 ✓）|
| P2 拿掉一个 tab 的 roving tabindex | ✅ 2 红 |
| P3 composable 忽略否决权 | ✅ 1 红 |
| P4 方向键不再环绕 | ✅ 1 红 |
| **P5 `switchSettingsTab` 不再返回 `false`** | ⚠️ **0 红**（与预期一致 ✓）|

**（六）如实记下一处没有守卫的接缝。**
P5 就是它 ✓：`switchSettingsTab` 是组件内部函数 ✗，
而 `TimeSettingsModal` 在页面级测试里**不会渲染** ✗（要打开模态框才行 ✓），
所以"否决时返回 `false`"这条接缝目前**没有守卫** ✓——
composable 那一侧（收到 `false` 不动焦点 ✓）有单元测试 ✓，
但**它俩是否真的接上**只有静态接线规则 + 人读代码 ✓。这是本轮唯一的未受保护改动 ✓。

**（七）顺带一提：拆掉了别人一个已知欠账的一半。**
`ScheduleGrid.vue` 里写着"空格刻意保持只有 @click，要做对得引入 roving tabindex + …" ✓——
那是**课表网格**的 roving tabindex ✗，仍然**不在**本轮范围内 ✓（几十个单元格的键盘模型是另一件事 ✓），
本轮只解决**标签页**这一层 ✓。

### 1.46 账本分区补上写回 URL 的那一半契约，并修掉它连带的播报噪音（第三十一轮）

**（一）又是"只做了一半"。**
`LedgerView` 一直在**读** `route.query.tab` ✓（所以 `#/bills?tab=review` 这类深链是能用的 ✓），
但全仓**没有一处写它** ✗。结果是：刷新、分享链接、加书签之后分区就丢了 ✗，
而且 URL 与界面互相矛盾 ✓（地址栏没参数，界面却在"回顾" ✗）。

**（二）写回，并且用一个函数调和两个方向。**
写回**只挂在 `tab` 上是不够的** ✗：`?tab=zzz` 这种脏参数会被读侧映射成 `ledger` ✓，
于是 `tab` 从头到尾没变过 ✗，写回永远不会触发 ✓，脏参数就留在地址栏里骗人 ✓。
所以抽了 `syncTabToQuery()` ✓，**两个方向共用** ✓：路由参数变了调一次 ✓、用户点击/键盘切了分区也调一次 ✓。

| 决定 | 理由 |
| --- | --- |
| 用 `replace`，不用 `push` | 切分区属于页内状态 ✓。用 `push` 的话手机返回键要先把三个分区倒着走一遍才能真正离开账本页 ✓ |
| 默认分区不带参数 | URL 保持干净 ✓；读取侧已把"缺失/非法"都映射回 `ledger` ✓，所以顺带清掉 `?tab=zzz` ✓ |
| 其余 query 参数原样保留 | 写分区不能把 `?focus=` 这类参数吃掉 ✓（有断言 ✓）|

**（三）连带修掉一处读屏噪音。**
`App.vue` 一直在 `route.fullPath` 上播报「某页已打开」 ✗，而 fullPath **包含 query** ✗：
补上写回之后，**每点一次分区读屏就会再听到一遍「账本 已打开」** ✗——页面根本没换 ✓。
改为只看 `route.path` ✓（query 变化属于页内状态 ✓）。这条改动没有现成守卫 ✗，所以同时补了
`tests/routeAnnouncement.test.js` ✓：真换页面**必须**播报 ✓、只改 query **不许**播报 ✓。

**（四）两个我猜错的方向，和第三个被数据纠正的结论。**
「播报不播报」那条测试一开始红 ✓，我先后猜是**哈希泄漏** ✗、又猜是**跨用例状态** ✗——**都错了** ✓。
打探针才看清 ✓：`liveRegion` 的写入是「先清空、**下一拍**再写入」 ✓
（连续播报同一句时读屏会认为文本没变而静默 ✓），实测这条链路落地要 **20～40ms** ✗（不是 0ms 那一拍 ✓）。

这暴露出我那条"**不播报**"断言有个严重缺陷 ✗：它可能在写入落地**之前**就通过 ✗——
**看着是绿的，其实什么都没验证** ✓。修法是两条一起上 ✓：
  1. 断言"没播报"前必须先 `clearAnnouncement()` 擦掉上一句 ✓，再等满一个**观察窗口** ✓；
  2. 在同一个测试里加一条**前提断言** ✓（这一步确实改了 query ✓）。

第 2 条当场就被证明了价值 ✓：删掉写入侧 watcher 做变异时 ✓，那条"没播报"测试
**因为前提断言而变红** ✓✓——它不会在机制被拆掉时静静变绿 ✓。

**（五）变异实验四条（一条又低估了守卫 ✗）：**

| 变异 | 结果 |
| --- | --- |
| Q1 播报改回监听 `fullPath` | ✅ 1 红 |
| Q2 删掉写入侧 watcher（只剩读）| ✅ **5** 红（我预期 4 ✗：播报用例的前提断言也红了 ✓）|
| Q3 路由参数变化后不再调和 | ✅ 1 红 |
| Q4 写回改用 `push` | ✅ 1 红（同时证明那条历史长度断言**不是空洞的** ✓）|

**（六）本轮顺手复核了两个候选，都是"已实现"，不该改。**

| 候选 | 结论 |
| --- | --- |
| 模态框焦点陷阱 | **已实现** ✓：`trapTabKey` ✓ + `role="dialog"`/`aria-modal="true"` ✓ + 自动聚焦 ✓ + 关闭时还原先前焦点 ✓ + 多层 overlay 栈（`isTopOverlay`）✓ ✅ |
| `prefers-reduced-motion` | **已实现** ✓：`style.css` 有全局块（`animation-duration: 0.01ms` + `iteration-count: 1` + `scroll-behavior: auto`，覆盖 `*`）✓，5 个含 `infinite` 动画的文件全被压掉 ✓ ✅ |

> 第二条值得记一笔 ✓：它本来是本轮的首选目标 ✗，勘察后发现**不是缺口** ✓。
> 写进报告比"顺手改点别的"更有价值 ✓。

### 1.47 "/" 接成全局搜索快捷键，并修掉它顺手暴露的焦点缺陷（第三十二轮）

**（一）缺口：搜索只能靠鼠标找到。**
`SearchPanel` 一直只由侧栏按钮打开 ✓，键盘用户要找搜索得先把焦点挪到侧栏 ✗。
而 `App.vue` 的全局 keydown 早已有一套成熟护栏 ✓（Ctrl+K 快速记账 ✓、数字 1..N 跳页 ✓），
补上 `/`（GitHub、YouTube 的老习惯 ✓）属于同一类收尾 ✓。

**护栏的每一条都是**顺序敏感**的 ✓，所以断言全部落在行为上 ✓：

| 情况 | 行为 |
| --- | --- |
| 在输入框 / 文本域 / contenteditable 里打斜杠 | 原样落进去 ✓ 不抢 ✓ |
| Ctrl / Cmd + `/` | 不归它管 ✓ |
| 已经有弹窗打开 | 不再叠一层搜索面板 ✓ |

**状态放哪**：面板归 `Sidebar.vue`（它负责懒加载与悬停预热 ✓），
而快捷键按仓库自己的约定归 `App.vue`（Sidebar 的注释写着"App 的全局 keydown 只管 Ctrl+K 与数字快捷键" ✓）。
两边各占一半 → 用一个**模块级 ref** 连起来 ✓（`composables/globalSearch.js` ✓），
与 `liveRegion.js` 的 `liveMessage` / `liveAlert` 同一模式 ✓，不为一个布尔值拉一整套管道 ✗。

**（二）它顺手暴露了一个真缺陷。**
测试写完第一次跑 ✓：面板能打开 ✓、三道护栏全对 ✓、Escape ✓、连按不叠 ✓，
**但焦点不在搜索框** ✗ —— 落在一个 `<button>` 上 ✓。

根因 ✓：面板自己在 `nextTick` 里聚焦输入框 ✗，而 `Modal` 打开时**也会**自动聚焦 ✗
（`initialFocusTarget`：优先 `[autofocus]` 元素 ✓，否则第一个可聚焦元素 ✓）。
两套机制抢同一个焦点 ✓，赢的是 Modal 的**关闭按钮** ✗ ——
于是"按 `/` 就能直接打字"根本不成立 ✗。这是**既有**缺陷 ✓，只是以前没有这个入口 ✓，
从侧栏点开时同样打不了字 ✗。

**修法**（一行 ✓，而且是仓库的既定写法 ✓）：给输入框加 `autofocus` ✓，
并把 `nextTick` 手动聚焦、`inputEl`、`nextTick` 导入一并删掉 ✓ ——
**只留一套聚焦机制** ✓（`NotesView` 的正文框就是这么写的 ✓）。

**（三）一次翻车，和一条流程教训。**
写版本说明时用了 `--notes "\"/\" 打开全局搜索…"` ✗ —— PowerShell 不认 `\"` ✗，
传到脚本里只剩一个 `\` ✓，脚本照写不误 ✗，直到 `tests/releaseNotes.test.js` 两条断言报红 ✓
（"当前版本说明不是空白占位内容" ✓、"最多只保留最近 3 个版本" ✓ —— 同一条过短说明 ✓）。

**更值得记的是我的第二个错** ✓：我用 `npm run check 2>&1 | Select-String …` 之后读 `$LASTEXITCODE` ✓，
拿到 **0** ✓，于是先报了"门禁通过" ✗。而 `check` = `lint && typecheck && test && build` ✓，
测试那步失败时后面的 build 根本没跑 ✗。**管道之后的退出码不可信** ✓ ——
在这台 shell 上只认输出里的通过/失败标记 ✓。

**两个修法都落地了** ✓：

| 修法 | 作用 |
| --- | --- |
| `validateReleaseNotes()`（纯函数 ✓，与测试里那条 12 字符契约同源 ✓）| bump 脚本**写入之前**就拒绝：太短 ✓、只剩反斜杠 ✓、平白多出 `\"` ✓ 一律不落盘 ✓ |
| `--amend-notes` 模式 | 只修正**当前版本**的说明 ✓、**不新增版本** ✓，并照常重算签名 ✓（说明参与哈希 ✓），连条目里的 signature 字段也一起更新 ✓ |

实测 ✓：`--amend-notes "\"` 退出 1 ✓、条目数不变 ✓、报错直接点名"只剩反斜杠，像是引号被 shell 吃掉了" ✓。

**（四）变异实验五条（本轮零预期误差 ✓）：**

| 变异 | 结果 |
| --- | --- |
| R1 输入框去掉 `autofocus` | ✅ 1 红（焦点又被关闭按钮抢走 ✓）|
| R2 `/` 检查挪到「可编辑元素」守卫之前 | ✅ 2 红（输入框 / 文本域两条 ✓）|
| R3 `/` 检查挪到「修饰键」守卫之前 | ✅ 1 红 |
| R4 `/` 检查挪到「弹窗已打开」守卫之前 | ✅ 1 红 |
| R5 侧栏改回局部 ref（与快捷键脱钩）| ✅ 3 红（面板压根不会渲染 ✓）|

**（五）顺手把 §4 待办清单核实了一遍——它已经过时了。**

连续三项"候选"勘察下来都是**已实现** ✓，于是反过来逐项核对了整份清单 ✓：
**19 项里有 12 项其实早已落地** ✓（日/周过渡 ✓、侧栏折叠过渡 ✓、粘贴解析 ✓、空状态插图 ✓、
冲突视图 ✓、节假日预设 ✓、语音识别语言 ✓、防抖 ✓、清单多选 ✓、专注彩带 ✓、
弹窗遮罩下滑关闭 ✓、以及本轮确认的抽屉拖拽物理 ✓）。

其中**抽屉**一项最典型 ✓：`sheetDrag.js` 里采样 ✓、速度窗口 ✓、两档吸附 ✓、
`close` 分支 ✓、`emit(close)` ✓ 一应俱全 ✓，还有 **22 条**测试 ✓（`sheetDrag` 纯函数 ✓ + `modalSheet` 组件级 ✓）。
我差点把它当缺口去"补" ✗ —— 先勘察再动手又一次省下了无用功 ✓。

**真正还缺的只有三项** ✓：sparkline 迷你图 ✗、单元格涟漪 ✗、心情关键帧动画 ✗（都是装饰性 ✓、收益有限 ✓）。

**同时纠正一条被我推翻的旧结论** ✓（见 §3「标签页/分段器持久化」）——
它写着 route.query 方案会与 `clearFocusQuery` 相互干扰 ✗，
而第三十一轮的账本分区写回 ✓ **专门用测试证明了共存** ✓。

### 1.48 打印样式（第三十三轮）：此前按 Ctrl+P 会印出深色外壳，课程表右侧的列还会被整块裁掉

**（一）缺口：全仓没有任何 `@media print`。**
逐项核对媒体查询时发现 ✓：`prefers-reduced-motion` ✓、`prefers-contrast` ✓、`prefers-color-scheme` ✓、
`forced-colors` ✓ 都已处理 ✓，**唯独打印是 0 处** ✗。
课程表、账单、待办正是会被真的打印出来的东西 ✓，而按 Ctrl+P 的结果是 ✓：
深色侧栏 ✓、悬浮的任务中心 ✓、装饰粒子 ✓、提示层 ✓ 一起印上去 ✓，整块深色底吃一盒墨 ✓；
**更麻烦的是 `.timetable-wrap` 的 `overflow-x: auto`** ✗ —— 纸上只印得出当前能看见的那几列 ✓，
表格右侧整块消失 ✓。

**（二）落地内容。**

| 规则 | 理由 |
| --- | --- |
| 隐藏 `.sidebar` / `.task-center` / `.toast` / `.skip-to-content` / `.atmo-layer` / 三类全局提示 | 纸上不需要外壳 ✓ |
| 连 `.overlay` 一起隐藏 | 浮层是 `position: fixed` ✓，印出来会**叠在正文上** ✓；纸上要看的是页面本身 ✓ |
| 把主题令牌归零成 `#fff` / `#000` | 自定义主题在纸上既费墨又可能看不清 ✓ |
| 展开 `.timetable-wrap` / `.list-sidebar` / `.manager-table-scroll` | 滚动容器不展开就只能印一屏 ✓ |
| `.content*` 去掉宽度与内边距，改由 `@page { margin: 12mm }` 留白 | 页面宽度类在纸上没有意义 ✓ |
| `box-shadow: none` + `break-inside: avoid`（`.card` / `section` / `article` / `li` / `tr`）| 阴影只是灰糊 ✓，卡片与表格行别被切成两半 ✓ |

**刻意不做** ✓：不加 `a[href]::after { content: attr(href) }` ✗ ——
本应用是 hash 路由 ✓，印出来的会是 `#/tasks` 这种毫无意义的地址 ✓。

**一个必须写对的细节** ✓：正文颜色令牌真名是 **`--text`** ✓，不是 `--ink` ✗。
写错不会报错 ✓，只会静默失效 ✓ —— 仓库注释里记着同一个坑 ✓：
`ExamsView` 曾经写 `var(--success)`，而那个令牌**从来不存在** ✓，
整条声明回退成继承色 ✓，"已安排复习"的绿色提示一直是假的 ✓。
所以守卫里专门有一条：打印块引用的每个变量都必须在 `:root` 里定义过 ✓。

**（三）怎么守：CSS 媒体查询在 happy-dom 里不会被求值 ✗**，
所以 `tests/printStyles.test.js` 做的是**结构守卫** ✓：解析打印块 ✓，逐条核对隐藏清单 ✓、
滚动容器展开 ✓、令牌归零 ✓、`@page` ✓、防分页 ✓，并加三道自证 ✓：

1. 打印块里每个类/ID 选择器都必须在源码里真实存在 ✓（改名即红 ✓）；
2. 打印块引用的每个变量都必须在 `:root` 里定义过 ✓；
3. 隐藏清单里**绝不允许**出现正文根（`main` / `.content` / `body` / `.card` / 表格容器）✓
   —— 那是最糟的错法：打印出一张白纸 ✓。

**（四）变异测试抓到一个同义反复（本轮最值钱的一条）** ✗✓。
P7「往打印块里写一个不存在的选择器」预期报红 ✓，结果是**绿的** ✗。
手工复验确认插入真的发生了 ✓，问题出在自证本身 ✗：
它去"源码里找这个选择器" ✓，而 `SOURCE` **包含 `src/style.css` 自身** ✗ ——
我往打印块里写什么 ✓，它都能在"源码"（也就是这个文件）里找到自己 ✓，
断言退化成**恒真** ✗✓。修法是自证前把**打印块自身**从语料里剥掉 ✓。

修好之后立刻又暴露两个分词器 bug ✓（都是"看着像 bug 其实是度量错" ✓）：

| bug | 表现 | 修法 |
| --- | --- | --- |
| 十六进制颜色被当成 ID 选择器 | `#000000` / `#333333` 报"源码里找不到" ✗ | 排除 `#` 后面全是十六进制位的写法 ✓ |
| 只认 CSS 写法，不认模板类属性 | `.task-center` 报"找不到" ✗，而它是 `TaskCenter.vue` 的根类 ✓ | 名字存在性同时匹配 `class="…"` 形式 ✓ |

**（五）连带修一处集成问题：对比度审计被打印块带偏。**
加了打印块之后 `tests/contrastAudit.test.js` 红了 **3** 条 ✗：
它的块正则是 `([^{}]+)\{([^{}]*)\}` ✓，**看不懂嵌套** ✗ ——
打印块里的 `body, .layout, .content { background: #ffffff }` 被当成一条**主题**规则 ✓，
于是"纯近白底必须用 `--card` / `--bg-tint` 令牌"直接报红 ✓。

打印色**不是主题色** ✓：纸上就应该是纯黑纯白（`#000` 对 `#fff` 是 21:1 ✓），
它的合法性由打印守卫单独负责 ✓。所以在共用处加了 `stripPrintStyles()` ✓，
脚本与测试都先剥掉 `@media print` / `@page` 再做调色板分析 ✓，并补了 3 条单元用例 ✓。

**这处排除不是可有可无的** ✓：把它改成空操作 ✓，红的就是 **5** 条 ✓ ——
包括门禁报的那 3 条审计 ✓，证明它确实在承重 ✓。

**（六）变异实验共 11 条，全部按预期报红：**

| 变异 | 结果 |
| --- | --- |
| P1 隐藏清单去掉 `.atmo-layer` | ✅ 1 红 |
| P2 滚动容器改回 `overflow: hidden` | ✅ 1 红 |
| P3 把正文根 `.content` 也隐藏 | ✅ 1 红 |
| P4 令牌写成不存在的 `--ink` | ✅ 1 红 |
| P5 令牌漏掉 `!important` | ✅ 1 红 |
| P6 打印块之后又追加规则 | ✅ 1 红 |
| P7 写了个不存在的选择器 | ✅ 1 红（**第一遍是绿的** ✗，修好自证后才红 ✓）|
| P8 表格行不再防分页 | ✅ 1 红 |
| S1 `stripPrintStyles` 变空操作 | ✅ 5 红（含那 3 条审计 ✓）|
| S2 贪婪剥到文件末尾 | ✅ 2 红 |
| S3 只剥 `@media print` 漏掉 `@page` | ✅ 1 红 |

**（七）本轮顺手复核的其它媒体查询（都是已实现 ✓，不改）：**

| 项 | 结论 |
| --- | --- |
| `forced-colors: active` | **已实现** ✓：`.btn` / `.card` / 表单控件补 `ButtonBorder` ✓，焦点环用 `Highlight` ✓ ✅ |
| `prefers-contrast: more` | **已实现** ✓：`style.css` 里有整套高对比令牌 ✓，并有对比度审计脚本与守卫 ✓ ✅ |
| `prefers-color-scheme` | **已实现** ✓（`theme.js` 跟随系统深色 ✓）✅ |

至此 §4 清单里剩下的装饰性缺口只有三项 ✓：sparkline 迷你图 ✗、单元格涟漪 ✗、心情关键帧动画 ✗。

### 1.49 高对比度在「跟随系统」主题下根本不生效（第三十五轮）：内联变量压掉了整片高对比样式

**（一）起因：核对 §4 第 12 条时发现那条结论本身是错的。**
原记录写着「深色高对比下 `--bg-tint` 与 `--card` 同值（都设成 `#1b2333`）」✗。
实读调色板后：深色的 `--card` 是 **`#1b2233`**、`--bg-tint` 是 **`#131a29`** ✓，
两者**并不同值** ✓，而且它们都来自 `theme.js` ✓，不是 `style.css` ✓。
那条 `style.css` 里写 `--bg-tint: #1b2333` 的规则 ✗……**根本没生效** ✓。

**（二）真正的问题链。**

| 主题 | 调色板来源 | 高对比（`style.css` 那几块）生效吗 |
| --- | --- | --- |
| 具名主题（蓝/紫/绿/粉） | `style.css` 的 `:root` 与 `:root[data-theme=…]` | ✅ 生效：`theme.js` 走 `clearThemeVariables()`，不写内联变量，样式表说了算 |
| 自定义主题 | 同上 + 内联 `--primary` 系 | ✅ 生效（内联只覆盖主色系，不含边框与文字）|
| **跟随系统** | **`theme.js` 把整张调色板写成内联变量** | ❌ **完全不生效** |

关键在最后一行 ✓：**内联样式优先于任何选择器** ✓（除非对面写 `!important` ✗）。
「跟随系统」分支把 `--border` / `--muted` / `--bg-tint` 等一并写成内联变量 ✓，
于是 `:root[data-contrast='high']` 与 `:root[data-theme='dark']:not([data-contrast='normal'])`
整个被压掉 ✗。深色下实际生效的是 ✗：

- `--border` 停在 **`#2a3248`** ✗（本该是 `#64749a` ✓）；
- `--muted` 停在 **`#8b95a8`** ✗（本该是 `#bcc7db` ✓）。

深色**只能**由「跟随系统 + 系统偏好深色」产生 ✓（`theme.js` 注释里就写着 ✓），
所以受影响面并不小 ✓：想用深色的人必然走这条路 ✓，而这条路上高对比开关是**静默失效**的 ✗。

**（三）为什么一直没被发现：测试验的是从不生效的值。**
`tests/contrastAudit.test.js` 是解析**样式表**做 AA 核算的 ✓，
它验的正是那几块**从不生效**的声明 ✓ —— 通过得理直气壮 ✓，却与运行时无关 ✓。
进一步核对 ✓：`tests/` 里**没有任何**文件提到 `themeKey` / `highContrast` / `data-contrast` /
`prefers-contrast` ✗✓ —— 高对比模式此前**一条测试都没有** ✓。
所以这条补的不是断言，而是**一条此前完全缺失的观测面** ✓。

**（四）修法：让「跟随系统」分支自己感知高对比。**
按 `prefersDark` 的既有写法 ✓ 增加 `prefers-contrast: more` 的初值与 `change` 监听 ✓，
并在该分支叠加一份强对比增量 ✓（应用内开关打开 **或** 系统开启都生效 ✓，
与 `contrast.js` 注释里写的 CSS 分工一致 ✓）。

**刻意没动的一处** ✓：`contrast.js` 的 `applyHighContrast` 支持三态 ✓，
但调用处只传 `high` 与 `auto` ✗，所以样式表里「显式关闭 → `data-contrast=normal` 压制系统设置」
这条路当前**走不到** ✓。那是三态语义 ✓，动它会改到既有的 `sl_high_contrast` 键语义 ✗ ✓
（本次目标明确不动既有 `sl_*` 键语义 ✓），故只记录、不改 ✓。

**（五）踩到的坑：别去重构守卫正在读的结构。**
第一版我把两个 `return { … }` 字面量改成了 `const dark = { … }` 加展开 ✗，
结果 `tests/contrastAudit.test.js` **连红三条** ✗ ✓ —— 原来自第 162 行起它用正则
`if (prefersDark.value) { return {…}` **直接解析这两个字面量** ✓✓。
改回来后审计立刻恢复 ✓（收到的调色板列表里之前**没有"深色"** ✓）。
改法因此调整为 ✓：**字面量一字不动** ✓，强对比增量放进外层包装 `systemPalette()` ✓，
并在那里留注释说明**为什么不能并进去** ✓。

**（六）新增守卫（7 条）：断言运行时真实值 + 跨文件防漂移。**

| 断言 | 为什么必须有 |
| --- | --- |
| 跟随系统 × 深色/浅色 × 应用内开关 → 读 `document.documentElement.style` 的真实值 | 这正是缺失的观测面；修好前读到的是普通深色值 ✓ |
| 系统级 `prefers-contrast: more` 也生效 | 应用内开关关着时也要跟随系统 ✓ |
| **负例**：没有高对比时不许强套 | 防止"为了修 bug 而永远强对比" ✓ |
| 具名主题必须清空内联变量 | 锁住另一条路 ✓，同时防历史上的**串色** bug（从深色切具名主题残留暗底）✓ |
| 解析 `style.css` 四块强对比声明，与运行时值逐一比对 | 同一意图写在两处 ✓，必须防漂移 ✓ |

**（七）变异实验 3 条，失败集合与预期完全吻合：**

| 变异 | 结果 |
| --- | --- |
| M1 两条分支都不再套用强对比值（还原修复前） | ✅ 红 4 条 |
| M2 深色边框色抄错一位（`#64749a` → `#64749b`） | ✅ 红 3 条 |
| M3 不再跟随系统 `prefers-contrast: more` | ✅ 红 1 条 |

M1/M2 **第一遍我自己把预期条数算错了** ✗：M1 我只改了深色分支 ✗（浅色分支没动，
浅色用例当然还绿 ✓），M2 漏算了"系统高对比"那条也断言同一个深色值 ✓。
改为**双向变异 + 精确失败集合比对**后全部吻合 ✓ —— 错的是我的预期，不是守卫 ✓。

**（八）同时把 §4 的两条陈旧记录对账掉了** ✓：
第 5 条（标签页缺 `tabpanel` ✗）与第 6 条（筛选器误用 `tablist` ✗）
**都已在第二十七～三十一轮做完** ✓✓，报告却仍写着"没做" ✗ ✓ —— 见下方 §4 的修订 ✓。

### 1.50 深色高对比下内嵌区与卡片几乎同色；以及一个"只写不读"的死令牌溜过了守卫（第三十六轮）

**（一）§4 第 12 条的症状是真的，只是它写的原因不对，而且是被上一轮"修活"的。**
实读调色板后 ✓：深色的 `--card` 是 `#1b2233` ✓、`--bg-tint` 是 `#1b2333` ✗ ——
两者通道差 **`0, -1, 0`** ✓，也就是只差一个绿通道值 ✓，**肉眼完全是同一块** ✗ ✓。
§4 说的"层次全部消失"是真的 ✓，但它归因到 `:root[data-contrast='high'][data-theme='dark']`
把两者设成同一个值 ✗ —— 其实那两块里的 `--card` 从来没被设过 ✓。

更要紧的是时间线 ✓：这两块在第三十五轮之前**是死代码** ✓（被 `theme.js` 的内联变量整片压掉 ✓），
当时深色高对比实际用的是普通的 `#131a29` ✓（与卡片差 `8, 8, 10` ✓ 有层次 ✓）。
第三十五轮把高对比修活之后 ✓，这个近似同色的值才**第一次真正生效** ✗✓ ——
也就是说，**这个视觉回归是我上一轮修出来的** ✓，本轮自己修掉 ✓。

**（二）阈值不是拍的，是量出来的。**
要让守卫判"两片颜色是不是同一块" ✓，得先知道本仓库"刻意含蓄"能含蓄到哪 ✓：

| 组合 | `--bg-tint` vs `--card` 最大通道差 | `--bg-tint` vs `--bg` |
| --- | --- | --- |
| 浅色普通 | 6（`#f9fafd` vs `#ffffff`）| 4（`#f9fafd` vs `#f5f7fb`）|
| 浅色高对比 | **17** | 5 |
| 深色普通 | 8（`#131a29` vs `#1b2233`）| **3** |
| 深色高对比（修前）| **1** ✗ ← 缺陷 | 6 |

所以 ✓：对 `--card` 取 **≥ 4** ✓（含蓄档是 6 ✓，缺陷是 1 ✓，判得开 ✓）；
对 `--bg` 取 **≥ 3** ✓ —— 因为**深色普通这一档本来就只有 3** ✓，
那是既有取值、不在本轮范围内 ✓，于是按现状**棘轮锁住** ✓（不许再变糊 ✓），
并把这条观察记成 §4 的新条目 ✓，而不是偷偷把阈值调到能过 ✓。

**第四十二轮更新（这一条已经改掉了）** ✓：深色普通那一档不再"按现状锁住" ✓，
而是真的做了一次配色调整 ✓ —— `#131a29` → `#161d2c` ✓，与 `--bg` 的差从 **3 提到 6** ✓，
与 `--card` 仍有 **7** ✓（上表里它原本是 8 ✓，两边都明显过 4 ✓）。
于是四档实测值变成 **浅色普通 4 / 浅色高对比 5 / 深色高对比 6 / 深色普通 6** ✓，
**对 `--bg` 的阈值顺势从 3 收到 4** ✓（四档全过 ✓，不再给任何一档留 3 的口子 ✓）。
为什么不是更高的 6 ✓：最大通道差的上限就是 `--bg` 与 `--card` 之间的 13 ✓，
`--bg-tint` 与两边都要明显过 4 ✓，能分给"与 `--bg` 的差"的本就不高 ✓。
细节与选值过程见 §1.56 ✓。

**（三）修法：改成明显更深的一档，方向与普通深色一致。**
`#1b2333` → **`#0d1320`** ✓：与卡片差 `14, 15, 19` ✓、与 `--bg` 差 11 ✓、
正文 `#e8ecf4` 在其上 15.6:1 ✓。
方向也说得通 ✓：浅色高对比把 tint 从"比卡片浅 6"改成"比卡片深 17" ✓，
普通深色的 tint 本来就比卡片**更深** ✓，所以高对比继续往深走 ✓ ——
"高对比"要的是**更大的层次差** ✓，不是换个颜色 ✓。

**（四）把这句话写成不变量。**
新增断言 ✓：**高对比的 tint/card 层次差不得小于普通模式** ✓。
它精确地编码了上面那句意图 ✓，而且是修前必红的 ✓（深色：1 < 8 ✓）。
同一份值写在 `style.css` 两处加 `theme.js` 一处 ✓ → 靠第三十五轮的漂移守卫串起来 ✓：
只改 style.css 不改 theme.js（或反过来）都会红 ✓（变异 T2 验证 ✓）。

**（五）另一件：一个"只写不读"的死令牌，以及放它过去的守卫口径。**
`--atmosphere-decor` 在 `festive.js` 里被 `setProperty` 写、被 `removeProperty` 删 ✓，
**全仓没有任何 `var()` 读取点** ✓（CSS 里没有 ✓、测试里也不提 ✓）→ 纯死令牌 ✓，已删 ✓。

真正值得记的是**它为什么能活这么久** ✗ ✓：`tests/styleHooks.test.js` 早就有"声明了却零消费"的守卫 ✓，
但它的口径是 **消费 = 被 `var()` 读到 _或_ 被 `setProperty` 写到** ✗，
而且定义来源只扫 `style.css` 与 `theme.js` ✓。于是 `festive.js` 那句 setter ✓
**既是"定义"又是"消费"，自己给自己背书** ✗✓ —— 守卫看着绿 ✓，其实什么都没验证 ✓。

修法是把仓库**自己已经用在 theme.js 上**的更严标准推广到全仓 ✓
（原测试里就写着"不会因为『写进去了』就误判成『有人在用』" ✓）：
**凡是被写过的自定义属性，都必须有 `var()` 读取点** ✓，并加"至少扫到 8 个写入点"的自证 ✓
（防正则写坏后静默变空 ✓）。

顺带得到一个结论 ✓：加上这条更严的口径后全仓**只剩那一个**违规 ✓ ——
也就是说除它之外 ✓，所有被写入的令牌确实都有人在读 ✓。

**（六）变异实验 3 条：**

| 变异 | 结果 |
| --- | --- |
| T1 `theme.js` 把深色高对比 tint 改回 `#1b2333` | ✅ 红 **4** 条（值断言 + 漂移 + 两条层次断言）|
| T2 只把 `style.css` 两处改回去（制造漂移）| ✅ 红 1 条（正是漂移守卫）|
| T3 把已删的死令牌 `--atmosphere-decor` 写回去 | ✅ 红 1 条（正是新加的那条守卫）|

T1 我**又**把条数算少了 ✓（预测 3、实际 4 ✓）—— 算漏了"高对比层次差不得小于普通"那条 ✓
也断言同一个值 ✓。这已经是本轮会话里**第三次**同类错误 ✓，规律很一致 ✓：
**我总漏算同一文件里其它用例的连带断言** ✓。
所以现在预测都改成先列出"谁会断言这个值" ✓，再用精确失败集合核对 ✓ ✓。

### 1.51 组件内死 CSS：先设计例外机制，再断言（第三十七轮）

§4 第 13/17 条一直写着"组件内死类没有守卫"，并且预先警告：直接断言会变成**误报机器**。这一轮把例外机制设计出来之后才敢断言。

**三类假阳性，逐类给机器判据**（不是靠白名单堆）：

- **过渡类名**：`<Transition name="x">` 会让 Vue 运行期生成 `x-enter-active` 等，样式里写得到、模板里搜不到。判据取自 `name` 属性。
- **动态拼接**：`` `step-${status}` ``、`'skin-' + skin` 这类，类名由字符串拼出来。判据是"取模板字面量里 `${` 之前那段以 `-` 结尾的静态片段"作为前缀。
- **`:` deep`/`:slotted`/`:global`**：作用在子组件或全局，本文件模板里自然搜不到，抽取选择器时直接跳过。

**两处只有实测才会发现的坑，都写进了守卫注释**：

1. **注释里的字面量 `<style>`**。`App.vue` 的模板注释写着"见 `<style>` 里的 `.skip-to-content`"，用 `/<style[^>]*>[\s\S]*?<\/style>/` 定位样式块会从**注释里那个**开始匹配、一路吃到第一个 `</style>`，把中间整段模板当成样式剔掉，里面的类名全成假阳性（`skip-to-content`、`global-safe-mode-alert` 等 5 个就是这么误报的，而 `dist` 的模板 JS 里明明有它们）。改成带 HTML 注释状态的扫描器后归零。同一个坑还咬了打印守卫一次：它用 `indexOf('@page')` 找 `@page` 规则，命中的却是注释里的字面量 `@page`。
2. **过渡名与动态前缀必须全仓聚合**。`App.vue` 里出现了 `more-sheet-*`，那是 **Sidebar** 的过渡类；`ScheduleView.vue` 里出现了 `.skin-notebook`，那是 **ScheduleGrid** 的动态皮肤。原因在于构建会把小组件的 CSS **合并进入口分片**，于是规则会出现在宿主文件的编译产物里。只看本文件必然误报。

**判据与结论**：静态扫描（本文件 + 全仓用法、例外机制）与**构建产物**（模板编译后的 JS 里有没有这个类名）两个独立来源交叉验证，得到 27 个死类，删掉 63 条规则。删除后逐条比对删除前的编译产物，确认**只少了这 63 条**、没有误伤：App 137→136、TodayView 230→193、DataManager 206→191、ScheduleView 199→193、LedgerView 242→239、AppearanceSettings 121→120。

**这一轮我自己出的重大事故也照实记**：第一版删除器把 `@media` 内层规则重复计算，偏移错乱，误删了 6 个文件约 **259 条规则**（构建直接报 `CssSyntaxError`）。恢复只能靠删除前的 `dist/assets/*.css`，代价是这 6 个样式块的**注释没了**，并且入口分片合并进来的别组件规则被一并搬入（带宿主 scope 属性，多为惰性或同值副本）。详见 §4 第 22 条。

**变异验证**：植入一个没人用的类 → 守卫红 1 条；删掉 Sidebar 的 `<Transition name="more-sheet">` → 守卫红 1 条（证明"全仓过渡名聚合"是承重的）；两次复原后都是 0 条失败、无残留。

### 1.52 把合并分片带进来的规则按 scope 归属清掉（第三十八轮）

上一轮用编译产物恢复 6 个文件时，把**入口分片里合并进来的别组件规则**一并搬了进去。这一轮把它清掉了。

**先找判据，再动手**。编译产物里每条规则都带 `[data-v-<scopeId>]`，看起来按 id 归属就行；但上一轮门禁的成功构建**已把 `dist` 重建**，污染因此被烙上了宿主自己的 id，id 已无法区分。可用的判据是**三个条件的合取**：

1. 别组件文件里存在**完全同值**的规则（选择器 + 声明归一化后相同）——真属主仍定义它，删掉不会丢样式；
2. 宿主自己的模板/脚本里**没有**用到选择器中的任何类；
3. 真属主自己**确实在用**这些类——说明元素在属主模板内部，宿主那份 scoped 规则根本不会匹配。

第 2 条不能单独用（像 `.error` 这种通用类，宿主自己也真的在用，单看"同值"会误删）；第 3 条又拦下 2 条属主未使用的，最终删 **85 条**：App 25、TodayView 27、ScheduleView 27、AppearanceSettings 6。LedgerView / DataManager / FestiveSettings 本来就没有副本。

**安全性论证**：被删的规则，其元素要么在属主组件内部（只带属主 scope id，宿主规则从不匹配，删除是清死重），要么是属主的**子组件根节点**（会同时带父组件 scope id）——而属主定义的是**完全同值**的规则，声明集合不变，渲染结果不变。这也是上一轮"不敢贸然删"的正确边界：`:` deep` 编译出来的后代形式（剥离属性后以空格开头）一律跳过，非同值的同名规则一律保留。

**注释损失的处理**：这 6 个样式块的原有注释在上轮重建中丢失且无法找回（编译产物里没有注释），已在每个块顶部插入说明注释写明此事，避免后人误以为那是有意为之。

### 1.53 跨规则对比度：把手工扫描的口径做成守卫（第三十九轮）

§4 第 15 条一直写着「跨规则那一类仍无守卫，本轮是用手工全仓扫描兜住的」。手工扫描（§1.16）用了三条口径，其中**最可机械化、假阳性最低**的是第二条：**底跟主题令牌、文字却写死**。这一轮把它做成了 `crossRuleContrastOffenders()`（在 `scripts/audit-contrast.mjs` 里，CLI 与测试共用同一份真相）。

**为什么按「前导类链」分族**：`.task-steps li { background: var(--card) }` 与 `.task-steps i { color: #a5adbc }` 是两条规则，共享前导类 `.task-steps`，页面里通常同处一个区块。族内配对是这条判据能成立的最小假设。

**底的优先级，从最可信到最保守**（这一段是实测改出来的，不是设计出来的）：

1. **同元素**的规则：复合选择器个数相同、末尾标签名相同、且**逐复合**都是更宽的类集（`.knob span` 之于 `.knob.on span`）。
2. **祖先前缀**：复合选择器序列是当前规则的前缀（`.a` 之于 `.a .b`），取最长的那条。
3. **族内唯一的令牌底**：只有一个不同的令牌背景时才用它。

**假阳性与真实教训**（都写进了代码注释）：

- 加上「同元素」这一支之前，`.switch.on span { color: #07805d }` 被判 **3.59:1** ——它把底认成了族里 `.switch.on` 的绿色。查证后发现真正的底是 `.switch span { background: #fff }` 那块**白色旋钮**（同元素、更宽的类集），实测 **4.93:1** 达标；而且开关里的对勾是**图标**不是文字。所以修法是把它提到优先级第一位，**而不是**往允许清单里塞一条。
- 第一次写「同元素」时只比整串类集，结果**后代选择器 `.a .b` 被当成 `.a` 的同一个元素**。自证夹具立刻抓到了它（`.multi em` 被误报），改成逐复合比较后消失。
- 族里出现多个不同的令牌底时，祖先链就不确定（`.multi` 与 `.multi .a` 都可能坐在同一个元素上面）——此时**宁可漏报也不猜**：猜错会把一个可读的界面判成缺陷。所以实际算过的配对只有 6 组，而不是 24 组；这个"低"是刻意的，测试里的下限就写在 6。

**结论**：判据在全仓**零命中**（13 条写死字色的规则、5 套浅色主题、6 组配对全部达标），允许清单因此**是空的**——机制留着，以后遇到"确实达标但静态读不出来"的情形能逐条登记并写明理由，而不是把阈值调松。测试还带一条**防腐**断言：允许清单里登记过的每一条都必须仍然命中，否则说明代码变了、该删条目。

**变异验证**：拿掉白色旋钮的底（同元素分支失效 → 祖先链改判 `--bg`，深色下变糊）→ 红 1 条；把对勾改成近白字色 → 红 1 条；两次复原后都是 0 条失败。

**顺带纠正三条陈旧结论**：§4 第 19、20 条都写着「守卫仍缺，是候选而非遗漏」，理由是需要给视图搭 router + store 挂载环境。但那套环境第二十四轮就建好了（`tests/helpers/mountApp.js`），第 19 条的守卫第二十五轮、第 20 条的第二十七轮都已落地——本轮逐条复核时它们**已经在了**。条目文本已按实测改写（见 §4 第 19、20 条）。这类"写于早期、后来被实现、报告没回头更新"的条目，本轮连同第 13、17 条一共纠正了 5 条。

### 1.54 渐变底与模板内联底：第 15 条剩下两类的守卫（第四十轮）

上一轮把「底跟主题令牌、文字却写死」做成了守卫，第 15 条还剩几类逐条规则看不见的假阴性。这一轮把其中两类机械化，**并且刚上守卫就抓到一处真实缺陷**。

**一、`background-image` 渐变底**（`gradientSurfaceOffenders()`）。底不是 `background` 而是渐变，逐条判据只看 `background` 就漏了。做法：同一条规则里同时有渐变与 `color` 时，对渐变里**每一个十六进制色停**都算一遍对比度，取最差的那一档——文字落在渐变哪一段静态确定不了，按最浅的算最保守。

**抓到的东西**：`TodayView .next-state.live`（"进行中"胶囊）`color:#fff` 压在 `linear-gradient(135deg,#456fe8,#7855dc)` 上，白字对最浅的 `#456fe8` 是 **4.48:1** ✗ ——11.5px/750 属正文，门槛 4.5，**差 0.02**。这是测量出来的 AA 失败，不是审美取舍。修法取了"最小改动"：三通道各降一点到 `#446de8` → **4.57:1**，通道总和只差 3，肉眼不可辨。规则旁边留了注释说明来历。

**二、模板静态内联 `style="background:…"`**（`inlineSurfaceOffenders()`）。采集器只读 `<style>` 块，模板里的内联背景整类看不见。实测本仓**一处都没有**（扫了 60+ 个 SFC），所以写成**棘轮**：内联背景必须用 `var(--令牌)`，写死的色值或没有 `var()` 的渐变都要报。只认静态 `style="…"`，`:style` / `v-bind:style` 是运行时算的，静态判据读不到也不该硬猜。

**一次夹具写错、判据判对的例子**：自证样例里我原本写了一条 `.token { color: var(--text); background: linear-gradient(#10203f,#0a1730) }` 并期望它**不**报——结果报了，而且是**对的**：`--text` 会随主题翻转，浅色主题下是**深字压在写死的深底**上，正是缺陷。改成写死的浅字（`.dark { color:#f2f6ff; … }`）才是"不该抓"的那一条。夹具的价值就在这里：写期望的人会错，判据不一定错。

**变异验证**：把 `#446de8` 改回 `#456fe8` → 红 1 条；给一个真实模板加上 `style="background:#fdfdfd"` → 红 1 条；两次复原后都是 0 条失败。

**结论**：第 15 条现在只剩**一种**假阴性——判定器读不到字号，所以大字（门槛 3:1）会被按正文 4.5 从严。这一条没法静态解决，只能像 `.switch.on span` 那样逐个查证并登记理由。

### 1.55 课表网格的 roving tabindex：把「待决策」做成实现（第四十一轮）

§4 第 18 条把课表空格标成「待决策」，并且**自己写明了正确解法**：7 × 节次数 个格子（12 节的学期周就是 84 个）全做成 Tab 停靠点，会让键盘用户按几十次 Tab 才穿得过课表，比不给还糟；正确的做法是 roving tabindex + 方向键。这一轮照这个设计实现了。

**三条不变量**（都写进了组件注释与守卫）：

1. 任何时候**恰好一格** `tabindex="0"`，其余 `-1`；
2. 方向键在网格内移动（到边**夹住**，不绕回），Home/End 到本周首尾；
3. 回车/空格与点击**等价** —— 都是「按这一格预填日期与节次」。

**几个只有做了才会遇到的决定**：

- **容器用 `role="group"` 而不是 `role="grid"`**。真正的 ARIA 网格要 `row`/`gridcell` 的完整结构，而这里是 CSS grid 排布、时间轴列与表头混排，重构 DOM 的风险远大于收益。格子本身确实是「点一下添加课程」的按钮，所以格子 `role="button"`、容器 `role="group"` + `aria-label` 给出整块网格的名称。顺带一提，这个选择还让 `tabOrderAndNames` 的 roving 判据能认出这是一个「组内留了停靠点」的正常形态——**那个判据只认 `role="group"` / `role="tablist"`**，认不出来就会把 `-1` 的格子报成「Tab 到不了」。
- **焦点环不用自己写 CSS**。全站焦点样式里本来就有 `[tabindex]:focus-visible`，格子正因为带 `tabindex` 才自动获得实色 outline + 对比光环。
- **可访问名称必须显式给**。空格里没有任何文字（不像课程卡片里有课名/周次/地点），所以 `aria-label` 由 `cellLabel()` 拼出「周X 第N节 起止时间，添加课程」。

**一条被守卫纠正的旧断言**：`keyboardReachability.test.js` 原本有一条**反向断言**守着「空格刻意不给 tabindex」。现在形态变了，它必须跟着变——改成了守新形态（一个停靠点 + 方向键 + 容器 `role="group"`）。同时那份**键盘可达性例外清单有自我淘汰机制**（某条不再被扫到就报「请从 EXEMPT 里删掉」）——它果然立刻报红催着删掉了课表那一项。**这是这套机制该有的样子**：代码改好了，测试催人来删条目，而不是让清单悄悄烂掉。

**我自己写测试时犯的三个错**（都记录在这里，因为它们很容易再犯）：

1. 断言「其余格子都是 -1」时忘了把**停靠点自己**排除掉，于是那唯一的一个 `0` 把测试弄红了；
2. 初始停靠点落在**「今天」那一列**，而夹具里的"今天"是周六 —— 于是 `ArrowRight` 被**正确地**夹住了，我却按 +1 期望。边界相关的断言必须先 `Home` 归位、只依赖相对位置与边界，不能依赖"今天是星期几"；
3. 「回车打开表单」要等**异步组件**（`CourseEditorModal`），一次 `settle()` 不够，得按真实时间轮询。

**变异验证**：把 `:tabindex` 改成固定 `tabindex="0"`（正是"84 个 Tab 步骤"那个回归）→ 红 **2** 条（roving 守卫 + `tabOrderAndNames` 同时抓住）；去掉格子的 `@keydown` → 红 2 条；去掉容器的 `role="group"` → 红 1 条；三次复原后都是 0 条失败。

### 1.56 深色普通模式的 `--bg-tint`：一次有实测依据的配色调整（第四十二轮）

§4 第 21 条记了一件"没改"的事：深色普通模式下 `--bg-tint`(`#131a29`) 与 `--bg`(`#121826`) 的**最大通道差只有 3**，落在页面底色上的内嵌区几乎看不出边界。当时判断"更像审美取舍而非缺陷"、"要真改需要一次专门的深色配色调整"。这一轮就做了这次调整。

**为什么这次能改**：这条不是"有人抱怨过"，而是一个**可以被量化的视觉缺陷**——内嵌区与页面底色分不出边界，等同于"这个区块的层次没有表达出来"。而它恰好也能被守卫守住（第三十六轮那两条"层次不能糊在一起"的判据），所以改完就有回归保护，不是一次性审美劳动。

**选值过程**（先量后改，不是凭感觉调色）：

| 候选 | Δ(`--bg`) | Δ(`--card`) | 压在 tint 上的最弱文字令牌 |
| --- | --- | --- | --- |
| `#131a29`（改前） | **3** ✗ | 10 | `--ink-faint` 5.39 |
| **`#161d2c`（采用）** | **6** | 7 | `--ink-faint` **5.22** |
| `#141b2d` | 7 | 7 | `--ink-faint` 5.31 |
| `#151c2b` | 5 | 8 | `--ink-faint` 5.28 |
| `#172031` | 11 | **4**（贴到 4 的下限） | `--ink-faint` 5.05 |

决定性的一条约束：`--bg` 与 `--card` 之间的最大通道差**只有 13**，而 `--bg-tint` 要同时与这两者"明显分得开"（各 ≥4），所以两边都想拉大是做不到的。选 `#161d2c` 是因为它**各通道均匀提亮**（`+4 / +5 / +6`）——读起来是"更亮的表面"，而不是"更蓝的表面"；`#141b2d` 的 Δ(`--bg`) 虽然更大（7），但通道提升是 `+2 / +3 / +7`，蓝色单独跳 7 会让内嵌区偏蓝，那不是"层次"该有的表现。

**改动前先量了受影响的文字**：深色下真正压在 `--bg-tint` 上的令牌有 `--text`/`--muted`/`--ink-soft`/`--ink-faint`/`--primary`/`--success`/`--warning`/`--danger`。tint 调亮会**降低**与浅色文字的对比度，所以逐个量了一遍：最弱的 `--ink-faint` 是 5.39 → **5.22**，仍然稳稳过 4.5。这不是估算，是让守门人先说清楚余量再动手。

**守卫同步收紧**：`tests/highContrastPalette.test.js` 里"`--bg-tint` 对 `--bg`"的阈值从 **3 提到 4**。3 这个阈值当初唯一的存在理由就是深色普通那一档只有 3 —— 现在它变成 6，这个口子就该关掉：四档实测 4/5/6/6，统一按 ≥4 守。没有调到 6 是因为浅色普通那一档（`#f9fafd` vs `#f5f7fb`）**刻意**只差 4，那是既有审美取舍、这轮不在范围内。

**变异验证**：把深色 tint 退回 `#131a29` → 红 **2** 条（其中一条正是"`--bg-tint` 与 `--bg` 几乎同色：expected 3 to be greater than or equal to 4"）；改成贴住卡片色的 `#1a2132`（与 `--bg` 差 8 够远，但与 `--card` 只差 1）→ 也红 **2** 条（"与 `--card` 几乎同色，内嵌区与卡片分不出来"）。复原后 0 条失败。这条守卫**两个方向都守住了**：既不许退回"与底色糊在一起"，也不许挪到"与卡片糊在一起"。

### 1.57 触控目标钩子接线：人工梳理的盲区补上守卫（第四十三轮）

第五、六轮把触控目标梳理过一遍（`--tap-min: 44px` + `@media (pointer: coarse)` 统一兜底 + `.tap-target` 接线），并且明确**拒绝**了另一件事：拿字号和 padding 去推算像素高度、再断言"不足 44px"。那条理由我完全同意——结论不可靠，属于"假警的守卫最后一定会被人关掉"那一类，所以这一轮**同样不做推算**。

**当年是人工筛的，所以盲区是"后加的 `role="button"`"。** 粗指针下 44px 兜底规则的目标选择器是 `[role='button'].tap-target` —— 也就是说，`role="button"` 是作者**显式声明**"这是个按钮"，而钩子决定它能不能拿到兜底。这两件事必须配套。

**实测结果只有 4 个 `role="button"`**（全仓），其中 **2 个真漏接**：

| 元素 | 声明尺寸 | 处置 |
| --- | --- | --- |
| `LedgerView` `.feed-item` | `height:100%` + `padding:11px 8px` | **接上** `tap-target` |
| `LedgerView` `.cd-row` | `padding:6px 0`，**没有任何 `min-height`** → 约 32px ✗ | **接上** `tap-target` |
| `ScheduleGrid` `.tt-cell` | **自带 `min-height:48px`**（skin-timeline 下 54px）| 记账不放：已 ≥44，接钩子是**空操作** |
| `ScheduleGrid` `.course` | 高由**网格行轨道**决定（`grid-row: 起/止` 跨行）| 记账不放：网格定位元素，加 `min-height` 有溢出轨道风险 |

两者的差别正是"能不能安全加地板值"：`.cd-row` 是**普通列表行**（没有固定高度的网格轨道），加 `min-height` 不会挤爆布局；`.course` 在固定轨道的网格里，加了可能溢出。所以这里**不是**"一律接钩子"，而是"接钩子或写明为什么不接"。

**判据为什么不覆盖全部可点击元素**：`.chip` / `.segmented` / `.link-btn` / `.toast-btn` 这类密集内联控件是**刻意**靠间距而非尺寸达成可分性的（CSS 注释里就写着），全量筛查会把这个已知取舍翻出来重吵一遍。判据只覆盖"作者自己说了这是按钮"的那一类——**确定、可复核、不推算**。

**四条断言各守一件事**：

1. **零漏接**：`[role="button"]` 必须接 `btn`/`tap-target`，否则必须进 `ALLOWLIST`；
2. **例外自我淘汰**：哪一条接上了钩子就必须删掉（报"已不再是例外，请从 ALLOWLIST 里删掉"）；
3. **约定本身必须在**：`style.css` 里必须仍有一个粗指针块同时覆盖 `[role='button'].tap-target` 与 `min-height:var(--tap-min)`——钩子接上了、规则被删掉同样白搭；
4. **规模棘轮**：`tap-target` 元素数不得下降（防"顺手简化"）。

**一处数字更正**：本节所在章节早先写的"`.tap-target` 实际使用 15 处"是**提到 tap-target 的行数**（含注释与 CSS 说明），按开标签解析出的**元素数**是 12 个，本轮接上 2 个后 **14** 个。守卫按元素数棘轮——注释里多写几个字不该让守卫变绿，这是棘轮取值的口径问题，值得单独记一笔。

**变异验证**（三条各打一条不同判据）：去掉 `.cd-row` 的钩子 → 红 **2** 条（全仓判据 + 规模棘轮同时抓住，报错里能直接看到 "expected 13 to be greater than or equal to 14"）；删掉 `style.css` 里 `[role='button'].tap-target` 那条覆盖 → 红 1 条；给 `.tt-cell` 也接上钩子（让例外过期）→ 红 1 条。复原后都是 0 条失败。

**踩到的坑**：`@media (pointer: coarse)` 在 `style.css` 里有**两个**（表单控件、触控目标），用 `{([sS]*?)}` 取第一个块会把结论下在错误的块上——守卫改成**按大括号配平**取出每个块，只要有**一个**块覆盖就算数。这类"取错块"的错误很隐蔽：断言会稳稳地失败，但失败的理由是假象。

### 1.58 焦点不被 sticky 面遮挡：把 12px 的"判断余量"变成真的"滚动余量"（第四十四轮）

这一条是**新识别**的维度（WCAG 2.4.11 Focus Not Obscured），报告里此前一个字都没提过。识别它的线索很小：`DataManager.vue` 里孤零零地躺着一句 `scroll-margin-top:58px`。**一个人在一个地方单独打补丁，通常意味着同一类问题在别处还没被看见。**

**问题形态。** 浏览器把「被聚焦的元素」或 `scrollIntoView` 的目标滚入视野时，会把它滚到**紧贴滚动容器边缘**。而这个应用贴着边缘的地方正好有 sticky 面：

- 上方：弹窗内的自动保存提示（`TimeSettingsModal`，`z-index:3`，padding 7+7 加一行字 ≈ 32px）、表格 sticky 表头（`BatchImportModal`、`CourseManagerModal`）；
- 下方：「快速记录」的 sticky 保存栏（44px 按钮 + padding ≈ 56px）、账本页与作息页的 sticky 底栏。

**关键的那 12px。** `Modal.vue` 的 `keepFocusedControlVisible()` 读起来像是已经处理过这件事：

```js
if (!rect || (rect.top >= top + 12 && rect.bottom <= top + height - 12)) return
active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
```

但那 12px 只用在**判断"要不要滚"**上；真正滚动时，`scrollIntoView({block:'nearest'})` **没有"滚多少余量"这个参数**，浏览器按 **0 余量**贴边。所以元素一滚就贴在边缘，正好落在 sticky 面底下——**余量只能来自 CSS 的 `scroll-margin`**。这也解释了 `DataManager` 的 `.data-section` 为什么必须单独写：它用的是 `block:'start'`，更是直接贴顶。

**修法**（用这个应用自己的先例，而不是新发明一套）：在 `style.css` 里加全站约定，

```css
:where(a[href], button, input, select, textarea, summary, [tabindex], :target) {
  scroll-margin-top: 48px;
  scroll-margin-bottom: 56px;
}
```

三个细节都是刻意的：

- **用 `scroll-margin` 而不是改 JS 的对齐方式**：把 `block:'nearest'` 改成 `'center'` 也能躲开遮挡（`focusNavigation.js` 就是这么做的），但 `center` 会让**每次 Tab 都滚动**——元素本来就在视野里也会被拽到中间，那是体验倒退。`scroll-margin` 只影响"滚到哪"，不改"要不要滚"。
- **用 `:where()` 让特异性为 0**：这样任何局部写法都能覆盖它，`DataManager` 那句 58px 继续生效，未来的个性需求也不会被这条全局规则压住。
- **不限定 `:focus`**：`scroll-margin` 只在"滚入视野"时起作用，而要被保护的目标往往**不是可聚焦元素**（`.data-section` 就是个 `div`）——这也正是它当初需要单独一条规则的原因。

**值的来历**（不是推算像素高度，而是"容得下现已存在的 sticky 面"）：48px 覆盖弹窗内约 32px 的提示与表头并留余量，56px 覆盖底部保存栏（44px 按钮 + 上下 padding）；下限取 44px 与触控目标令牌 `--tap-min` 同档。

**守卫 `tests/focusObscured.test.js`（13 条）守三件事**：

1. 全站约定必须在，且上下余量都 ≥ 44px；
2. **贴边滚动必须写明余量从哪来**：`block:'start'/'end'` 的 `scrollIntoView` 每一处都要在 `OFFSETS` 里写明余量声明在哪，而且**那条声明必须仍然存在**（两向都查，不是只查一边）；全仓目前只有 `DataManager` 一处用它；
3. **遮挡面清单反向守**：清单里的 5 个 sticky 面必须还在——删掉任何一个，就该有人来重新评估 48/56px 是否还有来历，而不是让它们变成魔法数字。

**又踩了一次同一个坑（第三次）**：`rulesWith` 一开始扫的是**原始 CSS 文本**，而这条约定自己的注释里就写着 `scroll-margin-top:58px` 与 `:where()`，于是注释**造出了一条幽灵规则**，真实那条规则的"选择器"也被注释文本污染。后果很严重：把 `:where()` 从代码里删掉之后，测试**照样绿**（污染串里带着注释里的 `:where()`）——**是变异验证把这个假绿揪出来的**。修法是扫 CSS 前先剥注释（`stripCssComments`），并补了两条夹具（注释里的声明不造规则、剥注释不影响代码）。

这个坑在本仓已经出现三次：`<style>` 写在 HTML 注释里被正则吞掉、`@page` 被注释骗到、以及这里的 CSS 注释。**凡是要 parse 的东西，先剥注释**——值得当作本仓的一条硬规矩。

**变异验证**：余量缩到 12px → 红 1 条（"上方余量小于 44px"）；`:where()` 换成普通选择器 → 红 1 条（"找不到 `:where(...)` 的全站约定"）；删掉「快速记录」的 sticky 底栏 → 红 1 条；删掉 `DataManager` 的 `.data-section` 余量 → 红 1 条。复原后都是 0 条失败。

### 1.59 聚焦指示器的非文本对比度：一条新维度，量完发现已经做对了（第四十五轮）

前几轮把焦点可见性重建过一次（`--focus-ring` 那套几乎透明的写法换成了实色 `--focus-solid` outline + `--focus-halo` 对比光环）。这一轮问的是：**这套东西有没有被守过？** 答案是没有——它没有出现在任何对比度判据里（正文用 4.5:1、UI 组件与指示器用 WCAG 1.4.11 的 3:1，两者不是一回事）。

**先想清楚"相邻颜色"到底是谁**。`outline-offset: 2px` 会在 outline 与元素边框之间露出一条缝，缝里是**元素自己的背景**——所以主色按钮的 `--primary`、危险按钮的 `--danger` 都是焦点环的相邻色。这正是"焦点环落在主色按钮上就看不见"那类缺陷的来源，也是本仓要同时画两圈的原因。

**判据**：对每个主题的每类相邻背景，`outline` 与 `halo`（半透明，要按 alpha 混到底色上再算）**至少有一圈**达到 3:1。不是"两圈都要达标"——两圈互为补位**就是设计意图**：

| 相邻背景 | outline | halo | 取优 |
| --- | --- | --- | --- |
| `--card`（默认主题） | **5.87** | 1.00 | 5.87 |
| `--primary`（默认主题） | **1.11** ✗ | **4.75** | 4.75 |

要求"两圈都达标"会把一个**做对了的设计**判成缺陷；要求"至少一圈达标"才是 WCAG 1.4.11 真正要的可感知性。**实测 6 个主题 × 7 类相邻背景共 42 组全部达标，最弱一处 4.75:1。**

**结论：这条维度没有缺陷**，但这不等于白干——它现在是**棘轮**：绿色主题的 outline 压在 `--primary` 上只有 **1.00:1**（完全同色），换个色值或把 halo 调透明就会塌。守卫会当场抓住，而且夹具里那两条"outline 弱但 halo 强 → 放行"的用例把这个设计意图写进了测试。

**一个被夹具逼出来的实现 bug（值得单独记）**：写 `blendColor` 时把通道提取写成了 `backdrop.slice(i, i + 2)`，`i = 2, 3` 时取错位置。夹具里那条"全透明的 halo 混到底色上必须等于底色"（`rgba(0,0,0,0)` over `#123456` 应得 `#123456`）当场就红了——**如果没有这条夹具，这个 bug 会一直藏着**，因为算出来的 halo 对比度只是"略有偏差"，42 组照样全绿，谁也不会怀疑。我的探针脚本里有同一个错误，所以本轮先前记下的 halo 数值（5.00）是偏的，修正后的真值是 **4.75**，报告与 `style.css` 注释都已按真值更新。

**顺带改掉一句不实注释**：`style.css` 里写着"`--focus-halo` 由 appearance.js 按壁纸亮度在浅/深之间切换"。核实结果：全仓 `--focus-halo` 只出现在 `style.css` 里（浅/深各写死一档），`appearance.js` 里没有这段代码——**注释在描述一个不存在的机制**。已改成实际情形，并写明为什么不为此引入运行时切换：壁纸与主题不匹配时 halo 可能看不出来，但那种情况下 outline 对元素背景仍然达标，指示器整体依旧可感知。

**为什么壁纸不进判据**：壁纸是用户图片、不是主题令牌，静态判据读不到；而"每个主题里至少有相邻色由某一圈达标"这条不变量与壁纸无关，是能确定的那部分。这又是同一个取舍——**守能确定的，不猜猜不准的**。

**变异验证**：深色 halo 调成近全透明 → 红 1 条；halo 全透明 + outline 换成近底色 → 红 1 条；把 `--primary` 从相邻背景清单里"精简"掉 → 红 **2** 条（清单必须含 `--primary` 的用例 + 规模下限）。复原后都是 0 条失败。

### 1.60 移动端视口与输入：三件都量了，只有一件真的有洞（第四十六轮）

这一轮把"移动端"这一类里三个**静态可判定**的经典项一起量了一遍。结论是**两件早就做对了、一件真有洞**——这个比例本身就值得记下来：前几轮补安全区、补触控目标的那批工作，确实把这一类覆盖得比较齐了。

**一（真有洞）：尺寸类的 `Nvh` 缺 `dvh`。** 移动浏览器地址栏收放时，`100vh` 按"地址栏收起"算，于是它**大于**真正的可见高度；`max-height: 85vh` 的弹窗会比可见区还高，底部按钮落到浏览器栏下面。应用里已有零星的 `dvh`（`Modal`、`ActionSheet`、`App`、`body` 的 `@supports` 兜底），但**约二十处尺寸声明仍是 `vh` 独苗**。

修法用**级联回退**而不是 `@supports`：先 `vh`（老浏览器看得懂），紧跟一行 `dvh`（新浏览器覆盖）。零风险、不需要条件块。共补 **16 条孪生**（`Modal` 的 85vh、`FocusPanel`/`TodayView` 的 55vh、`ImportConflictModal` 的 42vh、`SearchPanel`、`TimeSettingsModal` 两处、`QuickRecordPanel` 的 textarea、`ImageCropModal`、`Sidebar`/`App` 的 `height:100vh`、`style.css` 的 `min-height:100vh`……）。

**只守尺寸，不守别的**：`transform: translate3d(0, 108vh, 0)` 里的 `vh` 只是个长度（彩带从屏幕外飞进来），地址栏收放不影响它该有多长——所以判据只看 `height / min-height / max-height`。这条边界写进了守卫，并且有夹具。

**过程里我自己的两个错**（都值得记）：

1. 第一遍用**行首锚定**的正则扫描，漏掉了写在**单行规则内部**的声明（`QuickRecordPanel` 的 `.note-body{…;max-height:40vh}`、`SearchPanel`、`TimeSettingsModal`、`NotFoundView`、`ImageCropModal`）——补了第二遍行内插入才发现。**"属性在行首"根本不是 CSS 的事实，只是我上一批文件恰好长那样。**
2. 写完改动后写了个复核脚本，却只在本行里找孪生行——而孪生行按设计就在**下一行**。于是它报了 11 处"缺漏"，其中 10 处是假的（真漏网的是 `QuickRecordPanel` 那条**没有分号、以 `}` 结尾**的声明）。改成"全文偏移感知"后才归零。**复核脚本本身也是要验证的代码**，它报的"缺漏"和守卫报的"缺陷"一样需要先怀疑。

**二（早就做对了）：触屏设备上表单控件不小于 16px。** iOS Safari 聚焦 `font-size < 16px` 的控件时会自动放大整个页面，用户还得手动缩回去。`style.css` 里**已经有**这条规则（`@media (pointer: coarse)` + `font-size: 16px !important`，连注释都写好了）。我这轮先精确量出"控件类且声明 < 16px"的规则有 **10 条、分布在 7 个文件**（11–14px），正要逐个组件补覆盖块时，才读到全局那条——它靠 `!important` **已经全部压住了**。

这里有个非显而易见的技术点：本仓大量控件的字号写在组件 `<style scoped>` 里，编译后选择器会多一个 `[data-v-xxxxxxx]` 属性（等于多一个类级权重），**全局规则按特异性永远赢不了**——所以那个 `!important` 不是随手加的，是唯一可行的写法。守卫现在把这一点也锁住：去掉 `!important` 会红。同时锁住"必须是 `pointer: coarse`、不能是 `any-pointer`"：带触摸屏的笔记本主指针仍是 `fine`，用 `any-pointer` 会把桌面的紧凑排版（11–14px）一起改掉。

**三（查完确认不是问题）：数值输入的 `inputmode`。** 初筛报 18 处"缺 inputmode"，逐条看下来**大多是假阳性**：多为 `type="number"`（本就有数字键盘）、`type="range"`（滑块，不需要键盘），以及我关键词匹配到的"account"（账户名，不是数字）。这条没有真命中，**不改**。

**变异验证**：删掉 `Modal` 的 `max-height: 85dvh` 孪生 → 红 1 条；整块删掉触屏 16px 规则 → 红 2 条；`pointer: coarse` 改成 `any-pointer: coarse` → 红 1 条；去掉 `!important` → 红 1 条。复原后都是 0 条失败。

### 1.61 拖拽的替代路径与页面标题：一条整类没人碰过，一条早就做全了（第四十七轮）

这一轮量的是 WCAG **2.2** 里两条整类容易被漏掉的：拖拽动作的替代（2.5.7 Dragging Movements）与页面标题（2.4.2 Page Titled）。

**一、拖拽（有真缺陷，修了两处）** —— 仓里此前**没有任何判据**碰过这一类。拖拽对明眼触屏用户太自然，写的人不会觉得"缺了什么"，而键盘用户会直接卡死。扫描口径是"同一份文件里既有 down 又有 move"，**候选由扫描得出、不手写**，命中共 5 个文件。

**修的第一处：`ImageCropModal`（拖动框选课表区域）。** 它只有 `pointerdown/move/up`，模板里没有 `keydown`、没有 `tabindex`、没有任何 `aria-*`。现在：区域可聚焦（`tabindex="0"` + `role="group"` + `aria-label` + `aria-describedby` 指向操作说明），方向键平移、`Shift + 方向键` 往回收、`Ctrl + 方向键` 往外扩，另有 `aria-live` 的选区读数（明眼用户看得到数值变化，读屏用户听得到）。

**这里我一开始判断错了，是测试把正确形态顶出来的。** 我只读了 `begin()`（它把选区重置成一个点），就推断"默认选区 0 宽 → 裁切按钮一直 disabled → 键盘用户完全走不通"。实际 `resetPreview` 把初始选区设成**整张图**（0/0/100/100），按钮一开始就是可用的——**流程走得通**。真正的缺陷是**改不了**：整图宽 100%，平移会被夹住、也收不小，而"收小"恰恰是这个弹窗的主操作（提示里就写着"排除状态栏、广告"）。

这个纠正直接改掉了实现：一是键位语义要**完整**（只会"长"不会"收"等于没修，所以是 Shift 收、Ctrl 放）；二是要**播种**——对着整张图按方向键等于按了没反应，所以第一次方向键会把"未动过的整图默认值"替换成一个居中的合理子区域（80% × 60%），但已经拖过的选区绝不顶掉（播种条件严格写成"恰好等于初始默认值"）。测试里专门有一条能**区分**这两种情况的用例：先收成 60% 宽再平移，尺寸必须保持 60%——若播种条件过宽就会弹回 80%。

**修的第二处：`AppearanceSettings`（首页模块拖动排序）。** 手柄本身是 `<button>`（能 Tab 到），但按 Enter 或方向键什么都不发生，所以键盘用户改不了顺序。现在手柄上 `Alt + 上/下` 移动，并且**焦点跟着模块走**——否则连按第二下，动的是"顶上来的那个模块"而不是用户盯着的那个（第四十一轮课程表网格踩过同样的坑）。

**另外三个候选判定为已达标，理由都核实过（不是凭印象写）**：`Modal.vue` 的弹层拖动关闭有 Esc 与关闭按钮；`SwipeActionItem` 的滑动操作有"回车打开详情面板，那里有全部真按钮"；`ExamsView` 走的是 `longPress.js`——那里的 `onPointerMove` 是用来"手指一动就取消长按"的（`moveTolerance`），不是拖拽操作本身，长按也不属于 2.5.7 管的范围，卡片本来就是点击入口。

**二、页面标题（查完发现早就做全了）** —— `App.vue` 用 `route.meta?.title || 学习生活台` 驱动 `document.title`，而 11 条路由里 10 条都写了 `meta.title`，唯一没写的是 `/today` 重定向（正该豁免）。**没有缺陷**，但这类"有兜底所以不报错"的写法最容易漏，所以把判据留下了：有组件的路由必须有 `meta.title`、没标题的只能是重定向、标题互不相同。

**守卫自身的两个弱点，都是变异验证抓出来的**：

1. 清单里 `ImageCropModal` 的替代钩子我一开始只写了函数名 `onStageKeydown`，于是**只删模板绑定**（`@keydown="onStageKeydown"`）也照样全绿——**needle 太弱等于没守**。补上绑定后，删绑定、删 `tabindex`、删 `aria-describedby` 三个变异各自都能红。（同一个文件里 `AppearanceSettings` 那条我写了绑定，两条口径不一致本身就是信号。）
2. 我给 `ExamsView` 写的钩子是 `moveTolerance`，但它**在 `longPress.js` 里**、不在这个文件里——测试当场报"找不到替代钩子"。改用该文件里真实存在、且更有意义的 `createLongPress` + `shouldSuppressClick`（后者恰好证明"没触发长按时点击照常生效"，即长按只是叠加的快捷方式）。**清单里每条理由都得能在代码里指出来。**

**变异验证**：新增一个只有拖拽没替代的文件 → 红（未列候选被抓）；删裁切弹窗的 `@keydown` 绑定 / `tabindex` / `aria-describedby` → 各红 1 条；删模块排序的键盘绑定 → 红 1 条；抹掉一个路由的 `meta.title` → 红 2 条；把两个标题改成一样 → 红 1 条（重复标题）。复原后都是 0 条失败。

### 1.62 标签与引用的完整性：查完没有缺陷，但把"静默失效"这一类锁住了（第四十八轮）

这一轮查的是一类**不会有任何症状**的 bug：`for=` 写错一个字母、`aria-describedby` 指向一个被 `v-if` 藏起来的元素——页面照常渲染、功能照常可用，只是那个 label 不再关联控件、那段说明读屏用户永远听不到。没人会注意到，除非专门去查。

**分两层查，因为两层能看见的东西不一样。** 静态层查字面量引用能否在本文件解析、以及**跨文件**有没有两个组件声明同一个 id（同页共存就会撞车）；渲染层真实挂载 10 条路由后，查**整个文档**的重复 id 与渲染后指向空气的引用。渲染层补的正是静态层的盲区：id 明明写在文件里，但它所在的元素这次没有被渲染。

**实测：静态 18 处 `for=`、8 处 `aria-labelledby`、1 处 `aria-describedby`、46 个 id 字面量，零断裂、零跨文件撞车；渲染 10 条路由，零重复 id、零断裂引用。**这一维**没有缺陷**——但判据留下了，因为上面那两种失效方式都是静默的。

**同一个坑，第四次。** 写静态层时我忘了剥注释，于是 `NotFoundView.vue` 里一句解释性注释（"本组件渲染在 App.vue 的 `<main id="main-content">` 内部"）被当成了真的 id 声明，报出"跨文件撞车：main-content"。渲染层的 0 处重复当场说明它是假的。这个坑在本仓已经出现四次：`<style>` 写在 HTML 注释里被正则吞掉、`@page` 被注释骗到、CSS 注释里的属性声明造出幽灵规则、以及这里的注释里的 id。本轮把它写成了夹具里的一条**对照**用例（同一份模板：剥注释 → 无撞车，不剥 → 误报撞车），而不只是一句注释说明。

**同一轮的第五次，这次是在变异脚本里。** 变异验证第一轮，"把某个 label 的 `for` 指错"这条**没有红**：替换恰好打在 `TimeSettingsModal.vue` 的**注释**里，而守卫是剥注释的，所以它看不见。这是比前四次更阴的一种：**变异打在注释里 = 假绿**，而我的脚本只检查了"变异有没有生效"（字符串有没有变），检查不出"变到注释里去了"。同一轮里另一条变异则是目标文件根本没有那个属性（我以为 `SearchPanel` 里有 `aria-labelledby`）。两条都改成真实模板位置后各自变红。教训：**变异脚本自己也要挑对位置，"没红" 和 "打偏了" 必须区分开。**

**还查过、确认不是问题的一条**："元素只靠 `title` 属性当可访问名称"（`title` 不是可靠的名称来源）。初筛报 28 处，逐条看全是**组件的 `title` prop**（`<Modal title="…">`、`<EmptyState title="…">`），不是 HTML `title` 属性——是我的探针把 PascalCase 组件一起算了。**假阳性来自探针，不是来自代码**，所以这条不设判据，但把这个结论记在这里，免得下一轮有人再筛一遍。

**变异验证**（全部按预期，含两条重打的）：把 `CourseEditorModal` 的 `for="course-name"` 改成不存在的 id → 红 1 条；把 `TimeSettingsModal` 的 `aria-labelledby` 改成不存在的 id → 红 1 条；让 `EmptyState` 声明一个与 `App.vue` 相同的 id → 红 2 条（静态撞车 + 渲染重复）；给 `NotFoundView` 塞一个与主内容相同的 id → 红 2 条。复原后都是 0 条失败。

### 1.63 对比度判定器补上"大字"门槛：把 §4 第 15 条最后一种假阴性关掉（第四十九轮）

WCAG 1.4.3 里大字只要 **3:1**，正文要 **4.5:1**。跨规则判定器（§1.53）只看颜色、读不到字号，所以对大字也按正文从严——这既是 §4 第 15 条列的最后一种假阴性，也意味着判定器**永远不能收紧**（想收紧就先得会区分大字）。这一轮把它补上了。

**怎么改的**：解析时把 `font-size` / `font-weight` 一起留在规则上，配对时用**字色那条规则自己**声明的字号算出该用哪个门槛。≥24px，或 ≥18.66px 且加粗（≥600）→ 按 3:1；其余一律 4.5:1。CLI 汇总里也报出"多少条规则被判成了大字"，判定口径要看得见。

**门槛读错的方向是不对称的，所以只认"能证明的下界"。** 从严（漏看大字）只是误报，放宽（把正文当大字）会**漏掉真缺陷**——所以只有数学上保证不小于某值的写法才降门槛：

- `30px` → 30 ✓；`clamp(30px, 3vw, 38px)` → 30 ✓（clamp 的值不小于它的最小值）；`max(30px, 3vw)` → 30 ✓；`calc(30px + 1vw)` → 30 ✓（vw 非负）。
- `min(30px, 3vw)` ✗（min 只会更小）、`calc(30px - 1vw)` ✗（减去的视口单位可能更大）、`max(3vw, 30px)` ✗（第一项不是 px 就不猜）。
- `1.5rem` / `150%` / `2em` / `var(--fs-xl)` ✗ —— 相对值静态读不出真实像素，一律从严。

**我自己的夹具抓到了我实现里的第一个真漏洞。** 第一版用 `parseFloat` 直接读数字，于是 `150%` 被读成 **150**（`parseFloat` 只认开头数字，不看单位），被判成"大字"从而**放宽**了门槛——正是上面说的危险方向，而且 `30em` 同理。改成必须**明确带 `px` 单位**（`/^([\d.]+)px$/`）后夹具变绿。这也说明"读不准就从严"不能靠自觉，得让单位要求本身被夹具钉住。

**变异重打两次，第二次是因为夹具太弱。**第一轮 5 条变异里，"把 `min()` 也当下界"和"clamp 内部不再要求 px 单位"两条**没有红**——因为我的夹具里没有 `clamp(150%, …)` / `clamp(1.5rem, …)` / `max(2em, …)` 这类输入，clamp 内部的单位要求**不受任何约束**。补上这些夹具后，这两条变异各自变红。这是本仓反复出现的同一种毛病：**夹具太弱等于没守**。（另有两条变异是我自己替换串写错导致"没生效"，重打后正常——"没红"和"打偏了"必须分开看。）

**实测口径（不夸大）**：全仓有 **14 条**规则的字号是**可证大字**（含 §4 第 15 条点名的 `FocusPanel .focus-clock: clamp(30px,3vw,38px)` 与 `TodayView .focus-clock: max(30px,min(3vw,38px))`）。但**今天没有任何判定结果改变**：真实进入配对的只有 6 组，这 14 条一条都不在其中，所以 CLI 仍报 `largeTextRules: 0`、`offenders: 0`。改的是**判定器的能力**——它不再会对大字误报，也终于具备了收紧的前提。这一点必须写清楚，否则就成了"修了个看不见的东西"却宣称修了缺陷。

**自校准夹具**：判"大字不报"需要一对恰好落在 3:1~4.5:1 之间的颜色。夹具不写死色号，而是**从实时调色板里找**这样一个颜色（找不到就红，说明判据失效），再逐主题精确断言：14px 时每个主题都报、24px 时只在真正低于 3:1 的主题里报。这样调色板将来变了，这条判据依然有判别力。

**变异验证**（共 7 条，全部按预期）：一律按 4.5（大字不放宽）→ 红 3 条；一律按 3（正文也放宽，最危险）→ 红 3 条；把 `min()` 也当下界 → 红 1 条；去掉 px 要求用 `parseFloat`（`150%` 变大字）→ 红 3 条；clamp 内部不再要求 px 单位 → 红 1 条；calc 接受减法 → 红 1 条；24px 门槛改成 40px / 加粗阈值 600 改 800 → 各红 2 条。复原后都是 0 条失败。

### 1.64 给样式注释上棘轮：让"注释静默消失"这件事必须被意识到（第五十轮）

§4 第 22 条记录的是第三十七轮事故的代价：我用正则清理死类时规则区间偏移算错，把 6 个文件约 259 条规则切碎。但**在构建报错之前，注释已经被同一批正则吃掉了**——注释不影响 CSS 解析，删掉之后构建照样通过、测试照样全绿（既有守卫只检查行为），所以这种破坏**一点症状都没有**。恢复只能靠删除前的构建产物，而编译产物里没有注释：这 6 个样式块约 1000 条规则的逐条解释整体消失，只剩一个"原注释在恢复中丢失"的说明。

**先说清现状（与预期不同）**：我以为说明注释只补了四个文件，实测**六个都有**（报告里那句"四个"说的是第三十八轮清副本那件事，不是这个）。真正的缺口是**注释的实质**：六个文件加起来只剩 **7 条** CSS 注释。

**这一轮做的两件事**：

1. **把能证明的解释补回来**（7 → 16 条，逐处核实，不编理由）：`App.vue` 的层叠阶梯（并指出跳转链接必须在最上层，否则它聚焦浮现时会被浮层盖住）与 vh/dvh 兜底、安全区配套；`TodayView.vue` 的 `.focus-clock` 为何是**可证大字**（clamp 的最小值 30px，并提醒别改成 `min()`）、面板的 dvh 孪生；`DataManager.vue` 的 `.data-section` 58px 对应哪个守卫；`ScheduleView.vue` 的 `.skin-*` 是动态拼接、**别当死类删**（这正是第三十七轮误删的起点）；`LedgerView.vue` 的 `.pending-row` 是可点击行、以及为什么不给它 role/tabindex（切页签有键盘可达的替代路径）；`AppearanceSettings.vue` 的弹层 40px 预留与 dvh。**没写的一处**：`DataManager .health-largest` 的 `font-size:10.5px!important` —— 它到底在覆盖哪条规则，代码里看不出来，宁可不写也不编。
2. **上棘轮**（`tests/styleComments.test.js`）：第三十七轮受损的 6 个文件各自有注释下限、全仓总数下限（实测 131）、以及"6 个重建过的样式块必须保留原注释丢失的说明"。想合法减少就得来改这里的数字——那正是这个守卫要的效果：让"注释没了"必须被**意识到**，而不是静默发生。

**写这个计数器时，同一个坑踩到第四次和第五次。** `App.vue` 的模板注释里有一句"见 `<style>` 里的 …"，不剥 HTML 注释就会从注释里那个字面量 `<style>` 起匹配、把整段模板当样式去数；`content: "…"` 里的注释起始符号也要先掩掉字符串。两条都做成了夹具。

**第六次更妙，而且发生在我自己身上**：这个测试文件的文档注释里，我为了举例写了 `content: "…"` 里那种注释符号的**完整形式**，于是那个 `*/` 提前终结了块注释，整个文件 JS 语法错误、一条用例都收集不到。**关于注释的注释，也要遵守注释的规则。**

**顺带发现一个真问题，但这一轮故意没修**：`ScheduleView.vue` 的 `.skin-notebook` 一族出现了两份**逐字相同**的规则，两份都在顶层（花括号深度 0）。我的探针还声称"共 15 组完全同值重复"，但**那个探针的切分被证明不可信**（会把相邻规则的片段粘在一起）。第三十七轮的事故正是"在不可信的解析上做破坏性扫除"，所以只记成 §4 第 23 条，等有了可信的规则切分器再复核清理。

**变异验证**（5 条，全部按预期）：把 `App.vue` 样式块的注释全部吃掉（事故重演）→ 红 3 条；删掉本轮给 `LedgerView` 加的注释 → 红 2 条；删掉 `ScheduleView` 的"注释丢失"说明 → 红 3 条；计数器不再剥 HTML 注释 → 红 2 条（夹具报"样式块不该包含模板"）；计数器不再掩字符串 → 红 1 条。复原后都是 0 条失败。

### 1.65 可信的规则切分器与同值重复规则：一次被产物抓住的极性错误（第五十一轮）

§4 第 23 条留下的前置条件是"先有一个可信的 CSS 规则切分器"。这一轮把它做出来了（`scripts/css-rules.mjs`），并用它清掉了第三十七轮恢复留下的同值重复规则——**过程中我自己犯了同一个坑的第四次变体，是构建产物把它抓住的**。

**为什么解析器要单独做、还要能自证。**第三十七轮的事故根因是"在不可信的解析上做破坏性扫除"：`matchAll(/[^{}]+{/)` 在 `@media` 之后继续匹配内层规则，同一条规则被以错误偏移记录两次，删除时切碎了 6 个文件约 259 条规则。第四十九到五十轮我又两次写出坏解析（把相邻规则的片段粘在一起）。所以这次的四条要求是：先剥注释再掩字符串（本仓已踩过六次同一个坑）、栈式花括号配对而不用正则区间、偏移是原文偏移可 `slice` 回整条规则、显式记录 `@media` 上下文（"声明相同"只有在**同一上下文**里才等于"可以安全删掉一条"）。不配平时 `ok: false`，调用方据此中止——宁可不做也不猜。

**切分器自身也抓到一个 bug**：选择器取自**原文** prelude，于是上一轮插在 `.skin-notebook` 前的那条注释被算进了选择器，那一族因此没被识别为重复。改成取掩过的文本后，重复条目从 18 变 19。

**实测**：`ScheduleView.vue` 有 19 条同上下文逐字重复的规则（该文件 155 条规则的 12%），都是第三十七轮整段搬入留下的；全仓其余文件为 0。

**极性错误，以及它是怎么被抓住的。**"同值重复"里，**后出现的那一份才是会赢的那一份**。我的删除脚本保留 `group[0]`、删掉 `group.slice(1)`，正好删掉了会赢的那份。产物比对抓住了它，但过程不是一步到位的：

1. 先比 `dist/assets` 的 CSS——**结果全红**，因为 Vue 的 scope id 由文件内容派生，改了源文件后产物里每个 `[data-v-…]` 都变了。这是我一开始的裁判设计错误。
2. 归一化 scope id 后再比：**规则集合完全相同**（0 凭空出现、0 丢失），但**顺序不同**。集合相同不等于级联相同，于是写了第三个检查：同上下文、共享类名、相对顺序发生翻转的规则对——命中**恰好一对**，`.skin-notebook .tt-cell` 与 `.tt-cell:hover,.tt-cell.isToday`（特异性都是 0,2,0、都设 `background`、能匹配同一个元素）。
3. 修法不是"撤销删除"，而是把这一条**移回它最后一次出现的位置**（去重前它正是靠后出现才赢的）。移完复检：翻转对 **0**，同值重复 **0**。

**我先前写进版本说明的一句是错的，已改正。**第一次 bump 时我写的是"删前删后产物逐字节比对，证明删掉多余的重复规则不改变任何声明"——那是**基于错误期望的过度声称**（我当时以为产物会逐字节相同）。发现极性错误后用 `--amend-notes` 改写为实情，并明确写出"先前的说法是错的"。**没有新增版本号**：那句话本来就描述这一轮的工作，改的是它的真实性。

**因此顺序写成了判据**：`tests/cssRules.test.js` 断言 `.skin-notebook .tt-cell` 必须排在 `.tt-cell:hover,.tt-cell.isToday` 之后，并在测试里写明原因（特异性相同、都设 `background`，顺序一翻转就换底色）。这样下一轮的人再怎么"清理"，这条顺序都不会被静默改掉。

**变异验证**（6 条，全部按预期）：切分器选择器改回取原文 → 红 2 条；去掉花括号总数校验（多余 `}` 检测不到）→ 红 1 条；字符串不再掩掉（`content:"}"` 被当成结构）→ 红 1 条；`@media` 不再递归 → 红 3 条；重复检测跨上下文也算重复 → 红 1 条；把 `.skin-notebook .tt-cell` 移回前面 → 红 1 条（顺序判据）。复原后都是 0 条失败。

**顺带记两条工具教训**：`--amend-notes` 需要带说明文本（不带会直接校验失败、什么都不写），以及**破坏性脚本必须自己从仓库根目录跑**——我两次把 `cd scripts` 和用相对路径 `src` 的脚本凑在一起，白跑两轮。

### 1.66 存储损坏韧性：一次假绿探针的根因，和一次把自己留在变异状态的事故（第五十二轮）

这一轮**没有产生任何 `src/` 改动**——开头的探针是假绿，收尾的变异验证把仓库留在了一个坏状态，两个问题都值得记下来，以免下一个人重踩。

**要验的维度**：给全部 45 个 `sl_*` 键逐个塞进损坏值（不是 JSON / 类型完全不对 / 类型对但内部形状不对），看应用是否仍然不崩、不弹全局错误、不进安全模式、主内容照常渲染。

**代码审查层面的结论（可信）**：读取路径是健全的。`store/core.js` 的 `useStoredRef()` 读 `localStorage` 包了 try/catch，失败回退默认值并走静默错误上报（**不弹 toast**）；`normalizeStoredValue()` 会修复类型不对的值（数组 / 对象 / 原始值三类各自处理，并把修复写回）。唯一可疑的漏洞面是**嵌套形状损坏**：它**只做顶层合并**，所以 `sl_appearance.wallpapers` 被存成字符串时会原样进入状态，后续 `.map()` 可能抛错。

**第一版探针为什么是假绿（根因）**：store 模块里的 `useStoredRef()` 在**测试文件 import 的那一刻**就执行完了——那时 `localStorage` 还是空的，模块级的 `storedRefs` 已缓存默认值。之后往 `localStorage` 里塞的损坏值**从来没被读过**。发现方式是变异验证：我做了两个变异（一、去掉读时的 try/catch；二、跳过形状修复），**两个都没让探针变红**——不是"实现很健壮"，而是**探针根本没有判别力**。正确写法是每个用例 `vi.resetModules()` 之后**动态 import**，让模块在播种之后才初始化。

**第二版仍然没跑完**：改成 `resetModules` + 动态 import 后，正确的矩阵（45 键 × 4 变体 × 10 路由，每次约 1.5 秒）跑满 10 分钟被超时杀掉。缩矩阵的建议与全部已知信息已写进 `HANDOVER.md` §3.1，**这是一条明确留给后续的欠账**。

**收尾时的事故（已发现并恢复）**：那个被超时打断的变异脚本，在写入变异与还原两个步骤之间被杀掉，把 `src/composables/store/core.js` **留在了变异状态**——读存储的 catch 被换成了直接抛出，也就是不再兜底。是我在收尾检查里逐条 grep 才发现的，已恢复原文与原注释，`git diff` 确认无残留。**教训**：变异脚本必须把还原放进 `finally`，并且**每次中断或超时之后都要抽查被变异过的文件**。

### 1.67 存储损坏矩阵：补齐第三种变体，当场抓到一处启动白屏（第五十三轮）

**这一轮把 §3.1 的欠账做完了，而且它立刻还本**：矩阵补上第三种变体（嵌套形状损坏）之后第一条就红——`sl_timecfg` 被塞成 `{"periods":"oops"}` 时应用**启动即崩**。这不是"我把守卫写红了"，是守卫抓到了一个真缺陷。本轮只改了一个函数（`src/composables/store/timeConfig.js` 的 `normalizeTimes`），修的是用户可感知的白屏。

**先量，别猜：上一轮的成本估计高了一档。** 第五十二轮的建议是"缩到 45 键 × 2 变体 × 3–4 路由"，理由是"45 × 4 × 10、每次约 1.5s → 10 分钟被超时杀掉"。实测单条用例（`vi.resetModules()` + 动态 import + 真挂载）约 **0.04s**：**36 键 × 3 变体 × 2 路由 = 174 条用例只要 4.9s**。所以这一轮**没有缩**，反而把键从 10 个扩到全部 36 个（原来写死 `CORE_KEYS = SL_KEYS.slice(0, 10)`）。上一轮之所以跑到 10 分钟，是"4 变体 × 10 路由"的组合数问题，不是单条成本问题——**把成本量出来，才发现"必须缩矩阵"这个前提本身是错的**。

**补上的第三种变体才是关键。** 原来两种变体（`not valid json`、`"just a string"`）**都被 `normalizeStoredValue` 的顶层校验兜住了**：数组键被存成字符串会被判成"形状不对"，于是回落默认值。所以矩阵全绿，却**恰好绕开了交接文档 §3.1 点名的唯一可疑面**——嵌套形状损坏（`normalizeStoredValue` 只做 `{...default, ...saved}`，嵌套值是什么就用什么）。**变体的选择本身就决定了这份矩阵看不见那个洞**；这比"用例太少"更隐蔽：用例数量翻了几倍，判据却仍然是盲的。

**抓到的真缺陷（启动白屏）**：

```
TypeError: cfg.periods.map is not a function
 ❯ normalizeTimes src/composables/store/timeConfig.js:72:33
 ❯ src/composables/store/timeConfig.js:184:1     ← 模块求值期
 ❯ src/composables/store/index.js:3:1
 ❯ src/composables/theme.js:2:1
```

第 184 行是**顶层**的 `normalizeTimes(timeConfig.value)`，在 `useStoredRef()` 读 try/catch **之外**，也在 Vue 的 errorHandler 之外——所以它既不会走静默上报，也不会进安全模式、不弹 toast，而是**整个模块图求值失败 = 应用起不来**。三个字段都能触发：`periods`（L72 的 `.map()`）、`seasons`（L63 的 `for...of`）、`campuses`（L68 的 `for...of`）。

**根因是两层叠加，不是单点**：

1. `loadTimeConfig()`（L43–51）自带 try/catch 和 `migrateTimeConfig()` 迁移，会把 localStorage 合进**默认值**——它本身是好的；
2. 但 `useStoredRef('sl_timecfg', loadTimeConfig())` 把这个"已经合过 storage 的对象"当成**默认值**，`normalizeStoredValue` 于是**又合一次** `{...default, ...saved}`，把原始损坏值**盖了回来**；
3. `normalizeTimes` 只校验了 `times`（L59）与 `times[season][campus]`（L64/L69），**没校验 `periods`/`seasons`/`campuses`**——形状修复只做了一半。

第 3 点可直接修；第 2 点解释了"为什么 `migrateTimeConfig` 的兜底没救回来"，值得单独记：**给某个键写了自定义 loader 的，别指望 `normalizeStoredValue` 会尊重 loader 的修复结果——它只认自己那套顶层合并。**

**修法（最小、留在读取层）**：`normalizeTimes` 对这三个数组做与 `times` 同一套形状修复——不是数组就回落到 `defaultTimeConfig()` 的对应字段，并置 `changed`（供调用方判断；模块顶层那次调用并不看返回值）。**写回不依赖这个返回值**：`useStoredRef` 在 L335 把**原始 raw** 记为 `baselineRaw`，而模块顶层的这次修复是在它之后**同步**改的值，idle 安装的 watcher（L242）一比对就发现不一致并调度写回，所以修好的形状会落盘。**没有改 `sl_timecfg` 的存储语义**（键名、形状、含义都不变），也**没有**在模块顶层补 try/catch：那会把"配置形状又回归了"这类真问题变成又一处静默降级。

**判别力证据（不是"改完就绿"）**：

| 阶段 | 结果 |
| --- | --- |
| 修之前 | **6 红 / 168 绿**：恰好 `sl_timecfg` × {periods, seasons, campuses} × {home, tasks}，失败信息就是 `cfg.periods.map is not a function` |
| 修之后 | **174 全绿**；`tests/timeConfig.test.js` 3 条无回归 |
| 顶层损坏那一类 | 36 键 × 2 个顶层变体**全部绿**——顶层的兜底确实健全，缺的只是嵌套这一层。这也正式回答了 §3.1 留的问题："到底有没有键会崩"→ **有，且只有 `sl_timecfg` 的嵌套形状** |
| 其余 13 个嵌套载荷 | 全绿（`sl_appearance` 的 quotes / homeModules / swipeActions、`sl_ocr_vocabulary`、`sl_focus_settings`、`sl_quick_record_settings`、`sl_festive_config`、`sl_ledger_freq`、`sl_wallpaper_config`、`sl_mood_log`、`sl_semester`） |

**守卫本身补的一条判据**：模块求值期的抛出被接住后**当成失败上报**（`bootThrow`），因为启动崩比任何 DOM 判据都严重。实测 `await import('./helpers/mountApp.js')` 会 reject 出 `cfg.periods.map is not a function`，所以这条判据是有效的、不是摆设。

**一个我自己的假红（诚实记录）**：第一次跑扩好的矩阵是 **70 条里红 69 条**，连"基线"都红。原因是判据写成了 `expect(result.errors).toEqual({})`，而 `errors` 永远是"四个布尔字段齐全"的对象——`toEqual({})` 永不可能成立。**是基线用例红了才发现它**；如果只跑损坏用例，我会得出"到处都崩"的错误结论。这正是**对照组必须留着**的理由。

### 1.68 设计令牌导出：一份"已经做完"的交付物，实测是错的（第五十四轮）

**§3.2 把"设计令牌同步 Figma"记成"改为本地导出，`node scripts/audit-contrast.mjs --tokens` 输出设计侧所需色值清单"，读起来像一件待做的事。实际不是：`--tokens` 早就实现了**（`scripts/audit-contrast.mjs` 的 `main()` 里 `if (arguments_.includes('--tokens')) { console.log(JSON.stringify(themePalettes(), null, 2)); process.exit(0) }`）。但**把它跑出来看，输出是坏的**。

实测（默认主题）：

| | `--focus-ring` | `--radius-m` | 值里混进注释正文的令牌 |
| --- | --- | --- | --- |
| 修之前 | **键不存在** | **键存在**，值是一整段中文注释（含换行） | `--radius-m` |
| 修之后 | `rgba(61, 99, 216, 0.28)` | 不存在 | 无 |

**根因是本仓记录过 7 次的那一类，第 8 次：凡是要 parse 的文本，先剥注释。** `src/style.css` 顶上有一段注释，专门记录 `--radius-m: 12px` 为什么被删掉（"全仓 22 处 `border-radius: 12px` 全是硬编码，没有一处引用过它，属于定义了却没人消费，已删除"）。而 `tokensIn()` 的正则 `(--[a-z0-9-]+)\s*:\s*([^;]+);` **不认注释**，于是：

1. `--radius-m` 这个**已删除的令牌被复活**，值是注释正文；
2. 那个"值"一路吞到下一个 `;`，把紧随其后的**真声明 `--focus-ring` 吸收掉**——导出里根本没有它。

**为什么这个缺陷特别难被发现**：修前修后默认主题都是 **40 个令牌**。一个"死令牌被复活"换掉了一个"活令牌被吞掉"，**数量一模一样**。任何按数量、按"有没有解析失败"写的检查都会放它过去；而它污染的恰好是交付给设计侧、会被抄进设计文件的产物——键是被删掉的令牌，值是一段中文说明。这也解释了为什么交接文档会把它记成"已改为本地导出"：**代码在，跑得通，退出码 0，只是内容是错的。**

**修法**：`scripts/css-rules.mjs` 里早就有等长替换（保留偏移与行号）的 `stripCssComments`，但 `audit-contrast.mjs` **一次都没用过它**——该文件 4 处 CSS 装载点全是"注释盲"的。现在 4 处都先剥注释再解析，并把 `tokensIn` 导出以便直接单测。修完 `npm run audit:contrast` 仍 **exit 0**（144 组配色、600 个族、6 组配对、13 条渐变规则、42 组聚焦指示器都不变）——**这次修的是交付物，不是审计结论**。

**顺带量掉的一个"同类嫌疑"**：`.vue` 里 HTML 注释中的字面量 `<style>` 会不会骗到跨规则扫描器的正则？**实测不会**——全仓每个 `.vue` 的样式块数量在"原始正则 / 先剥 HTML 注释 / 仓库可信的 `styleBlocksOf`"三种取法下**完全一致**。这条是量出来的，不是猜的，并且已经进守卫：将来哪个模板注释里写了 `<style>`，它立刻红。

**新守卫** `tests/designTokenExport.test.js`（13 条）守三条不变量，而不是硬编码"应该有 40 个令牌"：

- 注释正文绝不参与令牌身份（夹具 + 两条对照：带分号的注释会复活一个**看起来完全合法**的色值；不带分号的会把真声明吞掉——两种真实错误形态都钉住了）；
- 每个令牌的值必须能在 `src/style.css` 里**逐字找到**（复活/吞并/拼接都会违反它）；
- 规模自证（6 套主题、必备底色/卡片/正文），防止解析器打偏后"零令牌也算通过"。

**一条我自己的假红（诚实记录）**：对照用例最初写成 `expect(tokens['--ghost']).not.toBe('#ffffff')`，我以为注释里的值会被"污染"；实测它恰好就是 `#ffffff`——**带分号的注释会复活出一个值完全合法的幽灵令牌**，比我想的那种更难发现。是跑出来才纠正的，不是我推出来的。

### 1.69 浮层分区记忆：先定语义，再让"关闭再打开"真的记住（第五十四轮）

**§3.2 把这条的门槛写成"要先定'每次打开是否回到第一个分区'这一产品语义"——这个判断是对的，因为源码里同一个需求有三种行为**：外观设置与本地迁移的父级用 `v-if` 销毁实例，组件内的 `ref` 连同 `@open` watcher 里那行"重置回第一个分区"一起把状态清掉；作息设置的父级没有 `v-if`，反而一直是保留的。也就是说用户面对的是"有的记得住、有的记不住"，而不是"都没做"。

**定的语义**：关闭再打开 → 回到上次所在的分区；**刷新页面 → 回到默认分区**（默认就是第一个分区，即改造前从未使用过的用户看到的观感，不变）。

**为什么不写进 `route.query`**（账本那套"组件 ref + query 镜像"的先例很诱人）：

1. 这些是**全局浮层、没有自己的路由**（外观可以从任意页面的侧边栏打开）。把浮层内部分区写进 URL，会把状态糊到每一个页面的地址栏上；而 `tab` 这个键**已经被账本的三个分区占用**，必然语义冲突。
2. 会牵连既有耦合：`viewScrollMemory` 用 `route.fullPath` 做滚动记忆键，切分区会改 `fullPath` → 记忆键漂移；`routeAnnouncement` 刚为"query 变化不播报"打过补丁。
3. 浮层没开时，URL 里那个分区参数无人还原，深链价值≈0，却要额外写 eject 清理——而账本那套**恰恰没有 eject**，抄过来是个半成品。

**也没占存储键**：仓库对"记住 UI 位置"已有先例与明确取向——`viewScrollMemory.js` 是模块级 Map，注释写明它刻意不占 `sl_*` 键。新增一个纯 UI 键要付同步模块、备份映射、迁移、应急导出、本地迁移清单这一整套登记成本，还要多一次镜像写。所以新增 `src/composables/modalSections.js`（4 个模块级 ref），并删掉那 3 行重置。

**顺带抓到一个真缺陷（暂时性死区崩溃）**：`TimeSettingsModal` 的"打开时初始化" watcher 是 `immediate`，它在 setup 期间**同步**执行 `initPlanSelection()` → `loadPlanDraft()`，而后者要写 `batchOpen` / `copyOpen` / `genPreview` / `importOpen`——这几个 ref **声明在该 watcher 之后几百行**。于是：

```
ReferenceError: Cannot access 'batchOpen' before initialization
```

而组件自己的注释白纸黑字写着"组件以 `v-if` 方式首次挂载时 `props.show` 已经是 true"是必须支持的路径。**当前生产路径不可达**（`ScheduleView` 那个调用点没有 `v-if`，实例常驻、首次挂载时 `show` 是 false），所以它是**潜伏**缺陷——但任何人给那个调用点加上 `v-if`、或从深链直接以 `show=true` 挂载，浮层就连挂载都完不成。修法是把 watcher 移到那些声明**之后**：首次渲染前初始化仍然成立，同时不踩暂时性死区。

**证据**：`tests/modalSections.test.js`（11 条）用"真实挂载 → 切分区 → 卸载 → 重新挂载"证明用户可见的那条路径（三个组件各一组），另有一条专门盯住上面那个 TDZ 崩溃（修之前它是红的）。静态棘轮守"重置行不许回来"，并给了两条判别力对照：改造前的写法必须被同一套扫描报红；注释里的重置写法不算命中，而**同一份未剥注释的文本会命中**——证明是"剥注释"这一步在起作用，不是规则本身没牙齿。

**一条我自己的假红（诚实记录）**：行为测试第一次 6/10 全红，报"没找到分区列表"。原因是 `Modal.vue` 把内容 **Teleport 到 `document.body`**，而我在 `createApp` 的挂载容器里找节点。改成从 `document` 取、并取**最后一个**匹配节点（避免上一次挂载的残留被误认成新的）之后全绿。**"找不到节点"和"组件没渲染"是两回事**，这一条值得记住。

**另外两处死代码（本轮只记录，未删）**：`TimeSettingsModal.openTimeSettings()`（它含 `settingsTab.value = 'plans'`，是分区记忆的暗雷）与 `AppearanceSettings.resetCurrentWallpaper()`（含一处原生 `confirm`），全仓（含模板）grep 都只命中定义行本身。前者与后者的删除归入相应改造批次，避免与并行改造互相踩。

### 1.70 §3.2 的产品语义决策记录：这些"待决策"到底定了什么（第五十四轮）

**§3.2 里那 8 条被卡住的原因不是技术不可行，而是缺一个语义决定。** 这一节把每个决定、被否掉的替代方案、以及**必须接受的边界**逐条记下来——因为"实现"可以回退，"决定"回退不了：后面所有代码和守卫都建立在它们之上。

| 事项 | 定的语义 | 被否的替代方案（及为什么） | 必须接受的边界 |
| --- | --- | --- | --- |
| `window.confirm` → 应用内确认 | **接受异步确认**，沿用仓库既有的"state + 回调"惯例（`请求 → 置 target ref → <ConfirmDialog @confirm> 干活并清 ref`）。**逐处改造，不一把梭** | 新增一个 `await askConfirm()` 单例（state + resolve 回调或应用级挂载点）。不采纳：仓库已有 5 处统一写法，再造一套等于同一个需求两种 API；且时序陷阱（见下）不会因为换成 Promise 就消失 | 有几处处在**状态机中段**，必须显式处理 await 期间的状态漂移（快照 / 重算守卫），这是真实的复杂度，不是换个 API 能消掉的 |
| 浮层内部分区 | **关闭再打开回到上次所在分区；刷新页面回到默认分区**。模块级 ref，不写 URL、不占存储键 | ① 抄账本写 `route.query`——这些浮层没有自己的路由，会把状态糊到每个页面地址栏，且 `tab` 键已被账本占用；② 新增 `sl_*` 键——纯 UI 位置跨刷新记下来的深链价值≈0，却要付同步/备份/迁移/应急导出的全套登记成本。仓库对这类需求已有先例与取向（`viewScrollMemory.js` 刻意不占键） | 刷新后不记得。想要跨刷新就得回来加键（那时登记成本是绕不过的） |
| 设计令牌（Figma 侧） | **本地导出**：`node scripts/audit-contrast.mjs --tokens` 输出调色板 JSON，**不引外部服务、不联网** | 直连 Figma API / 设计侧插件。不采纳：违反"不接外部网络服务"，且要把令牌同步做成一条需要凭证的流水线 | 导出的是**色值清单**，不是 Figma 变量文件；设计侧要手工建变量（这是"本地导出"的固有边界，不是没做完） |
| ≤900px 侧边栏 | **保留固定底栏**（它是移动端唯一的导航入口），把底栏「更多」那块浮层升级为**真正的左侧抽屉**：遮罩 + 右划关闭 + 焦点陷阱 + 滚动锁 + Escape，并保持 `.sheet` 类名与"不 Teleport"以不破坏既有守卫 | 把整条 `.sidebar` 改成 off-canvas 抽屉（字面更贴"侧边栏变抽屉"）。不采纳：底栏一旦被抽屉取代，移动端就**没有常驻导航入口**了，得在 App 外壳另开一个，改动面翻倍且更容易做错 | 抽屉承载的是"更多"那一层导航；底栏仍在。（如果目标是"底栏也去掉"，那是另一个决定，需要先设计新的常驻入口） |
| 面包屑 / 返回上一级 | **不做假层级**。路由全是一级平级，唯一真实存在的关系是**聚焦态 → 全部**：URL 带 `?focus=` / `?section=` 时给一条「← 返回列表」，点击只删聚焦键 | 造 `首页 / 账本 / 某笔账单` 这种面包屑。不采纳：层级是编的，点上去只会更困惑；而"深层态"本来就是查询参数，不是路由层级 | 没有可点的多级路径。要真层级就得改路由结构，而"不改 hash 方案"是硬约束 |
| 多币种 | 新键 `sl_ledger_fx`（`{base, rates, updatedAt}`，**手工输入**）；每笔可选 `currency`，**旧记录缺字段 = 基准币种**；`amount` 语义不变；**既有汇总函数一行不改**，跨币种换算只在新选择器里做 | 让既有 `buildLedgerIndex` 直接按汇率求和。不采纳：那是把"跨币种相加"的语义污染灌进所有既有消费者与它们的测试 | **没有历史汇率**（改一次汇率会改变所有历史折算）、**没有三角换算**（只做 币种→基准 单跳）、汇率要人工维护 |
| 预算超支 | 新键 `sl_ledger_budget`；预警放在账本首页 `hero-stat` 内；计算在**视图侧新 computed**，不动 `buildLedgerIndex`；**不加第 4 个分区 tab** | 新增一个"预算"分区页。不采纳：账本的 3 个分区与 URL 契约（含默认不写参数）都有硬断言，加第 4 个会同时打破分区键盘模型与 URL 契约，收益却只是一个预警条 | 预算只有月度总额（或分分类），不做按账户/按周期的多维预算 |
| 报销分摊 | 在支出记录上加**可选** `split: { total, mine, participants }`；纯函数算份额（以"分"为单位，余数精确分配）；新选择器给"我的实际支出"；**不新增键** | 生成一批"派生记录 + `relationId='split:<id>'`"（照退款那套）。不采纳：退款是"退回一笔钱"，会产生真实的账目变动；分摊只是"这笔里我承担多少"的**记账口径**，造派生记录会让汇总凭空多出条目 | **不做结算**（不记录"谁欠我多少"、不做多人账户），只记录我实际承担多少 |
| 账单预设模板 | 新键 `sl_ledger_templates`，**1:1 照 `courseTemplates.js` 的形状**（useStoredRef + save/delete + 深拷贝 + 中文错误）；用在账单表单的"从模板套用" | 复用 `sl_ledger_freq`（固定账单）当模板。不采纳：那是既有键，改它语义被硬约束禁止 | 模板是"填表加速器"，不是自动记账；不会自己生成账单 |
| 农历纪念日 | 新键 `sl_festive_lunar`；**真支持闰月**（模块确实能算），该年没有这个闰月时给明确文案而不是回退成平月；四种不可用状态都显式显示 | 只存"月-日"、遇到闰月就按平月算。不采纳：**静默算错比不支持更糟**——用户会看到一个错误日期并且不知道 | 支持区间 1900–2101（表内），区间外显示"超出农历支持范围"；小月没有三十（如 2025–2029 连续五年没有"大年三十"）也显式说明 |
| 周年庆动画 | 挂在既有氛围层上做**专属 decor**；所有时长/缓动**走既有动效令牌**（不新增令牌） | 新增一套动效令牌。不采纳：新增令牌要同时改 `style.css` + `motion.js` + `DESIGN_TOKENS.md` 三处（`motionTokens` 守卫就是为此），而这次的需求不需要新节奏 | 用的是既有节奏；"专属"体现在动画**形态**（专属粒子/文案），不是新时长曲线 |
| 叙事 i18n | **只做叙事文案**：节日祝福语、节日名、体验建议这类"叙事"字符串集中到一个字典模块 + 一个语言偏好键。**界面与表单不动** | 全量 i18n（把 4741 行硬编码中文与 151 个测试文件的中文断言全部外置）。**明确不做**，理由见下 | 切换语言只改变叙事类文案；界面仍是中文。这是**范围决定**，不是"只做了一半" |

**为什么"全量 i18n"被明确拒绝（这是本轮最重要的一个"不做"）**：仓库零 i18n 基建（无 `vue-i18n` 之类依赖、无词条表、无 `t()`），界面文案是 **148 个源文件里 4741 行**含中日韩字符的硬编码中文，而**测试侧更硬**：**151 个测试文件**含中文断言。全量 i18n 的绝大部分工作量不在产品代码，而在把 151 个文件的断言逐条改写——那等于把整个仓库重写一遍，且必然长期红绿反复。在"不新增 npm 依赖"的硬约束下，这条只能按**最小可信范围**落地。

**另两条被硬约束排除、只能降级的能力**（§3.2 自己也这么记的）：离线 ASR 与富文本笔记——模型体积与编辑器依赖都超出"不新增 npm 依赖"。本轮不改代码，只把结论留下。

**两条"跳过"是量出来的，不是偷懒**：

1. **课表网格虚拟滚动**：`VirtualList.vue` 是**窗口滚动式一维**虚拟器（只服务 5 个一维列表），而 `ScheduleGrid.vue` 是固定 7 列 × 节次数的静态 CSS Grid，格子数由 `timeConfig.periods` 决定，**没有第二个滚动容器**——虚拟化接不进去；而且总共约 91 格，收益为负。
2. **图片模糊占位 / "只加属性"**：全仓只有 **3 个 `<img>`**，且三者（本地迁移、同步配对、课表图片裁剪）**都是首屏主内容**。给首屏主内容加 `loading="lazy"` 是**主动增加延迟**，不是优化；模糊占位需要额外处理管线。所以交接文档里"只加属性"这个选项实际上是**空的**——不是我没做，是量完之后它没有可做的内容。

### 1.71 个人周年的专属动画：一次"看起来做了"的属性选择器（第五十四轮）

**需求**是"专属周年庆动画"。勘察先给出了一个反直觉的结论：**氛围引擎早就认识这些日子了**——`festiveFor()` 里纪念日与使用周年各自有一条分支（`pick('anniversary', …)`、`pick('anniversary-start', …)`），但它们回给外壳的装饰与**情人节、儿童节、国庆节完全一样**（都是彩带）。所以缺的不是"识别"，而是"识别之后长得不一样"。

**最直觉的做法是错的**：新增一个装饰值（比如 `'anniversary'`）。它会把情人节/儿童节一起改掉（它们共用彩带），而且装饰值住在氛围模块里、有自己的消费者与测试。所以这一轮**一行都没动氛围模块**，改成让外壳在氛围层上额外打一个 `data-festive`（放氛围的 **key**），CSS 按 key 分叉：金色星芒**向上**升起、边升边旋（方向与彩带下落相反，一眼能区分），外加一枚只播一次的庆典光环。

**撞到的真缺陷：属性选择器是精确匹配，"使用周年"根本没被覆盖。** 我写的是

```css
.atmo-layer[data-festive='anniversary'] i { animation-name: atmo-anniversary; }
```

而"使用周年"那天的 key 是 **`anniversary-start`**——`[data-festive='anniversary']` **匹配不到它**。后果是这个子功能**静默退回彩带**：页面不报错、控制台不报错、那条"纪念日当天渲染专属动画"的用例照样绿，只有真的去问"使用周年那天是什么样"才会发现它其实没生效。**这是最典型的"功能做了一半却看起来做完了"**。

发现它的方式值得记下来：我在行为测试里断言的是**真实 key 值**（`data-festive === 'anniversary-start'`），而不是我"以为"的字面量 `'anniversary'`。如果当时顺着自己的预期写成 `'anniversary'`，这条测试要么被我改断言迁就实现，要么就被当成"实现是对的、测试写错了"——**两种走法都会把缺陷留在代码里**。断言"我以为的样子"而不是"实际的样子"，是这类缺陷的温床。

**修法与守卫（跨文件契约）**：CSS 里把两个 key 都显式列出（注释写明为什么不能靠前缀匹配去省事）；测试侧加一条**跨文件对账**——从 `App.vue` 解析出 `ANNIVERSARY_KEYS`，逐个断言 `style.css` 里有 `[data-festive='<key>']`，两边清单一旦不一致就红。它自己带判别力自证：在一份"只给 `anniversary` 写了规则"的夹具上，同一个判据函数必须报出 `['anniversary-start']`。

| 阶段 | 结果 |
| --- | --- |
| 修之前 | 纪念日那天：金色星芒 + 光环 ✓；**使用周年那天：静默退回彩带**（断言真实 key 时才暴露） |
| 修之后 | `tests/anniversaryAnimation.test.js` **8 条全绿**；跨文件对账、光环单次播放、无新增动效令牌三类判据齐备 |
| 对照 | 纪念日不在今天时：无专属标记、无光环、无专属时长（三条都不出现，证明不是在页面上"永远为真"） |
| 顺带守住 | 情人节那类**共用彩带**的节日不受影响，且"纪念日优先于固定节日"这条既有语义没被改掉 |

**"专属"是否只是换了个颜色？** 判据上做了区分：动画名是**另一个**（`atmo-anniversary`，与彩带的 `atmo-confetti` 不同），运动方向相反（向上 vs 下落），粒子形状是四角星（`clip-path`），配色里刻意含有**彩带配色里没有的**金色——所以"专属配色"不可能靠巧合通过。

**动效令牌：一个都没有新增。** 粒子时长本来就是内联的（这里从 6–10s 收紧到 4.2s，庆典感更密），光环走既有的 `--dur-reveal` + `--ease-out`。这也是有意的：新增 `--dur-*` 要同时改 `style.css`、`motion.js`、`DESIGN_TOKENS.md` 三处（`motionTokens` 守卫就是为此设的），而这次需求并不需要新节奏。另外**降级路径是免费拿到的**：`prefers-reduced-motion` 与 `data-performance='reduced'` 两条全局规则已经把 `animation-duration` 压到 `0.01ms`、迭代压到 1，渲染本身还被 `reducedEffects` 门控。

**一条测试环境细节（诚实记录）**：happy-dom 的 `hardwareConcurrency` 可能 ≤4，会让性能模块的"自动"模式判定成需要降级，于是氛围层**根本不渲染**——那是正确行为，却会让这条测试变成假红。所以夹具里显式把 `sl_performance_mode` 选成"完整效果"。**第一次我把它写成裸字符串 `'off'`**，而 store 的值是 **JSON 编码**的，于是读回时解析失败、静默回落到 `'auto'`；是控制台那条 `[SilentError:storage-read] SyntaxError: … "off" is not valid JSON` 提醒了我。**给 store 播种必须 `JSON.stringify`**，否则不会报错，只会悄悄退回默认值——和本报告里反复出现的那一类"静默降级"是同一个形状。

**边界（明确留下）**：① 生日（`birthday`）也共用彩带，但**没有**并进这条动画——它是"生日"不是"周年"，`ANNIVERSARY_KEYS` 是一个列表，要并进来是一行改动；② 光环是**装饰**，每天刷新都会重播（"当天只播一次"需要新存储键，本轮不做）；③ 整个氛围层是 `aria-hidden` 的纯装饰，且在打印样式里被隐藏。

### 1.72 叙事 i18n：真正的问题不是翻译，而是那些文案从来没上屏（第五十四轮）

**勘察先推翻了这条需求的前提。** "把叙事文案做成多语言"听起来是一件翻译工作，于是先去数了一遍要被翻译的字符串——结果是：**它们一个都没有显示在界面上**。氛围引擎 `festive.js` 为 16 种情况各自产出 `name`（节日名）与 `message`（祝福语），而全仓**没有任何一处消费它们**：

- 首页的问候语是**纯时间问候**（`greeting()` 里只有"夜深了 / 早上好 / 中午好 / 下午好 / 晚上好"），另一行是用户自定义的**语录**；
- 氛围对象在界面上只被用于**装饰**（`decor`）、主题色（`accentColor`）、以及给外壳打一个 `data-atmosphere` 属性；
- 更直接的证据：`TodayView.vue` **import 了 `festiveConfig` 却一次都没用过**（全文件只有 import 那一行命中）——一个死导入，恰好说明这条链子当年接到一半就停了。

**而设置页早就把这件事写成承诺了**：`FestiveSettings.vue` 里"启用节日氛围"的说明是「**首页的祝福语**与彩带 / 雪花 / 灯笼装饰」。也就是说：**用户看到的开关文案在描述一个不存在的效果**。所以"给叙事做 i18n"如果只做字典，就是**给看不见的字符串做翻译**——一份无法验证、也无法被用户感知的工作。

**于是这一轮做了三件事**（而不是只翻译）：

1. **新增叙事字典** `src/composables/narrative.js`：只放**译文**。中文原文的唯一真源仍然是 `festive.js`（它自己产出 `name` / `message`），字典里**不抄第二份中文**——少一份必然会漂移的副本。缺条目时逐条**回落原文**，并用一个 `translated` 标志把"命中了译文"与"回落了原文"分开，而不是让回落悄悄发生。
2. **把叙事接进首页页头**（`TodayView.vue`）：当天真有节日/纪念日时显示「节日名 · 祝福语」，平时整行不渲染。这同时把上面那个**死导入**变成了真用途，也让设置页那句承诺第一次成真。
3. **语言偏好**：新键 `sl_ui_language`（**不改任何既有 `sl_*` 的语义**），带坏值修复（存了不认识的语言就退回默认，不让界面拿到 `undefined`）；切换入口放在氛围设置面板。

**范围是明确划出来的，不是"做了一半"**：全量 i18n **不做**——零 i18n 基建、**4741 行**含中日韩字符的硬编码中文分布在 **148 个源文件**，而**测试侧更硬**：**151 个测试文件**含中文断言。全量 i18n 的工作量主要不在产品代码，而在逐条改写那 151 个文件的断言；在"不新增任何 npm 依赖"的硬约束下，那等于把仓库重写一遍。所以本轮的界面、表单、按钮**一律仍是中文**，只有叙事类文案可切换。

**判据（三层，都在 `tests/narrativeI18n.test.js`，15 条）**：

| 层 | 判据 | 为什么这样写 |
| --- | --- | --- |
| 契约 | `festive.js` 能产出的每个**静态节日** key（公历 6 + 农历 7 + 生日），英文表里都必须有条目；且**英文表里不许含中日韩字符** | 后半条是关键：否则"翻译"可能只是把原文抄了一遍，条目齐全却毫无意义 |
| 纯函数 | 命中译文 / 中文回原文 / 未知 key 回落 / 空输入返回 `null` / 未知语言不抛错；外加一条"换个语言输出必须真的不同"的判别力对照 | 确保回落是**逐条**发生的，而不是整行消失或显示 key |
| 行为 | 真挂载首页，**同一份夹具只改语言偏好这一个变量**：英文偏好下页头是英文祝福语（并断言那段文本里没有中日韩字符），中文偏好下是中文原文；另有"氛围关掉时整行不出现""生日不在今天时绝不显示生日祝福"两条对照 | 只改一个变量的前后对照，比"渲染出来了"强得多；两条对照防的是"这一行永远为真" |

**一条我自己的事故（诚实记录，因为它正是仓库反复警告的那种）**：我本想在 `currentQuote` 之前**插入**两行 computed，结果 `edit` 的原文/替换写反了，**删掉了 `if (!appearance.value.showQuote) return ''`**——语录开关会因此失效。发现方式是**改完立刻回读那一段**（而不是等到最后跑测试），当场补回并确认了缩进与上下文。之所以单独记一笔：第五十二轮出现过"把变异留在代码里"的事故，而这类错误**不会报错、只会静默改变行为**。回读那 20 行是廉价的，漏掉它则要靠后面的用例偶然撞上。修复后 `todayNext` / `phase1Regression` / `renderedHeadingOrder` / `loadingAffordance` / `componentDeadCss` / `styleComments` / `referenceIntegrity` **7 个文件 34 条全绿**，`eslint` 干净。

**明确留下的边界**：个人节点（纪念日 / 使用周年）的文案**不译**，因为它把用户自己填的标签、以及"一起走过几年"**拼进了一个现成的句子**（`${label}快乐…`、`已经一起走过 ${elapsed} 年…`）。整句翻译会丢掉这两样信息，所以本轮让它回落中文——**这是有意的范围，不是漏掉的条目**，测试里专门有一条断言它是"显式排除"而不是缺失。要让它们也能翻译，`festive.js` 需要改成暴露**结构化数据**（标签、年数）而不是格式化好的句子；那是一次接口改动，已记在这里备查。

### 1.73 组件死 CSS 守卫的盲区：父组件的 scoped 样式只到子组件根节点（第五十四轮）

**这条不是计划里的工作，是把既有守卫往抽屉改造上套时撞出来的。** 抽屉代理报告里有一句轻描淡写的话——"App.vue 里那份 scoped `.mobile-more-sheet` 副本已过时"。我本来只当是重复样式，结果把 SFC 真编一遍才发现它是一整类问题（19 条，不是 1 条）。

**先把机制量出来，别凭记忆断案。** 用仓内已有的 `@vue/compiler-sfc` 编译 `App.vue` 的 scoped 样式，直接看 scope 属性落在哪个复合选择器上：

```
.sidebar[data-v-test]                                 ← 落点正是子组件的**根**节点
.sidebar.collapsed .nav-item[data-v-test]             ← 落点在 .nav-item（子组件内部）
.sidebar[data-v-test],.sidebar.collapsed[data-v-test] ← ≤900px 那条"变底栏"的规则
.mobile-more-sheet[data-v-test]                       ← 子组件内部
```

机制是：**Vue 把 scope 属性加在每个复杂选择器的最后一个复合选择器上**，而**子组件的根节点会同时带上父组件的 scope 属性**（Vue 3 的既定行为），子组件**内部**的节点不会。于是父组件里写的 `.sidebar { … }` 生效，而 `.sidebar.collapsed .nav-item { … }`——同一个文件、同一个区块、看起来完全对称——**永远不生效**。

把 App.vue 里与侧边栏相关的规则行全量过一遍（脚本枚举，不是抽样）：

| | 数量 |
| --- | --- |
| 与侧边栏相关的选择器行 | **22** |
| 真正生效（落点是根节点） | **3** |
| **死规则**（落点在子组件内部） | **19**（约 86%） |

死掉的 19 条：`.nav-item`、`.sidebar.collapsed .nav-item`、`.sidebar-foot`、`.sidebar-action-row`、`.theme-dots`、`.sidebar.collapsed .theme-dots`、`.mobile-nav`、`.mobile-nav-item`（含 4 条后代/状态/尺寸变体）、`.more-trigger>span`、`.mobile-more-sheet`、`.mobile-more-head`、`.mobile-more-head button`、`.mobile-more-group+.mobile-more-group`、`.mobile-more-group h3`、`.mobile-more-grid`、`.mobile-more-item>span`。

**为什么 `componentDeadCss` 一直没报？** 因为它的判据是"这个类名在本文件模板/脚本或**全仓其它文件**里找得到吗"——**按名字在全仓匹配**。而 `Sidebar.vue` 的模板正在用这些类名，于是 App.vue 里那 19 条死规则**全部**被"别处有人在用"赦免了。**守卫问的是"这个名字有没有被用到"，真正该问的是"这条选择器能不能到达某个节点"**；这两件事在"同名类被两个组件各自使用"时就分叉，而这份代码库恰好到处是通用名（`.nav-item`、`.theme-dots`、`.mobile-nav-item`、`.mobile-more-item`）。

**这 19 条不是"从来如此"，而是第三十七轮那次事故的残留——而第三十八轮的清理是刻意保守的，所以它们合法地留了下来。** §4 第 22 条记着那次事故：删除器的规则区间偏移有 bug，把 6 个文件约 259 条规则切碎，恢复只能靠"删除前的构建产物"。而**入口分片里合并了小组件的 CSS**（Sidebar / ScheduleGrid 等被静态引入的组件），搬回来时一并带着**宿主组件的 scope 属性**——于是对子组件元素**永远不生效**。第三十八轮清掉了 85 条这类副本，判据是三个条件的**合取**：(1) 别处存在**完全同值**的规则；(2) 宿主自己的模板/脚本里没用到选择器中的任何类；(3) 真属主确实在用这些类。**保守是刻意的**（刚在不可信的解析器上做过一次破坏性扫除），代价是"惰性、但与真属主**不同值**"的规则不在清理范围内。

App.vue 里这 19 条恰好落在这一格：以 `.mobile-more-sheet` 为例，App.vue 那份写的是 `position:absolute; right:10px; left:10px; bottom:calc(70px + safe-area)`（右下角小浮层），而真属主那份在抽屉改造后是 `position:fixed; left:0; width:min(86vw,320px)`——**取值完全不同**，于是条件 (1) 不成立、规则被保留，尽管它一个节点都到不了。**结论：将来清理这类残留，判据应该是"可达性"（这条选择器能不能到达某个节点），而不是"是否与真属主同值"**——后者只会清掉证明得了冗余的那部分，留下更隐蔽的一半。

**它为什么不只是"整洁问题"——两条具体后果**：

1. **同值重复意味着"谁生效"由源码顺序决定。** `cssOrderSensitivity` 那份报告式体检已经在 54 个文件里数出 295 对（同上下文、同特异性、声明冲突），App.vue 与 Sidebar.vue 这几对就在其中。改一处值不会报错，只会让"哪个赢"变成构建顺序的偶然；而**这种靠顺序赢的规则，正是最难查的一类样式缺陷**。
2. **它会在别处变成特异性地雷。** 抽屉改造要把根节点在打开态抬到 `.task-pill` 之上，而最自然的写法 `.sidebar { z-index: 95 }` 与 App.vue 的 `.sidebar[data-v-app] { z-index: 20 }` **特异性完全相同**（都是"类 + 属性"）。相同特异性下胜负**由源码顺序决定**，而 SFC 样式的注入顺序取决于模块求值顺序（App.vue 引入 Sidebar.vue）——这一条很可能被 App.vue 压掉。**最麻烦的是：vitest 不处理 CSS，所以本仓库没有任何一条测试看得见它**：改完测试全绿、真机上不生效。处置只能是**用复合选择器把特异性抬到 0,3,0**（如 `.sidebar.drawer-open`）让胜负不再依赖顺序，并把"特异性严格更大"本身写成源码层判据——这条已经作为硬要求下达给抽屉改造。

**本轮有意不清理。** 这 19 条不能一刀切删：同一个区块里混着 3 条真生效的根规则（包括那条把侧边栏在 ≤900px 变成底栏的 `@media`），必须逐选择器判。把它混进抽屉那一轮会让两件事都更难复核，所以这里只把**清单与机制**固定下来，留作单独一次外科式清理，并顺带补一条能关掉这个盲区的守卫（"父组件里以内层类名结尾的选择器"）。

### 1.74 24 处原生 confirm 退场：一处真缺口，和一半的覆盖率（第五十四轮）

**这一条的难点不在"换成组件"，而在时序。** 用户已明确接受"确认改为异步"，但**同步阻塞返回 boolean** 与 **state 流**不是同一个东西，会把三类地方顶出来：

- **返回值被立刻消费的地方最硬**：`TimeSettingsModal.guardDraft(action)` 的布尔返回值被 `useTabKeys` 的 `select` 回调**同步**消费（返回 `false` 时键盘焦点不动）。把它改成 async 就等于破坏"焦点不移动"。做法：不脏照旧 `return true` 立即继续；脏则把动作挂进 `pendingDraftAction` 并**同步**返回 `false`，确认后再执行切换并手动 `focus()` 那个 tab 按钮。**`tabKeys.js` 一行没改**——守卫的契约是同步的，就该继续同步。
- **确认前必须快照**：课表移除的 id 列表、导入文案依赖的课程数、备份对象、冲突保存的 `payload`/`data`/`editId`、整表替换的 draft——都在开框那一刻定稿，确认后按**快照**执行，而不是回读一个可能已被别的分支置空的状态。
- **一处反直觉的禁区**：`DataManager` 里 `void createSpaceFlow()` **不能**顺手改成 `await`——那会把未捕获拒绝改道到 Vue 的全局错误通道（本该走自家提示的失败会突然变成全局错误告警）。

**真缺口：body 里所有 `.overlay` 的 `z-index` 都是 100，叠放顺序完全由 DOM 顺序决定。** Teleport 的锚点在组件**挂载时**创建，于是"随页面常驻"的确认框（`:open="Boolean(target)"`）会排在"打开时才建锚点"的 `v-if` 表单 / 课程管理器 / 作息设置**之前**：读屏与 Escape 都认为确认框在最上层，眼睛看到的却是另一个窗体压着它，**用户点不到确认键**。这类缺陷的形态特别坏——不报错、不进控制台、DOM 里两个窗体都在，只有真去看 DOM 顺序才发现（本轮就是靠 dump DOM 顺序抓到的：`[确认框, 表单]`）。

处置：所有新增确认框写成 `v-if="target" :open="Boolean(target)"`，锚点在打开那一刻才创建，必然排在已开浮层之后。**这条规避手法不是我们发明的**：`DataManager` 里既有的嵌套确认框本来就是这么写的——原作者早就踩过，只是没人把这个坑写下来。判据是 DOM 顺序断言 + 变异实验（去掉 `v-if` 立刻红）。

**系统性修法本轮不做，已记入 §4**：给 `Modal` 按浮层栈深度写递增的内联 `z-index`（`overlayStack.js` 已经维护着栈），从根上消除对 DOM 顺序的依赖。它是共享组件，且会牵动 `.sheet-overlay`(110) / `.context-menu`(130) 那套固定层级，值得单独一轮带着 `modal.test.js` 一起改。

**独立复核（不接受"子代理说绿了"）**：

| 复核项 | 结果 |
| --- | --- |
| 全仓 `confirm(` 计数 | **只剩 2 处**，且都是勘察明确要求**不许碰**的同名局部函数定义（`TimeWheelSheet.vue:50`、`schedule/ImageCropModal.vue:110`）；`window.confirm` **0 处** |
| 迁移相关 + 全仓静态守卫 | **21 个文件、164 条全绿**：`confirmDialogMigration`(14)、`modal`、`overlayEscape`、`modalSections`、`hiddenLiveRegion`、`tabKeys`、`tabPanelSemantics`、`phase1Regression`、`notes`、`dataManagerSync`、`dataManagerRestoreNav`、`courseTemplateDate`、`scheduleNoteProtection`，以及 `componentDeadCss`、`styleComments`、`accessibleNames`、`formControlNames`、`keyboardReachability`、`referenceIntegrity`、`auditFixes`、`disclosureExpanded` |
| 交付物噪音 | `ConfirmDialog.vue` 结尾少一个换行，已补（否则每个 diff 都多一行噪音） |

**还有一条环境事实值得留在报告里（我独立验过，不是转述子代理）**：happy-dom **20.11.6** 里 `window.confirm` / `window.alert` / `window.prompt` **三个都是 `undefined`**，调用直接抛 `TypeError`（实测脚本：`typeof` 全为 `undefined`，三个调用全部抛错）。也就是说残留的原生 confirm 会让用例**直接抛错**，不可能被"空实现"蒙过去——这类判据天生有牙齿。顺带一个副作用：`LedgerView` 里那处 `window.prompt`（本轮范围外、未改）在这些用例里**同样无法被"点出来"**，谁将来给它补行为测试，第一件事是得先给它一个可注入的替身。

**覆盖率是诚实的：一半。** 有**行为**覆盖（真挂载 + 真 store，**没有** stub 原生 `confirm`）的是 5 条路径：笔记删除、日程删除、待办删除（**既有用法**当回归对照）、日程冲突继续保存、待办冲突继续保存，外加"冲突框上按 Escape 只关最上层、页面锁保留"，并且**取消→数据不变 / 确认→数据真变两侧都断言**（DOM + flush 后的 localStorage）。

**没有**行为覆盖、只有静态判据兜底的：

| 组件 | 为什么跑不到 |
| --- | --- |
| `DataManager` 全部 5 处 | 面板依赖 IndexedDB / 云同步 / 配对码，happy-dom 没有 IndexedDB |
| `AppearanceSettings` 3 处 | 壁纸写入依赖 canvas / Blob / IndexedDB；"恢复初始外观"会重置主题与皮肤 |
| `LocalTransfer` 2 处 | 需要真实二维码/图片解码与导入快照 |
| `TimeSettingsModal` 3 处 | 需要作息配置 + 三层浮层 + `useTabKeys` 键盘路径 |
| `ScheduleView` 4 个新对话框 | 课程管理器/导入审阅是 `defineAsyncComponent`，还依赖模板与导入计划 |

这些**不是"测过了但没写下来"，是真的没测**；兜底的是"能编译"（静态 import + 模板引用，少个引号或 `v-if` 写错会直接失败）加两条全仓对账（0 处原生 confirm；每处 `@confirm` / `@close` 都指向真实声明的函数或 ref——专门防"拆完函数、模板还留着旧名字：编译不报错、点了没反应"这种坑）。

**其中两处的行为等价性没人验证过**，必须点名：① `AppearanceSettings.confirmRemoveImage()` 改走 `wallpaperConfig.value.targets[...]` 直写（原来走 `isGlobal` / `targetConfig` 的计算路径）；② `EventsView.commitSave()` 成为唯一写入路径（于是**确认路径上的失败现在也会走 `setFormError`**，改造前只有非冲突路径有 try/catch）。两者都声称行为等价，但都恰好落在**没有行为覆盖**的那一半里。

### 1.75 「面包屑 / 返回上一级」：决策先行省掉了一整层假 UI（第五十四轮）

**需求原文是「面包屑 / 返回上一级」。** 勘察先回答了"这里到底有没有层级"：这个应用的路由**全是一级平级**（hash 路由，顶层页面之间没有任何父子关系）。**唯一真实存在的层级是"聚焦态 → 全部"**：账本会把 URL 变成 `?focus=<某笔交易>` 或 `?section=<某个分组>`，此时页面呈现的是一个"钻进去了"的状态。

于是只有两条路：

- **(a) 照字面做面包屑**——就得**编**一组层级（"首页 / 账本 / 某笔账单"）。但点中间那一级等于后退一步，而"深层"**本来就只是一个查询参数**。层级是假的，点上去只会更迷惑，而且一旦以后有人给它加上真实的子页面，这套编出来的层级会立刻变成错的。
- **(b) 把它建模成真实存在的那唯一一种关系**：聚焦态下给一条「← 返回列表」，点击**只删掉聚焦键**。

选了 (b)，并且**明确不做**路由层级改造（"不改 hash 方案"是硬约束）。这也是 §1.70 决策表里那一行的由来——**"看起来像 UI 需求"的条目，先问它描述的关系是否真的存在**，往往能省掉一整层假 UI。

**实现要点（真正容易错的地方有两处）**：

1. **只删 `focus` / `section`，其余查询参数必须原样保留**——例如账本的 `tab=review`、日期 `date=` 都是用户当前的上下文，清掉它们等于顺手把用户踢到别的地方去。
2. **用 `router.replace`，不能用 `router.push`**——用 `push` 会把"返回列表"变成历史里的一步，用户再按浏览器返回键就被弹回刚退出的聚焦页。这条写成了**静态棘轮**（`router.replace(` 必须在、`router.push(` 必须不在）。

**判据**（`tests/focusReturn.test.js`，10 条）：纯函数层（哪些键删、哪些留）、一条"整份 query 清空"的**错误实现对照**、行为层真挂载（入口随聚焦态出现/消失、点击后 URL 与按钮**同时**变化）、以及上面那条静态棘轮。

**夹具我自己踩过一次，值得记**：最初用 `?section=bill` 来证明"保留了 focus 以外的键"，结果红了——`expected 'bills' to be 'review'`。原因是账本自己的 `focusBill()` 会**合法地**改写 `tab`（它要切到账单页）。也就是说**那条夹具根本证明不了我要证明的事**：它看到的"变了"来自别人的正当副作用，不是我的实现出错。换成 `?tab=review&focus=tx1` 之后，它才真的在验证"未聚焦的键被保留"。教训一句话：**对照夹具必须挑一个不会被被测代码顺手改掉的键**，否则你测的是别人的副作用。

### 1.76 农历纪念日：真正的难点不是"算农历"，而是"算不出来时说什么"（第五十四轮）

**先把容易的部分做完，再把难点显形。** 农历↔公历转换本身（阶段一，`src/composables/lunar.js`，1900–2100 位压表）是可解的工程：它甚至当场抓到一个真错——**2050 年那张表里闰三月被写成了 29 天，实际是 30 天**（`0x04b63` → `0x14b63`），变异验证下 10 条测试里 4 条立刻红；并与香港天文台表在 2050/2051/2100 三点交叉核对、180/180 对比点一致。

**难点在"这个农历日子在该年不存在"的时候。** 决策记录里被否掉的方案是"只存月-日，遇到闰月就按平月算"，否掉的理由一句话：**静默算错比不支持更糟**——用户会看到一个错误日期，而且**没有任何线索知道它是错的**。所以这一轮的验收标准不是"能算出日期"，而是**每一种算不出来的情况都必须显式说出来**。最终 6 个状态，其中 4 个是产品要求、2 个是补充的防御分支：

| 状态 | 用户看到的话 | 有日期吗 |
| --- | --- | --- |
| `ok` | （行内直接给落点 + 「就是今天 / N 天后 / 已过 N 天」） | 有 |
| `no-such-leap-month` | 「该年没有这个闰月」 | **没有**（`dateKey === ''`，专门的对照断言钉死） |
| `no-such-day` | 「该农历年这个月是小月，没有三十」 | 没有 |
| `out-of-range` | 「超出农历支持范围（1900–2101）」 | 没有 |
| `not-in-year`（补充） | 「本公历年内没有这个农历日（冬月/腊月可能落在次年 1 月）」 | 没有 |
| `invalid`（补充） | 「农历月日不合法（月 1–12、日 1–30）」 | 没有 |

文案与状态机的判定**同源**：面板的说明文字、行内提示、测试断言读的是同一份常量，所以"文案漂移"和"状态漂移"会一起被发现。判定原因的归属也做了取舍：**按"归属农历年 G"给原因**（只有 2101 年 1 月归给 G-1），这样"为什么没有"才对得上用户看到的那个年份——否则 1902 年没有"二月三十"会被错报成"落在次年 1 月"，而真实原因是**那个月是小月**。

**证据（都是"量"出来的，不是"看着对"）**：

- **穷举一致性**：1900–2101 × 12 月 × {1,15,29,30} × {平,闰} = **19392** 个检查点，逐点校验 `ok ⟺ lunarMonthDayOccurrences 非空`、`ok` 的落点必在该公历年内、非 `ok` 必有文案——**0 处不一致**；并且有 `checks === 19392` 的计数断言，**防的是"零检查也算绿"**。
- **与阶段一交叉验证**：2015/2020/2026/2033/2050 × 5 个农历节日 = **25** 个点，全部与 `LUNAR_FESTIVAL_DATES` 一致（0 mismatch）。
- **端到端**（最强的一条）：播种 `sl_festive_lunar` + 固定时钟与时区（`timezone='UTC'`、`clock=2026-06-19T12:00Z`、`sl_performance_mode='off'`）→ `vi.resetModules()` 后挂**真实应用** → 断言装饰层出现 `[data-festive='anniversary']`、`.atmo-halo` 存在、首页正文出现纪念日名称；**对照组**（不播键）三者都不出现；闰月纪念日当天端到端**不点亮**。
- **变异自证**：把 `festive.js` 新增的那个分支临时改成 `if (false && …)` → 纯函数层/面板层/端到端层**共 5 条红**（例：`× 命中当天：装饰层打上纪念日标记`），还原后全绿。
- **我的独立复核**：13 个文件 **140/140 全绿**（3 个新文件 + 阶段一 `lunarCalendar` + `festive` + `dateAndAnniversary` + §1.71 的跨文件契约 + §1.72 的 i18n + 5 个仓库守卫），与子代理自报的数字一致。

**一个"契约守卫在事前就约束了设计"的例子（这条值得单独记）。** 氛围的 `key` 复用了既有的 `'anniversary'`，**没有**另起 `'lunar-anniversary'`。原因不是偷懒：金色粒子配色、`4.2s` 时长与 `.atmo-halo` 光环都由 `App.vue` 的 `ANNIVERSARY_KEYS` 决定，而 `style.css` 是用 `[data-festive='<key>']` **精确匹配**写规则的——新 key 会让农历纪念日**静默退回普通彩带（无金色、无光环）**，也就是 §1.71 里那条跨文件契约守卫专门防范的失败模式（当时 `anniversary-start` 就是这么漏的）。所以那条守卫的作用不止"事后抓回归"，它还**在事前把设计推到唯一正确的那条路上**：要么复用既有 key，要么同时改两处并让契约守卫通过。改动方选择了前者，我认可这个裁定。

**诚实的边界（四条，都不是理论问题）**：

1. **内存镜像的时效性（唯一需要我在集成处补东西的一条）**：`festive.js` **故意不 import 存储层**（否则 store 的事件循环会被带进它的依赖图，node 环境的测试会被拖住）。于是农历列表走 `lunarAnniversaries.js` 的**模块内存镜像**：首次读取从 `sl_festive_lunar` 补水，之后由设置面板每次提交重新发布。**后果：如果这个键是被"别人"改写的——云同步恢复、本地迁移导入、另一个标签页——首页仍会读旧镜像，直到用户打开一次设置面板或刷新页面。** 这不是可以写进"已知限制"就算完的事：它会让"恢复成功了但首页没变"看起来像恢复失败。处置见 §1.77（登记那一轮必须顺带在恢复边界上发布一次）。
2. **两个状态在真实 UI 里走不到**：`out-of-range`（应用时区下的"今天"必然在支持区间内）与 `invalid`（下拉只能选合法值）都是防御性分支，**只有纯函数测试能触达**；面板上改为写明「农历表覆盖 1900–2101」。
3. **"本公历年内最早一次"的取舍**：腊月纪念日在面板里显示的是**本公历年 1–2 月那一次**；若某个农历月日在同一公历年出现两次、而用户正处在**较晚**那一次当天，该行显示的是较早那次，氛围层因此**不会**在较晚那天点亮。已写进模块注释，且所有"下一次"提示走独立搜索（不复用那个落点）。
4. **2100–2101 的残余不确定**：`2101 年 1 月仍在支持范围内`（腊月十五 = 2101-01-14），但 `2101 正月初一`（2101-01-29）已超出表尾，给 `not-in-year` **而不是猜一个值**。这与阶段一"`2101-01-28` 有 ±1 天残余不确定、2052–2099 未逐日外部核对"同源，继承同一不确定性——**报告里不把它写成"已验证"**。

### 1.77 账本四个新功能：口径的边界画在哪里（第五十四轮）

**四个功能共享一条硬约束：既有聚合口径一行不改。** `buildLedgerIndex` / `summarizeLedgerTransactions` / `buildLedgerMonthReview` / `filterLedgerTransactions` 全部**未改**；新字段一律**可选**，旧记录缺字段 = 基准币种 / 无分摊。这不是洁癖：那四个函数是账本所有界面和一批既有测试的共同底座，改它们等于把"跨币种相加"的新语义灌进每一个消费者。

1. **多币种（新键 `sl_ledger_fx`）**：手工汇率表 `{base, rates, updatedAt}`，每笔可选 `currency`，换算只在**新选择器** `summarizeLedgerInBase` 里做。边界写得很死：**没有历史汇率**（改一次汇率，历史月份的折算行会跟着变——UI 与 `fxRateNote` 都照实写明「按 <updatedAt> 汇率」）、**只做单跳**（币种→基准，无三角换算）、**缺汇率的记录不进折算行**且明说「另有 N 笔未计入」。而 hero 里那张「本月花费」卡片**仍是原值直接相加**——刻意的：改它就是在改既有口径。判据里有一条反向证据：缺汇率的记录不进新折算行，但既有花费卡片仍按原值显示。
   展示层新增 `moneyWithCurrency(v, code)`，实现就是 `moneyRow(v)` 再替换 `¥` 前缀，所以 CNY / 空币种的输出与 `moneyRow` **逐字相同**。
2. **预算超支（新键 `sl_ledger_budget`）**：`{monthly, updatedAt}`，三档 `none / ok / near(≥80%) / over`；预警放在 hero 内部（`p.hero-sub` 与 `p.pending-block`），**没有加第 4 个分区 tab**——`ledgerTabUrl` 的 URL 契约与分区键盘模型都有硬断言，加第 4 个会同时打破两样。预算比较的是**折算后**的当月支出；**无外币时与既有 `monthStats.total` 逐分相等**（有回归断言）。只做月度总额，不做分类预算。
3. **报销分摊（不新增键）**：用支出上的**可选** `split: {total, mine, participants[]}`，**不做结算**（没有"谁欠我多少 / 已还"）。只记"我承担多少"，UI 上是回顾页一行说明加每条记录下的「已分摊 · 我承担 ¥xx」，**没有把 hero 总额换成我的份额**（那同样会改既有口径）。
4. **账单预设模板（新键 `sl_ledger_templates`）**：1:1 照 `courseTemplates.js` 的形状；`normalizeBillTemplate` 用**白名单**并**丢弃 `nextDate` 与 `id`**——把上次算出来的"下一次日期"存进模板，会让同一个模板在不同月份套出被污染的日期，这条是有意剔的。

**"既有行为未变"的证据（本节最重要的一张表）**：同一批记录跑两遍，一遍只有旧字段、一遍在**完全相同**的记录上多加 `currency` / `split`，逐项比较——`buildLedgerIndex` 的 `sortedExpenses` / `monthStats` / `dayTotals` / `monthCategories` / `frequentEntries` **逐字相等**，汇总 / 回顾 / 筛选的每个字段同样相等；并且带一条**自证**：两批记录的 JSON 确实不同（否则"相等"这个词毫无意义）。记录**形状**也锁死：不带新字段时 `createTransaction` 的键集合就是改造前那 **18** 个键，且 `'currency' in tx === false && 'split' in tx === false`；旧账单 `payBill` 生成的交易不带币种。

**我的独立复核**：13 个文件 **152 条全绿**（它 6 个新文件 + 既有 `ledger` / `ledgerFinalOptimization` / `ledgerTabUrl` / `formatters` + 3 个全仓守卫），另有 `eslint` 0 与全项目 `vue-tsc --noEmit` 0。

**一处超出四功能范围的自白**：导出 CSV/Excel **多了一列「币种」**（表头 8→9 列，后面的列整体后移）。理由是"否则一笔 100 USD 会导出成孤零零的 `100`，被读成 100 元"。我核过：仓库里没有任何测试或导入逻辑依赖这份导出的列——但它确实是我没要求的改动，记在这里而不是悄悄留在 diff 里。

**两个诚实的缺口**：① happy-dom 下 `<select>` 的复位**不回显**（做过最小实验确认是环境限制），所以"套用模板后下拉自动复位"只有真浏览器能验证，改为断言"换一个模板能再套一次"；② `payBill` 现在会把账单币种透传给生成的交易（对没有币种的旧账单行为不变，已断言）——这是**新**语义，验收时值得确认是不是想要的。

### 1.78 一条"偶发守卫"比缺陷本身更值得记（第五十四轮）

账本改造的复核报告里带回来一条**不属于它自己范围**的观察：`tests/focusReturn.test.js`（我写的）那条"只删聚焦键"在批量负载下**偶发红 2 次**（期望 `tab=review`、实际 `bills`，失败耗时 61ms vs 通过的 ~198ms），单跑与空闲批量 13 次全过。

**我没有用"复现不了"来结案，也没有加超时/重试把它糊过去**，而是去找那个键为什么不能当判据——结论是**同一个坑我踩了第二次**：
- 第一次（§1.75 已记）：夹具带 `section=bill` 时，账本自己的 `focusBill()` 会为了让那笔账单可见主动把分区切到"固定账单"。那是**正确行为**，但让 `tab` 的取值不再由被测组件决定。
- 第二次：换成 `tab=review&focus=tx1` 也不行——账本的聚焦逻辑会在**数据就绪后异步**改写 `tab`。负载高时这个改写落在我点击**之后**，于是断言看到了 `bills`。

**处置：把判据与账本的异步行为解耦，而不是放宽它。** 行为层改用任何视图都不会改写的合成键 `keep=1`（把整份 query 清空的实现会连它一起删掉，判别力仍在），`tab` 只断言"还在"（因为它本来就会被账本改写，而且账本对**默认**分区不写 URL 参数，所以连"必须等于某个值"都不成立）；`tab=review` 的**逐字保留**交给纯函数层那条对照——那里没有异步、没有视图。改完顺序跑 4 次、再**并行 3 个 vitest（正是当初出红的条件）**跑 3 次，全绿。

**为什么单独写一节**：一条偶发的守卫**比没有守卫更糟**——它会训练人忽略红色，而"忽略红色"这个习惯一旦形成，后面所有守卫都会一起失效。这类问题的正解不是重试，而是问"这条判据到底有没有把被测对象和行为噪声分开"。

### 1.79 ≤900px「更多功能」升级为真抽屉：一次方向推导的自我更正（第五十四轮）

**用户的要求是「侧边栏右划手势关闭」。第一版把它读错了，错在一条几何不变量上：锚定方向与手势方向必须同向。**

- 第一版：**左**锚（`left:0`）+ 跟手向**右** + 出场向**左**（`translateX(-102%)`）。三个部件单独看都"对"，合起来是**矛盾**——手指往右拖、面板跟着往右走、松手却往左飞出去，方向反转。
- 三件事同时指向右锚：① **物理**上，左锚面板要藏起来只能往左移动，所以任何"跟手"的关闭手势必须与出场同向，"右划"就要求右锚；② **原始设计**本来就是右下角浮层（`.mobile-more-sheet` 原本是 `right:10px; bottom:calc(70px + safe-area)`），触发它的 `.more-trigger` 又是底栏 5 列里**最右一格**——从右边滑出、在右下方触发、往右甩掉，三件事方向一致；③ 交接文档的"右划"是**用户侧的明文要求**，不该悄悄改成"左划更自然"。
- 最终：右锚 + 跟手向右 + 出场向右（`+102%`）。**只翻了出场这一侧的符号**——跟手 / 速度 / 甩动 / 吸附的符号本来就与"向右"绑定，所以一个没动；阈值、比例、甩动、鼠标忽略、方向锁的**数值一个没改**，测试用例数只增不减（`drawerDrag` 24→26、`sidebarDrawer` 22→29）。

**把不变量写进代码，而不是留在注释里**：新增 `drawerDirectionsAgree()`，三层断言——纯函数层（含判别力夹具：出场符号写成负号必须为假）＋组件层（从**运行时的两个内联 style** 各取一个真实数字：拖动中的 `translateX(200px)` 与松手后的 `translateX(102%)`，断言同号）＋源码层（CSS 的 `102%` 与 JS 的 `DRAWER_EXIT_SHIFT` 必须是同一个数，防只改一边）。变异自证：把 `DRAWER_EXIT_SHIFT` 临时写成 `-102` → **5 条红**（跨两个文件，含 `expected -102 to be greater than 0`），还原后 grep 复查无代码残留。

**它自己撞到的另一个真缺口：层叠阶梯。** `.sidebar` 自身 `position:fixed; z-index:20` 就是层叠上下文，抽屉与遮罩在它里面（30/31）**逃不出去**，于是 `.task-pill`(90) 浮在遮罩之上——**抽屉开着还能点到后面的东西**。取值区间是硬的：必须 `> 90`（否则压不住胶囊）且 `< 100`（`Modal` 的 `.overlay`，否则抽屉开着再开弹窗时整条底栏会浮在弹窗遮罩之上），阶梯上 90 与 100 之间是**唯一空档** → 取 **95**。并且必须写成**复合选择器**（`.sidebar.drawer-open`）而不是裸 `.sidebar`：原因见 §1.73——App.vue 那份 scoped `.sidebar[data-v-app] { z-index:20 }` 与裸写法**特异性完全相同**，胜负会落到源码顺序上，而 vitest 不处理 CSS，于是**改完测试全绿、真机上不生效**。判据四条：行为（打开带上、**关闭摘掉**，不留永久抬高的侧栏）＋数值（三个上界全部从源码解析真实数字）＋特异性严格大于（平手即红）＋归属（必须被 ≤900px 媒体查询包着，桌面阶梯不受影响）。变异：把选择器拍平成裸 `.sidebar` → **2 条红，而行为断言照样绿**——正好证明"CSS 被吃掉但没人发现"这类失效只能靠源码层判据兜住。

**交互与可达性**：遮罩（`@click.self`）＋ `section.mobile-more-sheet`（`role="dialog" aria-modal="true" aria-label="更多功能" tabindex="-1"`，**未 Teleport、未用 `aria-hidden`**，类名继续含 `sheet`）；底栏 5 项原样保留；**4 条关闭路径**（× 按钮 / 点遮罩 / Escape 仅当栈顶 / 右划 ≥32% 宽或 ≥0.5px/ms 甩动）；Tab 在抽屉内循环；滚动锁走 `modalLockCount` 引用计数，与 Modal 叠加时正确回落。**改造中被既有守卫抓到一次真 bug**：原来的 `nextTick` 延迟初始聚焦，会在"打开后立刻 Escape"时把焦点塞进**正在离场、马上被移除**的面板，焦点掉到 body——`sidebarMoreSheetEscape` 当场红，已改成独立的 `flush:'post'` watcher。
右缘守卫（18px）做了镜像：面板右锚后它的外缘就是屏幕右缘，而 Android 的返回手势可从**左右任一边缘**起手；代价是抽屉最右 18px 起手不触发右划（与旧版同口径）。判别力对照：**同样 330px 位移**，起手在守卫区内 → 面板一动不动、抽屉不关；起手在区外 → `translateX(320px)` 并关闭。

**我的独立复核**：25 个文件 **270 条全绿**（它 2 个新文件 + 全仓样式/可达性/浮层守卫共 23 个既有文件）。

**只能真机确认的（不写成"已验证"）**：`100dvh` / `position:fixed` 在地址栏收放时的真实高度；iOS 指针事件与系统边缘手势是否抢走拖动；95 这个值在真机上是否真的压住胶囊（源码与行为判据都对了，但 vitest 不处理 CSS）；右划跟手后的离场观感与 32% / 甩动阈值的手感。

**一个已知的百毫秒级瑕疵，我选择接受而不是修**：关闭瞬间 `drawer-open` 随 `showMobileMore` 立刻摘掉，而面板还在离场过渡中，这几十~两百毫秒里任务胶囊会短暂盖在正在滑出的面板上。修它需要给抽屉加一个"离场中"状态（或挂到过渡钩子上），而**在这个仓库里过渡钩子不可靠**——vitest 不跑 CSS 过渡，钩子可能永不触发，于是状态卡住不摘。拿一个百毫秒观感瑕疵换一个"状态可能不回落"的风险不划算，所以记在这里而不是让它以"没提"的方式存在。

### 1.80 只有"登记新键"才会暴露的失效：农历纪念日的内存镜像（第五十四轮）

**这条缺陷不属于任何单个功能，而是两个各自都"对"的设计碰在一起的结果——只有在把新键登记进同步/备份时才看得见**，所以单独成节。

**两个各自成立的设计**：① `festive.js` **故意不 import 存储层**——它被 node 环境的纯函数测试直接 import，把 store 的事件循环带进依赖图会让那批测试报废，所以农历纪念日走 `lunarAnniversaries.js` 的模块内存镜像；② 存储层的 `restoreStoredValues()`（`store/core.js`）写完 localStorage 后会**同步更新注册过的响应式引用**（`storedRefs`，由 `useStoredRef` 建立）——这是云同步合并、备份恢复、本地迁移导入的**共同漏斗**。

**缺口**：模块自己的镜像**不在 `storedRefs` 里**，那条"恢复时同步更新引用"对它无效。而三条恢复路径里，**备份恢复与本地迁移导入都以 `window.location.reload()` 结束**（`DataManager.vue:1312/1314`、`LocalTransfer.vue:409/460`），刷新会把镜像重建，所以**它们没事**；**只有云同步合并不 reload**（`cloudSync.commitStoredValues()` → `restoreStoredValues(values, { markChanged: false })`，`cloudSync.js:665`）。于是：**拉取云端数据后，设置面板显示新数据、首页却仍按旧镜像点亮**——用户得到的结论是"恢复成功了但首页没变"，也就是他会以为恢复失败。**这类失效不会报错、不进控制台**，只会让两个界面自相矛盾。

**修法是两套互补机制，不是二选一**：

1. **读取时跟随存储**（`lunarAnniversaries.js`）：把"只补水一次"改成"**每次读取都比对上次读到的原始串，变了就以存储为准**"。这条负责**正确性**——任何写者（包括将来新加的、以及另一个标签页）都会被看见，不需要它去认识所有写路径。
2. **存储层的发布钩子**（`store/core.js`）：`restoreStoredValues` 完成后、以及跨标签页 `storage` 事件里，发布一次镜像。这条负责**即时性与响应式**——`lunarMirror` 是个 ref，只有"发布"才会让依赖它的 computed 重新求值；光有第 1 条，外部写入要等到下一次别的渲染原因才显示出来。

**判据**（`tests/lunarAnniversaryStorageSource.test.js`，11 条）：外部写入（**直接 `localStorage.setItem`，不经过任何模块 API**——这正是 `restoreStoredValues` 的写法）必须被读到；外部删条目、外部**清空整个键**、外部写入损坏 JSON（不抛错、退化成空而**不是**旧值）各一条；面板发布的即时生效在两种顺序下都成立。另有一条**判别力对照**：把旧实现的核心（布尔锁 + 一次性赋值）原样复刻出来，证明**同一份夹具在旧实现下必然读到旧值**——否则这个文件就是摆设。再加一条源码棘轮：补水判据必须比对 `mirroredRaw`，且"一次性布尔锁"不许回来（带自证夹具）。
**变异验证**：把判据退回 `if (mirroredOnce) return` → **5 条红**（含 3 条行为断言），还原后逐字确认与变异前相同。

**还有一条防"两个机制之间漂移"的守卫**：存储层是用动态 `import()` 拿发布函数的（避免静态依赖），所以键名在那里**可能是字面量**——键名一旦漂移，钩子会**静默失效**（不报错、只是不生效）。守卫断言存储层要么引用键名常量、要么写上与常量一致的字面量，并配一条"写错键名必须为假"的对照。

**残留（诚实）**：若有第三个、谁也不认识的写者改了 `sl_festive_lunar`，第 1 条保证"下次读取是对的"，但**不会主动触发重渲染**——UI 要等到下一次别的渲染原因才更新。这不是缺陷而是代价：要彻底消除，得让镜像本身变成 `useStoredRef`，而那会把存储层拖进 `festive.js` 的依赖图（见本节开头那条约束）。

### 1.81 登记 5 个新键：真正会出错的地方是"抄错的默认值"和"漏掉的清单"（第五十四轮）

**新键不进登记，就等于功能只在当前这台设备上成立**：云同步不传、备份不含、本地迁移丢、损坏矩阵不覆盖。所以这一节的判据不是"代码跑不跑"，而是"**这 5 个键在 7 个清单里齐不齐、默认值抄得对不对**"。

| 键 | 默认值（**抄自属主常量**，不是凭印象写） | 出处 |
| --- | --- | --- |
| `sl_ledger_fx` | `{ base:'CNY', rates:{}, updatedAt:'' }` | `ledgerFx.js` 的 `DEFAULT_LEDGER_FX` |
| `sl_ledger_budget` | `{ monthly:null, updatedAt:'' }` | `ledgerBudget.js` 的 `DEFAULT_LEDGER_BUDGET` |
| `sl_ledger_templates` | `[]` | `ledgerTemplates.js` 的 `useStoredRef(KEY, [])` |
| `sl_festive_lunar` | `[]` | 模块无默认常量；消费点 `FestiveSettings.vue` 用 `[]`，模块自身把 `null` 与非数组都归一成 `[]` |
| `sl_ui_language` | `'zh'` | `narrative.js` 的 `DEFAULT_NARRATIVE_LANGUAGE` |

7 个登记点：`cloudSyncData.js`（默认值 + 模块分组）、`syncMetadata.js`（实体/单例分区）、`DataManager.vue`（STORAGE_KEYS + makeBackup + validateBackup 归一化）、`emergencyExport.js`、`localTransfer.js`（含 `ARRAY_KEYS`）、`store/core.js`（显式提交集合）、`tests/storageCorruptionResilience.test.js`（SL_KEYS + 嵌套变体）。`functions/`、`scripts/`、`sync-coordinator/` 经 grep 确认**不存在键清单**，无需登记。

**第一件容易错的事：默认值的形状要跟"同类键"一致，而不是跟"这个键的类型"一致。** 对象型设置沿用 `sl_ledger_freq` 的 `null` 兜底（= 未设置就不覆盖他机数据），数组用 `[]`、标量用 `'zh'`。写错方向的代价**不对称**：把对象键的默认值写成 `{}`，会让"备份里没有这一项"变成"用空对象覆盖对方已有的汇率表"——用户导入后汇率全没了，而且看起来像是自己没设置过。

**第二件：`localTransfer.js` 的 `ARRAY_KEYS` 是 merge 模式的分水岭。** 不登记的话 merge 会整键 keep-local，用户"合并导入"后会发现刚导入的模板与农历纪念日**一条都没进来**，而其它键都进来了——于是看起来像是"这个功能坏了"，而不是"导入模式选错了"。

**第三件：`EXPLICIT_COMMIT_KEYS` 不是键清单，是行为开关。** 判据不是"这个键重要吗"，而是**属主的写路径有没有 `touchStoredRef`**：ledger 三键都有（`ledgerFx.js` L75 / `ledgerBudget.js` L46 / `ledgerTemplates.js` L70，形状与同列的 `sl_course_templates` 相同）；而 `narrative.js` 与 `lunarAnniversaries.js` **全仓 grep 零命中**。把后两者加进去只会关掉 deep watcher 而没有任何收益（它们的写路径本来就是整体赋值），所以我**没有**为了让"5 个键在每个登记点都能 grep 到"这个漂亮的对称而加它们——**对称不是判据**。

**矩阵：174 → 198 条。** 顺带纠正我自己交办时的口径错误：我写的是"每个键 3 类变体 × 2 路由"，但文件里 `TOP_LEVEL_VARIANTS` 只有 2 条，第三类（嵌套形状损坏）是**手写**的、不按键自动生成。实际算式是 `41×2×2 + 16×2 + 2 = 198`（原 `36×2×2 + 14×2 + 2 = 174`）。两个新对象型键（汇率、预算）各补了一条嵌套变体——**"rates 被塞成字符串"这类损坏正是顶层合并会放行的那一类**，也就是 §1.67 那条真缺陷的形状。文件里两处"36 个"的自述计数一并改成 41：**注释里的旧数字也是假话的来源**。

**我独立复核的**：逐键 × 逐点的命中数（`cloudSyncData` 每键 2 处 = 默认值 + 模块分组；`syncMetadata`/`DataManager`/`emergencyExport` 各 1；`localTransfer` 1~2；`core.js` 3 个 ledger 键 + `sl_festive_lunar` 4 处 + `sl_ui_language` **0 处**——正是上面那条判据的结果）；`touchStoredRef` 命中数（3/3/3/0/0）；"36→41"确实改了；受影响测试 **49 个文件 / 687 条全绿**（含 198 条矩阵）。

**仍然开着的小口子（诚实记下，不假装没有）**：

1. **默认值在两处各写了一遍**：`cloudSyncData.js` 内联了 ledger 三键的默认值，而不是引 `DEFAULT_LEDGER_FX` 等常量——因为 `ledgerFx.js` 会反向 import `store/core.js`，从 `cloudSyncData` 引它会造成**循环依赖**。代价是**属主改默认值时，同步侧那份不会跟着变**。这是一个"看起来对、只有改了属主才暴露"的漂移点，与 §1.80 的键名漂移同类；登记侧的**漏项**已有 `syncDirtyAllowlist` 与 `cloudSyncData` 自身的"模块分组恰好覆盖全部同步键"守卫兜住，但**取值漂移没有守卫**。
2. `sl_festive_lunar` 登记为**单例**（依据是同域的 `sl_festive_config.anniversaries` 与 `sl_schedule_exceptions`）：换来的是不需要稳定 ID 校验、不会被 `remote-entity-id-invalid` 卡住同步；代价是两台设备同时改**不同**条目会整值冲突。
3. `sl_ui_language` 归到 atmosphere 模块（云同步与本地迁移），依据是它的切换入口就在氛围设置面板里。
4. 既有缺口未动：`TRANSFER_MODULES` 仍不含 `sl_schedule_note`——不是本轮引入的，记在这里以免下次又被当成新发现。

### 1.82 分文件自测全绿 ≠ 全仓绿：全量 `npm run check` 抓到的两件事（第五十四轮）

本轮有 8 个并行工作流，每个都自测过、每个都报"我的文件 eslint 0、我的测试全绿"。**全量 `npm run check` 仍然连红两次**，两次都不是"某个功能写错了"，而是"局部自测的盲区"。这两条记在这里，因为它们比功能本身更可能在下一次重演。

**第一次红：lint 抓到一个 `let`。** `tests/sidebarDrawer.test.js:136` 的 `let mounted = []` 从未被重新赋值（一直是 `push`）→ `prefer-const`。抽屉代理报过"eslint 我的文件 0 报错"，但它 lint 的是**自己列出的那批文件**，而这个文件的这一行不在它那批里/或它改完之后又加了一行没重跑。**代价极不对称**：一个 `let` 让整条 `lint && typecheck && test && build` 链条在第一步就停下，后面 1730 条测试一次都没跑——**这正是把 lint 放在链条最前面的意义**。修法就是把 `let` 改成 `const`。

**第二次红：一条"取消后不该有浮层"的断言，被一个与它无关的浮层污染了。** 报错是
`笔记删除：点取消笔记还在，点确认才真的删掉 → 取消后确认框应关闭: expected <div class="overlay" …> to be null`，而收到的那个浮层**不是确认框**——是 `✨ 已更新` 更新说明（版本 `2026年09月20日-版本49`）。链条是这样的：

1. 该文件的 `beforeEach` 会 `localStorage.clear()`（要一个全新 profile）；
2. 全新 profile 下 `shouldShowReleaseNotes()` 为真——应用**会**自动弹出"这次有这些变化"，这是**正确行为**；
3. 但 `UpdateNotes` 在 `App.vue` 里是 `defineAsyncComponent`，所以那个浮层**什么时候挂上来是一个时序问题**；
4. 断言写的是 `topOverlay()`（body 里最后一个 `.overlay`）**为 null**，也就是"取消确认框之后，body 里一个浮层都不剩"；
5. 我这一轮把版本号从 **48 提到 49**，这条时序恰好翻到了另一边，更新说明的浮层赶在断言前挂上了，于是红。

**它的前一版是"靠运气绿"的**：同样的代码在版本 48 时通过，不是因为逻辑对，而是因为那个异步分块没赶上。**这类绿的危害和偶发红一样大**——它会让一次真正的回归（确认框没关掉）被同样的噪声掩盖。

**处置是让状态确定，不是把断言放宽。** 在那个 `beforeEach` 里显式写上"更新说明已看过"（`localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)`，用导出常量而不是手抄字符串），把"取消之后 body 里没有浮层"这条强断言**原样保留**。同时补上一条判断依据：这条时序风险的核心是**异步组件 + 全新 profile**，所以任何"清空 localStorage 后挂载应用、然后对浮层做整体断言"的用例都躺在同一个坑里——我 grep 过全仓，没有别的测试断言过更新说明浮层的存在（`✨`、`release-notes`、`release-version` 三个特征在测试里零命中），所以这次只需要改这一处。

**这两条合起来说明一件很实际的事**：并行代理交回来的"全绿"只是**它自己那片**的全绿；只有把 `lint → typecheck → 全部 166 个文件 → build` 串起来跑一遍，才能知道它们拼在一起是不是绿的。**这也是我坚持每轮末尾跑全量的唯一理由。**

### 1.83 「这次只需要改这一处」被我自己推翻：把浮层时序坑从根上堵掉（第五十四轮末）

**§1.82 的结论有一半是错的，这里更正。** 那一节最后写着"我 grep 过全仓，没有别的测试断言过更新说明浮层的存在……**所以这次只需要改这一处**"。前半句是对的，**后半句的推论错了**：正因为**没有**任何测试覆盖过这个浮层，它才不该继续呆在所有挂载类用例的初始状态里——"改这一处"只是把一个系统性噪声按死在了一个文件上。

**动手前先量了两个事实**（否则就是拿全仓当试验场）：

1. **更新说明浮层此前是零覆盖**，不是"被覆盖且不能碰"：`✨`、`release-notes`、`release-version` 三个特征在 `tests/` 里零命中。
2. **没有任何测试枚举 localStorage 的键集合**：`Object.keys(localStorage)` / `localStorage.length` 在 `tests/` 里零命中。所以夹具多写一个"已读"键不会把谁的断言撞歪（这一点必须实测，不能靠"应该没事"）。

**修法是一减一加，覆盖面因此变大而不是变小。**

- **减**：`tests/helpers/mountApp.js` 新增参数 `markReleaseSeen`（默认 `true`）。夹具默认扮演**回访用户**，在挂载前调用真正的 `markReleaseSeen()`（用导出函数，不手抄键名）。于是"浮层"这类**整体**断言只反映被测组件，不再取决于某个异步分块有没有赶上。
- **加**：新增 `tests/updateNotesModal.test.js`，把这个浮层**正面覆盖**起来——首次启动会弹、显示 `版本 <APP_RELEASE>` 与本轮说明第一条、点「知道了」会关闭并写 `RELEASE_SEEN_KEY`、之后再启动不再弹；并加一条**判别力前提**：干净 profile 下 `shouldShowReleaseNotes()` 必须为真，否则"不弹"那条断言毫无意义。要测"首次启动"的用例显式传 `{ markReleaseSeen: false }`。
- `confirmDialogMigration` 里那份**临时的**文件级声明保留一行（在它自己的 `localStorage.clear()` 之后显式复位），注释改为指向夹具——理由是**不依赖"夹具一定在我之后跑"这种隐含顺序**。

**证据**：新文件 4 条全绿；12 个依赖挂载做整体断言的文件（`appShellAnnouncements` / `routeAnnouncement` / `renderedHeadingOrder` / `tabOrderAndNames` / `landmarksAndRoles` / `backupIntegrity` / `dataManagerSync` / `dataManagerRestoreNav` / `courseTemplateDate` / `scheduleGridRoving` / `confirmDialogMigration` / `updateNotesModal`）**86 条全绿**；再扩到含 **198 条**损坏矩阵的一批，**13 文件 / 309 条全绿**。

**顺带记一条仓库自身的证据**：在改之前，已经有 **6 处**测试各自写 `document.body.querySelectorAll('.overlay').forEach((el) => el.remove())` 来绕开这个浮层。也就是说这个坑早就在被反复踩，只是每处各踩一遍、没人把它挪到源头。**"每个测试各自绕开"是这类系统性噪声的典型症状。**

**仍然只是建议、没有强制手段的一条口径**：以后要"全新的应用状态"时用**白名单清法**（清业务键、保留已读标记），而不是 `localStorage.clear()`——后者会把"应用在全新设备上的行为"一并引进来。

### 1.84 文档也会过期，而过期文档比缺文档更坏：一次根目录文档普查（第五十四轮末）

起因是 §6 那张表里"向用户要产品决策——这是现在**唯一真正剩余的大块**"这句话：六项产品决策已经全部落地，这句话留着会让下一个接手的人**去做已经做完的事**。于是把根目录所有文档普查一遍（`AGENTS.md` / `DESIGN_TOKENS.md` / `FINAL_PRODUCT_AUDIT.md` / `HANDOFF.md` / `LEDGER_FINAL_OPTIMIZATION_REPORT.md` / `NEXT_PROMPT.md` / `README.md` / `RECORD_LEDGER_UX_OPTIMIZATION_REPORT.md` / `research-shortcut-platform-notes.md` / `SYSTEM_CLOSURE_AUDIT.md` / `UX_AUDIT_176_REPORT.md`），结果：

| 文档 | 实测到的过期内容 | 处置 |
|---|---|---|
| `HANDOVER.md` §6 | "向用户要产品决策（§3.2 那张表）"是"现在唯一真正剩余的大块"——已全部完成 | 重写：真机验证清单（5 项，逐项说明为什么只能人来验）+ §4 第 26/27/28 条现状 + "已完成不要重做"四项 + "不要再做的事" |
| `HANDOVER.md` §8 结尾 | 第五十三轮的记录里留着同一句"真正剩余的大块只有 §3.2 的产品决策" | 划掉并标注"→ 第五十四轮已全部完成，见 §9"（保留当时的实况，不篡改历史） |
| `NEXT_PROMPT.md` | 标题是"交给下一个 AI 会话"，正文称两项是**新需求**，还写着"vitest **187 条**全绿"。实测**两项都已实现**：① 云同步选择性拉取（`DataManager` 的 `SYNC_MODULES` 勾选 + "未勾选的模块保持原样" + `pullFromCloud({ keys })` / `normalizePullKeys`）；② 语音识别（`voiceInput.js` 已覆盖 `webkit/moz/ms` 四种前缀 + 按错误码给友好文案，`QuickRecordPanel` 在不支持时显示降级提示而非报错） | 顶部加**非破坏性状态标注**（正文一字未改）：这是已完成的历史需求单、两项的证据位置、文中数字是当时实况、**当前交接文档是 `HANDOVER.md`** |
| `HANDOFF.md` | §6 标题写着"**当前最新**"，内容却是 `2026年08月29日-版本13` / 签名 `8651dd88cb` / **208 条测试**；§7「后续可选工作」里至少两条已完成（农历表已覆盖 **1900–2101** 含闰月；快速录入悬浮球已迁走） | 加状态标注，并点明"两份文件**目前互不引用**，从这份开始读会读到一个几十轮前的世界" |
| `README.md` | 功能清单落后于实际：账本只写到"支出、收入、分类、账户、日/月统计和固定账单"，节日只提到"节日氛围" | 按**真实能力**补齐（多币种与汇率换算，**缺少汇率时明确提示、不按 1:1 静默计入**；月度预算与超支提示；退款分摊；账单模板；农历含闰月；叙事文案可切换语言——措辞**不含**"全站翻译"，因为全量 i18n 是被明确拒绝的） |

**两条方法论上的收获：**

1. **"互不引用"比"引用错了"更危险。** 普查时发现 `NEXT_PROMPT.md` / `HANDOFF.md` / `README.md` **都没有被** `HANDOVER.md` / `AGENTS.md` / 报告引用过。误导面因此比我最初估计的小（读交接文档的人不会被指过去），但正因为没有任何交叉引用，一个自己走进 `HANDOFF.md` 的人**得不到任何提示**：他会看到一份标题写着"当前最新"、实际停在几十轮前的状态表。所以标注仍然值得做，而且要在**指向当前文档**这件事上写清楚。
2. **历史文档不该改内容，只该加状态。** 这四处我都**没有动正文**（`NEXT_PROMPT.md` / `HANDOFF.md` 的正文一行未改，`HANDOVER.md` 只加划线与指向，`README.md` 只补事实）。理由：正文是当时的实况记录，改了它就毁掉了"当时我们以为什么"这条信息；而"现在是什么"应该由**当前**文档回答。两者混在一起，就是这次要修的病。

### 1.85 层叠顺序不再由挂载时机决定：Modal 的内联 z-index 按浮层栈深度（第五十四轮末）

**这是 §4 第 26 条的正面修复。** 原状：`document.body` 里所有 `.overlay` 的层级是**同一个常量**，谁在上面完全由 DOM 顺序决定；而 Teleport 锚点是在组件**挂载时**创建的，于是"随页面常驻"的浮层（只有 `:open`、没有 `v-if`）在 body 里永远排在"打开时才建锚点"的浮层**之前**——眼睛看到后开的在上面，但读屏与 Escape（`overlayStack.js` 的 `isTopOverlay`）认为常驻那个在最上层。上一轮的 confirm 迁移只是把**症状**在迁移范围内消掉了（24 处都改成 `v-if="target"`），根因没动。

**修法**：让层级由**打开顺序**决定。`overlayStack.js` 新增 `overlayStackRevision`（`pushOverlay` / `removeOverlay` 时 +1，**仅**用于让 Vue 侧重算）、`OVERLAY_BASE_Z_INDEX = 100`、`OVERLAY_MAX_DEPTH = 9`、纯函数 `overlayZIndexAtDepth(depth) = 100 + min(depth, 9)`、`overlayZIndexFor(entry)`（按栈内 index，不在栈里返回 `null`）；`Modal.vue` 用它算出内联 `z-index`。**栈语义（Escape 只关最上层、滚动锁引用计数、焦点陷阱、`aria-modal`）一字未动**——只加了一个版本号自增。

**取值区间是硬约束，全部从源码解析后断言，不手抄**：基础值 100 ← `Modal.vue` 的 `.overlay`；上界 **109**；90 ← `.task-pill`；95 ← 抽屉打开态；110 ← `.sheet-overlay`；130 ← `.context-menu`；240/241/250/300 ← 同步告警、安全模式告警、快速记录提示、全局错误提示。断言：`109 < 110`、`< 130`、`< 240/241/250/300`；`100 > 90` 且 `> 95`；`overlayZIndexAtDepth(50) === 109`（**真的夹住**，不是"大概"）。

**一个必须记下来的实现细节**：关闭时绑定值要写成 `{}` 而**不能**写 `null`——Vue 的 `patchStyle` 在 `next` 为 `null` 且 `prev` 有值时会走 `removeAttribute('style')`，会把 `syncViewportGeometry` 写在同一个 style 对象上的 `top`/`bottom`/`height` **一起抹掉**。守卫里专门有一条断言"重渲染后 JS 写的 top/height 不被清掉"来锁这件事。

**判别力是两层证据，不是"我觉得对"**：① 文件里复刻了一份改造前的实现（同一常量层级、只靠 DOM 顺序），用**同一个**断言函数跑同样挂载顺序，断言它抛错且失败原因确实是"严格大于不成立"（而不是元素找不到之类的无关原因）；② **变异实验**：把 `overlayZIndexFor` 改回 `return OVERLAY_BASE_Z_INDEX`（退回常量）→ **4 条红**，失败的正好是 4 个行为用例（严格更大 / §4-26 真实场景 / 回落重算 / 与 top-height 共存），随后原样还原（grep 确认无残留，还原后 9 passed）。我自己独立复跑 `modalStackOrder` + `sidebarDrawer` + `overlayEscape` + `modal` = **4 文件 / 46 条全绿**。

**为什么没改 `src/style.css`（派单前提与实际不符，值得记一笔）**：`.overlay { z-index: 100 }` 并不在 `style.css`，而在 `Modal.vue` 的 scoped 样式里；`style.css` 里的 `.overlay` **只出现在打印媒体查询** `display:none !important` 的选择器列表中，没有 `z-index`。所以"来源一致性"判据改成扫描**全仓**（每个 `.vue` 的 `<style>` 与 `src/style.css`）里所有 `.overlay` 的 `z-index` 声明，断言它们全部 `=== OVERLAY_BASE_Z_INDEX` 且必须存在 `Modal.vue` 那一条——既抓漂移，也容忍将来搬家。

**顺带发现的一处守卫脆弱性（比上面这条更容易再犯）**：`tests/sidebarDrawer.test.js` 的 `ladderRungs()` 会把 `App.vue` 那段层叠阶梯注释里的**所有数字**收进来，再用"`> 90` 的最小一档"当 `nextRung` 去断言抽屉的 95 小于它。**这意味着那段注释里一旦写下 `95`，抽屉守卫会立刻失败（`95 < 95`）**——一条注释的措辞能决定一个守卫的生死，而写注释的人完全看不出这层耦合。处置的取法：新说明另起一段（`ladderComment()` 用 `lastIndexOf('/*', at)` 取"层叠阶梯"之前最近的 `/*`，所以必须放**在后面**，放前面会把新数字卷进去），并且**不写 95**（写成"抽屉打开态"）。

**如实记录的三条残留（都不是本轮引入）：**

1. **`ActionSheet`(110) / `ContextMenu`(130) / 抽屉(95) 不参与这个深度阶梯。** 先开 ActionSheet 再开 Modal 时，栈认为 Modal 最上层（Escape 关 Modal），视觉上 110 仍压着 100–109。**但我判断这不是缺陷、而是应有的优先级**：从浮层里打开的右键菜单必须在浮层之上（130），半屏面板压住弹窗也比反过来合理（110）。改它才是引入语义变化，所以**不动**，只记录。
2. **深度超过 9 时顶部几层同为 109**，又退回 DOM 顺序决定。这是"绝不越过 110"的取舍；本应用没有 9 层弹窗的现实路径。
3. **"真的画在上面"在本仓库验证不了**：vitest 不处理 CSS（`css:{include:[]}`）、happy-dom 没有布局。守卫证明的是"浏览器拿到了一份正确的**内联** z-index"，**不是**"渲染层级已核对"——测试头注释与源码注释都按这个措辞写，没有一处写成"已验证层级"。

### 1.86 死规则不止那 19 条：可达性守卫补上了 `componentDeadCss` 的盲区（第五十四轮末）

**§4 第 27 条说的是 `App.vue` 里 19 条永远匹配不到的侧边栏规则。它们是死规则，但更值得注意的是：`componentDeadCss` 看不见这一类。** 那个守卫按"类名在全仓是否出现"判死——`.nav-item` 当然在全仓出现（它在 `Sidebar.vue` 的模板里），所以它永远不会报；而真正的问题是 **Vue 的 scoped CSS 只把 scope 属性加在选择器的最后一段**，于是父组件里写"子组件的内部类"必然匹配不到任何节点。

**先证明、再删（这是第三十七轮 259 条规则事故的直接教训）**：用 `@vue/compiler-sfc` 逐条判定——选择器最后一段若只可能出现在某个子组件的**内部节点**上（读该子组件的模板，确认这个类不在根标签上）即不可达；落在子组件**根节点**上的类**合法**（scope 属性确实会加到根节点，`.sidebar` / `.sidebar.collapsed` 就属于这一类，必须保留）；`:deep()` 保留；**判不准的一律保留**。删除前后各编译一次 `<style scoped>` 做 diff，确认差异**只有**被删的那些选择器。结果：**负责的那一对 `App.vue → components/Sidebar.vue` 非法命中 0**，三条真正生效的规则都在（含把侧边栏变成底栏的那条——守卫还专门断言它**仍然包在 `max-width: 900px` 的媒体查询里、关键声明 `position: fixed` 没丢**）。删掉的量是**40 条规则体 = 43 个选择器行 / 32 个类**（25 条在顶层 + 15 条在 `@media (max-width:900px)` 里）；机械证据是编译产物 **111 → 71 条规则、17950 → 13185 字符**，消失的**正好**是这 40 条、**新增 0 条、被改动 0 条**。另有 2 条**未判定**予以保留（`.more-sheet-enter/leave-*` 这类运行时过渡类名，任何模板里都搜不到——按"判不准一律保留"处理）。**（这也解释了标题里那个"19 条"为什么变成 43：§1.73 数的是*一个区域*的选择器行，这一轮按同一判据清了*整个侧边栏段*，含嵌在 `@media (max-width:900px)` 里的 `.mobile-*` / `.mobile-more-*` 那一组——是**范围不同，不是越权**。）**

**顺带记一个"判据自己有洞"的事故，它比结论更有教育意义**：实现者最初把 `:class` 当成 `prop.name === 'class'` 来读，而 compiler 的 AST 里它其实是 `type:7, name:'bind', arg:{content:'class', isStatic:true}`——于是**动态 class 被静默漏读**。而 `:class` 恰恰是这套判据里最要紧的一处输入：`.sidebar.collapsed` 究竟是"合法（根节点类）"还是"非法"，全靠读子组件根标签上的 `:class`。是**夹具自证当场红了**（`expected [] to include '.child-root.collapsed .child-inner'`）才暴露的。⇒ **夹具自证不是走过场：它咬的第一个人就是写它的人。**

**更大的发现：同一类死规则不止这一处。** 同一次第三十七轮恢复事故在别的文件里留下了同类的"父组件写子组件内部类"。这一轮不允许改那些文件，于是**登记为只准缩小的棘轮**（数字是第三十九轮实测值）：

| 配对（父 → 子） | 条数 |
|---|---|
| `views/TodayView.vue → components/FocusPanel.vue` | 46 |
| `views/ScheduleView.vue → components/schedule/ScheduleGrid.vue` | 38 |
| `App.vue → components/TaskCenter.vue` | 25 |
| `components/AppearanceSettings.vue → components/ActionSheet.vue` | 16 |
| `views/TodayView.vue → components/MemoryView.vue` | 14 |
| `views/TodayView.vue → components/InboxPanel.vue` | 12 |
| `App.vue → components/WallpaperLayer.vue` | 2 |
| `LedgerView.vue → SwipeActionItem.vue` / `ScheduleView.vue → QuickRecordPanel.vue` / `ScheduleView.vue → ConfirmDialog.vue` / `AppearanceSettings.vue → Modal.vue` / `NoticeUnderstanding.vue → Modal.vue` | 各 1 |
| **合计（按对相加）** | **158** |
| **合计（实测命中条数）** | **157** |

（两个合计数不一样是**有原因的、不是笔误**：`sheet` 同时是 `ActionSheet.vue` 与 `Modal.vue` 的内部类，于是**同一条命中同时落进两对**。守卫没有替使用者猜"他指的是哪一个"，而是**两对都登记**——所以"按对相加"= 158，而全仓去重后的实测命中是 **157**。这类"归属有歧义"必须显式写出来，否则下一个看清单的人会以为数字对不上就是守卫写错了。）

守卫在措辞上把口径钉死了：**"这一轮能保证的是'没有未登记的非法命中'，而不是'全仓已经干净'。"** 并且要求**每一对残留都能说清"为什么还在"**（清单不是垃圾桶）、**配对集合不许新增**、**每对条数只准变少**、**登记总数必须等于实测总数**——想把某一条移出清单，只能把数字降下来。

**这一轮故意不清那 157 条**（这是判断，不是遗漏）：它们**用户可见效果为零**（"死"就是这个意思），收益只是"不再误导后来人"；代价是 12 对父子组件（横跨 10 个宿主文件）的破坏性 CSS 编辑，而本仓库验不了布局，且多条"数全仓规则条数"的下限要逐条重推——`contrastAudit` 那条已经被咬过一次（见 §1.87）。现在它们是一份**具体、可执行、有棘轮把守的清单**。

**这个守卫的判别力比"扫一遍"强得多，值得记下它的四种自证**：
1. **编译级证据**：把那条已删的选择器编译一遍，断言 scope 属性**只**加在最后一段（`.nav-item[data-v-…]`），证明"祖先段写了子组件根类"**救不了**它；
2. **规模自证**：≥50 个 `.vue`、≥45 个 scoped 块、≥2000 条 scoped 选择器、≥40 条父子链接、≥40 个解析出的根节点类——防止"零命中"其实是"什么都没扫到"；另有一条交叉核对，确认 scoped 块的定位与 `scripts/css-rules.mjs` 的 `styleBlocksOf` 一致，并用一个**含字面量 `<style>` 的 HTML 注释**夹具证明定位器不会被骗；
3. **夹具双向自证**：同一个样式块里合法与非法各一条、只抓非法；另有一条专门断言 5 种合法写法一个都不许误报（宿主自己模板里的类、子组件根节点类、写在子组件标签上的 class、`:deep()`、以及**全仓找不到来源的类应当"不判定"而不是判非法**），并断言夹具的选择器条数**恰好**是 6，防止这条自证本身是空的；
4. **判别力对照**：把已删的旧写法**注回真实 `App.vue` 的副本**（单一变量），立刻被抓；未改的那份对同一对**报 0**。

### 1.87 最后一处原生弹窗退场时，挖出一个"整个按钮都是坏的"真缺陷（第五十四轮末）

**§3.2 第 4 项要的是"`src/` 里不许再有原生弹窗"。做完之后 `window.prompt` / `window.alert` / `window.confirm` 在这轮负责的范围内归零，但过程中挖出一个比迁移本身重要得多的东西。**

**1）迁移本身**：新增 `src/components/PromptDialog.vue`（120 行），**基于 `Modal` 组合**而不是另写遮罩——于是自动继承浮层栈、滚动锁、Escape、Teleport、`role="dialog" aria-modal` 与标题 id。契约：`open`/`title`/`label`/`initialValue`/`confirmLabel`/`cancelLabel`/`inputType`/`maxlength`，事件 `confirm(value)`/`close`；**空值口径 = 空输入即无变化**（确认时 `trim()` 后回传，trim 为空只 `close` 不发 `confirm`，由组件兜住）。可访问名走双路：有 `label` 时 `<label :for="inputId">`，没有时退回 `aria-label=title`；输入框 `autofocus`（`Modal` 会聚焦 `[autofocus]`，不必手写焦点搬运）；Enter 确认；**Escape 交给 `Modal` 的浮层栈**（不重复实现，避免抢事件与双 `close`）。账本调用点用 `v-if="renameTarget" :open="Boolean(renameTarget)"`——正是 §1.74 那个坑的规避写法。`WeeklyReviewView` 的两处裸 `alert()` 换成页面内联 `role="status"` 提示（**两句文案逐字未改**）。

**2）真缺陷：那个按钮从来就不可能工作。** `WeeklyReviewView.vue` 原来写的是 `const { notes: noteCommands } = useDomainCommands()`——但 `useDomainCommands()` 返回的 `notes` 是 **`useStoredRef` 的数组 ref**，不是命令对象，所以 `noteCommands.createNote` **从来不存在**：点「一键生成回顾笔记」**每次都抛 `TypeError`**。更糟的是 `createNote` 是**同步**函数（`return item`），原来那条 `.then/.catch` 链即使函数名对了也必炸（`TypeError: ….then is not a function`）。

**这条的连锁含义才是关键**：两处 `alert()` 是**不可达的死代码**——也就是说，如果只把 `alert` 换成内联提示（字面上的任务），那个新提示**永远不会出现**，而静态评审完全看不出来（代码看起来"有提示、有失败分支、很完整"）。是**行为判据先红**才暴露它的：新写的"点按钮后提示真的渲染出来"用例在改这一行之前就报 `TypeError: noteCommands.createNote is not a function`。最小可行修法是按仓库惯例改成 `domain.createNote(...)` + `try/catch`。

**⇒ 这里有一处真实的行为变化，必须进发布说明**：该按钮从"点了必然抛错（什么都不发生）"变成"真的建出笔记并显示提示"。这是让两句文案可达的前提，不是顺手改。

**3）守卫地基的一处缺陷（比功能更值得记）。** 仓库里那套**引号状态机版 `stripComments`**（`confirmDialogMigration` / `overlayEscape` 用的就是它）在 `LedgerView.vue` **从 L483 起永久错位**：该行是 `return /[",\n\r]/.test(text) ? …`，**正则字面量里的 `"` 被当成字符串起点**，此后整份文件都被视为"处在字符串里"，**注释再也不会被剥掉**。后果是**假阳性**：新写的解释性注释里为了说明"这里原来是 `window.prompt(...)`"而引用了旧写法，被判成真命中（实测报 `views/LedgerView.vue: window.prompt`，而代码里早已没有该调用）。新的守卫改用**逐行**剥注释（先例：`tests/modalSections.test.js` 的 `stripJsComments`），并在文件头写明已知边界。

**我决定不把这套逐行剥注释推广到 `confirmDialogMigration` / `overlayEscape`**，理由是这个方向性判断：引号状态机在遇到正则字面量后**偏向假阳性**（把注释当代码，多报——吵，但**不会漏掉真的原生弹窗**），而朴素逐行剥离若把 `'http://…'` 里的 `//` 当成注释起点，会**偏向假阴性**（把真代码当注释切掉——安静，但会**漏掉真的调用**）。对一条"棘轮"守卫来说，漏报比误报危险得多。所以现状保留，并把它记成 §4 第 29 条：**要修就修那套状态机（让它认识正则字面量），而不是换成更弱的剥离器。**

**4）两条不属于本项的失败，归因已查清（其中一条推翻了提出者的假设）。**
- `contrastAudit` 的覆盖度自证（`gradientWithColor` 2 < 下限 3）：提出者认为原因是"`src/views/FoodView.vue` 已被删除，其 HEAD 版本含渐变+字色规则"。**这个归因是错的**——`FoodView.vue` 确实已删（工作树 ` D`、`src/` 内零引用、无任何测试断言其存在），但"食物"功能是**早先某一轮**下线的（`foodRetirement.test.js` 已经在 HANDOVER 里作为既有闸门被记录），而**上一轮收尾的全量 `npm run check` 是绿的**（当时 `gradientWithColor >= 3` 成立）⇒ 它的删除早于那次绿基线，不可能解释这一轮的 3→2。唯一在本轮消失的那条规则是 `App.vue` 里**不可达**的 `.brand-mark`（`color:#fff` + `background:linear-gradient(145deg, var(--brand-grad-a), var(--brand-grad-b))`，元素在 `Sidebar.vue:409` 的 `.brand` 内部 ⇒ 拿的是 Sidebar 的 scope 属性）。**教训**：归因不能只看 `git status`，要核"哪次绿基线之后才发生变化"。
- `scopedChildReachability` 的合成夹具自证**单独跑也失败**：提出者怀疑"并行代理改了 `scripts/css-rules.mjs`"，但 `git status` 里那个文件并没有改动 ⇒ 更可能是夹具自身在 `tmpdir()` 里写/读路径不匹配（`DIAG {"vueFiles":2,"scopedFiles":1,"selectors":1,…}`）。这是该守卫作者的收尾项。

### 1.88 给"剥注释器"加固：我第一次的修法更糟，是守卫把我咬回来的（第五十四轮末·补做）

**§4 第 29 条说"要修就修状态机（让它认识正则字面量）"。我照着修了——然后发现自己修错了方向，而且错得更危险。**

**先把真正错位的那一行钉死**：写了个只读脚本，逐字符复刻旧剥离器并记录"行首仍处在字符串里"的位置，得到 **`src/views/LedgerView.vue:483` 起连续 2713 行**。那一行是
`return /[",\n\r]/.test(text) ? ` `"${text.replace(/"/g, '""')}"` ` : text`。
机制比"正则里的 `"` 被当成字符串起点"还要绕一层：**引号配对错位后，模板的收尾反引号在"代码模式"下被当成模板开头**，此后文件里再没有反引号来闭合它——所以错位是**反引号**造成的，而不是双引号。**这也说明"照着别人的归因去修"是不够的：必须自己把机制走一遍。**

**第一次修法（认得正则字面量）——错得更严重。** 我加了正则识别（按"前一个有意义字符是标识符/`)`/`]` 就是除号"的经典启发式）。跑判据时**三条红**：两条是我自己新写的夹具（漏了"关键字后允许正则"这一支：`return /[",\n\r]/` 被我判成除法），第三条是一条**既有守卫**：
`全仓 ConfirmDialog 用法太少，判据没覆盖到东西: expected 23 to be greater than or equal to 26`。
**这条"覆盖面下限"红得非常有价值**：它逼我去查"少了哪 3 处"，而查出来的**不是注释，是 `AppearanceSettings.vue:550/560/570` 三段真实模板代码**。写脚本定位后发现，新剥离器把 **L431~L584、7571 个字符的真实模板内容当成了块注释**——起点是 `accept="image/*"` 里的 `/*`。链路是：模板里 `</div>` 的斜杠（前一个字符是 `<`）被我的启发式当成**正则起点** → 状态机错位 → 最后把 `image/*` 读成块注释开头。
**⇒ 第一版修法把"假阳性（吵）"换成了"假阴性（吞真代码）"，这是比原问题危险得多的方向。** 若不是那条覆盖面下限，它会被"测试全绿"掩盖过去。

**最终修法（两条机制叠加，且都不需要完整词法分析）**：
1. **正则识别**：`/` 前是"不可能是操作数结尾"的字符、或紧邻的词是**关键字**（`return`/`typeof`/`case`…）时才算正则起点；而 **`<` 与 `>` 一律不算**——模板里的 `</div>` 正是靠这一条被挡住。
2. **引号兜底**：引号只有在**找得到配对标点**时才进入字符串模式（`"`/`'` 只在本行内找——JS 里单双引号字符串不能跨行；反引号在整个文件里找——模板字面量跨行是合法用法）。找不到就把该标点当普通字符。**于是任何残留误判的伤害被锁死在单行内**，"从这里往后整份文件失守"这件事**结构上不可能**再发生。

**双向证据（用测试文件里抽出来的真实实现跑，不是复刻）**：
- **假阳性被修掉**：`LedgerView.vue` 里那段引用旧写法的说明性注释**确实存在**；旧实现剥离后还剩 **2 处 `window.prompt` 文本命中**，新实现 **0 处**。
- **没有吞掉真代码**：全仓 `<ConfirmDialog>` 用法计数 **旧 26 → 新 26**（不许变少才是"没吞"）。
- **守卫本体**：`tests/confirmDialogMigration.test.js` + `tests/overlayEscape.test.js` → **2 文件 / 22 条全绿**、eslint 0；其中包含新加的**正反夹具**（修好后注释能被剥掉、**逐字复刻的旧实现在同一份输入上剥不掉**、字符串与模板里的 `//` 不许被当注释切掉）。
- **那条 26 的下限不用改了**：它是被注释里的字样虚高的（旧剥离器剥不掉注释 ⇒ 注释里的 `<ConfirmDialog>` 被当成真用法）。新剥离器既修好了注释剥离、又没有吞真代码，所以实测仍是 26 ⇒ **下限原地成立**。这与 `contrastAudit` 那次（必须下调）刚好相反：**该不该动下限，取决于"被删/被剥掉的是不是真的不算数"，不能一律照抄上一次的处理方式。**

**这一节最该被记住的一条**：**守卫的"覆盖面下限"不是噪音——它抓到了我引入的假阴性。** 下限类断言被人嫌"数字一改就红"，但它在这里起的作用是"如果你突然看不见东西了，我要让你知道"。

**底部事实核查：顺手核清了"仓库里到底有几份剥注释器"。** 我此前在文档里写过"同一份逐字符引号状态机被另外几个守卫抄了去（~10 份）"——**这是个没数过就写下的数字，本轮逐个打开核了一遍，它不准确**。真实图谱：
- **逐字符引号状态机：恰好 3 份** —— `tests/confirmDialogMigration.test.js`、`tests/overlayEscape.test.js`、`tests/styleHooks.test.js`。
- **只剥块注释/HTML 注释的正则版**：`mobileViewport`、`referenceIntegrity`、`sidebarDrawer`（`/\*…\*/` + `<!--…-->`）、`accessibleNames`（只剥 `<!--…-->`）、`reducedMotionScroll`（逗号链）。
- **按行版**：`promptDialogMigration` 的 `stripTrailingComment`（先例是 `tests/modalSections.test.js` 的 `stripJsComments`）。

**三份状态机全部实测出同一处错位、全部已修**：`styleHooks` 那份不例外——把它单独抽出来跑 `LedgerView.vue`，剥离后 `window.prompt` 仍剩 **2 处**命中、**2711 行**的行首仍"处在字符串里"。它的文档注释里原本写着一条**明确的取舍**：「万一引号配平被模板里的撇号打乱，最坏结果只是少删一段注释…**不会删掉任何代码**」。本轮实测出这个代价是**假阴性**（注释里提到的钩子被当成"已接线"、注释里的令牌被当成"有读取点"），而按本报告自己的口径，**漏报比误报危险**；新实现两样都不需要牺牲（既有正则识别，又用"引号必须找得到配对"把伤害锁死在单行内），所以那段取舍说明已改写，并留下"原来为什么那么取舍"的记录。

**⇒ 与 §4 第 29 条同一件事的教训：函数同名不等于实现同源。** "共用的地基"这种说法必须自己数一遍再写；我那句"抄了 10 份"是从"十几个文件里都有个叫 `stripComments` 的函数"推出来的，而它们其实是三种不同实现、边界各不相同。

### 1.89 那 157 条残留死规则清掉了 152 条：五份并行清理 + 三条"不许删"的口子（第五十四轮末·收尾补做）

**任务**：§1.86 登记的那张"只准缩小的棘轮"（12 对 / 157 条命中）不是清不掉，只是当时有并行改动。本轮按**父文件**（不是按对——避免两个代理同时写同一个文件）拆成 5 份：TodayView 72 / ScheduleView 40 / App.vue 27 / AppearanceSettings 17 / LedgerView+NoticeUnderstanding 1+1。

**删除的判据（本轮按守卫的实现口径执行，并纠正了我自己在协议里写窄的一句话）**：一条规则不可达，当且仅当**选择器里任意一段**命中了子组件**内部**节点的类（不是"只有最后一段算"）。理由是 Vue 的作用域属性只加在**目标元素**上：只要某一祖先段点的是子组件内部类，目标元素就落在那个子树的内部、拿的是**子组件**的 scope 属性，父组件的 `[data-v-父]` 永远配不上；反过来若目标元素在子树之外，它又不可能是那个内部类的后代。这个口径与守卫实现一致，也正是 TodayView 那 72 个选择器（而不是按"最后一段"算出的 54 个）的来源——差的 18 条全是 `.x .btn` / `.x button` / `.x b` / `.x label` / `.x input` / `.x h3` / `.x ul` 这类**后代写法**。**这一处口径分歧我按守卫的实现走**，并保留了可整段还原的副本，便于日后推翻。

**每一份删除都按同一套证据标准交付**（不是"我觉得它死了"）：
1. **字节级**：删除切片按原偏移插回现块 ⇒ 逐字等于改动前（`before.css` 副本）；
2. **编译级**：`compileStyle({scoped:true})` 前后比较 —— 消失的条数**恰好**等于删除条数、**新增 0、被改动 0**（有的代理还做了"删前判死的集合"与"实际消失的集合"两向差集都为空）；
3. **判据自证**：把**改动前的旧块**喂回同一份判据 ⇒ 命中数**恰好**等于分配给的预期数字（46/14/12、38/1/1、25/2、16/1、1、1）；
4. **单一变量对照**：只在旧块里注回被删的那一行 ⇒ 命中立刻回来；
5. **恢复副本**：`%TEMP%\sl-deadcss-<file>.before.css`（原件未删）。

**结果（每对都是"改前 → 改后"的实测）**：

| 配对 | 改前 | 改后 | | 配对 | 改前 | 改后 |
|---|---|---|---|---|---|---|
| TodayView→FocusPanel | 46 | **0** | | App.vue→TaskCenter | 25 | **0** |
| TodayView→MemoryView | 14 | **0** | | App.vue→WallpaperLayer | 2 | **0** |
| TodayView→InboxPanel | 12 | **0** | | AppearanceSettings→ActionSheet | 16 | **0** |
| ScheduleView→ScheduleGrid | 38 | **3** | | AppearanceSettings→Modal | 1 | **0** |
| ScheduleView→QuickRecordPanel | 1 | **1** | | LedgerView→SwipeActionItem | 1 | **0** |
| ScheduleView→ConfirmDialog | 1 | **0** | | NoticeUnderstanding→Modal | 1 | **1** |
| | | | | **全仓命中条数** | **157** | **5** |

**剩下 5 条各自的"不许删"理由**（登记表里逐条写着，不是笼统的"还没清"）：
- `ScheduleView→ScheduleGrid` 的 3 条：可达性判据说死，但**保守判据**（类名在父文件样式块之外出现过 ⇒ 一律保留）要求留。它们是 `.timetable`（脚本里有字符串常量 `kind: 'timetable'`）、`.course.conflict`（`item.type === 'conflict'`）、`.exception-tag.makeup`（`makeup` 由 `viewExceptions[i].type` 运行期拼出，模板里没有 class 绑定）。
- `ScheduleView→QuickRecordPanel` 的 1 条：`.error` —— 它在父文件**模板区**出现 4 次（`:error="managerError"` 这类**属性名**）。它同时是"只命中 1 条"的两对之一：宁可留着。
- `NoticeUnderstanding→Modal` 的 1 条：**守卫自己的假阳性**（见下）。

**这一轮最值得记的一件事：那条"保守判据"救下了一条活规则。** 守卫报 `NoticeUnderstanding.vue` 里 `.confidence.medium` 是死规则，但人工核下去发现：`NoticeUnderstanding.vue:128` 是 `<div class="confidence" :class="parsed.confidenceLevel">`——**父组件自己模板里的元素**（Modal 的默认插槽内容，父作用域编译），`confidenceLevel` 的取值域是 `high|medium|low`；而 `medium` 恰好**也是** `Modal.vue:312` 内部的一个类名，守卫的 `classesOfNode` 读不出 `:class` 的**运行期取值**，于是归错了属。代理用运行时探针（自定义 renderer 记录 `setScopeId`）实测这条规则**是活的**（拿到的是父作用域的 id），并做了同一次探针的反面对照：子组件内部节点只带子组件自己的 id——那正是"父文件写子组件内部类必死"的机制本身。⇒ **如果我当初把"父文件块外提到过就不能删"这条兜底省掉，这次就会删掉一条活规则、并且测试全绿（因为没有守卫数得出来）。** 这也是为什么 `RESIDUAL_PAIRS` 里它必须留在 1：**要让它归零只能改判据**（把父模板元素上 `:class` 的动态取值算合法），而不是删规则。

**两条守卫当时在"守一份永不生效的死副本"——本轮改成守规则真正生效的那个组件**：
- `tests/sidebarDrawer.test.js`：断言要求 **App.vue** 里存在 `.task-pill{z-index:90}`，而那条正是被判死的规则（`.task-pill` 是 `TaskCenter.vue:96` 内部节点类；真正生效的一直是 `TaskCenter.vue:159` 自己的 `.task-pill{z-index:90}`）。改法只是把取材换成 `components/TaskCenter.vue`——**断言的含义（"阶梯注释里的档位必须和实现一致"）一字未改**，探针也确认 90 这个数与阶梯注释一致、其余三个不等式仍成立。
- `tests/cssRules.test.js`：`.skin-notebook .tt-cell` 与 `.tt-cell:hover` 的**级联顺序**断言原来读 `ScheduleView.vue`；而 `skin-notebook` 是 `ScheduleGrid.vue` 自己拼的类、`.tt-cell` 是它的内部节点类 ⇒ 那两条编译成 `.skin-notebook .tt-cell[data-v-<ScheduleView>]`，永远匹配不到。改成读 `ScheduleGrid.vue`（活规则在 L378/L379/L409，顺序仍是「skin 那条在后」，409 > 378/379）——**判据一字未改，只是不再守死副本**。
⇒ 共同模式：**断言取材要跟着规则的所有权走**。用户可见行为完全没变，但守卫从"守着一份永远不生效的副本"变成"守着真正在跑的那份"。

**"规模自证"下限重推了一次（2400 → 2240，实测 2299）**，理由必须写清，避免变成"红了就调小"：五份清理**各自**都做过归因（把各自的样式块换回改前再测，读数仍低于 2400），所以这是**所有删除落地后的一次重新基线**；本轮共删 **143 条规则体**（TodayView 66 / ScheduleView 34 / App.vue 26 / AppearanceSettings 16 / LedgerView 1）。⚠ 并行期间**真实发生过一次链式松动的诱惑**：某个代理一度把这个数改成 2399，随后发现全仓在两分钟内从 2399 掉到 2333，就**把自己的改动逐字回滚**并把它交给我收口——这个处理是对的，记在这里当先例。

**如实登记的覆盖边界（这一轮清的是"判据看得见的"，不等于"仓库里没有别的死规则"）**：
1. **守卫按 `import` 解析父子配对**，所以"引用了**没有 import** 的组件内部类"的规则永远进不了登记表。实测 TodayView 一个文件里就还有 **18 条 / 10 个类**属于这种（TaskCenter / LedgerView / FestiveSettings / DataManager / ExamsView / TasksView），它们**同样不可达**。本着一律保留的原则没删，留待单开一轮（要么扩判据到"未 import 的组件"，要么明确它们可能是全局注册/动态组件）。
2. **动态类名让一部分规则无法判定**：`NotesView.vue:202` 有 `` `task-${task.id}` `` 这种前缀拼接，`componentDeadCss` 因此放过 `.task-copy` / `.task-check` / `.task-priority` 一族（全仓任何模板里都找不到宿主）。按"判不准一律保留"处理。
3. **at-rule 不在判据内**：`App.vue` 与 `AppearanceSettings.vue` 各留下 2 条**消费者已被删掉的 `@keyframes`**（`task-spin-4add0040`/`task-pill-in-4add0040`、`sheet-overlay-in-db40fa9a`/`sheet-item-in-db40fa9a`），以及几个空 `@media` 壳。
4. **"选择器里没有类"的不可达规则也不在判据内**：`App.vue` 的 `:root[data-performance=reduced]`（见 §4 第 30 条——它不但不可达，即便可达也是空操作）。

### 1.90 从页面壳抽出业务边界：第一阶段重构（2026-10-08）

本轮开始仓库级结构重构，按职责移动代码，不改用户流程和数据语义：

- 首页的“下一项”投影移到 `src/composables/home/nextUp.js`；`TodayView.vue` 留下展示接线。
- 待办新增、编辑、校验、冲突确认与保存移到 `src/composables/tasks/useTaskEditor.js`；编辑目标仍在冲突弹窗打开前快照，避免确认期间误覆盖另一条记录。
- 应用提示优先级队列移到 `src/composables/useToastQueue.js`；页面 shell 保留通知呈现与浮层排位。
- 节日状态、周年分支和装饰粒子样式移到 `src/composables/festiveAtmosphere.js`；`App.vue` 仍按原有 key 输出标记。
- 账本分类新增、改名、图标、排序、隐藏及安全删除移到 `src/composables/ledgerView/useLedgerCategoryManager.js`。它保留分类 key，历史交易仍按原分类关联；删除前继续检查历史交易，并一并移除关联的自动分类规则。

配套测试覆盖了任务表单归一化与重复待办校验、提示队列优先级、分类新增及历史交易保护。应用级账本分类重命名回归继续验证列表、存储与稳定 ID；ConfirmDialog/PromptDialog 静态绑定扫描也同步支持从 composable 解构的处理器。周年动画守卫跟随职责迁移到氛围 composable，继续核对 JS key 与 CSS 规则一致。

同时修正了与当前源码状态脱节的测试夹具：提醒调度用例固定应用时钟；日期/星期夹具使用应用本地日期语义；测试同步 mock 与 pull/push 操作接口一致；课表键盘用例先切换到整周视图再找网格。收敛后的断点与死令牌检查、弹窗扫描和巨型文件棘轮均保留。

**证据**：`npm run check` 通过（lint、typecheck、195 个测试文件 / 2047 项测试、Vite 生产构建均成功）；无新增依赖。`App.vue` 为 965 行，`TodayView.vue` 为 964 行，`TasksView.vue` 为 944 行，`LedgerView.vue` 从 1311 行降至 1112 行，均在既有行数棘轮内。项目级阶段顺序记录在 [`docs/REFACTOR_ROADMAP.md`](../REFACTOR_ROADMAP.md)。这只是第一阶段；设置/数据管理和剩余账本边界还未完成。

## 2. 审计结论：已实现，无需改动










以下条目经实读确认**当前实现已满足**，动它只会引入风险：

| 类别 | 结论 |
| --- | --- |
| 移动端 safe-area / 横屏 | `Sidebar.vue`、`App.vue`、`Toast.vue`、`TaskCenter.vue`、`Modal.vue`、`ActionSheet.vue` 均已有 `env(safe-area-inset-*)`；`index.html` 带 `viewport-fit=cover` |
| iOS 输入框聚焦缩放 | `style.css` 的 `@media (pointer: coarse)` 已用 `font-size: 16px !important` 压过 3 处 14px |
| 加载/错误态统一 | `RouteFallback.vue` + `SkeletonBlock.vue` 已接入每个懒加载路由；启动错误页已存在 |
| 焦点陷阱 / 初始聚焦 / 空容器兜底 | `overlayStack.js` + `Modal.vue` + `ActionSheet.vue` 已实现；`trapTabKey` 两侧越界都回绕，容器内无可聚焦元素时兜底聚焦容器本身（第十轮复核） |
| 金额 0 支持 | `ledger.js` 数字分支只拒绝负数与非法值，`normalizeAmount('0.00') === 0`（本轮补了回归测试） |
| `touchStoredRef` 重复调用 | `store/core.js` 按 key 覆盖待写入 + 全局防抖，且序列化发生在写入时，不会写陈旧快照 |
| 减少动效模式 | `style.css` 两条全局规则 + `performanceMode.js` 的自动判定（本轮补了"装饰层不渲染"） |
| 情绪 4→3 天气塌缩 | 按设计塌缩，原始 emoji 仍在 `sl_mood_log`，单日可读 |
| 列表截断响应式 | `MemoryView` 的 `report` 是 `computed`，依赖 8 个 `useStoredRef`，数据变化即重算 |
| 节日装饰性能开关 | 开关与 `data-performance` 已存在（本轮补了渲染层降级） |
| 周期账单 | `createBill`/`nextBillDate`/`payBill` 幂等/`skipBill`/`undoBillPayment`/防手删支付记录/自然语言建账单 均已完整 |
| `activeDays` 去重 | 已在 `Set` 之前 `filter(Boolean)` |
| 表单/按钮防重复点击 | 加载按钮已有守卫 |
| 认证/anchorYear 的 SSR 安全 | `festive.js` 无 `window/document` 依赖，`applyAtmosphere` 有守卫 |
| 关闭浮层后焦点归还（第十轮） | `Modal` / `ActionSheet` 都在打开时存 `previousFocus`，关闭时归还；若下面还有一层浮层，先看焦点是否仍在下一层容器内，在就归还、不在就重做初始聚焦。两层共用同一个遮罩栈，所以「弹窗里再开一层」按 Escape 只关最上面那层 |
| 可聚焦候选的可见性过滤（第十轮） | `focusableWithin` 会剔除 `hidden` 与 `aria-hidden="true"`，优先用 `checkVisibility({ checkVisibilityCSS, contentVisibilityAuto })` 交给浏览器判断样式树，取不到再回退 `getComputedStyle`——焦点陷阱不会把焦点送去看不见的控件 |
| 减少动效覆盖到组件级动画（第十轮） | 系统 `prefers-reduced-motion` 与应用内 `data-performance='reduced'` 两条规则都写成全局 `*` + `!important`，同时压 `transition-duration` / `animation-duration` / `animation-iteration-count`。因为是 `!important` 的通配规则，16 处组件 scoped `@keyframes` 一并被压住 |
| `aria-hidden` 容器里含可聚焦元素（第十轮） | 全仓 25 处出现、按标签**配对扫描**得 23 个容器，逐一检查子树：含可聚焦元素 **0 处**。装饰性图标都是 `<span aria-hidden="true">`，本身不含控件 |
| 表单内按钮的隐式 `submit`（第十轮） | 唯一一处「`<form>` 内 `<button>` 缺 `type`」在 `ListsView` 快速添加表单：它是该表单**唯一的**按钮，默认 `submit` 正好配合 `@submit.prevent="addQuickItem"`，是设计意图而非缺陷（真正的坑是「非提交按钮缺 type 导致误提交」，这里不存在） |
| 内联 HTML 注入面（第十轮） | 全仓 `v-html` / `innerHTML` / `outerHTML` / `insertAdjacentHTML` 实际使用 **0 处**（`SearchPanel` 命中的那次是注释里「刻意不做 v-html」的说明：标题来自用户数据，拼 HTML 会引入注入面，所以只切字符串交给 Vue 转义） |
| `target="_blank"` 缺 `rel="noopener"`（第十轮） | 全仓 **0 处**（本项目没有外跳链接） |
| 文档语言（第十轮） | `index.html` 是 `<html lang="zh-CN">`，读屏按中文语音引擎朗读 |
| 页面缩放不被封锁（第十一轮） | `index.html` 的 viewport 只有 `width=device-width, initial-scale=1.0, viewport-fit=cover`，**没有** `user-scalable=no` / `maximum-scale`（WCAG 1.4.4 调整文字大小，AA 级通过）。低视力用户能双指放大 |
| 正的 `tabindex`（第十一轮） | 全仓 **0 处**（`tabindex` 只以 `0` 与 `-1` 出现）。正值会打乱自然焦点顺序，是明确的反模式 |
| 图片替代文本（第十一轮） | 全仓仅 3 个 `<img>`，**全部有 `alt`** |
| 焦点可见性：`outline: none` 的 10 处逐一核对（第十一轮） | 都有交代：`style.css` 的 `input/select/textarea` 配了 `:focus` 的 `border-color` + `box-shadow`；`QuickRecordPanel` 6 处文本框各配了边框/阴影焦点样式；`WheelPicker` 有自己的 `:focus-visible` 内描边；`ActionSheet`/`ContextMenu` 的 `outline: none` 落在**带 `tabindex="-1"` 的面板本身**（焦点环画在整个对话框上没有意义，面板内部每个按钮各有焦点环）。全局 `[tabindex]:focus-visible` 提供实心 `outline` + halo，只在鼠标点击时去掉 |
| 移动端数字键盘 `inputmode`（第十一轮） | 30 个数字语义输入中 11 个显式带 `inputmode`（`decimal`/`numeric`/`text`），其余是 `type="date"`（自带日期选择器）与 `type="number"`（本身就唤起数字键盘）。**惯例执行到位，无缺陷**——包括金额、时长、提醒分钟数这些高频输入 |
| 导航当前页 `aria-current`（第十三轮） | 源码里 **0 处**，但运行时**有**：侧边栏用 `<router-link>`，vue-router 4 在精确激活时自动渲染 `aria-current="page"`（已在 `node_modules/vue-router` 里核实：`link.isExactActive ? props.ariaCurrentValue : null`，默认值 `'page'`）。**只按源码判断会误判成缺陷并加一个冗余属性** |
| 孤儿 tab（第十三轮） | `role="tab"` 必须位于 `role="tablist"` 之内，否则是无效 ARIA。带嵌套栈的配对扫描：全仓 **0 处孤儿**，14 个 tablist 都正确包着 ✓ |
| 实时区域的命名（第十三轮） | `role="status"`（23 处）与 `role="alert"`（13 处）**全都没有** `aria-label`，而这**是正确的**：实时区域靠**文本内容**播报，内容就是它的消息。若把它们当作「缺名称」纳入守卫，会凭空造出 36 个假警，直接毁掉判据的可信度——因此判据刻意排除，并在守卫里写了理由 |
| 跳到主内容 skip link（第十三轮） | **原本没有（真缺失）** → 已补：`.layout` 的第一个子元素是 `<a class="skip-to-content" href="#main-content">`，`<main>` 加 `id="main-content"` + `tabindex="-1"`。视觉隐藏在 `transform` 上而非 `display: none`（后者会脱离 Tab 序，链接就废了） |
| 反馈消息的播报（第十四轮） | **16 处错误提示是哑巴、5 处成功提示是哑巴**（真缺陷，已补 `role="alert"` / `role="status"`）。成功必须用 `status`：`alert` 是断言式播报，把「已保存」当警报喊出来是语义错误 |
| 表单错误的关联（第十四轮） | 仓库早有五件套约定（`NotesView`/`LedgerView`/`EventsView` 都有注释写着「同一套约定」），但对未跟上；`CourseEditorModal`/`ExceptionsModal`/`ListsView` 已补齐 `aria-invalid` + `aria-describedby` + `role="alert"` + 焦点回跳 |
| 逐行错误标记（第十四轮） | **刻意不做实时区域**：`batch-error-row`/`plan-row-error`/`plan-error-tip`/`error-text` 随每次敲键变化，做成 `aria-live` 会疯狂播报，比不播报更糟；它们是表格内容，逐行导航时自然读到 |
| 悬空 ARIA 引用（第十四轮） | 全仓 **0 处**（判据会把静态值与绑定表达式里的字符串字面量都核对）。悬空引用是静默失败——属性看着配了，读屏什么也读不到 |
| 结构性缺陷六项普查（第十五轮，第十九轮重跑） | **重跑后全部 0 处**（带嵌套栈扫描）：重复 `id`、`<label for>` 悬空、`aria-hidden` 子树内含可聚焦元素、嵌套交互元素、静态 `id` 写在 `v-for` 内（源码只出现一次但运行时重复，上一项查不到它）、`<a>` 缺 `href`/`href="#"`。**其中两项原为真空结论**：第十八轮发现「`aria-hidden` 含可聚焦元素」那项的对象身份比较恒为假；第十九轮用修好的工具重跑「嵌套交互元素」，**查出 3 处真缺陷**（账本固定账单行是 `role="button"` 却装着真按钮，见 §1.30，已修）。其余四项不依赖祖先判定，重跑后仍为 0 |
| 伪按钮包着真按钮（第十九轮） | **3 处真缺陷**，全在 `LedgerView.vue` 的固定账单行：`role="button"` 的 div 里装着「已支付 / 跳过本次 / 恢复」这些真按钮 → 按 ARIA 规范 button 的子节点是 presentational，**内层按钮的语义被抹掉**，读屏还会把行名拼成「编辑固定账单「水费」 已支付 跳过本次」。已改为「真按钮编辑入口 + 兄弟动作按钮」，CSS 由三列改两列（视觉不变），并新增 `findNestedControls` 判据收口整类（全仓 0 处）+ 渲染 DOM 级测试 + 三条变异 |
| 嵌套 `main` 地标（第二十轮） | **1 处真缺陷**：`NotFoundView.vue` 自己是 `<main>`，而它是路由组件、渲染在 App.vue 的 `<main id="main-content">` **内部** → 渲染出的文档里出现嵌套 main（HTML 规范禁止，读屏地标导航出现两个「主内容」，内层按规范无效、部分实现直接忽略，404 页内容失去区域）。变异实证：改回 `<main>` 时渲染 DOM 实测 `querySelectorAll('main')` 返回 **2**。已改为 `<div>`（样式全走类选择器，外观不变），并新增「只有应用外壳可以声明 main」守卫 + 渲染 DOM 级测试 |
| 浮层缺 Escape 出口（第二十一轮） | **1 处真缺口**：`Sidebar.vue` 的「更多功能」浮层按 Escape 不关，而 `Modal`/`ActionSheet`/`ContextMenu` 三个浮层都处理 Escape → 与仓库自身约定不一致，键盘用户必须 Tab 到那个 × 才能收起。已补 Escape 出口 + 焦点归位（只在焦点原本在浮层里时才拉回触发按钮）|
| 模板保存日期走设备时区（第二十二轮） | **1 处**：`CourseManagerModal.templateDate` 用`toLocaleDateString` 按**设备**时区渲染纯日期标签，与应用时区策略（`policyDateKey`/`formatAppDate`）差一天；仓库为此专门写了 `createdDateKey` 并注释了这个坑，此处漏用 → 已改走 `createdDateKey` + `formatAppDate`。顺带修掉 `createdAt` 非法时渲染 "Invalid Date"。4 处同步时间点标签（带时刻）判定为正确不改 |
| 全局错误播报不可靠（第二十三轮） | **1 处**：`liveRegion.js` 开头就记着「`v-if` 插入的新 live region，VoiceOver 可能一个字都不播」，仓库为此造了常驻播报区却只用于路由切换；而错误提示只有 toast 上那个 `v-if` 插入的 `role="alert"`——出错恰恰是最需要被听见的时刻。已给播报器加常驻 assertive 通道、由 `globalError.js` 的错误管线触发（两条通道各用一套定时器，互不打断）、App.vue 加常驻容器、toast 去掉 `role="alert"` 并改用同源文案常量 |
| 标签页面板语义一个都没有（第二十七轮） | 10 处 `role="tablist"`、32 个 `role="tab"`，而 `role="tabpanel"` 与 `aria-controls` **都是 0**——读屏念得出「标签页 1/3」，但面板与 tab 的关联是断的；已为**面板容器已存在**的 5 组补上 `role="tabpanel"` + `aria-labelledby`，未选中即不在 DOM 的 `v-if` 面板刻意**不加** `aria-controls`（避免指向空气）|
| 深色高对比下内嵌区与卡片几乎同色（第三十六轮） | `--bg-tint(#1b2333)` 与 `--card(#1b2233)` 的通道差是 `0, -1, 0`，肉眼完全同一块 —— 而这个值是在第三十五轮把高对比修活之后**才第一次真正生效**的（此前那两块是死代码）。已把该档 tint 改成明显更深的 `#0d1320`（与卡片差 14/15/19），并新增"高对比层次差不得小于普通模式"的不变量。见 §1.50 |
| 高对比度在「跟随系统」主题下根本不生效（第三十五轮） | 「跟随系统」分支把整张调色板写成**内联变量**，而内联样式优先于任何选择器 → `style.css` 里的高对比声明被整片压掉：深色时 `--border` 停在 `#2a3248`（本该 `#64749a`）、`--muted` 停在 `#8b95a8`（本该 `#bcc7db`）。深色只能由「跟随系统 + 系统偏好深色」产生，受影响面不小；而对比度审计只读样式表，验的正是从不生效的值。已让该分支感知应用内开关与系统 `prefers-contrast: more`，并补了**运行时**守卫（见 §1.49） |
| 完全没有打印样式（第三十三轮） | 全仓 0 处 `@media print`：按 Ctrl+P 会印上深色侧栏、悬浮任务中心、装饰粒子与提示层，整块深色底吃一盒墨；更麻烦的是 `.timetable-wrap` 的 `overflow-x: auto` 在纸上会把课程表**右侧的列整块裁掉**。已补打印样式：隐藏外壳与浮层、滚动容器展开、主题令牌归零成黑白、`@page` 留白、卡片与表格行防分页 |
| 搜索面板打开后焦点被关闭按钮抢走（第三十二轮） | 面板自己在 `nextTick` 里聚焦输入框，`Modal` 打开时也自动聚焦（优先 `[autofocus]`，否则第一个可聚焦元素），两套机制抢同一个焦点，实测赢的是关闭按钮——从侧栏点开搜索也打不了字。已改为只留 Modal 的 `[autofocus]` 机制（与 `NotesView` 正文框同一写法），并删掉手动的 `nextTick` 聚焦与 `inputEl` 冗余引用 |
| 账本分区与 URL 不一致（第三十一轮） | `LedgerView` 只读 `route.query.tab`、全仓无人写它：点分区不更新地址栏，刷新/分享/书签丢分区，URL 与界面互相矛盾；已补写回（`replace` 不污染历史、默认分区不带参数、脏参数被清理、其余参数保留）。连带修掉读屏噪音：路由播报原先监听 `fullPath`，每次切分区都会再播一遍「账本 已打开」，已改为只看 `path` |
| 标签页只有 `role` 没有键盘模型（第三十轮） | 5 个 tablist 宣告了 APG 的键盘契约却没有实现：无 roving tabindex、无 ←/→、无 Home/End，键盘用户要逐个 Tab 穿过整组；新增 `useTabKeys` 并接入全部 5 处（16 个 tab），切换可被草稿守卫否决且此时不移动焦点；同时按本意放行 roving 组的 `tabindex="-1"`，但要求组内必须留有一个 Tab 停靠点 |
| 设置分区缺面板语义 / 两处控件语义不准（第二十九轮） | `TimeSettingsModal`「设置分区」是真面板切换却没有 `tabpanel`（`base` 面板还是 `<template>`，不能承载 role，换成包裹层并复制父级 flex 布局与 18px 间距）；`MemoryView`「回放时间范围」与 `SyncPairingModal`「设备绑定方式」是重塑内容/状态机却用了 tab 语义，已收敛为 `role="group"` + `:aria-pressed`。至此全站 5 个 tablist 全部是真标签页且有面板（15 tab / 15 panel）|
| 6 组筛选控件误用 tab 语义（第二十八轮） | 待办筛选、日程状态、清单分类、账本分类方向/分类视图、识别结果筛选**都没有面板**却用了 `role="tablist"`/`tab`——读屏会念「标签页 1/4」并期待方向键切换面板，等于宣告了一个不存在的交互契约；已按仓库既有写法收敛为 `role="group"` + `:aria-pressed`（`role="tab"` 32→18，`aria-pressed` 13→22）|
| `role="tablist"` 的子元素不是 `role="tab"`（第二十七轮） | `ExceptionsModal.vue` 的两个类型按钮既没有 `role="tab"` 也没有 `aria-selected`，属 ARIA 硬性违规；已补齐 `role`/`aria-selected`/`id` 并把共用表单标成面板 |
| 专注时长按钮选中态只在视觉里（第二十七轮） | 首页「专注时间」组的快捷时长与自定义时长按钮只有 `class="on"`，无任何 ARIA；已补 `:aria-pressed` |
| 侧栏主题色选中态只在视觉里（第二十六轮） | 侧栏 6 个主题按钮的选中态只有 `class="on"`，**没有任何 ARIA**——读屏用户听不出当前选的是哪个主题（WCAG 4.1.2 的名称/角色/**值**）；而**同一个功能**在 `AppearanceSettings.vue` 里是用 `:aria-pressed` 暴露的，属仓库内部不一致。已按同一写法补上；并新增可推广规则：成组可选项里用 class 标记选中却没有 ARIA 即判缺陷 |
| router-view 被套进 Transition（第二十五轮） | `App.vue` 写成 `<Transition>` 包住 `<router-view v-slot>`——**vue-router 4 明确不支持**，后果是每次切路由都打一条控制台警告，且过渡与 keep-alive 的包含关系不按作者预期生效（以为有页面切换动画）。已按官方写法改为 router-view 在外、Transition/KeepAlive 在 `v-slot` 内部；新增守卫：导航过程中不得出现 `router-view`/`transition`/`keep-alive` 框架警告。**靠"挂载外壳 + 打开真实路由"才发现，静态扫描永远看不到运行时警告** |
| 外壳另六处提示同样不可靠（第二十四轮） | **6 处**：安全模式、持久化失败、持久化恢复、自动同步状态、7 天未备份、快速记录成功 toast，全是 `v-if` 插入的新节点自带 `role="alert"/role="status"` → 已统一改由外壳里常驻播报区发声（错误 assertive、提醒/成功 polite），行内 role 全部去掉；文案集中成常量/计算属性与播报共用；顺带删掉自动同步提示里重复的嵌套三元链。**新增能挂载整个外壳的夹具 `tests/helpers/mountApp.js`**，同时解开 §4 的渲染 DOM 标题顺序与真实 Tab 顺序两项待办 |
| `<form>` 与隐含提交（第十五轮） | 全仓只有 2 个 `<form>`；唯一「无 `type` 的 `<button>`」是 `ListsView` 添加按钮，**按设计正确**（`<form @submit.prevent>` 里的唯一按钮，靠隐式提交实现回车添加） |
| 触摸目标尺寸（第十五轮） | 约定已完善：`--tap-min: 44px` 令牌 + `@media (pointer: coarse)` 统一兜底 + 明确记录在案的排除项（`.chip`/`.segmented`/`.link-btn`/`.toast-btn`「靠间距而非尺寸达成可分性」）。**没有改动**——按字体大小与 padding 推算像素高度再断言不足 44px 不可靠，不做这种结论 |
| 表格语义（第十五轮） | 3 个表格都有 `<thead>`/`<tbody>` ✓。20 个 `<th>` 补 `scope="col"`（H63，对 8 列的导入预览表有实际价值）；课程管理表的空 `<th>` 补 `aria-label="选择"`（**空 `<th>` 是真问题**：读屏会把整列念成无名表头）；农历对照表的年份列 `<td>` → `<th scope="row">`（**真改进**，WCAG 1.3.1，读屏会说「2026 春节 …」） |
| `prefers-reduced-motion` 的覆盖面（第十六轮） | **4 处 JS 平滑滚动是漏网的**（真缺陷，主观前庭敏感用户每次跳转都被拖着滚）。CSS 侧本来就很完善：全局 `* { scroll-behavior: auto !important; … }` + 每个有动画的组件各自处理（`EmptyState` 还分 `no-preference`/`reduce` 两支）+ `performanceMode.js` 统一开关。**唯独 JS 调用不受 CSS 约束**——`motion.js` 文件头早已写明这条原理，`VirtualList` 也写对了，其余 4 处没跟上。修法是让它们问 `animationsEnabled()`：`focusNavigation.scrollAndHighlight`、`WheelPicker.scrollToIndex`（4 个调用点的唯一收口）、`DataManager.jumpToSection`、`main.js` 路由 `scrollBehavior` |
| 实时区域是否真的可播报（第十七轮） | **1 处真缺陷**：作息设置的 OCR 进度与导入错误住在 `v-show` 的作息方案区里 → 切标签页等 OCR 就变成 `display:none`，进度看不到、失败与「图片质量提示」也听不到（`switchSettingsTab` 还不清理该错误）。已提到标签区之外。判据区分 `v-if`（不算，元素不存在）与 `v-show`（算，元素还在但 `display:none`），以及自身 `aria-hidden`/`hidden`（算）与自身 `v-show`（不算） |
| `aria-hidden` 与可聚焦元素的错配（第十八轮） | **实测 0 处**（26 个 `aria-hidden="true"`，无一含可聚焦元素）。这是 `rendersFocusable()` 注释点名过「那本身是另一个缺陷」却一直没人守的类别，本轮补上守卫。补的过程中发现**我自己的探测器有两条假绿**（辅助函数身份 bug 让「后代」判定恒为假；漏掉 `aria-hidden` 盖在组件自身上的常见写法），都由夹具与变异抓出 |
| 经典可精确判定项（第十八轮） | 3 个 `<img>` 全部有有意义的 `alt` ✓；正数 `tabindex` 0 处 ✓；`target="_blank"` 0 处 ✓；内联 `<svg>` 0 处 ✓；`touch-action` 在滑动组件上设置正确（`SwipeActionItem: pan-y`）✓ |
| 筛选器用 `role="tablist"`（第十八轮） | `role="tab"` 25 处、`role="tabpanel"` 0 处。其中**筛选器**（待办筛选、识别结果筛选）按 APG 更该用 `role="group"` + `aria-pressed`，且标签页模式要求只有选中项可 Tab（当前全部可 Tab，角色与焦点模型都不符）。**分析后未改**：`phase1Regression.test.js` 已锁住该写法，且该写法可辩护，属判断题——记入 §4 而非擅自推翻 |
| 恒真死条件（第十八轮） | `TimeSettingsModal.vue` 一处 `v-show="genPreview !== null \|\| true"` + `v-if="1"`，两个条件永远为真。已清掉并留注释。全仓仅此 1 处、严重度低，故**未**为它单开守卫（避免判据过拟合到单例） |
| 实时区域是否真的可播报（第十七轮） | **1 处真缺陷**：作息设置的 OCR 进度与导入错误住在 `v-show` 的作息方案区里 → 切标签页等 OCR 就变成 `display:none`，进度看不到、失败与「图片质量提示」也听不到（`switchSettingsTab` 还不清理该错误）。已提到标签区之外。判据区分 `v-if`（不算，元素不存在）与 `v-show`（算，元素还在但 `display:none`），以及自身 `aria-hidden`/`hidden`（算）与自身 `v-show`（不算） |
| 子组件导致的扫描盲区（第十七轮） | 平扫**漏掉了 `<TaskProgress>`**（`role="alert"` 在它自己的模板里，父模板只看到一个自闭合标签）。已把组件递归解析抽成共享工具复用，并写了只由递归路径能抓到的那条变异作为实证 |

## 3. 明确未做：硬约束条件下的降级或需产品决策

| 审计诉求 | 处理 | 理由 |
| --- | --- | --- |
| 离线语音识别（ASR） | 只能"禁用 + 说明" | 离线 ASR 模型体积与 `tesseract.js` 之外的依赖都超出"不新增 npm 依赖"约束 |
| 富文本笔记 | 维持轻量 Markdown | 引入编辑器依赖不可行 |
| 异步校验 | 保持同步实现但接口形状是异步的 | 便于后续替换而不改调用方 |
| 设计令牌同步 Figma | 改为本地导出 | 不引入外部服务；`node scripts/audit-contrast.mjs --tokens` 输出设计侧所需色值清单 |
| 课程表网格虚拟滚动 | 跳过 | 仅 91 格，且与现有 CSS Grid 布局冲突，收益为负 |
| 图片模糊占位 | 只加 `loading`/`decoding` 属性 | 生成占位图需要额外处理管线 |
| 面包屑 / 返回上一级 | 未做 | 路由全是**一级平级**（`/`、`/schedule`、`/tasks`、`/exams`、`/events`、`/lists`、`/bills`、`/review`、`/notes`），不存在"父级"概念；深层态其实是 `?focus=&section=&date=` 的聚焦态。先要定义层级模型，否则做出来是假的层级 |
| 侧边栏右划手势关闭 | 未做 | ≤900px 时侧边栏是**固定底栏**而不是抽屉，没有"关闭"语义；唯一浮层 `.mobile-more-sheet` 只支持按钮关闭。要支持手势需先把侧边栏改成抽屉式 |
| 确认框模板化（20 处 `window.confirm` → `ConfirmDialog`） | 未做 | `window.confirm` 是同步阻塞，`ConfirmDialog` 是异步 state 流。`DataManager` 的导入/同步流程与 `TimeSettingsModal` 的未保存保护处于状态机中段，批量替换会改变时序 |
| 多币种汇率 / 预算超支预警 / 报销分摊 / 农历生日纪念日 / 叙事 i18n / 专属周年庆动画 / 账单预设模板 | 未做 | 属**新增功能**而非缺陷修复，且都需要新的存储键与产品定义。技术路线已确认可行（新键 `sl_ledger_fx` / `sl_ledger_budget` / `sl_festive_lunar`，均不触碰既有 `sl_*` 语义，也**不接网络汇率**） |
| 标签页/分段器持久化 | 账本已做，其余未做 | 账本分区第三十一轮已落地（写回 `route.query` ✓），并**用测试证明与 `?focus=` 共存** ✓：`tests/ledgerTabUrl.test.js` 专门断言写分区不会吃掉其它 query 参数。原先"会与 `clearFocusQuery` 相互干扰"的判断 ✗ 只对**同时重建整个 query 对象**的写法成立，按"只增删自己那个键"来写就没有冲突 ✓。其余模态框内的分区（外观 5 个、本地迁移 2 个、作息设置 2 + 导入 2）仍未持久化，可沿用第三十二轮的模块级共享状态模式，但要先定"每次打开是否回到第一个分区"这一产品语义 |

## 4. 未修但已定位的问题（留给后续）

这些是本轮勘察中发现、但**不属于本轮落地范围或风险高于收益**的问题，记录在此以免丢失：

1. ~~`ScheduleView.vue` 桌面端「切换单日视图」按钮是空操作~~ —— **这条结论是错的，已核实并撤回**。`ScheduleView.vue` 的 `<style scoped>` 里确实写了 `.mobile-day-view { display: none }`，但 scoped CSS 只作用到子组件的**根节点**，而 `.mobile-day-view` 是 `ScheduleGrid.vue` 内部节点（根是 `.page`），所以那条规则从未生效，桌面端切到单日视图是正常工作的。真正的问题是：`ScheduleView.vue` 里有一份**逐字复制的子组件样式**（`.mobile-day-view` / `.day-nav` / `.mobile-course-*` / `.mobile-day-empty`，约 25 行）连同媒体查询里的两处覆盖（`.mobile-day-view{display:block}`、`.mobile-course-row{grid-template-columns:76px…}`），全部是死代码，且与 `ScheduleGrid.vue` 的活样式有细微分歧（`background: var(--card)` vs `#fff`、多一条 transition）。这是维护陷阱——在那里改样式不会有任何效果，还会让人误以为单日视图在桌面端被隐藏。**已删除，并留了一行注释说明样式归属**；删除前后渲染完全一致（死的从来没应用过）。
2. ~~`voiceInput.js` 文件头注释与运行时的网络错误提示互相矛盾~~ —— 已修：改为「无自有后端 ≠ 完全离线可用」的准确表述（见 §1.8）。
3. ~~`FocusPanel.vue` 解构了未使用的 `focusSessions`~~ —— 已删。
4. `quickRecord/entities.js` 的文本抽取启发式拒绝 `0` 金额（`amount > 0`），与账本已支持 0 的口径不一致。**这是启发式过滤器而非写入路径**，改成 `>= 0` 会引入「0」被误判为金额的假阳性，故保留。
5. ~~**标签页模式缺一半**（第十八轮勘察）~~ —— **已在第二十七～三十一轮做完** ✓：真标签页补齐 `role="tabpanel"` 与 `aria-labelledby`（不含 `aria-controls`，因为面板是 `v-if`，指向会悬空），筛选器改 `role="group"` 与 `aria-pressed`，并补了 APG 的游走式焦点模型（`src/composables/tabKeys.js`）以及「每个 `role="tab"` 都必须被某个 `tabpanel` 的 `aria-labelledby` 指到」的守卫 —— 正是那条守卫迫使第 5、6 条必须同时解决。
6. ~~**筛选器用了标签页角色**（第十八轮勘察，判断题）~~ —— **已在第二十七～三十一轮做完** ✓：待办筛选与作息识别结果筛选已改为 `role="group"` 与 `aria-pressed`（与 `LedgerView` 日期格的既定用法一致），标签页则改为只有选中项可 Tab 的游走模型，两者角色与焦点模型现在都与实现相符。原判断是对的：它确实是判断题而**不是**缺陷，需要先定产品语义再动手。
5. `ledger.js` 的 `buildLedgerFeedItems` 仍写入位置快照 `first`（视图侧已改为按真实索引判定，故不影响渲染）。**不要改它的 key 格式**——`ledgerScrollPerformance.test.js` 对 feed 投影的 key 顺序有硬断言。
6. `store/core.js` 的跨标签页策略是**有意的「后写者胜」**：另一标签页写同一键时，本标签页放弃待写入并采用对方的值。真正需要合并的场景由同步管线负责。已在代码中注明。
7. `autoSyncCoordinator` 的**租约栅栏已够用，未再改动**：`claimLeader()` 写入后立刻回读校验（`isLeader()` 检查 `ownerId` + `leaseId` + `expiresAt`），两个标签页同时看到过期租约时后写者胜、先写者回读即失格；`fencingToken` 记录在租约里用于排障。再加一层"本页见过的最大 token"只会引入新的不一致面，收益为负。
8. `mood.js` 的非标准 emoji 仍静默归为「多云」。已按设计降级处理：新增 `countsByMood` / `unknownMoods` 让调用方**可以选择**区分与提示，但 `weatherOfMood` 的返回值**必须**继续落在 sunny/cloudy/rain 三键内——它直接参与 `counts[...] += 1`，返回新值会让计数变 `NaN`。
9. **带色浅底的语义小标签仍是写死的浅色**（如 `#feecec`/`#fffaf0`/`#e7f8f1`/`#f1ebff` 等约 90 处，配写死的深色文字）。它们在两套主题下都满足 AA，只是深色主题下会呈现为「深色卡片上的一枚浅色小标签」。把它们全部改成 `color-mix(…, var(--card))` 会把刻意的彩色标签洗成中性色，属于审美决策而非缺陷修复，因此**只修**「底色写死浅、文字却跟着主题变」的那 25 处（见 §1.11）。若后续决定统一，`scripts/audit-contrast.mjs` 的判定条件可以直接复用。
10. `.skin-notebook`（牛皮纸底 + 楷体 + 写死 `#735f39`）与 `.date-tile`（淡紫底 + 写死 `#3d4ec0`）是**刻意的彩色组件**，不是漏改。它们内部文字也是写死的，所以两套主题下都读得清。
11. `.icon-btn` / `.btn.is-loading` / `input.is-invalid` / `.cvi-auto` 已按「零死钩子」原则删除（见 §1.12）。其中 `.cvi-auto` 是唯一有信息损失的：把 `content-visibility: auto` 铺到长列表本可省首屏绘制，但它会影响 `scrollIntoView` 与滚动锚定，收益需要真机实测才能判断，因此**不铺开**，等有实测数据再决定。
12. ~~**深色高对比度下 `--bg-tint` 与 `--card` 同值**~~ —— **这条结论本身是错的，第三十五轮已核实并撤回** ✗：深色的 `--card` 是 `#1b2233`、`--bg-tint` 是 `#131a29`，两者**并不同值**；而 `style.css` 里那条写着 `--bg-tint: #1b2333` 的规则**根本不生效** —— 它被 `theme.js` 的内联变量压掉了。顺这条线查出了真正的问题：**「跟随系统」主题下高对比度整体失效**（见 §1.49），**已修** ✓。
13. ~~**组件内的死 CSS 没有守卫覆盖。**~~ —— **已建（第三十七轮）**，见 §1.51。原文如下：**组件内的死 CSS 没有守卫覆盖。** `tests/styleHooks.test.js` 只检查 `style.css` 里定义的类，组件 `<style scoped>` 里的死类只能靠人看。子代理用探测器跑出 **171 个候选**，其中确实有真死代码（`ScheduleView.vue` 的 `.tt-cell` 与 `.setting-del`；`TodayView.vue` 的 `.week-strip` / `.panel-progress` —— 模板已改名 `.week-progress`）。但假阳性至少四类且规模不小：Vue 运行时添加的过渡类（约 30 个）、`:deep()` 指向子组件的类、动态拼接的类名（`` `step-${status}` ``）、以及由 prop 传入的变体类。要做成断言必须先设计例外机制，否则会变成一台误报机器；本轮**只手工清掉了 `ScheduleView` 的 `.setting-del`**，`TodayView` 的两处留着，等有例外机制再一起做。
14. ~~`--atmosphere-decor` 被 `festive.js` 写入但全仓没人读~~ —— **已删（第三十六轮）** ✓。它的写入与删除都只发生在 `festive.js` 的 `applyAtmosphere()` 里，CSS 里没有任何 `var(--atmosphere-decor)`、测试里也不提，是纯死令牌。更值得记的是**守卫为什么放它过去**：`tests/styleHooks.test.js` 的口径是"消费 = 被 `var()` 读到 **或** 被 `setProperty` 写到"，而且定义来源只扫 `style.css` 与 `theme.js`，于是 `festive.js` 那句 setter 既是"定义"又是"消费"，自己给自己背书。守卫已收紧为"凡是被写过的自定义属性都必须有 `var()` 读取点"（见 §1.50）。
15. **对比度守卫仍有已知假阴性**：真正的**跨规则**情形——「父规则给底、子规则给字」（例如 `.task-steps li { background: var(--card) }` 与 `.task-steps i { color: #a5adbc }` 是两条规则，静态判据不会把它们连起来）；`background-image`（白色渐变）；模板内联 `style="background:#fff"`（采集器只读 `<style>` 块）；`color: var(--muted)` 这类非语义文字色配近白底；以及**判定器读不到字号**，所以对 `font-size: clamp(30px,3vw,38px)` 这种大字也按正文 4.5 从严（会误报，`FocusPanel .focus-clock.overtime` 就是被误报的一个，实测 3.27:1 已达大字的 3:1 门槛）。第七轮新增的守卫关掉的是**同一条规则内**的「底是令牌、字写死」（`color:#9a651d; background:var(--card)`），跨规则那一类**第三十九轮已部分补上守卫**：把手工扫描里最可机械化、假阳性最低的第二条口径（底跟主题令牌、文字却写死）做成了 `crossRuleContrastOffenders()`，见 §1.53。**第四十轮又把剩下两类机械化了一遍**（见 §1.54）：`background-image` 渐变底（对每个十六进制色停都算，取最差的那一档）与模板静态内联 `style="background:…"`（棘轮：内联背景必须用令牌）。后者实测本仓**一处都没有**，所以按棘轮写、由合成样例自证。这两类刚一上守卫就抓到一处**真实缺陷**：`TodayView .next-state.live` 的白字压在渐变最浅色停 `#456fe8` 上只有 **4.48:1**（11.5px/750 属正文，门槛 4.5，差 0.02），三个通道各降一点到 `#446de8` → **4.57:1**，肉眼看不出来。**现在只剩一种假阴性**：`判定器读不到字号`，大字会被按正文 4.5 从严。**第四十九轮把最后这一种补上了**：判定器现在读同一条规则里声明的字号，能证明是大字的按 3:1 判（见 §1.63），`FocusPanel .focus-clock` 那种 `clamp(30px,3vw,38px)` 也在内。剩下的是**同一条规则**内的判定，跨规则那一类仍然靠 `crossRuleContrastOffenders()`；第七轮的手工扫描与逐条归因见 §1.16，整体背景见 §1.14。
16. **表单控件与可见标签没有程序化关联（已全部修完，并加了棘轮守卫）。** 项目里大量使用 `<div><label>目标日期 *</label><input …></div>` 这种写法——`<label>` 既无 `for`、也没包住控件。后果有两个：控件没有被程序化命名（读屏只念「编辑框」，`<select>` 尤其严重），以及**点击标签文字不会聚焦控件**（手机上点「目标日期」四个字没有任何反应）。用引号感知的扫描器在 `src/` 里扫出 **221 个表单控件，其中 35 个没有任何程序化关联**（另有 39 个只有 `placeholder` 兜底，浏览器确实会拿 placeholder 当名称，但它输入后即消失、对比度通常偏弱）。
    - **35 处已全部修完，现在扫描结果是 0。** 修法是「旁边真有 `<label>` 元素就绑 `id`/`for`，否则用 `aria-label`」——**绝不把控件包进 `<label>`**：那会改变 DOM 结构，而这些控件的布局靠 `.form-row label` / `.form-row input` 这类选择器撑着，包一层会让 label 变成真正的布局盒子、控件继承它的字号与颜色，必须真机验证。
    - 一个需要如实说明的**覆盖边界**：最终 35 处**全部走了 `aria-label`**，因为逐处核对后这些控件的旁边根本没有 `<label>` 元素（是 `<span>`/`<b>`/`<i>`/`<h4>` 或纯 placeholder）。所以这轮只修好了**读屏那一半**；「点标签文字聚焦控件」在这些位置仍然不成立——要修它必须把旁边的 `<span>` 改成 `<label for>`（改 DOM）或给 span 加 id 走 `aria-labelledby`（扫描器不认这一种，命中不会归零）。这是**有意的取舍，不是遗漏**。
    - 守卫：`tests/formControlNames.test.js` 是**棘轮**——全仓命中数不得超过 `BASELINE`，且存量只允许出现在 `RESIDUAL_FILES` 里；现在两者分别是 `0` 与空集。它自带引号感知的模板解析（绕开 `:disabled="a >= b"` 里那个 `>` 把标签截断的坑）与 13 条合成样例（7 条正例、6 条反例），并用「往 `SkeletonBlock.vue` 注入 2 个无名控件」验证过两条全仓断言会同时失败。
    - 相关核实（子代理报告，我抽查复核过）：全仓 **54 个静态 `id` 无重复**、**42 个静态 `for` 全部有对应 `id`**、无悬空 `for`；动态 `:id` 只有 `Modal`/`ActionSheet` 的计数器 `titleId`，多实例互不冲突。
17. ~~**`.ladder` / 一次性 UI 的其它死 CSS`~~ —— **已闭环（第三十七轮）**：新增的组件内死类守卫按 §1.51 的例外机制跑出 27 个死类、63 条规则并删除。原文如下：**`.ladder` / 一次性 UI 的其它死 CSS**：`TodayView.vue` 的 `.week-strip`（网格数字卡组）与 `.panel-progress` 已在本轮删除——模板早已改用 `.week-progress`，`week-strip` 在全文件只出现在样式块里。**但组件内死类没有守卫**（见第 13 条），同类问题很可能还有。
18. **键盘可达性：例外清单从 3 条缩到 2 条，剩余一条与一条待决策**（第九轮定位、第十二轮修订，见 §1.19 与 §1.23）。第九轮时清单有 3 条，理由都是「字符串比较认不出、但确实等价」。第十二轮回头核对，发现第一条**理由站不住**：课程格（桌面周视图）与移动端课程行确实是同一个 `openEdit`，但两者在 `v-if`/`v-else` 的**互斥分支**里——桌面根本不渲染那个 `<button>`，而 `CourseManagerModal` 又不能编辑单个课程。桌面键盘用户此前只能靠「更多设置 → 显示 → 切换单日视图」绕过去：路走得通，但主入口是关着的。已给课程块补上 role/tabindex/键击三件套，该例外随之删除。剩下 2 条：**点课表空格**是「按这一格预填日期与节次」的捷径（桌面移动端都另有「添加课程」按钮）、**点考试卡片**等价于卡片自带的「更多操作」按钮（菜单里走 `menuEdit(item)`，表达式不同所以字符串比较认不出来）。
    ~~**仍然待决策的是网格的键盘导航**~~ —— **已完成（第四十一轮）**：按条目自己写明的设计做成了 **roving tabindex + 方向键** 的网格模式。整个网格**恰好一个** Tab 停靠点，进入后用 ←→↑↓ 在格子间移动（到边**夹住**不绕回）、Home/End 到本周首尾，回车/空格与点击**等价**（都是"按这一格预填日期与节次"）。三条不变量都有渲染级守卫：`tests/scheduleGridRoving.test.js`。原来那条反向断言改成了守**新形态**（一个停靠点 + 方向键 + 容器 `role="group"`），键盘可达性例外清单也随之**从 2 条降到 1 条**（那一项被守卫的自我淘汰机制催着删掉了）。详见 §1.55。原文如下：**仍然待决策的是网格的键盘导航**：课表 `7×N` 个空格（12 节的学期周就有 84 个）目前只有「点一下预填」这一种交互，要做成键盘可达需要 roving tabindex + 方向键的网格模式——全做成 Tab 停靠点会让键盘用户按几十次 Tab 才穿得过课表，比现状更糟。这是交互设计改动而不是缺陷修复，因此保留现状、在守卫与模板注释里写明理由，并**新增一条反向断言**守住这个「刻意」（有人当漏改顺手加上 tabindex 会失败）。同样留待决策的还有**标题层级跳跃**——**这一条已在第十轮修掉**（见 §1.20）：三个页面的区块标题从 h3 改成 h2，改前已确认它们的样式都是类选择器且显式写了 `font-size`（全仓没有任何 `h1`–`h6` 选择器），两处按标签写的选择器同步改掉了。`EmptyState`/`Modal` 报出的 `h2→h4` 经核实是扫描器假阳性：那是 `v-if`/`v-else-if`/`v-else` 互斥分支，一次只渲染一个，且两者本就把层级做成了可配置 prop。

19. ~~**标题顺序的守卫仍缺，是候选而非遗漏**（第十轮）。~~ **已完成（第二十五轮）**：`tests/renderedHeadingOrder.test.js` 挂真实路由（`tests/helpers/mountApp.js`，第二十四轮建）把每页真的渲染出来，按 DOM 顺序检查标题不跳级、整个文档恰好一个 `h1`、`h1` 不得落在 `#main-content` 之外，并带页面数/标题数规模自证与两个夹具自证（跳级/缺 h1/多个 h1/首个不是 h1 的合成样例，以及 `v-show` 隐藏的可见性判断）。**第三十九轮逐条复核时它已经在了**——条目里"要给 9 个视图各搭一套 router + store 挂载环境"的成本判断，在夹具建好之后就不再成立。以下为原文：想在 CI 里锁住「标题不跳级」，准确做法是**渲染后检查 DOM 顺序**，因为按源码数标签会把互斥分支算成同时存在（`EmptyState`/`Modal` 就是这么被误报的），而对可复用组件来说正确层级本来就取决于调用方。渲染检查需要给 9 个视图各搭一套 router + store 挂载环境，成本明显高于这条问题的严重程度（层级断档不影响读屏逐级导航，只是目录少一档），因此记录为候选。本轮的实际收益来自一次性修正 + 在改动处留注释说明理由。

20. ~~**「真实 Tab 序」的守卫仍缺，是候选而非遗漏**（第十三轮）。~~ **已完成（第二十七轮）**：`tests/tabOrderAndNames.test.js` 挂着真实路由读渲染后的 Tab 序，其中一条用例的判据与条目要求逐字对应——`跳过链接是第一个 Tab 停靠点，并指向真实存在的 main`；另外还查无正数 `tabindex`、无不可聚焦链接、无可交互元素被排除、无无名控件、同一页 `id` 不重复、成组可选项的选中态不得只存在于视觉 class、渲染出来的每个 `tablist` 都要响应方向键。**第三十九轮逐条复核时它已经在了。**以下为原文：`landmarksAndRoles` 对 skip link 的排位检查已经能递归解析组件源码，因此挡住了真实发生过的回归（skip link 被埋到侧边栏之后），但它**看不透普通 `<div>` 里包的按钮**。要百分百确定「按第一下 Tab 落在哪」，唯一可靠的办法是渲染真实 DOM 再读 Tab 序——那需要给 App 搭一套 router + store 挂载环境，成本与第 19 条同量级。当前覆盖面已足以守住已知风险，判据自身的边界写在测试文件头部。

21. ~~**深色普通模式下 `--bg-tint` 与 `--bg` 只差 3**（第三十六轮实测）~~ —— **已完成（第四十二轮）**： 做了一次专门的深色配色调整（原来记的"要真改需要一次专门的深色配色调整"就是这一步）。 深色普通的 `--bg-tint` 从 `#131a29` 改成 **`#161d2c`**：与 `--bg`（`#121826`）的最大通道差 **3 → 6**， 与 `--card`（`#1b2233`）仍有 **7**，而且是各通道**均匀提亮**（读起来是"更亮的表面"而不是"更蓝的表面"）。 选值前先量了深色下所有压在 `--bg-tint` 上的文字令牌：最弱的 `--ink-faint` 仍有 **5.22:1**（≥4.5，改动前 5.39 —— 余量够）。 守卫同步收紧：`tests/highContrastPalette.test.js` 里"`--bg-tint` 对 `--bg`"的阈值从 **3 提到 4**（四档实测 4/5/6/6 全过），"对 `--card`"仍是 4。 变异验证：退回 `#131a29` → 红 2 条（含"expected 3 to be greater than or equal to 4"）；改成贴住卡片的 `#1a2132` → 也红 2 条。 详见 §1.56。以下为原文：**深色普通模式下 `--bg-tint` 与 `--bg` 只差 3**（第三十六轮实测）： `#131a29` 对 `#121826` 的最大通道差只有 3，落在页面底色上的内嵌区几乎看不出边界。 **没改**：它是既有取值、不在本轮范围内（本轮只处理"高对比下层次消失"那一条）， 而且更像审美取舍而非缺陷 —— `--bg-tint` 主要落在卡片上，与 `--card` 差 8 是清楚的。 已在 `tests/highContrastPalette.test.js` 里按现状**棘轮锁住**（≥3，不许再变糊）； 要真改，需要一次专门的深色配色调整。

23. ~~**焦点会被 sticky 面遮挡**（第四十四轮新识别，WCAG 2.4.11 Focus Not Obscured）~~ —— **已完成（第四十四轮）**： 浏览器把「被聚焦的元素」或 `scrollIntoView` 的目标滚入视野时会滚到**紧贴容器边缘**，而这个应用贴着边缘处正好有 sticky 面：弹窗内的自动保存提示（`TimeSettingsModal`，`z-index:3`，约 32px）、表格 sticky 表头（`BatchImportModal` / `CourseManagerModal`）、以及底部三条 sticky 栏（`QuickRecordPanel` 的保存栏、`LedgerView`、`TimeSettingsModal`）。`Modal.vue` 的 `keepFocusedControlVisible` 已经用 **12px** 余量判断"要不要滚"，但 `scrollIntoView({block:'nearest'})` **没有"滚多少余量"这个参数**——余量只能来自 CSS，所以那 12px 只决定"要不要滚"、不决定"滚到哪"，元素最终仍然贴边。**已修**：在 `style.css` 加全站 `scroll-margin-top: 48px / scroll-margin-bottom: 56px`，用 `:where()` 让特异性为 0（`DataManager` 的 `.data-section{scroll-margin-top:58px}` 是同一思路的先例，不会被覆盖）。并加守卫 `tests/focusObscured.test.js`。详见 §1.58。

22. **第三十七轮恢复带来的两处遗留**（我自己的事故 + 恢复方式的代价）。第一版删除器的规则区间偏移有 bug：`matchAll(/[^{}]+\{/)` 在 `@media` 之后会**继续匹配内层规则**，同一条规则被第二次以错误偏移记录，删除时把 6 个文件约 **259 条规则**切碎（构建报 `CssSyntaxError` / `Unknown word lex-start` / `Unclosed block`）。修法是单趟递归下降、并**跳过**已递归过的 body。恢复只能用「删除前的构建产物」：`dist/assets/<组件>-*.css` 是删除前编译出来的，去掉 `[data-v-*]` 属性再反压缩即可复原规则集，本轮正是靠它把 6 个文件整体恢复、并逐条比对确认最终只少了那 63 条。代价有两条要如实记：其一，这 6 个文件的样式块**注释丢失**了（编译产物里没有注释）；其二，入口分片里**合并了小组件的 CSS**（Sidebar / ScheduleGrid 等被静态引入的组件），恢复时被一并搬进宿主文件，它们带着宿主组件的 scope 属性，因此对子组件元素**不生效**、多是惰性规则或同值副本。`.skin-timeline` 那一族经比对与 `ScheduleGrid.vue` 的定义完全同值，已删除。**第三十八轮已清掉这些副本（85 条）**：判据是三个条件的**合取**——(1) 别组件文件里存在**完全同值**的规则（真属主仍定义它）；(2) 宿主自己的模板/脚本里**没有**用到选择器中的任何类；(3) 真属主自己**确实在用**这些类（说明元素在属主内部，宿主那份规则根本不匹配）。另外跳过 `:deep()` 编译出来的后代形式（剥离 scope 属性后以空格开头），保险又拦下 2 条属主未使用的。清理后规则数：App 136→111、TodayView 193→166、ScheduleView 179→152、AppearanceSettings 120→114；LedgerView / DataManager / FestiveSettings 本来就没有副本。四个被重建的样式块顶部都加了说明注释，写明原注释在恢复中丢失。安全性论证：这些类的元素要么在属主内部（宿主规则从不匹配）、要么是属主子组件根节点（宿主规则与属主规则**完全同值**，删掉不改变声明）。原本"其余疑似副本不敢删"的顾虑，指的是**非**同值的情形——子组件根节点会带父组件的 scope 属性，宿主文件里的同名规则可能是合法的（`.sidebar` 就属于这种），误删会造成视觉回归。**第五十轮的推进**：先把注释的**实质**补回来——这 6 个样式块约 1000 条规则当时只剩 7 条注释，本轮逐处核实在代码里能证明的事实后补到 16 条（层叠阶梯与跳转链接必须在最上层、vh 兜底与 dvh 孪生的理由、安全区与 viewport-fit 的配套、`.focus-clock` 的 clamp 下界为何是可证大字、`.data-section` 的 58px 对应哪个守卫、`.skin-*` 是动态拼接不能当死类、`.pending-row` 是可点击行的故意保留），并加了 `tests/styleComments.test.js` 棘轮（只准多不准少，见 §1.64）。**没写的一处**：`DataManager .health-largest` 的 `font-size:10.5px!important`——它到底在覆盖哪条规则，代码里看不出来，宁可不写也不编理由。
23. **`ScheduleView.vue` 里 `.skin-notebook` 一族有逐字相同的两份（第五十轮发现，故意未清理）。**两份都在**顶层**（花括号深度 0，无 `@media` 包裹）、五条规则声明完全相同，属于冗余重复，删掉一份不改变任何声明。**这一轮没有删**：我写的探针还报了"共 15 组完全同值重复"，但那个探针的规则切分**被证明不可信**（它把相邻规则的片段粘在一起，例如把 `.form` 的 body 切成了上一条规则的尾部）——第三十七轮的事故正是"在不可信的解析上做破坏性扫除"，所以这里只记录、不动手。要清理得先用一个可信的规则切分器复核。**第五十一轮已结案**：切分器做出来了（`scripts/css-rules.mjs`，见 §1.65），复核结果是 **19 条**（我那个坏探针说的 15 组既不准也不全）。删除时**极性一度选反**——同值重复里后出现的那份才是会赢的那份，删错边会让一对同特异性、都设 `background` 的规则顺序翻转；靠产物穷举比对定位到唯一这一对并移回原位。顺序现已写成判据（`tests/cssRules.test.js`），全仓同值重复清零。
24. ~~**存储损坏韧性矩阵没跑完（第五十二轮的欠账）。**~~ **已完成（第五十三轮），并当场抓到一处真缺陷**：`sl_timecfg` 被塞成 `{"periods":"oops"}` 时 `normalizeTimes` 在**模块求值期**抛错，应用启动即白屏——详见 **§1.67**。矩阵现为 `tests/storageCorruptionResilience.test.js` 的 36 键 × 3 变体 × 2 路由 = 174 条用例，**修之前恰好 6 条红**。以下为原文：读取路径在代码审查层面是健全的（try/catch + 浅层形状修复 + 静默上报），唯一可疑的是**嵌套形状损坏**（`normalizeStoredValue` 只做顶层合并）。第一版探针是**假绿**——store 模块在测试文件 import 时就初始化并缓存了默认值，播种进 `localStorage` 的损坏值从未被读取；两个变异都没红才暴露。第二版改成 `vi.resetModules()` 加动态 import 后矩阵跑不完（超时）。全部已知信息、正确写法与缩矩阵建议见 **`HANDOVER.md` §3.1**。

25. ~~**「靠顺序赢」的静态体检（第五十二轮记下的候选）。**~~ **已完成（第五十三轮），口径按原候选的要求定了：只报告、不判失败。**穷举扫描（同上下文、共享类名、同特异性、声明冲突）在 **54 个文件里命中 295 对**——命中数量本身就说明它不能当失败判据（`:hover`、`.isToday`、`[data-status=…]` 这些刻意共存的对都在里面）。所以 `tests/cssOrderSensitivity.test.js` 只打印汇总，**唯一的硬断言是"§1.65 那对承重顺序必须被检出"**——用来证明探测器没瞎，而不是证明代码有问题；将来要收紧，按文件里留的那行 `expect(allPairs.length).toBeLessThan(N)` 改口径即可。以下为原文：第五十一轮为比对两次产物写过一个穷举检查：同上下文、共享类名、同特异性、声明冲突、相对顺序翻转的规则对。把它用在**单份源码**上就能提前发现这类"顺序一变就换样式"的脆弱点。但注意它天然会有**大量合法命中**（例如 `.tt-cell:hover` 与 `.tt-cell.isToday` 就是刻意共存的一对），**必须先定判据口径**（比如只报"两条都设同一属性且都没有其它区分条件"的情形），否则会变成误报机器。第五十一轮已用针对性顺序判据锁住了唯一有害的那一对（`tests/cssRules.test.js`）。

26. **浮层叠放顺序完全依赖 DOM 顺序：常驻浮层会被后开的 `v-if` 浮层盖住（第五十四轮做 confirm 迁移时发现，尚未系统性修）。** body 里所有 `.overlay` 的 `z-index` 都是 **100**（`Modal.vue`），谁在上层**只由 DOM 顺序决定**；而 Teleport 的锚点在组件**挂载时**创建。于是"随页面常驻"的浮层（只有 `:open`、没有 `v-if`）会排在"打开时才建锚点"的浮层**之前**——读屏与 Escape 都认为它在最上层，眼睛看到的却是另一个窗体压着它，**用户点不到那颗按钮**，而且不报错、不进控制台。本轮 24 处确认框改造已把**症状**在迁移范围内消掉（全部写成 `v-if="target" :open="Boolean(target)"`，并有 DOM 顺序断言 + 变异实验兜底；`DataManager` 里既有的嵌套确认框本来就是这么写的，说明这个坑早被踩过）。**但没有从根上修**：建议给 `Modal` 按浮层栈深度写递增的内联 `z-index`（`overlayStack.js` 已经维护着栈），彻底消除对挂载时机的依赖。它是共享组件，会牵动 `.sheet-overlay`(110) / `.context-menu`(130) 那套固定层级与 App.vue 里的层叠阶梯注释，值得单独一轮带着 `modal.test.js` / `overlayEscape.test.js` 一起改。详见 §1.74。

27. **`App.vue` 里 19 条对内层节点永远不生效的侧边栏规则（第五十四轮量化，尚未清理）。** 它们是第三十七轮"恢复事故"的残留：CSS 被从入口分片搬回宿主文件时带着宿主的 scope 属性，因而对子组件内部节点永远不匹配。第三十八轮清掉了 85 条同类副本，但判据是"与真属主**完全同值** + 宿主没用到 + 真属主在用"的合取，**故意保守**，于是"惰性但不同值"的规则留了下来。清理它必须逐选择器判（同一区块里混着 3 条真生效的根规则，包括把侧边栏在 ≤900px 变成底栏的那条 `@media`），并建议把判据从"同值"换成"**可达性**"。同时应顺带给 `componentDeadCss` 补一条盲区：它按"类名在全仓是否出现"判死，看不见"选择器能不能到达节点"。详见 §1.73。

28. ~~**「清空 localStorage 后挂载应用」的用例，对浮层做整体断言时会和「✨ 已更新」抢时序（第五十四轮 bump 之后才暴露）。**~~ —— **已从根上修掉（第五十四轮末）** ✓。原文与第一次处置：全新 profile 下应用**会**自动弹出更新说明（正确行为），而 `UpdateNotes` 在 `App.vue` 里是 `defineAsyncComponent`——它**什么时候挂上来是一个时序问题**。于是"取消确认框之后 body 里不该剩浮层"这类**整体**断言，实际测的是"那个异步分块有没有赶上"：版本号 48→49 就把这条时序翻到了另一面，`confirmDialogMigration` 里那条断言从"靠运气绿"变成红（详见 §1.82）。第一次处置只固定了**那一个文件**的状态，并把"放进共享夹具会更彻底、但会改变所有挂载类用例的初始状态"记成了待办。

    **后来把它做完了，依据是两条实测**：① 全仓**没有任何测试**断言过更新说明浮层的存在（`✨` / `release-notes` / `release-version` 在 `tests/` 里零命中）——它此前是**零覆盖**，而不是"被覆盖且不能碰"；② 全仓**没有任何测试**枚举 localStorage 的键集合（`Object.keys(localStorage)` / `localStorage.length` 零命中），所以夹具多写一个"已读"键不会撞到谁。

    修法是**一减一加**：
    - `tests/helpers/mountApp.js` 新增 `markReleaseSeen`（默认 `true`）：夹具**默认扮演回访用户**，挂载前调用真正的 `markReleaseSeen()`（用导出函数，不手抄键名）。所有挂载类用例的浮层状态因此**确定**；要测"首次启动会弹"的用例显式传 `{ markReleaseSeen: false }`。
    - 新增 `tests/updateNotesModal.test.js`：把这个浮层**正面覆盖**起来——首次启动会弹、显示 `版本 <APP_RELEASE>` 与本轮说明第一条、点「知道了」会关闭并写 `RELEASE_SEEN_KEY`、之后不再弹，另加一条**判别力前提**（干净 profile 下 `shouldShowReleaseNotes()` 必须为真，否则"不弹"那条断言毫无意义）。
    - `confirmDialogMigration` 里那份**临时的**文件级声明保留一行（在它自己的 `localStorage.clear()` 之后显式复位），注释改为指向夹具——理由是**不依赖"夹具一定在我之后跑"这种隐含顺序**。

    **覆盖面因此变大而不是变小**：这个浮层从零覆盖变成 4 条行为判据，而 12 个依赖挂载做整体断言的文件（`appShellAnnouncements` / `routeAnnouncement` / `renderedHeadingOrder` / `tabOrderAndNames` / `landmarksAndRoles` / `backupIntegrity` / `dataManagerSync` / `dataManagerRestoreNav` / `courseTemplateDate` / `scheduleGridRoving` / `confirmDialogMigration` / `updateNotesModal`）**86 条全绿**。

    **仍然只是建议、没有强制手段的一条口径**：以后要"全新的应用状态"时用**白名单清法**（清业务键、保留已读标记），而不是 `localStorage.clear()`——后者会把"应用在全新设备上的行为"一并引进来。

29. **一条"棘轮"守卫的地基比它的判据更脆：引号状态机版 `stripComments` 会被正则字面量带偏。** 仓库里几个源码扫描类守卫共用的剥注释器是逐字符引号状态机；而 `src/views/LedgerView.vue` 的 L483 是 `return /[",\n\r]/.test(text) ? …`——**正则字面量里的 `"` 被当成字符串起点**，此后整份文件都被视为"处在字符串里"，**注释再也不会被剥掉**。方向是**假阳性**（把注释里引用的旧写法当成真命中），所以它是"吵"而不是"漏"；但它守的恰恰是"`src/` 里不许再有原生弹窗"这条棘轮，于是任何一条"为了说明这里原来是 `window.prompt(...)`"的注释都会把它顶红（本轮实测确实如此）。新写的守卫改用**逐行**剥注释（先例：`tests/modalSections.test.js` 的 `stripJsComments`）；**已有的那两个（`confirmDialogMigration` / `overlayEscape`）保持原样**，理由是方向性判断：朴素逐行剥离一旦把 `'http://…'` 里的 `//` 当成注释起点，就会偏向**假阴性**（把真代码当注释切掉）——对棘轮来说漏报比误报危险得多。**正确的修法是让那套状态机认识正则字面量，而不是换一个更弱的剥离器。** 详见 §1.87 第 3 段。
**→ 已完成（第五十四轮末补做）**：两处棘轮的剥离器已修好，并加了正反夹具。⚠ **但"直接去解析正则字面量"这个口径本身是错的**——我照它做的第一版把模板里 `</div>` 的斜杠当成了正则起点，**吞掉了 7571 个字符的真实模板代码**（假阴性，比原来的假阳性危险得多），是被一条"覆盖面下限"咬出来的。最终口径是**两条机制叠加**（正则识别里排除 `<`/`>` + 引号必须找得到配对标点 ⇒ 误判伤害锁死在单行内）。完整经过与双向证据见 §1.88。

30. **`App.vue` 里还有一条"不可达、而且即使可达也是空操作"的 scoped 规则：`:root[data-performance=reduced]`。** 它写在 `App.vue` 的 `<style scoped>`（475–790）里，选择器末段是 `:root[data-performance=reduced]` ⇒ 编译成 `:root[data-performance=reduced][data-v-…]`，而 `html` 上不会有组件作用域属性 ⇒ **永远匹配不到**（这一条**没有类**，所以本轮基于类的判据与守卫都数不到它）。`data-performance` 本身是**真功能**（`src/composables/performanceMode.js`、外观设置里的「流畅优先模式」下拉、备份键 `sl_performance_mode`），而且仓库里**已经有正确写法**：`EmptyState.vue:84` 用的是 `:global(:root[data-performance='reduced']) .es-icon`。**但我不建议按"照抄 EmptyState"去修**：这条规则的动作是给 `html` 加 `filter:none; transform:none`，而 `html` 本来就没有 filter/transform ⇒ **即便修好可达性它也是空操作**。所以真问题是"流畅优先模式到底该关掉什么"（**产品问题**），不是"修一条选择器"。两个候选动作：(a) 删掉它（零用户可见效果，只是少一条误导）；(b) 先弄清产品意图再重写成 `:global(...)` 并落到真正带 filter/blur 的元素上。附带同类：`App.vue` 与 `AppearanceSettings.vue` 里各有 2 条 `@keyframes`（`task-spin-4add0040`/`task-pill-in-4add0040`、`sheet-overlay-in-db40fa9a`/`sheet-item-in-db40fa9a`）在各自的消费者被删掉后**成了孤儿**（at-rule 不在判据内，按"判不准一律保留"留着）；另有几个空 `@media` 壳（`App.vue:555-556`、`536-538` 等）。这三样都需要一条**新的判据**（"选择器里没有类"和"at-rule 有没有消费者"）才能自动守住，本轮没做。

31. **一处"设计意图从未生效"的布局残留（本轮删除时才暴露，未改）**：`SwipeActionItem.vue` 自己的 `.swipe-content`（273–279）**没有** `height:100%`，而被删的那条死规则 `.feed-transaction-item .swipe-content{height:100%}` 要给的正是它 ⇒ `.feed-item{height:100%}`（`LedgerView.vue:1487` 的注释依赖它）的**百分比父高从第三十七轮那次复制事故起就从未生效**（62px 行高可能没被撑满）。删死规则**不改变任何运行期行为**（它本来就没生效）。若设计要求撑满，正确修法是往 `SwipeActionItem.vue` 自己的规则里补 `height:100%`——**但那是纯视觉改动、本仓库验不了布局**，所以留下来由你决定。

仓库里有若干**直接断言源码字符串或精确数值**的测试，改这些区域会立刻失败：

| 测试 | 断言内容 |
| --- | --- |
| `tests/contrastAudit.test.js` 的规模自证 | 族数 ≥400、令牌底 ≥300、写死字色 ≥8、配对 ≥6；渐变规则 ≥10、带字色的 ≥3、色停 ≥10；扫到的 SFC ≥50。归零即说明判据与实现脱节 | 内含 |
| `tests/phase1Regression.test.js` | `TasksView.vue` 含 `role="tablist"`、`:aria-selected="filter ===`、`aria-label="编辑待办"`/`"删除待办"`；`LedgerView.vue` 含 `:aria-selected="tab ===` |
| `tests/courierAbsence.test.js` | `Sidebar.vue` / `App.vue` 不含 `/快递|courier/i` |
| `tests/startupStatus.test.js` | `index.html` 的 `data-startup-step` 与 `startupStatus` 阶段一一对应 |
| `tests/virtualList.test.js` / `ledgerScrollPerformance.test.js` | `.virtual-spacer`、`[data-virtual]`、渲染行数（26 行）、监听器增删次数 |
| `tests/modalSheet.test.js` | `.sheet-toggle` 的 `aria-expanded`、`.modal.style.height` 精确值 |
| `tests/swipeActionItem.test.js` | `translate3d(-140px, 0, 0)` 与 `aria-label="编辑 牛肉面"` |
| `tests/foodRetirement.test.js` | `sl_appearance` 严格等于 `{signature:'keep me'}` → **不要往 `sl_appearance` 加字段** |
| 6 个测试文件 | `body.style.overflow` 的 `''` / `'hidden'` 字面量 |
| `tests/motion.test.js` | 只断言 JS `MOTION` 常量，**改 CSS 令牌不影响它** |

### 本轮新增的回归守卫

| 文件 | 锁住的行为 |
| --- | --- |
| `tests/contrastAudit.test.js` | 6 套调色板 × 关键文字/实底组合的 AA 比值 |（第三十三轮起，分析前先用 `stripPrintStyles()` 剥掉 `@media print` / `@page`：打印色不是主题色，它的合法性由 `tests/printStyles.test.js` 单独守；这处排除经变异验证是承重的——改成空操作会红 5 条）
| `tests/auditFixes.test.js` | 千分位金额解析、提醒时间空值默认、周重复待办的生成与幂等 |
| `tests/floatingStack.test.js` | 浮层坑位栈的attach/detach/错开与幂等 |
| `tests/liveRegion.test.js` | 播报区「先清空再写入」、连续同文播报、`clearAfter`、取消待写入 |
| `tests/dateAndAnniversary.test.js` | `timestampOf`/`createdDateKey`、回顾笔记归属日、闰日周年、死配置丢弃、对照表年份兜底、情绪聚合增量字段、索引读取器兜底 |
| `tests/syncHardening.test.js` | 跨标签页消息的版本/空间过滤、错误文本截断、自消息回灌、`syncNow` 假成功 |
| `tests/mirrorDurability.test.js` | 影子副本失败重排、退避序列（240→480→960ms）、页面隐藏/pagehide 补写 |
| `tests/loadingAffordance.test.js` | 每个异步按钮都绑了 `:aria-busy`，且只在忙碌时出现 |
| `tests/backupIntegrity.test.js` | 备份校验和对 v7+ 强制、篡改被拒、v1–v6 与应急导出仍可恢复 |
| `tests/sheetDrag.test.js`（已扩充） | 100ms 速度窗口、稀疏采样回退、甩完停住不算甩动 |
| `tests/motionTokens.test.js` | 交互声明无裸时长（90–400ms）、CSS 令牌与 JS `MOTION` 值一致、`DESIGN_TOKENS.md` 提到的 token 必须存在 |
| `tests/contrastAudit.test.js`（第三十九、四十、四十五、四十九轮再扩充） | 跨规则：底跟主题令牌、文字却写死（§1.53）；渐变底的最浅色停、模板静态内联底必须是令牌（§1.54）；聚焦指示器对 7 类相邻背景的非文本对比度（§1.59）；大字按 3:1、正文按 4.5:1 的字号门槛（§1.63）。共 43 条用例 |
| `tests/contrastAudit.test.js`（已扩充） | 同一条规则里不得出现「主题实色底 + 写死白字」、主题文字色不得配写死浅底、近白底必须用 `--card`/`--bg-tint` 令牌（第六轮由十六进制清单改为「解析色值 + 近中性 + 高亮度」判定，`#fffafa`/`rgb(255,255,255)`/`white`/`#ffffffff` 都跑不掉）、on-primary/on-danger 必须被消费；第七轮再加一条**零容忍**规则：底色是主题令牌（含 `color-mix(… var(--card))` 形式）时，写死的字色必须在浅色与深色两套下都达 4.5:1 |
| `tests/formValidationA11y.test.js` | 字段标 `aria-invalid`、`aria-describedby` 指向真实节点、焦点回到出错字段、错误在字段间正确转移 |
| `tests/formControlNames.test.js` | 棘轮式守卫：每个表单控件都必须有可访问名称（`<label for>` / 包裹式 label / `aria-label` / `aria-labelledby` / `title`），全仓命中数不得上升，存量只允许出现在已知文件里 |
| `tests/keyboardReachability.test.js` | 可点击元素必须能被键盘触发（三件套 `role`+`tabindex`+`@keydown`）；判据带一条自动豁免——同一动作表达式若已落在可聚焦元素上则不算缺陷；第四十一轮因课表网格改为 roving tabindex 又降到 **1** 条（那一项由自我淘汰机制催着删除），此前仅 **2** 条经核实的真等价例外（第十二轮从 3 条缩到 2 条：课程块那条的理由经核实站不住，已改为真修），清单有自我淘汰断言。另含两条针对具体元素的锁定断言（账本三类操作行、课表课程块），以及一条**反向**断言：课表空格刻意不进 Tab 序。第十九轮新增 `findNestedControls`：带交互角色（或原生交互元素）不得包着真实表单控件（ARIA 规范下 button/link/tab/option… 的子节点是 presentational，内层控件语义会被抹掉）；刻意不把 `listbox` 算作父级，因为它拥有 `option` 是正确结构、算进去直接假警 |
| `tests/autoSyncRegistration.test.js` | 自动同步任务的**注册幂等性**：spy `recordTaskResult` 并断言**调用次数**（不是结果条数——条数会被「id + 毫秒时间戳」的去重掩盖）。锁住「重复注册不叠加监听器」「注销函数真的停掉监听器」「注销后再注册停止器句柄不错位」，并自带一条判定力自证（手工叠一个同构监听器必须变成 2 次调用） |
| `tests/disclosureExpanded.test.js` | 原地展开/收起的控件必须带 `aria-expanded`。判据刻意只认 `X = !X` 这一个签名，因此打开弹窗（`showX = true`）与关闭（`X = false`）自动放行，零例外清单；锁住「13 处全部已说状态」，并断言扫描规模下限以防正则写坏后假绿 |
| `tests/hiddenLiveRegion.test.js` | 实时区域（`role="alert"`/`status`/`aria-live`）不得落在被隐藏的子树里。只认 `v-show` 与静态 `aria-hidden="true"`/`hidden`——`v-if` 为假时元素不存在于 DOM，不算缺陷（这个区别写进注释与夹具）。**递归进子组件**：`<TaskProgress />` 在父模板里只是自闭合标签，实时区域在它自己的模板里，平扫必漏。自身隐藏者单独处理：`aria-hidden`/`hidden` 写在区域自身上算缺陷，`v-show` 写在自身上不算 |
| `tests/reducedMotionScroll.test.js` | ①规则一（精确）：`behavior: 'smooth'` 直接赋值字面量必须在其**最内层括号表达式**内门控（`enclosingExpression()` 划范围，不是「附近几行」）；门控后的三元形态不再是「赋值字面量」，所以只在没门控时命中。②规则二（粗但零假阳性）：提到 `'smooth'` 的文件必须引用 `animationsEnabled()`——专为 `scrollToIndex(next, 'smooth')` 这种**透传**形态而设，规则一结构上看不见它。③运行时：改 `performanceMode` 后直接断言传下去的 behavior 是 `'auto'`／`'smooth'`，并锁住「降级不取消滚动本身」 |
| `tests/tableSemantics.test.js` | 三条规则：每个 `<th>` 必须有 `scope`；空 `<th>` 必须另有 `aria-label`/`labelledby`（内容可为空，名称不可为空）；有多个 `<tr>` 的表格不能没有任何 `<th>`。边界写在文件头：**「哪一列本该是 `<th>`」是语义判断，自动化不了**，判据只保证「已经是 `<th>` 的都有 `scope`」 |
| `tests/errorAnnouncement.test.js` | ①反馈消息必须可播报：错误 `role="alert"`、成功 `role="status"`。判据只认「消息类名集合」且只看静态 `class=`，内层零件 / 逐行标记 / `:class` 样式绑定天然不进判据 → **零例外清单**。②ARIA 引用不得悬空：静态值与绑定表达式里的字符串字面量逐个核对（`aria-describedby`/`labelledby`/`errormessage`/`controls`/`owns`） |
| `tests/landmarksAndRoles.test.js` | 两条规则。①要求命名的 ARIA 角色（`dialog`/`menu`/`tablist`/`listbox`/`radiogroup`/…）不得无名。刻意排除 `status`/`alert`：实时区域靠**内容**播报，收进来会造 36 个假警（守卫里写明理由并有断言钉住）。②应用必须有 skip link，且**前面不能有会截住键盘的东西**——判据递归解析组件真实源码判断「渲染出来会不会含可聚焦元素」，因此 `WallpaperLayer`（纯装饰）放行、`Sidebar`（内部十几个按钮）拦下，既不要白名单也不放过真回归。③**第二十轮新增：只有应用外壳可以声明 `main`**（`main` 标签与 `role="main"` 都算）——路由视图渲染在外壳的 `main` 内部，自己再声明一个就是嵌套 main；并自证外壳恰好有一个 `main` + 扫描规模下限，防止「没扫到」的假绿 |
| `tests/ledgerBillRowDom.test.js` | **渲染 DOM 级**（happy-dom，真实挂载 `LedgerView`）：每行都要有 `<button.bill-main>`（`tabIndex === 0`、有 `aria-label`）、它内部**没有任何真实控件**、`.b-actions` 是它的兄弟、行本身不再有 `role`/`tabindex`、名称与金额仍留在按钮内。源码扫描只能证明「模板里写了什么」，证明不了「渲染出来是什么」，而这个修复的价值恰在渲染结果上。文件头写明：`useStoredRef` 按 key 全局缓存，所以只能有一个 `it`，数据须在首次挂载前就位 |
| `tests/notFoundViewDom.test.js` | **渲染 DOM 级**（happy-dom）：复刻 App.vue 的结构（`<main id="main-content">` 里挂路由视图）后挂载真实 `NotFoundView`，断言文档里仍只有**一个** `main`，且 404 的内容/类名/`h1`/`404` 字样/返回首页真链接都在。用 `createWebHashHistory` 是按真实路由方案选的。变异实证：改回 `<main>` 时实测 `querySelectorAll('main')` 返回 **2**。这个文件同时补了一个覆盖空白——在此之前没有任何测试渲染过 404 页 |
| `tests/overlayEscape.test.js` | 自造浮层必须有 Escape 出口：类名含 `mask/overlay/sheet/backdrop/popover`（要求落在 `-`/空格/首尾的**词**边界，`damask` 不算）或角色是 `dialog/alertdialog/menu/menubar` 的，源码里必须有 Escape 处理；委托 `<Modal>`/`<ActionSheet>` 自动放行；`role="listbox"` 刻意不收（`QuickRecordPanel` 的分类选择器是内联展开）。**判据只认真实比较写法**（`===`/`==`/`!==`/`!=` 与 `case`）且剥掉 JS/HTML 注释——第一版只搜 `Escape` 这个词，变异实验（删处理器、留注释字样）当场证明它只证明「有人提过 Escape」，不证明「按键被处理」 |
| `tests/sidebarMoreSheetEscape.test.js` | **渲染 DOM 级**（happy-dom，真实挂载 `Sidebar` 并派发 keydown）：「更多功能」浮层按 Escape 要收起、焦点回到触发按钮。另含两条精度：浮层没开时无动作、焦点在别处时不抢焦点（变异 B 去掉"焦点原本在浮层里"的判断时，**只有**这条变红）。文件头记录一个测试环境知识：`v-if` + `<Transition>` 的元素在状态翻转后不会立刻从 DOM 消失，要等两次 rAF |
| `tests/courseTemplateDate.test.js` | **渲染 DOM 级**（happy-dom，真实挂载 `CourseManagerModal`；`Modal` 会 Teleport 到 body，须从 body 查）：两个非 `local` 策略时区下模板保存日期都必须等于该时区的日期，且非法 `createdAt` 不得渲染 "Invalid Date"。含两条**区分力自检**——"至少一个策略时区与设备给出不同日期"与 "`Asia/Shanghai` ≠ `UTC`"：只断言一个时区会漏掉"偷懒取 UTC 日期键"这类变异（本机设备时区 UTC+8 时二者结果恰好相同，实测第一版确实漏掉） |
| `tests/globalErrorAnnouncement.test.js` | **渲染 DOM 级 + 源码守卫**（happy-dom）：渲染错误与未捕获的 Promise 拒绝都要走常驻 assertive 通道，且**不得占用礼貌通道**（精度）；连错两次仍会播报（"先清空再写入"的意义）；两条通道互不打断（共用定时器会让礼貌播报挤掉错误播报）；`clearAnnouncement` 清两条。守卫一：`sr-only` 的实时区域不得带 `v-if`/`v-show`/`aria-hidden`/`hidden`（判据同时认 `role` 与 `aria-live`，第一版只认 role，被夹具抓出漏报）；守卫二：toast 文案必须与播报句同源，App.vue 不得出现硬编码副本 |
| `tests/highContrastPalette.test.js` | **高对比度运行时守卫**（9 条；第三十六轮加"层次不能糊在一起"两条，第四十二轮把 `--bg-tint`/`--bg` 阈值从 3 收到 4）：断言 `document.documentElement.style` 上的**真实内联值**（对比度审计只读样式表，验的正是从不生效的值）；覆盖 跟随系统×浅色/深色×应用内开关/系统偏好 四种组合、负例（没有高对比时不许强套）、具名主题必须清空内联变量（防串色）；并解析 `style.css` 四块强对比声明与运行时值逐一比对，防止同一意图写在两处后漂移。三条变异失败集合完全吻合 |（第三十六轮起共 9 条：另加"四种组合下 `--bg-tint` 必须与 `--card`/`--bg` 分得开"与"高对比的层次差不得小于普通模式"两条层次不变量；阈值 4/3 是按实测量出来的分布定的，不是拍的）
| `tests/printStyles.test.js` | **打印样式守卫**（8 条，结构守卫：媒体查询在 happy-dom 里不求值）：解析 `@media print` 块，核对隐藏清单、滚动容器展开、令牌归零 + `!important`、`@page` 留白、防分页；三道自证——选择器必须真实存在、变量必须在 `:root` 定义过（防 `var(--success)` 那种静默失效）、**绝不隐藏正文根**（防印出白纸）。八条变异全红；其中一条第一遍是**绿的**，暴露出自证的同义反复（语料包含打印块自身），修好后抓到两个分词器 bug |
| `tests/globalSearchShortcut.test.js` | **全局搜索快捷键守卫**（6 条）：按 `/` 打开面板且焦点落在搜索框（直接能打字）、连按不叠、Escape 关掉后还能重开；三道护栏各一条——输入框/文本域/contenteditable 里的斜杠不被抢、Ctrl 与 Cmd 组合不被吃、已有弹窗时不叠面板。五条变异（含三条**顺序**变异）全部按预期报红 |
| `tests/ledgerTabUrl.test.js` | **分区与 URL 双向一致守卫**（7 条）：点击/方向键切分区都要写进 URL；回到默认分区要删掉参数；深链 `?tab=review` 照旧能用；脏参数 `?tab=zzz` 被清掉并回落默认；写分区不吃掉其它 query 参数；**`replace` 而非 `push`**（用 `window.history.length` 不变守住这个决定，并用变异证明它不是空洞断言）|
| `tests/routeAnnouncement.test.js` | **路由播报守卫**（3 条）：真换页面**必须**播报；只改 query（切分区）**不许**播报；深链 `?focus=` 只播报一次。**关键设计**：`liveRegion` 是"先清空、下一拍再写入"，实测落地需 20～40ms，所以"没播报"的断言必须先擦掉上一句再等满观察窗口，并配一条**前提断言**（这一步确实改了 query），否则会在机制被拆掉时静静变绿 |
| `tests/tabKeys.test.js` | **标签页键盘模型守卫**（9 条）：`useTabKeys` 的键位映射（←/→ 环绕、Home/End、不吞无关键、单 tab 不空转）+ 焦点跟随（automatic activation）+ 方向键与 Home/End 必须 `preventDefault` + roving `tabIndexFor` + **否决权**（`select` 返回 `false` 时不动焦点、不改选中项）+ **真实渲染**的账本页分区：按 → 后选中项、焦点、`aria-selected` 与 tabpanel 一起换，roving 位置也跟着换。**边界**：模态框里的 tablist 在页面级测试中不渲染，那部分只有单元测试与静态接线规则 |
| `tests/tabPanelSemantics.test.js` | **标签页面板语义守卫**（8 条，含**键盘契约接线**：每个 tab 必须带 `tabindex`、每个 tablist 必须绑定 `@keydown`）：**零豁免的关系完整性**（每个 tab 带 `id`、每个面板带 `aria-labelledby`，静态标签下每个 tab 的 id 必须真的被某个面板引用到，并自证至少核对过 10 对引用）+ 成对规则（有 tablist ⇔ 有 tab、有 tabpanel ⇒ 有 tab）+ 收敛锁（已收敛为 group 的 **5 个文件**不得再出现 tab 语义）+ **渲染后**每个 tabpanel 的 `aria-labelledby` 必须指向当前选中的 tab，并逐一点击账本页分区 tab 验证引用跟着切换。**存量清单棘轮已于第二十九轮退役**（欠账归零）。**已知边界**：`ExceptionsModal` 的面板标签由 computed 依运行时状态决定，静态解析不到，不做假检查 |
| `tests/cssRules.test.js` | 可信 CSS 规则切分器（script 里的 `css-rules.mjs`）的判别力：`@media` 上下文、嵌套 at-rule、字符串与注释里的花括号、`@keyframes` 当叶子、偏移可 slice 回原文、不配平即中止；全仓花括号配平、同值重复清零、以及一对承重的选择器顺序。共 13 条用例 |
| `tests/styleComments.test.js` | 样式注释棘轮（第五十轮，§4 第 22 条）：第三十七轮受损的 6 个文件各自有注释下限、全仓总数下限、6 个重建过的样式块必须保留"原注释丢失"的说明。共 6 条用例 |
| `tests/referenceIntegrity.test.js` | 标签与引用完整性（第四十八轮）：静态层查 `for` / `aria-labelledby` / `aria-describedby` 的字面量引用能否解析、跨文件有没有重复 id；渲染层挂 10 条路由后查整个文档的重复 id 与指向空气的引用。共 8 条用例 |
| `tests/interactionAlternatives.test.js` | 有拖拽的文件必须写出**仍然存在**的非拖拽替代钩子（WCAG 2.5.7，候选由扫描得出，清单两向反守）；每个有组件的路由必须有唯一 `meta.title`（WCAG 2.4.2）。共 10 条用例 |
| `tests/imageCropKeyboard.test.js` | 裁切弹窗的键盘可用性：可聚焦 + 角色 + 说明、方向键平移 / Shift 收小 / Ctrl 放大、4% 下限、撞边夹紧、只认未动过的整图才播种。共 10 条用例 |
| `tests/mobileViewport.test.js` | 移动端视口与输入（第四十六轮）：尺寸类 `vh` 必须有 `dvh` 孪生（`transform` 里的 `vh` 不算尺寸，不看）；触屏设备上表单控件字号 ≥16px 的规则必须在、必须带 `!important`、必须用 `pointer: coarse` 而不是 `any-pointer`。共 16 条用例 |
| `tests/focusObscured.test.js` | 焦点与跳转目标不被 sticky 面遮挡（第四十四轮，WCAG 2.4.11）：全站 `scroll-margin` 约定必须在且必须是零特异性 `:where()`；贴边（`block:'start'/end`）的 `scrollIntoView` 必须写明余量声明在哪且那条声明仍在；遮挡面清单反向守。扫 CSS 前先剥注释 | 13 |
| `tests/touchTargetHooks.test.js` | 触控目标钩子接线（第四十三轮）：每个 `[role="button"]` 必须接 `btn`/`tap-target`（粗指针 44px 兜底的目标选择器），否则必须进 ALLOWLIST 写明理由；例外自我淘汰、约定本身必须在、`tap-target` 元素数不得下降 | 10 |
| `tests/scheduleGridRoving.test.js` | 课程表桌面网格的 roving tabindex（第四十一轮）：整个网格恰好一个 Tab 停靠点、其余 -1、每格有可访问名称；方向键移动并夹住边界、Home/End 到本周首尾；回车与点击等价（都打开添加课程表单）；点击会把停靠点挪过去 | 4 |
| `tests/tabOrderAndNames.test.js` | **渲染后 Tab 顺序与可访问名称守卫**（happy-dom，挂载外壳走真实路由的 10 个页面）：无正数 `tabindex`、无可交互元素被 `tabindex="-1"` 排除、每个可交互元素都有可访问名称、无 `a:not([href])`、跳过链接是第一个 Tab 停靠点且指向真实 `main`、同页 id 不重复；另有规则「成组可选项里的按钮不得用 class 标记选中态却没有 ARIA」（`<a>` 排除、复合类名卡前后词边界），并且**把每组每一项都点一遍**再复查选中态——另外放行 roving tabindex 组内的 `tabindex="-1"`（前提：组里必须留有一个 Tab 停靠点，整组被排除才报）、对渲染出来的每个 tablist 按一次 → 要求选中项真的换过去、`tabindex="-1"` 的报错信息带元素描述——只扫"当前状态"会漏掉"当前没被选中、绑定却写错"的那一项（第二十八轮的实际盲区）。**边界：测试无样式表，CSS 隐藏的部分看不见，故不声称验证完整真实 Tab 顺序** |
| `tests/renderedHeadingOrder.test.js` | **渲染 DOM 级 + 框架警告守卫**（happy-dom，**挂载整个 `App.vue` 并走真实路由表**）：逐个打开 10 个真实页面，检查页面内容里恰好一个 h1、它必须是第一个标题、相邻标题不得跳级（`v-show` 隐藏的面板不算）、h1 不得跑到 main 之外；含规模自证（页面数 ≥9、标题数 ≥9，防止"守卫在守空气"）；守卫：导航过程中不得出现 `router-view`/`transition`/`keep-alive` 框架警告 |
| `tests/appShellAnnouncements.test.js` | **渲染 DOM 级 + 源码守卫**（happy-dom，**挂载整个 `App.vue`**）：安全模式与持久化失败走 assertive 通道（后者须带上动态错误信息）、保存恢复走 polite、同步状态按文本播报**且内容没变的重复重算不重复播报**（精度）；守卫：外壳模板里实时区域恰好 2 处且都是 `sr-only` 常驻通道（**零例外**）；提示条文案不得在模板里留硬编码副本 |
| `tests/ariaHiddenFocusable.test.js` | `aria-hidden="true"` 的子树里不能有可聚焦元素（`aria-hidden` 移出无障碍树、但**不移出 Tab 序**，键盘用户会 Tab 进一个读屏不念的地方）。三条检测路径：自身可聚焦、静态后代可聚焦、**组件内部**可聚焦——最后一条含「`aria-hidden` 直接盖在组件自己身上」这种自闭合写法（变异实验抓出的漏网分支）。精确性：`tabindex="-1"` 不算（程序化焦点落点）、无 `href` 的 `<a>` 不算、无 `controls` 的 `audio`/`video` 不算、兄弟关系不算 |
| `tests/helpers/vueTemplate.js` | 不是守卫而是共用工具：遍历 `.vue`、剥注释与 `<style>` 取模板、按引号感知切标签，由「表单控件命名」「键盘可达性」「展开/收起状态」「地标角色命名」四条守卫共用。注意它会把标签名**小写化**（`<Sidebar` → `sidebar`），组件判定要看 `raw` 的原始大小写 |
| `tests/componentDeadCss.test.js` | 组件 `<style scoped>` 里的死类（第三十七轮新增）。判据：类名在本文件模板/脚本或全仓其它文件里都找不到，且不命中例外机制（过渡类名、动态拼接前缀；两者都按**全仓聚合**——小组件 CSS 会被合并进入口分片）。带 4 条自证：扫到的块数与类数下限、例外机制命中数下限、合成样例的该抓/不该抓、以及残余必须为零 | 4 |
| `tests/styleHooks.test.js` | `style.css` 里定义的每个工具类都必须在别处被引用（零死钩子），且 `button.tap-target` 确实被多个组件用上；第六轮扩到自定义属性：`style.css` 与 `theme.js` 声明的每个 `--*` 都必须有 `var()` 读取点或 `setProperty` 写入点（例外清单为空），且 `theme.js` 动态写入的 18 个调色板令牌都各有一个静态可查的读取点 |（第三十六轮起口径收紧：原来的"消费 = 被 `var()` 读到**或**被 `setProperty` 写到"会让一个只写不读的令牌自己给自己背书 —— `--atmosphere-decor` 就是这么活下来的；现在改为**凡是被写过的自定义属性都必须有 `var()` 读取点**，并附"至少扫到 8 个写入点"的自证）
| `tests/accessibleNames.test.js` | 5 个只含符号的按钮必须有中文 `aria-label` 与 `tap-target`；专注时长芯片要说「分钟」、月历格子要说清「几月几日」并暴露选中态；周次标签不能是 `<button>` |
| `tests/modalSheet.test.js` / `tests/sheetDrag.test.js`（已扩充） | `Modal` 真的把 `closeRatio` prop 转发给了 `sheetDrag`（同样的拖拽在默认与 0.5 阈值下结果相反）；脏阈值/越界阈值的夹取行为 |
| `tests/storageCorruptionResilience.test.js` | **存储损坏韧性矩阵**（第五十三轮，§1.67）：36 个 `sl_*` 键 × 3 类变体（非 JSON / 数组键存成字符串 / **嵌套形状损坏**）× 2 条代表路由 = 174 条。判据同时盯四件事：控制台无 `[GlobalError:…]`、无 `.global-error-toast`、无 `.global-safe-mode-alert`、`#main-content` 非空；**外加一条更重的**——模块求值期的抛出（`bootThrow`）直接判失败，因为启动崩比任何 DOM 判据都严重。每个用例必须 `vi.resetModules()` 之后动态 import，否则播种进 `localStorage` 的损坏值永远不会被读到（这就是第五十二轮那条假绿的根因）。**修之前恰好 6 条红**（`sl_timecfg` 的三个数组字段 × 2 路由），属于"先红后绿"的真守卫 |
| `tests/cssOrderSensitivity.test.js` | **「靠顺序赢」的静态体检**（第五十三轮，§4 第 25 条的口径落地）：同一上下文、共享类名、同特异性、声明冲突的规则对穷举扫描（54 个文件命中 295 对）。**刻意只报告、不判失败**——大量命中是合法的（`:hover`、`.isToday`、`[data-status=…]` 等刻意共存的对），改成硬失败就是一台误报机器。唯一的硬断言是"§1.65 那对承重顺序必须被检出"（自证探测器没瞎，而不是证明代码有问题） |
| `tests/designTokenExport.test.js` | **设计令牌导出守卫**（第五十四轮，§1.68）：守 `node scripts/audit-contrast.mjs --tokens` 这份**交付给设计侧的产物**。三条不变量而不是数字——①注释正文绝不参与令牌身份；②每个令牌的值必须能在 `src/style.css` 里**逐字找到**（复活一个已删除的令牌、或让一个真声明被"吞并"，都会违反它）；③规模自证（6 套主题、必备底色/卡片/正文），防止解析器打偏后"零令牌也算通过"。**为什么不能只数数量**：修前修后默认主题都是 40 个令牌——一个死令牌复活换掉一个活令牌被吞，数量完全相同。另带一条 `.vue` 样式块定位的三方一致性检查（原始正则 / 剥 HTML 注释 / 可信 `styleBlocksOf`），实测当前全仓一致 |
| `tests/modalSections.test.js` | **浮层分区记忆 + 静态棘轮**（第五十四轮，§1.69）：用"真实挂载 → 切分区 → **卸载** → 重新挂载"证明用户可见的那条路径（外观 5 个分区 / 本地迁移 2 个 / 作息设置 2 个），另有一条专门盯住 `TimeSettingsModal` 以 `show=true` 首次挂载抛暂时性死区崩溃这个**真缺陷**（修之前是红的）。静态棘轮守"打开时重置分区的那行不许回来"，并带两条判别力对照：改造前的写法必须被同一套扫描报红；注释里的重置写法不算命中，而**同一份未剥注释的文本会命中**——证明起作用的是"剥注释"这一步 |
| `tests/focusReturn.test.js` | **聚焦态"返回列表"**（第五十四轮，对应 §1.70 决策表"面包屑/返回上一级"行）：纯函数层断言只删 `focus`/`section` 而**保留** `tab`/`date`，并配一条"整份 query 清空"的错误实现对照；行为层真挂载断言入口随聚焦态出现/消失、点击后 URL 与按钮同时变化；静态棘轮锁住"用 `replace` 而不是 `push`"（用 `push` 会让返回键把用户弹回聚焦页）。**夹具本身出过一次真问题并已修正**：`?section=bill` 会被账本自己的 `focusBill()` 改写 `tab`，于是拿它证明"保留了 focus 以外的键"是**假的**——夹具改成 `?tab=review&focus=tx1` |
| `tests/anniversaryAnimation.test.js` | **个人周年专属动画**（第五十四轮，§1.71）：跨文件契约（从 `App.vue` 解析出 `ANNIVERSARY_KEYS`，断言 `style.css` 里每个 key 都存在 `[data-festive='<key>']` 选择器，并自带一个自证夹具证明这条契约不是空转），行为层断言金色粒子盘（含至少一种**不在**既有彩带调色板里的颜色）、全部粒子时长 `4.2s`、光环存在，外加"不是周年就不出现"的对照。**它当场抓到真缺陷**：`anniversary-start` 匹配不到 `[data-festive='anniversary']`——"使用周年"会**静默退回普通彩带** |
| `tests/narrativeI18n.test.js` | **叙事多语言**（第五十四轮，§1.72）：契约层要求 `festive.js` 能产出的**每个静态节日 key** 都有英文条目，且**英文表里不许含中日韩字符**（否则"翻译"可能只是把原文抄了一遍，条目齐全却毫无意义）；纯函数层覆盖命中 / 逐条回落 / 未知 key / 空输入 / 未知语言；行为层用**同一份夹具只改语言偏好这一个变量**做前后对照（英文→英文祝福语且无中日韩字符；中文→中文原文），外加"氛围关掉时整行不出现""生日不在今天时**绝不**显示生日祝福"两条对照——防的正是"这一行永远为真"。末段 5 条是**设置面板开关的接线判据**（§3.2 第 6 项收尾）：真挂载面板 → 把下拉改成英文 → 断言写进 `sl_ui_language`，并配一条"不碰下拉时不会写成英文"的对照；静态侧守"选项来自 `NARRATIVE_LANGUAGES` 常量"（写死两种语言的版本被同一套扫描抓住）与 `label for` / `id` 对得上 |
| `tests/lunarCalendar.test.js` | **农历核心（1900–2100 位表）**（第五十四轮，§1.76）：已知春节日期锚点 + 闰月判定 + 月长 29/30 + 越界行为。**它当场抓到一处位表真错误**：2050 年那一位写成 `0x04b63`（应为 `0x14b63`），**一个比特让 2050 全年月序错位**——这类错误在"看起来能跑"的日历实现里极难自己暴露，只有拿锚点日期去对才会现形。残留边界如实记在 §1.76：2100–2101 的交界仍有 ±1 天不确定性（沿用 stage 1 的位表口径） |
| `tests/lunarAnniversaries.test.js` | **农历纪念日的 6 种状态**（第五十四轮，§1.76）：`ok` / `no-such-leap-month` / `no-such-day` / `out-of-range` / `not-in-year` / `invalid` 各有固定的中文文案断言，且 `normalizeLunarAnniversaries` 必须**丢掉**形状不合法的行而不是把它们留在列表里。判别力重点在"**绝不静默回退成平月**"：填了"闰四月"而这年没有闰四月时，必须显示明确的不可用文案，而不是悄悄按四月算——后者会让用户以为纪念日生效了，实际日期差一个月 |
| `tests/festiveLunarAnniversaryUi.test.js` / `tests/festiveLunarAnniversaryHome.test.js` | **农历纪念日的面板与首页**（第五十四轮，§1.76）：面板侧增/改/删各一条，并断言每行要么给出**解析出的真实公历日期**、要么给出显式的不可用文案；首页侧钉住"农历纪念日复用 `anniversary` 这个氛围 key"这条**跨文件契约**（另起一个 key 会让金色星芒与光环**静默退回彩带**，正是 §1.71 那条守卫存在的理由），并带一条"没有农历纪念日时首页不受影响"的对照 |
| `tests/lunarAnniversaryStorageSource.test.js` | **内存镜像跟随存储 + 源码棘轮 + 键名漂移**（第五十四轮，§1.80）：外部写入（**直接 `localStorage.setItem`，不经过任何模块 API**，即 `restoreStoredValues` 的写法）必须被读到；外部删条目 / 外部**清空整个键** / 外部写入损坏 JSON（不抛错、退化成空而不是旧值）各一条；判别力对照把旧实现（布尔锁 + 一次性赋值）原样复刻，证明**同一份夹具在旧实现下必然读到旧值**；源码棘轮锁"补水判据必须比对 `mirroredRaw`"且"一次性布尔锁不许回来"；另有两条守**两套机制之间的键名不许漂移**（存储层用动态 `import()` 拿发布函数，键名在那里是字面量，漂移会**静默失效**）。**变异验证：退回旧判据 → 5 条红** |
| `tests/modalStackOrder.test.js` | **浮层层叠按打开顺序决定**（第五十四轮末，§4 第 26 条，§1.85）：4 条行为（栈里只有它→基础值；深度 1→**恰好** +1；**常驻浮层锚点更早但打开更晚时必须压在先开的 v-if 浮层之上**；关闭后回落、重开按当时深度重算；内联值与 JS 写的 `top/height` 共存不互相覆盖）+ 1 条**判别力元测试**（复刻改造前的常量实现，用**同一个**断言函数证明"严格大于"在旧实现下必然为假，并断言失败原因就是它）+ 4 条**从源码解析**的数值与一致性（上界 109 < `.sheet-overlay`/`.context-menu`/同步告警；下界 > 任务胶囊与抽屉；JS 常量与 `.overlay` 声明不许漂移；未入栈返回 `null`）。变异实验：把 `overlayZIndexFor` 退回常量 → **4 条行为用例红** |
| `tests/promptDialogMigration.test.js` | **原生弹窗全部退场**（第五十四轮末，§3.2 第 4 项，§1.87）：静态棘轮（`src/` 里 `window.prompt`/`alert`/`confirm` 与**裸调用**全为 0；**放行同名局部函数定义**且断言放行清单非空——否则"零命中"可能只是判据没读懂代码）+ 判别力夹具（旧写法、裸 `alert(`、`<PromptDialog>` 少 `v-if`、`@confirm` 指向已改名函数各报 1 条；**注释里的字面量剥注释后 0 命中、未剥注释的同一份文本命中**——证明牙齿来自判据、绿来自剥注释）+ 组件级行为（确认回传 trim 值；空/纯空白/取消/Escape 都只 `close` 不发 `confirm`）+ 两个页面级行为。变异：把 `renameCategory` 换回 `window.prompt` → **1 条红** |
| `tests/scopedChildReachability.test.js` | **可达性守卫**（第五十四轮末，§4 第 27 条，§1.86）：`componentDeadCss` 的盲区——它按"类名在全仓是否出现"判死，看不见"父组件写子组件**内部**类"这种**永远匹配不到节点**的规则。含**编译级证据**（scope 属性只加在选择器最后一段 ⇒ "祖先段写子组件根类"救不了它）、**规模自证**（≥50 `.vue` / ≥2000 条 scoped 选择器 / ≥40 条父子链接，防"零命中其实是没扫到"；另交叉核对 `styleBlocksOf` 并用含字面量 `<style>` 的 HTML 注释夹具防定位器被骗）、**夹具双向自证**（5 种合法写法一个都不许误报，含 `:deep()` 与"全仓找不到来源的类应判**不判定**而非非法"；并断言夹具选择器恰好 6 条，防这条自证本身是空的）、**判别力对照**（把已删的旧写法注回**真实 `App.vue` 的副本**立刻被抓，未改的那份对同一对**报 0**）、**清理边界**（三条活规则仍在、底栏规则仍包在 `max-width:900px` 里且仍有 `position:fixed`、`Sidebar.vue` 那边的等价规则不许被顺手删）、以及 157 条 / 12 对同类残留的**只准缩小的棘轮**（含"每一对都要说清为什么还在"；注意 `sheet` 同属 `ActionSheet` 与 `Modal` 的内部类，**1 条命中同时落进两对**，故"按对相加"= 158 而实测命中 = 157，守卫两个数都写死） |
| `tests/updateNotesModal.test.js` | **「✨ 已更新」浮层的正面覆盖**（第五十四轮末，§4 第 28 条的收尾）：首次启动会弹、显示 `版本 <APP_RELEASE>` 与本轮说明第一条、点「知道了」关闭并写 `RELEASE_SEEN_KEY`、之后不再弹；另有一条**判别力前提**——干净 profile 下 `shouldShowReleaseNotes()` 必须为真，否则"不弹"那条断言毫无意义。**它此前是零覆盖**（`✨`/`release-notes`/`release-version` 在 `tests/` 里零命中），却一直在污染别人的浮层断言（见 `tests/helpers/mountApp.js` 的 `markReleaseSeen` 与报告 §1.82） |
| `tests/confirmDialogMigration.test.js` | **`window.confirm` → `ConfirmDialog` 的迁移**（第五十四轮，§1.74）：行为层覆盖 5 条路径（笔记删除、日程删除、待办删除——这条是**改造前就在用**的，正好当对照、日程/待办冲突继续保存、Escape 只关最上层），静态棘轮守"`src/` 里 `window.confirm` 必须为 0 处"（只放行两个同名局部函数定义）。**覆盖面边界写在同一节**：另外 17 处只有静态判据（DataManager ×5 需要 IndexedDB、AppearanceSettings ×3 需要 canvas/Blob、LocalTransfer ×2 需要图片解码、TimeSettingsModal ×3 需要三层浮层 + 键盘路径、ScheduleView ×4 走 `defineAsyncComponent`），并点名两处**未经行为验证**的等价性（`AppearanceSettings.confirmRemoveImage()` 直写 `wallpaperConfig.value.targets[...]`；`EventsView.commitSave()` 成为唯一写路径后确认路径的失败也走 `setFormError`） |
| `tests/drawerDrag.test.js` / `tests/sidebarDrawer.test.js` | **抽屉手势与抽屉本身**（第五十四轮，§1.79）：纯函数层覆盖轴向判定（10px 阈值 + 方向锁 + 鼠标忽略）、关闭阈值（32% 宽 / 0.5px·ms 甩动）、右缘 18px 守卫的**镜像**（面板右锚后外缘就是屏幕右缘，Android 返回手势可左右任一边起手）、以及 `drawerDirectionsAgree()` 这条**方向不变量**；组件层断言两个**真实内联 style** 的位移同号、4 条关闭路径、焦点陷阱、`modalLockCount` 引用计数、`role="dialog" aria-modal` 与底栏 5 项保留。层叠值 **95** 的判据是四条合取：行为（开关时带/摘 `drawer-open`）、数值（三个上界从源码解析真数字）、**特异性严格大于**（平手即红）、归属（必须被 ≤900px 媒体查询包着）。**变异验证：出场符号写成 `-102` → 5 条红；选择器拍平成裸 `.sidebar` → 2 条红而行为断言照样绿**（后者正是"CSS 被吃掉但没人发现"只能靠源码层判据兜住的证据） |
| `tests/ledgerFx.test.js` / `tests/ledgerBudget.test.js` | **多币种与预算**（第五十四轮，§1.77）：汇率表归一化（缺项 / 非数字 / 负数 / 空币种）、**缺汇率必须返回 `null` 而不是 1**、单跳折算的方向性、`updatedAt` 的打点；预算三档边界（恰在 80% 上算 `near`）、非法输入的中文报错（0 / 负数 / 三位小数）、清空预算后回到 `none`。**判别力重点**：`summaryInBase` 与既有 `monthStats.total` 在**没有外币**时必须逐分相等——否则"新口径"会悄悄改掉老数字 |
| `tests/ledgerTemplates.test.js` / `tests/ledgerSplit.test.js` | **账单模板与报销分摊**（第五十四轮，§1.77）：模板白名单（多余字段被丢弃）、**`nextDate` 与 `id` 不许进模板**（否则同一个模板在不同月份套出被污染的日期）、按 id 覆盖=改而不是新增、深拷贝（改模板不能顺带改已存账单）；分摊侧按分等分余数精确（100 分 / 3 人不得多出或少掉 1 分）、`mine ≤ total`、份额与人数不一致必须报错、`hasSplit`/`mySpendCents` 对**没有分摊字段的旧记录**必须返回"无分摊"而不是 0 |
| `tests/ledgerFeaturesRegression.test.js` / `tests/ledgerFeaturesDom.test.js` | **"既有口径一行没改"的回归证据**（第五十四轮，§1.77，本节最重要的一条）：同一批记录跑两遍——一遍只有旧字段、一遍在**完全相同**的记录上多加 `currency`/`split`——逐项比较 `buildLedgerIndex` 的 `sortedExpenses`/`monthStats`/`dayTotals`/`monthCategories`/`frequentEntries`、`summarizeLedgerTransactions`、`buildLedgerMonthReview`、`filterLedgerTransactions`，全部**逐字相等**；并带一条**自证**：两批记录的 JSON 确实不同（否则"相等"毫无意义）。记录形状锁死为改造前那 18 个键且 `'currency' in tx === false`。DOM 侧反向证据：缺汇率的记录**不**进新的折算行，但既有「本月花费」卡片仍按原值显示 |

新增守卫都做过**注入验证**（不是为了凑数而写的空断言）：`styleHooks` 用改名 `atmo-layer`、注入 `--zz-dead-token` 验证；`motionTokens` 用写回 `0.25s ease` 验证；`contrastAudit` 用三类阳性对照与六个近白探针验证；`closeRatio` 那条用摘掉转发验证；`audit:contrast` 用把 `--success` 调成过亮值验证（立刻报 10 组失败）；第七轮那条「主题令牌底 + 写死字色」守卫用**往 `style.css` 注入 `.zz-mutation-probe { color: #9a651d; background: var(--card); }`** 验证——测试立刻报出 `#9a651d on --card（深色 #1b2233）= 3.21:1`，还原后 12 条全绿且无 `.bak` 残留；`formControlNames` 用**往 `SkeletonBlock.vue` 注入 2 个无名称控件**验证，两条全仓断言同时失败。该守卫自带一条合成样例测试（该抓的 3 类必抓、不该抓的 3 类必放过），所以它不会退化成空断言；`keyboardReachability` 用**拆掉 `.cd-row` 的 role/tabindex/aria-label** 验证——立刻精确报出 `views/LedgerView.vue → openDetail(e.id)`，还原后 12 条全绿、无 `.bak` 残留，它同样自带 7 条夹具（含「属性值里的 `>` 不得骗过引号感知」）与扫描规模下限断言。第十二轮又对课表课程块做了一次（摘掉三件套 → 2 条失败，精确报出 `components/schedule/ScheduleGrid.vue <div …> → openEdit(c)`，还原后 14 条全绿）；它现在还带一条**反向**断言，锁住「课表空格刻意不进 Tab 序」这个有意为之——防的是后人当漏改顺手加上。

`autoSyncRegistration` 的注入验证走了两步，第二步才是对的，两步都留着：撤掉 `stopPreviousWatch?.()` 后
**4 条全部失败**（1 vs 3 次、2 vs 8 次调用），还原后 4 条全绿、无 `.bak` 残留。而它**第一版判据是无效的**——
写成「真实 sleep 跨毫秒边界 + 断言结果条数为 1」，同样的变异下**仍然 12/12 通过**（叠出的监听器在同一微任务批次里
刷新，多落在同一毫秒被去重掩盖）。这条记在这里的原因很实际：**一条对目标缺陷没有检测力的守卫等于没有守卫**，
而且它自己还会变成新的偶发源。凡是新守卫都要先做变异实验，确认它在缺陷回归时真的会红。

`disclosureExpanded` 同样走了注入验证：摘掉 `TodayView` 那处的 `aria-expanded` → **2 条失败**，
其中一条精确报出 `views\TodayView.vue → showInbox = !showInbox`，还原后 13 条全绿、无 `.bak` 残留。
它的 8 条夹具里特意包含两条**精度**测试（属性值里的 `>` 不得骗过引号感知；`showFilters = !filtersActive`
这种「赋成别的东西的取反」必须放行），因为这条判据的价值就在窄——放宽一点就会开始报假警。

`landmarksAndRoles` 做了**三个**变异，每个都精准报红：摘掉 `ContextMenu` 的菜单名称 → 1 条失败；
把 skip link 挪到 `<Sidebar />` 之后 → 2 条失败，并报出「前面还有 Sidebar（内部有可聚焦控件）」；
删掉 `<main>` 的 `tabindex="-1"` → 1 条失败。**第二个变异正是这条守卫返工的起因**：
它的前一版对这次挪动完全无感（见 §1.24 第四段），是变异实验把假绿揪出来的。

`errorAnnouncement` 同样做了三个变异，每个都精准报红：摘掉 `ListsView` 一处 `role="alert"` → 1 条失败；
把 `TasksView` 的成功提示改成 `role="alert"` → 1 条失败并报「误用了 alert」；
把 `aria-describedby` 指向 `course-editor-errorTYPO` → 1 条失败并报「找不到该 id」。
这条守卫**自身也被夹具抓到过缺陷**：早期版本把 `:aria-labelledby="titleId"` 里的**变量名当成了 id**
而报假悬空，是夹具里「写变量应跳过」那条用例挡下来的（见 §1.25 第五段）。

`tableSemantics` 的三个变异也都精准报红：摘掉 `BatchImportModal` 一个 `scope="col"` → 1 条失败；
课程管理表的空 `<th>` 去掉 `aria-label` → 1 条失败；农历对照表的年份列改回 `<td>` → 1 条失败
（第 3 条验证的是「行表头确实存在」，防判据只认 `col`、`row` 写法悄悄失效）。

## 6. 新增 npm 脚本

```json
"audit:contrast": "node scripts/audit-contrast.mjs"
```

不新增任何 npm 依赖、不接入任何外部网络服务、不改变既有 `sl_*` 键语义与 hash 路由方案。

新增的 `sl_high_contrast` 是本轮唯一的**新存储键**，走 `useStoredRef('sl_*')` 既有通道：`cloudSyncData.js` 只校验已知键列表，新键不会破坏它的校验；`dataVault.js` 的 `managedKey` 会对所有 `sl_*` 做影子备份。既有的 `sl_appearance` 结构未被改动（有测试断言它整对象保持原样）。
