# 应用外壳与通用组件 UI 审计

审计范围：`src/App.vue`、`src/main.js`、`src/style.css`、`index.html`、`src/components/{Sidebar,Modal,ActionSheet,ConfirmDialog,PromptDialog,ContextMenu,SearchPanel,Toast,WheelPicker,TimeWheelSheet,WallpaperLayer,FocusPanel,FocusReturn,NoticeUnderstanding,NoticePaste,RouteFallback,NotFoundView}.vue`、`src/composables/{overlayStack,drawerDrag,sheetDrag,menuPlacement,floatingStack,liveRegion,globalError,startup*,routeState,focusNavigation,focusReturn,theme,motion,performanceMode,contrast,tabKeys}.js`。
本轮为**只读**审计，未修改 `src/` 与 `tests/` 下任何文件。

## 结论摘要

- 外壳骨架是成立的：唯一 `main`、skip link 在 Tab 首位且为最上层（301）、路由器用官方 `router-view` + 内层 `Transition`/`KeepAlive` 写法、滚动位置由 `beforeEach` + `scrollBehavior` 双通道还原、浮层层叠由打开顺序决定并会在关闭时回落、五处外壳提示的发声统一走常驻 live region 且文案与视觉同源。这些都能从源码逐条对上，未见反例。
- **P1 一条**：五条外壳告警条（安全模式 / 本机保存 / 保存已恢复 / 同步 / 备份提醒）共用同一个 `top: calc(12px + env(safe-area-inset-top))` 与 `left:50%`，彼此**没有任何互斥、排队或垂直堆叠**；`z-index:240` 的同步告警在任何一条 `z-index:241` 告警出现时会被整条压住（连「重试同步」「打开数据管理」都点不到）。占位元素 `.global-alert-reserve` 也只有一个固定高度，不随告警条数量增长。
- **P2 四条**：① 底部任务胶囊是四个底部浮层里唯一没接 `floatingStack` 的，与 Toast/快速记录/全局错误的 `bottom` 档完全相同；② 右键菜单刻意不锁滚动，而全局快捷键的守卫只认 `body.modalOpen`／`overflow:hidden`，于是菜单打开时 `1-9` 会在菜单底下换页、`/` 会在菜单底下叠出搜索面板（此时 Escape 只关搜索面板，菜单仍留在最上面）；③ `@media print` 的隐藏清单漏了 6 类 `position:fixed` 浮层，理由与它自己写下的一致（「浮层是 fixed，印出来会叠在正文上」）；④ 全仓没有任何 `popstate`/`pushState` 集成，浏览器后退永远不会关闭浮层，只会在浮层底下换页。
- **P3 三条**：`index.html` 的启动占位 `min-height:100vh` 没有 dvh 孪生（判据只扫 `src/**/*.{vue,css}`，扫不到 `.html`）；被 `KeepAlive` 停用的页面里的 `Toast` 没有 `onDeactivated`，坑位会一直被占（最长 6s）把别的提示顶高 56px；跳转链接的 i18n 脚手架是死代码（`data-i18n` 承载的是译文而非键名、`currentLang` 恒为 `zh-CN`、`skip.toMain` 无消费者）。
- 刻意设计、**不算缺陷**的若干处已逐条核对：层叠阶梯数值与 110/130/95 不参与 Modal 阶梯、`ActionSheet`/`ContextMenu` 的层级、抽屉右划方向不变量、`contrast.js` 走不到的 `data-contrast='normal'` 分支（`theme.js:138-140` 已写明是刻意保留）、App.vue 里不可达的 `:root[data-performance=reduced]` 与孤儿 `@keyframes`（UX_AUDIT_176_REPORT §4 第 30 条已登记）。
- **截图证据受限（重要）**：`D:\study-life\ui-audit\shots\` 在我核查期间被并发运行的审计进程清空并重跑（`audit-ui.mjs` 的 mtime 从 13:46 起被改动，目录里同时出现了 `dm-audit.mjs`、`probe-core.mjs`）。我实际看到的三张（`desktop-today.png`、`tablet-today.png`、`phone-today.png`）**都盖着「✨已更新」弹窗**（那一批 `SEED` 里 `study_life_seen_release` 写的是 `'x'`，而 `vite.config.js:36` 的 `globalThis.__STUDY_LIFE_RELEASE__` 是构建期替换、页面里读不到，抑制失效），因此只能用于「弹窗居中/窄屏变底部抽屉/遮罩覆盖侧栏」这类事实，不能用于判断页面内容。下文结论以源码为准。

## 问题清单

### [P1] 五条外壳告警条共用同一个固定位置且互不排队，低层级那条被整条盖住

- 位置：`src/App.vue:769-771`、`src/App.vue:788-790`（两条 CSS）、`src/App.vue:537-577`（五处 `v-if`）、`src/App.vue:161-166`、`src/App.vue:842-844`
- 现象：`localSafeMode`、`persistenceState.status === 'error'`、`'recovered'`、`autoSyncNotice`、`showBackupNudge` 五者可以同时为真，模板也确实是五个**互不相干**的 `v-if`。它们全部是 `position: fixed` + `top: calc(12px + env(safe-area-inset-top))` + `left: 50%` + `transform: translate(-50%)`，即精确同点。同步告警的层级是 240，其余三条是 241，于是「安全模式 / 本机保存出错 / 备份提醒」中的任何一条都会把同步告警（连同它的「重试同步」「打开数据管理」按钮）压住；同为 241 的那几条之间则由 DOM 顺序决定胜负（备份提醒 `:571` > 已恢复 `:552` > 保存出错 `:544` > 安全模式 `:537`），也就是**安全模式提示会被备份提醒或保存出错提示吃掉**。`.global-alert-reserve` 只留一个固定高度（`54px` / ≤900px `72px` / ≤760px `124px`），不随告警条数量变化。
- 证据：
  - `src/App.vue:769-771`
    ```css
    .global-sync-alert {
      top:calc(12px + env(safe-area-inset-top));
      z-index:240;
    ```
  - `src/App.vue:788-790`
    ```css
    .global-safe-mode-alert,.global-persistence-alert {
      top:calc(12px + env(safe-area-inset-top));
      z-index:241;
    ```
  - 两条的宽度上限：同步告警 `max-width:min(620px,100vw - 28px)`（`:773`），另外两条 `max-width:min(760px,100vw - 28px)`（`:792`）。宽度都是 `fit-content` 夹在上限内，安全模式那条的正文（48 字）明显长于同步那条，桌面端安全模式条更宽 ⇒ 620px 的同步条被**整条**覆盖；≤760px 时两条都被夹到 `100vw - 28px`，水平中心相同，重叠区域是整条正文与按钮。
  - 五处 `v-if` 之间没有任何仲裁：`src/App.vue:537`、`544`、`552`、`555`、`571`；`hasGlobalAlert`（`:161-166`）只被 `:514` 的占位元素使用，不参与显示互斥。
  - 触发场景（都不需要异常环境）：本机保存写入失败（配额）时同时命中「7 天未备份提醒」（`:434-443` 在挂载 6s 后置位）；或安全模式下同时 `accountSyncStatus === 'offline'`（`:144`）⇒ 同步条与安全模式条同时存在。
- 建议修法：把这五条渲染进**一个**固定在顶部的容器（`display:flex; flex-direction:column; gap:8px`），层级统一由容器给（`z-index:241`），内部不再各自 `position:fixed`；占位高度改为从容器实测高度写 CSS 变量（或在容器上用 `ResizeObserver`），不要再用三个写死的档位。**不要**靠调整 240/241 这几个数值解决——`tests/modalStackOrder.test.js:391-400` 会从源码解析它们。

### [P2] 底部任务胶囊是唯一没接 `floatingStack` 的底部浮层，与其它三个同处一档

- 位置：`src/components/TaskCenter.vue:159-164`、`src/components/TaskCenter.vue:162`（注释）、`src/composables/floatingStack.js:62-67`、`src/App.vue:845-848`、`src/App.vue:886-889`、`src/components/Toast.vue:96-102`
- 现象：`.task-pill` 的移动端 `bottom` 与 `.toast` / `.quick-record-toast` / `.global-error-toast` **完全相同**（`calc(86px + env(safe-area-inset-bottom))`），但它既没有 `--stack-offset`，也不调用 `attachFloatingSlot`。三者同时出现时，胶囊（`z-index:90`）会被 Toast（200）、快速记录提示（250）、全局错误提示（300）盖住一部分——而它是个按钮（`TaskCenter.vue:93-103`），被盖住的那部分点不到。TaskCenter 自己的注释写的是「与 Toast/快速记录/全局错误同一底栏避让高度」，说明作者的本意就是让它们共存，但对齐的只是高度、没接同一套坑位栈。
- 证据：
  - `src/components/TaskCenter.vue:161-164`
    ```css
    right: max(16px, env(safe-area-inset-right, 0px));
    /* 移动端与 Toast/快速记录/全局错误同一底栏避让高度 86px（原先 76px 与其它浮层差 10px）。 */
    bottom: calc(86px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    ```
  - `src/components/Toast.vue:101`：`bottom: calc(18px + env(safe-area-inset-bottom) + var(--stack-offset, 0px));`，`z-index:200`（`:102`）；≤900px 改为 86px（`Toast.vue:195-199`）。
  - `src/App.vue:847`（快速记录 250）与 `src/App.vue:888`（全局错误 300）同样是 `calc(18px + … + var(--stack-offset,0px))`，≤900px 走 86px（`:882-885`、`:901-904`）。
  - `grep floatingStack src/` 只有 `App.vue:36` 与 `Toast.vue:3` 两个消费者。
  - 几何：Toast 是 `left:50%` + `translateX(-50%)` 的收缩宽度、上限 `min(560px, 100vw-32px)`（`Toast.vue:107`），胶囊是右锚、上限 `calc(100vw-32px)`（`TaskCenter.vue:168`）。两者在 `vw < T + 2P + 32` 时水平重叠（T=Toast 宽、P=胶囊宽）：带撤销按钮的长消息（T≈560）配「N 个后台任务进行中」这类胶囊（P≈200）时，**990px 以下都会重叠**，900px 档还共用同一个 bottom 值。
- 建议修法：让 `TaskCenter.vue` 也 `createFloatingSlot()` + `useFloatingOffset()`，在胶囊显示期间 `attachFloatingSlot`（`attention && !open` 时），或把胶囊一起交给一个「底部浮层容器」统一排版。

### [P2] 右键菜单打开期间全局快捷键仍然生效（守卫只认滚动锁）

- 位置：`src/App.vue:374`、`src/App.vue:380`、`src/components/ContextMenu.vue:9-12`、`src/components/ContextMenu.vue:66-79`
- 现象：`App.vue` 的全局 keydown 用 `document.body.style.overflow === 'hidden' || document.body.dataset.modalOpen === 'true'` 当「有浮层打开中」的判据，这两个标记只由 `createScrollLock()` 写（`overlayStack.js:98-124`）。`Modal`、`ActionSheet`、手机抽屉都锁滚动，**只有 `ContextMenu` 刻意不锁**（并在注释里写明「这里不锁页面滚动——上下文菜单跟着触点走，滚动会直接关掉它」）。于是菜单打开时该守卫形同不存在：按 `1-9` 会 `router.push` 在菜单底下换页（菜单只在页面真的发生滚动时才会被 `window scroll` 捕获监听关掉，滚回同一位置时不会），按 `/` 会 `openSearch()` 叠出搜索面板——而搜索面板是 Modal（内联 z-index ≤109），比菜单的 `z-index:130` 低，**菜单仍画在最上面**，此时 Escape 由浮层栈判定只关搜索面板（`overlayStack.isTopOverlay`），视觉与 Escape 认定的「最上层」不是同一个。
- 证据：
  - `src/App.vue:372-384`
    ```js
    const el = document.activeElement
    if (isTypingTarget(el)) return
    if (document.body.style.overflow === 'hidden' || document.body.dataset.modalOpen === 'true') return
    if (event.key === '/' && !searchOpen.value) {
      event.preventDefault()
      openSearch()
      return
    }
    const index = Number(event.key)
    if (index >= 1 && index <= routeOrder.length) router.push(routeOrder[index - 1])
    ```
  - `src/components/ContextMenu.vue:9-12`：「与 Modal、ActionSheet 共用浮层栈，所以 Escape 先关菜单再关弹窗。**这里不锁页面滚动**」；`activate()`（`:66-79`）里只有 `pushOverlay` + `keydown`/`pointerdown`/`scroll`/`resize`/`blur` 监听，没有 `createScrollLock`。
  - 仓库对这个守卫的**意图**写得很清楚：`tests/globalSearchShortcut.test.js:13`「已经有弹窗打开时不能再叠一个搜索面板」、`:126-141` 就是用 Ctrl+K 打开的 Modal 来守住这条。
- 建议修法：判据改成浮层栈的**真实状态**（例如 `overlayCount() > 0`，`overlayStack.js:84-86` 已导出），而不是 `body` 上的滚动锁标记；或让 `ContextMenu` 也参与同一套「有浮层」标记（但不要给它加滚动锁，那会改变它「滚动即关闭」的既有手感和相关测试口径）。

### [P2] `@media print` 的隐藏清单漏了 6 类 `position:fixed` 浮层

- 位置：`src/style.css:866-879`（清单）、`src/components/ActionSheet.vue:161-164`、`src/components/ContextMenu.vue:156-158`、`src/App.vue:845-862`、`src/App.vue:886-900`、`src/components/Sidebar.vue:925`、`src/components/Sidebar.vue:939-961`
- 现象：清单只隐藏 `.atmo-layer / .sidebar / .task-center / .overlay / .toast / .skip-to-content / .global-safe-mode-alert / .global-persistence-alert / .global-sync-alert`。同一份注释给的理由（`src/style.css:867-868`「浮层（`.overlay`）是 `position: fixed`，印出来会叠在正文上」）对下面这些同样成立，但它们不在清单里：`.sheet-overlay`(110)、`.context-menu`(130)、`.quick-record-toast`(250)、`.global-error-toast`(300)、`.mobile-more-sheet`(31) 与 `.mobile-more-backdrop`(30)。打印时若其中任意一个正处于打开状态，它会以 fixed 覆盖在被打印的正文上。另外，打印渲染用的视口宽度通常是纸张宽度（A4≈794px），多数浏览器下会命中 `@media (max-width: 900px)` 那一档，所以手机抽屉那两条在打印时同样可能是「活的」——这一点我未实测，属推断（做法本身不依赖它成立）。
- 证据：
  - `src/style.css:869-879`（清单全文，逐条对比即可看出上述 6 个类都不在）
  - `src/components/ActionSheet.vue:161-164`：`.sheet-overlay { position: fixed; inset: 0; z-index: 110; … }`
  - `src/components/ContextMenu.vue:156-158`：`.context-menu { position: fixed; z-index: 130; … }`
  - `src/App.vue:861`（`.quick-record-toast{…position:fixed…}`）、`src/App.vue:899`（`.global-error-toast{…position:fixed…}`）
  - `src/components/Sidebar.vue:925`：`.mobile-more-backdrop { position: fixed; inset: 0; z-index: 30; … }`；`:940-944`：`.mobile-more-sheet { position: fixed; top:0; bottom:0; right:0; z-index:31; … }`
  - 之所以一直没被发现：`tests/printStyles.test.js:138-154` 的断言是**写死的 9 个选择器**清单，不在这 9 个里的浮层不会被要求隐藏。
- 建议修法：把上述 6 个类补进 `src/style.css:869-879` 的隐藏清单（并在 `tests/printStyles.test.js:140-152` 的断言列表里一并补上，避免下次又被漏掉）。

### [P2] 浏览器后退不会关闭任何浮层，只会在浮层底下换页

- 位置：`src/composables/overlayStack.js:63-74`、`src/App.vue:523-529`、`src/components/Modal.vue:268-276`
- 现象：浮层栈是纯内存数组，入栈/出栈都不写历史记录；全仓 `grep 'popstate|pushState|history\.|hashchange'` 的 4 处命中里，唯一与浏览器历史有关的是 `accountAuth.js:204` 的 `replaceState`（邮箱回调清理，与浮层无关），另外 3 处（`releaseNotes.js:34/50/52`）是那个文件里一个名叫 `history` 的**局部数组**（版本列表），不存在任何 `popstate`/`hashchange` 监听。因此浮层打开时按浏览器后退：URL（hash）变化 → 路由在**浮层底下**换页 → 浮层照旧开着。对**外壳级**浮层这三条后果是确定的，因为它们的宿主不在 `router-view` 里、不会随路由卸载：`UpdateNotes`（`App.vue:578`）、`QuickRecordPanel`（`App.vue:579-585`）、手机「更多功能」抽屉（`Sidebar.vue:485-510`）。抽屉这条最直观：按后退后底栏的 `active` 项变了、背后的页面变了，抽屉还开着（它的 item 列表仍是「更多功能」），而用户预期的「后退＝退出抽屉」没有发生；`Escape`（`Sidebar.vue:188-197`）、遮罩（`:482`）、`×`（`:499`）、右划（`:323-352`）四条路径都正常，唯独后退没有对应处理。
- 证据：
  - `src/composables/overlayStack.js:63-74`：`pushOverlay` 只做 `stack.push(entry)` + 版本号 +1；`removeOverlay` 只做 `splice`。没有任何 history 交互。
  - `grep -n "popstate|pushState|history\.|hashchange" src/` → 4 处：`src/composables/accountAuth.js:204`（`window.history.replaceState`，邮箱回调 URL 清理）与 `src/composables/releaseNotes.js:34/50/52`（局部变量 `history`，版本列表）。`popstate` 零命中。
  - 关闭路径只有四条，全部写在组件里：`Modal.vue:270-274`（Escape，且只在栈顶）、`Modal.vue:336`（遮罩 `@click.self`）、`Modal.vue:368`（`×`）、`Sidebar.vue:249-254`（抽屉的主动关闭）。
- 建议修法：要么在浮层打开时 `history.pushState` 一个哨兵并在 `popstate` 里关掉栈顶（同时处理「关闭按钮」路径的 `history.back()` 以免多压一条历史），要么在产品层面明确「后退＝换页、浮层不参与历史」并写进注释。注意 `createWebHashHistory`（`main.js:182`）下后退本来就是 `hashchange`，两条路都可以走，但需要确认不会与 `focusReturn` 的 `router.replace`（`FocusReturn.vue:25-28`）抢历史记录。

### [P3] `index.html` 的启动占位没有 `dvh` 孪生，而判据扫不到 `.html`

- 位置：`index.html:47`、对照 `src/style.css:686-695`、`tests/mobileViewport.test.js:104-111`
- 现象：`.startup-loading,.startup-error{…min-height:100vh…}` 只有 `vh`；同一个类在 `src/style.css:686-690` 有 `min-height:100vh` + `min-height:100dvh` 的正确写法。手机上地址栏可见时 100vh 大于真实可见高度，于是这段 `align-content:center` 的启动占位比可见区更高、内容整体偏低约 5%，并且启动期间可以多滚一小段。守卫抓不到是因为 `mobileViewport.test.js` 的 `walk()` 只遍历 `src` 下的 `*.vue` / `*.css`。
- 证据：
  - `index.html:47`（内联样式，`min-height:100vh`，同一条里没有 `dvh`；该文件里 `grep dvh` 零命中）
  - `src/style.css:689-690`：`min-height: 100vh;` / `min-height: 100dvh;`（同名类的正确版本）
  - `tests/mobileViewport.test.js:104-110`：`walk()` 只收 `\.(vue|css)$`，根是 `src`
- 建议修法：在 `index.html` 的那条内联声明里补一行 `min-height:100dvh`（老浏览器忽略它），并把判据的扫描根扩到仓库根的 `index.html`。

### [P3] 被 `KeepAlive` 停用的页面里的 `Toast` 仍占着坑位

- 位置：`src/components/Toast.vue:39-54`、`src/components/Toast.vue:67-72`、`src/composables/floatingStack.js:62-67`
- 现象：`Toast` 只在 `props.open` 变化与 `onBeforeUnmount` 时 `attach/detachFloatingSlot`，**没有 `onActivated`/`onDeactivated`**。而它所在的五个页面（`TasksView`/`LedgerView`/`ListsView`/`ScheduleView`/`ExamsView`）都在 `App.vue:475-478` 的 `KeepAlive :include` 里：切页时组件只是被停用，`onBeforeUnmount` 不触发，坑位会一直被占，直到那条 toast 自己的定时器把它关掉（实测最长 `duration: 6000`，见 `TasksView.vue:419`/`434`、`ListsView.vue:265`/`274`/`287`、`ExamsView.vue:360`/`376`）。占位期间其它页面新弹出的 Toast 会被 `useFloatingOffset` 无辜顶高 56px。
- 证据：
  - `Toast.vue:67-72`：只有 `watch(props.open)` 与 `onBeforeUnmount(hide)`，没有 `onActivated/onDeactivated`（对比 `FocusPanel.vue:416-428` 是处理过的正确写法）。
  - `floatingStack.js:63-67`：`slots.value.indexOf(id)` 决定偏移，坑位与「是否可见」无关。
- 建议修法：照 `FocusPanel.vue:416-428` 的既有约定加 `onDeactivated(hide)` / `onActivated(重新 show)`，或让 `useFloatingOffset` 跳过不可见坑位。

### [P3] 跳转链接的 i18n 脚手架是死代码，且 `data-i18n` 承载的是译文

- 位置：`src/App.vue:479-488`、`src/App.vue:505`
- 现象：`i18n` 表里只有两个键，`'skip.toMain'`（英文）没有任何消费者；`currentLang` 是 `ref('zh-CN')` 且全仓（`grep currentLang src/` 只有 `App.vue:484`）从未被写入，所以语言分支是假的。`:data-i18n="t('skip.toContent')"` 把**译文**（「跳到主内容」）写进 `data-i18n`，而不是键名——任何按 `data-i18n` 提取词条的脚本都拿不到原文串。
- 证据：`src/App.vue:480-488`；`src/App.vue:505`
  ```html
  <a class="skip-to-content" href="#main-content" :data-i18n="t('skip.toContent')">{{ t('skip.toContent') }}</a>
  ```
- 建议修法：三选一——删掉 `currentLang`/`'skip.toMain'` 只留字面量；或把 `data-i18n` 改成键名 `data-i18n="skip.toContent"`；或明确留作脚手架并加注释说明 `currentLang` 是占位。属吹毛求疵，不影响任何用户可见行为。

## 待确认（未能证实）

1. **五条告警条重叠的真机复现**。我证到的是 CSS 决定的几何与层级（同 `top`、同水平中心、240 vs 241、宽度上限 620 vs 760），以及五处 `v-if` 之间没有仲裁。要把「用户看到的是哪一条」做成截图，需要一次受控渲染：把 `localSafeMode` 置真（`enableLocalSafeMode()`）、把 `persistenceState.status` 置 `'error'`、并让 `showBackupNudge` 为真。这三者都是模块级 ref，页面控制台够不到，需要在测试环境（`tests/helpers/mountApp.js` 已有挂载整个外壳的能力）里推状态后截图。本轮并发的截图批次里**没有任何告警态场景**，所以这一条目前只有源码证据。
2. **后退后焦点是否真的丢到 `body`**。`Modal.vue:305-307` 的还原条件是 `entry.previousFocus?.isConnected`，而旧页面被 `KeepAlive` 停用后会从文档里摘除，理论上焦点还原会落空、焦点掉到 `body`；但这依赖 Vue 对「Teleport 内容 + 组件停用」的真实处理顺序，需要真机（非 happy-dom）验证：打开一个页面级 Modal → 按后退 → 看 `document.activeElement`。
3. **被停用的 `Toast` 是否还留在 `body` 里可见**。坑位占用已证实（见 P3）；`Toast` 是 `position:fixed` 且直接写在页面的模板里（不是 Teleport），`KeepAlive` 停用时它的 DOM 是被移入隐藏容器还是留在 `body`，需要真机确认。若留在 `body`，问题会从「顶高别的提示」升级为「旧页面的提示浮在新页面上」。
4. **窄屏下 `.global-alert-reserve` 的高度是否够用**。`54/72/124px` 三个档位看起来是按单条告警标定的；`persistenceState.message` 是动态文案，≤520px 时若折行到 3 行，安全模式条可能超过 124px 从而压到正文。需要一条长 `message` 的实测（量 `getBoundingClientRect().height` 与正文首行的位置）。
5. **`Ctrl+K` 在输入框内仍然打开快速记录面板**（`App.vue:364-368` 位于「可编辑元素」守卫之前）。从注释看这是刻意的全局入口，但「在笔记正文里按 Ctrl+K 会不会打断输入」属于产品取舍，我没有依据判定为缺陷，故不列入问题清单。

## 已核查确认无问题

- **外壳结构**：`App.vue:505` skip link 是模板里第一个可聚焦元素（`tabindex` 竞品都在它之后），`:742-757` 平时 `translateY(-120%)`、聚焦才浮现，`z-index:301` 高于全局错误提示的 300（理由写在 `:700-706`）；`tests/tabOrderAndNames.test.js:103`、`tests/landmarksAndRoles.test.js:63/124` 各有守卫。`App.vue:513` 的 `<main id="main-content" tabindex="-1">` 是本文档唯一的 `main`；`NotFoundView.vue:2-6` 明确用 `div` 而不是嵌套 `main`，理由写在注释里。
- **页面切换与 KeepAlive/滚动**：`App.vue:523-529` 是 vue-router 4 官方写法（`router-view` 在外、`Transition`/`KeepAlive` 在内），`:525` 的 `:include` 与 `router/routes.js:18-29` 的 `ROUTE_COMPONENT_NAMES` 逐字对应；`main.js:186-203` 的 `scrollBehavior` 先吃 `savedPosition`、再吃 `recallScroll`，`beforeEach` 在导航生效前记录旧位置（`viewScrollMemory.js:24-36` 对 `< 24px` 不记忆，避免「粘住列表」）——逻辑自洽，未发现丢位置或多记一条历史的路径。
- **浮层通用契约**：`Modal.vue` 提供焦点陷阱（`trapTabKey`，`:275`）、只在栈顶响应 Escape（`:269`）、引用计数滚动锁（`:287`/`:299` + `overlayStack.js:98-124`）、打开时聚焦 `[autofocus]`（`:90-95` + `overlayStack.js:147-149`）、关闭时按「栈里还有谁」决定焦点去向（`:300-308`）、`role="dialog"` + `aria-modal="true"` + `aria-labelledby`（`:341-345`）、窄屏 ≤520px 变底部抽屉并支持两档吸附与键盘 `展开/收起` 等价入口（`:208-212`、`:361-367`）、`visualViewport` 几何用 rAF 合并（`:226-233`）且卸载时撤掉排队帧（`:256-261`）。`ConfirmDialog`/`PromptDialog`/`SearchPanel`/`TimeWheelSheet`/`TaskCenter` 全部**复用** `Modal` 而不是各写一套遮罩，未发现分叉。
- **ActionSheet / ContextMenu**：与 Modal 共用浮层栈与 Escape 语义（`ActionSheet.vue:51-59`、`ContextMenu.vue:50-58`），`role="dialog"`/`role="menu"` 都有可访问名称（`ContextMenu.vue:128-129` 用 `aria-labelledby`，未传 title 时退化为 `aria-label="操作菜单"`），层叠 110/130 与阶梯一致（`tests/modalStackOrder.test.js:391-400` 有数值守卫）；菜单的关闭路径覆盖遮罩外 `pointerdown`（捕获阶段）、`scroll`/`resize`/`blur`（`ContextMenu.vue:74-77`），并在 `:131` 用 `visibility:hidden` 遮住「测尺寸那一帧」。
- **两条底部 toast 的堆叠**：快速记录提示与全局错误提示各占一个坑位（`App.vue:65-68`），`--stack-offset` 分别为 0 与 56px，层级 250/300，**不会互相压盖**；快速记录提示自身 `pointer-events:none` + 按钮 `auto`（`App.vue:854`、`:866`），不会挡住下面的东西。两条 toast 都没有行内 `role`，发声统一走 `App.vue:615/620` 的常驻 polite/assertive 通道，且监听的是**消息文本**而不是布尔值（`App.vue:101-114`，注释里写了「连记两笔时布尔值不变、第二笔会丢播报」），`tests/appShellAnnouncements.test.js:132-142` 守着「外壳里只剩两条常驻播报通道」。
- **Toast 与底部导航不重叠**：≤900px 时 `.toast` 的 `bottom` 是 86px + 安全区（`Toast.vue:197`），底栏由 CSS 推得的高度是 `6 + 54 + 6 = 66px` + 安全区（`Sidebar.vue:867-869` 的内边距 + `:900` 的 `min-height:54px`），两者相差 20px；正文的 `padding-bottom` 同为 86px 档（`App.vue:834`、`:840`），注释里也写明两处刻意对齐。（我看到的手机截图里底栏被「已更新」弹窗整条盖住，所以这条是源码推算，不是量出来的像素。）
- **安全区与 dvh 兜底**：底部横条与抽屉都带 `env(safe-area-inset-*)`（`App.vue:661`、`:834`、`:840`、`Modal.vue:445/449/525/531`、`Sidebar.vue:867-869/952`、`ActionSheet.vue:168`），顶部告警也带 `safe-area-inset-top`（`App.vue:770`、`:789`）；`vh` 与 `dvh` 孪生在 `src/**` 内零缺漏（`tests/mobileViewport.test.js:176-188` 全仓扫描），`index.html` 那处是唯一的例外（见 P3）。
- **触控目标**：全局约定是 `@media (pointer: coarse)` 下 `.btn` / `button.tap-target` / `[role="button"].tap-target` 至少 44px 高（`style.css:394-401`），`tests/touchTargetHooks.test.js:170-215` 守着「每个 `role="button"` 都接了钩子」并有规模棘轮；`Modal` 的 `×`、三条外壳提示的关闭键、Toast 的关闭键都带 `tap-target`（`Modal.vue:368`、`App.vue:548/575/608`、`Toast.vue:90`）。`.theme-dot`（18×18，`Sidebar.vue:832-835`）没有接 tap-target，但相邻圆心距 25px ≥ WCAG 2.5.8 的 24px 间距例外，且它只在 ≥901px 出现（`:857-882` 里 `.theme-row` 在窄屏整体 `display:none`），故不作为问题上报（UX_AUDIT_176_REPORT 第 159/161 行也把这类「只补移动端命中区」的取舍写明为有意为之）。
- **WheelPicker 的可访问名称与键盘**：`role="listbox"` + `tabindex="0"`（`WheelPicker.vue:113-119`）配 `role="option"`/`aria-selected`（`:123-131`），方向键与 Home/End 有实现（`:83-95`），没有 `aria-activedescendant`；但它的唯一调用方 `TimeWheelSheet.vue:64` 有一个 `role="status" aria-live="polite"` 的大字号预览（`:95-102`），键盘拨动时选中的时间会被播报，缺 `aria-activedescendant` 的实际影响被兜住了（`grep WheelPicker src/` 只有 TimeWheelSheet 一处调用）。
- **`contrast.js` 走不到的 `data-contrast='normal'`**：`applyHighContrast`（`contrast.js:17-27`）只会传 `'high'` 或 `'auto'`，`AppearanceSettings.vue:17-19` 也只写布尔值，所以 CSS 里 `:not([data-contrast='normal'])` 的分支永远不生效。这不是漏改——`theme.js:138-140` 明确写着「那是三态语义，改动它会动到既有的 `sl_high_contrast` 键语义，故不在此处理」，属刻意保留。
- **`App.vue` 里那两条已知的不可达/孤儿规则**：`:684-699` 的 `task-spin-*`/`task-pill-in-*` 孤儿 `@keyframes` 与 `:726-728` 的 `:root[data-performance=reduced]`（编译后带 `[data-v-…]`，永远匹配不到 `html`）都在 `docs/archive/UX_AUDIT_176_REPORT.md` §4 第 30 条登记过，且报告已论证「即使修好可达性也是空操作」，故不重复上报。
- **RouteFallback / NotFoundView**：加载态有 `aria-live`、错误态是 assertive 且有「重新加载」出口（`RouteFallback.vue:12-16`，守卫 `tests/routeFallback.test.js:14-29`）；`NotFoundView.vue:6-11` 用 `h1` + 单个出口链接，样式里 `min-height` 也写了 `dvh` 孪生（`:15`）。
- **FocusReturn / focusReturn.js**：只用 `?focus`/`?section` 驱动，`queryWithoutFocus`（`focusReturn.js:31-35`）刻意保留 `tab`/`date`，用 `replace` 而不是 `push`（`FocusReturn.vue:20-28`），`tests/focusReturn.test.js` 有专项守卫。
- **FocusPanel / NoticeUnderstanding 的浮层与生命周期**：两者都复用 `Modal`（`FocusPanel.vue:538/548/561`、`NoticeUnderstanding.vue:448`，后者用 `:title-level="2"` 让弹窗标题与内部 `h3` 分区不倒挂）；`NoticeUnderstanding` 在关闭与卸载时都会 `stopVoice(true)` + `cancelOcr()`（`:73-90`），`FocusPanel` 的 500ms ticker 与 `visibilitychange/focus/pageshow` 监听在 `onBeforeUnmount` 与 `onDeactivated` 双路径清理（`:361-428`）——`KeepAlive` 下的定时器泄漏这一档这两处都处理对了。
- **`SyncPanel`/`DataManager` 等更大组件的浮层**：未在本次范围内逐行审计（不在给定文件清单内）。

### 截图核对记录

- `desktop-today.png`（1440×900）、`tablet-today.png`（1024×768）、`phone-today.png`（390×844）：三张都盖着「✨已更新」弹窗。可确证的渲染事实有：① 桌面/平板下弹窗居中、遮罩 `rgba(30,40,70,.35)` 覆盖整个视口（含左侧栏）；② 390px 下弹窗按 `Modal.vue:510-521` 的规则贴底、上圆角；③ 1024px（>901px）仍是桌面左栏而不是底部导航，与 `Sidebar.vue:857`/`:982` 的断点一致；④ 三张都没有横向溢出。
- 这三张之外的路由/弹窗截图在我核查期间被并发进程清空重跑，未能查看；`modal-*.png` 场景（账号/更新/外观/数据管理/搜索/快速记录设置/专注设置）本轮未取得可引用的成品，故本报告的弹窗结论全部来自源码与既有测试。

### 与既有测试口径的对照（确认本轮结论不在守卫覆盖内）

- `tests/modalStackOrder.test.js:391-400`、`tests/sidebarDrawer.test.js`、`tests/drawerDrag.test.js`、`tests/overlayEscape.test.js`、`tests/modalSheet.test.js`、`tests/mobileViewport.test.js`、`tests/styleHooks.test.js`、`tests/accessibleNames.test.js`、`tests/printStyles.test.js`、`tests/globalSearchShortcut.test.js` 均已读过；`grep 'global-safe-mode-alert|global-persistence-alert|global-sync-alert|global-alert-reserve' tests/` 的 14 处命中里**没有**任何一条断言多条告警条之间的可见性或层级仲裁，也没有断言任务胶囊与 Toast 的相对位置、或浮层与浏览器后退的关系——本轮 P1/P2 均落在守卫之外的真空区，不是「守卫没跑」造成的。