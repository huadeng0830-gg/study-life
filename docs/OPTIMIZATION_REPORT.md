# 工程优化报告

## 2026-10-11 性能与工程优化第 1 轮：课表加载边界

本轮读取 AUDIT、INVENTORY、STATUS、既有优化/测试报告，以及最近的 `full-tests-final.log` / `build-clean.log`；以当前工作区重新构建和测量。只处理下面 **2 项关联优化**，不扩展为全面审计，也不调整视觉。此前未提交改动保留。

| 本轮问题 | 实际修改与回归 |
| --- | --- |
| A16 子问题：关闭弹窗仍在课表首进时加载 | 8 个 `defineAsyncComponent` 原先无条件挂载，`:open=false` / `:show=false` 不阻止模块下载；QuickRecordPanel 还是静态导入。现在由 [scheduleDialogMounts](../src/composables/scheduleDialogMounts.js) 控制首次挂载，快速记录改为异步导入；首次加载后保留实例、关闭动画、重开与草稿语义。挂载回归实际捕获原 9 次组件导入，修改后为 0 |
| A02：课表工程门禁失败 | 将日期/周次导航、搜索、归档投影与周统计移至 [scheduleWorkspace](../src/composables/scheduleWorkspace.js)，[ScheduleView](../src/views/ScheduleView.vue) 1137 → 1056 行，原上限 **1057** 不变。模块仍使用原日期与课程选择器；跨周、返回今天、日期跳转、教师/教室搜索、归档与数据更新回归通过 |

独立审查发现并补修本轮懒加载引入的迟到弹窗竞态：下载期间离开 KeepAlive 页面，模块不得在其他页面激活 Modal/锁滚动；加载器等待课表重新激活后发布组件，卸载释放等待任务。真实 Modal + KeepAlive 的失败用例先红后绿；正式构建的实际分包延迟/离开/返回检查也通过。复核无剩余重要或严重问题，结论仅限本轮范围。

### 优化前后可测量依据

`scripts/audit/schedule-loading.mjs` 启动本机静态服务与独立临时 Chromium 档案，阻止外网请求；390×844、`saveData=true`、HTTP cache 禁用、SW bypass。从 `/#/schedule` 冷进入，课表工具栏就绪后等待 1800ms，再读取 PerformanceResourceTiming。只统计页面发起的 `/assets/*.js` 已解码字节，**不是 gzip 传输大小、SW 安装下载总量或用户速度指标**。双方各 3 个新档案样本，以下每组计数/字节均一致。

| 指标 | 优化前 | 最终构建 | 结论 |
| --- | ---: | ---: | --- |
| 页面加载 JS 数 | 93 | 80 | 减少 13 个请求资源 |
| 页面 JS decodedBodySize 合计 | 1,047,920 bytes | 855,153 bytes | 减少 192,767 bytes；不推算 LCP/INP 改善 |
| 8 个课表弹窗分包进入初始加载 | 8 | 0 | 只在用户打开相应入口后加载 |
| ScheduleView 单 JS 分包（Vite） | 80.64 kB / gzip 27.03 kB | 82.80 kB / gzip 27.90 kB | 本身增加；收益来自避免加载闭合弹窗依赖，不声称所有分包缩小 |
| PWA 全应用预缓存 | 203 项 / 2696.73 KiB | 204 项 / 2698.57 KiB | 增加 1.84 KiB，全部离线路由保留；不声称安装包/离线下载变小 |

原构建在 `before-web/`，最终为 `final-web/`，未覆盖已有 dist。中间 `after-web/` 的数字不用于最终结论。完整合成流程覆盖课程保存到 localStorage、编辑器重开初始化、管理列表、学期初值、作息初开、批量录入初开；最终额外验证迟到弹窗隔离与返回打开。该探针不测标准 LCP/CLS/INP、CPU/堆峰值、真实移动网络或首次弹窗打开延迟，不提供速度改善百分比。

### 本轮最终验证

证据目录：`D:/study-life/.tmp/performance-20261011/`，仅本机临时日志、独立构建、合成数据与浏览器档案，不纳入 Git。可重复 CLI：`node scripts/audit/schedule-loading.mjs <独立构建目录> <证据JSON路径> --lifetime`。

| 检查 | 实际结果 / 证据 |
| --- | --- |
| 关闭弹窗与原行数守卫红绿 | `regression-before.log`：2 失败、22 通过，无未处理错误；原 9 次导入/1137 行。`regression-after.log`：24/24 通过；后续最终回归继续覆盖 |
| 生命周期红绿 | `lifetime-red.log`：其他页面出现真实 dialog，1 失败/1 通过；`lifetime-green.log`：4 文件、28/28 通过 |
| 最终相关回归 | `related-final.log`：17 文件、118/118 通过，18.34 秒，maxWorkers=2 |
| 最终稳定全量 | `full-tests-final.log`：322 文件、2917/2917 通过，143.88 秒，maxWorkers=4；exit 0。之前 `full-tests.log` 横跨生命周期补修，不作为最终稳定证明 |
| 浏览器前后 | `browser-before.json`、`browser-before-{2,3}.json` 与 `browser-final-{1,2,3}.json`：6 次运行 exit 0，Runtime 错误均为空；最终第 1 样本包括 8 项流程/迟到分包检查，其他最终样本各 6 项 |
| lint / 常规类型 / 类型棘轮 | `lint-final.log`、`typecheck-final.log`、`type-ratchet-final.log`：exit 0；checkJs 2906 条、现有基线 2914 不变，不称零类型债 |
| 正式 Web build / 发布说明 / Pages 配置 | `build-final.log` exit 0；README/发布说明与 Pages 安全头检查通过。保留当前 Web 2026年10月11日-版本1、桌面 1.0.20，只补本轮说明与签名 `dc201cb39d` |
| 独立复核 / 差异检查 | 审查确认迟到弹窗问题关闭；本轮文件 `git diff --check` exit 0 |

本轮应用改动仅 ScheduleView + 两个新 composable；新增 3 个回归文件与 1 个本机测量脚本；更新本报告、STATUS、当前发布说明/README。没有改领域写入、存储/同步格式、数据库迁移、RLS/权限、密钥、依赖或生产环境，也未提交、部署、发布或打桌面安装包。

### 剩余问题与下一轮

- A16 仍开放：PWA 默认注册/安装的总请求成本、低端机/真实弱网、首次弹窗等待和其他路由闭合依赖尚未测量。保留完整离线功能，本轮不修改缓存策略。
- A13/A14 仍开放：2906 条类型债及其他超大组件；本轮只解决课表稳定工作区边界与 A02 门禁，不批量拆分或放宽预算。
- A15 真实云端权限/并发/双设备一致性，以及备份恢复的真实故障矩阵仍待验；不把本机测试视为线上安全或可靠性验收。

> 以下为历史冻结快照（2026-10-10 首轮优化报告）：源码签名0da1052396、2771测试及当时构建仅对应首轮验收；之后的历史增量保留在文末。本轮结论以上述 2026-10-11 记录为准。生产配置/迁移未部署。

## 1. 已完成优化与文件

根因、红绿和严重级别见[PROJECT_AUDIT.md](PROJECT_AUDIT.md)，所有761路径/方法/归属/哈希见[PROJECT_FILE_COVERAGE.csv](PROJECT_FILE_COVERAGE.csv)，完整CLI及失败历史见[TEST_REPORT.md](TEST_REPORT.md)。

| 改进 | 涉及文件 | 实际收益 | 兼容性及边界 |
| --- | --- | --- | --- |
| Today布局稳定 | TodayView、HomeProductivityPanel | 面板随已经懒加载的Today路由加载，最终3冷样本CLS均0 | LCP中位数慢64ms；没有首屏速度改善承诺 |
| 虚拟列表默认路径 | VirtualList | 5000虚构Proxy项访问5027→少于100，默认null不再误入全量扫描 | 保留高度函数和有限正高度，不将计数称耗时/内存 |
| 长图裁剪 | ImageCropModal | 320/390/1440 stage/image共坐标 | 几何有证据，导出像素逐像素/物理触摸未验 |
| 身份/滑动/键盘 | PromptDialog、ContextMenu、ActionSheet、SwipeActionItem | useId消除多实例ID碰撞；右滑恢复，隐藏对侧动作不入Tab | 原左滑、收起和键盘行为保留 |
| 资源生命周期 | WallpaperLayer、wallpaperStorage、SocialCalendarEvents | 新世代撤销旧Blob；迟到订阅立即清理；IDB等事务commit才成功 | 不清空用户壁纸，不将资源释放证明夸大为内存峰值改善 |
| 存储与恢复 | store/core、dataVault、accountSyncMode、emergencyExport、App | 损坏外部事件不丢待保存编辑，删除不复活，旧镜像不盖恢复；退役先完整紧急归档；backup nudge读异常仍保留入口 | SecurityError/Quota可控回归，真实配额/断电/多设备未验 |
| 导入/撤销/取消 | scheduleImportReview、scheduleOcrFlow/Import、recognitionSchemes、timeImportPlan、TimeSettingsModal | 冷加载、换号、ABA和外部恢复后旧结果停止发布；正常导入/撤销保留 | 后续新编辑存在时安全拒绝整快照undo，明确告知；没有假造选择性inverse模型 |
| 时间/年度/金额 | zonedTime、scheduleRecognition、timePlanDraft、nextUp、retrospective、formatters | 严格真实日期/时分、正确年度实例、个人实付FX、DST日历昨天 | 当前汇率估算/缺汇率说明保留；4真实TZ进程验证，不切换日期协议 |
| 会话/队列/并发 | services/social、projectTaskBridge、workbench、Projects/Together、collaborationContext | 使用检查过的JWT、只移除同版本ack、旧账号/项目/对话框响应隔离，独立任务有效结果仍处理 | shared busy lease仅负责自身清理，业务guard另行校验；捕获上下文不取消已在A下合法发出的服务端操作 |
| 齐行后续保护（并行作者） | Projects、useProjectTaskActions、useProjectDeliverableEditor、useProjectMeetings及components/projects | 后输入B不被A保存清除，逐任务Set拒绝相反重复、保留异任务并发；上传期间不采用远端；profile未读时不桥接 | 属于并行聊天实施，本审计真实红复现/绿复核，不冒领新功能；任意非法IANA并非已验证兜底 |
| 服务器忙时/边界 | campus-social availability、index.ts | 取消/补课/跨午夜/确认会议一致，超32KiB提前cancel，exact count检测截断并unknown | 本地真实handler+合成HTTP验证，托管PostgREST/API耗时未测 |
| SQL约束 | 20261010050926_collaboration_integrity_guards.sql及并行61000迁移 | 同一服务写边界维护任务依赖、项目锁/共享日历和成果revision/幂等 | 13本地迁移11组绿；单连接PG18.3，生产PG17尚未应用，不改写旧真实行 |
| 返回页CSP | public/_headers、verify-pages-config | 精确hash允许callback，2HTML/classic/module全门禁；实际4文档提示和query/hash清理恢复 | 无unsafe-inline/eval；callback未重写，真实SMTP/Token与生产部署未验 |
| 启动/审计可靠性 | index.html、boot-verdict、first-visit、iphone-boot、audit-contrast | 启动3小字约2.35/4.47→4.804；空屏实际RED，unknown字号下界不降AA门槛 | 原页面/恢复/错误反馈保留，不视为整站WCAG认证 |
| 桌面/依赖门禁 | updaterController、CI、package/lock | Promise在途控制避免重复check，根/桌面高危audit真正失败门禁；兼容补丁升级 | 未改签名安全配置，未强制降级builder；未运行真实安装更新 |
| 文档与类型债 | README、archive README、DESIGN_TOKENS、main/style注释、三报告/CSV | 更新真实链接/启动判据、CSS px/pt、idle能力/动效说明；strict2914→2889 | 基线未提高，仍有2889历史诊断；outline动效未被宣称必然合成层 |

## 2. 实测性能与取舍

使用Chrome154.0.8037.98、390×844、CPU4x、100ms延迟、下载200000bytes/s、上传100000bytes/s、cache禁用、SW绕过，每组3冷样本。baseline是初始dirty隔离快照；candidate是中途修复候选；final为正式签名dist，其性能在其它验收/打包结束后单独重测。测试静态服务器不做HTTP压缩，不能外推为线上gzip或真实设备指标。

| 样本 | 初始LCP ms | 中途候选LCP ms | 最终LCP ms | 初始CLS | 最终CLS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5220 | 5344 | 5020 | 0.155611 | 0 |
| 2 | 4324 | 4460 | 4376 | 0.155611 | 0 |
| 3 | 4296 | 4424 | 4388 | 0.155611 | 0 |
| 中位数 | 4324 | 4460 | 4388 | 0.155611 | 0 |

CLS实测消除；LCP中位数最终慢64ms（约1.48%），ready中位数3905→3971ms，不能写成加载更快。3个样本不足以判统计显著性，继续保留速度取舍。最终长任务数2/0/0，初始2/1/1；不能把这几次计数当长期INP改善。最终transfer707485/690913/690913bytes，初始704990/688418/688418，资源稍增，没有首屏体积减少结论。

[初始](../../audit/engineering-audit-20261010/browser-baseline.json)、[中途候选](../../audit/engineering-audit-20261010/browser-candidate.json)、[正式安静样本](../../audit/engineering-audit-20261010/browser-final-lab.json)。正式browser-final矩阵自带首次样本与目录打包曾短暂并行，性能结论采用单独final-lab。

### 2.1 构建体积

| 产物 | 初始JS kB / gzip kB | 最终JS kB / gzip kB | 说明 |
| --- | ---: | ---: | --- |
| TasksView | 107.60 / 35.90 | 108.26 / 36.05 | 同时保留用户阶段/改期工作，无体积缩减承诺 |
| vue-vendor | 107.93 / 41.48 | 109.25 / 41.96 | 兼容安全补丁3.5.43 |
| LedgerView | 157.73 / 51.15 | 157.90 / 51.20 | 修复正确性，微增 |
| supabase-vendor | 222.29 / 57.12 | 222.29 / 57.12 | 保持 |
| xlsx | 494.96 / 161.29 | 494.96 / 161.29 | 保持按需加载，不删导入功能 |
| PWA precache | 167项 / 2107.46KiB | 165项 / 2139.67KiB | 少2项但增加32.21KiB，不能据条数声称体积减少 |

最终Web build1.24s，desktop renderer1.35s；单次构建时长不作为稳定加速百分比。输出数字来自Vite实际日志，KB与KiB单位不混用。

### 2.2 裁剪及长列表

200×1600虚构图：390视口原stage350.84px、image64.10px；320/1440原stage282.24/843.78px。改为居中fit-content并max-width后，三宽stage/image约64.098px，百分比选择框共坐标，0异常。[前](../../audit/engineering-audit-20261010/crop-before.json)、[后](../../audit/engineering-audit-20261010/crop-after.json)。5000项虚拟列表Proxy访问5027→少于100是结构性证据，不是帧率/内存基准。

未测标准INP、TBT、Speed Index、生产API延迟/吞吐、长期堆泄漏/真实大Excel峰值，不提供推测提升。

## 3. UI、手机端与PWA

330份src中的106SFC、8CSS全部纳入相应源审/AST/CSS和关键声明审查。FE领域110文件之外，App与并行DraftRecovery补读；源码方法与所有运行分支区分记录。

正式dist613断言/297组合全通过，覆盖11路由×9视口×empty/500虚构任务/dark；宽度320/375/390/430/768/1024/1440/1920及844×390横屏。0横溢出失败、0重复id、0未捕获异常/失败网络；不能说检查了所有可能遮挡/布局状态。12张390px生产截图人工核对；列表/账本在populated仍无业务记录。

原项目真实交互脚本141项/66组合，涉及进行中/去重、焦点键盘/AX、错误重试、取消、CRUD/撤销/CSV。正式产物另验特殊字符任务新增/刷新、重要日期持久化、SW控制、11路由断网可达、离线新增后刷新恢复。两种boot正例1导航，空白负例都RED，分包404副本仅2次受控加载并可重试。

对比度144组合、42焦点组合门禁通过，保留800行及键盘/类型预算。没有品牌重设计或隐藏错误。物理Safari、软键盘、安全区域、读屏软件、系统权限、真实安装/跨版本更新尚未实测，不能据Chromium视口宣称WCAG认证或真机通过。

## 4. 架构、数据和兼容性

最小owner/generation/对象或指纹/逐键version用于已复现的写入边界。collaborationContext用窄capture/invalidate/run/state接口隐藏身份世代、私有状态reset、channel与busy清理；有效业务结果和busy lease分开。其FE010/012/013属于审计强化期间引入后由独立复核发现的回归，已修并保留红绿，不统计成原始缺陷。

四个静态循环保留，顶层读取检查及5真实入口文本→草稿→计划→导入→localStorage→undo通过。当前160个≥80行函数是AST启发式，含测试回调，既有useQuickRecordPanel713行等为维护债，不以任意拆分替代业务修复。

正常无并发导入/撤销、原schema和RPC外部签名保留；后续新编辑出现时拒绝整快照undo并反馈。退役饮食键先紧急归档，镜像恢复使旧任务失效。真实用户env/记录/备份未读出或删除；测试/日志/截图/SQL只用虚构内容并留仓库外。

本地13迁移及3永久SQL套件+8场景11组、独立14场景绿。新增协作完整性和并行成果revision迁移未应用生产；云PG17.11/11旧迁移/旧Edge不会因本地绿自动获得约束。没有改写历史行或在无真实负载证据下删索引。

## 5. 依赖与工程验证

| 项目 | 初始 | 最终本地结果 | 剩余边界 |
| --- | --- | --- | --- |
| 总npm audit | 15项，6high/9moderate | 8moderate，0high/critical；high gate exit0 | 同源sprintf-js工具链漏洞无修补版本，未强制builder降级 |
| 运行/desktop audit | 分开审查 | 都0漏洞 | 审计数据库报告不是绝对安全证明 |
| Vue / Wrangler | 3.5.41 / ^4.144 | 固定3.5.43 / 4.149 | 兼容补丁，不批量跨主版本升级 |
| 锁文件安装 | 工作区不能代替clean | 外部lock-check npm ci --ignore-scripts753包/12s绿 | 明确未验postinstall下载；实际本地builder/浏览器链已执行 |
| Node26 coverage | 初始TEMP收集失败0执行 | 307/2771全绿、0skip；行78.18%、分支66.61% | 分母336实际文件；不等于全仓或每分支100% |
| Node22 CI版本 | 官方SHA便携22.23.3 | 完整npm run check+2771例+build全绿 | 远程GitHub Actions未运行 |
| strict棘轮 | 2914 | 2889（减少25），门禁绿 | 基线未提高，2889历史诊断尚存 |
| 产物/启动 | 原发布签名陈旧拒构建 | 0da1052396、Web/desktop/未签名NSIS及包/boot验证绿 | 不签名、不安装、不上传、不生产部署 |
| 独立复核 | 中间回归曾ready=No | 11IR resolved、135+11+8+1绿，701文件无漂移 | 只批准所复核本地scope |

[最终npm结果](../../audit/engineering-audit-20261010/dependency-audit-final.json)。8项moderate沿electron-builder/@electron/get/global-agent/roarr→sprintf-js传播，底层无fixAvailable；不能用高危门禁exit0掩盖8项未关闭。CI已移除audit的无条件成功fallback并分别审计根/desktop。

## 6. 未完成优化与下一步边界

| 项目 | 原因/风险 | 当前处理 |
| --- | --- | --- |
| 生产SQL/Edge/CSP与双账号链 | 生产写入超出本次安全本地范围；真实SMTP/Storage/PostgREST/JWT、多设备和多连接事务未验 | 迁移与代码已准备并本地验证，尚未部署；先在等价PG17/服务环境验收 |
| 8moderate工具链 | 上游sprintf-js没有兼容修补，npm建议builder变更会降级 | 记录确切传递链，保留现版本；不audit fix --force |
| 密码泄露保护 | 只读advisor提示disabled，线上配置未授权更改 | 明确配置风险与后续账户设置验收 |
| Preview旧SYNC/DO绑定 | 配置漂移且涉及真实环境 | 记录，未删变量/绑定或用户数据 |
| 30unused index | 缺真实负载/长期统计和迁移成本 | 不凭INFO删索引 |
| strict/长函数/4循环 | 常规类型绿不等于全仓strict零错误；维护性收益需业务边界支持 | 2889诊断与160启发式大函数、延迟读取规则记录，不推倒架构 |
| 物理终端/签名更新 | 无实体Safari/软键盘/系统权限/已安装签名版本 | Chromium/单元guard与未签名NSIS只证明局部，不判实际安装更新/信任链 |
| OCR质量/巨量数据 | 合成WASM成功不等于真实照片/大型Excel准确率和峰值内存 | 真实本地OCRconfidence92、285.1ms单例记录，不当质量或时延基准 |
| INP/API/长期内存 | 无等价现场负载与标准测量链 | 保留明确未测项，无假数字 |

截至交付没有未关闭的已复现本地P0/P1/P2修复回归；这个结论限定本次检查与独立复核范围。其余风险与环境缺口如上，生产保持原状态。

## 2026-10-10 后续优化

以下是首轮报告之后的增量记录，不重述或改写前文性能样本。当前设计规范见[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)，页面和全局能力覆盖见[COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。

### UI系统与交互

- 在 Vue 3 工程中接入 shadcn-vue 的组件组织方式与 Reka UI 原语，新增 `components.json`、`src/styles/shadcn.css` 和 `src/components/ui/**`，通过 `src/style.css` 的语义变量桥接现有主题。保留 Vue Router、既有领域状态和已工作的页面交互，不套用 React 代码。
- 对任务筛选/排序和批量改期状态做修复，并提取任务工作区选择、路由深链聚焦、首页行动列表、外观滑动设置等聚焦模块，降低超长页面组件继续增长的压力。
- 表单/导入和异步状态补上可访问名称、错误说明、忙碌反馈；表格标题、对话框与键盘交互继续由自动化守卫覆盖。

### 领域逻辑与交付

- 修正重要日期无效年月日及闰月边界换算，避免跨年/无效日直接落入错误日期；重要日期换算的历史性历法边界只作为代码用例，不等同于系统日历/提醒真机验证。
- 发布元数据已由项目脚本更新到版本5/桌面1.0.18，源码签名为 `a703bfc017`。本地Web和桌面构建成功，且元数据专项6文件33项测试通过。
- 验收抽查了1440、768、390像素宽度下的选定页面，浏览器控制台无错误；课表在390像素视口可横向浏览整周。全量自动化为310文件2814项通过，细节见[TEST_REPORT.md](TEST_REPORT.md#2026-10-10-后续复验)。

### 性能结论和保留限制

此后续轮没有进行可比的LCP/CLS/INP重测，也没有运行标准现场负载。前文数字只代表首轮注明的设备模拟、构建产物和采样条件，不能解释为本轮性能提升。云服务、生产迁移、真实照片OCR、大数据设备内存、实体Safari/读屏和签名安装升级仍属于待验证范围。
