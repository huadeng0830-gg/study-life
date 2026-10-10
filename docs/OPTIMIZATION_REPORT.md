# 工程优化报告

> 2026-10-10 最终本地交付。稳定源码0da1052396，三种产物构建与2771测试已验；生产配置/迁移未部署。本报告区分正确性改善、算法收益、实际性能与未关闭风险。

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
