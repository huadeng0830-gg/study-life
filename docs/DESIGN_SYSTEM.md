# 设计系统与组件约定

更新日期：2026-10-10。本文说明项目当前 Vue 3 界面如何逐步采用 shadcn-vue 的组件与主题约定，供后续页面改造和新增功能复用。

## 技术边界

项目使用 Vue 3、Vue Router、Vite、Tailwind CSS v4 和 Reka UI。此处的 shadcn/ui 指可复制到项目并由项目自行维护的设计/组件模式；实现选用 Vue 生态中的 shadcn-vue，并不把 React 组件移植进来。领域状态、路由和页面布局仍由现有 Vue 模块负责。

使用本地 `components.json`（`reka-nova`、Tailwind v4、Lucide）作为组件生成/别名约定；共享实现位于[`src/components/ui/`](../src/components/ui/)，Tailwind 语义映射位于[`src/styles/shadcn.css`](../src/styles/shadcn.css)，基础令牌和主题位于[`src/style.css`](../src/style.css)。生成的组件代码纳入仓库并由项目检查维护，不要求运行时远程加载组件。

参考的上游文档： [shadcn-vue 主题](https://www.shadcn-vue.com/docs/theming)、[组件目录](https://www.shadcn-vue.com/docs/components)、[Calendar](https://www.shadcn-vue.com/docs/components/calendar)、[Dialog](https://www.shadcn-vue.com/docs/components/dialog)。项目封装以本地代码和本节约定为准。

## 视觉与主题令牌

`src/style.css` 是本项目语义值的来源；新增组件优先消费语义变量，而不是在 Vue 模板里散落硬编码颜色。shadcn 的语义名映射到现有应用值，因此两套组件可以在同一主题下共存。

| 用途 | 主要令牌 | 使用约定 |
| --- | --- | --- |
| 页面与表面 | `--bg`、`--card`、`--bg-tint`、`--ui-background`、`--ui-card` | 页面背景、卡片、浮层共享同一表面层次；浮层不直接固定白色 |
| 文本 | `--text`、`--muted`、`--ink-soft`、`--ui-foreground` | 正文使用前景色，次要说明使用 muted 角色并保持足够对比 |
| 状态色 | `--primary`、`--danger`、`--success`、`--warning` 及对应 soft/on 色 | 颜色之外同时显示文字、图标或状态语义 |
| 分隔与输入 | `--border`、`--border-strong`、`--ui-border`、`--ui-input` | 表单状态不能只靠边框色区分 |
| 焦点 | `--focus-solid`、`--focus-halo`、`--focus-width`、`--focus-offset`、`--ui-ring` | 键盘焦点须在卡片与主题背景上可见；不得用 `outline: none` 隐去焦点 |
| 圆角/阴影 | `--radius-*`、`--ui-radius`、`--shadow-sm`、`--shadow-md` | 控件使用较小圆角，卡片和浮层使用共享大圆角；阴影表达层级，不替代边界 |
| 动效/触控 | `--dur-*`、`--ease-*`、`--tap-min` | 动效简短、可中断；粗指针目标以至少44px为参考，并检查窄屏空间 |

主题包括浅色、系统深色、具名主题和自定义颜色，并支持高对比偏好。更改语义颜色时须同时检查正文、弱化文字、危险/成功状态、输入边界和焦点，不要只检视主按钮。项目内的对比度门禁是自动化辅助，不等同于完整WCAG认证。

令牌的详细色板、全部值、对比度规则和变更步骤见仓库根目录的[`DESIGN_TOKENS.md`](../DESIGN_TOKENS.md)。

## 组件使用约定

- **按钮与操作**：采用 `Button` 的明确语义变体（default、secondary、outline、ghost、destructive、link）和尺寸。破坏性操作要有说明与确认，提交中的按钮暴露忙碌状态并避免重复提交。
- **字段与错误**：用 `Field` / `FieldLabel` / `Input` / `Select` / `Checkbox` 等组合。可见标签与控件关联；辅助说明和错误用稳定ID通过 `aria-describedby` 关联；必填、无效及禁用状态提供文字/语义，不仅变色。
- **弹窗和浮层**：使用 Dialog / Popover 原语处理焦点管理、Escape、关闭按钮、遮罩、滚动锁定和可访问名称。确认框需提供明确取消路径；弹窗内表单应保留验证错误和当前输入。
- **Tabs 与分段选择**：优先复用 Tabs / ToggleGroup 的角色和键盘行为。切换应更新可见内容并保留合理的回退焦点；若某视图状态跨路由/刷新需恢复，由调用方明确保存。
- **日期**：日期选择器复用 Calendar 组件的键盘交互与语义，业务层仍须校验真实日历日期、时区和领域边界。中文文案、周起始日和节假日语义由调用方配置。
- **表格与列表**：使用 Table 的结构化表头、caption（必要时视觉隐藏）和行/列语义；复杂筛选、排序状态须在控件标签中说明。移动端按信息重要性改为可读卡片或明确横向滚动，不能裁掉操作入口。
- **异步、空态和反馈**：加载、空结果、错误、成功和离线态各自说明发生了什么及可执行的下一步。图标按钮要有名称；状态更新使用适当的 live region，避免整页频繁播报。

组件目录是共享基座，不要求把所有旧页面一次性重写。新组件落到`src/components/ui/`前应确认可跨业务复用；只服务一个领域的复杂交互留在相应业务组件中，并通过共享原语组装。

## 页面结构与响应式

- 桌面保留分组侧栏与较高信息密度；移动端使用底部主导航和二级入口，将主要操作放在拇指容易到达的位置。
- 表单在窄屏改为单列，按钮和弹层不超出视口；对必须展示的周视图、表格保留有提示的横向滚动区域。课表采用按星期横向浏览，窄屏不要挤成难读的七列。
- 项目没有一个能覆盖所有旧页面的单一断点。扩展时先检验320/360、390、520、760、900及更宽布局，再按实际组件需要增加断点；确保底部导航、固定操作条、弹层与安全区互不遮挡。
- 当前抽查记录见[覆盖矩阵](COVERAGE_MATRIX.md)：1440桌面、768平板及390手机上的选定页面。该抽查不能替代实体iOS Safari、软键盘、安全区、读屏器或所有路由目视检查。

## 新增/修改组件的验收

提交共享UI修改前，至少检查主题切换、键盘焦点和键盘操作、表单错误关联、异步忙碌/错误态、窄屏布局和自动化回归。具有弹窗/日历/菜单行为的控件还需验证Escape、焦点去向和遮罩/滚动行为。当前整体测试范围及未覆盖条件见[TEST_REPORT.md](TEST_REPORT.md)；逐模块状态见[COVERAGE_MATRIX.md](COVERAGE_MATRIX.md)。
