# 测试与验证报告

> 2026-10-10 最终本地验收。冻结源码0da1052396；Node26覆盖率与Node22完整check各307文件2771例、0失败0跳过；正式dist613检查、SQL与未签名Windows包校验通过。历史失败、环境/夹具限制、生产未部署和未测平台保留如下。

## 1. 环境、数据与证据边界

实际项目根目录为 `D:/study-life/study-life`，Windows/PowerShell。常规验证使用现有Node；CI兼容性另外使用官方便携Node **v22.23.3**，已核对官方下载SHA，位于仓库外runtime/node22。Vitest4.1.11、Vue3.5.43及Wrangler4.149.0的版本由当前锁文件确定。

所有新增fixture均为虚构。I/O竞争通过受控Promise、实际store事件/领域对象、真实Vue挂载、转译后的Edge入口及单独TZ进程复现。SQL使用新建PGlite0.5.8 / PostgreSQL18.3内存实例；没有连接真实数据库写入，也没有清空或恢复真实用户数据。

原始证据在 `D:/study-life/audit/engineering-audit-20261010`。不向仓库复制日志/JSON/截图、实际env、Token、备份或用户内容。项目中保留的回归测试及SQL都是合成数据。逐文件审查/最终SHA见 [PROJECT_FILE_COVERAGE.csv](PROJECT_FILE_COVERAGE.csv)；所有缺陷根因和修复见 [PROJECT_AUDIT.md](PROJECT_AUDIT.md)。

首次 `npm test` 因系统TEMP中Vite缓存重命名EPERM，267 suites在收集阶段失败、**0测试执行**。该结果是环境限制，不能算267个产品Bug。将TEMP/TMP设为可写工作区目录后正常执行，保留原失败日志。

## 2. 实际执行的命令

### 2.1 基础门禁与安装/审计

以下是已实际调用的项目脚本或CLI；单条成功不等于最终源快照全通过。命令的开始时间和原始结果见相邻证据。

| 实际命令 | 读取到的结果 | 原始证据/限制 |
| --- | --- | --- |
| `npm test` | 初始267 suites收集失败、0执行 | [baseline-test.log](../../audit/engineering-audit-20261010/baseline-test.log)、[baseline-vitest.json](../../audit/engineering-audit-20261010/baseline-vitest.json)；系统TEMP EPERM |
| `npm run lint` | exit0 | [final-lint.log](../../audit/engineering-audit-20261010/final-lint.log)；后续变化仍需对应复验 |
| `npm run typecheck` | exit0 | [final-typecheck.log](../../audit/engineering-audit-20261010/final-typecheck.log) |
| `npm run typecheck:ratchet`（Node22完整check内） | exit0；2914→2889 | [final-node22-check.log](../../audit/engineering-audit-20261010/final-node22-check.log)；基线未提高，仍有2889历史严格诊断 |
| `npm run audit:contrast` | exit0 | [final-contrast.log](../../audit/engineering-audit-20261010/final-contrast.log)；CSS审计不是完整WCAG认证 |
| `npm ci --ignore-scripts`（隔离clean目录） | 753包、exit0 | [lock-clean-install.log](../../audit/engineering-audit-20261010/lock-clean-install.log)；确实跳过postinstall，未代表native/下载链可用 |
| `npm audit --prefix desktop-app --audit-level=high --json` | exit0、0漏洞 | [backend-review.json](../../audit/engineering-audit-20261010/backend-review.json)的实际命令/结果；独立桌面依赖范围 |
| `git diff --check -- src/components src/views src/composables/collaborationContext.js tests/engineeringFrontend*.test.js` | exit0 | [frontend-review.json](../../audit/engineering-audit-20261010/frontend-review.json)；LF/CRLF提示未隐藏 |
| `node --check src/composables/collaborationContext.js` | exit0 | 前端新增共享上下文语法检查 |

根依赖全量及运行依赖审计结果为总15项（6high/9moderate）→8moderate/0high，运行依赖0；原始 [dependency-audit-final.json](../../audit/engineering-audit-20261010/dependency-audit-final.json)、[dependency-audit-production.json](../../audit/engineering-audit-20261010/dependency-audit-production.json)保留。最终14:53重新实际调用如下，3条均exit0；隔离ci实际目录D:/study-life/audit/engineering-audit-20261010/lock-check，日志明确753包/12s，跳过postinstall。

```powershell
npm audit --audit-level=high --json
npm audit --omit=dev --audit-level=high --json
npm audit --prefix desktop-app --audit-level=high --json
```

### 2.2 数据与业务状态回归

实际PowerShell环境准备：

```powershell
$env:TEMP = 'D:\study-life\audit\engineering-audit-20261010\temp'
$env:TMP = $env:TEMP
```

实际完整命令：

```powershell
npx vitest run tests/engineeringDataActionCenter.test.js tests/engineeringDataAnnualMilestones.test.js tests/engineeringDataCalendar.test.js tests/engineeringDataImportCancellation.test.js tests/engineeringDataImportConcurrency.test.js tests/engineeringDataImportValidation.test.js tests/engineeringDataPersistence.test.js tests/engineeringDataProjectQueue.test.js tests/engineeringDataProjectWorkbench.test.js tests/engineeringDataRetirement.test.js tests/engineeringDataRetrospectiveFx.test.js tests/engineeringDataVaultRace.test.js tests/engineeringDataWallpaperCommit.test.js tests/engineeringDataPasteLifetime.test.js --configLoader native
```

13:56:48开始，14文件、64例通过、0跳过、exit0。逐项红绿、时间、源码SHA与调用链说明在 [data-review.json](../../audit/engineering-audit-20261010/data-review.json)。随后小幅组织TimeSettingsModal调用点，实际再执行：

```powershell
npx vitest run tests/engineeringDataPasteLifetime.test.js tests/ratchetHardcoding.test.js --configLoader native
```

14:00:17，2文件26例通过；TimeSettingsModal保持800行预算，没有放宽guard。18个自有composable、授权SFC及14新测试的完整scoped ESLint命令也在data-review.validationCommands，exit0。之后源码被冻结，最终全库依赖主审计稳定快照。

### 2.3 前端回归

末次完整前端定向命令：

```powershell
$env:TEMP = (Resolve-Path -LiteralPath '.vitest-tmp/frontend').Path
$env:TMP = $env:TEMP
npx vitest run tests/ariaHiddenFocusable.test.js tests/contrastAudit.test.js tests/engineeringFrontendCalendarLifecycle.test.js tests/engineeringFrontendCropLayout.test.js tests/engineeringFrontendFinanceForms.test.js tests/engineeringFrontendInteractions.test.js tests/engineeringFrontendProjectsLifecycle.test.js tests/engineeringFrontendSocialLifecycle.test.js tests/engineeringFrontendSwipe.test.js tests/engineeringFrontendWallpaper.test.js tests/focusObscured.test.js tests/formControlNames.test.js tests/formValidationA11y.test.js tests/highContrastPalette.test.js tests/imageCropKeyboard.test.js tests/keyboardReachability.test.js tests/landmarksAndRoles.test.js tests/mobileViewport.test.js tests/projectsFormErrorBinding.test.js tests/projectsTaskVirtualization.test.js tests/projectTaskWorkbench.test.js tests/ratchetHardcoding.test.js tests/reducedMotionScroll.test.js tests/swipeActionItem.test.js tests/tableSemantics.test.js tests/tabPanelSemantics.test.js tests/templateBindingIntegrity.test.js tests/togetherAvailabilityStaleResponse.test.js tests/touchTargetHooks.test.js --reporter=default --reporter=json --outputFile=D:/study-life/audit/engineering-audit-20261010/frontend-final-vitest.json
```

14:11:15，29文件291例全部通过、exit0。新增8文件44例，包含原有回归和后续独立发现的busy/ABA/原生刷新/并发有效结果。见 [frontend-final-vitest.json](../../audit/engineering-audit-20261010/frontend-final-vitest.json)及 [frontend-review.json](../../audit/engineering-audit-20261010/frontend-review.json)。

该轮不是全项目最终测试；并行Projects成果CAS/输入/任务并发代码后续仍变化。所有110前端文件（104Vue+6CSS）编译/解析通过是另一项静态验证，不等于110个文件全部运行分支覆盖。

### 2.4 服务、Edge与桌面回归

环境TEMP/TMP为仓库外backend-temp，实际命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/engineeringBackendRegression.test.js tests/engineeringBackendEdge.test.js tests/projectAvailability.test.js tests/projectsService.test.js tests/desktopUpdaterController.test.js tests/accountSyncTransport.test.js tests/socialWritePolicyGuard.test.js tests/desktopSignature.test.js tests/desktopAppUpdate.test.js tests/desktopUpdaterConfig.test.js tests/desktopCachePaths.test.js tests/projectTaskWorkbench.test.js
```

12文件51例通过、exit0，其中新增2文件20例。实际Edge index.ts在测试中转译执行；Supabase HTTP/session边界用合成响应控制。不是远端JWT/真实Storage测试。scoped ESLint、两份工作流js-yaml解析、差异空白检查均exit0，完整命令见 [backend-review.json](../../audit/engineering-audit-20261010/backend-review.json)。

实际本地Functions构建：

```powershell
node node_modules/wrangler/bin/wrangler.js pages functions build functions --env-file D:/study-life/audit/engineering-audit-20261010/runtime/wrangler-empty.env --outdir D:/study-life/audit/engineering-audit-20261010/pages-functions --output-config-path D:/study-life/audit/engineering-audit-20261010/pages-functions-config.json --output-routes-path D:/study-life/audit/engineering-audit-20261010/pages-routes.json
```

Wrangler4.149.0编译成功，使用空env及隔离本地状态，没有部署。保留代理环境提示，不复制真实配置。

### 2.5 SQL真实执行

实际本地基线/修复命令：

```powershell
node D:/study-life/audit/engineering-audit-20261010/runtime/backend-sql-check.mjs --baseline
node D:/study-life/audit/engineering-audit-20261010/runtime/backend-sql-check.mjs
```

基线11条旧迁移应用成功，已有account suite和3权限场景通过，3完整性场景红；新增审计迁移后12迁移/10组绿。最新根验证已经含并行expectedRevision第13迁移，**13条迁移全部应用、3份永久SQL套件+8附加场景=11组通过**，见 [backend-sql-final.log](../../audit/engineering-audit-20261010/backend-sql-final.log)。

永久套件为 [account_sync.sql](../supabase/tests/account_sync.sql)、[collaboration_integrity.sql](../supabase/tests/collaboration_integrity.sql)、[qixing_submit_revision.sql](../supabase/tests/qixing_submit_revision.sql)。11组覆盖account RLS/CAS、协作完整性、草稿revision/幂等提交、成员/外人/owner删权限、客户端不可伪造RPC、Storage路径角色、依赖、跨项目会议、跨社交/项目会议冲突与单成果规则。

“concurrent draft revision”是SQL语义套件名；该PGlite实例只有一个连接，不能把它写成真实多进程同时事务、PG17托管版本、PostgREST/JWT、Storage HTTP或线上RLS验证。新迁移未应用生产。

### 2.6 主审计最近追加定向验证

| 验证 | 真实红 | 绿 | 证据/命令状态 |
| --- | --- | --- | --- |
| Release环境覆盖 | 2行为红 | 覆盖/default绿 | [engineeringConfig.test.js](../tests/engineeringConfig.test.js)、root-regressions-green.log |
| 审计空屏/恢复判断 | blank等5行为回归 | 5例绿 | [engineeringAuditHarness.test.js](../tests/engineeringAuditHarness.test.js)；真实浏览器空白负例两工具均RED/exit1 |
| calc字号下界 | contrast-calc-red.log实际4红 | 4例绿、audit:contrast通过 | 同一harness；早摘要“3红”已以实际日志纠正 |
| 启动文字对比度 | 3条实际HTML红 | 3绿；关联2文件59例绿 | startup-contrast-red/green.log |
| App备份提醒localStorage | 实际1失败、2通过 | 5文件38例绿（14:23:27） | [shell-storage-red.json](../../audit/engineering-audit-20261010/shell-storage-red.json)、[shell-storage-green.json](../../audit/engineering-audit-20261010/shell-storage-green.json)；完整CLI见2.7 |
| dayLabel夏令时昨天 | 4独立TZ进程中2红2绿 | 2文件10例绿，新增4例 | [formatter-dates-red.json](../../audit/engineering-audit-20261010/formatter-dates-red.json)、[formatter-dates-green.json](../../audit/engineering-audit-20261010/formatter-dates-green.json)；完整CLI见2.7；未匹配filter见7 |
| Projects源码守卫辅助 | 全库最后1失败是brace函数体截取错 | TypeScript AST提取后5文件37例绿（14:19:48） | [project-form-ast-green.log](../../audit/engineering-audit-20261010/project-form-ast-green.log)；保留全部原业务断言，未删测试 |

### 2.7 主审计确认的完整执行CLI

以下由主审计从真实调用记录提供。均在 `D:/study-life/study-life` 执行，Vitest预先设：

```powershell
$env:TEMP = 'D:\study-life\audit\engineering-audit-20261010\vitest-temp'
$env:TMP = $env:TEMP
```

Node22全库（stdout/stderr保存到final-node22-tests.log）：

```powershell
& 'D:\study-life\audit\engineering-audit-20261010\runtime\node22\node-v22.23.3-win-x64\node.exe' node_modules/vitest/vitest.mjs run --reporter=default --reporter=json --outputFile.json=D:/study-life/audit/engineering-audit-20261010/final-node22-vitest.json
```

覆盖率全库（stdout/stderr保存到final-tests.log）：

```powershell
npm run test:coverage -- --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory=D:/study-life/audit/engineering-audit-20261010/coverage-final --reporter=default --reporter=json --outputFile.json=D:/study-life/audit/engineering-audit-20261010/final-vitest.json
```

App追加回归：

```powershell
node node_modules/vitest/vitest.mjs run tests/engineeringShellStorage.test.js tests/shellAlertQueue.test.js tests/appShellAnnouncements.test.js tests/backupRestore.test.js tests/keyboardReachability.test.js --reporter=default --reporter=json --outputFile.json=D:/study-life/audit/engineering-audit-20261010/shell-storage-green.json
```

Formatter追加回归（实际仅前2个filter匹配，2文件10例）：

```powershell
node node_modules/vitest/vitest.mjs run tests/engineeringFormatterDates.test.js tests/formatters.test.js tests/relativeTime.test.js tests/ledgerCurrency.test.js tests/ledgerPanels.test.js --reporter=default --reporter=json --outputFile.json=D:/study-life/audit/engineering-audit-20261010/formatter-dates-green.json
```

真实浏览器全模式（没有flows-only）：

```powershell
node scripts/audit/interaction-browser.mjs http://127.0.0.1:5177 D:/study-life/audit/engineering-audit-20261010/browser-interactions-final.json
```

SQL最新命令就是2.5的backend-sql-check.mjs。最后稳定coverage及Node22完整check均完成，以下记录真实最终CLI：

```powershell
$env:TEMP = 'D:\study-life\audit\engineering-audit-20261010\vitest-temp'
$env:TMP = $env:TEMP
$env:VITE_SUPABASE_URL = 'https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fictional-audit-only'
$env:PATH = 'D:\study-life\audit\engineering-audit-20261010\runtime\node22\node-v22.23.3-win-x64;' + $env:PATH
& 'D:\study-life\audit\engineering-audit-20261010\runtime\node22\node-v22.23.3-win-x64\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run check
```

Formatter另实际重验8文件83例：

```powershell
node node_modules/vitest/vitest.mjs run tests/engineeringFormatterDates.test.js tests/formatters.test.js tests/timeContext.test.js tests/ledgerFx.test.js tests/ledgerMoneyCorrectness.test.js tests/ledgerFeaturesDom.test.js tests/ledgerSplitDisplay.test.js tests/ledgerWorkflowCorrectness.test.js
```

[8文件83例日志](../../audit/engineering-audit-20261010/formatter-ledger-green.log)。

## 3. 全库执行记录和未通过项

以下不同快照都保留，不相互覆盖为“最终通过”。Vitest JSON的numTotalTestSuites可含describe层级，下表文件数以实际执行文件/日志为准。

| 执行快照 | 文件/测试结果 | 判定 |
| --- | --- | --- |
| 初始系统TEMP | 267 suites失败、0测试执行 | 环境EPERM，不是产品红 |
| 工作区TEMP后早期coverage | 290文件2662例，2654通过8失败 | 6项FX测试正在红绿修复中被主轮采入；2项FE组件行数预算。保留中间失败，后续定向闭环 |
| 首次最终候选coverage | 297文件2723例，2709通过14失败 | 13项页面就绪断言过早；1项TimeSettings801>800。调整确定就绪条件，去重复空行；保持断言/预算 |
| FE就绪修正后 | 29文件287例绿，随后FE013新增后29文件291例绿 | 定向结果，不能替代全库 |
| Node22官方运行 | 299文件2740例全部通过 | 期间8个并行源码文件改变，需最终差异复验；不标稳定最终 |
| 后一次coverage（14:18:02） | 300文件2742例，2741通过1失败 | projectsFormErrorBinding.functionBody用花括号截取误读解构参数；实际clearAll存在 |
| AST辅助修正后 | 5文件37例绿 | 修正测试解析器，原断言保留；后续稳定全库2771例通过 |
| Node26最终稳定coverage（14:41:05） | 307文件2771例全通过，0跳过，53.58s | final-vitest.json/coverage-final；源码与测试无漂移 |
| Node22最终完整check（测试14:43:03） | 307文件2771例全通过，0跳过，116.97s | 最后Web build1.24s及全部check子门禁exit0；final-node22-check.log |

原始证据：[full-coverage-vitest.json](../../audit/engineering-audit-20261010/full-coverage-vitest.json)、[297文件中间失败](../../audit/engineering-audit-20261010/intermediate-coverage-297-files.json)、[300文件中间失败](../../audit/engineering-audit-20261010/intermediate-coverage-300-files.json)、[早期Node22结果](../../audit/engineering-audit-20261010/final-node22-vitest.json)、[早期Node22日志](../../audit/engineering-audit-20261010/final-node22-tests.log)、[最终稳定覆盖率测试](../../audit/engineering-audit-20261010/final-vitest.json)、[AST修正关联绿](../../audit/engineering-audit-20261010/project-form-ast-green.log)。带final的文件名并不自动代表稳定最终快照，以上明确给出当次内容和漂移边界。

Node22及coverage真实CLI/临时目录见2.7。最终声明与实际签名0da1052396；验证前后仅另一聊天的齐行验收md改变，源码/测试/config无漂移。原14:18的300文件唯一失败已复制intermediate-coverage-300-files.json/log，final-vitest.json现在绑定14:41稳定绿，历史299/2740的final-node22-vitest.json名称仍只代表当次中间快照。

### 3.1 独立发现最终闭环

IR010/011由并行拥有者修复、相同8例真实DOM先6绿2红→8/8绿，最终2771例也通过。62 source+40 test完整补读、最终135+11+8+1绿；701文件before=after。[独立最终报告](../../audit/engineering-audit-20261010/independent-review.json)ready=Yes仅本地复核范围；所有11项IR resolved，所复核open P0/P1/P2为0。原目标-t运行15项非目标skip保留说明，主全库0skip。

CSP最终5/5CLI、4文档Chrome红→绿；另一聊天14:35全库4fail发生于TDD修复前。根最终14:41已冻结完整绿，见[pages-csp-review.json](../../audit/engineering-audit-20261010/pages-csp-review.json)。

## 4. 新增回归测试清单

审计累计新增 **29个engineering测试文件、154例**：DATA14文件64、BE2文件20、FE9文件49、root2文件14、App存储1文件3、formatter1文件4。是新增文件中的当前例数，不是将每次重复执行累加；已有契约和并行功能新增测试另计。永久SQL套件不算Vitest例数。

### 4.1 数据回归（14文件64例）

| 新测试文件 | 例数 | 实际验证 |
| --- | ---: | --- |
| [engineeringDataActionCenter.test.js](../tests/engineeringDataActionCenter.test.js) | 2 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataAnnualMilestones.test.js](../tests/engineeringDataAnnualMilestones.test.js) | 2 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataCalendar.test.js](../tests/engineeringDataCalendar.test.js) | 10 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataImportCancellation.test.js](../tests/engineeringDataImportCancellation.test.js) | 4 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataImportConcurrency.test.js](../tests/engineeringDataImportConcurrency.test.js) | 9 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataImportValidation.test.js](../tests/engineeringDataImportValidation.test.js) | 10 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataPersistence.test.js](../tests/engineeringDataPersistence.test.js) | 6 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataProjectQueue.test.js](../tests/engineeringDataProjectQueue.test.js) | 2 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataProjectWorkbench.test.js](../tests/engineeringDataProjectWorkbench.test.js) | 4 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataRetirement.test.js](../tests/engineeringDataRetirement.test.js) | 1 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataRetrospectiveFx.test.js](../tests/engineeringDataRetrospectiveFx.test.js) | 6 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataVaultRace.test.js](../tests/engineeringDataVaultRace.test.js) | 2 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataWallpaperCommit.test.js](../tests/engineeringDataWallpaperCommit.test.js) | 3 | 实际公开composable调用链；存储/HTTP/File await按场景可控 |
| [engineeringDataPasteLifetime.test.js](../tests/engineeringDataPasteLifetime.test.js) | 3 | 真实挂载TimeSettingsModal，编译后调用runParsePaste，真实解析与recognition；可控取消/换号 |

### 4.2 前端回归（9文件49例）

| 新测试文件 | 例数 | 实际验证 |
| --- | ---: | --- |
| [engineeringFrontendCalendarLifecycle.test.js](../tests/engineeringFrontendCalendarLifecycle.test.js) | 4 | 加载/订阅/卸载与账号生命周期 |
| [engineeringFrontendCropLayout.test.js](../tests/engineeringFrontendCropLayout.test.js) | 1 | 裁剪布局约束；真实几何另在浏览器证据 |
| [engineeringFrontendFinanceForms.test.js](../tests/engineeringFrontendFinanceForms.test.js) | 2 | 保存null/异常留草稿和反馈 |
| [engineeringFrontendInteractions.test.js](../tests/engineeringFrontendInteractions.test.js) | 4 | 多实例ID及5000项虚拟列表访问 |
| [engineeringFrontendProjectsLifecycle.test.js](../tests/engineeringFrontendProjectsLifecycle.test.js) | 19 | 账号/项目/ABA/busy/leave/并发业务结果 |
| [engineeringFrontendSocialLifecycle.test.js](../tests/engineeringFrontendSocialLifecycle.test.js) | 6 | 账号隔离与原生刷新Event |
| [engineeringFrontendSwipe.test.js](../tests/engineeringFrontendSwipe.test.js) | 4 | 左右滑、收起及另一方向Tab |
| [engineeringFrontendWallpaper.test.js](../tests/engineeringFrontendWallpaper.test.js) | 4 | 资源加载失败、世代与旧Blob释放 |
| [engineeringFrontendPagesCsp.test.js](../tests/engineeringFrontendPagesCsp.test.js) | 5 | 实际CLI拒绝未批准root/public classic/module脚本和style-src错批，批准当前2HTML |

### 4.3 后端与主审计（6文件41例）

| 新测试文件 | 例数 | 实际验证 |
| --- | ---: | --- |
| [engineeringBackendRegression.test.js](../tests/engineeringBackendRegression.test.js) | 12 | 服务token、课程/日期、桌面更新与调用边界 |
| [engineeringBackendEdge.test.js](../tests/engineeringBackendEdge.test.js) | 8 | 转译真实Edge请求、忙时/查询截断/流上限 |
| [engineeringConfig.test.js](../tests/engineeringConfig.test.js) | 2 | VITE_APP_RELEASE显式覆盖与默认 |
| [engineeringAuditHarness.test.js](../tests/engineeringAuditHarness.test.js) | 12 | boot5、calc4、startup真实HTML3 |
| [engineeringShellStorage.test.js](../tests/engineeringShellStorage.test.js) | 3 | SecurityError留入口、Quota异常可关闭、7天去重 |
| [engineeringFormatterDates.test.js](../tests/engineeringFormatterDates.test.js) | 4 | NY春/秋、Berlin春、Shanghai跨年独立TZ进程；验证真实offset |

## 5. 浏览器、OCR、移动端与性能

### 5.1 真实浏览器交互

[原项目浏览器脚本最终一次](../../audit/engineering-audit-20261010/browser-interactions-final.json) **141cases全部通过、66次路由viewport（11×6）、0失败0异常**。合成fixture7宽实际为320/375/390/430/844/768/1280；路由6宽为320/390/430/844/768/1280。覆盖ActionButton进行中/去重、圆形占位、焦点/键盘、AX、错误重试、真实本地新增/编辑/确认删除/取消/撤销与CSV链路，实际执行结果见 [日志](../../audit/engineering-audit-20261010/browser-interactions-final.log)。

这个开发服务结果另补了正式产物613断言/297组合：11路由×9视口×empty/500虚构任务/dark，0异常/网络失败，全部指定常见宽度及横屏。实际DOM新增含特殊字符任务并刷新恢复、重要日期保存、SW控制、11路由断网访问、离线新增并刷新通过。12张390px生产截图逐张人工核对。列表/账本没有假称500数据；物理Safari、软键盘、安全区、系统权限和读屏软件尚未运行。

```powershell
node D:/study-life/audit/engineering-audit-20261010/engineering-browser.mjs final D:/study-life/study-life/dist
node D:/study-life/audit/engineering-audit-20261010/engineering-browser.mjs final-lab D:/study-life/study-life/dist --lab-only
```

[正式矩阵](../../audit/engineering-audit-20261010/browser-final.json)、[安静重测性能](../../audit/engineering-audit-20261010/browser-final-lab.json)。browser-final的首次三样本与目录打包短暂同时运行，性能比较采用其它验收完成后的final-lab。测试harness只加lab-only开关，产品源码未改。

### 5.2 真实OCR与循环初始化

[browser-real-ocr.json](../../audit/engineering-audit-20261010/browser-real-ocr.json)实际本地Tesseract WASM和中英文模型完成合成图识别，输出“TEST COURSE 12345”，confidence92，strategy original，PASS。不是mock OCR成功；也不是用户实际课表照片准确率、各种旋转/字体鲁棒性或性能基准。

4静态循环只发现静态依赖环，无已确认初始化错误；5个真实入口顺序执行文本解析→recognition→计划→导入→localStorage→undo通过，见DATA回归与审计。没有为了删图环重构。

### 5.3 同条件性能与裁剪几何

Chromium154，390×844，CPU4x、网络延迟100ms、下载200000bytes/s、绕过SW，每组3冷样本：

| 样本 | baseline LCP ms | candidate LCP ms | baseline CLS | candidate CLS |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 5220 | 5344 | 0.155611 | 0 |
| 2 | 4324 | 4460 | 0.155611 | 0 |
| 3 | 4296 | 4424 | 0.155611 | 0 |

证据为 [browser-baseline.json](../../audit/engineering-audit-20261010/browser-baseline.json)、[browser-candidate.json](../../audit/engineering-audit-20261010/browser-candidate.json)。仅支持所测候选CLS归0；**LCP中位数4324→4460，慢136ms，未改善**。样本不是最终actualdist，不推断统计显著性、INP、API速度、gzip体积或内存改善。

真实crop在320/390/1440三宽的stage/image已对齐；390前stage350.84px而image64.10px，修复后共约64.098px。见 [crop-before.json](../../audit/engineering-audit-20261010/crop-before.json)、[crop-after.json](../../audit/engineering-audit-20261010/crop-after.json)。验证几何，不声称导出像素逐像素和物理Safari验证。


最终安静actualdist三样本LCP5020/4376/4388ms、CLS0/0/0、ready4507/3971/3977ms、长任务数2/0/0、transfer707485/690913/690913bytes。基线LCP中位数4324→最终4388，慢64ms；ready3905→3971，慢66ms；本地静态服务未启用HTTP压缩，不能把transfer称gzip或生产首访。未测INP、TBT、Speed Index、堆泄漏或生产API延迟。

## 6. 构建、部署及覆盖率

| 项目 | 最终结果 | 证据及边界 |
| --- | --- | --- |
| Node22完整npm run check | exit0 | README/Pages/lint/typecheck/ratchet/test/build全执行，strict2914→2889，未改基线；[log](../../audit/engineering-audit-20261010/final-node22-check.log) |
| Web build | 1.24s、PWA165项2139.67KiB、exit0 | version2、0da1052396，虚构公开Supabase配置；真实生产项目配置/远程CI不据此通过 |
| desktop renderer | 1.35s、exit0 | [log](../../audit/engineering-audit-20261010/final-desktop-build.log) |
| Windows dir target | 构建exit0，原包校验exit1缺app-update.yml | electron-builder26.17源码只为NSIS等支持更新target写feed，不能手工补配置制造通过；[目录日志](../../audit/engineering-audit-20261010/desktop-package-local-runtime.log) |
| Windows NSIS unsigned | 构建exit0，原包校验exit0 | [build](../../audit/engineering-audit-20261010/desktop-package-nsis.log)、[verify](../../audit/engineering-audit-20261010/final-desktop-nsis-verify.log)；124671680bytes，版本1.0.15/electron-updater6.8.10/真实GitHub更新源配置；未签名/安装/执行更新 |
| Pages Functions | Wrangler4.149本地build exit0 | [log](../../audit/engineering-audit-20261010/final-pages-functions.log)，空env；无云发布 |
| Supabase公开配置/产物 | 两门禁exit0 | [config](../../audit/engineering-audit-20261010/final-supabase-config.log)、[bundle](../../audit/engineering-audit-20261010/final-supabase-bundle.log)，只用虚构公开URL/key |
| 资源闭包/预缓存 | GREEN/exit0 | 14入口引用、113JS、161closure、165precache/检查资产，0缺失；[JSON](../../audit/engineering-audit-20261010/release-integrity-final.json) |
| 普通启动/API缺失启动 | 两项GREEN/exit0 | 390×844、8s，各1次导航0错误，[first](../../audit/engineering-audit-20261010/first-visit-final.json)、[API模拟](../../audit/engineering-audit-20261010/iphone-boot-final.json)；不是实体Safari |
| 空白#app负例 | 两项预期RED/exit1 | 无其它异常却确实未挂载，守卫正确拒绝；[first](../../audit/engineering-audit-20261010/first-visit-blank-negative.json)、[API模拟](../../audit/engineering-audit-20261010/iphone-blank-negative.json) |
| Today分包404恢复 | GREEN/exit0 | 副本观测22s只有2次加载，可见重试/本机数据保留、无永久骨架；[JSON](../../audit/engineering-audit-20261010/reload-loop-final.json) |
| SQL本地迁移 | 13迁移/11组PASS | 3套件+8场景、单连接PG18.3，独立14场景另通过；没有生产PG17多连接证明 |
| Supabase/Cloudflare/Actions生产 | 未执行 | 新SQL/Edge/CSP仍未部署，旧线上成功不是本轮发布 |

真实最终产物与boot命令：

```powershell
npm run build:desktop
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
Remove-Item -Path Env:CSC_LINK,Env:WIN_CSC_LINK,Env:CSC_KEY_PASSWORD,Env:WIN_CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
$env:ELECTRON_CACHE = 'D:\study-life\audit\engineering-audit-20261010\runtime\electron-cache'
$env:ELECTRON_BUILDER_CACHE = 'D:\study-life\audit\engineering-audit-20261010\runtime\electron-builder-cache'
node node_modules/electron-builder/cli.js --config electron-builder.yml --dir --win --x64 --publish never --config.electronDist=D:/study-life/study-life/node_modules/electron/dist --config.directories.output=D:/study-life/audit/engineering-audit-20261010/desktop-package
node node_modules/electron-builder/cli.js --config electron-builder.yml --win nsis --x64 --publish never --config.electronDist=D:/study-life/study-life/node_modules/electron/dist --config.directories.output=D:/study-life/audit/engineering-audit-20261010/desktop-package-nsis
node scripts/verify-desktop-package.mjs D:/study-life/audit/engineering-audit-20261010/desktop-package-nsis/win-unpacked
node scripts/audit/release-integrity.mjs http://127.0.0.1:63157
node scripts/audit/first-visit.mjs http://127.0.0.1:63157 8 390,844
node scripts/audit/iphone-boot.mjs http://127.0.0.1:63157 8
node scripts/audit/first-visit.mjs http://127.0.0.1:63157/blank-audit.html 2 390,844
node scripts/audit/iphone-boot.mjs http://127.0.0.1:63157/blank-audit.html 2
node scripts/audit/reload-loop.mjs dist
```

TEMP/TMP采用2.7中native工作区路径；打包没有调用私钥，--publish never，输出全部在仓库外。NSIS首次host临时文件失败改为明确可写TEMP后绿，第一次目录构建遇代理EACCES改为已安装Electron分发复用后绿。原始失败保留，未算产品缺陷。官方[更新说明](https://www.electron.build/v26/docs/features/auto-update/)与本地26.17 PublishManager源码支持target边界。未签名安装包SHA256为1479c90eb20095395bc99bfa4e00ef68c35375cac36e3de931a459826a1b6d4d。

### 6.1 实际覆盖率分母

V8报告336个实际参与文件：src316、scripts10、desktop-app2、Supabase1、release1及helpers6。没有自定义include/exclude，也没有阈值放松；未加载文件不进入这个分母，所以百分比不能冒充330 src或全部761盘点文件的覆盖率。完整文件审查方法另见CSV。

| 指标 | 命中/分母 | 百分比 |
| --- | ---: | ---: |
| 行 | 20204/25840 | 78.18% |
| 语句 | 24428/33259 | 73.44% |
| 函数 | 5411/7924 | 68.28% |
| 分支 | 21398/32121 | 66.61% |

[coverage-summary.json](../../audit/engineering-audit-20261010/coverage-final/coverage-summary.json)、[V8逐文件原始结果](../../audit/engineering-audit-20261010/coverage-final/coverage-final.json)。1份转译Edge index.ts主要在可执行handler回归中验证，不能从availability.js的百分比推导其覆盖率。branchTrue0/0只是工具空分母字段，不作为100%成功展示。

## 7. 跳过、夹具失败与无法验证项

- 第一次Node22完整check主动在ratchet阶段中断，避免与覆盖率全库共用临时夹具；interrupted-node22-check.log不是成功结果。coverage结束后顺序重跑的final-node22-check.log才是最终完整exit0。
- 在另一聊天尚用其构建配置生成dist时，根虚构配置bundle verifier正确拒绝不匹配；随后根Node22正式虚构配置build与原verifier绿，supabase-bundle-before-final-build.log保留，未改校验。

- `-t`隔离RED重现中其它测试暂跳过是筛选行为；最终所属定向组为0跳过。初始TEMP0执行、解析夹具0执行不能写成“测试通过”。
- backend Edge首次setup夹具、真实OCR前一次fixture、FE的源码parse/标签计数匹配和两次App storage mock/Proxy恢复失败均记录为fixture-error；只把夹具纠正后实际业务症状作为红证据。App真实红为1失败2通过。
- 一次旧前端命令带了不存在的 `tests/togetherPrivacy.test.js`；没有执行该文件、不计入覆盖。现有privacy约束由实际列出的其它入口/源码审查覆盖，不假称该名字的suite通过。formatter实际命令带5个filter，`relativeTime.test.js`、`ledgerCurrency.test.js`、`ledgerPanels.test.js`三个未匹配，实际执行2文件10例，不能写5文件通过。
- Source-shape guard随代码组织发生误读时保留原业务断言，修正提取逻辑/允许明确当前结构。AST修正、keyboard方向条件、页面就绪等待没有删测试、放宽800行或提高strict baseline。
- 部分Node日志含experimental localStorage和合成环境IndexedDB unavailable提示；保留，不输出真实内容。提示不是凭空宣称产品环境没存储；具体storage边界由专门失败回归验证。
- 没有运行双真实账号注册/登录/同步竞争、真实SMTP验证/找回邮件、托管Storage上传下载/JWT/PG17多连接、真实多设备云并发或生产RLS写入。
- 没有物理iOS/Safari软键盘/系统权限/旋转与桌面签名安装、更新、重启和信任链；API守卫或Chromium视口只证明局部。
- 没有真实照片OCR准确率、大型Excel峰值内存、生产API时延/吞吐、长期INP或内存基准。
- Chrome DevTools MCP在当前工具环境不可用，没有执行Lighthouse/DevTools面板审计；本轮改用自有隔离Chrome及CDP脚本，性能字段直接来自浏览器PerformanceObserver，不编造未测指标。

## 8. 业务链路覆盖与回归风险

| 实际链路 | 已有验证 | 明确尚未覆盖 |
| --- | --- | --- |
| 今天→任务/专注/个人行动 | 源码/年度节点/Action Center/排序/旧工作台响应行为回归；真实路由交互 | 跨设备真实数据、高负载长期运行 |
| 课表→OCR/Excel/粘贴→审阅→导入→持久化→撤销 | 真实解析/5循环入口、迟到await/跨页/ABA/恢复/undo、合成WASM、crop几何 | 用户真实照片质量、大型Excel设备内存、物理触摸像素 |
| 作息→计划→保存→undo | 时间校验、同账号跨页快照/恢复竞争，保存await/失败回滚 | 任意后续编辑的选择性逆操作模型未设计；当前安全拒绝整快照覆盖 |
| 账本→个人实付FX→日/月/年回顾/导出 | 6 FX回归、年度日期、固定账单异常、夏令时真实TZ、CSV本地链 | 历史汇率特征未存在，当前FX估算说明保留 |
| 本地store→storage事件→镜像/备份→恢复 | 损坏事件/clear/delete、按键读异常、旧IDB任务、退役紧急归档、backup nudge | 真实配额/崩溃/多浏览器多设备、不读取真实用户存储 |
| 离线项目队列→API ack→本地桥接 | 新/更新item不会被旧ack删除、JWT绑定、账号/ABA/任务会话 | 真账号/真Storage/JWT；IR010/011已闭环；云端真实生命周期尚未实测 |
| 一起约→共同空闲→邀请→齐行会议 | session off/makeup、跨午夜/缓冲、已确认会议忙时、截断fail-closed | 托管API真实时延/双账号/SQL多连接 |
| 齐行权限→任务依赖→成果/会议→accept/status→个人todo | 客户端/真实Edge可控HTTP、SQL角色/依赖/共享冲突、并发响应/lease | 云迁移尚未应用；最新输入/同task相反重复已绿；线上约束仍未生效 |
| PWA安装/离线/更新、桌面更新 | 现有测试/配置、更新控制器真实延迟边界、本地Worker构建 | 稳定dist离线/SW已绿；physical安装/签名升级未验 |

最终本地验收已完成。SOURCE/TEST/config冻结复核一致，三报告和逐文件CSV在测试后写入；真实生产迁移/配置、托管业务、物理终端与签名安装/升级仍需相应环境和明确部署范围，已列具体边界。原始失败记录和0执行/定向skip均未改称最终通过。
