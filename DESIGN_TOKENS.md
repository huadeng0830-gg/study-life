# 设计令牌（Design Tokens）

本文件记录 `src/style.css` 与 `src/composables/theme.js` 里对外的设计令牌，以及新增令牌时必须遵守的规则。令牌是唯一事实来源，业务样式不应再写硬编码值。

操作反馈使用 `ActionButton.vue` 与 `actionFeedback.js`。常规按钮最小高度 42px；触屏沿用 `--tap-min` 44px；圆角沿用 `--radius-8`。`--action-collapse: var(--dur-slow)` 当前为 320ms，用于收缩、展开与 SVG 对勾绘制，`--action-fade: 150ms` 用于文案淡出，`--action-ease: ease-in-out` 用于主体变形。`--action-success: #16a34a` 只用于完整成功动画的圆形底色，白色图标按非文本对比度验证；成功文字继续使用 `--success`。失败继续使用 `--danger`，图标统一 22px、2px 描边。JS 时序集中在 `ACTION_TIMING`，业务完成不等待视觉计时器。详见 `docs/INTERACTION_UX_AUDIT.md`。

## 1. 颜色令牌

定义位置：`src/style.css` 的 `:root`，覆盖位置为 `:root[data-theme='purple' | 'green' | 'pink' | 'custom' | 'dark']` 与 `:root[data-contrast='high']`。

| 令牌 | 用途 | 默认（蓝） |
| --- | --- | --- |
| `--bg` | 页面底色 | `#f5f7fb` |
| `--card` | 卡片/面板底色 | `#ffffff` |
| `--text` | 正文 | `#172033` |
| `--muted` | 次要文字 | `#667085` |
| `--ink-soft` | 辅助文字 | `#55607a` |
| `--ink-faint` | 最弱文字（小号分组标题等） | `#626d84` |
| `--ink` | 正文色兼容别名 | `var(--text)` |
| `--primary` | 主色（文字与实底） | `#3d63d8` |
| `--primary-hover` | 主色悬停 | `#3151b8` |
| `--primary-soft` | 主色浅底 | `#edf2ff` |
| `--on-primary` | **主色实底上的文字色** | `#ffffff` |
| `--danger` | 危险色（文字与实底） | `#c62828` |
| `--danger-soft` | 危险操作的浅底 | `color-mix(in srgb, var(--danger) 9%, var(--card))` |
| `--on-danger` | **危险色实底上的文字色** | `#ffffff` |
| `--success` | 成功/完成语义色（文字） | `#067654`（深色 `#4ecfa4`） |
| `--warning` | 警告/待确认语义色（文字） | `#8a5a12`（深色 `#e0b45c`） |
| `--border` / `--border-strong` | 分隔线 | `#e3e8f2` / `#d3dbea` |
| `--bg-tint` | 比 `--bg` 更浅的区块 | `#f9fafd` |
| `--focus-solid` / `--focus-halo` | 焦点实色与光环 | `#2b5bd7` / `rgba(255,255,255,.92)` |

### 为什么有 `--on-primary` / `--on-danger`

深色主题下 `--primary` 是**亮**蓝（`#5a8cff`），白字在上面只有 3.17:1。深色主题必须把实底文字换成深色（`#0b1020`，6.71:1）。写死 `color: #fff` 的按钮在深色下一定不达标，所以实底文字必须走令牌：

```css
.btn-primary { background: var(--primary); color: var(--on-primary, #fff); }
```

### 对比度约束（强制）

所有"文字 / 背景"组合必须满足 WCAG 2.x AA：

- 正文（含按钮文字）：**≥ 4.5:1**
- 大字（≥24 CSS px，或约 ≥18.67 CSS px 粗体）与非文字图形：**≥ 3:1**。大字按 18pt / 14pt 粗体换算，不能把 pt 直接当作 px；参见 [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。

校验命令：

```bash
npm run audit:contrast          # 只看未达标项；全部达标时退出码 0
node scripts/audit-contrast.mjs --all      # 列出全部组合与比值
node scripts/audit-contrast.mjs --json     # 机器可读
node scripts/audit-contrast.mjs --tokens   # 导出各主题调色板，交给设计侧对齐
```

`tests/contrastAudit.test.js` 会把同一套检查跑进测试套件，因此调色板被改坏时 `npm test` 就会失败。

> 说明：审计项里的「设计令牌同步到 Figma」在当前约束下（不引入外部服务、不联网）改为**本地令牌导出**：`node scripts/audit-contrast.mjs --tokens` 输出的 JSON 就是设计侧所需的色值清单，含明暗与高对比度全部变体。

## 2. 动效令牌

CSS 定义在 `src/style.css` 的 `:root`，JS 镜像在 `src/composables/motion.js` 的 `MOTION`。

| CSS | JS | 值 | 用途 |
| --- | --- | --- | --- |
| `--dur-instant` | `MOTION.instant` | 90ms | 按下、开关、拖拽跟手 |
| `--dur-fast` | `MOTION.fast` | 150ms | 悬停、颜色、图标 |
| `--dur-base` | `MOTION.base` | 220ms | 常规过渡、浮层进出 |
| `--dur-normal` | `--dur-base` 兼容别名 | 220ms | 常规过渡 |
| `--dur-slow` | `MOTION.slow` | 320ms | 结构变化（宽度、进度条） |
| `--dur-reveal` | `MOTION.reveal` | 420ms | 页面级揭示：主题切换的圆形扩散（CSS 侧的 `::view-transition-group` 与 JS 侧的 WAAPI 引用同一刻度） |
| `--ease-standard` | `MOTION.easeStandard` | `cubic-bezier(.2,.8,.2,1)` | 默认 |
| `--ease-out` | `MOTION.easeOut` | `cubic-bezier(.16,1,.3,1)` | 进场 |
| `--ease-spring` | `MOTION.easeSpring` | `cubic-bezier(.34,1.56,.64,1)` | 回弹 |

`tests/motionTokens.test.js` 会逐个核对这张表：每个 token 都必须在 `style.css` 里存在，且 CSS 值必须与 `motion.js` 的 JS 常量一致 —— 文档里写一个不存在的 token 名也会让测试失败。

规则：

- 不要在交互声明里写裸时长。`var(--dur-fast, 150ms)` 这种「带 fallback 的引用」是允许的。
- **不属于交互刻度的时长不受此限**：循环动画的周期（`skeleton-shimmer 1.5s`、`task-spin 1.1s`、`es-breathe 4.2s`）与一次性注意力脉冲（`focus-target-pulse 2.4s`）保持各自的值，硬塞进 90–320ms 的刻度反而会变差。
- 测试只对 **90–400ms** 区间的裸时长报错，正是这条边界。
- `--dur-reveal` 只服务主题切换的圆形扩散（`src/style.css` 的 `::view-transition-group(root)` + `src/composables/motion.js` 的 WAAPI）。**不要**把它套到「定位高亮」上：`.focus-target-highlight` 是 2.4s 的一次性注意力脉冲，属于上面那条「不属于交互刻度的时长」。文档初稿曾把「定位高亮」错记在这个令牌下，已更正。
- 原来只写了时长、没写缓动的声明，迁移时补上 `var(--ease-standard)`；否则会退回浏览器默认的 `ease`，那正是这次要消除的不一致。
- JS 驱动的动画先问 `animationsEnabled()`（`src/composables/motion.js`）或 `reducedEffects`（`src/composables/performanceMode.js`），降级时改用 `behavior: 'auto'` 或直接跳到终态。
- 纯 CSS 动画靠 `style.css` 里的两条全局兜底：`@media (prefers-reduced-motion: reduce)` 与 `:root[data-performance='reduced']`。它们会把 `transition-duration`/`animation-duration` 压到 `0.01ms !important` —— **不要**把这两个属性也改成 token。
- 装饰性元素（例如节日粒子）在 `reducedEffects` 时应当**不渲染**，而不只是把动画压成 0.01ms——否则 18 个节点仍然留在 DOM 里。

## 3. 字号 / 字重 / 圆角刻度（阶段 4 全量迁移）

定义位置：`src/style.css` 的 `:root`「v5 尺度令牌」块。阶段 4 把全仓硬编码 `font-size` / `font-weight` / `border-radius` 机械包裹成 `var()`，**不改数值语义**（迁移前后像素值一一对应）。

### 字号 `--fs-*`

| 刻度 | 值 | 刻度 | 值 |
| --- | --- | --- | --- |
| `--fs-8` … `--fs-16` | 8–16px（半像素用 `--fs-9-5` / `--fs-10-5` / `--fs-11-5` / `--fs-12-5` / `--fs-13-5` / `--fs-14-5` / `--fs-15-5`） | `--fs-17` `--fs-18` `--fs-19` `--fs-20` | 17–20px |
| `--fs-21` `--fs-22` `--fs-23` `--fs-24` `--fs-25` `--fs-26` `--fs-29` `--fs-30` `--fs-32` `--fs-38` | 按实际存量刻度登记 | | |

语义别名（只读，不新增值）：

| 令牌 | 指向 | 用途 |
| --- | --- | --- |
| `--fs-page-title` | `var(--fs-23)` | `.page-title` |
| `--fs-body` | `var(--fs-14)` | 表单控件与 `.btn` |
| `--fs-aux` | `var(--fs-12-5)` | `.page-desc` |

**例外（刻意不令牌化）**：

- `clamp()` / `max()` / `min()` 字号保持字面量——对比度审计要读可证下界，包一层 `var()` 反而读不出。
- `@media (pointer: coarse)` 下的 `font-size: 16px !important` **必须保持字面量**（iOS 防缩放），`tests/mobileViewport.test.js` 锁死；迁移脚本对该组合放行。

### 字重 `--fw-*`

`--fw-400` / `500` / `600` / `650` / `700` / `750` / `800` / `850` / `900` → 对应数字。`normal` / `bold` / `bolder` / `lighter` 关键字保持字面量。

对比度审计的大字门槛会解析 `var(--fw-700)` → `700`（`fontWeightTokenValue`），未登记的 `var(--fw-*)` 仍按正文从严。

### 圆角 `--radius-*`

| 令牌 | 值 | 备注 |
| --- | --- | --- |
| `--radius-2` … `--radius-18` | 2–18px 按存量刻度登记 | 主体刻度 |
| `--radius-pill` | `999px` | 药丸形；存量 `99px` 亦映射到此（99→999，药丸视觉等价） |
| `--radius-circle` | `50%` | |
| `--card-radius` | `var(--radius-14)` | 卡片圆角别名 |
| `--radius-s` | `var(--radius-9)` | 小圆角别名 |

**例外**：

- `border-radius: 0` 保持字面量（零值无令牌）。
- 多角值逐分量令牌化，`0` 分量保持 `0`：`0 0 10px` → `0 0 var(--radius-10)`；`45%` 这类非 `50%` 百分比保持字面量。
- `calc(var(--radius-s) - 2px)` 这类计算式在令牌化后仍合法。

### 对比度审计与令牌

`fontSizeLowerBoundPx` 只解析 `:root` 里登记过、且值为纯 px 的 `--fs-*`；`var(--fs-body)` 这类别名指针（值是 `var(...)`）不递归，仍返回 `null` → 按正文 4.5 从严。`var(--fs-xl)` 未登记 → 同样从严。`tests/contrastAudit.test.js` 锁住这条边界。

### 迁移残留清单（已知且刻意）

| 残留 | 位置 | 理由 |
| --- | --- | --- |
| `16px !important` 字面量 | `style.css` `@media (pointer: coarse)` | iOS 防缩放，测试锁死 |
| `clamp`/`max`/`min` 字号 | FocusPanel / TodayView 等时钟 | 可证下界审计需要字面量 |
| `0` / `inherit` / `calc()` 圆角 | 各处 | 零值或计算式无对应刻度 |
| `0 0 var(--radius-10)` 中的 `0` | App / ActionSheet 底角 | 多角值的零分量保持字面量 |

## 4. 其他令牌

| 类别 | 令牌 |
| --- | --- |
| 圆角 | `--card-radius` 14px、`--radius-s` 9px（完整刻度见 §3） |
| 触控 | `--tap-min` 44px（`@media (pointer: coarse)` 下作为最小命中高度） |
| 焦点 | `--focus-solid`、`--focus-halo`、`--focus-width` 2px、`--focus-offset` 2px |
| 字体 | `--fs-page-title` 23px（`.page-title`）、`--fs-body` 14px（表单控件与 `.btn`）、`--fs-aux` 12.5px（`.page-desc`）；完整 `--fs-*` / `--fw-*` 刻度见 §3 |
| 阴影 | `--shadow-sm`、`--shadow-md` |

### 为什么这里少了几个令牌（历史说明，阶段 4 后语义已变）

`--radius-m`（12px）、`--fs-module-title`（17px）、`--fs-card-title`（15px）、`--fs-num-hero`、`--fs-num-big`（28px）曾经定义在 `:root` 里，但全仓没有任何一处 `var()` 引用，属于「定义了却没人消费」，曾被删除。**阶段 4 全量迁移后**，12px / 15px / 17px 已重新以刻度形式出现在 §3（`--radius-12`、`--fs-15`、`--fs-17` 等），并由真实 `var()` 消费者撑着；语义别名（模块标题 / 卡片标题）仍未重建——等组件侧真的要统一到某一语义档时，把别名与消费者一起加回来。`--fs-num-hero` 与 `--fs-num-big` 的 `clamp()` 写法保持字面量（见 §3 例外）。

### `--success` / `--warning` 为什么不在 `theme.js` 的调色板里

`--primary` / `--danger` 等由 `theme.js` 在运行时写入内联样式，因为每一套具名主题（紫/绿/粉/自定义）都要换一个值。`--success` / `--warning` 不需要：**深色主题只由「跟随系统 + 系统偏好为深色」这一个分支产生**（`theme.js` 里 `dataset.theme` 只在那处被设成 `'dark'`，具名主题与自定义主题都是浅色），所以只要 `:root` 给浅色值、`:root[data-theme='dark']` 给深色值就够了，不必在四套调色板里各抄一份。

**但目前没有 `--on-success` / `--on-warning`。** 深色的 `--success` 是**亮**绿（`#4ecfa4`），白字在上面只有约 2:1。所以把 `--success` 当**实心底**用（`background: var(--success); color: #fff`）在深色主题下是不达标的；这类位置要么保持原来压深的写死底色（例如侧滑的 `#0f7a58` 配白字 5.3:1），要么先补 `--on-success` 再改。`--success` / `--warning` 的定位是**文字色**。

### `--ink-faint` 不要压在语义色浅底上

四档文字令牌的强弱是 `--text` > `--muted` > `--ink-soft` > `--ink-faint`，但它们**能承受的底色不一样**。`--ink-faint` 是最弱一档，余量最小：深色 `#8290a8` 在 `--card`（`#1b2233`）上只有 **4.92:1**（余量 0.42），底一旦被语义色提亮就击穿：

| 文字 | 底 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--ink-faint` | `--card` | 5.20 | 4.92 |
| `--ink-faint` | 语义色 6% 混 `--card` | 4.78 | **4.40** |
| `--ink-faint` | 语义色 10% 混 `--card` | 4.50 | **4.05** |
| `--muted` | 语义色 10% 混 `--card` | **4.31** | **4.34** |
| `--ink-soft` | 语义色 10% 混 `--card` | 5.44 | 6.91 |

结论：**语义色浅底（半透明状态卡、`color-mix(… 10%, var(--card))` 区块）上的次级文字用 `--ink-soft`**，不要用 `--ink-faint`，也不要指望 `--muted`（它在 10% 底上比 `--ink-faint` 还差）。`--muted` 只适合 ≤6% 的极浅底——这正是同一批迁移里凡容器内还有 `var(--muted)` 正文的表面都只用 6% 混合、而只有 `--ink-soft` 才敢用 10% 的原因。三档语义底的这两个比例已经进 `npm run audit:contrast`（`--muted` @6%、`--ink-soft` @10%），改比例会被立刻拦下。

`TaskProgress.vue` 的 `.is-completed` / `.is-warning` 就是这么处理的：整卡改成 10% 语义浅底后，卡内 `.task-progress-head span` 与 `.task-activity span` 从 `--ink-faint` 换成 `--ink-soft`。

### 具名主题的颜色来自 `style.css`，不是 `theme.js` 的 `THEMES`

`theme.js` 里那张 `THEMES = { blue: { primary: '#456fe8' }, purple: …, green: { primary: '#0ea271' }, pink: … }` **不是** CSS 令牌的来源。运行时具名主题走 `theme.js` 的 `else` 分支：只设 `root.dataset.theme = key` 并 `clearThemeVariables()`，颜色**全部由 `style.css` 的 `:root[data-theme='…']` 块提供**；`THEMES[*].primary` 只用来写 `<meta name="theme-color">`（状态栏颜色）。两者数值本来就不同（例如绿主题 CSS 里是 `#0a7a54`、`THEMES.green.primary` 是 `#0ea271`）。

**所以：核对具名主题的对比度时，取 `style.css` 的值。** 拿 `THEMES[*].primary` 去算会得出一批不存在的失败组合（曾经据此误判「四个主题的幽灵按钮都不达 AA」，实际六个主题都是 4.72–5.22 全部达标）。`tests/contrastAudit.test.js` 现在有一条断言同时锁住「三个具名主题的 `--primary`/`--primary-soft` 各不相同且等于 `style.css` 里的写定值」和「别把 meta 色当令牌」，就是为了防这两件事。

## 5. 新增或修改令牌的检查清单

1. **运行时写入的变量必须登记。** `theme.js` 的 `THEME_VARIABLES` 列表决定切换主题时清理哪些内联变量。新增一个由 `theme.js` 在运行时设置的变量却忘了登记，就会在"深色 → 自定义主题"这类切换中残留上一套主题的值。注：只写在 `style.css` 的 `:root` / `:root[data-theme='dark']` 里的令牌（如 `--success`）不在此列，因为它们从不写内联样式。
2. **五套调色板一起改。** 默认、紫、绿、粉、高对比度（外加深色的 `theme.js` 分支）。`npm run audit:contrast` 会一次性核对，它现在也会把「语义色文字 / 语义色浅底（`color-mix` 混色）」算进去。
3. **实底文字用 `--on-*`。** 不要在按钮上写死 `#fff`。
4. **不要新增未登记的 `sl_*` 键。** 新的用户偏好应放在自己的键里，不要往 `sl_appearance` 里塞字段——那个对象会被整对象比对与归一化写回，已有测试断言它保持原样。
5. **令牌必须带一个真实消费者。** 只声明不消费的令牌已经全部清理过一轮。`tests/styleHooks.test.js` 会断言 `src/style.css` 与 `src/composables/theme.js` 里声明的每个 `--*` 都被 `var(--*)` 读到、或被 `setProperty('--*')` 写到，例外清单为空——所以新增令牌时请连同第一个消费者一起提交，不要「先把令牌铺好」。
6. **跑 `npm run check`。** 它会执行 `audit:contrast` 之外的全部门禁（lint / typecheck / test / build）；对比度由测试套件内的 `tests/contrastAudit.test.js` 覆盖。
7. **改 `:root[data-theme='…']` 时不要写成单行规则夹在别的主题块之间。** `scripts/audit-contrast.mjs` 按花括号配对提取主题块，但历史上它用过「找第一个换行+`}`」的写法，被 `style.css` 顶部那组 `:root[data-theme='purple'] { --focus-solid: … }` 单行规则骗过一次——查 green/pink 时捕获到了 purple 的块，导致绿/粉两套调色板长期没被审计。现在解析器已改成配对 + 级联合并，但把单行规则紧挨着多行主题块放仍然是易碎写法。
