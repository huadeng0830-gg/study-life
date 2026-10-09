# 交互体验与操作反馈审计

审计日期：2026-10-09。范围：Vue 应用的全部页面、弹窗、设置、共享控件及业务事件；启动恢复界面和系统通知入口另外列出。只修改本地源码，测试使用独立浏览器档案与虚构数据。

## 审计结果与实施范围

建立了共享 ActionButton、ActionFeedback 和生命周期管理。重要且留在当前界面的保存可以完整收缩；频繁保存快速反馈；导航、选择和展开即时响应；关闭表单的保存立即进入下一步；危险操作保留原来的确认和撤销；长任务继续使用现有任务面板。

复用现有主题、Modal、ConfirmDialog、Toast、useToastQueue、TaskProgress、taskProgress、liveRegion 与持久化接口。没有引入动效库或第二套全局消息 Provider。工作区有其他任务同时修改学习、清单和账本功能；这些修改保留，完整工作区的测试与构建包含它们，不能把所有变化归因于反馈系统。

下方清单通过 Vue 模板 AST 扫描原生按钮、链接、表单、输入、共享按钮及 click/submit/change/confirm/save/import/retry 等事件。循环模板按定义列出；共享组件内部控件与父组件的业务绑定各自列出，因此数量不是实际屏幕按钮数，也不是去重后的业务数量。分类依据入口行为及调用函数，重点人工核对保存、危险操作和长任务；动态文案与组合事件保留原表达式供复查。

## 分类与反馈策略

| 类别 | 项目中的典型操作 | 实施方式与理由 |
| --- | --- | --- |
| A 重要 | 导航布局正式保存、账号提交、创建项目/邀约、导入确认、正式提交交付版本 | 导航保存采用完整三阶段。账号和协作表单保留真实表单结果、后续页面或邮件说明；保存即关闭的场景使用 external 模式，避免为了动画延迟下一步。 |
| B 高频 | 作息保存、励志文字保存、资料更新、草稿保存、复制、刷新、已读 | 留在编辑器中的明确保存采用短成功反馈；作息与文字等待持久化。已有局部提示或撤销的操作保留外部结果通道。 |
| C 即时 | 所有页面导航、标签、筛选、排序、折叠、开关、选择、打开编辑器/文件选择器 | 保留原生响应及现有状态颜色，只统一按压、背景过渡和 focus；无伪加载，无通用绿色成功。 |
| D 危险 | 删除课程/待办/日程/清单/账目、退出账号、恢复外观、删除壁纸、停用链接 | 保留确认、取消和原有数据恢复/撤销路径。打开确认框本身不显示加载动画；实际写入由原业务入口负责。 |
| E 长任务 | AI 通知/作息解析、OCR 图片识课、CSV/ICS 读取、图片压缩、上传、同步、备份恢复、共同空闲查询 | 使用真实阶段、文件预览、TaskProgress、当前任务文字和适用的取消/重试。按钮忙碌态是辅助信息；不替代持续任务状态，不制造百分比。 |

### 原有问题与修复

| 问题 | 影响 | 本次处理 |
| --- | --- | --- |
| 各按钮各自拼装忙碌文案与 spinner | 宽度变化、状态不一致 | 独立共享状态机、固定外部占位，原生 spinner 改为绝对定位。 |
| 原生 disabled 会让正在处理的聚焦按钮失焦 | 键盘操作退回页面 | 共享按钮以 aria-disabled 与同步入口锁保护提交，真实禁用状态保留原生 disabled。 |
| 设置保存只更新内存即提示成功 | 无法证明已经保存 | 作息与文字保存等待现有 restoreStoredValues 完成本地存储与 IndexedDB 镜像。失败保留草稿并显示实际原因。 |
| 文件读取在关闭后仍返回 | 旧预览覆盖新会话、状态回填 | CSV、ICS、裁剪、壁纸上传、通知权限等待加入会话代次、AbortSignal 与关闭/卸载清理。 |
| 读取中的壁纸目标可以改变 | 可能保存到错误目标 | 点击时快照目标；处理期间阻止切换；等待后检查会话仍有效。 |
| 任务区域的 aria-live 包含秒级计时 | 重复播报干扰操作 | TaskProgress 仅对状态与处理阶段播报，持续计时不反复通知。 |
| hover 抬升与普通反馈强制等待 | 视觉跳动、操作显慢 | 普通按钮取消 hover 位移，按压克制；高频操作无 1.2 秒最低等待。 |
| 快速成功时旧文字和成功文字交叠 | 瞬间杂乱 | 短反馈直接隐藏原文案，保留测量占位，切换可读语义底色。 |

## 组件、状态机与接入约定

| 实现位置 | 职责 |
| --- | --- |
| [ActionButton.vue](../src/components/ActionButton.vue) | 单一 button 根节点、布局占位、圆形表面、SVG 对勾、忙碌/焦点/禁用、错误重试、既有 aria/name/form 属性。 |
| [actionFeedback.js](../src/composables/actionFeedback.js) | 有限状态机、同步防重、真实 Promise 结果、视觉计时、取消、超时选项、代次与作用域清理。 |
| [ActionFeedback.vue](../src/components/ActionFeedback.vue) | 可换行的错误/状态文字、明确重试入口；支持由已有播报设施负责公告。 |
| [latestTask.js](../src/composables/latestTask.js) | 文件读取及编辑会话的取消/过期结果过滤；解除父 AbortSignal 监听。 |
| [appearanceFeedback.js](../src/composables/appearanceFeedback.js) | 文字的真实持久化保存；保存期间新输入不会被旧结果覆盖。 |
| [timePlanDraft.js](../src/composables/timePlanDraft.js) | 保留原校验与同步调用兼容接口，增加等待持久化的保存入口。 |
| [asyncTask.js](../src/composables/asyncTask.js) | 继续复用 raceWithControls，仅补充准确的类型契约。 |
| [style.css](../src/style.css)、[action-feedback.css](../src/styles/action-feedback.css)、[DESIGN_TOKENS.md](../DESIGN_TOKENS.md) | 复用 42px / 触屏 44px、高度/圆角/主题与统一时序令牌；原生控件的基础按压和真实忙碌状态。 |

状态流：idle → pressed → collapsing → loading → success/error → restoring → idle。高频、即时、长任务和 external 模式跳过不适用的阶段。即时交互继续使用原生按钮；不把所有 onClick 包成同一动画。

真实异步操作传入 action 函数，并返回完成后的 Promise；校验未通过或无操作返回 false，取消返回 {cancelled:true}；失败抛出真实错误。已完成的写入若对应旧草稿可返回 {feedback:false}：保留真实成功结果，跳过不适用于新草稿的成功动画；文字会明确提示新输入尚未保存，作息继续保持草稿 dirty 状态。Vue emit 不会返回父监听器的 Promise，所以原生表单和父组件负责的 import/confirm 保留原 emit/submit，使用 external 与实际 busy 绑定。错误由既有输入/任务区负责时设 show-error=false，避免再增加一条提示。

组件卸载会清理定时器并终止等待；KeepAlive 停用会取消视觉反馈。取消不能撤回已经发出的不可中止写入，业务回调必须用 signal 或其现有 generation 检查异步后的界面更新。没有为协作 API、账号服务或数据库增加新的写入语义。

## 重要交互时序

| 时点 / 阶段 | 行为 |
| --- | --- |
| 点击当下 | 先设同步提交锁，再调用业务函数；轻按反馈立即发生，文字在 150ms 内淡出。 |
| 0–120ms | pressed；不等待动画才发请求。 |
| 120–420ms | 300ms ease-in-out 收缩，外部 button 宽高、中心与邻居占位不变。 |
| 420ms 起 | 居中 spinner；实际操作没有完成就一直处理。 |
| max(真实成功时间, 点击后 1200ms) | 确认真实成功后转 #16A34A，白色 SVG 对勾在 300ms 绘制。 |
| 成功后 1000ms | 开始恢复。 |
| 恢复 300ms | 展开并恢复原文案、色彩与形状；不重复调用业务。 |
| 真实失败 | 立即给出实际错误；错误图标及语义红色，不显示对勾；短暂视觉恢复后错误文字和重试仍可用。 |

高频操作只有实际等待才保持忙碌，无强制最短时间；真实成功的短状态保持 650ms，新一次保存可以覆盖旧视觉状态。没有修改的新作息点击“完成”直接关闭，不展示虚假的保存成功。动画 Promise 不延迟业务返回、正常跳转或弹窗关闭。

## 全局反馈规则

局部编辑使用同一区域的保存/错误状态；明确且停留原界面的提交可以使用按钮成功；跨页面结果、下载与可撤销结果复用既有 Toast；需要决定时保留对话框；长任务继续保留任务面板；表单校验错误靠近输入并关联 aria-describedby。一个操作选择一个主要结果通道。

external 模式不生成成功对勾、成功 Toast 或第二条读屏消息。预期错误由原业务区负责，未捕获的业务异常继续交给原全局错误边界，避免包装按钮吞掉异常；裁剪等使用共享错误区的入口复用常驻错误播报。导航编辑器保留“保存在本机，登录后可随账号同步”等持久化说明，这与按钮同属局部保存区，不宣称云端已经同步完成。共享按钮的本地结果复用应用外壳的常驻 liveRegion，隐藏的设置标签不创建隐藏 live region 或播报后台结果。

## 修改文件

本次新增：ActionButton.vue、ActionFeedback.vue、actionFeedback.js、latestTask.js、appearanceFeedback.js、styles/action-feedback.css；scripts/audit/interactions.mjs 与 scripts/audit/interaction-browser.mjs；tests/actionFeedback.test.js、tests/interactionLifetime.test.js、tests/appearanceFeedback.test.js、tests/actionButtonErrorBoundary.test.js；本审计文档。

本次接入/修正：src/App.vue；components/AccountPanel.vue、account/AccountPasswordForm.vue、AppearanceSettings.vue、DomainCsvImportButton.vue、IcsImportButton.vue、FocusSettings.vue、MemoryView.vue、NavigationSettings.vue、QuickRecordPanel.vue、TaskCenter.vue、TaskProgress.vue、data/AccountSyncPanel.vue、data/AppUpdateSection.vue、schedule/ImageCropModal.vue、schedule/TimeSettingsModal.vue；views/ProjectsView.vue、TogetherView.vue、ledger-panels/QuickEntryModal.vue；composables/timePlanDraft.js、asyncTask.js；style.css、DESIGN_TOKENS.md；tests/loadingAffordance.test.js、navigationEditorInteraction.test.js、quickRecordConcurrency.test.js、quickRecordExperience.test.js。README/release.config 的本次说明与源码签名在构建时同步，并保留同期说明。

FocusPanel.vue 的 scoped 样式原样移到 components/focus-panel.css，沿用项目已有的外部 scoped CSS 模式，解决同期功能增加后的文件行数门禁；模板及业务逻辑保留。其它学习、清单、账本与发布配置修改属于同期工作，不覆盖它们的业务实现，也没有用恢复整个文件的方式抹去未提交内容。

## 验证与性能

<!-- INTERACTION_VERIFICATION:START -->

最终验证（2026-10-09，本地源码；无生产写入）：

| 检查 | 实际结果 |
| --- | --- |
| 全量 Vitest 回归 | 261 个文件、2485 项通过，0 失败；最后的反馈复位修正另由下方关键契约回归验证。 |
| 最终关键契约回归 | 53 项通过，含状态机、真实持久化失败/重试、草稿保留、CSV 重复确认及文件会话清理、文件体积门禁。 |
| 独立 Chromium 真交互 | 141 项通过、0 失败；66 组目标页面布局；0 个异常（含 Vue 捕获后 console.error）。 |
| lint / typecheck | 通过。 |
| checkJs 类型债务棘轮 | 通过；最近一次统计 2914 → 2778，未提高基线；该数字包含整个同期工作区。 |
| 对比度 / 焦点指示器 | 144 组主题配色通过 AA；6 个主题 × 7 类焦点背景共 42 组通过。白色成功对勾另外按非文本 3:1 标准核对。 |
| 生产构建 | 通过；仅生成本地 dist，未部署。 |
| README 更新说明 / Pages 配置 / diff 空白检查 | 通过；现有发布说明保留并补充操作反馈说明。 |

| 性能指标 | 修改前快照 | 当前工作区 | 解释 |
| --- | --- | --- | --- |
| Vite 构建时间 | 957ms | 1.02s | 单次本机构建，有环境波动；不等同于页面运行性能。 |
| JS + CSS 产物 | 2622.26 KiB | 2725.91 KiB | 整包净增 103.65 KiB，含同期学习、清单与账本改动。 |
| JS + CSS gzip 累计 | 846.96 KiB | 879.86 KiB | 按逐文件 gzip 计算；净增 32.90 KiB。 |
| PWA 预缓存 | 158 entries (1952.04 KiB) | 167 entries (2055.61 KiB) | 沿用现有缓存策略；没有新增供应商依赖。 |

共享按钮产物的实际体积（不代表所有新增模块之和）：

| 产物 | 原始体积 | gzip |
| --- | --- | --- |
| ActionButton-BCgl8JBs.js | 8.06 KiB | 3.49 KiB |
| ActionButton-D_ZfyjQ7.css | 5.63 KiB | 1.35 KiB |

原生 busy CSS 通过样式导入编入构建，未新增生产网络 API。重要操作的模拟真实请求在 1.2 秒后仍未完成时持续 loading，成功仅在真实写入后出现；高频即时成功没有强制等待。布局稳定是浏览器几何验证结果，没有宣称已经测得真实设备 CLS/LCP/INP。

测试命令：npm test；npm run lint；npm run typecheck；npm run typecheck:ratchet；npm run audit:contrast；npm run build。浏览器复验先运行 npm run dev -- --host 127.0.0.1 --port 5176 --strictPort，再运行 node scripts/audit/interaction-browser.mjs。清单更新运行 node scripts/audit/interactions.mjs .vitest-tmp/interaction-inventory.json --markdown docs/INTERACTION_UX_AUDIT.md。

浏览器结果、截图、日志均留在被忽略的 .vitest-tmp 或工作区外层 .tmp，使用虚构数据，不写入仓库文档附件。隔离浏览器临时档案在结束时删除，不读取用户原浏览器档案。

<!-- INTERACTION_VERIFICATION:END -->

### 手机与可访问性覆盖

共享按钮测试宽度：320、375、390、430、844×390 横屏、768 平板、1280 桌面。真实页面在 320/390/430/844/768/1280 共六组尺寸核对对应页面标题与横向溢出，避免把尚未切换的旧页面当作测试结果。实际页面的待办保存、删除前确认、取消、撤销和导入取消在手机及桌面分别执行；导航保存核对 localStorage 的真实内容。

检查完整收缩时外部宽高/中心/相邻按钮位移小于 1px、圆形尺寸、触屏至少 44px、焦点保持、原生必填校验、输入保留、双击与 Enter 防重、可访问性树中的稳定名称和禁用语义、prefers-reduced-motion、卸载。错误给出原原因与明确重试。SVG 图标使用 22px / 2px 描边；成功底色的白色图形约 3.30:1，文字继续使用主题内经过 AA 校准的语义色。

保留既有 Modal 的焦点陷阱、焦点恢复、visualViewport/安全区域、移动 sheet 与多层确认框。自动尺寸/可访问性树测试不等于实体 iPhone、Android 软键盘或 Narrator/VoiceOver 听觉验收；这些需实机补验。

### 性能边界

未增加 npm 依赖。动画由 CSS transform/opacity/宽度与 SVG stroke 实现；没有全站轮询、逐帧 JS 任务或假的进度循环。每个操作只使用有限状态计时器，取消/卸载时全部清理。绝对定位的内表面进行宽度变化，外部占位固定，真实浏览器几何检查保证相关元素不移动。

构建前后体积与耗时见最终验证表。工作区同期有学习、清单和账本功能，因此全包差异是整个工作区的差异，不能视为这套反馈系统单独造成的开销。没有把本机一次构建速度或 headless 浏览器结果宣称为真实设备 FPS / LCP / INP 改善。

## 未覆盖与剩余问题

- 未访问生产账号、生产数据库或真实用户资料，也未发布。真实网络的账号登录/邮件回跳、云同步冲突、协作上传/提交及 AI/OCR 全链路仍需在测试环境验收；本次保留既有业务测试、错误区和真实任务状态。
- 浏览器使用 Chromium 与虚构数据；没有实体 Safari/Android、屏幕阅读器的人工听读、系统权限弹窗及软键盘实机结果。
- 原生紧凑日期网格、密集筛选等维持现有尺寸与间距，没有一律扩成 44px 而破坏布局；主要按钮与重试/关闭命中区沿用触屏最小尺寸。循环数据量和长文字仍建议结合实际设备复查。
- 项目已有 checkJs 类型债务继续遵循棘轮，不上调基线；完整工作区的门禁结果如有同期修改导致的失败，在验证表明确列出。
- 非中止型文件读取/IndexedDB 提交可以在底层结束，关闭后只忽略过期界面结果；没有宣称取消能够撤回已提交写入。

## 模板之外的入口

| 位置 | 元素 / 行为 | 类别 / 决策 |
| --- | --- | --- |
| src/components/AppearanceSettings.vue：SwipeActionSelector render 函数 | select 修改滑动操作选择 | C；原生选择，无成功加载动画。 |
| src/main.js：showStartupError | startup-retry 重新加载/资源恢复 | E；已有启动恢复页面说明，不能依赖尚未载入的 Vue 动画组件。 |
| src/main.js：showRecoveryRequired | startup-safe-mode 本机安全模式 | C；立即启动已有安全流程，保留数据。 |
| 同上 | startup-export 应急导出 | E；已有 startup-status 真实成功/失败文字，不虚构下载完成。 |
| 同上 | startup-retry 重新检查恢复状态 | E；沿用重载恢复流程。 |
| src/composables/reminderScheduler.js | 系统通知点击聚焦窗口 | C；浏览器提供原生反馈。 |

Vue 组件事件语义参考 [Vue 官方组件说明](https://vuejs.org/guide/essentials/component-basics.html)；账号结果兼容核对 [Supabase 官方登录接口](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)。保留项目现有依赖版本与服务契约。

## 全部模板交互元素及事件清单

<!-- INTERACTION_INVENTORY:START -->

扫描 100 个 Vue 文件，列出 1301 个控件/事件定义。分类：A 108，B 51，C 1073，D 48，E 21。共享 ActionButton 使用点 76 个。

### src/App.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 419 | a | {{ t('skip.toContent') }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 430 | button | 打开全局搜索 | click: openSearch() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 445 | button | 快速记录（Ctrl/Cmd + K） | click: openQuickRecord() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 485 | button | 打开数据管理 | click: openDataManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 490 | ActionButton | 导出当前数据 | action: () =&gt; exportCurrentData() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 491 | button | 关闭本机保存提示 | click: dismissPersistenceNotice | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | ActionButton | {{ retryingSync ? '正在重试…' : '重试账号同步' }} | action: () =&gt; retrySyncNow() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 506 | button | 打开数据管理 | click: openDataManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 511 | button | 去备份 | click: openDataManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 512 | button | 关闭备份提醒 | click: dismissBackupNudge | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 529 | button | 查看 | click: viewQuickRecordEntity | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 530 | button | 撤销 | click: undoQuickRecord | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 545 | button | 重新加载 | click: reloadAfterError | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 546 | button | 忽略此提示 | click: dismissGlobalError | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/AccountPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 256 | button | 账号概览 | click: activeSection = 'overview' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button | 账号安全 | click: activeSection = 'security' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 277 | button | 稍后设置，返回账号 | click: leaveRecovery | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 289 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }} | action: () =&gt; resend() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 293 | button | 已验证，去登录 | click: changeMode('login') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 294 | button | 更换邮箱 | click: changeMode('register') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 302 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送重设邮件' }} | action: () =&gt; submit() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 303 | button | 返回登录 | click: changeMode('login') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 303 | button | 更换邮箱 | click: changeMode('recovery') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 308 | button | 登录 | click: changeMode('login') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 309 | button | 注册 | click: changeMode('register') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 312 | form | 邮箱 {{ errors.email }} 密码 忘记密码？ {{ mode === 'register' ? '至少 8 位，建议混合字母、数字和符号。' : '请输入注册时设置的密码。' }} {{ errors.password }} 大写锁定已开启，请注意密码大小写。 再 | submit: submit | A：明确提交；结果以真实写入为准 | 真实忙碌态 |
| 317 | input | 输入邮箱地址 | input: clearFieldError('email') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 321 | button | 忘记密码？ | click: changeMode('recovery') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 325 | input | 输入密码 | input: clearFieldError('password'); keydown: capsLock = Boolean($event.getModifierState?.('CapsLock')); keyup: capsLock = Boolean($event.getModifierState?.('CapsLock')); blur: capsLock = false | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 332 | input | input passwordVisible ? 'text' : 'password' | input: clearFieldError('confirmation') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 335 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 336 | ActionButton | {{ busy ? '正在处理…' : isEmailFlow && resendSeconds &gt; 0 ? resendSeconds + ' 秒后可发送' : mode === 'register' ? '创建账号' : mode === 'recovery' ? '发送重设 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 337 | button | 返回登录 | click: changeMode('login') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 338 | ActionButton | {{ resendSeconds &gt; 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }} | action: () =&gt; resend() | A：明确提交；结果以真实写入为准 | 共享按钮 external |

### src/components/ActionButton.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 83 | button | (busy &#124;&#124; phase !== 'idle') && name ? name : ariaLabel | click: activate | C：即时状态；无加载/成功动画 | 真实忙碌态 |
| 108 | ActionFeedback | ActionFeedback | retry: retry | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/ActionFeedback.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 19 | button | 重试 | click: $emit('retry') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/ActionSheet.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 115 | div | {{ title }} {{ description }} {{ action.icon }} {{ action.label }} {{ action.hint }} 没有可执行的操作 {{ cancelLabel }} | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 130 | button（循环定义） | {{ action.icon }} {{ action.label }} {{ action.hint }} | click: choose(action) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 149 | button | {{ cancelLabel }} | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/AppearanceSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 391 | div | 个性化设置分区 | keydown: onAppearanceTabKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 主题与课表 | click: tab = 'theme' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 本地壁纸 | click: tab = 'wallpaper' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 今天页文字 | click: tab = 'quotes' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 首页布局 | click: tab = 'layout' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 滑动操作 | click: tab = 'swipe' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 391 | button | 导航自定义 | click: tab = 'navigation' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 394 | button（循环定义） | {{ theme.name }} | click: chooseTheme(key, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 400 | input | input color | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 403 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 406 | select | 流畅优先模式 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 414 | select | 高对比度模式 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 420 | input | input radio | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 424 | button（循环定义） | {{ target.label }} | click: chooseTarget(key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 426 | button | 跟随全站 | click: setPageMode('inherit') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 426 | button | 单独设置 | click: setPageMode('own') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 426 | button | 此页关闭 | click: setPageMode('none') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 427 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 433 | input | input file | change: uploadImage | E：真实任务阶段/预览/取消/重试 | 就地编辑 / 校验 |
| 434 | input | input file | change: uploadImage | E：真实任务阶段/预览/取消/重试 | 就地编辑 / 校验 |
| 435 | button | {{ busy ? busyStage : (hasOwnImage ? '📷 更换照片' : '📷 上传照片') }} | click: showImageSheet = true | C：即时状态；无加载/成功动画 | 真实忙碌态 |
| 438 | button | 删除壁纸 | click: removeImage | D：沿用确认、撤销或原有危险状态 | 真实忙碌态 |
| 441 | input | input range | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 442 | input | input range | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 443 | input | input range | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 444 | input | input range | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 445 | select | 居中 顶部 底部 靠左 靠右 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 446 | select | 智能适应（推荐） 始终铺满 始终完整显示 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 451 | button | 🖼 一键恢复全部壁纸 | click: resetAllWallpapers | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 453 | button | 🔄 一键恢复所有个性化 | click: resetAllAppearance | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 457 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 457 | input | 壁纸主题色 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 463 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 464 | textarea | 今天也要漂亮通关。 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 465 | select | 每天轮换 每次打开随机 固定一条 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 465 | select | {{ quote }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 466 | input | 例如：保持好奇，慢慢变强 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 467 | ActionButton | 保存文字 | action: quoteSaves.save | B：频繁操作；短反馈或既有保存状态 | 共享按钮 本地反馈 |
| 474 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 475 | button | `排序：${homeModuleLabel(module.id)}。可拖动，也可用 Alt 加上下方向键移动` | pointerdown: startModuleDrag(module.id, $event); keydown: onModuleDragKeydown($event, module.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 477 | button | 恢复默认顺序 | click: resetHomeModuleOrder | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 536 | button | 打开导航编辑器 | click: emit('edit-navigation') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 544 | ActionSheet | 更换壁纸 | select: onImageSheetSelect; close: showImageSheet = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 556 | ConfirmDialog | 删除壁纸 | close: removeImageTarget = null; confirm: confirmRemoveImage | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 566 | ConfirmDialog | 恢复全部壁纸 | close: resetWallpapersTarget = false; confirm: confirmResetAllWallpapers | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 576 | ConfirmDialog | 恢复初始外观 | close: resetAppearanceTarget = false; confirm: confirmResetAllAppearance | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/ConfirmDialog.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 45 | button | {{ cancelLabel }} | click: $emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 46 | button | {{ confirmLabel }} | click: $emit('confirm') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/ContextMenu.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 136 | button（循环定义） | {{ item.icon }} {{ item.label }} | click: choose(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/DataManager.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 130 | button | 备份 | click: jumpToSection('backup') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 131 | button | 恢复 | click: jumpToSection('restore') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 132 | button | 账号同步 | click: jumpToSection('sync') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 135 | TaskProgress | TaskProgress | cancel: cancelBackup; retry: retryBackup; continue: continueBackupResult; wait: backupProgress.continueWaiting; dismiss: continueBackupResult | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 168 | button | 重新读取恢复点 | click: refreshRestoreCheckpoint | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 175 | button | 恢复到这个恢复点 | click: showCheckpointConfirm = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 191 | ConfirmDialog | 从备份恢复 | close: restoreBackupTarget = null; confirm: confirmRestoreBackup | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 200 | ConfirmDialog | 恢复本机恢复点 | close: showCheckpointConfirm = false; confirm: confirmRestoreCheckpoint | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/DomainCsvImportButton.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 89 | button | ⇧ 导入 CSV | click: openImport | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 94 | input | input file | change: readFile | E：真实任务阶段/预览/取消/重试 | 就地编辑 / 校验 |
| 116 | button | 取消 | click: open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 117 | ActionButton | 导入 {{ preview?.total &#124;&#124; '' }} 条 | click: confirmImport | A：明确提交；结果以真实写入为准 | 共享按钮 external |

### src/components/EmptyState.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 28 | button | {{ secondaryLabel }} | click: emit('secondary') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 29 | button | {{ primaryLabel }} | click: emit('primary') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/FestiveSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 145 | input | input checkbox | change: commit | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 157 | select | {{ item.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 165 | input | input date | change: setBirthday($event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 176 | input | input date | change: installDateInput = $event.target.value; commit() | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 188 | button | ＋ 添加纪念日 | click: addAnniversary | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 194 | input | `纪念日 ${row.label &#124;&#124; '未命名'} 的日期` | change: setAnniversaryDate(row.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 202 | input | 纪念日名称 | input: commit | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 211 | button | `删除纪念日 ${row.label &#124;&#124; ''}` | click: removeAnniversary(row.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 220 | button | ＋ 添加农历纪念日 | click: addLunarAnniversary | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 226 | input | 农历纪念日名称 | input: setLunarLabel(row.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 233 | select | 农历月份 | change: setLunarMonth(row.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 236 | select | 农历日期 | change: setLunarDay(row.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 240 | input | input checkbox | change: setLunarLeap(row.id, $event.target.checked) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 247 | button | `删除农历纪念日 ${row.label &#124;&#124; ''}` | click: removeLunarAnniversary(row.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/FocusPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 517 | button | {{ active.pausedAt ? '继续' : '暂停' }} | click: active.pausedAt ? resume() : pause() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 520 | button | 结束 | click: requestEnd | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 529 | button | 记录做到哪里 | click: openTaskWorkSession(savedTodo) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 530 | button | {{ restRemainingSeconds &gt; 0 ? '结束休息' : '返回专注' }} | click: finishRest | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 539 | button | 记录做到哪里 | click: openTaskWorkSession(savedTodo) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 540 | button | 加入待办 | click: addTempTodo | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 542 | button | {{ linkedTodoDone ? '待办已完成' : '标记待办完成' }} | click: markTodoDone | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 545 | button | 再次专注 | click: againFocus | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 549 | button | 5 分钟 | click: startRest(5) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 550 | button | 10 分钟 | click: startRest(10) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 551 | button | 跳过 | click: closeCompletion | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 558 | input | 这次想专注什么 | input: onGoalInput; focus: showRecent = true; blur: scheduleHideRecent | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 569 | button | 取消待办关联 | click: clearTodo | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 570 | button | 从待办选择 | click: showTodoPicker = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 575 | button（循环定义） | {{ item }} | mousedown: ; click: useRecent(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 586 | button（循环定义） | `${mins} 分钟` | click: selectQuick(mins) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 599 | button | 自定义专注时长 | click: openCustomTime | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 602 | button | 开始专注 · {{ selectedMinutes }} 分钟 | click: start | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 607 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 614 | button（循环定义） | {{ task.title }} {{ task.dueDate ? (task.dueDate === getAppToday() ? '今天' : task.dueDate) : '无截止日期' }} | click: selectTodo(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 624 | input | 5～180 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 628 | button | 取消 | click: showCustomTime = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 629 | button | 使用 | click: applyCustomTime | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 639 | button | 放弃记录 | click: discardEarly | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 640 | button | 保存记录 | click: confirmEarlySave | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/FocusReturn.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 32 | button | ← 返回列表 | click: leaveFocus | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/FocusSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 79 | input | 5-180 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 83 | button | 恢复默认 15/25/45/60 | click: draft.quickTimes = [...DEFAULT_FOCUS_SETTINGS.quickTimes] | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 89 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 97 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 98 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 99 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 104 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 105 | ActionButton | 保存设置 | action: save | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |

### src/components/HomeProductivityPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 51 | button | 收起引导 | click: dismissGuide | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 55 | RouterLink | 添加课程 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 56 | RouterLink | 添加第一条待办 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/IcsImportButton.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 68 | input | 选择 ICS 日历文件 | change: readFile | E：真实任务阶段/预览/取消/重试 | 就地编辑 / 校验 |
| 77 | ActionButton | {{ busy ? '正在读取…' : '导入 .ics' }} | click: fileInput?.click() | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 97 | button | 取消 | click: closePreview | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 98 | button | 导入 {{ preview.events.length }} 条 | click: importEvents | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/MemoryView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 149 | button（循环定义） | {{ item.label }} | click: selectTab(item.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 153 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 154 | input | input month | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 155 | select | 选择年份 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 159 | ActionButton | 复制 | action: () =&gt; onCopy() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 160 | ActionButton | 分享 | action: () =&gt; onShare() | A：明确提交；结果以真实写入为准 | 共享按钮 external |

### src/components/Modal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 336 | div | {{ title }} {{ title }} {{ title }} {{ sheetState === 'expand' ? '收起' : '展开' }} ✕ | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 347 | div | div | pointerdown: onSheetPointerDown; pointermove: onSheetPointerMove; pointerup: onSheetPointerEnd; pointercancel: onSheetPointerCancel | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 361 | button | {{ sheetState === 'expand' ? '收起' : '展开' }} | click: toggleSheet | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 368 | button | 关闭弹窗 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/NavigationSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 215 | div | 选择要编辑的导航 | keydown: onModeKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 216 | button | ▤ 手机导航 | click: changeMode('mobile') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 217 | button | ☷ 电脑侧栏 | click: changeMode('desktop') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 223 | button | 恢复默认 | click: editor.apply({ type: 'defaults' }) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 228 | button | 载入最新布局 | click: editor.rebase(device) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 228 | button | 保留草稿并覆盖 | click: editor.rebase(device, true) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 239 | button | `调整${item.label}顺序` | pointerdown: startDrag($event, 'mobile', item.id); keydown: onOrderKeydown($event, 'mobile', item.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 241 | button | `将${item.label}上移` | click: reorderMobileItem(index, -1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 241 | button | `将${item.label}下移` | click: reorderMobileItem(index, 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 241 | button | `移除${item.label}` | click: editor.apply({ type: 'mobile:remove', id: item.id }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 249 | input | `${group.label &#124;&#124; '未命名'}分组名称` | focus: renameBatch = `rename-${++editSequence}`; input: editor.apply({ type: 'desktop:rename-group', id: group.id, label: $event.target.value }, { batch: renameBatch }); blur: renameBatch = null | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 250 | button | `将${group.label}分组上移` | click: editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex - 1 }) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 250 | button | `将${group.label}分组下移` | click: editor.apply({ type: 'desktop:move-group', id: group.id, to: groupIndex + 1 }) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 250 | button | `移除${group.label}分组` | click: requestRemoveGroup(group) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 254 | button | `调整${item.label}顺序` | pointerdown: startDrag($event, 'desktop', item.id, group.id); keydown: onOrderKeydown($event, 'desktop', item.id, group.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 256 | select | `将${item.label}移动到分组` | change: editor.apply({ type: 'desktop:move-item', id: item.id, groupId: $event.target.value }) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 257 | button | `将${item.label}上移` | click: reorderDesktopItem(group, itemIndex, -1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button | `将${item.label}下移` | click: reorderDesktopItem(group, itemIndex, 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button | `取消固定${item.label}` | click: editor.apply({ type: 'desktop:unpin', id: item.id }) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 262 | form | 新建分组 添加分组 | submit: addGroup | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 262 | input | 例如：我的常用 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 262 | button | 添加分组 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 278 | button | 撤销上一步 | click: editor.undo() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 278 | button | 重做上一步 | click: editor.redo() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 278 | ActionButton | {{ dirty.mobile && dirty.desktop ? '保存两端修改' : '保存导航' }} | action: saveNavigation | A：明确提交；结果以真实写入为准 | 共享按钮 本地反馈 |
| 287 | button | 继续编辑 | click: pendingDeparture = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 287 | button | 放弃修改 | click: discardAndLeave | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 287 | ActionButton | {{ saving ? '正在保存…' : '保存并离开' }} | action: () =&gt; saveAndLeave() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 292 | select | 移除分组后页面的目标分组 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 293 | button | 取消 | click: pendingGroupRemoval = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 293 | button | 移动页面并移除分组 | click: removeGroup | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/NotFoundView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 10 | router-link | 返回首页 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/NoticePaste.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 10 | NoticeUnderstanding | NoticeUnderstanding | close: emit('close'); commit: emit('commit', $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/NoticeUnderstanding.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 447 | textarea | 粘贴原通知 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 451 | select | 考试安排 作业 / 实验分组表 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 452 | input | input file | change: readOcrImage | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 459 | button | {{ listening ? '停止聆听' : '语音输入' }} | click: toggleVoice | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 462 | button | 返回理解结果 | click: editingSource = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 462 | button | {{ parsed ? '重新解析' : '分析通知' }} | click: analyze | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 471 | button | {{ selectedSegments.length === segments.length ? '取消全选' : '全选' }} | click: toggleAllSegments | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 475 | button | {{ selectedSegmentIds.includes(row.id) ? '✓' : '' }} {{ row.title }} {{ row.parsed.dateText &#124;&#124; row.parsed.dueDate &#124;&#124; '时间未识别' }} {{ row.parse | click: toggleSegment(row.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 480 | select | `第 ${row.index + 1} 条通知的处理方式` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 483 | summary | 查看完整原文 ▾ | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 483 | button | 编辑原文并重新识别 | click: editingSource = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 489 | button（循环定义） | {{ option.icon }} {{ option.label }} | click: setType(option.value) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 492 | button | 修改 | click: beginActionEdit | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 492 | input | 你需要做什么 | blur: finishActionEdit; keydown: finishActionEdit | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 493 | button | {{ fact.label }} {{ factText(fact) }} ✎ | click: editField(fact.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 493 | input | fact.label | blur: editingField = ''; keydown: editingField = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 497 | button | {{ selectedItemIds.length === parsed.items.length ? '取消全选' : '全选' }} | click: selectedItemIds = selectedItemIds.length === parsed.items.length ? [] : parsed.items.map((item) =&gt; item.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 497 | button（循环定义） | {{ selectedItemIds.includes(item.id) ? '✓' : '' }} {{ item.title }} {{ item.dateRange &#124;&#124; dateText(item.dueDate) &#124;&#124; '时间未识别' }} {{ item.dueTim | click: toggleItem(item.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 499 | button | {{ showProcessOptions ? '收起其他方式' : '更改处理方式' }} ⌄ | click: showProcessOptions = !showProcessOptions | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 499 | input | input radio | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 501 | input | input radio | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 501 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 503 | summary | 更多信息 {{ showMore ? '收起' : '展开' }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | button | 🔔 提醒： {{ parsed.reminder }} | click: editField('reminder') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | button | 优先级： {{ parsed.priority === 'high' ? '高' : '低' }} | click: editField('priority') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | button | 备注： {{ parsed.note }} | click: editField('note') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | button（循环定义） | ＋ {{ item.label }} | click: editField(item.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | textarea | textarea | blur: editingField = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 503 | input | input extraFields.find((item) =&gt; item.key === editingField)?.type &#124;&#124; 'text' | blur: editingField = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 504 | summary | 查看原通知 ▾ | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 504 | button | {{ copied ? '已复制' : '复制' }} | click: copyRaw | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 504 | button | 编辑原通知 | click: editingSource = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 504 | button | 重新解析 | click: editingSource = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 508 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 508 | button | {{ actionLabel }} | click: save | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |

### src/components/PromptDialog.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 83 | input | label ? undefined : title | input: draft = $event.target.value; emit('input', draft); keydown: submit | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 101 | button | {{ cancelLabel }} | click: $emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 102 | button | {{ confirmLabel }} | click: submit | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/QuickRecordPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 90 | textarea | 快速记录内容 | input: onSmartInput; compositionend: onSmartInput; keydown: onSmartKeydown; keydown: onSmartKeydown; keydown: onSmartKeydown | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 107 | button | listening ? '停止语音' : '语音输入' | click: toggleVoice | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 119 | button | {{ clipboardLoading ? '读取中…' : '粘贴文字' }} | click: pasteClipboard | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 120 | button | 清空 | click: clearEntry | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 125 | button | ✨ 自动识别 | click: chooseAuto | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 126 | button（循环定义） | {{ action.icon }} {{ action.label }} | click: chooseAction(action.type) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 131 | button（循环定义） | {{ text.replace(/\n/g, ' / ') }} ↗ | click: useExample(text) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 137 | button | 智能识别 | click: useClipboard | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 142 | button（循环定义） | {{ recentIcon(item.type) }} {{ recentTitle(item) }} {{ item.detail }} | click: reuseRecent(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 152 | button | 全选 | click: setAllSelected(true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 152 | button | 取消全选 | click: setAllSelected(false) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 157 | input | `选择第 ${index + 1} 项记录` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 159 | button | {{ expandedId === draft.id ? '收起' : '修改' }} | click: expandedId = expandedId === draft.id ? '' : draft.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 160 | button | `移除第 ${index + 1} 项草稿` | click: removeDraft(draft) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 166 | button（循环定义） | {{ recordTypeMeta(type).label }} | click: changeDraftType(draft, type) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 175 | button（循环定义） | {{ recordTypeMeta(type).icon }} 按 {{ recordTypeMeta(type).label }} 解析 | click: retryAs(draft, type) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 181 | input | 记录标题 | input: onDraftTitleChange(draft) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 185 | input | 金额 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 188 | button | {{ catInfo(draft.category).icon }} {{ categoryLabel(draft.category) }} | click: toggleCategoryEditor(draft, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 190 | button（循环定义） | {{ category.icon }} {{ category.name }} | click: chooseCategory(draft, category) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 194 | input | 日期 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 195 | button | {{ ['event', 'countdown', 'bill'].includes(draft.type) ? '补充日期' : '添加日期' }} | click: expandedId = draft.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 196 | input | 时间 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 207 | button（循环定义） | {{ choice }} | click: chooseQuestion(draft, question.field, choice) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 216 | button | 确认分类 | click: confirmCategory(draft) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 216 | button | 选择其它分类 | click: expandedId = draft.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 220 | select | 待办 作业 日程 支出 收入 固定账单 重要日期 | change: onDraftTypeSelect(draft, $event) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 229 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 230 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 231 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 232 | input | 例如：教学楼 201 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 233 | input | input | input: syncDraftCourse(draft) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 234 | select | {{ category.icon }} {{ category.name }} | change: confirmCategory(draft) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 235 | input | 例如：微信 / 现金 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 236 | select | 普通 重要 较低 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 237 | select | 每周 每月 每季度 每年 仅一次 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 238 | textarea | textarea | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 249 | button | 撤销刚才保存 | click: undoLastSaved | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 251 | ActionButton | {{ saveLabel }} | action: () =&gt; saveAll(false) | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 252 | ActionButton | 保存并继续 | action: () =&gt; saveAll(true) | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |

### src/components/QuickRecordSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 24 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 25 | select | {{ item.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 26 | input | 例如：微信 / 现金 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 28 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 29 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 30 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |

### src/components/ReleaseNotesBrowser.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 38 | summary | {{ group.version }} {{ group.notes.length }} 项更新 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 42 | button | 关闭 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/RouteFallback.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 15 | button | 重新加载 | click: retry | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/SearchPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 323 | input | 搜索待办、日程、账单、课程… | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 329 | button（循环定义） | {{ chipLabel(item) }} | click: typeFilter = item.key | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 345 | button（循环定义） | {{ part.text }} {{ part.text }} {{ result.meta }} · {{ result.archived ? '已归档/完成' : group.label }} | click: navigate(result) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/Sidebar.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 418 | button | collapsed ? group.label : undefined | click: toggleNavigationGroup(group.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 420 | router-link（循环定义） | collapsed ? item.label : undefined | pointerenter: warmRoute(item.path); pointerdown: warmRoute(item.path); focus: warmRoute(item.path) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 440 | router-link | item.mobileLabel &#124;&#124; item.label | pointerdown: warmRoute(item.path) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 450 | button | 快速记录 | pointerenter: warmTool('capture'); pointerdown: warmTool('capture'); focus: warmTool('capture'); click: openMobileTool('capture') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 453 | button | ⋯ 更多 | click: showMobileMore = !showMobileMore | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 464 | div | div | click: closeMobileMore(true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 468 | section | 更多功能 | pointerdown: onDrawerPointerDown; pointermove: onDrawerPointerMove; pointerup: onDrawerPointerEnd; pointercancel: onDrawerPointerCancel | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 481 | button | 关闭更多功能 | click: closeMobileMore(true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 485 | router-link（循环定义） | {{ item.icon }} {{ item.label }} | click: closeMobileMore(); pointerdown: warmRoute(item.path) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 488 | button（循环定义） | {{ item.icon }} {{ item.key === 'account' ? accountLabel : item.label }} {{ accountUser ? '已登录' : '未登录' }} | click: openMobileTool(item.key); pointerdown: warmTool(item.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 496 | button | collapsed ? '展开侧边栏' : '收起侧边栏' | click: collapsed = !collapsed | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 509 | button | `${accountLabel}${accountUser ? '，已登录' : '，未登录'}` | pointerenter: warmTool('account'); focus: warmTool('account'); click: accountOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 513 | button | 🔍 搜索 | pointerenter: warmTool('search'); focus: warmTool('search'); click: showSearch = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 518 | button | 🎨 个性化 | pointerenter: warmTool('appearance'); focus: warmTool('appearance'); click: showAppearance = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 522 | button | 编辑导航 | pointerenter: warmTool('navigation'); focus: warmTool('navigation'); click: openNavigationSettings | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 523 | button | 快速记录 | click: emit('open-quick-record') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 536 | button | 🎉 氛围与纪念日 | pointerenter: warmTool('festive'); focus: warmTool('festive'); click: showFestiveSettings = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 540 | button | 💾 数据管理 | pointerenter: warmTool('data'); focus: warmTool('data'); click: openDataManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 544 | button | ⚡ 快速记录设置 | click: showQuickRecordSettings = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 547 | button | ⏱ 专注设置 | pointerenter: warmTool('focus'); focus: warmTool('focus'); click: showFocusSettings = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 550 | button | ↻ 版本与更新 | pointerenter: warmTool('update'); focus: warmTool('update'); click: showVersionUpdate = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 558 | button（循环定义） | `${theme.name}主题` | click: chooseTheme(key, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 580 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/SocialCalendarEvents.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 82 | router-link | 管理邀约 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 85 | router-link | 打开一起约 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/SwipeActionItem.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 195 | button（循环定义） | action.ariaLabel &#124;&#124; action.label | click: onAction(action) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 207 | button（循环定义） | action.ariaLabel &#124;&#124; action.label | click: onAction(action) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 218 | div | div | pointerdown: onPointerDown; pointermove: onPointerMove; pointerup: onPointerEnd; pointercancel: resetGesture(); click: onClickCapture | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/TaskCenter.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 90 | button | {{ pillLabel }} {{ unseenResultCount }} | click: open = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 119 | ActionButton | 取消 | action: () =&gt; onCancel(task) | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 132 | button | 清空 | click: clearTaskResults | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/TaskProgress.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 79 | button | 继续等待 | click: $emit('wait') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 80 | button | 取消任务 | click: $emit('cancel') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 81 | button | 重试当前步骤 | click: $emit('retry') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 82 | button | 使用当前结果 | click: $emit('continue') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 83 | button | 收起进度 | click: $emit('dismiss') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/TimeWheelSheet.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 81 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 82 | button | 清除时间 | click: clear | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 83 | button | 确定 | click: confirm | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/Toast.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 93 | button | {{ actionLabel }} | click: doAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 94 | button | {{ actionLabel }} | click: doAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 96 | button | 关闭 | click: hide | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/UpdateNotes.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 29 | button | 知道了 | click: acknowledge | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/WheelPicker.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 118 | div | label &#124;&#124; '滚轮选择' | scroll: onScroll; keydown: onKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/account/AccountPasswordForm.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 74 | form | 当前密码 {{ errors.currentPassword }} 新密码 至少 8 位，建议使用较长的密码并混合字母、数字和符号。 {{ errors.password }} 再次输入新密码 {{ errors.confirmation }} 显示密码 {{ error }}  | submit: submit | A：明确提交；结果以真实写入为准 | 真实忙碌态 |
| 77 | input | input visible ? 'text' : 'password' | input: edit('currentPassword') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 82 | input | input visible ? 'text' : 'password' | input: edit('password') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 88 | input | input visible ? 'text' : 'password' | input: edit('confirmation') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 91 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 93 | ActionButton | {{ submitting ? '正在保存…' : '保存新密码' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 94 | button | {{ resetSeconds &gt; 0 ? resetSeconds + ' 秒后可重发邮件' : '忘记当前密码？通过邮箱重设' }} | click: emit('reset-request') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/account/AccountSessionActions.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 28 | button | 导出备份 | click: emit('backup') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 32 | button | 退出当前设备 | click: scope = 'local' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 33 | button | 退出所有设备 | click: scope = 'global' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 35 | ConfirmDialog | scope === 'global' ? '退出所有设备？' : '退出当前设备？' | close: scope = ''; confirm: confirmSignOut | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/courses/CourseActivityItem.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 14 | RouterLink | {{ row.title }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/courses/CourseTaskItem.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 15 | button | `完成待办：${row.task.title}` | click: emit('complete', row.task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 19 | RouterLink | {{ row.task.title }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 23 | button | {{ row.task.sourceType === 'project-task' ? '打开项目任务 →' : row.task.workCheckpoint &#124;&#124; row.task.status === 'in_progress' ? '继续这项任务 →' : '开始这项任务 | click: emit('work', row.task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/data/AccountSyncPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 95 | button | 通过账号自动同步 | click: toggleAccountSync | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 103 | ActionButton | {{ busy ? '正在同步…' : accountSyncPreparationError ? '重试账号同步' : '立即同步' }} | action: () =&gt; synchronize() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 109 | input | input radio | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 109 | input | input radio | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 111 | ActionButton | {{ submitting ? '正在确认…' : '确认并继续同步' }} | action: () =&gt; submitChoices() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 114 | button | 注册 / 登录 | click: accountOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/data/AppUpdateSection.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 202 | button | 下载新版本 | click: downloadDesktopUpdate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 203 | button | 重启并安装 | click: installDesktopUpdate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 204 | button | 立即重新加载 | click: reloadAppToApplyUpdate | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 205 | button | {{ checkButtonLabel }} | click: checkUpdates | E：真实任务阶段/预览/取消/重试 | 真实忙碌态 |
| 209 | button | ≡ 查看更新记录 › | pointerenter: warmReleaseNotes; pointerdown: warmReleaseNotes; focus: warmReleaseNotes; click: notesOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 223 | TaskProgress | TaskProgress | retry: retryAppUpdate; wait: appUpdateProgress.continueWaiting | E：真实任务阶段/预览/取消/重试 | 原有状态 / 统一基础反馈 |
| 235 | summary | 版本异常或更新卡住？ | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 238 | ActionButton | {{ recovering ? '正在修复…' : '修复更新缓存' }} | action: () =&gt; recoverToLatest() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |

### src/components/data/BackupSection.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 12 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 13 | button | {{ exporting ? '正在生成备份…' : '导出完整备份' }} | click: exportBackup | E：真实任务阶段/预览/取消/重试 | 真实忙碌态 |

### src/components/data/DataOverview.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 15 | button | 刷新 | click: $emit('refresh') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 25 | summary | 查看各分区的数据量 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/data/RestorePreview.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 16 | button | 取消选择 | click: clearSelectedBackup | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 18 | button | 全选 | click: selectAll | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 18 | button | 清空选择 | click: restoreSelection = [] | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 20 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 21 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 25 | button | 恢复所选 {{ restoreSelection.length }} 个分区 | click: restoreBackup | E：真实任务阶段/预览/取消/重试 | 原有状态 / 统一基础反馈 |

### src/components/data/RestoreSection.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 15 | input | 选择要恢复的备份文件 | change: selectFile | E：真实任务阶段/预览/取消/重试 | 真实忙碌态 |

### src/components/events/EventCalendar.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 48 | button | 上个月 | click: moveMonth(-1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 49 | button | 今天 | click: resetToday | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 50 | button | 下个月 | click: moveMonth(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 53 | input | input month | change: $emit('month', $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 56 | button（循环定义） | `${formatAppDate(day.date)}，${day.events.length ? `${day.events.length} 条日程` : '没有日程'}` | click: select(day.date); keydown: navigate($event, day.date) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/learning/LearningNavigation.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 14 | RouterLink（循环定义） | {{ page.label }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/learning/StudyPlanner.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 76 | RouterLink | 打开课表 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 78 | button | 今天 | click: chosenDate = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 79 | button | 明天 | click: chosenDate = addAppDays(appToday, 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 80 | input | 学习计划日期 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 85 | button | 撤销 | click: undo | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 93 | RouterLink | {{ item.taskTitle }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 94 | button | `安排${item.taskTitle}到${item.startTime}` | click: addBlock(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 105 | RouterLink | {{ block.task?.title &#124;&#124; block.event.title }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 106 | button | `撤回学习时段：${block.event.title}` | click: removeBlock(block) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 109 | button | {{ expanded ? '收起' : `查看全部 ${plan.blocks.length} 个时段` }} | click: expanded = !expanded | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 117 | RouterLink | {{ item.name }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 118 | button | `开始复习：${item.name}` | click: startReview(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/learning/TaskFocusLink.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 8 | RouterLink | `为${task.title}准备${minutes}分钟专注` | click: $emit('navigate') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/navigation/NavigationFeaturePicker.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 37 | input | 搜索可用功能 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 38 | select | 筛选可用功能 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 40 | select | 添加功能的目标分组 | change: emit('update:targetGroup', $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 48 | button | `打开${item.label}` | click: emit('open', item.path) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 49 | button | `${pinned.has(item.id) ? '已添加' : '添加'}${item.label}` | click: emit('pin', item.id) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/navigation/NavigationPreview.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 21 | button | {{ collapsed ? '展开文字' : '仅看图标' }} | click: collapsed = !collapsed | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/projects/ProjectTaskWorkProgress.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 15 | a（循环定义） | {{ url }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/schedule/BatchImportModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 248 | textarea | 批量录入课程文本 | input: onTextInput; paste: onTextPaste; keydown: ; click:  | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 261 | input | input file | change: onFileChange | E：真实任务阶段/预览/取消/重试 | 就地编辑 / 校验 |
| 266 | input | input file | change: onCropFileChange | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 270 | input | input file | change: onExcelFileChange | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 279 | TaskProgress | TaskProgress | cancel: emit('cancel-progress'); retry: emit('retry-progress'); continue: emit('continue-progress'); wait: emit('wait-progress') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 302 | button | 直接修改 | click: startReviewEdit(row) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 306 | input | input | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 307 | select | {{ day }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 308 | select | 第 {{ period.number }} 节 · {{ period.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 309 | select | 第 {{ period.number }} 节 · {{ period.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 310 | select | 第 {{ week }} 周 | change: onStartWeekChange | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 311 | select | 第 {{ week }} 周 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 312 | select | 每周 单周 双周 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 313 | input | input | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 314 | input | input | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 317 | button | 取消 | click: editingSourceIndex = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 318 | button | 保存并重新校验 | click: saveReviewEdit | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 405 | button | 撤销本次导入 | click: emit('undo') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 406 | button | 继续录入 | click: emit('continue-import') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 407 | button | 完成并查看课表 | click: emit('finish-import') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 411 | button | 清空 | click: emit('clear') | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 412 | button | 导入 {{ validCount }} 门课程 | click: emit('import') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/schedule/CourseEditorModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 148 | RouterLink | 查看课程进度 → | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 150 | RouterLink | {{ task.title }} | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 150 | RouterLink | ＋ 课程待办 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 150 | button | 添加作业 | click: emit('add-homework') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 151 | RouterLink | {{ item.name }} | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 151 | RouterLink | ＋ 记录考试或重要日期 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 155 | input | 例如：高等数学 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 165 | input | 选填 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 168 | input | 例如：教学楼 A201 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 171 | select | 跟随当前校区 {{ campus.name }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 172 | input | 选填 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 176 | select | {{ day }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 177 | select | {{ periodOption(period.id) }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 178 | select | {{ periodOption(period.id) }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 182 | select | 第 {{ week }} 周 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 183 | select | 第 {{ week }} 周 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 184 | select | 每周上 单周上 双周上 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 198 | button（循环定义） | `标记颜色 ${colorName(color)}` | click: draft.color = color | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 200 | button | {{ isArchived(editingCourse) ? '恢复课程' : '归档课程' }} | click: emit('archive', editingCourse) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 200 | button | 删除课程 | click: requestDelete | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 200 | button | 保存 | click: save | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 201 | button | ＋ 在此格添加另一门课 | click: emit('add-another') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/schedule/CourseManagerModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 61 | button | {{ selectedIds.length === courses.length ? '取消全选' : '全选' }} | click: emit('toggle-all') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 62 | button | 创建副本 | click: emit('duplicate') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 63 | button | 删除选中 | click: emit('delete-selected') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 74 | input | `选择课程 ${course.name}` | change: emit('toggle-course', course.id) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 81 | button | 清空全部课程 | click: emit('clear') | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 86 | input | 学期课表模板名称 | input: emit('update:template-name', $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 86 | button | 保存当前课表 | click: emit('save-template') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 88 | button | 导入 | click: emit('import-template', template) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 88 | button | 删除模板 | click: emit('delete-template', template) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/schedule/ExceptionsModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 299 | form | {{ editingId ? '编辑安排' : '添加安排' }} 正在编辑已有安排 {{ tab.label }} {{ typeHint }} {{ dateFieldLabel }} {{ dateHint }} 结束日期 只停一天时，与开始日期相同 采用哪一周的课表 跟随 | submit: submit | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 301 | div | 安排类型 | keydown: onTypeTabKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 302 | button（循环定义） | {{ tab.label }} | click: selectType(tab.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 310 | input | input date | input: onDateInput | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 314 | input | input date | input: clearFeedback | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 319 | select | 跟随当天（ {{ weekTextFor(form.date) }} ） 第 {{ week }} 周 | change: clearFeedback | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 326 | select | {{ day }} | change: clearFeedback | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 339 | input | 搜索可选课程 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 341 | button | {{ search.trim() ? '选择搜索结果' : '全选' }} | click: selectVisibleCourses | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 342 | button | 清空选择 | click: clearSelection | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 346 | input | input checkbox | change: toggleCourse(course.id) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 357 | input | 例如：假期安排、教师调课通知 | input: clearFeedback | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 361 | button | 取消编辑 | click: resetForm | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 362 | button | {{ editingId ? '保存修改' : '添加安排' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 369 | select | 筛选已保存安排 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 373 | button | 撤销删除 | click: undoRemove | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 384 | button | `编辑 ${dateText(item)} 的${typeLabel(item.type)}安排` | click: startEdit(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 385 | button | `删除 ${dateText(item)} 的${typeLabel(item.type)}安排` | click: removeItem(item) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/schedule/ImageCropModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 149 | div | 课表裁切区域 | pointerdown: begin; pointermove: move; pointerup: end; pointercancel: end; keydown: onStageKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 165 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 165 | ActionButton | 裁切并识别 | action: confirm | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |

### src/components/schedule/ImportConflictModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 83 | button | 一键替换 {{ summary.conflicts }} 门冲突项 | click: emit('decisions', 'replace') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 84 | button | 全部保留两门 | click: emit('decisions', 'keep') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 85 | button | 全部跳过冲突项 | click: emit('decisions', 'skip') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 95 | select | `${item.course.name} 的处理方式` | change: emit('decision', item.index, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 105 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 106 | button | 确认导入 | click: emit('commit') | A：明确提交；结果以真实写入为准 | 真实忙碌态 |
| 110 | button | 替换当前整张课表 | click: emit('replace-all') | C：即时状态；无加载/成功动画 | 真实忙碌态 |

### src/components/schedule/RecognitionSchemeDetailModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 51 | button（循环定义） | {{ campus.name }} | click: pickSchemeCampus(activeScheme, campus.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 57 | button | 导入为新校区 | click: startNewCampus(activeScheme) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 66 | input | 新校区名 | input: updateSchemeTarget(activeScheme, { newCampusName: $event.target.value }) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 77 | button（循环定义） | {{ season.name }} | click: pickSchemeSeason(activeScheme, season.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 83 | button | 导入为新作息方案 | click: startNewSeason(activeScheme) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 92 | input | 新方案名 | input: updateSchemeTarget(activeScheme, { newSeasonName: $event.target.value }) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 112 | button | 全部 {{ activeScheme.rows.length }} | click: detailFilter = 'all' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 113 | button | 异常 {{ activeSchemeIssueCount }} | click: detailFilter = 'issues' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 126 | input | 节次名称 | input: onSchemeRowInput(row) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 127 | input | 开始时间 | input: onSchemeRowInput(row) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 129 | input | 结束时间 | input: onSchemeRowInput(row) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 130 | button | 删除该行 | click: removeSchemeRow(activeScheme, index) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 134 | button | 确认无误 | click: row.confirmed = true | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 143 | button | ＋ 加一行 | click: addSchemeRow(activeScheme) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 148 | button | 返回总览 | click: closeSchemeDetail | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 149 | button | 仅导入这一组 | click: closeSchemeDetail(); openImportPlan(activeScheme.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/schedule/ScheduleGrid.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 202 | button | 前一天 | click: emit('mobile-day-change', -1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 206 | button | `管理 ${mobileDate} 的课程调整：${exceptionLabel(viewExceptions[mobileDay])}` | click: emit('open-adjustments', mobileDate) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 208 | button | 后一天 | click: emit('mobile-day-change', 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 212 | button | 添加课程 | click: openAdd(mobileDay, timeConfig.periods[0]?.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 215 | button（循环定义） | {{ courseTimeRange(course) &#124;&#124; coursePeriodText(course) }} {{ course.name }} {{ course.room &#124;&#124; '未设置地点' }} · {{ course.teacher }} {{ coursePro | click: openEdit(course) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 248 | button | `管理 ${viewDates[i]} 的课程调整：${exceptionLabel(viewExceptions[i])}` | click: emit('open-adjustments', viewDates[i]) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 259 | div（循环定义） | cellLabel(i, row) | click: onCellClick(i, row); keydown: onCellKeydown($event, i, ri) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 280 | div（循环定义） | {{ c.name }} {{ courseProgress[c.id].overdue ? `${courseProgress[c.id].overdue} 项逾期` : `${courseProgress[c.id].pending} 项待办` }} {{ weekLabel | keydown: openEdit(c); keydown: openEdit(c); click: openEdit(c) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/schedule/ScheduleNote.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 17 | textarea | 课程表备注 | input: resize | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |

### src/components/schedule/SemesterModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 32 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 42 | button | 保存 | click: save | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |

### src/components/schedule/TimeBaseSettings.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 185 | input | `校区名称：${campus.name}` | change: renameCampus(campus.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 190 | button | 删除校区 | click: onRemoveCampus(campus.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 199 | input | 新校区名称 | keyup: onAddCampus | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 200 | button | ＋ 添加 | click: onAddCampus | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 214 | input | `作息季名称：${season.name}` | change: renameSeason(season.id, $event.target.value, null) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 220 | input | `作息季生效日期（MM-DD）：${season.name}` | blur: onSeasonDateChange(season, $event.target.value, $event.target) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 228 | button | 删除作息季 | click: onRemoveSeason(season.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 241 | button（循环定义） | {{ campus.name }} | click: toggleSeasonCampus(season, campus.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 252 | input | 新作息季名称 | keyup: onAddSeason | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 253 | input | 新作息季生效日期（MM-DD） | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 254 | button | ＋ 添加 | click: onAddSeason | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 265 | input | `节次名称：${period.label}` | change: renamePeriod(period.id, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 273 | button | 删除节次 | click: onRemovePeriod(period.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 283 | input | 新节次名称 | keyup: onAddPeriod | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 284 | button | ＋ 添加 | click: onAddPeriod | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 288 | ConfirmDialog | 删除校区 | close: removeCampusTarget = null; confirm: confirmRemoveCampus | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 298 | ConfirmDialog | 删除作息季 | close: removeSeasonTarget = null; confirm: confirmRemoveSeason | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/schedule/TimeGeneratePanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 26 | button | ⚡ 快速生成时间（辅助填充） {{ genPreview ? '▴' : '▾' }} | click: toggleGenPreview | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 36 | select | {{ p.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 42 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 47 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 52 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 57 | select | {{ p.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 61 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 66 | select | {{ p.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 70 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 74 | button | {{ genPreview ? '收起预览' : '生成预览' }} | click: toggleGenPreview | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 86 | button | 取消 | click: genPreview = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 87 | button | 填充空白节次 | click: applyGenerate('fill') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 88 | button | 覆盖当前方案 | click: applyGenerate('all') | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/schedule/TimeImportPlanModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 68 | button | 返回计划列表 | click: closeImportPlan | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 69 | button | 重试导入 | click: confirmImportPlan | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 90 | select | `${item.label} 的处理方式` | change: setPlanItemAction(item, $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 99 | button | {{ planDiffExpanded[item.schemeId] ? '收起变化' : '查看变化' }} | click: togglePlanDiff(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 122 | button | 去处理 | click: editFromPlan(item.schemeId) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 129 | button | 取消 | click: closeImportPlan | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 130 | button | 确认并导入（ {{ importPlan.summary.replace + importPlan.summary.create }} 组） | click: confirmImportPlan | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

### src/components/schedule/TimeSettingsModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 230 | div | 设置分区 | keydown: onSettingsTabKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 237 | button | {{ tabLabel('plans') }} | click: switchSettingsTab('plans') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 247 | button | {{ tabLabel('base') }} | click: switchSettingsTab('base') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 272 | TaskProgress | TaskProgress | cancel: scheduleOcrProgress.cancel; retry: retryScheduleOCR; continue: continueScheduleResults; wait: scheduleOcrProgress.continueWaiting | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 294 | button（循环定义） | {{ campus.name }} | click: switchPlan(planSeasonId, campus.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 305 | button（循环定义） | {{ season.name }} | click: switchPlan(season.id, planCampusId) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 321 | button | ＋ 新建 / 导入 | click: toggleImport | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 322 | button | ⧉ 复制已有方案 | click: toggleCopy | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 323 | button | ± 批量调整 | click: openTimeShift | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 324 | button | ↺ 恢复默认 | click: onResetTimes | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 330 | button | 撤销本次导入 | click: undoLastImport | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 337 | button（循环定义） | {{ plan.seasonName }} · {{ plan.campusName }} | click: copyFrom(plan.season, plan.campus) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 350 | select | 批量调整起始节次 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 354 | select | 批量调整结束节次 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 357 | select | 批量调整偏移量 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 368 | input | 批量调整自定义分钟数 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 384 | button | 应用 {{ batchPreview.rows.length }} 行 | click: applyBatch | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 395 | div | 作息导入方式 | keydown: onImportTabKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 396 | button | 📋 粘贴时间表 | click: importTab = 'paste' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 397 | button | 📷 从图片识别 | click: importTab = 'image' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 401 | textarea | 粘贴作息时间 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 408 | ActionButton | 解析预览 | action: () =&gt; runParsePaste() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 415 | input | input file | change: onImportImage | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 418 | button | 使用精准模式重新识别 | click: retryScheduleAccurate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 427 | button | 放弃识别 | click: discardRecognition | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 443 | input | input checkbox | change: toggleSchemeSelected(scheme) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 445 | div | {{ schemeDisplayName(scheme, timeConfig) }} · {{ scheme.rows.length }} 节 {{ schemeStatusBadge(scheme).icon }} {{ schemeStatusBadge(scheme).t | click: openSchemeDetail(scheme.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 452 | button | 查看 / 编辑 | click: openSchemeDetail(scheme.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 457 | button | 放弃 | click: discardRecognition | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 458 | button | 仅导入当前组 | click: openImportPlan(activeSchemeForQuick.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 459 | button | 导入选中的 {{ selectedSchemeCount }} 组作息 | click: openImportPlan() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 478 | input | `${row.period.label} 开始时间` | input: markDirty | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 485 | input | `${row.period.label} 结束时间` | input: markDirty | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 507 | button | 放弃修改 | click: discardDraft | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 508 | button | 恢复默认时间 | click: onResetTimes | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 509 | ActionButton | {{ draftDirty ? '保存' : '完成' }} | action: saveDraftWithFeedback | B：频繁操作；短反馈或既有保存状态 | 共享按钮 本地反馈 |
| 526 | ConfirmDialog | 放弃未保存的修改 | close: cancelPendingDraft; confirm: confirmDiscardDraft | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 540 | ConfirmDialog | 恢复默认作息时间 | close: resetTimesTarget = false; confirm: applyResetTimes | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/task-views/TaskBoard.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 107 | div | {{ column.label }} {{ listOf(column.key).length }} 这一列还没有待办 {{ task.title }} {{ courseNameOf(task) }} {{ repeatLabelOf(task) }} {{ dueInfoOf | keydown: onKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 141 | button | `打开待办「${task.title}」的详情` | click: emit('open', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 157 | button | `将待办「${task.title}」移到进行中` | click: setTaskStatus(task, 'in_progress') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 164 | button | `将待办「${task.title}」移回待办` | click: setTaskStatus(task, 'pending') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 171 | button | toggleLabel(task) | click: emit('toggle', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 178 | button | 归档待办 | click: emit('archive', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 179 | button | 编辑待办 | click: emit('open', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 180 | button | 删除待办 | click: emit('remove', task) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |

### src/components/task-views/TaskCalendar.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 74 | button | 上一个月 | click: emit('shift-month', -1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 78 | button | 下一个月 | click: emit('shift-month', 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 88 | button | cellLabel(cell) | click: emit('select-date', selectedDate === cell.dateKey ? '' : cell.dateKey) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 106 | button | rowLabel(task) | click: emit('open', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 110 | button | toggleLabel(task) | click: emit('toggle', task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/tasks/TaskWorkCheckpointFields.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 23 | summary | 断点续做 记录进度、卡点和下一步 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 25 | textarea | 例如：已经完成数据清洗，正在检查异常值 | input: updateField('checkpointLastStep', $event) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 27 | textarea | 选填，写下目前卡住的地方 | input: updateField('checkpointBlocker', $event) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 29 | textarea | 例如：核对缺失值后导出图表 | input: updateField('checkpointNextStep', $event) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 31 | textarea | https://… | input: updateField('checkpointResources', $event) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 33 | a | {{ url }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/components/tasks/TaskWorkSession.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 49 | a（循环定义） | {{ url }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 68 | button | {{ startLabel }} | click: emit('start') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 69 | button | {{ busy ? '保存中…' : '保存进度' }} | click: emit('save') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 70 | button | 关闭 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/CourseArchiveView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 187 | RouterLink | ← 全部课程 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 188 | RouterLink | {{ course ? '查看课表' : '管理课程' }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 189 | RouterLink | ＋ 添加课程待办 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 204 | input | 搜索课程、老师或地点 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 206 | button | 在学课程 {{ activeProfiles.length }} | click: scope = 'active' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 207 | button | 待推进 {{ attentionCount }} | click: scope = 'pending' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 208 | button | 已归档 {{ archivedProfiles.length }} | click: scope = 'archived' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 212 | RouterLink（循环定义） | `查看${item.course.name}的课程进度` | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 222 | EmptyState | 先把课程加进来 | primary: router.push('/schedule') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 223 | EmptyState | 没有匹配的课程 | primary: resetFilters | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 224 | EmptyState | 暂时没有待推进的课程 | primary: resetFilters | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 226 | EmptyState | 当前没有在学课程 | primary: scope = 'archived'; secondary: router.push('/schedule') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 233 | select | 切换课程 | change: switchCourse | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 239 | RouterLink | ＋ 添加 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 243 | EmptyState | profile.taskTotal ? '课程待办已处理完' : '先记下这门课要做的事' | primary: router.push(taskLocation) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 248 | RouterLink | {{ row.title }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 249 | RouterLink | 管理重要日期 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 250 | button | {{ nodesExpanded ? '收起节点 ↑' : `展开其余 ${profile.upcoming.length - 4} 个节点 ↓` }} | click: nodesExpanded = !nodesExpanded | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 255 | button | {{ historyOpen ? '收起记录 ↑' : '展开记录 ↓' }} | click: toggleHistory | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button（循环定义） | {{ filter.label }} | click: activityType = filter.value | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 266 | EmptyState | 这门课程已不存在 | primary: router.push('/course') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 268 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; start: startTaskWork; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/EventsView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 189 | router-link | 一起约 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 190 | button | 导入日程 | click: importOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 191 | button | ＋ 新建日程 | click: createForScope | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 197 | button | {{ nextEvent.title }} {{ timeRangeOf(nextEvent) }} · {{ nextEvent.location }} → | click: detail = nextEvent | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 201 | button（循环定义） | `${stat.label} ${plan.counts[stat.key]} 条日程` | click: showFilter(stat.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 208 | button | 清单 | click: viewMode = 'list' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 209 | button | 月历 | click: viewMode = 'calendar' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 211 | input | 搜索标题、地点、课程、日期或备注 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 212 | button | 清除 | click: query = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 215 | button（循环定义） | {{ item.label }} {{ plan.counts[item.key] }} | click: filter = item.key | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 218 | button | 当前日程 | click: filter = 'upcoming' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 219 | button | 已归档 | click: filter = 'archived' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 223 | EventCalendar | EventCalendar | month: changeMonth; select: selectedDate = $event | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 227 | button | {{ selectedDate ? '查看整月' : '按日查看' }} | click: selectedDate = selectedDate ? '' : `${month}-01` | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 227 | button | 导出 .ics | click: exportCalendar | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 236 | button | {{ row.event.title }} | click: detail = row.event | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 241 | button | `编辑日程：${row.event.title}` | click: openEdit(row.event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 242 | button | `恢复日程：${row.event.title}` | click: restore(row.event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 243 | button | `归档日程：${row.event.title}` | click: archive(row.event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 244 | button | `删除日程：${row.event.title}` | click: deleteEventTarget = row.event | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 250 | EmptyState | emptyState.title | primary: debouncedQuery.trim() ? query = '' : createForScope() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 251 | button | ＋ 添加 {{ selectedDate ? '当天' : '本月' }} 日程 | click: createForScope | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 255 | form | 日程内容 日期 今天 明天 待安排 开始时间 {{ form.time &#124;&#124; '选择时间' }} 结束时间 {{ form.endTime &#124;&#124; '可选' }} 时长 {{ minutes }} 分钟 清除时间 与 {{ liveConflicts.length }} 条安排时间 | submit: save | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 256 | input | 例如：项目讨论、图书馆自习 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 258 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 259 | button | 今天 | click: form.date = appToday | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 259 | button | 明天 | click: form.date = shiftEventDate(appToday, 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 259 | button | 待安排 | click: form.date = ''; clearTime() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 262 | button | {{ form.time &#124;&#124; '选择时间' }} | click: wheelField = 'time' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 263 | button | {{ form.endTime &#124;&#124; '可选' }} | click: wheelField = 'endTime' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 265 | button（循环定义） | {{ minutes }} 分钟 | click: setDuration(minutes) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 265 | button | 清除时间 | click: clearTime | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 267 | input | 可选，例如：图书馆三楼 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 269 | select | {{ form.courseName ? '保留原课程名称' : '不关联课程' }} {{ form.courseName &#124;&#124; '原关联课程' }} {{ course.name }} {{ course.teacher ? ` · ${course.teacher}` :  | change: selectCourse | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 270 | input | 也可以手动填写 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 273 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 274 | input | input number | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 275 | button（循环定义） | {{ minutes ? `${minutes} 分钟` : '到点' }} | click: form.reminderMinutes = minutes | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 277 | button | {{ notificationBusy ? '正在启用…' : '启用浏览器通知' }} | click: enableNotifications | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 278 | textarea | 议题、要带的东西或其他细节 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 280 | button | 取消 | click: closeForm | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 280 | button | {{ editing ? '保存' : '添加' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 288 | summary | 查看原文 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 289 | button | 编辑日程 | click: editDetail | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 289 | button | 恢复日程 | click: restore(detail) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 289 | button | 复制为新日程 | click: copyEvent(detail) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 290 | router-link | 查看齐行项目 → | click: detail = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 293 | IcsImportButton | IcsImportButton | import: importEvents | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 293 | DomainCsvImportButton | DomainCsvImportButton | import: importEvents | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 295 | ConfirmDialog | 删除日程 | close: deleteEventTarget = null; confirm: confirmRemove | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 296 | ConfirmDialog | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ExamsView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 517 | button | {{ showHistory ? '返回当前' : `历史 ${summary.archived &#124;&#124; ''}` }} | click: setHistory | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 519 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 522 | button | ＋ 添加重要日期 | click: openAdd | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 529 | button | 即将到来 {{ summary.upcoming }} 全部当前日期 | click: selectOverview('all') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 530 | button | 未来 7 天 {{ summary.week }} 含今天 | click: selectOverview('week') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 531 | button | 已置顶 {{ summary.pinned }} 优先关注 | click: selectOverview('pinned') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 532 | button | 已结束 {{ summary.past }} 查看与归档 | click: selectOverview('past') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 537 | input | 搜索名称、课程、地点或备注 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 537 | button | 清除重要日期搜索 | click: query = ''; searchQuery.flush('') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 538 | select | 全部日期 未来 7 天 未来 30 天 已置顶 已结束 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 539 | select | 最近日期优先 按名称 最近添加优先 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 542 | button | 全部类型 | click: categoryFilter = 'all' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 542 | button（循环定义） | {{ category }} | click: categoryFilter = category | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 543 | button | 清除筛选 | click: resetFilters | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 549 | EmptyState | emptyInfo.title | primary: emptyAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 571 | div | {{ item.category ?? '其他' }} 每年重复 置顶 已归档 ··· {{ item.pinned ? '取消置顶' : '置顶' }} 编辑 归档 恢复 删除 {{ item.tile.month }} {{ item.tile.day }} {{ item. | pointerdown: onCardPointerDown(item, $event); pointermove: cardLongPress.onPointerMove; pointerup: cardLongPress.onPointerUp; pointercancel: cardLongPress.onPointerCancel; contextmenu: openContextMenuAt(item, $event); click: onCardClick(item, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 591 | button | `重要日期「${item.name}」的更多操作` | click: toggleMenu(item, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 599 | button | {{ item.pinned ? '取消置顶' : '置顶' }} | click: menuPin(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 600 | button | 编辑 | click: menuEdit(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 601 | button | 归档 | click: menuArchive(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 602 | button | 恢复 | click: domain.restoreMilestone(item.id); closeMenu() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 603 | button | 删除 | click: menuDelete(item) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 614 | button | item.name | pointerdown: ; click: openEdit(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 632 | button | {{ item.review }} · 查看待办 → | click: openReviewTasks(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 642 | button | {{ item.activeReview ? '继续复习 →' : item.review ? '再安排 25 分钟复习' : '安排 25 分钟复习' }} | click: createReviewTask(item, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 649 | form | 名称 * 目标日期 * 具体时间 今天 明天 一周后 类型 {{ category }} 重复 不重复 每年重复 按公历每年重复，卡片显示下一次日期；2 月 29 日在平年按 2 月最后一天显示。 备注或地点 提前提醒（分钟） 0 表示到点提醒，留空使用默认设置。未填时间按 23 | submit: save | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 651 | input | 例如：期末考试、生日或项目截止日 | input: clearFormError('name') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 656 | input | input date | input: clearFormError('date') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 660 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 664 | button | 今天 | click: setFormDate(0) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 664 | button | 明天 | click: setFormDate(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 664 | button | 一周后 | click: setFormDate(7) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 669 | select | {{ category }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 675 | select | 不重复 每年重复 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 685 | textarea | 选填，例如：教学楼 A101；携带证件和文具 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 688 | input | `默认提前 ${defaultReminder} 分钟` | input: clearFormError('reminder') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 692 | select | 暂不关联 {{ course.name }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 693 | input | input range | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 697 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 704 | button | 删除 | click: remove | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 705 | button | 取消 | click: showForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 706 | button | 保存 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 711 | ConfirmDialog | 删除重要日期 | close: deleteTarget = null; confirm: confirmDelete | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 719 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 721 | ContextMenu | contextMenuTarget?.name &#124;&#124; '' | select: onContextMenuSelect; close: contextMenu = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/LedgerView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 558 | div | 账本 看清近期花费，处理固定账单，记下刚刚发生的一笔。 分类管理 {{ focusMessage }} 账本 固定账单 回顾 支出分类 收入分类 常用分类 全部分类 隐藏分类 自定义 上下箭头调整完整分类列表和录入时“更多分类”的顺序；常用快捷分类仍优先显示最近使用项。 这里还没 | click: closeSwipe | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 565 | button | 分类管理 | click: openCategoryManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 570 | div | 账本分区 | keydown: onLedgerTabKeydown | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 571 | button | 账本 | click: tab = 'ledger' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 572 | button | 固定账单 | click: tab = 'bills' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 573 | button | 回顾 | click: tab = 'review' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 723 | QuickEntryModal | QuickEntryModal | update:open: showQuick = $event; update:editing-id: editingId = $event; update:keep-adding: keepAdding = $event; update:amount-input: amountInput = $event; update:name-input: nameInput = $event; update:cat-input: catInput = $event; update:date-input: dateInput = $event; update:time-input: timeInput = $event; update:note-input: noteInput = $event; update:account-input: accountInput = $event; update:source-input: sourceInput = $event; update:bill-id-input: billIdInput = $event; update:currency-input: currencyInput = $event; update:split-count: splitCount = $event; update:split-mine: splitMine = $event; update:split-mode: splitMode = $event; update:show-all-quick-categories: showAllQuickCategories = $event; update:direction-input: directionInput = $event; update:more-open: moreOpen = $event; update:dup-warn: dupWarn = $event; update:force-dup: forceDup = $event; update:cycle-suggest: cycleSuggest = $event; update:category-input-manually-selected: categoryInputManuallySelected = $event; update:suggested-category-input: suggestedCategoryInput = $event; save: handleQuickSave; close: closeQuickModal; open-quick-record: openQuickRecord; open-bill-form: openBillForm; quick-record-saved: onQuickRecordSaved; select-category: selectQuickCategory; update:show-quick-record: showQuickRecord = $event | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 873 | button | 支出分类 | click: categoryManageScope = 'expense' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 874 | button | 收入分类 | click: categoryManageScope = 'income' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 877 | button | 常用分类 | click: categoryManageTab = 'common' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 878 | button | 全部分类 | click: categoryManageTab = 'all' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 879 | button | 隐藏分类 | click: categoryManageTab = 'hidden' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 880 | button | 自定义 | click: categoryManageTab = 'custom' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 886 | button | `更换${c.name}图标` | click: toggleIconPicker(c) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 902 | button | `${c.name}上移` | click: moveCategory(c, -1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 903 | button | `${c.name}下移` | click: moveCategory(c, 1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 905 | button | 重命名 | click: renameCategory(c) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 906 | button | !canHideCategory(c) ? `至少保留一个可用分类，${c.name}暂不能隐藏` : `${c.hidden ? '显示' : '隐藏'}${c.name}` | click: toggleCatHidden(c) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 914 | button | categoryUsageFor(c.key).transactions &gt; 0 ? `${c.name}已有历史交易，不能删除` : `删除${c.name}` | click: requestDeleteCategory(c) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 932 | button（循环定义） | `将${c.name}图标设为${icon}` | click: setCategoryIcon(c, icon) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 945 | input | 新增分类名称 | input: categoryFeedback = null; keydown: addCategory | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 953 | button | 添加 | click: addCategory | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 963 | PromptDialog | 修改分类名称 | input: renameError = ''; close: renameTarget = null; renameError = ''; confirm: applyCategoryRename | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 976 | ConfirmDialog | 删除自定义分类 | close: categoryDeleteTarget = null; confirm: confirmDeleteCategory | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 986 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ListsView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 408 | button | ＋ 新建清单 | click: openCreateList() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 412 | EmptyState | 从一份小清单开始 | primary: openCreateList() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 416 | button（循环定义） | {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.description }} {{ entry.items.length }} 项 · 自由修改 | click: openCreateList(entry.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 427 | input | 搜索清单 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 429 | button（循环定义） | {{ typeInfo(list.type).icon }} {{ list.name }} ✓ {{ listSummary(list).done }} / {{ listSummary(list).count }} 已完成 {{ typeInfo(list.type).lab | click: activeId = list.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 435 | select | 选择清单 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 439 | button | 清除搜索 | click: listQuery = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 440 | button | ＋ 新建清单 / 使用模板 | click: openCreateList() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 447 | button | 编辑清单 | click: openEditList | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 448 | details | ••• 复制为新清单 重置勾选，再次使用 导出文本 删除清单 | keydown: closeMenuFromKey | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 449 | summary | 更多清单操作 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 451 | button | 复制为新清单 | click: duplicateList | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 452 | button | 重置勾选，再次使用 | click: requestReset | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 453 | button | 导出文本 | click: exportList | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 454 | button | 删除清单 | click: requestAction('list') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 470 | form | 添加 详细添加 批量添加 | submit: addQuickItem | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 471 | input | 快速添加一项 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 472 | button | 添加 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 473 | button | 详细添加 | click: openAddItem | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 474 | button | 批量添加 | click: openBulkAdd | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 479 | button（循环定义） | {{ entry.label }} {{ entry.count }} | click: filter = entry.key | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 481 | button | {{ bulkMode ? '退出批量' : '批量管理' }} | click: bulkMode ? exitBulkMode() : bulkMode = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 481 | button | 清除已完成 | click: requestClearCompleted | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 484 | input | 搜索当前清单事项 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 485 | select | 按分类筛选 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 486 | select | 清单事项排序 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 488 | button | 清除筛选 | click: clearFilters | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 490 | input | input checkbox | change: selectVisible | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 491 | button | 标记完成 | click: setSelectedDone(true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 491 | button | 恢复未完成 | click: setSelectedDone(false) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 491 | button | 删除 | click: requestAction('items', [...selectedIds]) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 495 | SwipeActionItem | {{ item.done ? '✓' : '' }} {{ checklistItemName(item) }} {{ item.category }} {{ checklistQuantity(item) }} {{ item.unit &#124;&#124; '件' }} · {{ item. | update:open: openSwipeItemId = $event ? item.id : ''; action: handleSwipe($event, item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 497 | input | `选择${checklistItemName(item)}` | change: toggleSelection(item.id) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 498 | button | `将${checklistItemName(item)}标记为${item.done ? '未完成' : '已完成'}` | click: toggleItem(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 499 | button | `编辑${checklistItemName(item)}` | click: openEditItem(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 507 | EmptyState | emptyTitle | primary: emptyAction; secondary: openBulkAdd | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 513 | form | 从空白开始，或选择一份可修改的模板。 ＋ 空白清单 自由记录 {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.items.length }} 项 {{ template.items.map(item =&gt; ite | submit: saveList | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 517 | button | ＋ 空白清单 自由记录 | click: chooseTemplate('') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 518 | button（循环定义） | {{ typeInfo(entry.type).icon }} {{ entry.name }} {{ entry.items.length }} 项 | click: chooseTemplate(entry.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 523 | input | 例如：本周采购 | input: listError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 525 | select | {{ info.icon }} {{ info.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 526 | input | 留空表示不设置预算 | input: listError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 529 | button | 取消 | click: showListForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 529 | button | {{ editingListId ? '保存修改' : '创建清单' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 533 | form | {{ formList?.name &#124;&#124; '原清单已被删除' }} 事项名称 * 数量 单位 单价（元） {{ itemSubtotal === null ? '填写单价后自动计算小计；未估价事项不计入预计金额。' : `本项小计 ${money(itemSubtotal)}`  | submit: saveItem | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 536 | input | 例如：洗衣液、带充电器 | input: itemError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 538 | input | input number | input: itemError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 539 | input | 件 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 540 | input | 选填 | input: itemError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 543 | input | 选择或输入分类 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 544 | textarea | 规格、放置位置或其他需要记住的事 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 547 | button | 删除事项 | click: removeEditingItem | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 547 | button | 取消 | click: showItemForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 547 | button | {{ editingItemId ? '保存修改' : '添加事项' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 551 | form | 添加到“ {{ bulkList?.name &#124;&#124; '原清单已被删除' }} ”。每行一项，一次最多 {{ MAX_BATCH_ITEMS }} 项；支持编号、项目符号和 [x] 完成标记。 粘贴或输入事项 跳过已有事项和本次输入中的同名事项 将添加 {{ bulkPreview | submit: saveBulkItems | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 553 | textarea | 身份证 充电器 换洗衣物 | input: bulkError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 554 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 559 | button | 取消 | click: showBulkForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 559 | button | 添加 {{ bulkPreview.items.length }} 项 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 561 | ConfirmDialog | confirmTitle | close: confirmTarget = null; confirm: confirmAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ProjectsView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 1149 | ActionButton | 刷新 | action: () =&gt; refresh() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 1150 | button | 新建项目 | click: openCreateProject | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1155 | button | 撤销删除 | click: undoDeleteProject | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1155 | button | 关闭提示 | click: notice = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1168 | button | 登录或注册 | click: accountOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1180 | button | 拒绝 | click: askConfirm({ kind: 'decline-invite', projectId: invite.projectId }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1181 | ActionButton | 接受 | action: () =&gt; acceptProjectInvite(invite.projectId) | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1186 | button | 查看任务 | click: selectProject(assignment.projectId) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1190 | button | 处理申请 | click: openInboxAdjustment(request) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1194 | button | 查看成果 | click: openInboxReview(review) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1198 | button | 查看讨论 | click: openInboxMeeting(meeting) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1206 | button | showArchived ? '显示进行中项目' : '显示已归档项目' | click: showArchived = !showArchived | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1209 | button（循环定义） | {{ ({ course: '📚', competition: '🏁', research: '🔬', software: '💻', event: '🎪', blank: '🧩' })[item.type] &#124;&#124; '🧩' }} {{ item.name }} {{  | click: selectProject(item.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1214 | button | ＋ 新建项目 | click: openCreateProject | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1222 | button | 编辑 | click: openEditProject | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1223 | button | 归档 | click: askConfirm({ kind: 'archive' }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1224 | button | 删除 | click: askConfirm({ kind: 'delete' }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1225 | button | 恢复项目 | click: askConfirm({ kind: 'restore', projectId: project.id }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1241 | button | 任务 | click: activeSection = 'tasks' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1242 | button | 协商 {{ adjustments.filter((item) =&gt; item.status === 'pending').length }} | click: activeSection = 'adjustments' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1243 | button | 成果 {{ deliverables.length }} | click: activeSection = 'deliverables' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1244 | button | 团队时间 | click: activeSection = 'schedule' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1245 | button | 成员 {{ activeMembers.length }} | click: activeSection = 'members' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1246 | button | 动态 | click: activeSection = 'activity' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1252 | select | 任务筛选 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1252 | button | ＋ 添加任务 | click: openTaskCreate() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1256 | button | ＋ 添加里程碑 | click: openMilestoneForm() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1259 | button | item.status === 'completed' ? `重新打开${item.title}` : `完成${item.title}` | click: toggleMilestone(item, item.status !== 'completed') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1261 | button | 编辑 | click: openMilestoneForm(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1261 | button | 删除 | click: askConfirm({ kind: 'delete-milestone', milestoneId: item.id }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1267 | button | 添加第一个任务 | click: openTaskCreate() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1283 | ActionButton | 拒绝分工 | action: () =&gt; respondTask(task, 'decline') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1284 | ActionButton | 接受分工 | action: () =&gt; respondTask(task, 'accept') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1287 | button | 工作台 | click: openProjectTaskWorkbench(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1288 | button | 继续 | click: openProjectTaskWorkbench(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1289 | ActionButton | 提交验收 | action: () =&gt; changeTaskStatus(task, 'review') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1290 | ActionButton | 完成 | action: () =&gt; changeTaskStatus(task, 'completed') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1292 | button | 协商调整 | click: openAdjustment(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1293 | button | 编辑 | click: openTaskEdit(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1294 | button | `为“${task.title}”添加子任务` | click: openTaskCreate(task.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1295 | button | `查看“${task.title}”的进展记录` | click: loadTaskEvents(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1298 | ActionButton | 拒绝 | action: () =&gt; respondTask(child, 'decline') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1298 | ActionButton | 接受 | action: () =&gt; respondTask(child, 'accept') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1298 | ActionButton | 完成 | action: () =&gt; changeTaskStatus(child, 'completed') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1298 | button | `编辑子任务 ${child.title}` | click: openTaskEdit(child) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1306 | button | ＋ 发起讨论 | click: openMeetingForm() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1308 | ActionButton（循环定义） | 未来 {{ days }} 天 | action: () =&gt; queryGroupAvailability(days) | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 1311 | ActionButton | 重试 | action: () =&gt; queryGroupAvailability() | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 1314 | button | 手动发起讨论 | click: openMeetingForm() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1315 | button（循环定义） | {{ formatProjectTime(slot.startsAt) }} – {{ formatProjectTime(slot.endsAt) }} {{ scheduleAvailability.people.map((person) =&gt; person.nickname | click: openMeetingForm(slot) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1324 | button | 采用建议时间 | click: askConfirm({ kind: 'meeting-apply-proposal', meetingId: meeting.id, participantId: person.userId }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1327 | button | 提出改期 | click: openMeetingProposal(meeting) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1327 | ActionButton | 拒绝 | action: () =&gt; respondMeeting(meeting, 'decline') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1327 | ActionButton | 接受 | action: () =&gt; respondMeeting(meeting, 'accept') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1328 | button | 确认并加入日程 | click: askConfirm({ kind: 'meeting-confirm', meetingId: meeting.id }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1329 | button | 取消邀约 | click: askConfirm({ kind: 'meeting-cancel', meetingId: meeting.id }) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1344 | ActionButton | 拒绝 | action: () =&gt; decideAdjustment(request, 'reject') | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 1344 | ActionButton | 通过 | action: () =&gt; decideAdjustment(request, 'approve') | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 1345 | ActionButton | 撤回 | action: () =&gt; cancelAdjustment(request) | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 1351 | button | ＋ 添加交付项 | click: openDeliverableCreate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1359 | button | ＋ 添加检查项 | click: openDeliveryCheckForm | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1362 | input | input checkbox | change: saveDeliveryCheck(item, $event.target.checked) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1363 | input | `${item.title}的凭证或说明` | input: deliveryEvidenceEdits.mark(item.id, item.evidence); keydown: saveDeliveryCheck(item, item.checked) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1363 | ActionButton | 保存说明 | action: () =&gt; saveDeliveryCheck(item, item.checked) | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 1363 | button | `删除检查项 ${item.title}` | click: askConfirm({ kind: 'delivery-check-delete', checkId: item.id }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1379 | a（循环定义） | {{ link.title &#124;&#124; link.url }} | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1380 | button（循环定义） | {{ file.name }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB | click: openDeliverableFile(file) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1383 | button | 验收 V {{ version.number }} | click: openReview(item, version) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1387 | button | {{ item.versions?.[0]?.reviewStatus === 'returned' ? '修改并重新提交' : item.draft ? '继续编辑草稿' : '提交成果' }} | click: openDeliverableEditor(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1392 | button | 邀请成员 | click: showInviteForm = true; linkToShare = ''; void loadFriends(); void loadInviteLinks() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1396 | ActionButton | {{ member.role === 'admin' ? '设为成员' : '设为管理员' }} | action: () =&gt; changeMemberRole(member) | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1396 | button | 转交负责人 | click: transferTargetId = member.userId | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1396 | button | `移出成员 ${member.nickname}` | click: askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1397 | button | 撤回邀请 | click: askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname }) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1400 | button | 退出项目 | click: askConfirm({ kind: 'leave' }) | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1414 | button | 新建项目 | click: openCreateProject | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1420 | form | 项目名称 * 项目类型 {{ item.label }} 项目说明 开始日期 预计结束 {{ projectFormError }} 取消 {{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }} | submit: saveProject | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1421 | input | 例如：数学建模竞赛 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1422 | select | {{ item.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1423 | textarea | 选填，写下目标或背景 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1424 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1424 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1426 | button | 取消 | click: showProjectForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1426 | ActionButton | {{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1431 | form | 任务标题 * 任务说明 负责人 暂不分配 {{ member.userId === accountUser.id ? '我' : member.nickname }} 截止日期 所属阶段 不关联里程碑 {{ item.title }} 前置任务 没有前置任务 {{ item.ti | submit: saveTask | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1432 | input | 例如：完成需求分析 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1433 | textarea | 选填 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1434 | select | 暂不分配 {{ member.userId === accountUser.id ? '我' : member.nickname }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1434 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1435 | select | 不关联里程碑 {{ item.title }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1436 | select | 没有前置任务 {{ item.title }} {{ item.status === 'completed' ? '（已完成）' : '' }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1438 | select | {{ label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1440 | button | 取消 | click: showTaskForm = false; editingTask = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1440 | ActionButton | {{ taskSaveBusy ? '保存中…' : editingTask ? '保存修改' : '添加任务' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1447 | form | 阶段名称 * 阶段说明 关键日期 取消 {{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }} | submit: saveMilestone | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1448 | input | 例如：方案评审 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1449 | textarea | 选填 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1450 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1451 | button | 取消 | click: showMilestoneForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1451 | ActionButton | {{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1456 | form | 检查内容 * 项目交付必需 取消 {{ planningSaveBusy ? '保存中…' : '添加检查项' }} | submit: saveDeliveryCheckItem | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1457 | input | 例如：确认最终报告包含实验数据 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1458 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1459 | button | 取消 | click: showDeliveryCheckForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1459 | ActionButton | {{ planningSaveBusy ? '保存中…' : '添加检查项' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1464 | form | 时间按你的账号时区（ {{ scheduleTimezone }} ）填写。其他成员会看到本地时区下的时间。 讨论主题 * 讨论说明 {{ meetingProposalTarget ? '建议开始时间' : '开始时间' }} {{ meetingProposalTarget  | submit: saveMeetingForm | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1466 | input | 例如：确定演示方案 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1467 | textarea | 选填，写下议题或会议链接 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1468 | input | input datetime-local | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1469 | input | input datetime-local | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1470 | button | 取消 | click: showMeetingForm = false; meetingProposalTarget = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1470 | ActionButton | {{ actionBusy ? '提交中…' : meetingProposalTarget ? '发送改期建议' : '发送讨论邀请' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1475 | form | {{ adjustmentTask?.title }} · 申请提交后先由相关成员确认，确认前不会改动现有安排。 申请类型 延长截止时间 寻求其他成员协助 调整任务范围 拆分任务 交接任务负责人 无法继续承担 申请的新截止日期 {{ adjustmentDraft.type == | submit: saveAdjustment | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1477 | select | 延长截止时间 寻求其他成员协助 调整任务范围 拆分任务 交接任务负责人 无法继续承担 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1478 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1479 | select | 选择项目成员 {{ member.nickname }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1480 | textarea | 写下希望采用的新范围 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1481 | textarea | 每行一个子任务，最多 8 项 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1482 | textarea | 说明当前遇到的问题和需要怎样的调整 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1483 | button | 取消 | click: showAdjustmentForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1483 | ActionButton | {{ adjustmentSaveBusy ? '提交中…' : '提交申请' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1488 | form | 交付项名称 * 交付要求 关联任务 不关联具体任务 {{ task.title }} 验收人 项目负责人或管理员 {{ member.nickname }} 项目交付必需 正式提交后需要验收 取消 {{ deliverableSaveBusy ? '保存中…' : '添加交付项' | submit: saveDeliverable | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1489 | input | 例如：最终报告 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1490 | textarea | 选填，写下格式、内容或检查要求 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1491 | select | 不关联具体任务 {{ task.title }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1492 | select | 项目负责人或管理员 {{ member.nickname }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1493 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1494 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1495 | button | 取消 | click: showDeliverableForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1495 | ActionButton | {{ deliverableSaveBusy ? '保存中…' : '添加交付项' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1500 | form | 交付要求： {{ activeDeliverable.instructions }} 成果说明 在线链接 ＋ 添加链接 在线文档 代码仓库 指定提交 其他链接 × 成果文件 {{ fileUploadBusy ? '上传中…' : '选择文件' }} 单个文件最大 20 MB，每 | submit: submitDeliverable | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1502 | textarea | 简要说明完成内容、查看方式或注意事项 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1503 | button | ＋ 添加链接 | click: addContentLink | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1504 | select | 链接类型 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1504 | input | 链接名称 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1504 | input | HTTPS 链接 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1504 | button | `删除链接 ${index + 1}` | click: draftContent.links.splice(index, 1) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1506 | input | input file | change: uploadDeliverableFiles | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1507 | button | 移除 | click: draftContent.files.splice(index, 1) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1509 | input | 选填，例如：根据验收意见补充了实验结果 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1511 | button | 关闭 | click: showDeliverableEditor = false; activeDeliverable = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1511 | ActionButton | {{ deliverableSaveBusy ? '保存中…' : '保存草稿' }} | action: () =&gt; saveDeliverableDraft() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 1511 | ActionButton | {{ deliverableSaveBusy ? '提交中…' : '正式提交新版本' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1516 | form | 通过前请逐项确认检查结果；有未通过项时请选择退回修改。 × ＋ 添加检查项 验收意见 * 退回修改 {{ reviewSaveBusy ? '保存中…' : '通过验收' }} | submit: decideReview('approved') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1518 | input | `检查项 ${index + 1} 通过` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1518 | input | `检查项 ${index + 1} 名称` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1518 | button | `删除检查项 ${index + 1}` | click: reviewChecklist.splice(index, 1) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 1518 | button | ＋ 添加检查项 | click: addReviewChecklistItem | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 1519 | textarea | 说明检查结果，退回时请写清楚修改建议 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1520 | ActionButton | 退回修改 | action: () =&gt; decideReview('returned') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1520 | ActionButton | {{ reviewSaveBusy ? '保存中…' : '通过验收' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1526 | select | 选择好友 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1526 | ActionButton | 发送邀请 | action: () =&gt; inviteFriend() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1527 | ActionButton | {{ linkBusy ? '正在创建…' : '创建并复制邀请链接' }} | action: () =&gt; createInviteLink() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1527 | input | input | focus: $event.target.select() | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 1527 | ActionButton | 复制 | action: () =&gt; copyInviteLink(linkToShare) | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 1527 | ActionButton | 停用 | action: () =&gt; revokeInviteLink(link.id) | D：沿用确认、撤销或原有危险状态 | 共享按钮 external |
| 1539 | button | 取消 | click: transferTargetId = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 1539 | ActionButton | 确认转交 | action: () =&gt; transferOwner() | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 1542 | ConfirmDialog | ({ archive: '归档项目', delete: '删除项目', leave: '退出项目', remove: '移出成员', restore: '恢复项目', 'decline-invite': '拒绝项目邀请', 'delete-milestone': '删除里程碑', 'meeting-confirm': '确认小组讨论', 'meeting-cancel': '取消讨论邀约', 'meeting-apply-proposal': '采用改期建议', 'delivery-check-delete': '删除交付检查项' })[confirmAction.kind] &#124;&#124; '确认操作' | close: confirmAction = null; confirm: runConfirmedAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ScheduleView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 248 | button | {{ showArchivedCourses ? '返回当前课程' : '历史课程' }} | click: showArchivedCourses = !showArchivedCourses | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 249 | button | {{ showScheduleSettings ? '收起设置' : '更多设置' }} | click: showScheduleSettings = !showScheduleSettings | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 256 | button | ☷ 批量管理 | click: openCourseManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 256 | button | ⇩ 导入课程表 | click: openBatchShift | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button | 📅 学期 | click: showSemester = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 257 | button | 🕐 作息与节次 | click: openTimeSettings | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 258 | button | {{ mobileView === 'day' ? '切换整周视图' : '切换单日视图' }} | click: mobileView = mobileView === 'day' ? 'week' : 'day' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 265 | button | 经典 | click: appearance.scheduleSkin = 'classic' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 266 | button | 笔记 | click: appearance.scheduleSkin = 'notebook' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 267 | button | 极简 | click: appearance.scheduleSkin = 'timeline' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 273 | button（循环定义） | {{ campus.name }} | click: selectScheduleCampus(campus.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 286 | button | currentAutoStatus.available ? '根据当前日期自动选择' : '完善生效日期并解决冲突后可用' | click: enableAutoSeason | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 294 | button（循环定义） | {{ season.name }} | click: timeConfig.autoSeason = false; timeConfig.currentSeason = season.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 310 | button | 上一周 | click: goWeek(-1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 318 | button | 下一周 | click: goWeek(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 320 | button | 回到本周 | click: viewWeek = curWeek | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 328 | button | 单日 | click: mobileView = 'day' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 329 | button | 整周 | click: mobileView = 'week' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 341 | button | 放假、调课与补课 | click: openExceptionManager | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 342 | button | ＋ 添加课程 | click: openAdd() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 365 | button | 学习安排 {{ learningPendingCount ? `${learningPendingCount} 项课程待办，利用课表空档继续推进` : '把课程待办、复习和专注接到课表上' }} {{ showLearningPlan ? '收起 ↑' : '展开 →' }} | click: showLearningPlan = !showLearningPlan | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 371 | CourseEditorModal | CourseEditorModal | close: showForm = false; save: saveCourseFromEditor; delete: removeCourseFromEditor; archive: archiveCourseFromEditor; add-another: addAnotherInCell; add-homework: openHomeworkForCourse | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 396 | ConfirmDialog | 删除课程 | close: deleteCourseTarget = null; confirm: confirmDeleteCourse | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 408 | ConfirmDialog | 删除课程 | close: coursesRemovalTarget = null; confirm: confirmCoursesRemoval | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 418 | ConfirmDialog | 导入课表模板 | close: importTemplateTarget = null; confirm: confirmImportCourseTemplate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 428 | ConfirmDialog | 删除课表模板 | close: deleteTemplateTarget = null; confirm: confirmDeleteCourseTemplate | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 438 | ConfirmDialog | 替换整张课表 | close: replaceAllTarget = null; confirm: confirmWholeScheduleReplacement | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 468 | BatchImportModal | BatchImportModal | close: showBatch = false; update:text: batchText = $event; update:error: batchError = $event; clear: clearBatchInput; replace-row: replaceBatchRow; import: importBatch; upload-image: ocrImage; crop-image: selectCropImage; upload-excel: importExcel; cancel-progress: batchOcrProgress.cancel(); retry-progress: retryBatchOCR; continue-progress: continueBatchResults; wait-progress: batchOcrProgress.continueWaiting(); undo: undoLastCourseImport; continue-import: continueBatchImport; finish-import: finishBatchImport | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 501 | ImageCropModal | ImageCropModal | close: showImageCropper = false; cropImageFile = null; confirm: recognizeCroppedImage | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 503 | ImportConflictModal | ImportConflictModal | close: cancelCourseImportReview; decision: setImportDecision; decisions: applyAllImportDecisions; commit: commitCourseImport(); replace-all: commitWholeScheduleReplacement | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 519 | ExceptionsModal | ExceptionsModal | close: showExceptions = false; submit: saveException; remove: removeException | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 530 | SemesterModal | SemesterModal | close: showSemester = false; save: saveSemester | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 545 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/TasksView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 588 | div | 待办 把要做的事情放这里，按截止时间轻松管理。 {{ showHistory ? '返回当前' : `历史 ${counts.archived &#124;&#124; ''}` }} 排序 {{ s.label }} 更多操作 ✦ 一键整理 📋 粘贴通知 ＋ 添加待办 今天到期 {{ works | click: dismissTaskTools | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 595 | button | {{ showHistory ? '返回当前' : `历史 ${counts.archived &#124;&#124; ''}` }} | click: setHistory | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 598 | select | {{ s.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 602 | details | 更多操作 ✦ 一键整理 📋 粘贴通知 | keydown: closeTaskTools | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 603 | summary | 更多操作 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 605 | button | ✦ 一键整理 | click: smartOrganize | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 606 | button | 📋 粘贴通知 | click: openNotice | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 607 | DomainCsvImportButton | DomainCsvImportButton | import: importCsvTasks | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 610 | button | ＋ 添加待办 | click: openAdd | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 617 | button | 今天到期 {{ workspaceSummary.today }} 待完成事项 | click: selectOverview('today') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 618 | button | 已逾期 {{ workspaceSummary.overdue }} 完成或重新安排 | click: selectOverview('overdue') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 619 | button | 未来 7 天 {{ workspaceSummary.week }} 含今天 | click: selectOverview('week') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 620 | button | 待安排日期 {{ workspaceSummary.unplanned }} 给想法安排时间 | click: selectOverview('unplanned') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 630 | button（循环定义） | {{ mode === 'list' ? '列表' : mode === 'board' ? '看板' : '月历' }} | click: setViewMode(mode) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 635 | button | 待安排日期 {{ counts.unplanned }} | click: selectFilter('unplanned') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 636 | button | 已安排 {{ counts.scheduled }} | click: selectFilter('scheduled') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 637 | button | 已完成 {{ counts.done }} | click: selectFilter('completed') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 638 | button | 全部 {{ counts.all }} | click: selectFilter('all') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 645 | input | 搜索待办、课程、备注或下一步 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 645 | button | 清除待办搜索 | click: query = ''; searchQuery.flush('') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 646 | select | 全部优先级 高优先级 普通 低优先级 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 647 | select | 全部日期 今天到期 已逾期 未来 7 天 待安排日期 | change: changePeriod | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 648 | button | 清除筛选 | click: resetWorkspaceFilters | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 651 | EmptyState | emptyInfo.title | primary: emptyAction | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 694 | SwipeActionItem | {{ taskStatus(task) === 'completed' ? '✓' : '' }} {{ task.title }} {{ PRIORITIES[task.priority]?.label ?? '普通' }} {{ taskCourseName(task) }} | update:open: setOpenSwipeItem(task.id, $event); action: handleTaskSwipe($event, task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 704 | article | {{ taskStatus(task) === 'completed' ? '✓' : '' }} {{ task.title }} {{ PRIORITIES[task.priority]?.label ?? '普通' }} {{ taskCourseName(task) }} | click: openEditTask(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 712 | button | taskStatus(task) === 'completed' ? '标记为未完成' : '标记为已完成' | click: toggleDone($event, task.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 725 | button | task.title | click: openEditTask(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 739 | button | 查看关联重要日期 → | click: openRelatedMilestone(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 746 | button | task.workCheckpoint?.nextStep ? `继续齐行任务：${task.title}` : `打开齐行工作台：${task.title}` | click: openProjectTask(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 747 | button | task.workCheckpoint?.nextStep ? `继续待办：${task.title}` : `开始待办：${task.title}` | click: openTaskWorkSession(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 748 | button | 重新安排日期 | click: openReschedule(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 749 | button | 恢复待办 | click: domain.restoreTask(task.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 750 | button | 编辑待办 | click: openEditTask(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 751 | button | 归档待办 | click: archiveTask(task) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 752 | button | 删除待办 | click: deleteTask(task) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 759 | form | 待办内容 * 所属课程或类别 截止日期 截止时间 今天 明天 一周后 暂不安排 未设置日期的事项会留在“待安排日期”，随时可以补上。 优先级 高优先级 普通 低优先级 备注 时长、重复与提醒 按需设置 预计时长（分钟） 实际用时（分钟） 重复 {{ rule.value ===  | submit: save | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 761 | input | 例如：完成高数第三章作业 | input: clearFormError('title') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 764 | input | 选填，可直接输入 | change: linkCourseFromName | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 772 | input | input date | input: clearFormError('dueDate') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 776 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 780 | button | 今天 | click: setFormDueDate(0) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 780 | button | 明天 | click: setFormDueDate(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 780 | button | 一周后 | click: setFormDueDate(7) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 780 | button | 暂不安排 | click: setFormDueDate(null) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 784 | select | 高优先级 普通 低优先级 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 791 | textarea | 选填，记下要求、地点或准备事项 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 794 | summary | 时长、重复与提醒 按需设置 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 796 | input | 选填 | input: clearFormError('estimateMinutes') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 797 | input | 专注计时会自动累计 | input: clearFormError('actualMinutes') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 800 | select | {{ rule.value === 'none' ? rule.label : `${rule.label}（完成后生成下一期）` }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 802 | input | input date | input: clearFormError('repeatEndDate') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 806 | input | `默认提前 ${defaultTaskReminder} 分钟` | input: clearFormError('reminderMinutes') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 814 | button | 删除 | click: remove | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 815 | button | 取消 | click: showForm = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 816 | button | 保存 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 821 | TaskWorkSession | TaskWorkSession | close: closeTaskWorkSession; start: startTaskWork; save: saveTaskWorkProgress; update:field: updateWorkSessionField | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 824 | NoticePaste | NoticePaste | close: showNotice = false; commit: onNoticeCommit | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 831 | ConfirmDialog | 删除待办 | close: deleteTarget = null; confirm: confirmDelete | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 833 | ConfirmDialog | 时间冲突 | close: saveConflict = null; confirm: confirmConflictSave | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 845 | form | 为“ {{ rescheduleTarget.title }} ”选择一个新的截止日期。 新的截止日期 今天 明天 一周后 截止时间（选填） {{ rescheduleError }} 取消 保存日期 | submit: saveReschedule | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 847 | input | input date | input: rescheduleError = '' | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 848 | button | 今天 | click: rescheduleDate = appToday; rescheduleError = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 848 | button | 明天 | click: rescheduleDate = addAppDays(appToday, 1); rescheduleError = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 848 | button | 一周后 | click: rescheduleDate = addAppDays(appToday, 7); rescheduleError = '' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 849 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 851 | button | 取消 | click: rescheduleTarget = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 851 | button | 保存日期 | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 854 | Toast | Toast toast.type | action: () =&gt; {}; close: toast.open = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/TodayView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 352 | button | ↺ 回放 | click: showMemory = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 372 | button | {{ nextUp.kind === 'course' ? '查看课程表' : '查看' }} → | click: openNext | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 373 | router-link | ＋ 新建待办 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 378 | router-link | 查看待办 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 382 | button | {{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }} | click: completeReminder(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 394 | button | {{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }} | click: completeReminder(item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 400 | router-link | 查看回顾 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 406 | button（循环定义） | {{ option.label }} | click: markCourseCheckin(course, option.state) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 413 | router-link | 打开账本 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 429 | router-link | 去安排 → | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 435 | button（循环定义） | `记录心情 ${mood}` | click: chooseMood(mood) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 447 | input | 今日心情备注 | change: updateMoodNote | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 456 | router-link | 管理这条日程 | click: eventDetail = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/TogetherView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 562 | ActionButton | 刷新 | action: () =&gt; refreshCurrentTab() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 566 | button（循环定义） | {{ tab.label }} {{ unreadCount &gt; 99 ? '99+' : unreadCount }} | click: activeTab = tab.id | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 577 | button | 打开账号 | click: accountOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 583 | button | 重试 | click: loadProfile() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 589 | form | 昵称 学校（选填） 时区 {{ zone }} 课表已确认完整至 只有覆盖到已确认完整日期的范围才会参与匹配。 本学期结束日期 结束日期之后不再按每周课表推算课程；日程和考试仍会计入占用时间。 可约时间偏好 每天从 到 最短活动时长 90 分钟 2 小时 3 小时 课程前后缓冲  | submit: saveProfile | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 590 | input | 好友看到的称呼 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 591 | input | 可留空 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 593 | select | {{ zone }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 596 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 600 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 606 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 607 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 609 | select | 90 分钟 2 小时 3 小时 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 612 | select | 不额外缓冲 15 分钟 30 分钟 45 分钟 1 小时 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 614 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 617 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 621 | ActionButton | {{ profileSaving ? '正在保存…' : '保存资料与偏好' }} | 原生展开 / 链接 | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 627 | button | 资料与偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 632 | button | 打开账号设置 | click: accountOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 637 | button | 刷新好友 | click: loadFriends | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 639 | button | 重试 | click: loadFriends | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 641 | button（循环定义） | {{ item.profile?.nickname?.slice(0, 1) &#124;&#124; '友' }} {{ item.profile?.nickname &#124;&#124; '好友' }} {{ item.profile?.school &#124;&#124; '已添加好友' }} {{ selectedFrien | click: selectedFriendId = item.profile.userId; availability = null; selectedSlot = null | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 645 | button | 用邮箱添加好友 | click: activeTab = 'friends' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 651 | select | 未来 7 天 未来 14 天 未来 30 天 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 653 | ActionButton | {{ availabilityBusy ? '正在核对双方课表…' : '查找共同时间' }} | action: () =&gt; queryAvailability(availabilityDays) | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 655 | ActionButton | 重试 | action: () =&gt; queryAvailability(availabilityDays) | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 655 | button | 调整时间偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 657 | ActionButton | 扩大到未来 {{ availabilityDays === 7 ? 14 : 30 }} 天 | action: () =&gt; queryAvailability(availabilityDays === 7 ? 14 : 30) | E：真实任务阶段/预览/取消/重试 | 共享按钮 external |
| 657 | button | 调整时间偏好 | click: activeTab = 'friends'; profileEditorOpen = true | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 663 | button | {{ selectedSlot?.startsAt === slot.startsAt ? '正在编辑邀约' : '选择这个时段' }} | click: chooseSlot(slot) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 669 | form | 邀约给 {{ selectedFriend?.nickname }} 设置具体时间 收起 {{ minutes === 90 ? '90 分钟' : `${minutes / 60} 小时` }} 开始 结束 时间不能超出共同空闲区间。确认时会再次检查双方的课表版本与冲突。 活动 | submit: createInvitation | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 670 | button | 收起 | click: composerOpen = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 672 | button（循环定义） | {{ minutes === 90 ? '90 分钟' : `${minutes / 60} 小时` }} | click: chooseDuration(minutes) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 674 | input | input datetime-local | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 674 | input | input datetime-local | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 677 | select | 一起吃饭 看电影 运动 逛逛 自定义 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 678 | input | activityLabels[inviteType] | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 678 | input | 例如：学校附近 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 678 | input | 补充说明 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 680 | ActionButton | {{ inviteBusy ? '正在核对并发送…' : '确认并发送邀约' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 689 | form | 好友完整邮箱 {{ searchBusy ? '正在精确查找…' : '搜索' }} | submit: searchByEmail | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 689 | input | 输入完整邮箱地址 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 689 | ActionButton | {{ searchBusy ? '正在精确查找…' : '搜索' }} | 原生展开 / 链接 | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 691 | ActionButton | {{ actionBusy === `request-${foundProfile.userId}` ? '正在发送…' : '发送好友请求' }} | action: () =&gt; sendFriendRequest() | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 696 | button | 刷新好友与请求 | click: loadFriends | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 698 | button | 重试 | click: loadFriends | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 701 | ActionButton | {{ actionBusy === `friend-${request.id}` ? '处理中…' : '接受' }} | action: () =&gt; respondFriendRequest(request, 'accept') | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 701 | ActionButton | 拒绝 | action: () =&gt; respondFriendRequest(request, 'reject') | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 704 | ActionButton | 撤回 | action: () =&gt; respondFriendRequest(request, 'withdraw') | C：即时状态；无加载/成功动画 | 共享按钮 external |
| 706 | button | 找时间 | click: selectedFriendId = item.profile.userId; activeTab = 'time' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 706 | button | {{ actionBusy === `remove-${item.profile?.userId}` ? '处理中…' : '移除' }} | click: removeFriend(item.profile) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 712 | button | {{ profileEditorOpen ? '收起' : '修改' }} | click: profileEditorOpen = !profileEditorOpen | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 714 | form | 昵称 学校（选填） 时区 {{ zone }} 课表确认完整至 本学期结束日期 每天开始 每天结束 最短活动时长 90 分钟 2 小时 3 小时 课程缓冲 0 分钟 15 分钟 30 分钟 45 分钟 60 分钟 周末也可约 允许使用完整邮箱精确搜索我 不会公开邮箱；关闭时不会泄 | submit: saveProfile | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 715 | input | input | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 715 | input | input | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 716 | select | {{ zone }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 717 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 718 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 719 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 719 | input | input time | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 720 | select | 90 分钟 2 小时 3 小时 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 721 | select | 0 分钟 15 分钟 30 分钟 45 分钟 60 分钟 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 722 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 723 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 724 | ActionButton | {{ profileSaving ? '正在保存…' : '保存设置' }} | 原生展开 / 链接 | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 730 | ActionButton | {{ notificationsBusy ? '正在更新…' : `全部标为已读${unreadCount ? `（${unreadCount}）` : ''}` }} | action: () =&gt; markNotificationsRead() | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 731 | button | 刷新通知 | click: loadNotifications | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 732 | button | 重试 | click: loadNotifications | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 736 | button | 刷新邀约 | click: loadInvitations | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 737 | button | 重试 | click: loadInvitations | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 746 | ActionButton | {{ actionBusy === `invite-${invite.id}-accept` ? '正在复核…' : '接受邀约' }} | action: () =&gt; runInvitationAction(invite, 'accept') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 746 | ActionButton | 不能参加 | action: () =&gt; runInvitationAction(invite, 'decline') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 746 | button | {{ proposalInviteId === invite.id ? '收起改约' : '提出一个改约' }} | click: openProposalPicker(invite) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 747 | ActionButton | 接受改约 | action: () =&gt; runInvitationAction(invite, 'accept_change') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 747 | ActionButton | 拒绝改约 | action: () =&gt; runInvitationAction(invite, 'reject_change') | A：明确提交；结果以真实写入为准 | 共享按钮 external |
| 748 | button | 取消邀约 | click: cancelInvitation(invite) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 754 | button（循环定义） | {{ formatTime(option.startsAt) }} – {{ formatClock(option.endsAt) }} · {{ proposalMinMinutes }} 分钟 | click: proposalOptions = [option]; runInvitationAction(invite, 'propose_change') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 755 | button | 扩大到未来 {{ proposalDays === 7 ? 14 : 30 }} 天 | click: expandProposalDays(proposalDays === 7 ? 14 : 30) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 759 | button | 查找共同时间 | click: activeTab = 'time' | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 763 | ConfirmDialog | 移除好友 | close: friendRemovalTarget = null; confirm: confirmRemoveFriend | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 772 | ConfirmDialog | 取消邀约 | close: invitationCancellationTarget = null; confirm: confirmCancelInvitation | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/WeeklyReviewView.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 99 | router-link | 回到今天 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/BillFormModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 8 | select | 从模板套用 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 17 | button | `删除账单模板「${template.name}」` | click: removeBillTemplate(template.id) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 22 | button | 存为模板 | click: saveBillAsTemplate | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 26 | input | 例如：ChatGPT Plus、话费 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 38 | input | 固定账单金额 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 52 | select | {{ c.label }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 59 | select | 按名称自动识别 {{ category.icon }} {{ category.name }} | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 67 | input | input date | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 77 | select | 当天 1 天 3 天 7 天 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 92 | input | 补充套餐、用途等信息 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 97 | input | 留空则用默认账户 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 102 | select | 固定账单使用的币种 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 109 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 114 | input | input checkbox | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 122 | button | 删除 | click: requestDelete | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 123 | button | 取消 | click: formOpen = false | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 124 | button | 保存 | click: saveBill | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 129 | ConfirmDialog | 删除固定账单 | close: deleteBillTarget = null; confirm: confirmDeleteBill | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/BillsPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 27 | button | ＋ 添加固定账单 | click: openBillForm() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 30 | EmptyState | 还没有固定账单 | primary: openBillForm() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 53 | div（循环定义） | {{ bill.name }} {{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }} · {{ bill.note }} {{ billAmountText(bill) }} / {{ cycles[bi | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 61 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 74 | button | 已支付 | click: markPaid(bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 75 | button | 跳过本次 | click: dismissPending(bill); skipOnce(bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 85 | div（循环定义） | {{ bill.name }} {{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }} {{ billAmountText(bill) }} / {{ cycles[bill.cycle]?.short ? | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 93 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 106 | button | 跳过本次 | click: skipOnce(bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 116 | div（循环定义） | {{ bill.name }} 已暂停 · 下次 {{ bill.nextDate }} {{ billAmountText(bill) }} 恢复 | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 124 | button | `编辑固定账单「${bill.name}」` | click: openBillForm({}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 137 | button | 恢复 | click: toggleBillActive(bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/BudgetSettingsModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 7 | input | `月度预算金额（${baseCurrency}）` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 13 | button | 清除预算 | click: removeBudget | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 14 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 15 | button | 保存预算 | click: commitBudget | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/FxSettingsModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 9 | input | `1 ${row.code} 等于多少 ${baseCurrency}` | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 13 | button | 删除 {{ row.code }} | click: removeRow(row.code) | D：沿用确认、撤销或原有危险状态 | 原有状态 / 统一基础反馈 |
| 20 | input | 要添加的币种代码 | 原生输入 / v-model | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 24 | button | 添加到列表 | click: addRow | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 32 | button | 取消 | click: emit('close') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 33 | button | 保存汇率 | click: commit | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/LedgerBudgetCard.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 38 | button | {{ props.budget.monthly === null ? '设置预算' : '预算设置' }} | click: emit('open-budget-settings') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 87 | summary | 额度怎么算 | 原生展开 / 链接 | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/LedgerHomePanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 112 | button | 查看全部记录 | click: $emit('show-all-feed-change', true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 127 | button | 汇率设置 | click: $emit('open-fx-settings') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 140 | button | ＋ 记一笔 | click: $emit('open-quick') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 147 | div（循环定义） | {{ bill.name }} {{ billAmountText(bill) }} · {{ billDateLabel(bill.nextDate) }} · {{ bill._s.text }} 已支付 ✕ | click: $emit('open-bill-form', {}, bill.id); keydown: $emit('open-bill-form', {}, bill.id); keydown: $emit('open-bill-form', {}, bill.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 161 | button | 已支付 | click: $emit('mark-paid', bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 162 | button | 暂时隐藏这条账单提醒 | click: $emit('dismiss-pending', bill) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 172 | button | 管理分类 | click: $emit('open-category-manager') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 175 | button（循环定义） | {{ catInfo(item.cat).icon }} {{ item.name }} {{ moneyRow(item.amount, item.currency &#124;&#124; baseCurrency) }} | click: $emit('use-frequent', item) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 187 | input | 搜索账本记录 | input: e =&gt; $emit('update-q', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 188 | button | 打开账本筛选 | click: $emit('toggle-filters') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 189 | button | 清除搜索与筛选 | click: $emit('clear-filters') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 193 | button | 全部时间 | click: $emit('update-f-range', 'all') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 194 | button | 今天 | click: $emit('update-f-range', 'today') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 195 | button | 本周 | click: $emit('update-f-range', 'week') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 196 | button | 本月 | click: $emit('update-f-range', 'month') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 197 | button | 自定义 | click: $emit('update-f-range', 'custom') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 200 | input | 筛选起始日期 | input: e =&gt; $emit('update-f-from', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 200 | input | 筛选结束日期 | input: e =&gt; $emit('update-f-to', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 203 | select | 筛选分类 | input: e =&gt; $emit('update-f-cat', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 207 | select | 筛选账户 | input: e =&gt; $emit('update-f-account', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 211 | input | 筛选最低金额 | input: e =&gt; $emit('update-f-min', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 212 | input | 筛选最高金额 | input: e =&gt; $emit('update-f-max', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 213 | select | 筛选记录来源 | input: e =&gt; $emit('update-f-kind', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 218 | select | 筛选收支类型 | input: e =&gt; $emit('update-f-direction', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 224 | select | 筛选币种 | change: $emit('update-f-currency', $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 248 | button | CSV | click: $emit('export-filtered-csv') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 249 | button | {{ exporting ? '正在导出…' : '导出结果' }} | click: $emit('export-filtered-xlsx') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 251 | button | 查看全部（ {{ filteredExpenses.length }} ） | click: $emit('show-all-feed-change', true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 252 | button | 收起 | click: $emit('show-all-feed-change', false) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 255 | EmptyState | filtersActive ? '没有符合条件的记录' : '还没有记录' | primary: $emit(filtersActive ? 'clear-filters' : 'open-quick') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 287 | SwipeActionItem | {{ e.category.icon }} {{ e.transaction.name }} {{ feedSecondary(e.transaction, e.category) }} {{ feedAmount(e.transaction) }} | swipe: $emit('transaction-swipe', e.transaction.id, $event); action: $emit('swipe-action', e.transaction.id, $event); update:open: $emit('swipe-open-change', e.transaction.id, $event) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 308 | div | `查看「${e.transaction.name}」的详情` | click: $emit('open-detail', e.transaction.id); keydown: $emit('open-detail', e.transaction.id); keydown: $emit('open-detail', e.transaction.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 334 | button | 查看回顾 | click: $emit('switch-tab', 'review') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 339 | button（循环定义） | `${bar.info.name} 本月 ${moneyRow(bar.value)}，查看这个分类的明细` | click: $emit('open-review-category', bar.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/MonthlyTrendCard.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 184 | button（循环定义） | {{ range }} 个月 | click: setRange(range) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 187 | button | `查看前 ${trendRange} 个月` | click: shiftPeriod(-1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 189 | button | `查看后 ${trendRange} 个月` | click: shiftPeriod(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 191 | button | 返回近期 | click: emit('range-end-change', todayMonth) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 209 | button（循环定义） | monthLabel(row) | click: clickMonth($event, row.month); pointerenter: previewPointerMonth($event, row.month); pointerdown: beginMonthGesture($event, row.month); pointermove: moveMonthGesture; pointerup: finishMonthGesture($event, row.month); pointercancel: cancelMonthGesture; focus: previewFocusedMonth($event, row.month); keydown: onMonthKeydown($event, index) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 220 | button | 查看月度回顾 → | click: selectMonth(activeMonth.month) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/QuickEntryModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 202 | button | ⚡ 用一句话记 | click: openQuickRecord | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 205 | input | 金额 | input: e =&gt; { localAmountInput = e.target.value; $emit('update:amountInput', e.target.value) }; keydown: saveExpense(keepAdding) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 222 | button | 支出 | click: setDirection('expense') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 223 | button | 收入 | click: setDirection('income') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 225 | input | 记录名称 | input: e =&gt; { $emit('update:nameInput', e.target.value); onNameInput(e.target.value) }; keydown: saveExpense(keepAdding) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 237 | button | 选择分类 | click: $emit('update:moreOpen', true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 245 | button | 取消 | click: $emit('update:dupWarn', false); $emit('update:nameInput', '') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 246 | button | 仍然记录 | click: $emit('update:forceDup', true); saveExpense(keepAdding) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 253 | button | 只记录一次 | click: $emit('update:cycleSuggest', null) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 254 | button | 创建固定账单 | click: createBillFromSuggest | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |
| 258 | button | {{ moreOpen ? '收起' : '更多' }} {{ moreOpen ? '▴' : '▾' }} | click: $emit('update:moreOpen', !moreOpen) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 264 | button（循环定义） | {{ c.icon }} {{ c.name }} | click: selectQuickCategory(c.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 272 | button | {{ showAllQuickCategories ? '只显示常用' : '全部分类' }} | click: $emit('update:showAllQuickCategories', !showAllQuickCategories) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 276 | input | input date | input: e =&gt; $emit('update:dateInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 277 | input | input time | input: e =&gt; $emit('update:timeInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 278 | input | 可不填，默认账户 | input: e =&gt; $emit('update:accountInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 280 | select | 这笔记录使用的币种 | input: e =&gt; { localCurrencyInput = e.target.value; $emit('update:currencyInput', e.target.value) } | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 285 | input | 备注 | input: e =&gt; $emit('update:noteInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 288 | input | 参与人数 | input: e =&gt; { localSplitCount = e.target.value; $emit('update:splitCount', e.target.value) } | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 289 | input | splitMode === 'custom' ? '我承担的份额' : '我承担的份额（自动计算，只读）' | input: e =&gt; $emit('update:splitMine', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 291 | input | input checkbox | change: $emit('update:splitMode', $event.target.checked ? 'custom' : 'equal') | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 297 | ActionButton | {{ editingId ? '保存修改' : keepAdding ? '记下一笔' : '记下' }} | action: () =&gt; saveExpense(keepAdding) | B：频繁操作；短反馈或既有保存状态 | 共享按钮 external |
| 302 | button | {{ keepAdding ? '完成' : '连续记' }} | click: keepAdding ? closeQuick() : saveExpense(true) | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/ReviewPanel.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 80 | button | 上一个月 | click: shiftMonth(-1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 82 | button | 下一个月 | click: shiftMonth(1) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 83 | input | 选择回顾月份 | change: emit('jump-to-month', $event.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 85 | button | 导出 CSV | click: exportLedgerCsv() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 86 | button | {{ exporting ? '正在导出…' : '导出 Excel' }} | click: exportLedgerXlsx() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 89 | button | 导出全部历史账单，不限当前月份 | click: props.exportAllLedgerXlsx() | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 125 | button | `花得最多：${catInfo(topCategory.cat).name} ${moneyRow(topCategory.total)}，点开看明细` | click: revealReviewCategory(topCategory.cat) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 134 | button | `最大一笔：${maxSingle.name} ${moneyRow(maxSingleMine)}，查看详情` | click: openDetail(maxSingle.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 168 | button | `${row.info.name} ${moneyRow(row.value)}，${row.count} 笔，占 ${row.pct}%，${expandedCategory === row.key ? '已展开明细' : '点开看明细'}` | click: toggleReviewCategory(row.key) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 185 | button（循环定义） | `查看「${e.name}」的详情` | click: openDetail(e.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 201 | button | 展开其余 {{ hiddenCategoryCount }} 个分类 | click: $emit('update:showAllReviewCats', true) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 202 | button | 只显示前 {{ categoryLimit }} 个 | click: $emit('update:showAllReviewCats', false) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 212 | button | cellLabel(cell) | click: $emit('selected-day-change', selectedDay === cell.day ? null : cell.day) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 232 | div（循环定义） | `查看「${e.name}」的详情` | click: openDetail(e.id); keydown: openDetail(e.id); keydown: openDetail(e.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |

### src/views/ledger-panels/TransactionDetailModal.vue

| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |
| --- | --- | --- | --- | --- | --- |
| 90 | input | 修改金额 | input: e =&gt; $emit('update:detailAmountInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 91 | select | 修改分类 | input: e =&gt; $emit('update:detailCategoryInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 92 | input | 修改日期 | input: e =&gt; $emit('update:detailDateInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 93 | select | 修改币种 | input: e =&gt; $emit('update:detailCurrencyInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 96 | input | input checkbox | change: $emit('update:applySameNameCategory', $event.target.checked) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 103 | button | 取消 | click: $emit('cancel-detail-edit') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 104 | button | {{ applySameNameCategory && sameNameCategoryCount ? `保存并更新 ${sameNameCategoryCount} 笔分类` : '保存修改' }} | click: $emit('save-detail-edit') | B：频繁操作；短反馈或既有保存状态 | 原有状态 / 统一基础反馈 |
| 121 | button | {{ refundOriginal.name }} · {{ refundOriginal.date }} · {{ moneyWithCurrency(refundOriginal.amount, refundOriginal.currency &#124;&#124; baseCurrency) | click: $emit('open-related-record', refundOriginal.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 125 | button（循环定义） | {{ entry.date }} · + {{ moneyWithCurrency(entry.amount, entry.currency &#124;&#124; baseCurrency) }} | click: $emit('open-related-record', entry.id) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 129 | button（循环定义） | {{ action.label }} | click: $emit(action.handler) | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 139 | input | 退款金额 | input: e =&gt; $emit('update:refundAmountInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 140 | input | 退款日期 | input: e =&gt; $emit('update:refundDateInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 141 | input | 可选，例如：平台退款到账 | input: e =&gt; $emit('update:refundNoteInput', e.target.value) | C：即时状态；无加载/成功动画 | 就地编辑 / 校验 |
| 143 | button | 取消 | click: $emit('close-refund') | C：即时状态；无加载/成功动画 | 原有状态 / 统一基础反馈 |
| 143 | button | 确认退款 | click: $emit('confirm-refund') | A：明确提交；结果以真实写入为准 | 原有状态 / 统一基础反馈 |

<!-- INTERACTION_INVENTORY:END -->
