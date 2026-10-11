# 最终独立质量验收报告

验收日期：2026-10-11（Asia/Shanghai）。对象：`D:/study-life/study-life` 的最终 P1 修复与生产发布提交。**本轮结论：两个 P1 已完成代码级修复，组合门禁、默认回归集、Web/桌面前端构建均通过，Cloudflare Pages 生产部署成功。** 全站完整交互、真实云账号/RLS、独立设备和 Electron 安装包仍未验收；这些边界不因部署或构建通过而视为已验证。

逐项状态见 [COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。旧报告的“通过”只适用于各自写明的范围。测试使用隔离档案和合成业务记录；没有对生产业务数据执行恢复或写入。

本机原始日志、截图和独立审查材料保留在工作区 `.tmp`，按隐私规则不纳入 Git；下方 `.tmp` 链接仅在本机可用。公开仓库可通过报告列出的命令和测试源码复现当前验证。

## 0H. P1 修复后的最终组合门禁（2026-10-11）

这是 P1 修复后最新、可复现的结果，覆盖并替代下方 0G 时点记录中的旧计数、旧类型棘轮结论和“组合门禁尚未执行”结论。

| 命令 / 结果 | 实际结果 | 证据边界 |
| --- | --- | --- |
| `npm run check` | **exit 0**：发布说明签名、Pages 配置、Lint、常规类型检查、类型棘轮、全量测试、Web 构建全部通过 | 全量测试 328 文件、2940/2940；Web 构建 3224 模块、PWA 204 项预缓存（2717.51 KiB）。测试使用 `maxWorkers=2`，未减少用例或断言 |
| `npm run typecheck:ratchet`（组合门禁内） | exit 0；2914 条基线降至 2903 条 | 未修改或抬高基线；本轮只修正 Bundler 已支持的相对导入扩展名以恢复类型诊断 |
| P1 原始探针（默认全量集） | **328 文件、2940/2940 中包含 3 个 `.repro.test.js` 文件** | 新探针被默认 Vitest 文件模式收集，不需单独配置才能进入常规 CI 测试集 |
| P1 原始探针独立复跑 | `npx vitest run --maxWorkers=1 scripts/audit/final-acceptance/{restore-owner-race,persistence-recovery,stale-sync-start}.repro.test.js`，**3 文件、8/8，exit 0** | 数据值、owner、持久化状态和错误状态均有断言；使用合成账号/数据 |
| 补充 P1 回归 | 5 文件、19/19 通过 | 覆盖原探针、保存失败页面切换后错误仍显示、旧 IDB 镜像延迟返回不覆盖最新版本等 |
| `npm run build:desktop` | exit 0 | Electron 模式前端产物成功；未制作/启动/签名验证 Electron 安装包 |
| `npm run supabase:verify-config -- production`、`npm run supabase:verify-bundle -- dist production`、`npm run pages:verify-config` | 全部 exit 0；bundle 扫描 154 个 JS 资源 | 公开配置与产物密钥边界检查；不代表真实登录、RLS 或线上写入端到端验证 |
| 发布说明 | `check:release-readme` 通过；源码签名 `aee2384ace`，Web 版本 `2026年10月11日-版本1`，桌面版本 `1.0.20` | 没有递增应用版本或修改数据 schema |
| `npm run deploy:production` | **exit 0**；Cloudflare Pages production deployment `78696c41-c9e0-444e-aa02-eacb210bea92` success；上传 144 文件（69 个复用） | 对应干净 `main` 提交 `9fd61c2`。`study-life.pages.dev` 及该部署 URL 的 `/version.txt` 与首页 HTTP 200，版本号匹配 |
| 部署后 `node scripts/audit/release-integrity.mjs https://study-life.pages.dev` | **GREEN**：入口引用 16、SW 预缓存 204、扫描 JS 150、闭包资源 200、资源探测 204；缺失 0、失败 0 | 通过 `NODE_OPTIONS=--use-env-proxy` 使用当前代理，纯 GET/HEAD 资源检查 |
| `node scripts/audit/first-visit.mjs https://study-life.pages.dev 16` | **GREEN**：390×844、导航 1 次、reload 0、console/exception/network errors 均 0，应用已挂载 | 临时 Chrome profile，未登录、不写生产业务数据 |
| `node scripts/audit/iphone-boot.mjs https://study-life.pages.dev 14` | **GREEN**：390×844，删除 `requestIdleCallback`、将时间固定为 20 点；应用挂载，无占位、错误页、异常或 console error | 模拟浏览器 API/视口，不等同于真机 Safari |

测试运行时出现 Node 对未配置 `--localstorage-file` 的实验性 localStorage 警告；Vitest 最终汇总为全通过，没有失败项。Windows 默认 Temp 曾在测试收集前触发文件 rename `EPERM`；将 `TEMP/TMP/TMPDIR` 指向工作区 `.tmp` 后，组合门禁与原始探针均实际运行并通过。另一次通过 `npm test -- --maxWorkers=1` 传入重复 worker 选项的命令在 Vitest 参数解析阶段退出、未执行测试；随后用 `npx vitest run --maxWorkers=1` 完成独立探针复跑。以上运行环境/命令错误均未计作产品测试通过。

## 0. P1 专项修复最新结论（2026-10-11）

这段及下文第 5、7 节覆盖此前报告中的 QA05/QA06 “未修复”结论。旧记录中的复现和保护方案仍是根因依据；最终修复状态以本节和覆盖矩阵为准。

| 问题 | 实际根因 | 修复与可复现结果 |
| --- | --- | --- |
| QA05 / P1-001 · 跨账号恢复覆盖 | 恢复 checkpoint 的异步等待期间没有统一的账号身份世代校验；共享 localStorage 键的账号归属切换没有与恢复、同步、退出共享事务锁。待写编辑也未绑定账号，旧页面可能在 B 归属下继续写 A 的状态。 | owner + 当前会话账号 + 单调 identity revision 捕获；恢复、账号切换、退出和同步使用同一账号数据锁；每个异步边界和恢复提交前校验身份/锁。旧账号延迟写入先进入按 owner 隔离的 IDB 草稿；切回原账号时只在账号快照基线相符后恢复，基线冲突保留草稿并拒绝切换。跨账号导入仍需独立确认，恢复前保留 checkpoint。原延迟恢复探针及账号隔离回归已通过。 |
| QA06 / P1-002 · 保存失败后导出旧数据且错误被清除 | 持久化失败后待写队列被清除；导出仅读磁盘快照；任意其他键保存成功会清除全局失败提示。 | 当前 refs 优先用于快照和应急导出；失败写入保留按键重试队列及 IDB 恢复草稿；状态按 key/source 记录，仅相应问题真正保存后清除；未保存修改拦截关闭/刷新并在导出中列出。导出若缺少/无法读取字段会标记不完整；导出异常明确报错。导入在 flush 未成功时拒绝显示成功。原失败探针与相关回归已通过。 |

验证仅用虚构账号和合成数据。没有连接真实 Supabase、没有多台真实设备，也没有对用户存储执行恢复。IndexedDB/浏览器配额、浏览器进程崩溃及真实双标签操作仍未验证；模拟 `StorageEvent` 不能替代真实跨浏览器标签运行。没有发现仍开放的代码级 P1，但这些外部边界和其他验收范围仍影响发布决定。

### P1 场景覆盖状态

| 场景 | 状态 | 可复现证据 / 边界 |
| --- | --- | --- |
| A→B 切换时 A 的延迟恢复返回；B 的实际内容和 owner 不变 | 已检查、已修复、已验证 | `restore-owner-race.repro.test.js`；断言最终 `sl_tasks` 内容为 B 的记录且 owner 为 B |
| A/B 各有本地记录、旧页面写入隔离、切回 A 恢复草稿、基线冲突保留草稿 | 已检查、已修复、已验证 | `accountLocalData.test.js`、`accountOwnerStorageFence.test.js`、`dataVaultRecoveryDraft.test.js`；IDB 为 fakeIndexedDB，StorageEvent 在同一测试环境模拟 |
| 备份来源账号与目标账号不一致；只有单独确认的迁移流程允许导入 | 已检查、已修复、已验证 | `restore-owner-race.repro.test.js`、`backupArchive.test.js`；断言拒绝时 B 内容不变，显式确认时目标 owner 为 B |
| checkpoint 写入失败、恢复中账号切换、自动回滚失败 | 已检查、已修复、已验证 | `restore-owner-race.repro.test.js`、`dataManagerWorkflow.test.js`；验证目标内容保持或旧副本保留，可恢复提示不丢失 |
| 多标签同时占用账号临界区、owner 变化时旧队列迟到 | 已检查、已修复、已验证（模拟） | `accountLocalData.test.js`、`accountOwnerStorageFence.test.js`；真实独立浏览器标签并发未验证 |
| 重新启动后仅恢复正确 owner 的未保存草稿 | 已检查、已修复、已验证（初始化模拟） | `dataVaultRecoveryDraft.test.js` 重新初始化 Vault，并核对 owner、草稿内容及冲突保留；实体浏览器重启/崩溃未验证 |
| 配额异常后立即导出、继续编辑、其他键保存成功、重试后真实落盘内容 | 已检查、已修复、已验证 | `persistence-recovery.repro.test.js`、`storagePersistence.test.js`；核对 JSON 内容、失败/成功状态、旧磁盘值与重试后的新值 |
| localStorage 读取失败、IndexedDB 不可用、导出创建异常 | 已检查、已修复、已验证（故障注入） | `persistence-recovery.repro.test.js`、`storagePersistence.test.js`；不完整导出明确标 missing key，下载异常抛错，不伪报成功 |
| 保存失败后关闭/刷新告警、恢复后草稿加载 | 已检查、已修复、已验证（状态/初始化模拟） | beforeunload 拦截、Vault 重新初始化和路由切换后错误仍显示均有测试；真实硬刷新后的完整 UI 流未验证 |
| 独立物理标签页/设备、真实 Supabase/RLS、真实配额满盘与进程崩溃 | 未验证 | 未连接真实云和用户数据；矩阵保留为发布前外部验收项 |
| 延迟异步保存响应乱序、页面切换后错误持续显示、不同设备冲突恢复 | 已检查、已修复、已验证（自动化）/未验证（实体端到端） | `dataVaultRecoveryDraft.test.js` 通过受控延迟验证旧镜像不能覆盖较新数据；`appShellAnnouncements.test.js` 验证路由切换后失败提示仍在。真实浏览器硬刷新/双设备冲突仍未验证 |

## 1. 输入、独立复查和证据范围

先读取 `docs/optimization/` 原有六份记录：AUDIT、DESIGN_PLAN、DESIGN_SYSTEM、INTERACTION_LEDGER、INVENTORY、STATUS，随后以当前代码重新扫描、执行原有测试、增加故障注入、构建并操作生产产物。原文件哈希、标题和链接检查在 [static-review.json](../../../.tmp/final-qa-20261011/static-review.json)。审查不是对历史结论的背书。

独立审查员按 requesting-code-review 技能复核异步启动、持久化、恢复及账号隔离，完整记录见 [INDEPENDENT_REVIEW.md](../../../.tmp/final-qa-20261011/review/INDEPENDENT_REVIEW.md)。该审查记录形成时 QA05/QA06 尚未修复；本报告第 0 节和第 5 节记录后续专项处理及当前状态。另按 shadcn、verification-before-completion、Supabase 技能核对设计及证据边界。

| 对照范围 | 当前结果 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| INVENTORY 业务登记 | 15 路由/隐藏场景 + 95 功能 + 10 API，120 个唯一 ID | TSK03 在移动增量表重复一次，按正式业务行归并；不遗漏二级功能说明 |
| 所有 Vue 模板 | 207 SFC 解析无错误；1463 控件/事件定义 | 与原 INTERACTION_LEDGER 按文件、标签、文案、handler 多重集合逐条相同，0 个缺失；不证明每个 handler 语义未变 |
| 静态入口 | 1457 控件定义静态可达；6 个旧封装定义未静态可达 | 保留旧 QuickCapture/QuickLedger 台账；不是有 1457 个入口全部实际点验 |
| 旧台账浮层与云接口 | 156 浮层调用点、4 HTML 浮层根、63 Edge 动作、23 表逐项列入新矩阵 | 文件/组件/动作存在确认；所有角色、弹窗实例及 SQL 运行分支没有完整验收 |
| 文档源码链接 | 原六份文档 1153 个本地目标存在，0 缺失 | 历史 `#L` 行号不视作当前精确定位，新矩阵重定位控件/浮层 |
| 发布源完整性 | 最终检查前后既有源文件哈希无变化 | 新增审计探针、验收文档晚于常规全量；探针单独执行、ESLint 再跑，结果在下表公开 |

没有发现可由本轮清单差分确认的功能入口删除。既有退役 `/notes` 重定向及 410 接口仍保留兼容。不能由定义相同推断全部逻辑无回归；两个新复现正说明现有通过测试存在覆盖缺口。

## 2. 初次专项测试结果（历史快照；最终续验及生产部署见 0H）

环境：Windows、Node 26.10.0、npm 11.19.1，仓库锁定依赖；浏览器 Chrome 154.0.8037.98。主要日志目录为 `D:/study-life/.tmp/final-qa-20261011`，不进入公开发布资源。最终独立命令结果见 [final/checks.json](../../../.tmp/final-qa-20261011/final/checks.json)。

| 命令 / 检查 | 实际最终结果 | 证据与限制 |
| --- | --- | --- |
| `npm run check:release-readme` | 最终续验 exit 0 | 初次快照签名 `81b93a6faa` 已被 0H 中最新签名 `aee2384ace` 替代；网页和桌面应用版本未递增 |
| `npm run pages:verify-config` | exit 0 | [日志](../../../.tmp/final-qa-20261011/final/pages.log)；本地配置检查，不是线上 Pages 请求 |
| `npm run supabase:verify-config` | exit 0 | [日志](../../../.tmp/final-qa-20261011/final/supabase-config.log)；配置范围 |
| `npm run lint` | exit 0；新增审计探针后再跑 exit 0 | [最终含探针日志](../../../.tmp/final-qa-20261011/lint-with-probes.log) |
| `npm run typecheck` | exit 0 | [日志](../../../.tmp/final-qa-20261011/final/typecheck.log)；常规配置不能证明 JS 无类型错误 |
| `npm run typecheck:ratchet` | 初次时点 exit 1；2918 条。最终续验 exit 0；2914→2903 | 没有使用 `--write` 或提高基线；15 处 `.ts` 相对导入恢复后，当前错误数低于既有基线 |
| `npm run audit:contrast` | exit 0；144 配色 AA、42 焦点配对 | [日志](../../../.tmp/final-qa-20261011/final/contrast.log)；静态令牌与规则审计，不是所有渲染内容/自定义壁纸对比度实测 |
| 初始全量 `npm test -- --maxWorkers=2` | 322 文件、2917/2917，exit 0 | [基线日志](../../../.tmp/final-qa-20261011/tests.log)；先确认原状，再修复 |
| 修复后的定向回归 | 8 文件、72/72，exit 0 | [日志](../../../.tmp/final-qa-20261011/fixes-green-final.log)；修复前首页重复与异步启动 4 断言失败，见 [红测](../../../.tmp/final-qa-20261011/fixes-red.log) |
| 初次全量 `npx vitest run --maxWorkers=2` | 325 文件、2930/2930，exit 0；最终 `npm run check` 为 **328 文件、2940/2940，exit 0** | 最新全量结果见 0H；合成用户/数据 |
| **QA05/QA06 原始安全探针** | 独立复跑 **3 文件、8/8，exit 0**；并纳入默认 328/2940 全量测试 | `npx vitest run --maxWorkers=1 scripts/audit/final-acceptance/{restore-owner-race,persistence-recovery,stale-sync-start}.repro.test.js`；断言实际数据和 owner |
| Web/桌面构建 | `npm run check` Web build exit 0；`npm run build:desktop` exit 0 | Web PWA 204 预缓存项、2717.51 KiB；桌面前端通过，未制作/启动/验证签名安装包 |
| Supabase / Pages 发布包检查 | 配置、Pages 配置和 `dist` bundle 检查均 exit 0；bundle 扫描 154 个 JS 资源 | 检查公开配置和产物密钥边界；不等于真实账号/RLS端到端验证 |
| 生产浏览器基础验收 | 66 页面场景、17/17 断言；0 全页横溢、0 runtime/console error | [结果](../../../.tmp/final-qa-20261011/browser-final.json) |
| 生产浏览器扩展验收 | 20 页面场景、30/30 断言；0 全页横溢、0 runtime/console error | [结果](../../../.tmp/final-qa-20261011/browser-extended.json)；其中 17 断言重复基础流程，共 47 次断言执行，**不是 47 条独立流程** |
| `node scripts/audit/reload-loop.mjs D:/study-life/.tmp/final-qa-20261011/final-browser-web` | exit 0、GREEN | [日志](../../../.tmp/final-qa-20261011/reload-loop.log)；复制产物后破坏首页 JS/CSS，22 秒观察、2 次文档加载、出现错误与重试入口，无无限刷新 |
| `git diff --check` | exit 0 | CRLF 提示是文件换行提示；不以此替代语义测试 |
| 最终文档与快照复核 | 120 ID/1463 控件/156 浮层/63 动作/23 表分母匹配，0 重复 ID、0 异常表格行、0 缺失本地链接 | [校验记录](../../../.tmp/final-qa-20261011/final-report-verification.json)；文档检查不替代功能运行验收 |

QA05/QA06 原始探针使用 `.repro.test.js`，现匹配默认 Vitest 收集；0H 的 `npm run check` 已验证全量收集，独立复跑命令如下：

```powershell
Set-Location D:/study-life/study-life
node node_modules/vitest/vitest.mjs run --config scripts/audit/final-acceptance/vitest.config.mjs
```

修复前的红测证据保留在 [安全探针日志](../../../.tmp/final-qa-20261011/safety-probes-final.log)；本轮修复后的绿测记录见上方测试表与最终日志。Windows 沙箱默认 Temp 的原子重命名曾在测试加载前返回 `EPERM`（0 tests），将 `TEMP/TMP/TMPDIR` 指向工作区 `.tmp` 后同一探针集通过；这不是产品失败，也未计为通过。

没有运行 `test:coverage`，不提供代码行/分支覆盖率。最终组合 `npm run check` 已在 0H 记录为 exit 0。未运行会安装依赖/调用线上端点的 desktop installer；真实账号/RLS、多设备和 iPhone 实机仍未验证。

测试工具调整：初次受限 Chrome 无法启动，不计为页面失败或通过；独立批准启动隔离 Chrome 后取得正式证据。浏览器保存断言改为等待实际 localStorage 防抖完成，避免把即时未落盘误判为产品缺陷。审查员复现初次遗漏仓库 Web Storage setup 的环境错误也不计产品缺陷，采用正式 setup 后稳定复现。文本动作 CSS 初次放入 style.css 触发行数守卫，最终移至设计系统样式文件并通过原守卫；没有放宽任何基线。

## 3. 页面、平台、主题和核心流程

11 主路由（今天、课表、课程总览、待办、重要日期、日程、清单、账本、周回顾、一起约、齐行）在 1440×900、390×844、320×844 × 浅/深主题完成空数据/游客基础页面复验。另五页（今天、待办、账本、课表、周回顾）在 440×956、956×440、320×500、1440×900 高对比度稀疏数据完成 20 场景。共 **86 页面场景**，截图及六组浅深/宽度联系表见 [截图目录](../../../.tmp/final-qa-20261011/screens-final) 和 [扩展截图](../../../.tmp/final-qa-20261011/screens-extended)。六组基础联系表已目视复查。

浏览器使用正式 Vite 产物、独立本地 origin、新用户档案，禁缓存/绕过 SW，拦截外部请求；仅预设主题/备份提醒/版本已读等测试偏好，业务记录全部经表单创建。CDP 驱动真实 DOM click/input/change，使用应用真实 store，等待 localStorage 写入并刷新确认。不是完整人工体验、移动 OS 或真实云 E2E。

| 页面 / 用户流程 | 实际验收范围 | 剩余范围 |
| --- | --- | --- |
| 今天 `/` | 六基础场景与四扩展场景；引导文本按钮样式、主题、页面壳 | 下一行动全来源/时间边界、学习计划、反馈、专注和回放完整流程 |
| 课表 `/schedule` | 六基础+四扩展；课程名称新建→存储→刷新；日历图标 | 编辑/删除/归档、导入/OCR/作息/调整全矩阵、真机权限 |
| 课程总览 `/course` | 六基础；新建课程关联后显示 | 单课任务/节点/历史/专注/反馈 |
| 待办 `/tasks` | 六基础+四扩展；空标题校验、新建/编辑/完成、实际存储/刷新；320×500 编辑页脚与 Escape | 所有字段、多阶段/重复/批量/删除撤销、软键盘和云端；筛选/URL 组件回归通过仅计其用例 |
| 重要日期 `/exams` | 六基础；名称+2026-12-31 新建→存储→刷新 | 编辑/删除/重复/提醒/置顶/归档/课程关系 |
| 日程 `/events` | 六基础；标题新建→存储→刷新 | 全天/时间/复制/冲突确认/导入导出/归档/删除/共享日历 |
| 清单 `/lists` | 六基础；新建清单→快速加项→存储→刷新→完成 | 模板/分组/批量/删除/恢复/分享 |
| 账本 `/bills` | 六基础+四扩展；12.34 支出新建→存储→刷新；账本/固定账单/回顾入口切换 | 固定账单、退款/分摊、金额边界、导入/导出/汇率/预算/分类完整流程 |
| 周回顾 `/review` | 六基础+四扩展；首个复盘字段自动保存→刷新；已有挂载用例 | 全三字段/跨周/统计边界/真实同步备份 |
| 一起约 `/together`、齐行 `/projects` | 各六游客基础场景 | 登录后所有真实请求、角色拒绝、实时状态、成果文件/冲突/双设备 |
| `/today`、`/notes`、未知路由 | 重定向和 404 文案正式浏览器通过 | 404 后全部返回快捷入口没有逐项点验 |
| 启动异常 | 首页资源损坏后错误兜底/重试可见、无无限重载 | SW 离线缓存、不同旧版本、Safari/PWA 冷启动及更新回滚 |

**11 页基础显示可接受；其中 8 页有本机业务子集运行证据，7 种创建/保存流程通过；没有任何页面据此获得全部二级功能及平台的完整验收。** 普通本机保存成功不能覆盖存储失败时 QA06 的安全性。

浅/深、空/游客态已实测；稀疏/成功/校验失败仅覆盖所列流程。loading/成功动画/重试/取消的共享组件由实际 Vue 挂载回归覆盖，所有消费入口的慢请求/失败未逐项操作。启动资源错误和两项数据故障另有注入证据。大量长数据、操作系统字号、真实软键盘、安全区、读屏、实体触摸拖拽均未完整验收。

## 4. 本阶段修复的 4 个真实问题

| ID | 问题与处理 | 验证 |
| --- | --- | --- |
| QA01 / A07 | 首页引导/备份文本动作缺公共样式；在 [shadcn.css](../../src/styles/shadcn.css) 增加语义化 text-button 样式、hover/disabled/触区，保留全局焦点机制 | 修复前浏览器默认边框；修复后 border none、触屏高 44px、14px 字号；全量守卫通过 |
| QA02 / A08 | 课表手绘日历 SVG 默认填充成黑块；[ScheduleView.vue](../../src/views/ScheduleView.vue) 明确 fill/stroke/cap/join | 修复前后真实 computed style；fill none、主题描边；浅深多宽目视复查；未改变日期逻辑 |
| QA03 / A19 局部 | [homeModules.js](../../src/composables/homeModules.js) 输入重复合法 ID 造成重复首页模块；保留首次顺序/显隐、过滤非法 ID、补齐新增模块，输入不变 | 新增 homeModules 红绿用例；独立只读复审通过；**其他默认配置多真源问题未一并关闭** |
| QA04 / R2 | [accountSyncEngine.js](../../src/composables/accountSyncEngine.js) 读取旧冲突后未复核账号世代；await 后先 assertCurrent，阻止旧启动写 UI/注册监听/轮询 | 新 [accountSyncStartRace.test.js](../../tests/accountSyncStartRace.test.js) 三场景（退出/切换/stop）通过；独立探针也通过，0 新 listener/poll/request |

工程门禁、功能入口、存储字段、同步协议及迁移未被删减。发布说明仅追加这四项修复并同步当前源签名，Web 日期版本与桌面 1.0.20 未递增；这不代表批准发布。未升级依赖、修改 RLS/数据库或执行高风险恢复重构。

## 5. 两项 P1 的修复、保护与回滚边界

### QA05：旧恢复跨账号覆盖新账号数据

根因复核：[dataManagerBackup.js](../../src/composables/dataManagerBackup.js) 原先在等待 checkpoint 后继续应用恢复数据，缺少跨异步身份世代和共享事务锁。旧探针受控延迟 checkpoint 后切换 A→B，之前会把 A 数据写进 B；修复后通过，B 的实际任务内容与 owner 保持不变。源码与测试见 [restore-owner-race.repro.test.js](../../scripts/audit/final-acceptance/restore-owner-race.repro.test.js)、[accountOwnerStorageFence.test.js](../../tests/accountOwnerStorageFence.test.js)、[accountLocalData.test.js](../../tests/accountLocalData.test.js)。

修复后，账号本机切换、恢复、同步和退出清理共用 `ACCOUNT_DATA_LOCK`；Web Locks 不可用时使用带租约续期/令牌校验的本机锁。账号身份快照包含当前认证 user、数据 owner 和身份 revision，以识别 A→B→A。每次 await 后及写入/恢复提交前复核身份和锁。owner storage 事件会隔离旧账号待写队列；不能安全写入 IDB 草稿时保留内存值、报错并阻止旧值写入新 owner。恢复 checkpoint 继续带账号归属，跨账号导入走独立确认动作。

修复前保护方案（本轮已按此落地）：使用专用合成账号与按 owner 独立副本，不以真实数据试修；采用单调 identity/owner revision 识别 A→B→A，token refresh 不视为身份切换；恢复、同步、账号切换、退出清理共用跨标签数据锁。捕获 owner/revision 和带归属 checkpoint，在异步等待后与最终提交前复核；身份变化立即停止，不在 B 上自动回滚 A checkpoint。现有数据格式保持兼容，checkpoint 保留来源数据。

数据保护继续采用先存储 checkpoint、应用失败回滚原键值；切换 A/B 两份快照以 owner 为主键；待恢复草稿单独按 owner/key 隔离，并在原账号快照基线吻合时才应用。基线变化时不自动合并，不删除草稿。没有执行任何真实数据回滚。代码回滚与数据恢复分离：若未来回退代码，先暂停同步，导出并按 owner 核对快照后再恢复；无归属 checkpoint 禁止自动覆盖。模拟验证覆盖跨账号延迟恢复、旧标签页写入隔离、返回 A 恢复和基线冲突拒绝。实体双标签/设备、浏览器/IDB 突然终止、锁降级的真实运行仍未验证。

### QA06：保存失败后救援导出遗漏内存数据，错误提示被无关成功清除

根因复核：[store/core.js](../../src/composables/store/core.js) 原先写入失败后丢弃队列；[backupArchive.js](../../src/composables/backupArchive.js) 主要从 localStorage 生成导出；全局成功状态被其他键的写入覆盖。受控 QuotaExceededError 探针复现“内存最新、磁盘旧、导出旧、其他键成功清除提示”。

修复机制：以注册 ref 的当前值创建完整快照；失败的主存储写入保留可重新序列化的队列，按 key/source/owner 跟踪状态，并写入 owner 专属 IndexedDB 恢复草稿。只在该键主存储确实成功后清除其对应失败。应急 JSON 明确带未保存 key、缺失/不可读 key，读取不完整时不会标“完整”；UI提示下载后确认文件可用。关闭/刷新前提示待保存内容。时间表导入在持久化冲突后撤销“成功”反馈。原 probe 与新测试覆盖保存失败立即导出、继续编辑、无关键成功、重试、存储不可用、导出异常、账号草稿隔离与 conflict。

失败保护：恢复前的磁盘/账号 checkpoint 不会被测试重置；失败保留原值、队列、提示和可用草稿；应急导出快照不触碰本机数据。主存储、IndexedDB 与下载同时失败时仍无法证明崩溃后可恢复，因此页面保留醒目错误并拦截刷新/关闭；该极端故障组合须在实体浏览器测试。重新回退此逻辑前先导出当前内容，并验证原始快照和失败队列归属。

本地可复现验收中两项 P1 均已修复并关闭代码级阻断；真实多设备、线上 Supabase、崩溃/配额边界仍标记未验证，整体发布条件未满足。

## 6. 设计统一、回归与安全边界

项目确为 Vue shadcn-vue/Reka UI、共享语义颜色/尺寸/焦点/浅深/高对比度已存在，20 个业务文件直接引用 UI 原语，contrast 守卫通过。但 17 个 Button/Card 调用仍同时用完整旧 class token `btn`/`card`（不是误把 `account-auth-card` 等业务类算进去）；ScheduleGrid 2、ScheduleView 8、ExamsView 1、WeeklyReviewView 6。原生 segmented/select 与原语并行，scoped CSS 可覆盖共享触区。当前 A06 **部分完成**，不是全局统一。

本机浏览器仍观察到手机账本标签约 28px、顶部链接约 26px、部分主按钮约 40–42px 等较小触区；320px 的账本分类标题排列也需要进一步优化。全页 overflow=0 只证明这些截图没有整页横向溢出，不能证明内部滚动、裁剪、触区、手势、焦点全部合格。未在最终验收中贸然整体替换各页组件或调低旧守卫。

此前可靠性、设计基础、待办/周回顾电脑布局、今天/待办移动布局、导航保存及反馈、课表按需加载/重构已存在；本轮常规全量重新验证其测试，基础截图及所列流程另有新证据。历史“8→0 首进弹窗”“字节降低”等性能数字没有在本轮重新测量，不能当作本轮新指标；LCP/INP、弱网、内存仍未验证。

源码静态确认：Edge 使用 getUser 校验 token/actor；dispatch 授权与 SQL 成员/角色/revision 限制、私有文件路径约束、桌面隔离及 sender 检查存在。**没有证明实际部署与源码一致，没有证明托管 RLS/Storage/Realtime 拒绝矩阵通过。** 本机没有可用 Docker/psql/Supabase CLI/Deno，SQL 脚本未执行；JS 合同/mock 测试不算数据库验收。RLS 与 grants 需分别核验并实际执行允许/拒绝测试，依据 [Supabase 官方 RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)；changelog.md 获取被浏览工具的 content-type 支持限制阻止，本轮未实施 Supabase 产品/迁移变更。

仍未验证：真实登录/邮箱/桌面回调、未验证邮箱/好友/陌生人/成员/负责人/验收者/退出成员权限矩阵、63 动作真实响应、23 表实际迁移/RLS、跨项目上传/撤权、JWT 失效、revision 冲突、双设备同步；实体 iOS/Android/PWA 离线更新、Electron IPC/安装/签名更新。没有确认线上漏洞，也没有给线上安全背书。

## 7. 最终验收决定与退出条件

本阶段修复并复测 **2 个真实 P1**；累积记录中的 QA01–QA04 仍为已修复，不把其他设计/测试缺口计入此修复数。两项原始安全探针和新增账号/保存回归须以最新执行结果为准。11 页通过基础显示、8 页有局部本机流程证据；**完整页面验收仍为 0 页**。完整测试、门禁结果和限制列于本报告第 2 节。

发布前仍需：将原始安全探针纳入持续 CI 门禁；处理当前类型棘轮报告的 4 条超基线差异；实测真实双标签/双设备与 Supabase 角色/RLS；完成约定平台的实体设备、离线更新和桌面安装验收；按 COVERAGE_MATRIX 逐项完成全站功能与未保存/冲突状态验收。只有确认这些项目并重跑全套门禁后再作发布决定。

本阶段交付完成，**没有已知代码级 P1 阻断；项目整体仍不具备发布条件**，原因及待验收范围已逐项标记。
