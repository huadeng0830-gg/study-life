// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年09月24日-版本2',
    signature: '1115d267e9',
    notes: [
      '阶段2（布局修复）：任务胶囊断点从 min-width:900 改为 901，消除与底栏 max-width:900 在恰 900px 视口重叠；移动端胶囊/内容底部统一 86px 浮起高度（原先 76/84 与 Toast 三套数）；.content/.content-mid/.content-narrow、Modal 头身脚、ActionSheet 遮罩横向补 safe-area-inset-left/right（横屏刘海不再顶边），ActionSheet max-height 扣除 top 安全区；删除 App.vue 两处空 @media；skip-to-content 提到 301 盖过全局错误提示 300；层叠阶梯注释补全 110/130/200/301 档位与右键菜单低于告警层的理由',
    ],
  },
  {
    version: '2026年09月24日-版本1',
    signature: 'e459d185f7',
    notes: [
      '阶段1（无障碍全量修复）：清理裸 outline:0/none，保留 :focus-not(:focus-visible) 正确形式并让全局 :focus-visible 焦点环在容器类上生效；补齐 24px 最小命中区（记录头/收件箱操作/Toast按钮/自然条目链接等），粗指针下由 tap-target 兜底到 44px；审计盲区收口——新增同规则写死字色+写死底判据 sameRuleHardCodedOffenders 并接入主流程与 JSON 输出，修复其抓出的 7 处违规（复选框绿底、课程同步青、补课紫标签等）',
      '新增 tests/contrastAudit.test.js 同规则盲区 describe（全仓零违规、判据非空转、fixture 自证），contrast/touchTarget/accessibleNames 守卫全绿',
    ],
  },
  {
    version: '2026年09月21日-版本1',
    signature: '0afce96a67',
    notes: [
      '账本回顾页的「分类分布」原来只列前 5 名：第 6 名以后的分类在页面上完全不存在，整月合计把它们的钱算了进去，用户却永远看不到那个分类花了多少。现在所有分类都在列表里，多出来的用「展开其余 N 个分类」放出，每一行同时给出占比与笔数',
      '每一行分类现在是可以点开的明细入口：点一下展开这个分类当月的每一笔（按金额从大到小），点某笔直接打开它的记录详情；金额仍是「我承担」的份额口径，与上方合计、下方月历同源，分摊记录的总额不会混进这一屏',
      '概览卡里的「花得最多」与「最大一笔」不再是死数字：前者展开下方对应分类的明细，后者直接打开那一笔的详情',
      '首页「本月分类」的每一行也能点了：跳到回顾页并把该分类的明细展开好，并自动拨回本月（首页那块永远是本月，回顾页可能被翻到别的月份）；卡片同时说明本月还有几个分类没显示',
      '换月收起下钻，并新增 tests/ledgerReviewCategories.test.js：第 6 名以后能否看到金额并收回、点分类展开明细、点明细行打开详情、金额必须是份额而不是总额、两个概览入口直达、首页跳转与换月收起，共 8 条 DOM 级回归',
    ],
  },
  {
    version: '2026年09月20日-版本59',
    signature: '6214abaccc',
    notes: [
      '修好「iPhone/iPad 上打开就是『页面没有完整加载』、点『重新加载』也没用，而电脑上完全正常」：启动路径里「按时段预测预加载」那两处裸调了 requestIdleCallback，iOS Safari 长期没有这个 API（17.4 以前完全没有），于是它在 bootstrap() 里抛 ReferenceError，被 .catch() 判成启动失败 → 注销 Service Worker 加清缓存并整页重载 → 重载仍然抛（时段没变）→ 自动恢复预算用尽 → 弹出致命错误页；手机上再点『重新加载』也只是再来一遍。现在统一走 whenIdle()：浏览器有空就空闲执行，没有该 API 就退化成 setTimeout，预热晚一点不影响任何功能',
      '可选预热不再能拖垮启动：更新检查、鼠标悬停预加载、按时段预测预加载整体包了一层异常兜底；并且界面挂载之后再抛出的异常不再按启动失败处理（不清缓存、不整页重载），也不会把已经在运行的界面换成错误页——之前那样做会毁掉一个本来能用的界面，还会在控制台刷出一屏 Vue 的 Cannot read properties of null reading insertBefore 补丁错误',
      '新增发布自检 npm run audit:iphone-boot：真 Chrome 注入「删掉 requestIdleCallback 并把钟点钉在晚上 20 点」，在 iPhone 视口下断言首屏能打开且不出现致命错误页；这个检查不随一天中的时间时红时绿，它本身就是这次回归的守卫（修复前 RED、修复后 GREEN）',
      '修复的差分证据：缺 requestIdleCallback 且 20 点 RED、缺它且 12 点（不进预加载分支）GREEN、缺它且 8 点 RED、有这个 API 且 20 点（桌面）GREEN —— 单变量即可翻转结论，根因就是那两行裸调',
      '同一类缺陷还有一道静态守卫 tests/safariApiGuards.test.js：扫 src 全部 js 与 vue，未守卫的 requestIdleCallback 调用直接判红，并先用故障原文自证判别力（拿那两行喂进同一检测函数必须先红）；行为守卫是 audit:iphone-boot，静态守卫进 npm run check',
    ],
  },
  {
    version: '2026年09月20日-版本58',
    signature: '9da2c065a7',
    notes: [
      '修好「用例全绿但 npm test 偶发 exit 1」：影子副本的 240ms 防抖加失败无限退避在 happy-dom 下永远失败、永远挂着定时器，最后一个用例跑完、环境尚未拆除的那条缝里它照样冲刷并 console.warn，这声没有归属的 console 被 vitest 计成 EnvironmentTeardownError（Errors 1 error）；现在 dataVault 增加宿主守卫（宿主消失或被换掉就丢弃这批写盘）、把待写盘定时器按 window 登记、并导出仅供测试收尾调用的 cancelPendingMirrorWrites()，另加 tests/helpers/mirrorTeardown.js 与 29 个实测会写影子副本的测试文件收尾登记',
      '影子写盘新增 5 条回归守卫（3 条宿主守卫、2 条收尾取消，含 vi.resetModules 之后旧实例遗留定时器也能取消）；把取消实现临时改成空实现时该文件 2 failed / 9 passed、恢复后 11 passed；完整修复后 6 次空闲全量与 3 次 8 路 CPU 争用全量都是 1824 条全绿 exit 0，用例外冲刷从 35 次降到 0 次',
      '新增发布自检三件套（scripts/audit/，npm run audit:release / audit:first-visit / audit:reload-loop）：release-integrity 检查已部署站点的 index.html 引用、所有 JS 内部出现的分包名（懒加载分包名只写在 JS 里，最容易漏）与 sw.js 预缓存清单是否都能 200；first-visit 用 CDP 数全新 profile 首访的主框架导航次数与控制台错误；reload-loop 故意让某个分包 404，验证不会无限刷新且用户能看到失败界面，README 有用法与 RED 含义说明',
      '自检装置本身也做了反向验证：分包缺失、预缓存清单解析为空都判 RED 并非零退出；把无条件 reload 注入产物时给出 704 次加载 / RED，证明闸门不是空断言；退出码统一 0=GREEN、1=RED、2=环境或装置问题',
      '顺带修掉一个靠运气绿的测试：App.vue 是挂载后延迟 900ms 才弹更新说明，而 tests/updateNotesModal.test.js 原来的等待预算只有约 400ms（80 次乘 5ms 的睡眠），此前能过只是因为 happy-dom 下轮询的真实墙钟开销把总时长撑过了 900ms；本次 bump 改变模块图后它确定性翻红（单独跑也 2 failed），现改为按真实时钟等待且预算明显大于 900ms —— 压到 200ms 时确定性红、4000ms 时连续 3 次全绿，断言一字未改',
    ],
  },
  {
    version: '2026年09月20日-版本57',
    signature: '7eba59838f',
    notes: [
      '修好手机端「打不开、一直在刷新首页」的无限刷新：分包 404 / 懒加载资源缺失时 App 依然挂载得起来，而启动资源恢复的预算在挂载成功后被 clearPwaStartupRecovery() 清空，于是形成闭环「资源失败 → 注销 SW + 清缓存 + 重载 → 挂载成功 → 清空预算 → 资源仍失败」，真 Chrome 实测约 110ms 一轮、22 秒近 200 次重载',
      '现在预算改为记录在 localStorage 的 10 分钟时间窗内（最多 2 次），重载不会清空，用满即停止自动重载并显示「页面没有完整加载、本机数据没丢」的失败界面；预算只在用户点「重新加载」时清空（显式操作仍然可以再试）',
      '新增回归测试：tests/pwaStartupRecovery.test.js 三条守卫（持续失败最多自动重载两次就停、超出时间窗后允许再次恢复、无 localStorage 的隐私模式退回每会话一次且仍不无限刷新）；同一个真 Chrome 复现装置里打断首页分包，修复前 22 秒加载近 200 次，修复后 2 次即停',
    ],
  },
  {
    version: '2026年09月20日-版本56',
    signature: 'd11a2b868f',
    notes: [
      '通读审计修复：NotesView.vue 补上缺失的 flushStoredWrites 导入，修复笔记保存时 ReferenceError',
    ],
  },
  {
    version: '2026年09月20日-版本55',
    signature: 'ea4e597d33',
    notes: [
      '修好「账本里删掉消费记录不消失、刷新一次才没了」的根因：显式提交的性能改造把集合换成 shallowRef 后，push/splice/就地改字段都不通知依赖，touchStoredRef 当时只排写盘不通知视图——现在它同时 triggerRef，提交即刷新界面；sl_expenses/sl_events 因此**保留**在显式提交集合里（不是改成深层 watch），性能意图与正确性两者都保住；confirmDialogMigration 两个真 Bug 同时落地：笔记删除确认、冲突保存确认真落盘（sl_quick_notes 本来就走深层 watch）；16 项体验优化全部落地：PWA 缓存 5MB、content-visibility 扩展、VirtualList 自适应阈值、TS strict、存储批量写入、LedgerView 懒加载拆分、shallowRef 显式提交、云同步增量推送、键盘快捷键修复、Toast 优先级队列、减少动效 transition:none、高对比度焦点环、实时区域去重、跳过链接 i18n、差异化防抖、智能预加载；原先标记 skip 的 2 个「happy-dom VirtualList+async 渲染限制」测试经复测是误诊——真因就是显式提交不通知视图，摘掉 triggerRef 时它们必红、装上必绿（连跑 5 次稳定），现已解封，全量 1815 条 0 skip',
    ],
  },
  {
    version: '2026年09月20日-版本54',
    signature: '80fab481e3',
    notes: [
      '修好「账本里删掉消费记录不消失、要刷新一次才没了」：显式提交的性能改造把这些集合换成了 shallowRef，而 push/splice/就地改字段都不会通知依赖，touchStoredRef 当时只排写盘、不通知视图——于是数据存对了、界面永远停在旧值；现在它在排写盘的同时 triggerRef，提交即刷新界面',
      '受影响的不止账本：待办、日程、账单、考试、课程、清单、专注、预算等 14 个集合共用这套机制（EXPLICIT_COMMIT_KEY_LIST），勾选、删除、编辑现在都会立刻反映到界面，不再需要刷新',
      '新增两条守卫：tests/ledgerDeleteVisibility.test.js（详情删除、左滑删除、当场新增、撤销都必须当场可见，并写明行标题含分类图标这个断言陷阱）与 tests/storeExplicitCommitSeam.test.js（遍历集合清单守「提交后依赖必须重算」，以后往清单里加键自动被守上）；把 triggerRef 摘掉时 21 条里 20 条变红',
      '全量 1813 条测试通过（173 个文件），lint 与 typecheck 无告警',
    ],
  },
  {
    version: '2026年09月20日-版本53',
    signature: '64a8289d23',
    notes: [
      '修好分摊口径「算得出但不生效」：此前账本首页的今天/本周/本月花费在分摊记录下仍按总额统计（模板里误写成 mySpendPeriodStats.value，而 script setup 的 computed 在模板中自动解包，条件恒假、分摊分支永不渲染），现在三块数字按「我承担」的份额计入',
      '列表金额改为显示「我承担」的份额，这一笔的总额与人数移到副标题（已分摊 N 人 · 共 ¥xx）；日期头当日支出、本月分类、回顾页合计/分类/月历/最大一笔、周回顾与预算预警、汇率折算行一并统一到同一口径',
      '导出 CSV/Excel 新增「我承担」列（紧邻「金额」列），记录详情同时给出总额与「我承担 ¥xx（N 人）」：总额与分担两个口径都看得到，金额列与既有导出一字未改',
      '顺带修正本周区间：原先拿「本月 1 号所在的那一周」当本周、且用本地午夜的 Date 与 UTC 边界相比（东八区会漏掉周一整天），改为按日期键推算当前自然周；新增 tests/ledgerSplitDisplay.test.js 渲染级守卫，全量 1794 条测试通过',
    ],
  },
  {
    version: '2026年09月20日-版本52',
    signature: '27ffe7e5bc',
    notes: [
      '简化分摊体验：去掉「报销分摊」开关，直接显示人数输入框（默认 1 人）；输金额+人数即时算「我承担」（两位小数，余数归首位），支出始终写入 split.mine，收入不分摊',
      '连续记账保留人数设置，仅按新金额重新等分；汇总口径 mySpendCents 自动读取 split.mine 作为个人实际承担',
      '首页「花费概览」新增分摊感知统计：检测到有分摊记录时自动切换显示「今天承担/本周承担/本月承担」，并提示可查看全额',
      '同步更新 ledgerFeaturesDom.test.js 断言',
    ],
  },
  {
    version: '2026年09月20日-版本51',
    signature: 'db8fce779c',
    notes: [
      '清掉 157 条不可达的 scoped 死规则（App.vue/TodayView/ScheduleView/AppearanceSettings/LedgerView），保留 5 条有据可查的残留',
      '修好剥注释器的地基：认得正则字面量 + 引号必须找得到配对（三份棘轮），消掉 LedgerView 之后 2711 行的假阳性',
      '两条断言改为守规则真正生效的那个组件，不再守一份永不生效的死副本',
    ],
  },
  {
    version: '2026年09月20日-版本50',
    signature: '35b81eb14b',
    notes: [
      '浮层层叠顺序改由打开顺序决定：Modal 按浮层栈深度写内联 z-index（100…109），上界不越半屏面板、菜单与同步告警',
      'App.vue 清掉一批永远匹配不到节点的 scoped 死规则，并新增可达性守卫；同类残留 156 条已登记为只准缩小的棘轮',
      '最后一处原生弹窗退场：账本「修改分类名称」改用应用内输入对话框（可访问名、Enter 确认、Escape 取消）',
      '修复「一键生成回顾笔记」：此前该按钮点了必然抛错，现在真的生成笔记并显示内联提示',
      '删掉作息设置里一个零引用的死函数（它会在打开时把面板分区复位）',
    ],
  },
  {
    version: '2026年09月20日-版本49',
    signature: 'f2230b336a',
    notes: [
      '第五十四轮：交接文档 §3.2 的六项产品决策全部落地——window.confirm 对话框迁移（24 处）、模态框分区持久化、设计令牌导出修复、≤900px 侧边栏抽屉化、聚焦态返回列表、叙事多语言；另加账本四功能与农历纪念日',
      '设计令牌导出修掉一个真缺陷：解析器不剥注释，于是注释里「已删除的 --radius-m」被当成真声明复活、紧随其后的真声明 --focus-ring 被吞掉；修前修后默认主题都是 40 个令牌，所以按数量写的检查永远看不见它',
      '侧边栏抽屉的第一版把「右划关闭」读错了：左锚 + 跟手向右 + 出场向左构成方向反转；改为右锚后把「跟手方向 == 出场方向」写成不变量。另修层叠缺口——抽屉根节点打开态抬到 95（介于任务胶囊 90 与弹窗遮罩 100 之间的唯一空档），且必须写成复合选择器，否则会输给 App.vue 里特异性相同的 scoped 规则',
      '农历纪念日的内存镜像只在首次读取时补水，而云同步合并不刷新页面（备份恢复与本地迁移导入都会 reload），于是拉取云端数据后设置面板显示新数据、首页仍按旧镜像点亮；改成每次读取比对存储原始串，并在存储层写入边界补一次发布来保证响应式',
      '账本新增多币种（手工汇率、不联网、无历史汇率）、月度预算预警、报销分摊与账单模板：既有四个聚合函数一行未改，同批记录加不加新字段跑两遍，索引与汇总结果逐字相等；缺汇率的记录明示而不按 1:1 计入，分摊不新增存储键',
      '存储损坏矩阵从 174 条扩到 198 条（41 个 sl_* 键 × 顶层 + 嵌套变体 × 2 条路由）：5 个新键全部登记进云同步、备份、本地迁移与应急导出；仍未改任何既有 sl_* 键的语义',
    ],
  },
  {
    version: '2026年09月20日-版本48',
    signature: '194ea04ced',
    notes: [
      '第五十三轮：把存储损坏矩阵从 10 键 × 2 变体扩到全部 36 键 × 3 变体 × 2 路由，共 174 条用例；补上被漏掉的第三类变体——嵌套形状损坏（顶层合并放行的那一类）',
      '扩矩阵当场抓到真缺陷：sl_timecfg 被塞成 periods 不是数组的对象时，normalizeTimes 在模块求值期抛 periods.map is not a function，而调用它的那一行在 useStoredRef 读 try/catch 之外，任何应用级错误边界都接不住，表现是启动即白屏',
      '根因是两层叠加：loadTimeConfig 先把 localStorage 合进默认值，随后 normalizeStoredValue 的顶层合并又把原始损坏值盖回来；而 normalizeTimes 只校验了 times，没校验 seasons/campuses/periods，形状修复只做到一半',
      '修法：normalizeTimes 对这三个数组做与 times 同一套形状修复（形状不对就回落默认值并标记 changed），不改 sl_timecfg 的存储语义，也不在模块顶层加会掩盖真回归的兜底 catch；落盘靠 useStoredRef 的 baselineRaw 比对而非该返回值',
      '判别力证据：修之前恰好 6 条红（3 个字段 × 2 条路由）、其余 168 条绿；修之后 174 条全绿，且 36 键 × 2 个顶层变体全部绿——说明顶层损坏确实已被兜住，缺的只是嵌套这一层',
    ],
  },
  {
    version: '2026年09月20日-版本47',
    signature: '489ebd3e53',
    notes: [
      '先用可信的 CSS 规则切分器（scripts/css-rules.mjs）替换掉我两次写坏的解析：栈式花括号配对、先剥注释再掩字符串、显式记录上下文、偏移是原文偏移可 slice 回整条规则',
      '切分器自身也有 bug 被我抓到：选择器取自原文 prelude，于是上一轮插在 .skin-notebook 前的注释被算进了选择器',
      '实测 ScheduleView.vue 有 19 条同上下文逐字重复的规则，都是第三十七轮恢复时整段搬入留下的。删掉后产物规则集合完全相同（0 凭空出现、0 丢失）',
      '但我把极性选反了：脚本删的是后出现的那份，而"同值重复"里后出现的那份恰恰是会赢的那份。穷举检查发现一对同特异性、共享类名、都设 background 的规则顺序因此翻转（.skin-notebook .tt-cell 与 .tt-cell:hover,.tt-cell.isToday），会改变笔记本皮肤下悬停格子的底色',
      '所以先前的"删掉不改变任何声明"是错的，已改正：把 .skin-notebook .tt-cell 移回它最后一次出现的位置，恢复去重前的级联，并在 tests/cssRules.test.js 里加了针对性顺序判据',
      '删除的安全闸门：被删规则里若含注释就跳过（注释是给人看的记录，绝不静默删掉）',
    ],
  },
  {
    version: '2026年09月20日-版本46',
    signature: '79781e6b71',
    notes: [
      '§4 第 22 条：第三十七轮我用正则清理死类时把 6 个文件约 259 条规则切碎，但在构建报错之前注释已经被同一批正则吃掉——注释不影响解析，删掉后构建照样通过、测试照样全绿，这种破坏一点症状都没有',
      '先说清现状（与预期不同）：我以为说明注释只补了四个文件，实测六个都有；真正的缺口是注释的实质——六个文件加起来只剩 7 条 CSS 注释',
      '把能证明的解释补回来（7→16 条，逐处核实不编理由）：层叠阶梯与跳转链接必须在最上层、vh 兜底与 dvh 孪生、安全区配套、.focus-clock 的 clamp 下界为何是可证大字、.data-section 的 58px 对应哪个守卫、.skin-* 是动态拼接不能当死类、.pending-row 是可点击行的故意保留',
      '没写的一处：DataManager .health-largest 的 font-size:10.5px!important 到底在覆盖哪条规则代码里看不出来，宁可不写也不编理由',
      '上棘轮 tests/styleComments.test.js：6 个受损文件各有注释下限、全仓总数下限（实测 131）、6 个重建过的样式块必须保留原注释丢失的说明。想合法减少就得来改数字——让"注释没了"必须被意识到而不是静默发生',
      '同一个坑踩到第四次和第五次：App.vue 模板注释里的字面量 <style> 会骗到计数器，content 字符串里的注释符号要先掩掉，两条都做成了夹具',
      '第六次更妙且发生在我自己身上：测试文件的文档注释里为了举例写了注释符号的完整形式，那个 */ 提前终结了块注释，整个文件语法错误、一条用例都收集不到——关于注释的注释也要遵守注释的规则',
      '顺带发现一个真问题但故意没修：ScheduleView 的 .skin-notebook 一族有两份逐字相同、都在顶层。我的探针还声称共 15 组，但那个探针的切分被证明不可信（会把相邻规则片段粘在一起）。第三十七轮的事故正是"在不可信的解析上做破坏性扫除"，所以只记成 §4 第 23 条',
    ],
  },
  {
    version: '2026年09月20日-版本45',
    signature: '893f6ddba5',
    notes: [
      'WCAG 1.4.3 里大字只要 3:1、正文要 4.5:1，而跨规则判定器只看颜色读不到字号，对大字也按正文从严——这既是 §4 第 15 条列的最后一种假阴性，也意味着判定器永远不能收紧',
      '改法：解析时把 font-size/font-weight 一起留在规则上，配对时用字色那条规则自己声明的字号决定门槛：≥24px 或 ≥18.66px 且加粗按 3:1，其余 4.5:1；CLI 也报出多少条被判成大字',
      '门槛读错的方向不对称：从严只是误报，放宽会漏掉真缺陷。所以只认数学上能证明的下界——clamp(30px,3vw,38px)/max(30px,3vw)/calc(30px+1vw) 可以，min(30px,3vw)/calc(30px-1vw)/max(3vw,30px) 与 rem/em/%/var() 一律从严',
      '我自己的夹具抓到了实现里的第一个真漏洞：第一版用 parseFloat 直接读数字，150% 被读成 150 并判成大字从而放宽门槛（危险方向），改成必须明确带 px 单位后变绿',
      '变异重打两次，第二次是因为夹具太弱：min 当下界、clamp 内部不再要求 px 这两条最初没红，因为夹具里没有 clamp(150%,…)/max(2em,…) 这类输入。补上后各自变红——夹具太弱等于没守',
      '实测口径不夸大：全仓 14 条规则的字号是可证大字（含 §4 点名的 FocusPanel .focus-clock 与 TodayView .focus-clock），但真实进入配对的只有 6 组，这 14 条一条都不在其中，所以今天没有任何判定结果改变，CLI 仍报 largeTextRules: 0。改的是判定器的能力',
      '自校准夹具：判大字不报需要一对落在 3:1~4.5:1 的颜色，夹具从实时调色板里找而不是写死色号，找不到就红；再逐主题精确断言 14px 都报、24px 只在低于 3:1 的主题里报',
    ],
  },
  {
    version: '2026年09月20日-版本44',
    signature: 'dc9c6baf73',
    notes: [
      '查了一类"不会有任何症状"的 bug：for= 写错一个字母、aria-describedby 指向被 v-if 藏起来的元素，页面照常渲染，只是 label 不再关联控件、说明读屏永远听不到',
      '分两层查：静态层查字面量引用能否解析 + 跨文件有没有两个组件声明同一个 id；渲染层挂 10 条路由后查整个文档的重复 id 与指向空气的引用。渲染层补的正是静态盲区——id 写在文件里但那元素这次没被渲染',
      '实测静态 18 处 for=、8 处 aria-labelledby、1 处 aria-describedby、46 个 id，零断裂零跨文件撞车；渲染 10 条路由零重复 id 零断裂引用。这一维没有缺陷，但判据留下了，因为这类失效是静默的',
      '同一个坑第四次：静态层忘了剥注释，NotFoundView 里一句解释性注释被当成真的 id 声明，报出"跨文件撞车 main-content"。本轮把它写成夹具里的对照用例（剥注释→无撞车，不剥→误报），不只是一句说明',
      '第五次出现在变异脚本里：把 label 的 for 指错这条没红，因为替换恰好打在注释里而守卫是剥注释的——变异打在注释里 = 假绿，而脚本只检查了"有没有生效"，检查不出"变到注释里去了"。两条变异都改成真实模板位置后各自变红。变异脚本自己也要挑对位置',
      '还查过确认不是问题的一条：元素只靠 title 当可访问名称，初筛 28 处全是组件的 title prop（Modal/EmptyState）而不是 HTML 属性——假阳性来自探针不是来自代码，这条不设判据',
    ],
  },
  {
    version: '2026年09月20日-版本43',
    signature: 'e8ecbd8d44',
    notes: [
      '量了两条 WCAG 2.2 里整类容易被漏的：拖拽替代（2.5.7）与页面标题（2.4.2）。拖拽这一类此前没有任何判据碰过',
      '扫描口径：同一文件里既有 down 又有 move，候选由扫描得出不手写，命中 5 个文件',
      '修的第一处 ImageCropModal：原本只有 pointer 事件、没有 keydown/tabindex/aria。现在可聚焦 + role=group + aria-label + aria-describedby，方向键平移、Shift 往回收、Ctrl 往外扩，另有 aria-live 选区读数',
      '这里我一开始判断错了：只读 begin() 就推断"默认选区 0 宽、按钮一直 disabled、键盘用户完全走不通"，实际 resetPreview 把初始选区设成整张图，按钮本来就可用、流程走得通。真缺陷是"改不了"——整图宽 100% 平移被夹住也收不小，而收小才是主操作。测试把正确形态顶出来了',
      '纠正直接改掉了实现：键位语义要完整（只会长不会收等于没修），并且要播种（对着整张图按方向键等于没反应），播种条件严格限定"恰好等于初始默认值"以免顶掉用户已调好的选区；测试里有一条能区分这两种情况的用例',
      '修的第二处 AppearanceSettings：首页模块排序手柄是 button 但 Enter 和方向键都无效，现在 Alt+上下移动，且焦点跟着模块走（否则连按第二下动的是别的模块，第四十一轮踩过同样的坑）',
      '另外三个候选判定已达标且理由都核实过：Modal 有 Esc 与关闭按钮、SwipeActionItem 有回车打开详情面板的全按钮、ExamsView 走 longPress 而那里的 onPointerMove 是用来取消长按的（moveTolerance），长按不属于 2.5.7',
      '页面标题查完发现早就做全了：11 条路由中 10 条有 meta.title，唯一没写的是 /today 重定向。无缺陷，但判据留下了——有兜底（',
      '学习生活台）所以不报错的写法最容易漏',
      '守卫自身的两个弱点都是变异抓出来的：ImageCropModal 的钩子只写了函数名，于是只删模板绑定也照样绿（needs 太弱等于没守），补上绑定后三个变异各自能红；给 ExamsView 写的 needle 在 longPress.js 里而不在该文件，测试当场报找不到，改用该文件里真实的 createLongPress + shouldSuppressClick',
    ],
  },
  {
    version: '2026年09月20日-版本42',
    signature: 'ce85b4990e',
    notes: [
      '移动端三类经典项一次量完，结果是两件早就做对了、一件真有洞',
      '真有洞的那个：尺寸类 Nvh 缺 dvh 孪生。地址栏收放时 100vh 按"地址栏收起"算，max-height:85vh 的弹窗会比可见区还高，底部按钮落到浏览器栏下面。补 16 条 dvh 孪生，用级联回退（先 vh 再 dvh）而不是 @supports，老浏览器零风险',
      '只守尺寸不守别的：transform:translate3d(0,108vh,0) 里的 vh 只是长度，彩带该飞多远与地址栏无关，判据只看 height/min-height/max-height',
      '过程里我自己的两个错：行首锚定的扫描漏掉了写在单行规则内部的声明（属性在行首不是 CSS 的事实）；复核脚本只在本行找孪生行而孪生行在下一行，报了 11 处缺漏其中 10 处是假的，真漏网的是没有分号以 } 结尾的那条',
      '已经做对的一件：触屏设备上表单控件不小于 16px 早就有了（style.css 的 pointer:coarse + font-size:16px !important）。本仓控件字号写在组件 scoped 样式里，编译后多一个 [data-v] 属性，全局规则按特异性永远赢不了——那个 !important 是唯一可行写法，现在被守卫锁住（去掉就红）',
      '守卫还锁住必须用 pointer:coarse 而不是 any-pointer：带触摸屏的笔记本主指针仍是 fine，any-pointer 会把桌面 11-14px 的紧凑排版一起改掉',
      '查完确认不是问题的一件：数值输入的 inputmode。初筛 18 处里大多是假阳性（type=number 本就有数字键盘、range 是滑块、account 是账户名），没有真命中，不改',
    ],
  },
  {
    version: '2026年09月20日-版本41',
    signature: '374624ef9b',
    notes: [
      '新覆盖一条维度：聚焦指示器的非文本对比度（WCAG 1.4.11 的 3:1，与正文 4.5 不是一回事）——此前它不在任何对比度判据里',
      '关键认识：outline-offset 会露出元素自身背景，所以 --primary / --danger 也是焦点环的相邻色，这正是"焦点环落在主色按钮上就看不见"的来源',
      '判据取"outline 与 halo 至少一圈达标"而不是"两圈都达标"：两圈互补是设计意图（默认主题 outline 对 --card 5.87、对 --primary 只有 1.11，靠 halo 4.75 补位），两圈都要求会把做对了的设计判成缺陷',
      '实测 6 主题 × 7 类相邻背景共 42 组全部达标，最弱 4.75:1——无缺陷，但从此是棘轮（绿色主题 outline 对 --primary 只有 1.00，换色值就塌）',
      '夹具逼出一个实现 bug：blendColor 通道提取 slice(i,i+2) 在 i=2,3 取错位置，靠"全透明 halo 必须等于底色"这条断言抓出来；探针同错，先前记的 5.00 是偏的，真值 4.75，报告与注释已更正',
      '顺带改掉 style.css 一句不实注释：--focus-halo 并非由 appearance.js 按壁纸切换（全仓只在 style.css 里按浅/深写死），并写明为何不为壁纸不匹配引入运行时切换',
    ],
  },
  {
    version: '2026年09月20日-版本40',
    signature: '0928a1ddc9',
    notes: [
      '新识别一条从未覆盖的维度：WCAG 2.4.11 焦点不被遮挡。线索是 DataManager 里孤零零一句 scroll-margin-top:58px——单独打补丁的地方通常意味着同类问题在别处还没被看见',
      '关键发现：Modal.vue 的 keepFocusedControlVisible 用 12px 余量判断"要不要滚"，但 scrollIntoView({block:nearest}) 没有"滚多少余量"这个参数，浏览器按 0 余量贴边，元素正好落在弹窗内的 sticky 提示与表头底下',
      '修法用应用自己的先例：style.css 加全站 scroll-margin-top 48px / bottom 56px，用 :where() 让特异性为 0（不覆盖 DataManager 的 58px），且不限定 :focus（要保护的目标常不是可聚焦元素）',
      '为什么不改成 block:center：center 会让每次 Tab 都滚动，本来可见的元素也被拽到中间，是体验倒退',
      '守卫 13 条：约定必须在且余量≥44、贴边滚动必须写明余量声明在哪且声明仍在、5 个遮挡面反向守',
      '第三次踩注释坑：扫原始 CSS 时注释里的 scroll-margin-top 造出幽灵规则，把 :where() 删掉测试照样绿——变异验证揪出来的假绿；现在扫前先剥注释',
    ],
  },
  {
    version: '2026年09月20日-版本39',
    signature: 'f06f832156',
    notes: [
      '触控目标钩子接线加了守卫：role=button 是作者显式声明"这是按钮"，而粗指针 44px 兜底的目标选择器正是 [role=button].tap-target，两件事必须配套',
      '全仓实测只有 4 个 role=button，其中 2 个真漏接，已接上 tap-target：LedgerView 的 .feed-item 与 .cd-row（后者没有任何 min-height，声明高度约 32px）',
      '另 2 个记账不放：.tt-cell 自带 min-height:48px（接了是空操作），.course 的高由网格行轨道决定（加 min-height 有溢出风险）',
      '判据四条各守一件事：零漏接、例外自我淘汰、约定本身必须在（style.css 的粗指针规则）、tap-target 元素数不得下降',
      '更正旧数字：报告里的"15 处"是提到 tap-target 的行数（含注释），元素数是 12 → 本轮 14；守卫按元素数棘轮',
      '坑：style.css 有两个 @media (pointer: coarse)，取第一个块会得出假结论，改成大括号配平取块',
    ],
  },
  {
    version: '2026年09月20日-版本38',
    signature: 'a762a88643',
    notes: [
      '§4 第 21 条"没改"的深色 --bg-tint 层次真的改了：深色普通 #131a29 → #161d2c，与 --bg 的最大通道差 3 → 6，与 --card 仍有 7',
      '先量后改：深色下压在 tint 上的八个文字令牌逐个量过，最弱的 --ink-faint 仍有 5.22:1（改动前 5.39）',
      '选值靠约束不靠手感：--bg 与 --card 只差 13，tint 两边都要明显过 4，所以取各通道均匀提亮的 #161d2c（读起来是更亮的表面而非更蓝的表面）',
      '守卫收紧：--bg-tint 对 --bg 的阈值从 3 提到 4（四档实测 4/5/6/6），3 当初唯一的存在理由已消失',
      '变异两个方向都守住：退回 #131a29 红 2 条（含 expected 3 to be >= 4），贴住卡片的 #1a2132 也红 2 条',
      '顺带修掉 style.css 里指向旧值的注释引用',
    ],
  },
  {
    version: '2026年09月20日-版本37',
    signature: '4b479f436b',
    notes: [
      '§4 第 18 条里"待决策"的网格键盘导航按条目自己写明的设计做成了实现：roving tabindex + 方向键',
      '三条不变量：恰好一个 Tab 停靠点、方向键移动并在边界夹住、回车空格与点击等价；都有渲染级守卫 scheduleGridRoving',
      '容器用 role=group 而非 role=grid（避免重构 DOM），顺带让 tabOrderAndNames 的 roving 判据认得出组；焦点环复用全站 [tabindex]:focus-visible',
      '键盘可达性例外清单的自我淘汰机制催着删掉了课表那一项（2 → 1），旧的反向断言改成守新形态；变异验证三条全部按预期',
    ],
  },
  {
    version: '2026年09月20日-版本36',
    signature: 'c4d10af73f',
    notes: [
      '把第 15 条剩下的两类假阴性机械化：渐变底对每个色停算最差档，模板静态内联底写成必须用令牌的棘轮',
      '刚上守卫就抓到一处真实 AA 失败：TodayView .next-state.live 白字压在渐变最浅色停上是 4.48:1，差 0.02；三通道各降一点到 #446de8 → 4.57:1，肉眼不可辨',
      '内联背景在本仓实测 0 处，棘轮由合成样例自证；只认静态 style，:style 是运行时算的不猜',
      '一次夹具写错、判据判对的例子：令牌字色随主题翻转，压在写死的深底上就是缺陷，夹具的期望反了',
    ],
  },
  {
    version: '2026年09月20日-版本35',
    signature: '4e49eb096b',
    notes: [
      '把 §1.16 手工扫描里最可机械化、假阳性最低的口径（底跟主题令牌、文字却写死）做成守卫 crossRuleContrastOffenders，CLI 与测试共用一份真相',
      '底的优先级按实测改成三级：同元素（逐复合更宽类集）、祖先前缀、族内唯一令牌底；歧义时宁可漏报也不猜',
      '查清一个假阳性：开关对勾曾被判 3.59，真底是白色旋钮、实测 4.93 达标，修法是把同元素提到首位而不是塞允许清单',
      '全仓零命中，允许清单为空；测试带防腐断言（登记过的条目必须仍然命中），并纠正 §4 第 19、20 条等 5 条已实现却未回头更新的陈旧条目',
    ],
  },
  {
    version: '2026年09月20日-版本34',
    signature: 'bbf96659af',
    notes: [
      '第三十七轮用编译产物恢复时，把入口分片里合并的别组件规则一并搬进了宿主文件；本轮按 scope 归属清掉 85 条副本',
      '判据是三个条件的合取：别组件里有完全同值的规则、宿主模板里没用这些类、真属主自己确实在用；保险又拦下 2 条属主未使用的',
      '被重建过的样式块顶部加了说明注释，写明原有注释在恢复中丢失，避免后人误以为那是有意为之',
      '清理后规则数：App 136→111、TodayView 193→166、ScheduleView 179→152、AppearanceSettings 120→114',
    ],
  },
  {
    version: '2026年09月20日-版本33',
    signature: '440f4313eb',
    notes: [
      '组件内死 CSS 此前没有任何守卫，只能靠人看；新增守卫并按其例外机制删掉 27 个死类、63 条规则',
      '例外机制覆盖过渡类名与动态拼接前缀，且都要按全仓聚合：小组件的 CSS 会被合并进入口分片，App.vue 里因此出现 Sidebar 的过渡类名',
      '死类判定用静态扫描与构建产物两个独立来源交叉验证；删除后逐条比对删除前的编译产物，确认只少了这 63 条、没有误伤其他规则',
      '第一版删除器的区间偏移有 bug，误删了 6 个文件约 259 条规则；已用删除前的构建产物整体恢复，并把删除器重写为单趟解析、精确区间',
      '恢复带来的已知代价：这 6 个文件的样式块注释丢失，且入口分片里合并的别组件规则被一并搬入（多带本组件 scope 属性，多为重复或惰性规则）',
      'ScheduleView 里那份 .skin-timeline 副本与 ScheduleGrid 的定义完全同值，已删除；其余疑似副本按"子组件根节点会带父组件 scope"判断，不敢按模板用法贸然删除',
    ],
  },
  {
    version: '2026年09月20日-版本32',
    signature: 'a9f2beacc6',
    notes: [
      '组件内死 CSS 此前没有任何守卫，只能靠人看；新增守卫并按其例外机制删掉 27 个死类（连带 93 条规则）',
      '这些死类在模板、脚本和全仓其它文件里都没有引用，判据用静态扫描与构建产物两个独立来源交叉验证',
      '例外机制覆盖过渡类名与动态拼接前缀（step-/skin-/sync- 等），前缀按全仓聚合',
      '过程中踩到两个坑都作为注释写进了守卫：注释里的字面量 style 标签会让样式块定位跑偏、动态前缀只看本文件会误报刻意保留的皮肤',
      '打印样式原先把 .content-wide 列进宽度归零规则，随死类删除一并去掉，打印守卫的自证正是靠这一条先报出来的',
    ],
  },
  {
    version: '2026年09月20日-版本31',
    signature: '2f6fad33db',
    notes: [
      '深色高对比下内嵌区与卡片几乎同色：--bg-tint 与 --card 只差一个绿通道值，层次分不出来',
      '已把该档 tint 调整为明显更深的一档，并锁住"高对比的层次差不得小于普通模式"这条不变量',
      '删掉一个只写不读的死令牌（--atmosphere-decor），并把令牌守卫的口径从"读到或写到"改成"写过就必须有人读"',
    ],
  },
  {
    version: '2026年09月20日-版本30',
    signature: '1f1d14f198',
    notes: [
      '高对比度此前在跟随系统主题下完全不生效：该主题把整张调色板写成内联变量，压掉了样式表里的高对比值',
      '深色时边框停在 #2a3248、次要文字停在 #8b95a8，本该是 #64749a 与 #bcc7db，对比明显偏弱',
      '现在跟随系统主题也会套用强对比值，系统级 prefers-contrast: more 同样被跟随',
      '新增运行时守卫：断言根节点内联变量上的真实值，并比对 theme.js 与 style.css 两份色值不许漂移',
    ],
  },
  {
    version: '2026年09月20日-版本29',
    signature: 'c1795371b7',
    notes: [
      '打印样式：此前全仓没有任何 @media print，按 Ctrl+P 会把深色侧栏、任务中心、装饰粒子与提示层一起印上',
      '课程表横向滚动容器在纸上会裁掉右侧的列，打印时展开；卡片与表格行不再被切成两半',
      '打印时把主题令牌归零成白底黑字并加 @page 留白，外壳与浮层一律隐藏但绝不隐藏正文根',
      '新增打印样式守卫：解析打印块逐条核对，并自证每个选择器真实存在、每个变量都在 :root 里定义过',
    ],
  },
  {
    version: '2026年09月20日-版本28',
    signature: 'a95ce8b40c',
    notes: [
      '按 / 就能打开全局搜索：任意页面按一下，焦点直接落在搜索框里',
      '斜杠不抢输入：在输入框、文本域或可编辑区域里打字时原样落进去',
      '带 Ctrl 或 Cmd 的斜杠不归它管，已经有弹窗打开时也不会再叠一层搜索面板',
      '修掉搜索面板打开后焦点被关闭按钮抢走的问题：按 / 打开就能直接打字',
    ],
  },
  {
    version: '2026年09月20日-版本27',
    signature: '871583fe47',
    notes: [
      '账本分区补上写回 URL 的一半契约：点击或用方向键切换分区都会更新地址栏，刷新/分享/书签不再丢分区',
      '写回用 replace 而不是 push，切分区不在历史里堆层，并用历史长度断言守住这个决定',
      '默认分区不带参数、脏参数（?tab=zzz）会被清理，其余 query 参数原样保留',
      '路由播报从 fullPath 改为只看 path：切分区等页内状态变化不再让读屏重复听到「已打开」',
      '新增 ledgerTabUrl 与 routeAnnouncement 两组守卫（含\'没播报\'断言的观察窗口与前提自证）',
    ],
  },
  {
    version: '2026年09月20日-版本26',
    signature: '54288ed229',
    notes: [
      '新增 useTabKeys：给 5 个 tablist 装上 APG 的键盘模型（roving tabindex + 左右方向键环绕 + Home/End），只有选中的 tab 留在 Tab 序列里',
      '键盘切换与点击共用同一条赋值路径（迁移方式切到发送时同样会停摄像头）',
      '切换可被否决：草稿守卫拒绝时返回 false，此时不移动焦点，避免焦点停在未选中的 tab 上',
      '放行 roving tabindex 的组内 tabindex=-1，但要求组里必须留有一个 Tab 停靠点，整组被排除才是真陷阱',
      'tabindex=-1 的报错信息补上元素描述，同一页多个元素时报错能定位到具体哪一个',
    ],
  },
  {
    version: '2026年09月20日-版本25',
    signature: '4f719a9747',
    notes: [
      '补齐设置分区的标签页面板语义（plans 用 v-show 面板，base 的 template 换成包裹层并复制父级 flex 布局与 18px 间距）',
      '把「回放时间范围」与「设备绑定方式」两处重塑内容/状态机的控件收敛为 role=group + aria-pressed',
      '标签页欠账归零：存量清单棘轮退役，判据升级为零豁免的关系完整性检查',
      '把设置分区的 v-for tab 改为两个显式按钮以获得静态 id，让 aria-labelledby 引用可被静态守卫核对',
    ],
  },
  {
    version: '2026年09月20日-版本24',
    signature: '6d8b8a7095',
    notes: [
      '把 6 组没有面板的筛选控件从 tab 语义收敛为 role=group + aria-pressed（待办筛选、日程状态、清单分类、分类方向/视图、识别结果筛选），读屏不再把它们念成标签页',
      '新增 tablist 与 tab 必须成对出现的零豁免规则，堵住 tablist 子元素不是 tab 的硬性违规',
      '选中态守卫补上逐项点击复扫，封住只缺某一项 aria-pressed 时静态扫描看不到的盲区',
    ],
  },
  {
    version: '2026年09月20日-版本23',
    signature: '4def9cd978',
    notes: [
      '补齐标签页面板语义：11 组 tablist 中面板已存在的 5 组补上 role=tabpanel 与 aria-labelledby，并修掉 ExceptionsModal 里 tablist 子元素不是 tab 的硬性违规',
      '修复挂载夹具的 hash 路由泄漏与等待判据，让渲染类守卫不再扫到错误的页面',
      '按新守卫查出并修掉专注时长按钮的纯视觉选中态（补 aria-pressed）',
    ],
  },
  {
    version: '2026年09月20日-版本22',
    signature: '4c87a582d5',
    notes: [
      '新增渲染后的 Tab 顺序与可访问名称守卫：挂载外壳走真实路由逐个打开 10 个页面，检查没有正数 tabindex（会插队到自然顺序之前）、没有可交互元素被 tabindex=-1 排除、每个可交互元素都有可访问名称、没有不带 href 的 <a>（RouterLink 少了 to 就会这样，键盘到不了）、跳过链接必须是第一个 Tab 停靠点且指向真实存在的 main、同一页 id 不重复',
      '补上仓库空白角度：既有 formControlNames 是静态且带存量棘轮、keyboardReachability 只扫只有鼠标能触发的 div/span、accessibleNames 只针对少数组件，渲染后全站的非表单控件与真实 Tab 顺序此前没人管',
      '修掉真实缺陷：侧栏 6 个主题色按钮的选中态只存在于 class=on 里，没有任何 ARIA，读屏用户听不出当前选的是哪个主题（WCAG 4.1.2 的名称/角色/值）。而同一个功能在个性化设置面板里是用 :aria-pressed 暴露的，属于仓库内部不一致。已按同一写法补上 :aria-pressed',
      '新增可推广的规则：成组可选项（role=group/radiogroup/tablist）里的按钮若用 class 标记选中态却没有 aria-pressed/aria-checked/aria-selected/aria-current，即为选中态只存在于视觉里。边界写清：<a> 排除（导航用 aria-current，是另一套语义）、选中态 class 卡前后词边界所以 router-link-active 与 current-theme 这类复合名不误判、判定靠 class 命名习惯是已知边界',
      '夹具两次抓住我自己：非交互标签上的 tabindex=-1 被误判成可交互（而 main tabindex=-1 正是跳过链接落点的标准写法），以及夹具用下标算术导致断言错位（改为全部用选择器）',
      '已知边界写进注释与报告：测试环境没有样式表，靠 CSS 媒体查询隐藏的部分（如手机底部导航）仍会出现在扫描里，所以本守卫验证的是与 CSS 无关的 Tab 顺序不变量，不声称验证完整真实 Tab 顺序',
      '变异实验五条全红，其中两条最初没变红但性质不同：B 是根本没改到（tabindex=-1 在 App.vue 里第一处出现在注释中），E 是夹具真空档（只验了前边界没验后边界），两者必须分清',
    ],
  },
  {
    version: '2026年09月20日-版本21',
    signature: 'a51112de39',
    notes: [
      '新增渲染 DOM 级标题顺序守卫：挂载整个应用外壳、用真实路由表逐个打开 10 个页面，检查页面内容里恰好一个 h1、它必须是第一个标题、相邻标题不得跳级',
      '同步解开长期缺的基础设施：把路由表从 main.js 抽成 src/router/routes.js（测试必须针对同一份真实路由，另抄一份必然漂移）；标题判定放进 tests/helpers/renderedHeadings.js',
      '修掉一个真实缺陷：<router-view> 被放在 <Transition> 里，vue-router 4 明确不支持这种写法，每次切路由都会在控制台打警告，而且过渡与 keep-alive 的包含关系不按作者预期生效。已按官方写法改为 router-view 在外、Transition/KeepAlive 在 v-slot 内部，并新增守卫「导航过程中不得出现 router-view/transition 框架警告」',
      '诚实纠错：先前静态推断以为账本页空态 h3 是跳级，渲染后真实序列是 h1:账本 → h2:最近记录 → h3:还没有记录，不跳级——空态组件默认 h3 与各调用点显式传 :level=2 的用法都是对的。静态推断不等于渲染结果',
      '两个坑：懒加载视图要等真实时间（约 200ms，模块图含 OCR、表格解析等），只等两帧 rAF 会在 route-fallback 加载占位上收工，把『守卫跑得太早』误判成『页面没有标题』；判定函数不能从测试文件 import（会连带执行其顶层代码并互相污染），已抽到 helpers',
      '顺带清掉 main.js 里 7 个随抽取产生的死导入，并记录工具缺口：ESLint 未开 no-unused-vars，死导入不会被拦；全库探针显示 54 处未使用，但刻意不开——其中有 useStoredRef 预热注册这类必须保留的写法，且 <script setup> 模板使用的组件会被误报',
      '变异实验三条全红：把 router-view 放回 Transition 里→1 条红；重要日期空态去掉 :level=2（造出真跳级）→1 条红；在判定函数里挖洞不查 h1 数量→夹具抓住 1 条红',
    ],
  },
  {
    version: '2026年09月20日-版本20',
    signature: '201383715e',
    notes: [
      '闭合上一轮留下的同一类问题：App.vue 里另有五处外壳级提示（安全模式、持久化失败、持久化恢复、自动同步状态、7 天未备份）加上快速记录成功 toast，共六处都是 v-if 插入的新节点自带 role=alert/role=status，撞的正是 liveRegion.js 记的那条不可靠规律（VoiceOver 可能一个字都不播）。全部改由外壳里常驻的播报区发声：错误 assertive、提醒与成功 polite，行内 role 一律去掉，顺带避免播报区与提示条把同一句念两遍',
      '新增能挂载整个应用外壳的测试夹具 tests/helpers/mountApp.js（桩路由 + settle + 卸载），这是长期缺的基础设施，同时解开 §4 里渲染 DOM 级标题顺序守卫与真实 Tab 顺序守卫两项待办',
      '文案集中成常量与计算属性，模板与播报共用一份，视觉与听觉不可能各说一套；顺带删掉自动同步提示里标题与正文各写一遍的嵌套三元链，改为 autoSyncNotice 计算属性',
      '播报 watcher 一律监听文本/布尔值而不是对象：自动同步提示若监听那个每次重算都是新对象的提示对象，内容没变也会反复播报；快速记录提示若挂在布尔 toast 上，连记两笔时第二笔的播报会丢（toast 一直显示、布尔值不变），已改为监听消息文本',
      '新增测试 appShellAnnouncements（7 条）：安全模式与持久化失败走 assertive（后者还要带上动态错误信息）、保存恢复走 polite、同步状态按文本播报且重算不重复播报；另含零例外守卫『外壳模板里只剩两条常驻播报通道』与『提示条文案不得在模板里留硬编码副本』',
      '变异实验七条全红：提示条改回行内 role→2 条红；模板写死文案→1 条红；删掉安全模式 watcher→1 条红；持久化失败改礼貌通道→1 条红；同步提示改监听对象→1 条红（精度）；快速记录 toast 加回 role→1 条红；保存恢复改用紧急通道→1 条红',
    ],
  },
  {
    version: '2026年09月20日-版本19',
    signature: '0bfeca5ca3',
    notes: [
      '全局错误提示的播报不可靠：toast 用的是 v-if 插入的 role=alert，而 liveRegion.js 开头就记着『插入瞬间带内容的新 live region，VoiceOver 一类读屏可能一个字都不播』——出错是全应用最需要被听见的时刻（眼前页面已经坏了），偏偏只有这一条通道，读屏用户可能彻底不知道发生了什么。仓库已有常驻播报机制却只用于路由切换',
      'liveRegion.js 新增常驻 assertive 通道（liveAlert + announceAlert），两条通道各用一套定时器——共用的话一句礼貌播报会把刚排队的错误播报挤掉，而那正是最不能丢的一条',
      'globalError.js 的 report() 改为同时 announceAlert，覆盖组件渲染错误与未捕获的 Promise 拒绝；App.vue 新增常驻的 role=alert aria-live=assertive 容器；全局错误 toast 去掉 role=alert（它随状态插入，语义上本该由常驻通道承担），顺带避免同一句话被念两遍；toast 文案改为直接渲染 GLOBAL_ERROR_TITLE/GLOBAL_ERROR_BODY，与播报句同源，视觉与听觉不可能各说一套',
      '新增测试 globalErrorAnnouncement（9 条）：渲染错误与 Promise 拒绝都走紧急通道、不占用礼貌通道（精度）、连错两次仍会播报（先清空再写入的意义）、两条通道互不打断、clearAnnouncement 清两条；另含『播报通道必须常驻』守卫（sr-only 的实时区域不得带 v-if/v-show/aria-hidden/hidden）与同源守卫（App.vue 不得出现硬编码文案副本）。夹具当场抓出我守卫的第一版漏洞：只认 role=alert',
      'status 会漏掉仅用 aria-live 声明的区域，已按 hiddenLiveRegion 的同口径修正',
      '变异实验六条全红且失败条数精准：删掉 announceAlert→4 条红；错误发到礼貌通道→4 条红；两通道共用定时器→4 条红；播报区改 v-if→1 条红；降级成 polite→1 条红；toast 文案改硬编码→1 条红',
    ],
  },
  {
    version: '2026年09月20日-版本18',
    signature: 'd874d4951a',
    notes: [
      '课表模板的「保存日期」按设备时区渲染，与应用时区策略不一致：模板的 createdAt 存的是 ISO 时间点，而显示用了 new Date(value).toLocaleDateString(\'zh-CN\')——那走设备时区；全应用其它日期都走 policyDateKey/formatAppDate（用户在设置里选的时区，可选 local/Asia/Shanghai/UTC）。用户把时区配成非设备时区时，这个纯日期标签会与全应用差一天，出现「模板保存于明天」的自相矛盾显示。仓库为此专门写了 createdDateKey（settingsPolicy.js:118，注释 L113-116 描述的就是这个坑），此处漏用。改为 createdDateKey → formatAppDate，并顺带修掉旧写法的第二个毛病：createdAt 非法时会渲染出 Invalid Date',
      '新增测试 courseTemplateDate：真实挂载 CourseManagerModal（Modal 会 Teleport 到 body，需从 body 查）并对两个非 local 策略时区各断言一次日期。只断言一个不够——本机设备时区是 UTC+8，若只断言 UTC，把实现偷懒改成 toISOString().slice(0,10) 恰好给出同样结果，测不出来；Asia/Shanghai 那次专门抓这类变异。另加两条区分力自检，防止断言退化成恒真',
      '变异实验四例：改回设备时区渲染→2 条红；取 UTC 日期键→Shanghai 那次红；传 local 忽略策略→红；value && createdDateKey(value) 是等价变异（行为相同）故为绿，属正确结果而非漏抓',
      '顺带扫描确认无其它同类问题：全仓无 toISOString().slice(0,10) 或裸 new Date 取日月的日期键推导；金额无裸浮点加减乘与 parseFloat；LedgerView 的月份加减与月历首日星期几是纯日历运算（时区无关），判定正确不改；DataManager 的 4 处同步时间点标签按设备时区显示是合理的（用户对「几小时前」的参照就是设备时钟），刻意保留并在报告写明理由',
    ],
  },
  {
    version: '2026年09月20日-版本17',
    signature: '5f5fa8b599',
    notes: [
      'Sidebar 的「更多功能」浮层缺 Escape 出口：Modal/ActionSheet/ContextMenu 三个浮层都处理 Escape，只有这个自造浮层漏了，键盘用户必须一路 Tab 到那个 × 才能收起。按仓库既有约定补上，并做焦点归位（浮层关闭后元素从 DOM 消失，焦点会掉到 body 上；只在焦点原本就在浮层里时才拉回触发按钮，否则会抢走用户在别处的焦点）',
      '新增运行时测试 sidebarMoreSheetEscape：真实挂载 Sidebar 派发 keydown，断言关闭生效、焦点归位、以及两条精度（未打开时无动作、焦点在别处时不抢）',
      '新增源码守卫 overlayEscape：类名含 mask/overlay/sheet/backdrop/popover 或角色是 dialog/menu 的浮层，必须有 Escape 出口；委托给 <Modal>/<ActionSheet> 的自动放行，内联 listbox 不算浮层',
      '变异实验暴露我自己的守卫不健全：第一版只搜 Escape 这个词，把处理器删掉只留注释里的字样照样全绿——改为要求真实比较写法（===/!==/==/!= 与 case）并剥掉注释与 HTML 注释；放宽过程中又发现签名过窄，把已是 !== 写法的正确代码误报，一并修正',
      '顺带核实五类移动端/表单项均合格：viewport 无禁缩放且已 viewport-fit=cover、safe-area 覆盖 12 个文件、3 个 img 全有 alt、2 个 form 都带 submit.prevent、监听器与观察器全部成对清理',
    ],
  },
  {
    version: '2026年09月20日-版本16',
    signature: '158cb40ff0',
    notes: [
      'NotFoundView 是真缺陷：它是路由组件（main.js:167），经 <router-view> 渲染在 App.vue 的 <main id=\\',
    ],
  },
  {
    version: '2026年09月20日-版本15',
    signature: '3f5c6b6497',
    notes: [
      '账本固定账单行是真缺陷：<div role=\\',
    ],
  },
  {
    version: '2026年09月20日-版本14',
    signature: '033cd98abe',
    notes: [
      '清掉 TimeSettingsModal 里恒真的死条件 v-show=\\',
    ],
  },
  {
    version: '2026年09月20日-版本13',
    signature: 'a859021321',
    notes: [
      '作息设置的 OCR 进度与导入错误原住在 v-show 的作息方案区里：OCR 要跑数秒，用户切标签页等就变成 display:none——进度看不到、失败与图片质量提示也听不到（display:none 的元素不在无障碍树里）',
      '已把这两块提到标签区之外，与同文件的 settingError 同级',
      '新增 hiddenLiveRegion 守卫：实时区域不得落在 aria-hidden/hidden/v-show 子树里，且递归进子组件（平扫漏掉的就是 <TaskProgress> 这类）',
      '把带嵌套栈的遍历与组件解析器收进 tests/helpers/vueTemplate.js，landmarksAndRoles 改为复用',
    ],
  },
  {
    version: '2026年09月20日-版本12',
    signature: '6f266d1180',
    notes: [
      '4 处 JS 发起的平滑滚动未受「减少动态效果」约束：focusNavigation 聚焦跳转（全应用最频繁）、DataManager 分区跳转、WheelPicker 滚轮整列滚动、main.js 锚点路由',
      '按 motion.js 已写明的原则统一门控 animationsEnabled()，CSS 的 prefers-reduced-motion 规则对显式 behavior:\'smooth\' 无效',
      '新增 reducedMotionScroll 守卫：源扫描两条规则（零例外清单）+ 运行时直接验证两种模式传下去的 behavior',
    ],
  },
  {
    version: '2026年09月20日-版本11',
    signature: 'fbe9f07d6f',
    notes: [
      'tableSemantics 守卫自证注释里的表头计数由估算的 20 更正为实测的 18（17 col + 1 row）',
    ],
  },
  {
    version: '2026年09月20日-版本10',
    signature: 'd52d23e285',
    notes: [
      '三个表格的 <th> 补 scope（WCAG H63），课程管理表的空 <th> 补 aria-label',
      '农历对照表的年份列改为 <th scope=\\',
    ],
  },
  {
    version: '2026年09月20日-版本9',
    signature: 'fe6753d8db',
    notes: [
      '16 处操作反馈错误提示补 role=alert、5 处成功提示补 role=status（此前读屏用户点保存后什么都听不到）',
      '清单/课程/特殊日期三个表单接上仓库既有的错误关联约定：aria-invalid + aria-describedby + role=alert + 焦点回跳',
      '新增 errorAnnouncement 守卫：反馈消息必须可播报、成功不得用 alert、ARIA 引用不得悬空',
    ],
  },
  {
    version: '2026年09月20日-版本8',
    signature: '17be2c7f23',
    notes: [
      '补上应用级 skip link（跳到主内容），键盘用户不必每页 Tab 穿过整个侧边栏',
      'ContextMenu 的 role=menu 与 TimeSettingsModal 的 role=tablist 补上可访问名称',
      '新增 landmarksAndRoles 守卫：要求命名的角色不得无名 + skip link 必须排在最前',
    ],
  },
  {
    version: '2026年09月20日-版本7',
    signature: 'b873a12f05',
    notes: [
      '课表周视图的课程块补上 role/tabindex/键击，桌面键盘用户不再需要绕到单日视图才能编辑课程',
      '守卫新增反向断言：课表空格刻意不进 Tab 序（避免 84 个 Tab 停靠点）',
    ],
  },
  {
    version: '2026年09月20日-版本6',
    signature: '6f8998dafc',
    notes: [
      '补充 QuickRecordPanel 的「修改/收起」按钮 aria-expanded（三元写法，守卫判据刻意未覆盖）',
    ],
  },
  {
    version: '2026年09月20日-版本5',
    signature: '1be129f81c',
    notes: [
      '13 处「原地展开/收起」按钮补上 aria-expanded，读屏现在能读出当前是展开还是收起',
    ],
  },
  {
    version: '2026年09月20日-版本4',
    signature: '7e860d72e6',
    notes: [
      '账本/清单/课程表区块标题从 h3 改为 h2，消除 h1→h3 层级跳跃',
      '自动同步任务注册改为幂等，修掉一次同步偶发记两条结果的问题',
    ],
  },
  {
    version: '2026年09月20日-版本3',
    signature: 'a6a657ef10',
    notes: [
      '键盘可达性：账本页「打开交易详情」与「编辑固定账单」原本只挂在带 @click 的 div 上——不在 Tab 序、读屏不读成可点击、回车空格无反应，而它们是这两个操作的唯一入口（右侧按钮组只有已支付/跳过本次）。三处这样的行（账本列表、日历当日明细、即将到来/之后/已暂停三种固定账单行）补上 role=button + tabindex=0 + 回车空格处理 + 动态 aria-label，共 5 个元素；DOM 与样式一律没动。可安全加 role 是因为外层 SwipeActionItem 把动作按钮渲染成行的兄弟节点，不会形成按钮套按钮',
      '侧滑动作按钮在收起时被移出 Tab 序（tabindex 跟随 open 属性在 -1 与 0 之间切换）。它们原先只靠位移藏起来，于是键盘会 Tab 到一排看不见的「编辑/删除」上（WCAG 2.4.7）。这不代表键盘失去了编辑删除：每一行现在都能聚焦回车进详情，详情面板里有编辑/再记一次/退款/删除等全部真按钮',
      '新增 tests/keyboardReachability.test.js 守卫「只有鼠标能触发的操作」：标签是可点击容器 + 带动作型 @click（排除只做传播控制的 stop/self/capture）+ 缺少 role/tabindex/键盘处理三件套，且绑定的动作表达式在本文件里没有落在任何可聚焦元素上。判据里的最后一条让它保持零硬编码：点待处理账单行只是切到账单标签页的捷径，而同一表达式 tab = \'bills\' 就在旁边 role=tab 的真按钮上，于是自动豁免。7 条夹具先证明它抓得住再拿它扫全仓（53 个 .vue / 3083 个开标签 / 478 个带 @click 的标签都在断言里自证不空转），并用拆掉 .cd-row 三件套的变异实验验证过它会精确报出 views/LedgerView.vue 与 openDetail(e.id)',
      '例外清单设计了自我淘汰：3 条已核实的真等价比对（课程格与移动端课程行是同一个 openEdit、只是循环变量名不同；点课表空格是按格预填的捷径、添加课程另有真按钮；点考试卡片等价于卡片自带的「更多操作」按钮进菜单里的编辑）都必须写明理由，且一旦不再被扫到测试就会失败，避免清单随代码变化悄悄烂掉',
      '新增 tests/helpers/vueTemplate.js：把遍历 .vue、剥注释与 style 取模板、按引号感知切标签这三件事抽出来给两条守卫共用；引号感知是必需的，因为 :disabled=\\',
    ],
  },
  {
    version: '2026年09月20日-版本2',
    signature: '0cc86ad7b1',
    notes: [
      '语义色有了令牌：新增 --success / --warning（浅色写定，深色在 :root[data-theme=\'dark\'] 覆盖，因为深色主题只由「跟随系统」这一个分支产生，不必在四套具名调色板里各抄一份）。11 个组件里成功/警告语义的写死绿与琥珀（#07805d / #0d9463 / #087a58 / #9a6414 / #b88921 / #c2410c 等 30 余处及其派生底与边框）收进令牌；其中「文字 + 写死浅底」成对写法统一改成 10% 混 --card 的浅底加 35% 边框。凡容器内还有 var(--muted) 正文的表面只用 6% 混合——10% 会把灰字压到浅 4.31 / 深 4.31，6% 是同时保住状态底色与灰字的最大比例',
      '跨规则的对比度盲区：既有守卫都是逐条规则判断的，于是「字色在一条规则、底色在另一条规则」永远抓不到。按三种口径扫全仓后修掉 10 处，最严重的是 .qr-placeholder 那个 70px 占位图形：它沿用为深色相机框准备的 #cbd3e4，落在浅色的 .qr-panel 上只有 1.44:1（图形也要求 3:1），等于浅色主题里根本看不见。另有 .focus-done-hint / .success 等 4 处写死深绿落在主题卡片上，深色只剩 2.97:1',
      '审计脚本的解析器有一个会一直报绿的缺陷：它取主题块时要求块尾是「换行 + 右花括号」，而 style.css 顶部有一组单行规则，查 green / pink 时正则捕获到了下面 purple 的块，三个具名主题的 --primary 一模一样，真实的绿 #0a7a54 与粉 #c02070 从来没进过审计。已改为花括号配对加级联合并，并把真实表面补进配对表（语义浅底上的次级文字、悬停态浅底），检查组合从 108 组升到 144 组',
      '顺带纠正一处误判：theme.js 的 THEMES 表只用于写 meta theme-color，具名主题的 CSS 颜色全部来自 style.css。拿 THEMES 的值去算会得出「四个主题的幽灵按钮都不达 AA」这种不存在的结论，实际六个主题的 --primary 配 --primary-soft 是 4.72 到 5.22 全部达标',
      '表单控件有了可访问名称：全仓 221 个控件里原本有 35 个既无 label 关联也无 aria-label（16 个连 placeholder 都没有），其中 select 最严重——读屏只报「组合框」，不说是什么字段。逐处按「旁边真有 label 就绑 for、否则用 aria-label」修完，归零；顺带发现 54 个静态 id 没有重复、42 个 for 全部配对、无悬空',
      '新增 tests/formControlNames.test.js 作为棘轮守卫（含引号感知的模板解析，绕开 :disabled 里的大于号截断），存量上限从 35 收到 0、例外文件清空，并用注入两个无名控件验证过它会失败',
      '清掉数据管理页的死 CSS：.conn-head / .conn-badge / .conn-meta-item / .conn-meta-item code / .device-history 五条规则模板从未渲染（模板只用 .conn-times 与 .relationship-state），其中 .device-history 的 #5e6f85 在深色下本来只有 3.09:1，删规则而不是修一个永远不显示的颜色更有意义',
      '令牌文档补两条硬约束：--ink-faint 是四档文字里余量最小的一档（深色在 --card 上只有 4.92），底一旦被语义色提亮就击穿（6% 底 4.40、10% 底 4.05），所以语义浅底上的次级文字要用 --ink-soft；--muted 在 10% 底上比它还差（4.31），只适合 6% 以内的极浅底',
    ],
  },
  {
    version: '2026年09月20日-版本1',
    signature: '0a2305b123',
    notes: [
      '暗色主题下的「白块」：暗色主题由 prefers-color-scheme 直接生效（深色下 --card 是 #1b2233），但全仓有一批写死的近白底色会变成白块、配上跟着主题变浅的文字几乎读不出来。按「同一条规则里既有主题文字色、又有硬编码浅底」扫出 18 处，复查又抓出 7 处与 2 处渐变（吸底操作条 linear-gradient(…, #fff 34%) 会在深色下铺白条、考试置顶卡渐变）；再把判定面扩大到「纯近白底必须用 --card/--bg-tint 令牌」，又清掉 27 处面板、输入框、弹层、表格与进度条底色。之所以是安全改动：浅色主题下 --card 就等于 #ffffff、--bg-tint 就等于 #f9fafd，替换在浅色下等价，只改深色主题的表现',
      '刻意保留的永远浅色控件：开关滑块（白滑块配深色轨道是通用约定）、勾选框（勾是写死白色），以及「写死深色文字 + 写死浅色底」的自洽组合（异常标签 #b13f3f/#feecec、笔记本皮肤牛皮纸底配 #735f39 楷体、日期牌深蓝字配淡紫底）——它们在两套主题下都读得清，套上主题令牌反而会把刻意的彩色标签洗成中性色',
      '触控目标钩子接线：style.css 里 .icon-btn（桌面 32×32、粗指针放大到 44×44、三态齐全）和 button.tap-target 两个钩子零使用，而全站「只有一个叉」的关闭/删除按钮只有 24/26/30/32px。给弹窗关闭、通知关闭（全站最小 24px）、两条横幅关闭、模板删除、侧边栏更多功能关闭补上 tap-target，设置行删除按类加进粗指针规则；.icon-btn 与 tap-target 重叠且后者才被用上，删掉 .icon-btn 及其粗指针规则与 forced-colors 里的两处引用（改指 button.tap-target）',
      '死钩子清理与守卫：再删 .btn.is-loading（两处，异步按钮全改用 :aria-busy）、input.is-invalid 系列（程序化校验统一走 aria-invalid=true）、.cvi-auto（面板级 content-visibility，铺到含交互行的列表会影响 scrollIntoView 与锚定，收益未实测不铺开）。新增 tests/styleHooks.test.js 断言 style.css 定义的每个工具类都必须在别处被引用、例外清单为空，并用注入 .zz-dead-hook 验证过它会失败',
    ],
  },
  {
    version: '2026年09月19日-版本7',
    signature: '1e486a3dea',
    notes: [
      '表单错误终于能被读屏听见：style.css 定义了 [aria-invalid=true] 无效态样式并注明「供自定义校验逻辑复用」，但全仓没有一处设置 aria-invalid、aria-describedby 零使用——校验失败时输入框不被标无效、错误文案与出错字段没有程序化关联、焦点停在提交按钮上。笔记正文 / 固定账单 4 个字段 / 日程内容三处表单改为单一 setXxxError(message, field) 入口，字段校验失败时标 aria-invalid 并建立 aria-describedby 关联、把焦点移回该字段；保存失败（笔记已删除、落盘失败、异常）刻意不带 field，避免把输入框标红误导读屏用户',
      '暗色主题下「实色底 + 写死白字」修掉 15 处并加守卫：第一轮为暗色主题引入的 --on-primary / --on-danger 令牌本身正确（暗色下 --primary/--danger 是亮色，白字只有 3.17:1 / 2.78:1），问题是没人消费——--on-danger 使用次数为 0。筛选标签、分段按钮、选项卡、今日标签、文件按钮、合并选项、快捷添加、任务胶囊、语音按钮、滑动操作等全部改用 on-* 令牌；顺带修掉 .swipe-action.success 固定绿 #14966d 配 12px 白字只有 3.74:1 的 AA 失败（压深到 #0f7a58 得 5.3:1）',
      '新增守卫：扫描所有 .css 与 .vue 的 style 块，只要同一条规则里同时出现 background: var(--primary',
      '--danger) 与写死的 #fff 就报错，并断言两个 on-* 令牌确实被消费；这条守卫第一次跑就抓出 9 处单行 grep 漏掉的跨行规则',
      '新增 tests/formValidationA11y.test.js：真实挂载视图断言 aria-invalid、aria-describedby 指向真实节点、焦点回到出错字段、账本表单填好名称后错误从「名称」正确转移到「金额」',
      '记录一个测试环境坑：该测试最初约一半概率随机失败（点了没反应），根因是 LedgerView 根节点 @click.capture 的 Vue invoker 先给事件打上 _vts 时间戳，按钮自身的 invoker 随后用 _vts <= attached 去重跳过；测试在按钮挂载的同一毫秒内点击，撞上 1ms 分辨率边界。真实用户点击不存在该问题，修法是测试里点击前等 8ms 并在注释里写清原因',
    ],
  },
  {
    version: '2026年09月19日-版本6',
    signature: '732112454c',
    notes: [
      '动效令牌真正落地：style.css 早已定义 --dur-* / --ease-* 并注明「各组件硬编码 0.13s~0.3s 与各不相同的缓动，手感不一致」，但迁移只做了一半——14 个组件里仍有 46 处裸时长与裸缓动，同类悬停反馈在不同页面分别是 130/140/150/180ms；现已按 90/150/220/320ms 刻度逐条归位，并为原先只写时长、没写缓动的声明补上标准缓动（否则会退回浏览器默认 ease）',
      '新增 tests/motionTokens.test.js：交互声明不得出现 90–400ms 裸时长、CSS 令牌值必须与 motion.js 的 JS 常量一致、DESIGN_TOKENS.md 里提到的 token 必须真实存在；循环动画周期（骨架微光 1.5s、旋转 1.1s、呼吸 4.2s）与注意力脉冲（2.4s）刻意排除在刻度之外',
      '修复设计令牌文档漂移：DESIGN_TOKENS.md 初稿写的 --dur-deliberate 与 --ease-exit 并不存在（实际是 --dur-reveal，且没有 exit 缓动），同时补上动效刻度边界与「不要改 transition-duration」的说明',
      '清理课表页死 CSS：ScheduleView.vue 里逐字复制了一份属于子组件 ScheduleGrid 的单日视图样式（.mobile-day-view / .day-nav / .mobile-course-* ），而 scoped CSS 只作用到子组件根节点，这些规则连同配套的 display:none 与媒体查询覆盖从未生效；删除后渲染完全一致，并留注释说明样式归属',
      '修正一处错误结论：桌面端「切换单日视图」按钮并非空操作，那条 display:none 因为 scoped 作用域限制从未生效；已撤回报告中的判断',
      '修正 voiceInput.js 注释与运行时提示互相矛盾之处：改为「无自有后端 ≠ 完全离线可用」——应用不带 key、不请求第三方端点，但浏览器的 Web Speech 实现会把音频送到厂商云端识别，断网时会以 network 错误失败',
      '三处二维码/裁切图加 decoding="async"（不适用 loading="lazy"：这三张图都是当下就要显示的内容，懒加载只会延迟渲染）；FocusPanel.vue 去掉从未使用的 focusSessions 解构',
    ],
  },
  {
    version: '2026年09月19日-版本5',
    signature: '547b70c581',
    notes: [
      '动效令牌真正落地：style.css 早已定义 --dur-* / --ease-* 并注明「各组件硬编码 0.13s~0.3s 与各不相同的缓动，手感不一致」，但迁移只做了一半——14 个组件里仍有 46 处裸时长与裸缓动，同类悬停反馈在不同页面分别是 130/140/150/180ms；现已按 90/150/220/320ms 刻度逐条归位，并为原先只写时长、没写缓动的声明补上标准缓动（否则会退回浏览器默认 ease）',
      '新增 tests/motionTokens.test.js：交互声明不得出现 90–400ms 裸时长、CSS 令牌值必须与 motion.js 的 JS 常量一致、DESIGN_TOKENS.md 里提到的 token 必须真实存在；循环动画周期（骨架微光 1.5s、旋转 1.1s、呼吸 4.2s）与注意力脉冲（2.4s）刻意排除在刻度之外',
      '修复设计令牌文档漂移：DESIGN_TOKENS.md 初稿写的 --dur-deliberate 与 --ease-exit 并不存在（实际是 --dur-reveal，且没有 exit 缓动），同时补上动效刻度边界与「不要改 transition-duration」的说明',
      '清理课表页约 25 行死 CSS：ScheduleView.vue 里逐字复制了一份属于子组件 ScheduleGrid 的单日视图样式（.mobile-day-view / .day-nav / .mobile-course-* ），而 scoped CSS 只作用到子组件根节点，这些规则连同配套的 display:none 与媒体查询覆盖从未生效；删除后渲染完全一致，并留注释说明样式归属',
      '修正一处错误结论：桌面端「切换单日视图」按钮并非空操作，那条 display:none 因为 scoped 作用域限制从未生效；已撤回报告中的判断',
      '修正 voiceInput.js 注释与运行时提示互相矛盾之处：改为「无自有后端 ≠ 完全离线可用」——应用不带 key、不请求第三方端点，但浏览器的 Web Speech 实现会把音频送到厂商云端识别，断网时会以 network 错误失败',
      '三处二维码/裁切图加 decoding="async"（不适用 loading="lazy"：这三张图都是当下就要显示的内容，懒加载只会延迟渲染）；FocusPanel.vue 去掉从未使用的 focusSessions 解构',
    ],
  },
  {
    version: '2026年09月19日-版本4',
    signature: '3c9822af8a',
    notes: [
      '修复回顾叙事把笔记算到错误日期：createdAt 有 ISO 字符串与毫秒数字两种形态，原来直接 slice(0,10) 取的是 UTC 日期，数字型更会得到空串而整条笔记从所有日期里消失；统一走应用时区的 createdDateKey',
      '修复闰日纪念日：02-29 的生日与安装日在非闰年整年不命中，第一周年永不显示（下次命中时年数已变成 4）；归一化改用真实日历校验，02-31 / 04-31 这类永不触发的死配置被丢弃',
      '修复账本「常记」的最近使用加权：数字型 createdAt 被 Date.parse 解析成 NaN，导致权重归零、排序退化成纯次数',
      '修复影子副本写入失败会永久丢掉这批更新：原来先把待写队列清空再去写，失败只报错不重排，该键的安全副本会一直停在旧值；现在失败重新排队并指数退避（240ms 起、30s 封顶，避免每 240ms 空转），页面隐藏/关闭时补写一次',
      '同步加固：跨标签页消息带协议版本与同步空间 ID，版本不符或属于另一个空间的消息被丢弃，来自其他标签页的错误文本截断后再进 UI；CAS 冲突加毫秒级随机退避，避免两个标签页互相顶掉对方的推送；没有 BroadcastChannel 时立即同步不再返回假成功',
      '修复备份完整性校验可被绕过：v7 起的导出会写入 checksum，但导入侧只在 checksum 恰好存在时才校验，把该字段整段删掉就能导入被改过的备份；现在 v7+ 必须带校验和，v1–v6 的老备份（含应急导出）照旧可恢复',
      '修复按钮加载态从未显示：style.css 定义了 .btn[aria-busy=true] 的 spinner 与重复点击拦截，但整个 src 目录没有一处设置过 aria-busy，这条规则自始至终没生效；已为快速记录、外观设置、课表导入冲突与同步配对按钮接线',
      '底部抽屉的速度判定改为时间窗口：只统计最后 100ms 的采样（按个数截断在低帧率设备上会跨到数百毫秒，把快甩平均成慢速），并新增「甩完停住再松手不算甩动」，不再误关抽屉',
      '长按菜单补上离场过渡，与弹窗/动作面板节奏一致；危险项的悬停底色改用主题色混色，深色主题下不再是浅粉底配亮红字',
      '账本索引读取器加兜底：残缺或尚未构建的索引不再抛 TypeError 打挂整个账本视图；虚拟列表行高采样加 4px 滞回，消除「改高度 → 位置变 → 重新测量 → 再改高度」的滚动抖动回环',
    ],
  },
  {
    version: '2026年09月19日-版本3',
    signature: '77e4566dd6',
    notes: [
      '可访问性：全站配色按 WCAG AA 校准——最弱文字 #7d879e→#626d84（3.36→4.70:1）、危险色 #ef4444→#c62828（3.76→5.62:1）、主色与紫/绿/粉三套主题色分别下调到「实底白字 ≥4.66:1」，深色主题的实底按钮改用深色文字；侧栏 10px 分组标题（2.60:1）与待办优先级/截止/课程标签的硬编码色一并达标；新增 scripts/audit-contrast.mjs（支持 --json/--all/--tokens）与 tests/contrastAudit.test.js，60 组主题配色纳入回归',
      '可访问性：新增外观设置「高对比度」开关并与系统 prefers-contrast 协同；新增常驻 aria-live 播报区，路由切换与操作结果可被读屏读出；空状态与弹窗标题支持配置层级，不再出现 h1→h3 跳级；全局搜索结果显示关键词高亮',
      '修复账本页「撤销」按钮从不显示：删除交易与快速记录保存后的 showToast 第二个参数误传函数而不是选项对象，actionLabel 落空导致 Toast 的撤销入口不渲染',
      '修复账本页卸载时报错并泄漏监听器：onBeforeUnmount 清理了一个从未声明的 toastTimer，抛 ReferenceError 后两个 removeEventListener 永远执行不到',
      '修复周重复待办：同一毫秒生成会撞 id、生成失败仍写下「已生成」标记导致永不重试、通过 updateTask 标记完成会绕过重复生成',
      '修复主题系统：自定义与具名主题现在会清掉上一套主题的全部内联变量（从深色切到自定义主题时不再残留深色底与深色危险色）；主题色 meta 增加 hex 校验并在缺失时补建；深色背景提亮',
      '修复壁纸取色主题下浅色强调色配白字读不出来：实底按需压暗、文字色按亮度自动切换',
      '修复自然输入金额不支持千分位（「午饭 1,234.56」被拆成名称「午饭 1,」与金额「234.56」）；修复提醒时间留空被当成「提前 0 分钟」而不是设置里的默认提醒',
      '底部浮层不再互相压盖：页面提示、快速记录提示与全局错误提示接入共享堆叠栈，同时出现时依次错开',
      '修复账本交易流日期分组行高跳动（首行判定改用虚拟列表的真实索引而非构建期位置快照）；流畅优先与减少动效时不再渲染节日装饰粒子',
      '修复未绑定同步空间的用户断网时看到「联网后会继续同步」的误导提示；滚动锁改为记录并还原进入前的内联 overflow；浮层焦点查询改用 checkVisibility，避免为每个候选元素强制样式计算',
    ],
  },
  {
    version: '2026年09月19日-版本2',
    signature: '9ecc1886b4',
    notes: [
      'UX 全面打磨（批次一·P0+P1 CSS）：按钮按下态、路由切换过渡、输入框聚焦环统一使用设计令牌；移除 12 处硬编码颜色（课表分段器、单元格、时间轴皮肤、生成框、标签页、备注输入、导航按钮、删除按钮、警告横幅、首页体验条/风险面板/空态/逾期复选框）；账本金额 0 支持；自定义主题 CSS 选择器补全；全部过渡改用 --dur-* / --ease-* token，并跟随减少动效降级',
    ],
  },
  {
    version: '2026年09月18日-版本7',
    signature: '3040188896',
    notes: [
      '主题切换：浅色与深色改为从点击位置圆形扩散切换，扩散半径按触点距离最远角落计算；浅色和深色页面各自真实存在，只做圆形裁切、不做整体缩放；开启减少动效时直接切换',
      '动效底座：统一时长与缓动标记（90/150/220/320/420 毫秒），新动效共用同一套曲线并跟随流畅模式降级',
      '移动端组件：新增底部操作菜单、可拖拽分段底部面板（中间档位吸附、上滑展开、下滑收起）、长按上下文菜单和双列滚轮时间选择器；日程的开始/结束时间改用滚轮选择，松手自动对齐到整格',
      '长按菜单：考试列表长按卡片即可置顶、编辑、归档或删除，桌面端右键同样可用；长按命中后不会顺带触发整行点击',
      '等待分级：启动过程显示真实阶段清单（检查本机数据安全、恢复未完成的同步、准备工作台数据、打开界面），路由懒加载改为按页面结构占位，不再是纯文字提示',
      '后台任务中心：自动同步等长任务在任意页面都有悬浮入口与结果记录，可以放心离开页面、完成后再回来查看；不改变任何任务原有的取消与中断语义',
      '浏览位置：列表页翻到一半跳到别的页面再回来会回到原来的位置；浏览器前进/后退仍以自身记录的位置为准',
    ],
  },
  {
    version: '2026年09月18日-版本6',
    signature: 'd69fa4853d',
    notes: [
      '修复：手机版数据管理的备份/同步/迁移/恢复分区导航改为弹窗内滚动，不再把地址改写成 #data-restore；此前点「恢复」会命中 404 兜底页，恢复完成后的重新载入也停在该地址上，手机上「从备份恢复」看起来完全不可用',
      '修复：同步 manifest 校验不再因版本漂移把同步空间锁死——已退休或改分类的同步键（例如 sl_food_filters）不再触发「云端 manifest 与数据内容不一致」，旧版客户端写入的完整性标记改为提示并按数据内容继续合并',
      '修复：同步指纹在加密前后保持一致（JSON 往返归一化），undefined 属性、数组空洞与日期不再制造假差异、把同一份数据误判成冲突',
    ],
  },
  {
    version: '2026年09月18日-版本5',
    signature: '1da397a6b0',
    notes: [
      '优化：手机版「检查更新」的固定等待从 3 秒缩短到 0.8 秒，「已是最新版本」返回更快；更新时不再白等多出的 2 秒',
      '说明：PWA 更新采用内容哈希分包，之后每次发版只下载本次改动的文件（通常很小），之前的慢是这次改动文件多导致的一次性开销',
    ],
  },
  {
    version: '2026年09月18日-版本4',
    signature: 'bf36010149',
    notes: [
      '修复：手机 PWA 发版后「数据管理/同步绑定」等懒加载入口打不开、且不自动更新——应用分包改为全部预缓存（仅 Excel 解析与 OCR 引擎仍按需），避免分包 hash 变更导致缓存错位',
      '修复：应用打开后约 2 秒即静默检查更新（原 30 秒），更快自动刷新到新版本',
    ],
  },
  {
    version: '2026年09月18日-版本3',
    signature: 'cedf3ed361',
    notes: [
      '账本：新增退款/冲正能力——对支出登记退款后按退款日冲抵当月支出（不计入收入、不进分类分布），超额退款会被拦截，固定账单支付走「撤销支付」；退款记录可一键撤销',
    ],
  },
  {
    version: '2026年09月18日-版本2',
    signature: '7d4bc0802b',
    notes: [
      '账本：首页「花费概览」新增本月环比提示（较上月多/少多少），仅在上月有数据时显示',
      '账本：回顾页支持把当月账单导出为 CSV 或 Excel，字段含日期/时间/名称/分类/收支/金额/账户/备注，Excel 按需加载',
      '首页：个性化里「今天页模块」支持拖拽排序与恢复默认顺序，首页按该顺序渲染，历史数据无缝兼容',
    ],
  },
  {
    version: '2026年09月18日-版本1',
    signature: 'ca95e0aa93',
    notes: [
      '性能：移除运行时农历引擎 lunar-javascript（约 300KB），农历/节气节日改用内置 2015-2050 静态日期表',
      '功能：新增「日程」管理页（/events），支持列表、搜索、新建、编辑、归档与删除',
      '功能：新增全局搜索，一次搜索课程、待办、日程、笔记、固定账单、账本记录与清单',
      '功能：备份导出支持按模块勾选；超过 7 天未备份时给出一次性可关闭提醒',
      '性能：笔记页接入虚拟列表，大量笔记不再全量渲染',
    ],
  },
  {
    version: '2026年09月16日-版本4',
    signature: '6d1309a769',
    notes: [
      '手机端底部导航调整为「首页 · 课程 · 记录 · 账本 · 更多」，待办收进「更多」',
    ],
  },
  {
    version: '2026年09月16日-版本3',
    signature: 'd0166e52a6',
    notes: [
      '功能：特殊日期（补课/放假）支持编辑已有条目，录错可直接改不用删了重录；桌面侧栏「账本」与「待办」交换位置；课程表「更多设置」的时间规则分组更名为「时间与日期」',
    ],
  },
  {
    version: '2026年09月16日-版本2',
    signature: 'a24d899237',
    notes: [
      '性能：课程表周视图改为复用一次性建立的多天课程索引，避免每天重复扫描；时间轴渲染缓存当前作息时间与节次索引，减少重复的季节解析与线性查找；账本交易行的分类与滑动手势动作在索引构建时只做一次并复用引用，快速滚动不再反复创建新数组',
    ],
  },
  {
    version: '2026年09月16日-版本1',
    signature: '1b37033106',
    notes: [
      '性能：账本交易流改为按可见项惰性格式化，点开「查看全部」不再整库逐条计算分类、滑动手势与金额文案；账本索引排序改为先构造排序键再比较，降低每次记账与进入账本页的重复开销',
      '性能：虚拟列表在提供精确行高时跳过每帧行高采样与 DOM 扫描，并对列表关闭浏览器滚动锚定，消除账单「查看全部」后快速上下翻动的卡顿与抖动',
      '特殊日期：放假支持开始到结束的日期范围，补课支持指定第几周并选择按周几课表显示，网格与列表同步展示周次信息',
    ],
  },
  {
    version: '2026年09月14日-版本1',
    signature: 'fa22bf0083',
    notes: [
      '性能与一致性优化：账本筛选与常用条目统计统一按分转金额单次标准化，避免重复解析；账本、待办、随手记、日程、重要日期、固定账单、专注记录、生活清单、课程、课表模板、特殊日期与心情日志等增长集合改为显式提交，避免嵌套修改触发全量深度监听；心情单日查询改为按日期直接读取；待办列表一次缓存状态、截止时间与排序字段，减少重复扫描；周回顾各项统计改为单次聚合，首页提醒避免重要日期全量排序；首页未来课程与周回顾多日课程查询共享按星期索引；首页未来课程计算复用时间表；同步提交去掉远端值的重复深拷贝；账本回顾统一过滤归档、删除和脏金额记录，并按分聚合月度数据，历史非补零时间按真实时刻排序；固定账单统一识别历史关联字段，禁止暂停账单支付，防止撤销旧账期回拨最新周期。',
    ],
  },
  {
    version: '2026年09月13日-版本1',
    signature: '4309a7ea44',
    notes: [
      '账本性能：查看全部继续使用 VirtualList；日期分组改为带稳定 key 的视图投影并按真实固定高度计算；静止交易行不再强制使用 transform layer，保留左滑编辑、删除、账单撤销和 focus 定位。',
      '账本性能：缓存金额 formatter 与分类 lookup，补充 5000 笔 DOM 上限、分组高度和静止 swipe 行回归测试。',
    ],
  },
  {
    version: '2026年09月12日-版本11',
    signature: '9944a0b3f8',
    notes: [
      '统一深色主题下的基础输入控件、分段按钮、标签和弹窗背景，浅色主题视觉保持不变。',
    ],
  },
  {
    version: '2026年09月12日-版本10',
    signature: '139cbb9a08',
    notes: [
      'KeepAlive 缓存页离开后释放 VirtualList 的滚动、尺寸监听，减少不可见页面的后台测量开销。',
    ],
  },
  {
    version: '2026年09月12日-版本9',
    signature: 'be5bd9b320',
    notes: [
      '修复 Ledger 左滑操作层透出问题：关闭状态由不透明内容层遮挡，只有滑动位移后显示编辑与删除。',
    ],
  },
  {
    version: '2026年09月12日-版本8',
    signature: '208207af62',
    notes: [
      '固定账单交易按实际账单关联字段识别撤销支付，覆盖历史兼容关联形式。',
    ],
  },
  {
    version: '2026年09月12日-版本7',
    signature: 'f25f6cec42',
    notes: [
      '修复 Ledger 左滑单开状态初始化顺序，确保 immediate 路由 watcher 挂载安全。',
    ],
  },
  {
    version: '2026年09月12日-版本6',
    signature: '55dc76f66a',
    notes: [
      'Ledger 左滑动作距离收紧为 140px，确保移动端展开上限符合交互规范。',
    ],
  },
  {
    version: '2026年09月12日-版本5',
    signature: '7200414ee4',
    notes: [
      'Ledger 移动端交易左滑快捷编辑/删除，保留固定账单撤销支付、撤销滑动删除并兼容 VirtualList。',
    ],
  },
  {
    version: '2026年09月12日-版本4',
    signature: '93cf363c8e',
    notes: [
      '时间一致性补强：回放、节日设置与特殊日期的默认日期统一跟随应用时区，避免系统时区与用户设置不一致。',
      'PWA 缓存收敛：OCR、课表识别、Excel 导入等低频异步块改由访问后 runtime cache 接管，继续保留核心页面离线可用。',
    ],
  },
  {
    version: '2026年09月12日-版本3',
    signature: '097a48def6',
    notes: [
      '闭环体验：补齐心情记录、空状态下一步、课程/任务/笔记/账单/考试实体深链聚焦，以及笔记编辑、关联查看和幂等转换。',
      '时间一致性：统一应用当前时间上下文，修复跨午夜、跨月和跨年刷新边界，并让首页、课表、待办、账本与回顾使用同一日历基准。',
      '性能与可靠性：农历节日按需加载，拆分首屏重模块；增加存储序列化/写入/镜像耗时观测、启动时序观测和合成性能回归覆盖。',
    ],
  },
  {
    version: '2026年09月12日-版本2',
    signature: '1053ead5ec',
    notes: [
      '账本摘要移除本月收入与本月结余，改为并列展示今天花费、本周花费和本月花费，首页信息只聚焦支出节奏。',
      '保留收入记账、收入分类与筛选能力，不改变既有交易数据和账本统计边界。',
    ],
  },
  {
    version: '2026年09月12日-版本1',
    signature: 'f34acda1f1',
    notes: [
      '记录：QuickRecord 聚焦输入优先，预览支持人话确认、就地切换类型与编辑分类、金额、日期，保存后提供撤销与查看。',
      '账本：摘要收敛为支出、收入、结余，统一“记一笔”入口；交易按日期紧凑分组，并支持详情内快速修改。',
      '移动端：降低记录入口视觉噪音，优化键盘与输入法行为、深色模式和金额上下文识别回归。',
    ],
  },
  {
    version: '2026年09月08日-版本6',
    signature: '96e5ac9b5b',
    notes: [
      '数据安全：Food 退休改为备份与 Vault 清理成功后才删除本机数据；课表备注纳入备份、恢复与 v4 同步，并用旧客户端写入门禁防止覆盖。',
      '信息架构：桌面主导航收敛为首页、课程、待办、账本，清单和笔记均降至低频入口；Today 只保留行动与回顾信息。',
    ],
  },
  {
    version: '2026年09月07日-版本3',
    signature: '087008e0aa',
    notes: [
      '旧 Food 路径现在统一进入 404 页面，不再显示空白内容。',
    ],
  },
  {
    version: '2026年09月07日-版本1',
    signature: '0fa0b4fca1',
    notes: [
      '移除“吃什么”产品入口并幂等清理旧本地与 IndexedDB 镜像数据，保留账本餐饮分类和旧 Payload 安全忽略。',
    ],
  },
  {
    version: '2026年09月05日-版本7',
    signature: 'a9f3344389',
    notes: [
      '账本：金额边界统一按分归一化，修复浮点汇总、无效金额和时区跨日；统计只从交易派生，账单支付保持账期幂等。',
      '账本：手动记账改为金额优先并支持支出/收入切换、搜索筛选和轻量历史分组；QuickRecord 自然语序、分类确认与移动端弹窗体验完成收口。',
    ],
  },
  {
    version: '2026年09月05日-版本6',
    signature: 'aa1240433d',
    notes: [
      '修复新设备首次加入同步空间后刷新页面会丢失确认入口的问题；待确认状态现在可恢复，主按钮会直接打开安全合并预览。',
      '同步成功状态改为准确描述本机与同步空间的一致性，不再误示所有设备都已完成首次加入。',
    ],
  },
  {
    version: '2026年09月05日-版本5',
    signature: 'cb333649fc',
    notes: [
      '修复自动同步前端与 Durable Object 协调器版本错配：新增协议能力健康检查和统一生产发布门禁，避免再次出现未知同步操作。',
      '修复配对准备与领取的 KV/DO 一致性、恢复设备注册、设备平台保存及改名撤销镜像；补齐同步锁释放和永久错误停止重试。',
    ],
  },
  {
    version: '2026年09月05日-版本4',
    signature: '10148f15ee',
    notes: [
      '修复添加设备入口在连接校验竞态期间被错误禁用：绑定状态存在时直接使用本地设备凭据生成一次性配对码，并为失败、离线和重试提供明确反馈。',
      '同步页收敛配对状态与设备元数据刷新：自动同步关闭时仍可手动完整同步，设备列表独立刷新并保留平台类型与最近活动。',
    ],
  },
  {
    version: '2026年09月05日-版本3',
    signature: '169f89d63e',
    notes: [
      '修复 Bootstrap P0 数据覆盖：绑定和加入同步空间在远端确认前不再建立 Base；首次协调保留本机或云端独有数据，同 ID 与 singleton 冲突必须确认',
      '兼容历史错误 Base：同步前先进入人工重新校准并阻断 AutoSync；状态卡区分最后检查与最近同步，设备显示最近活动',
    ],
  },
  {
    version: '2026年09月05日-版本2',
    signature: 'f753072c8d',
    notes: [
      '多设备同步 UX 收口：主页面统一同步状态，默认隐藏 SyncSpace 完整编号，设备管理、改名、配对、恢复与危险操作按主次分层。',
      '首页心情区适配窄屏：表情保持单行，节日入口与标题同排，避免按钮掉到右下角造成大片空白。',
    ],
  },
  {
    version: '2026年09月05日-版本1',
    signature: '9cec3897c5',
    notes: [
      '优化 iPhone 添加设备流程：未开启摄像头时不再占用空预览区，完整绑定内容输入框键盘弹起后自动居中可见；新增完整内容复制入口，并明确同步空间编号不能用于绑定。',
      '首页课程提醒：只有距离课程开始 24 小时内才显示“距开始”倒计时，超过 24 小时仅保留课程日期和时间。',
    ],
  },
  {
    version: '2026年09月04日-版本4',
    signature: '244652aded',
    notes: [
      '修复 iPhone PWA 更新后可能卡在页面未完整加载：在 App 尚未加载前遇到资源预加载错误时，安全注销旧 Service Worker、清理离线资源缓存并重载最新入口；不触碰本地业务数据。',
    ],
  },
  {
    version: '2026年09月04日-版本3',
    signature: '66733de7ab',
    notes: [
      '发布验收修复：允许带明确验收标记的 Cloudflare Preview 保持独立来源，避免误重定向到正式域名；普通 Preview 路径行为不变',
    ],
  },
  {
    version: '2026年09月04日-版本2',
    signature: '7bf818564c',
    notes: [
      '多设备自动同步：新增无账号 SyncSpace、设备凭证、一次性配对二维码与恢复密钥，复用原有加密合并/CAS 管线',
      '同步体验：前台 debounce、revision 轮询、离线退避、冲突暂停、多标签页 leader 与设备撤销/改名',
      '数据安全：服务端仅保存 verifier 与密文，不保存 payload key 或业务明文；保留旧 6 位访问码手动兼容',
    ],
  },
  {
    version: '2026年09月04日-版本1',
    signature: '388b556df6',
    notes: [
      '移动端课程表备注：保留原位置和外观，改为支持换行、长内容滚动的多行输入',
    ],
  },
  {
    version: '2026年09月02日-版本1',
    signature: 'b8dfae7287',
    notes: [
      '固定账单：首页支付后自动推进周期，不再继续出现在“接下来”提醒中。',
      '移动端重要日期：底部卡片的置顶、编辑、归档、删除菜单改为向上展开并解除裁剪，所有操作可正常触达。',
    ],
  },
  {
    version: '2026年09月01日-版本22',
    signature: 'f2b194fba7',
    notes: [
      '粘贴通知：升级为通知理解确认流程，按缴费、作业、会议、考试、课程和普通通知动态展示关键事实并推荐处理方式',
      '粘贴通知：支持行动结论可编辑、原文折叠与重新解析、可靠多事项选择，以及待办/作业/日程/仅保存通知分流',
      '全局快速记录：完成普通保存、保存并继续、失败保留、重复点击保护、撤销与八类业务落点的收尾审计',
      '快速记录解析：支持一句话中的支出与待办双动作，并支持“还有 N 天”的倒计时识别',
    ],
  },
  {
    version: '2026年09月01日-版本21',
    signature: '8016b67e1a',
    notes: [
      '粘贴通知：统一标准化、候选提取和上下文判断，支持多行通知、自然日期、中文时间、地点、提醒与部分识别预览，并始终保留原始文本。',
      '语音输入：修复 final/interim 重复拼接与异常丢失，转写结果继续复用统一文字解析，完成后允许用户确认和修改。',
    ],
  },
  {
    version: '2026年08月31日-版本20',
    signature: 'eb271666f1',
    notes: [
      '课程表：新增备注横条，可在课程表下方快速记录备注信息。',
    ],
  },
  {
    version: '2026年08月31日-版本19',
    signature: '3b09167160',
    notes: [
      '学期设置：选择周四等日期时自动归一到所在周周一并明确提示，不再让用户无法保存或把非周一日期误当首周周一。',
    ],
  },
  {
    version: '2026年08月31日-版本18',
    signature: 'aa5d6ce610',
    notes: [
      '课程表：学期尚未开始时显示真实当前日期（例如 8 月 31 日），不再强制显示第 1 周的 9 月 7 日；第 1 周仍从设置的周一日期开始计算。',
    ],
  },
  {
    version: '2026年08月31日-版本17',
    signature: '6c9cb3e700',
    notes: [
      '学期设置：禁止把周四等非周一日期保存为第一周周一，避免整周日期错位；日期展示严格按已保存的真实周一计算。',
    ],
  },
  {
    version: '2026年08月31日-版本16',
    signature: '7dffd4d537',
    notes: [
      '课程表：修复未来学期首周日期被自动改成本周一的问题；周视图和移动端日期现在严格按学期设置的真实首周周一计算。',
    ],
  },
  {
    version: '2026年08月31日-版本15',
    signature: 'c9afa29398',
    notes: [
      '课程表：修复学期开始日期默认值导致周次计算偏移（显示为 9 月 7 日）的问题；新默认值按学年固定为 9 月 1 日（秋季）或 3 月 1 日（春季），而非动态计算“本周一”。',
    ],
  },
  {
    version: '2026年08月30日-版本14',
    signature: 'b0843a5dc3',
    notes: [
      '课程确认：修复按需解析器加载完成后节次下拉仍被缓存为空的问题；开始/结束节次现在会立即显示当前作息设置的可选项。',
    ],
  },
  {
    version: '2026年08月30日-版本13',
    signature: '216232cd60',
    notes: [
      '专注提醒：开启系统通知时会在保存设置时请求浏览器权限；不支持或被拒绝会说明原因，不再出现“开关已开但从不通知”。',
      '吃什么：删除候选后提供 6 秒撤销，恢复原位置和当天暂不吃状态，与待办、倒计时和清单保持一致。',
    ],
  },
  {
    version: '2026年08月30日-版本12',
    signature: 'cac0e0818f',
    notes: [
      '课程确认：开始周和结束周改为明确的周次下拉；开始节次和结束节次实时跟随“作息与时间设置”，支持自定义节次名称。',
      '作息联动：跨节课程及课表模板占用的节次会显示占用数量并禁止误删，切换设置页时保护未保存的作息草稿。',
      '体验修复：统一待办与倒计时的删除确认/撤销，避免快速记录批量保存失败后重复写入，关闭弹窗时立即停止语音识别。',
      '数据保护：修复固定账单金额校验、残缺旧账本索引、迁移包结构校验和旧版流畅模式恢复。',
    ],
  },
  {
    version: '2026年08月30日-版本11',
    signature: '2ec18a23bd',
    notes: [
      '课程识图：打通 OCR 结构诊断与导入预览，建议确认的课程现在会准确匹配到对应行并显示具体原因。',
      '课程识图：待确认课程支持在提示卡中直接修改课程名、星期、节次、周次、单双周、地点和教师，保存后立即重新校验。',
      '课程识图：确认数量改为按原始课程行绑定；节次编辑只使用当前作息设置中的编号节次，并显示真实节次名称。',
    ],
  },
  {
    version: '2026年08月30日-版本10',
    signature: '5b03d2d92b',
    notes: [
      '课程识图：建议确认不再只显示数量，预览直接列出对应课程、行号、星期、节次、地点、教师和具体待确认原因。',
    ],
  },
  {
    version: '2026年08月30日-版本9',
    signature: '4e46848b5d',
    notes: [
      '课程导入：Excel 课表保留“追光楼3603（智慧）”这类楼名加房间号，不再误当作班级编号过滤。',
      '作息识图：时间列按版面坐标优先还原；逐行 OCR 发生跨列乱序时不再覆盖正确列，缺失项显式提示确认。',
      '作息设置：修复首次打开弹窗时草稿未初始化导致的渲染异常，并对 OCR 残缺括号等异常字段提示确认。',
    ],
  },
  {
    version: '2026年08月30日-版本8',
    signature: 'fcaadd434b',
    notes: [
      '工程质量：全量 lint 排除 dist-bak 历史构建产物，恢复真实源码质量门禁',
    ],
  },
  {
    version: '2026年08月30日-版本7',
    signature: 'e7c9716e12',
    notes: [
      '依赖安全：Excel 解析改用维护中的 @e965/xlsx，移除存在高危且无修复公告的旧 xlsx 包',
    ],
  },
  {
    version: '2026年08月30日-版本6',
    signature: '391fe914c9',
    notes: [
      '课程识图：课表截图改为准确优先模式，提高密集长图的文字分辨率并比较增强结果',
      '课程识图：合并同一星期、节次、周次中仅 OCR 尾字不同的重复课程，减少重复导入',
    ],
  },
  {
    version: '2026年08月30日-版本5',
    signature: 'ddd29b4bc7',
    notes: [
      '课程导入：修复批量预览在解析器按需加载后始终显示 0 门课程的问题',
      '课程导入：支持直接上传 XLS/XLSX/CSV/ODS，并识别课程清单和教务系统星期表格',
      '课程识图：增强教务系统长截图的星期锚点与逐列解析，恢复星期、节次、周次、教师和地点',
    ],
  },
  {
    version: '2026年08月30日-版本4',
    signature: 'a026dfe41e',
    notes: [
      '数据安全：恢复旧版备份时仅写入文件实际携带的字段，保留当前版本新增模块数据',
      '数据安全：用户正常删空数据后同步更新设备内安全副本，避免旧记录在异常恢复时复活',
    ],
  },
  {
    version: '2026年08月30日-版本3',
    signature: 'cc55e456c5',
    notes: [
      '修复课程表无法添加课程：手动添加、点击空白格子和识图导入全部失效。根因是课程表页面组件化重构时丢失了 OCR 进度步骤、事件映射、引擎失败判断和保存提示的函数定义，导致保存后被异常回滚、识图启动即报错；已补齐定义并加入保存成功轻提示，课程添加与识图导入恢复正常。',
    ],
  },
  {
    version: '2026年08月30日-版本2',
    signature: '5a10f18897',
    notes: [
      '专注模块重构：自由/临时/关联待办三类专注，支持自定义时间与最近临时目标，可靠暂停超时继续，完成页极简，可选休息，专注设置配置常用时间与提醒开关，待办累计专注数据',
    ],
  },
  {
    version: '2026年08月30日-版本1',
    signature: '2aa7c32a61',
    notes: [
      '快速记录重构：新增实体提取层和意图置信度，金额支持不同语序（如“花了五元买牛肉面”）与口语金额（如“12块5”），不确定类型可降级保存为快速笔记；快速笔记改为真正自由模式，只保留正文和可选标题，语音只做转写不再解析',
      '快速记录面板重做为智能/自由双模式，结果卡片默认紧凑、修改时展开；语音增加聆听、转写、识别完成状态和最长聆听时间；笔记数据新增来源文本与标签备注，并为后续笔记整理（转待办、转日程）预留适配器',
      '修复内置农历和节气节日对照：改由本地历法按实际年份计算，覆盖当前年前后各六年，不再依赖易出错的静态日期表；节日、心情、OCR 词库和快速记录设置已纳入备份与设备迁移。',
      '首页新增只读的「今日行动清单」，按时间聚合当天课程、待办、日程、节点和应付账单，并可直接完成待办；OCR 旧入口改为复用统一 Worker、超时和内存回收管线。',
      '体验增强：行动清单中的逾期待办可一键安排到今晚，普通当天待办可推到明天；新增 25/45 分钟轻量专注，记录真实投入时长并进入本周脉搏。',
      '学习闭环：当天课程可快速标记听懂、模糊、需要复习或缺课；首页据此显示课程负荷、周内建议和可整理的快速记录收件箱。课程支持设置校区与提前出发时间。',
      '数据可靠性：二维码迁移及其撤销改为通过统一存储提交，会立即标记本机数据已变化并刷新设备内安全副本；修复合并迁移把快速记录设置误当数组的问题。',
      '体验修复：专注计时暂停后不再把暂停时长计入实际专注；课程负荷只保留最近一次且仍有效的复习信号；特殊日期默认日期与备份文件名统一按本地时区计算。收件箱默认收起历史记录，课后反馈补齐可访问性选中状态。',
      '今天页现在可在个性化外观中按模块显示或隐藏；收件箱支持根据快速记录已有标签筛选，不改变原有笔记数据。',
      '学习与识图体验：学习倒计时可一键生成当天 25 分钟复习待办并进入专注流程；课程表上传新增本地框选裁切后重试，固定账单增加月均、未来 30 天和全年预算预测。同步页补充双方都修改时的明确保留策略与确认入口。',
    ],
  },
  {
    version: '2026年08月29日-版本19',
    signature: '1a2a333fad',
    notes: [
      '快速记录补强中文金额与连续多笔消费拆分，避免将明确消费误归类为待办；账本结果支持按需修改分类和账户',
      '输入框新增与麦克风并列的手动入口；快速笔记改为正文优先、标题可选的自由文本卡，保留原有笔记数据兼容',
    ],
  },
  {
    version: '2026年08月29日-版本18',
    signature: '08e1f413a7',
    notes: [
      '建立统一业务底座：待办、考试节点、日程、笔记、交易和固定账单通过共享命令层写入，补齐来源、关联、更新时间与兼容迁移；首页近期提醒改为从真实数据动态计算并去重。',
      '课程删除现在会同步解除任务、考试、日程和笔记关联且保留可读课程名；固定账单支付增加期次标识避免重复记账；回放纳入日程、笔记和收入。',
      '消除云同步存储入口的无效动态导入构建警告，并重写 README，补充架构、功能闭环、隐私同步、开发与部署说明。',
    ],
  },
  {
    version: '2026年08月29日-版本17',
    signature: 'a0f10e5c5b',
    notes: [
      '快速记录改为底部全局入口，移除遮挡正文的常驻悬浮卡；支持待办、作业、日程、支出、收入、固定账单、倒计时和笔记的本地解析、局部确认与批量保存',
      '账本新增收入方向兼容，日程、笔记和快速记录设置纳入本地备份、迁移与云同步；首页增加快速记录摘要，桌面支持 Ctrl/Cmd + K；页面上下文只影响未明确记录的判断',
    ],
  },
  {
    version: '2026年08月29日-版本16',
    signature: '63d496ced9',
    notes: [
      '快速记录改为底部全局入口，移除遮挡正文的常驻悬浮卡；支持待办、作业、日程、支出、收入、固定账单、倒计时和笔记的本地解析、局部确认与批量保存',
      '账本新增收入方向兼容，日程、笔记和快速记录设置纳入本地备份、迁移与云同步；首页增加快速记录摘要，桌面支持 Ctrl/Cmd + K',
    ],
  },
  {
    version: '2026年08月29日-版本15',
    signature: 'b3321f843f',
    notes: [
      '快速记录改为底部全局入口，移除遮挡正文的常驻悬浮卡；支持待办、作业、日程、支出、收入、固定账单、倒计时和笔记的本地解析、局部确认与批量保存',
      '账本新增收入方向兼容，日程、笔记和快速记录设置纳入本地备份、迁移与云同步；首页增加快速记录摘要，桌面支持 Ctrl/Cmd + K',
    ],
  },
  {
    version: '2026年08月29日-版本14',
    signature: '2858e05c60',
    notes: [
      '快速记录改为底部全局入口，移除遮挡正文的常驻悬浮卡；支持待办、作业、日程、支出、收入、固定账单、倒计时和笔记的本地解析、局部确认与批量保存',
      '账本新增收入方向兼容，日程、笔记和快速记录设置纳入本地备份、迁移与云同步；首页增加快速记录摘要，桌面支持 Ctrl/Cmd + K',
    ],
  },
  {
    version: '2026年08月29日-版本13',
    signature: '8651dd88cb',
    notes: [
      '修复节日设置里生日年份被占用位年份重置的问题：新增本地键 sl_festive_birthday_full 记住出生年份，关闭设置面板后年份不再被改回占位年份；生日祝福仍按月-日触发、sl_festive_config.birthday 语义不变，纪念日列表补充「只记月-日」说明。',
    ],
  },
  {
    version: '2026年08月29日-版本12',
    signature: 'ccde5a9666',
    notes: [
      '格式化函数统一到 utils/formatters.js，账本视图接入共享实现',
      '存储读写静默失败接入 recordSilentError 可观测性记录',
      'useStoredRef 补充 JSDoc 泛型说明',
      'ESLint 新增 no-var/no-throw-literal/prefer-const 等规则并修复存量',
      '新增 test:coverage 覆盖率命令与 formatters 单元测试',
    ],
  },
  {
    version: '2026年08月29日-版本11',
    signature: 'f932c4e595',
    notes: [
      '新增节日与纪念日设置面板：首页心情记录条右侧「🎯 节日」随时打开，可开关节日氛围、设置生日/开始使用日期，增删改纪念日（写入前自动归一化并即时保存）；面板内置只读节日对照表（固定公历节日 + 2026–2030 农历/节气公历日期）供肉眼核对，未收录年份自动跳过不报错。',
    ],
  },
  {
    version: '2026年08月29日-版本10',
    signature: '4ca11dd4e1',
    notes: [
      '云同步支持选择性拉取：从云端拉取前可勾选数据模块（课程/待办/倒计时/清单/账本/吃什么/外观主题/氛围心情），只对勾选模块做解密校验合并应用，未勾选模块本地逐项保持不变，撤销快照只覆盖本次涉及键；氛围与心情两个新键纳入同步清单且写入前归一化。',
      '修复语音识别不可用：start 同步抛错时显式反馈、未结束片段改为替换不再累加；不支持环境（Firefox/非 HTTPS）禁用语音并给一次性友好提示，常见错误码转中文提示，支持环境正常识别回填；补充选择性拉取与语音的单测。',
    ],
  },
  {
    version: '2026年08月29日-版本9',
    signature: 'c87f8f1b74',
    notes: [
      '快速录入入口改为常驻右下角悬浮按钮，任何页面可一键唤起一句话录入（待办/记账/倒计时）；复制文字后按钮自动切换为「已复制文字」提示态并预填内容。修复此前入口仅在复制后 3 秒出现、日常不可见的问题。',
    ],
  },
  {
    version: '2026年08月29日-版本8',
    signature: 'd67001030a',
    notes: [
      '氛围情绪引擎：首页自动识别元旦/春节/圣诞等节日与生日、纪念日、使用周年，呈现祝福与彩带、雪花、灯笼装饰，并可记录每日心情生成月度情绪概览。',
      '回顾叙事引擎：新增「回放」入口，按那天/月度/年度把课程、待办、账单与消费汇成叙事报告，支持复制与系统分享，年度报告年末一次性提示。',
      '快速录入引擎：支持文字与本地语音，一句话自动归类为待办/记账/倒计时；复制文字后 3 秒内弹出悬浮入口，可关闭；Safari 无语音时自动降级为纯输入。',
      '智能归类引擎：待办保存前自动匹配课程、按标题关键词补分类、紧急或三天内到期提升优先级；待办页新增一键智能整理。',
      '工程：五套纯函数补充 Vitest 单测，lint/typecheck/test 全部通过。',
    ],
  },
  {
    version: '2026年08月29日-版本7',
    signature: 'ce8389dbe9',
    notes: [
      '性能：课程表页将作息设置、批量导入、课程编辑等弹窗改为按需加载，仅查看课程表不再下载大批量模块，打开明显更快。',
      '性能：Service Worker 预缓存全部页面代码，点击现有导航入口（课程表、待办、账本等）直接进入、几乎零等待；二维码、OCR 等大体量模块仍按需下载。',
      '性能：账本、倒计时、清单、吃什么等页面同样享受预缓存，冷启动与来回切换更快。',
    ],
  },
  {
    version: '2026年08月29日-版本6',
    signature: 'f5f424e1f2',
    notes: [
      '更新体验：手机端每次更新后也会弹出版本说明，手机更多菜单新增检查更新入口，修复服务器版本确认失败时误报已是最新版本的问题。',
      '性能：手机端首页先渲染问候与接下来基本入口，其余面板在浏览器空闲后自动补齐，打开应用更跟手。',
      '性能：应用外壳的待办与课程数据读取延后到首帧之后完成，缩短首屏等待。',
    ],
  },
  {
    version: '2026年08月29日-版本5',
    signature: 'ad11097549',
    notes: [
      '性能优化：倒计时与候选库列表在手机端变单列时启用虚拟滚动，超长列表只渲染可视区域；长列表关闭批量入场动画。',
      '手机端开启壁纸模糊时自动改用低清柔焦变体，去掉整屏实时 CSS 模糊，滚动更流畅、省电。',
      '首页的近期提醒、本周概况、近期账单等次要面板交给浏览器延迟渲染，减少首屏绘制。',
      '健壮性：新增全局错误兜底，组件报错或异步异常时提示本地数据未丢失，可继续使用或重新加载。',
      '工程：新增 release:bump 脚本自动计算源码签名并生成版本说明，构建校验与发布说明共用同一签名逻辑。',
      '工程：清理项目根目录未使用的 OCR 语言模型文件，更新 README 补充云同步、OCR、迁移与 CI 说明。',
    ],
  },
  {
    version: '2026年08月29日-版本4',
    signature: 'bfdfe969c6',
    notes: [
      '手机课程表升级：手机默认打开单日视图，可在一周内切换日期；保留整周视图，课程详情继续使用原有编辑流程，课程数据结构不变。',
      '手机导航优化：增加独立“课程”一级入口，移除“更多”中的重复课程入口，保持首页、课程、待办、更多的精简层级。',
      '首页与操作反馈优化：近期提醒、本周概况和账单降为次要信息；手机端不再自动弹出更新说明；待办和清单删除后提供 6 秒撤销。',
      '数据管理移动端优化：增加备份、同步、迁移、恢复分区导航；同步操作在窄屏下改为单列，备份、云同步和二维码逻辑保持不变。',
      '课程表结构优化：将周视图、单日视图和课程冲突计算提取为独立网格组件，保留原课程编辑、导入和作息设置流程。',
      '性能结构优化：集中管理 OCR Worker 的状态与生命周期，并将 OCR、二维码和扫码依赖拆分为独立加载块，不影响普通页面首屏。',
      '课程编辑优化：课程编辑弹窗改为独立组件，使用本地草稿和事件提交，避免编辑过程中直接修改正式课程数据。',
      '课程管理优化：批量管理与学期模板弹窗改为独立组件，课程选择、复制、清空和模板操作通过事件交给页面协调。',
      '批量录入与冲突处理优化：批量录入弹窗和课程导入冲突弹窗改为独立组件，文本与图片识别进度、预览和冲突处理通过事件交给页面协调。',
      '特殊日期与学期设置优化：节假日/补课弹窗和学期设置弹窗改为独立组件，本地草稿与表单校验交给组件，页面只负责打开关闭与数据写入。',
      '作息时间设置优化：作息方案编辑、校区/作息季/节次管理、时间表导入与识别确认整体抽为独立组件，课程表页面只负责打开与关闭。',
    ],
  },
  {
    version: '2026年08月29日-版本3',
    signature: '940f909ccd',
    notes: [
      '首页与“今天”合并：打开网站、点击 Logo、侧边栏“首页”均直接进入今日 Dashboard，旧的功能入口式首页移除；/today 自动跳转到新首页，不再存在两个首页。',
      '新首页结构：紧凑问候区、“接下来”模块置顶（下一节课 / 今天课程结束后 / 近一周无课三种状态自适应）、今日待办（可直接勾选完成，标题显示完成进度）、今天课程、近期提醒、本周概况与近期账单依次排列。',
      '空状态紧凑化：没有课程、待办或账单时只显示一行状态，不再出现大片空白卡片；近期账单无需关注时整个模块自动隐藏。',
      '手机端同步重构：单列自然排布且待办优先于课程，首屏直接呈现问候、日期与“接下来”；底部导航去除“首页/今天”重复入口，统一为一个首页入口，触控区域加大。',
      '数据与路由不变：首页所有信息直接读取课程表、待办、倒计时与账本现有数据，无新增存储；课程表、待办、倒计时、清单、账本、今天吃什么各页面功能保持原样。',
    ],
  },
  {
    version: '2026年08月29日-版本2',
    signature: 'b5f7d96af9',
    notes: [
      '学习生活台升级：新增“今天”行动页，将当天课程、待办、通用倒计时、固定账单和周回顾集中呈现；每一项均可直达对应功能。首页改为本周完成度与当天行动信息，移除等级、经验值等游戏化文案。',
      '课程联动升级：待办与学习类倒计时可关联稳定课程 ID；课程详情展示关联待办、关联学习倒计时与复习进度。删除课程时保留事项并解除关联，保留课程名称；历史待办和通知导入只在课程名称唯一匹配时自动关联。',
      '待办与倒计时升级：待办支持预计时长、每周重复；通用倒计时不会展示课程或复习字段，学习类才显示。待办、倒计时、固定账单、课程、清单和餐饮候选删除统一改用站内确认框；固定账单深链接可直接打开账单页签。',
      '手机端重新设计：不再压缩桌面侧栏；改为固定底部五入口（首页、今天、居中的快速记账、待办、更多），课程表、生活功能与设置收入“更多”抽屉，页面内容全宽展示并为底部安全区预留空间。快速记账不跳转页面，直接在当前页底部展开。',
      '首页与今天重新分工：首页改为功能入口，不再重复展示当天课程、待办和账单；问候、日期、校区、作息、本周完成度与今日待办全部集中到“今天”。个性化设置改为“主题与课表 / 本地壁纸 / 今天页文字 / 滑动操作”，并支持单独设置“今天”页壁纸。',
      '工程质量：拆出课程关联、待办重复、路由页签等低耦合逻辑，新增迁移、关联边界、重复任务和深链接回归测试。',
    ],
  },
  {
    version: '2026年08月29日-版本1',
    signature: 'd85c8e2814',
    notes: [
      '修复数据持久化安全隐患：localStorage 写入失败时未处理的 Promise 拒绝改为静默捕获；页面关闭前增加 beforeunload 兜底刷写，防止 requestIdleCallback 在移动端切后台时丢失数据。',
      '修复壁纸层视口判断：移动端横竖屏切换后模糊上限不再使用过期值，matchMedia 监听器在组件卸载时正确清理。',
      '修复本地安全副本恢复：IndexedDB 连接被阻塞或超时后自动重置，下次访问可重新尝试打开，不再永久失效。',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '1115d267e9'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
