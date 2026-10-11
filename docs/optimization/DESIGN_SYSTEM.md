# 设计系统基础与组件合同

日期：2026-10-11（Asia/Shanghai）。第 1–7 节保留设计系统基础阶段记录，涵盖全局基础、Button / Input / Card、PromptDialog 典型表单，以及 Modal / ActionButton 的少量 Token 接入；第 8 节记录本轮待办与周回顾的消费者整合。页面结构按 [DESIGN_PLAN.md](DESIGN_PLAN.md) 分批推进；最新验收结果见 [STATUS.md](STATUS.md) 第 0B 节。

## 1. 技术兼容性与所有权

当前栈为 Vue 3.5、Vite 8、Tailwind 4、shadcn-vue（reka-nova）、Reka UI 2、CVA 和 `@lucide/vue`。已有 21 组 UI 原语；`components.json` 指向 `src/styles/shadcn.css`，别名沿用 `@/components/ui` 和 `@/lib/utils`。本轮没有安装依赖、切换 preset、导入 React、启用 Preflight 或覆盖全部组件。

已读取 `C:\Users\guo\.agents\skills\shadcn\SKILL.md`，将语义色、组合、variant、命名与可访问性规则用于 Vue。只读尝试 `npx shadcn@latest info --json` / `docs button input card field`：React CLI 不接受现有 Vue 配置；没有为通过 CLI 修改配置。API 核对使用官方 [Button](https://www.shadcn-vue.com/docs/components/button)、[Input](https://www.shadcn-vue.com/docs/components/input)、[Card](https://www.shadcn-vue.com/docs/components/card)、[Field](https://www.shadcn-vue.com/docs/components/field) 文档。未来新增原语使用匹配的 shadcn-vue 工具，先查看已有组件和差异。

所有权固定为三层：

1. `theme.js` / `contrast.js` 管用户主题与高对比度；`style.css` 是全局 Token 真源与原生控件基础。
2. `shadcn.css` 桥接 Tailwind 语义变量，并拥有 `.ui-*` 组件配方；Button 的 CVA 选择 variant / size。焦点沿用全局规则，不叠加第二套 ring。
3. 业务调用者只传行为、variant、size 与布局。旧页面的 scoped 覆写逐页收敛，不用全仓机械替换打断现有布局。不得同时给新组件混入新颜色类或复制基础控件 CSS。

Tailwind utilities 目前仍为 important，以兼容已有 reset 和消费者；本轮没有更改其优先级。新 `.ui-*` 配方避免重复 utility 尺寸/字体/ring；业务布局 utility 仍可控制宽度、排列和外边距。

## 2. 全局 Token

| 类别 | 实际 Token / 值 | 使用规则 |
| --- | --- | --- |
| 颜色 | `--ui-background/foreground/card/primary/primary-foreground/secondary/muted/accent/destructive/border/input/ring` | 沿用既有浅/深、具名、自定义和壁纸取色主题；控件不用硬编码色值 |
| 状态 | `--success`、`--warning`、`--danger`、`--on-danger`；Tailwind 新增 success / warning 角色 | 成功/错误配文字、图标或 live region；Input 错误同时关联说明；成功不把每个字段染绿 |
| 输入边框 | `--ui-input` 由 ink-faint 80% 与 card 混合 | 与内容分隔边框分开，避免只有低对比度边框的输入框不可识别；在浏览器核对与字段底色达到 3:1；高对比度跟随既有调色板 |
| 字体 | `--font-sans` 保留中文系统字体栈 | 不下载新字体；数字和长内容按业务含义排版 |
| 字号 | 页面 `--fs-page-title:23px`；分区共享 Card 16px；正文 `--fs-body:14px`；辅助 `--fs-aux:12.5px` | Tailwind xs/sm/base 固定映射到 12/14/16px，避免根字号 15px 导致 sm 实际为 13.125px。保留旧数字字号，后续逐页收敛 |
| 行高/字重 | `--line-body:1.6`、`--line-heading:1.4`；正文 400/500、动作 600、标题 600/700 | 标题允许换行；不用全站过度加粗抢焦点 |
| 间距 | `--spacing:4px`；`--space-1..6:4/8/12/16/20/24px` | 控件内距 8/12/16；表单/内容间距 16/20/24；优先 flex/grid gap |
| 控件高度 | `--control-height:40px`、`--control-compact:32px`、`--control-large:44px` | xs 28px 仅用于桌面密集辅助动作；手机粗指针统一至少 44px |
| 圆角 | `--radius-control:8px`、`--radius-surface:12px`；`--ui-radius` / `--card-radius` 接 surface | 常规控件与内容面克制；pill 只用于已有状态形变/标签；手机 Modal 顶角 18px 保留平台合同 |
| 边框 | `--border-width:1px`，border / input / ring 区分职责 | 高对比度仍由现有主题机制处理；焦点 outline 2px、offset 2px |
| 阴影 | 既有 `--shadow-sm/md`；新增 `--shadow-overlay` 按主题文字色混合 12% | Button 无投影；新 Card 默认边框、无投影；旧 `.card` 保留轻阴影；Modal 使用克制浮层阴影 |
| 图标 | `--icon-size:16px`，Lucide Vue，统一 stroke 系统 | Button 拥有 SVG 尺寸；使用 `data-icon` 表示位置；纯图标控件必须提供名称；Emoji 仅用于内容/氛围 |
| 动画 | 既有 instant/fast/base/slow（90/150/220/320ms）及标准曲线 | 控件仅过渡颜色/边框/透明度；按下 1px；保留 ActionButton 请求状态；减少动态和 reduced performance 下取消位移 |
| 响应式 | 既有 900px 壳切换、520px Sheet；`pointer:coarse` 触控规则 | 本轮不改断点；新 Card 在 ≤520px 使用 16px 内距；输入粗指针 ≥16px 防 iOS 缩放，行动 ≥44×44px；保存按钮可换行 |

以上新增 Token 都有实际消费者；未添加只有定义没有引用的名义设计系统。媒体查询沿用字面断点，因为 CSS 原生媒体条件不能可靠消费 CSS 自定义属性。

## 3. 信息与动作层级

每个页面或编辑浮层只突出当前下一动作：保存、新建、开始等使用 default 实底主色；取消/次操作使用 outline；工具和可选动作使用 ghost 或 link；风险动作使用 destructive，并在文案中说明对象和后果。只有强调的状态或当前选择使用 accent，不将辅助操作全部涂成主色。

页面标题 → 分区标题 → 正文 → 辅助说明组成稳定层级。关键数字只在能帮助判断时突出；空/无样本指标不占主视觉。紧凑工具区用 32px 桌面控件，标准表单用 40px 控件，手机增大目标；不要靠减小正文实现密度。

Card 用于独立内容组；同一过滤器、零值指标、普通说明不再拆成多个大卡。组合采用 Header / Title / Description / Content / Footer，内容内部优先列表、分隔与 gap。页面现有卡片嵌套仍需后续结构阶段处理，本轮没有声称清理所有页面。

## 4. 组件审查与后续整合

| 组件 | 本轮决定 | 后续统一合同 / 保留原因 |
| --- | --- | --- |
| Button | 已调整 CVA 与共享配方 | default / outline / secondary / ghost / destructive / link 共用尺寸、图标、按下和焦点；原生 disabled / aria-disabled 抑制 Hover |
| ActionButton | 保留逻辑，仅接尺寸与成功前景 Token | 保留重复提交锁、请求取消、尺寸锁、局部反馈、重试及读屏公告。异步领域操作继续使用它，静态操作用 Button |
| Input | 已消除重复 ring / 尺寸 / 阴影配方 | 原生属性穿透与 modelValue 不变；同全局边框、Focus、错误、Disabled；原生 select/textarea 暂保留业务适配 |
| Card | 已统一六个组合组件 | 20px 内容内距、16px 手机内距、12px 圆角、16px 标题；保留消费者布局覆写 |
| Form / Field | 在 PromptDialog 典型接入 | FieldGroup → Field → FieldLabel + Input + FieldError；data-invalid 与 aria-invalid 同步，错误 ID 由 aria-describedby 关联。没有新增第二套表单引擎 |
| Dialog / Sheet | Modal 仅接圆角、阴影、标题内距 | 保留 overlayStack 的焦点、返回、滚动锁、虚拟键盘、两档拖拽。现有 Reka Dialog 不批量替换 Modal；混用前先建立同一浮层栈适配。所有浮层需标题/名称 |
| Tabs / ToggleGroup | 保留已有 Reka 原语，本轮未改实现 | TabsTrigger 必须在 TabsList 内；箭头/焦点由原语处理；简单选项切换用 ToggleGroup，不能只给普通按钮贴 active 色 |
| Dropdown / ContextMenu / ActionSheet | 保留现有业务菜单，本轮未安装新 Dropdown | 后续只在实需时引入 DropdownMenu，并核对键盘、Groups、权限、浮层栈、返回焦点与长按动作；保留现有可达入口 |
| Toast | 保留现有组件，本轮未改实现 | 保留撤销、查看、队列和 floatingStack；主题状态色、动作不自动消失、live region 已具备价值，不另加 Sonner 构成第二套通知 |
| Sidebar | 保留业务导航和个性化，本轮未改结构 | 保留分组、折叠、路由与手机底栏；A05 工具横滚后续独立处理。无需安装重复 Sidebar |
| EmptyState / Skeleton / Badge / Progress | 保留现有组合 | 优先现有原语；业务包装保留语义。Skeleton 的加载、真实 Progress 与空态不能互相混用 |

## 5. 状态与可访问性合同

| 状态 | 实际规则 |
| --- | --- |
| Default / Hover | 默认主动作明确；鼠标 Hover 仅调整语义颜色/边框，不抬升卡片；禁用/aria-disabled 控件不响应 Hover |
| Focus | 原生与共享控件使用同一实色 outline + 对比 halo；没有 outline-none 抹掉键盘焦点；保留滚动余量 |
| Active / Expanded | 允许微小按下位移；expanded 使用 muted/accent，同时绑定语义属性；减少动态时取消位移 |
| Disabled | 原生 disabled 阻止激活；保持名称/值；异步包装继续用自己的锁和 aria-disabled 保留取消/重试机制 |
| Loading | 静态 Button 组合 Spinner + disabled + aria-busy；异步 ActionButton 保留已有请求协议和尺寸；不得伪造完成 |
| Success | 文字/图标/公告与主题 success 色结合；ActionButton 实底成功图标使用 card 前景，浅深色都有对比；复杂结果保持外部反馈合同 |
| Error | 就近 FieldError 或现有 ActionFeedback；文字说明 + aria-invalid / aria-describedby；保留 draft、重试和焦点，不只用红色 |

PromptDialog 保留初值、trim、空值只关闭、取消/Escape 只关闭、maxlength、错误保留、焦点归还。Enter 在 `isComposing` 时不提交，中文输入法组词与保存分开；该项有挂载行为回归。未改业务写命令、持久化或调用入口。

## 6. 本轮实际变更清单

| 文件 | 本轮增量 |
| --- | --- |
| [style.css](../../src/style.css) | 新增并消费基础 Token、固定 4px 步长；中文字体栈令牌化；原生输入边框、旧按钮/卡片接 Token；去主按钮阴影、成功色语义化 |
| [shadcn.css](../../src/styles/shadcn.css) | 字号/颜色/圆角映射；ui-button/input/card 配方；粗指针和手机内距、减少动态；补 PromptDialog 扫描源 |
| [button/index.ts](../../src/components/ui/button/index.ts)、[Button.vue](../../src/components/ui/button/Button.vue) | CVA variant/size；补主按钮 Hover；禁用 Hover 条件；默认 data-variant/data-size；不更改 Primitive 组合接口 |
| [Input.vue](../../src/components/ui/input/Input.vue) | 保留 useVModel/属性穿透；移除与全局冲突的字体、ring、透明底/高度/阴影 |
| [Card.vue](../../src/components/ui/card/Card.vue)、[CardHeader.vue](../../src/components/ui/card/CardHeader.vue)、[CardContent.vue](../../src/components/ui/card/CardContent.vue)、[CardFooter.vue](../../src/components/ui/card/CardFooter.vue)、[CardTitle.vue](../../src/components/ui/card/CardTitle.vue)、[CardDescription.vue](../../src/components/ui/card/CardDescription.vue) | 六个组合组件消费共用配方；Footer 可换行；Title 行高与正文行高分工 |
| [Modal.vue](../../src/components/Modal.vue) | 仅圆角、浮层阴影、标题内距接 Token；逻辑未改 |
| [ActionButton.vue](../../src/components/ActionButton.vue) | 仅高度、gap、成功/错误图标前景接 Token；请求/反馈逻辑未改 |
| [PromptDialog.vue](../../src/components/PromptDialog.vue) | 典型 Field 表单与 Button 主次操作；移除重复标签/错误样式；保留 prompt-field/label/input 兼容定位；补输入法 Enter 保护 |
| [promptDialogMigration.test.js](../../tests/promptDialogMigration.test.js) | 增加输入法与错误关联行为用例；按钮层级断言从旧 class 更新为公开 variant；保留其余迁移/账本/持久化回归 |

修改仅 14 个应用源码文件、1 个已有测试、3 个优化文档。截图样例/日志在本机临时目录；没有添加产品路由、展示页菜单或真实用户数据。

## 7. 检查边界与下一阶段

本轮通过隔离 Chromium 检查少量代表控件和现有消费者页面；并执行相关回归、lint、常规类型、类型棘轮、对比度和全量测试。正式 build 仍受现有发布签名/更新说明一致性门禁阻止；全量既有 A02 课表行数失败仍须记录，不能称发布通过。具体数字以 STATUS 新鲜结果为准。

下一阶段需按产品工作流逐页消除 scoped / utility / legacy 重复覆写，处理 A05 侧栏与 A07 文本动作，整合 Tabs / 菜单与 Modal 栈；再做真机软键盘、读屏器、所有主题/命名色/自定义色与复杂登录态检查。本阶段结束后停止，等待下一阶段指令。

## 8. 电脑端两页消费者整合（2026-10-11）

待办与周回顾使用既有 Button / ToggleGroup / Field / Card / Empty 组合，详情见 [STATUS.md 第 0B 节](STATUS.md)。新增 ui-toggle 配方消除无 Preflight 时的浏览器默认边框，尺寸为桌面 32px、粗指针 44px，状态使用语义 accent，焦点沿用全局规则；没有额外 ring。CardTitle 可选 as=h2/h3/h4，默认 h3 不变，避免页面分区跳级。页面扫描源加入 TasksView / WeeklyReviewView。

页面 scoped CSS 负责内容排列、原生 textarea 与业务图表；Button/Badge/Toggle/字段说明采用已有配方和 variant。侧栏仅解决工具行与主题行横溢出。本批两页正式构建与相关回归通过，第 7 节的构建受阻属于上一阶段记录；全量仍有既有 A02 课表行数失败。没有将其他页面或全部共享组件标成完成；完整完成/未完成名单、门禁与真实平台边界见 STATUS。

## 9. 手机工作区与复杂表单（2026-10-11 第 1 批）

今天与待办沿用 Button variant、Field 标签、语义色与焦点，手机采用整行下一行动、状态 select、按需展开概览/二级导航/高级筛选、独立列表栅格。三视图与全部业务动作保留，批量选择有显式模式；月历七列保持日期至少 44×44px，窄屏仅日期区局部横滚并提示操作。

复杂任务编辑使用 Modal 可选 mobileFullScreen：手机整屏、独立滚动内容、固定保存/取消页脚、标题/关闭按钮与内容留 safe-area。保留 visualViewport、栈、返回、焦点和滚动锁；简单菜单继续 Sheet，不给复杂表单附加拖拽关闭。例行备份提醒经 backupReminder 投影推迟到浮层关闭，错误保留优先级。

壳与上述手机消费者使用 `(max-width: 900px), (pointer: coarse) and (max-height: 520px)`，保证 956×440 触屏横屏仍为手机交互；电脑侧栏与学习导航的相反规则一致。沿用现有断点档位，未新增 390px 工程档位。对 shadcn important utility，调用者用 whitespace-normal 允许长动作换行，需要不同控件时用响应式条件渲染，避免 scoped display:none 与 inline-flex utility 竞争。

主要验证 440×956；其他宽度/主题/触屏横屏/字号 Token 200% 见 [STATUS.md 第 0C 节](STATUS.md)。Chromium 可见视口模拟不代表 iOS 软键盘或 OS 字体设置，真机与其他复杂页面仍待下一批。

## 10. 全局交互专项第 1 批（2026-10-11）

ActionButton 保持既有原生根控件、语义 Token、局部/外部结果通道与全局焦点环。重要操作从真实 Promise 结果直接切换绿色成功，取消 1200ms 演示最低等待；文字淡出 150ms、表面收缩/展开和对勾 320ms ease-in-out，成功保持 1000ms。快速成功可跳过加载环；请求持续就保持 loading。外部占位保持不变，尺寸为桌面 40px、触屏 44px。普通导航/开关继续即时响应，危险草稿操作保留确认/撤销。

Hover 不移动位置；Active 轻按；禁用禁止执行；真实 busy 为 progress，成功反馈锁定时使用普通 cursor。重要圆形加载图标继承当前 tone 前景，避免 ghost/neutral 白环不可见；成功/错误分别走 card/on-danger 图标 Token。减少动态时无旋转、形变或按压位移，状态仍可读。错误文字保留并关联说明；重试遵从 caller disabled/busy 和同步锁。

本批只深入 GLO02 导航保存：主保存等待持久化、失败保留草稿；保存并离开走相同同步锁/真实结果，取消与关闭不触发迟到离开；布局已从同步更新为相同值时可直接离开，无伪保存。父关闭清理子确认框；旧请求释放锁后当前 clean 草稿跟随存储，不发布旧会话结果。底层本机事务不保证可中止，不宣称 AbortSignal 能撤回已写入数据。

全局逐入口审计和后续覆盖见 [INTERACTION_LEDGER.md](INTERACTION_LEDGER.md)、[INVENTORY.md](INVENTORY.md)。验证见 STATUS 第 0D 节；其他菜单、复杂表单、上传/同步/删除消费者及真实平台边界仍 U。
