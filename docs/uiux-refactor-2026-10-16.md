# 三两事 UI/UX 重构与验收报告

日期：2026-10-16。项目：`D:\study-life\study-life`。本次改动保存在工作区；没有提交、推送或部署。浏览器验证使用隔离配置与虚构记录，没有读取或改写真实用户数据。

## 1. 本次修改了什么

以“安排今天、继续学习、快速记录”为主要场景，将原来分散的页面样式整理为可复用的界面系统。主要调整包括首页信息优先级、导航分组、共享页头、图标、表单渐进展开、触屏操作和异常反馈。课程、待办、日程、账本、校园、协作及备份能力继续使用已有业务入口与数据模型。

原来的主要问题与处理：

| 问题 | 处理后的行为 |
| --- | --- |
| 桌面导航六组分散，设置与业务入口混杂 | 三组业务导航；低频设置进入可展开工具区 |
| 首页模块视觉权重相近、空态重复、嵌套装饰较多 | 接下来 → 今日安排 / 重要事项 / 专注 → 回顾；学习建议按需展开 |
| 页面独立拼接标题与按钮 | 统一 PageHeader，保留原业务动作与面包屑 |
| 待办新增表单初看复杂 | 内容必填；日期可留空；关联、备注、阶段计划按需展开 |
| 图标混用表情与不同视觉重量 | 导航、空态、记录类型与常用入口统一 Lucide |
| 手机控件被旧规则压缩至 34–40px | 共享触屏尺寸契约与具体列表修正，实际粗指针环境复测 |
| 旧成功反馈遮挡新表单 | 表单打开时隐藏反馈，关闭后重新提供完整五秒撤销时间 |
| 未登录与网络失败显示方式混淆 | 权限使用中性提示；网络失败解释原因并提供恢复操作 |

## 2. 新的 Design System

完整规范见仓库根目录 `DESIGN.md`，实际令牌位于 `src/style.css`，主题配色位于 `src/composables/theme.js`。

| 基础 | 规范 |
| --- | --- |
| 颜色 | 背景 #f6f7fa、表面 #ffffff、内嵌表面 #eef1f6、正文 #202735、次要文字 #586174、行动蓝 #3d63d8；独立 success / warning / error / info 与 separator |
| 字体 | 设备中文 UI 字体与系统字体，不下载外部字体；数字使用 tabular-nums |
| 字号 | Display 36 / Large title 30 / Title 26 / Headline 18 / Body 15 / Callout 14 / Subheadline 13 / Footnote 12 / Caption 11 |
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 |
| 圆角 | small 4 / control 8 / surface 12 / overlay 16 / pill 999 |
| 空间层级 | elevation 0–3；列表和普通分区不依靠阴影制造边界 |
| 布局 | container、stack、cluster、content-grid、section-heading 与首页容器查询 |
| 动效 | 使用现有 90 / 150 / 220 / 320ms 令牌；页面只做短淡入淡出，空态不循环浮动 |
| 深色 | 保留独立的背景、提升表面、文字、强调色及高对比增量，复用同一语义接口 |

旧数字字号和现有主题接口保留兼容，新组件使用语义令牌。没有另行引入 UI 框架或运行时依赖。

## 3. 重构了哪些页面

| 页面 / 路由 | 本次调整 |
| --- | --- |
| 今天 `/` | 信息层级、接下来、桌面两列、手机单列、简洁空态、长内容、心情键盘模型、学习时段建议按需展开 |
| 课程表 `/schedule` | 统一页头与按钮、消除重复桌面二级导航、保留周切换 / 导入 / 设置 / 学习计划 |
| 课程进度 `/course` | 空数据时隐藏零统计，保留课程关联、继续任务、历史与深链接 |
| 待办 `/tasks` | 统一页头、渐进表单、智能默认值、创建 / 保存文案、降低卡片装饰、触屏行操作 |
| 通知档案 `/notices` | 统一页头，保持原文收集、来源管理、处理与检索 |
| 重要日期 `/exams` | 统一页头、手机操作自然换行、保留类型筛选 / 历史 / 日历 / 校外考试 |
| 日程 `/events` | 统一页头、空数据不展示零概览、筛选与列表操作尺寸、保留“正在进行 / 接下来”状态 |
| 清单 `/lists` | 统一标题、空态与模板图标，保留用户自选清单表情 |
| 账本 `/bills` | 统一页头、按钮层级、分类列表触屏区域，保留导入 / 导出 / 固定账单 / 汇率与回顾 |
| 回顾 `/review` | 统一页头与说明、保留周切换、图表及自动保存 |
| 一起约 `/together` | 统一标题和访客入口图标，保留好友、邀请和资料流程 |
| 齐行 `/projects` | 导航名称改为更易理解的“项目协作”，保留页面品牌；统一页头、访客状态、项目类型与归档标记 |
| 校园 `/campus` | 去除第二层桌面侧栏；服务以列表组织；贡献豆规则移至下方折叠区 |
| 校园地点 `/campus/places` | 统一页头与面包屑，保留地点、私人记录和检索 |
| 校园子页 | 通过共享壳统一标题、表单、卡片、导航、加载 / 空 / 权限 / 错误态；申请审核员页使用共享页头 |
| 反馈 `/feedback` | 统一页头与行动；网络错误使用中文恢复说明 |
| 管理入口与 404 | 继承共享基础组件与响应规则；404 明确“回到今天”；管理权限入口保留 |

校园子页巡检覆盖：怎么办、动态详情缺失、全站搜索、老师与课程、二手集市、互助、校车、失物、活动、指南、统一发布、我的投稿、举报与审核员申请。

## 4. 重构了哪些组件

- 新增 `AppIcon`：显式导入常用 Lucide 图标，统一 18px / 1.75 stroke；装饰图标对读屏隐藏。
- 新增 `PageHeader`：标题、说明、面包屑、附加内容、行动插槽与手机换行。
- `Sidebar`：导航分组、工具折叠、收起名称、键盘操作、所有目的地可达及原分组状态恢复。
- `EmptyState`：静态图标、清晰下一步、compact 列表空态与按钮包装。
- `Modal`：统一表面、边距、44px 关闭操作；继续使用原浮层栈、焦点管理与返回行为。
- `RouteFallback`：加载骨架、明确的失败标题、重试与返回入口。
- `TodayAgenda / TodayActionList / FocusPanel`：统一模块边界，减少嵌套卡片，首页长标题限制展示行数，完整内容仍在详情中。
- `HomeProductivityPanel / StudyPlanner`：首次使用提示简化；首页学习建议按需展开，计划、撤回、准备复习等动作保留。
- `QuickRecordPanel`：分段控件、类型图标和保存反馈；保留识别、修正、保存、查看与撤销。
- `AccountPanel`：移除重复欢迎层及单一模式切换；没有错误时不渲染空的错误框。
- `CampusStateBlock / Alert`：未登录不再伪装为读取失败；默认提示边界使用主题令牌。

组件层级继续沿用：Tokens → 原生 / Reka primitives → Button / Input / Field 等基础组件 → 共享组合 → 功能组件 → 页面。

## 5. 移动端做了什么

900px 以下采用底部主导航与“更多”抽屉，高频快速记录保持可达。桌面设置进入工具折叠区；校园功能使用本地展开菜单，避免手机层层跳转。

统一触屏操作最小尺寸，输入使用 16px 字号；520px 以下表单单列、页头与行动换行。保留已有安全区、可视视口、键盘避让、底部保存栏、浮层焦点陷阱及手势关闭机制。通过 320px 实际表单操作检查，而非仅检查首页截图。

验证尺寸：320 / 360 / 375 / 390 / 414 / 430 / 768 / 1440 / 1920px。另在 `isMobile + hasTouch` 的粗指针上下文验证点击区域、长内容、账号表单、暗色及离线记录。

## 6. 新增了哪些 UX 能力

- 新增只需内容即可创建待办的明确说明与渐进字段组织，默认普通优先级、无截止日期。
- 新增应用外壳离线说明和网络恢复播报，本机功能继续可用。
- 新增心情单选组方向键 / Home / End 操作，组内保留一个 Tab 停靠点。
- 新增成功反馈让位于表单的行为，并保留关闭表单后的撤销时间。
- 新增旧默认导航的精确迁移；用户改名、排序或隐藏过的导航不被覆盖。
- 收起侧栏仍展示全部目的地，展开后恢复原来的分组展开状态。
- 学习建议从首页默认内容改为按需展开，高级能力继续存在。

## 7. 删除 / 合并了哪些重复内容

移除了首页重复覆盖与失效的样式、装饰渐变、循环空态动效、账号重复欢迎区、关闭注册时冗余的单一模式按钮，以及校园第二层桌面侧栏。页头、图标、空态及布局规则归入共享组件。零数据概览在课程与日程空态中隐藏；有数据时仍展示。

TodayView.css 相对起点净减少约 500 行。没有删除有价值的业务功能，也没有迁移或清理用户记录。

## 8. 修复了哪些问题

修复收起侧栏后工具缺少名称、关闭分组在紧凑导航中无法到达、通用样式误隐藏业务状态、快速记录反馈覆盖账号表单、无错误时出现空红框、部分触屏控件尺寸不足、重要日期按钮在手机端挤压文字、长标题撑高工作台、默认 Alert 黑边与网络错误直接显示技术原文。

最终有数据截图还发现“今日安排”不会在原地新增 / 编辑 / 删除课程和日程后立即刷新。原因是本项目的存储数组通过 triggerRef 通知原地修改，而子组件接收到的数组身份没有变化。本次在父组件派生响应式数组快照，保持存储与数据模型不变，并增加覆盖新增、改名、删除的真实页面回归验证。

独立代码复核指出的无障碍名称与业务状态隐藏问题均已修正，并经复核确认。新增键盘模型同时有真实按键测试和“整组排除仍会报错”的反例，没有通过取消无障碍检查来消除失败。

## 9. 性能与可访问性优化

没有新增依赖、外部字体、图片资源或大型动画库；图标采用明确导入。移除失效 CSS、过重装饰和重复规则，保留已有懒加载、列表虚拟化与按需加载弹窗。生产构建保留现有拆包与完整性检查。

对比度审计覆盖 144 组配色，以及 6 个主题 × 7 类焦点相邻背景的 42 组检查。触屏实测覆盖的首页、待办、课表、日程、账本、清单、校园、集市和发布入口没有不足 44px 的可见独立操作。密集日期网格遵循原有专门键盘模型，未用通用按钮规则强行改变网格。

保留跳过导航、焦点指示、语义标签、错误说明、常驻实时播报、模态焦点陷阱；补充收起导航名称和心情方向键。减少动态效果时，浏览器中验证到按钮 transition-duration 为 0s。

## 10. 遗留问题与验证边界

浏览器检查使用 Edge / Chromium 的桌面和触屏仿真，没有在实体 iPhone Safari、Android 或真实读屏软件上执行验收。软键盘与系统安全区的代码机制、自动化约束和窄屏表单已检查，实体设备体验仍需真机复核。

校园和管理页面验证了访客、权限不足与网络失败状态；没有使用真实账户执行登录后的云端投稿、审核、付款或管理写入。业务行为由既有回归测试及本机真实操作共同覆盖，不能将这次访客截图视为真实云端权限验收。

工作区同时存在其他任务的网络缓存、容量和后端改动。本报告的文件清单仅列出本次 UI/UX 编辑；其他任务的内容保留，不计入本次设计成果。最终构建签名覆盖构建时的整个工作区；之后若继续修改源码，需要按仓库原有流程同步签名。

已有 JavaScript 类型债务仍由仓库原来的 ratchet 基线管理；常规 typecheck 与 ratchet 通过，并不表示历史类型问题已经全部清零。本次没有扩大这部分历史债务。

## 11. 如何验证

本地预览：`http://127.0.0.1:5174/`。在项目根目录运行：

```powershell
npm run lint
npm run typecheck
npm run typecheck:ratchet
npm test
npm run audit:contrast
npm run check:release-readme
npm run build
```

构建流程要求更新说明与源码签名一致，已通过仓库脚本同步为本地 1.11.0。仅同步桌面包的版本元数据以满足既有一致性要求，没有构建或发布桌面应用。

实际浏览器流程覆盖：待办空标题校验与焦点、只填标题保存、快速记录解析并记账、专注开始 / 暂停 / 提前结束保存、心情方向键、账号焦点限制 / Escape、虚构数据 JSON 备份下载、成功提示让位 / 撤销、离线新增 / 联网恢复，以及收起侧栏的键盘可达性。

验收产物保存在仓库外 `D:\study-life\audit` 与 `D:\study-life\.tmp`，避免把运行数据和截图混入源码：

- `audit/uiux-results.json`：九种宽度的页面溢出与页面错误结果。
- `audit/uiux-{宽度}-{序号}.png`、`uiux-sheet-*.jpg`：页面截图与视觉复核拼图。
- `audit/uiux-populated-touch-390.png`、`uiux-dark-touch-390.png`、`uiux-high-contrast-touch-390.png`、`uiux-offline-touch-390.png`：长内容、暗色、高对比和离线状态。
- `.tmp/uiux-flows.log`、`uiux-states.log`、`uiux-sidebar.log`：真实浏览器交互结果。
- `.tmp/uiux-verified-tests.json`、`uiux-build.log`：最终测试与构建结果。

### 最终检查记录

| 检查 | 结果 |
| --- | --- |
| 全量回归 | 3499 / 3499 项通过，报告 `uiux-verified-tests.json` |
| 收尾专项 | 94 / 94 项通过，含今日安排原地新增 / 编辑 / 删除、学习建议空态、孤立学习时段撤回、网络错误正反例和反馈浮层；报告 `uiux-final-state-tests.json` |
| Lint | 通过 |
| Typecheck | 通过；ratchet 2885，低于原基线 2914，未改写基线 |
| 对比度 | 144 组配色、42 组焦点相邻背景检查通过 |
| 发布说明一致性 | README / 网页 / 包版本 / 历史的 1.11.0 元数据通过校验 |
| Web/PWA 生产构建 | 通过；构建与当前源码签名均为 `3cbe9fcf3b` |
| 手机 / 桌面全入口 | 390 与 1440px 各 34 个入口，含动态详情缺失、管理权限和 404 |
| 其他屏宽 | 320 / 360 / 375 / 414 / 430 / 768 / 1920px 各 17 个主要入口 |
| 响应式矩阵 | 共 187 次页面检查，无横向溢出、无未捕获页面错误 |
| 触屏上下文 | 九个核心入口无不足 44px 的可见独立操作；长内容、表单、撤销和学习建议展开通过 |
| 外观与网络 | 深色、高对比、减少动态效果、离线新增及联网恢复通过 |
| 侧栏 | 收起时 13 个目的地全部可达、无无名入口；设置可用键盘展开；恢复分组状态通过 |
| 独立代码复核 | 已修正全部发现项，最终无未解决的 Critical / Important / Minor |
| Diff 格式 | `git diff --check` 通过 |

收尾检查清单：

- [x] 页面入口、共享组件、按钮层级、表单与弹窗审查。
- [x] 首次使用、空数据、加载骨架、成功、错误、权限、离线、部分数据及长内容检查。
- [x] 手机、平板、桌面与大屏布局检查。
- [x] 深色、高对比、减少动态效果及键盘焦点检查。
- [x] 设计令牌、重复 CSS、重复 UI 和高级字段渐进展开检查。
- [x] 本机保存、继续任务、专注和备份导出的实际操作检查。
- [x] 不覆盖其他任务改动；不提交测试数据或截图。

实体设备、真实读屏和真实云端权限验证边界仍以第 10 节为准。以上结果记录的是本次运行的源码状态；共享工作区之后继续修改时，应重跑相关检查。

## 12. 最终修改文件清单

以下路径均相对 `D:\study-life\study-life`。部分文件同时包含其他任务改动，本次没有覆盖它们。

### 规范、报告与构建元数据

```text
DESIGN.md
docs/uiux-refactor-2026-10-16.md
README.md
release.config.js
release-history.json
package.json
package-lock.json
desktop-app/package.json
desktop-app/package-lock.json
```

### 共享基础、组件与导航

```text
src/App.vue
src/style.css
src/styles/shadcn.css
src/styles/workbench-surfaces.css
src/composables/theme.js
src/composables/navigationPreferences.js
src/composables/campusContentModel.js
src/router/navigation.js
src/router/routes.js
src/components/AppIcon.vue
src/components/PageHeader.vue
src/components/Sidebar.vue
src/components/Sidebar.css
src/components/EmptyState.vue
src/components/Modal.vue
src/components/NotFoundView.vue
src/components/RouteFallback.vue
src/components/AccountPanel.vue
src/components/QuickRecordPanel.vue
src/components/HomeProductivityPanel.vue
src/components/TodayAgenda.vue
src/components/TodayActionList.vue
src/components/focus-panel.css
src/components/learning/LearningNavigation.vue
src/components/learning/StudyPlanner.vue
src/components/campus/campus-life.css
src/components/campus/CampusStateBlock.vue
src/components/ui/alert/index.ts
```

### 页面

```text
src/views/TodayView.vue
src/views/TodayView.css
src/views/TasksView.vue
src/views/tasks.css
src/views/ScheduleView.vue
src/views/CourseArchiveView.vue
src/views/ExamsView.vue
src/views/exams.css
src/views/EventsView.vue
src/views/LedgerView.vue
src/views/ledger-panels/LedgerHomePanel.vue
src/views/ListsView.vue
src/views/NoticesView.vue
src/views/PlacesView.vue
src/views/ProjectsView.vue
src/views/FeedbackView.vue
src/views/TogetherView.vue
src/views/WeeklyReviewView.vue
src/views/CampusHubView.vue
src/views/campus/CampusReviewerApplicationView.vue
```

### 回归验证

```text
tests/navigationInformationArchitecture.test.js
tests/navigationPreferences.test.js
tests/navigationEditor.test.js
tests/navigationEditorInteraction.test.js
tests/contrastAudit.test.js
tests/scopedChildReachability.test.js
tests/notFoundViewDom.test.js
tests/routeFallback.test.js
tests/courseProgressView.test.js
tests/learningWorkflow.test.js
tests/confirmDialogMigration.test.js
tests/helpers/tabOrder.js
tests/tabOrderAndNames.test.js
tests/quickRecordToastOverlay.test.js
tests/campusFormatting.test.js
```

本次实际应用 frontend-design、shadcn、playwright-cli、verification-before-completion、requesting-code-review 和 receiving-code-review Skills；沿用 Vue / Reka 技术栈，并根据真实交互验证调整通用建议。
