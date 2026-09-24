<div align="center">

# 学习生活台

### 把课程、待办、专注和日常记录放在同一条行动线上

一个面向个人使用的 Local-first 学习生活工作台：打开就能看今天要做什么，想到什么可以快速记下，课程表可以从图片或 Excel 直接导入。

[🌐 在线体验](https://study-life.pages.dev/) · [📦 GitHub](https://github.com/huadeng0830-gg/study-life)

![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-可安装-5a0fc8?logo=pwa&logoColor=white)
![CI](https://github.com/huadeng0830-gg/study-life/actions/workflows/ci.yml/badge.svg)

</div>

> 记录一次，课程、任务、账单和回顾页面都会沿着同一份数据更新。

## 30 秒了解

| 问题 | 学习生活台的处理方式 |
| --- | --- |
| 今天有哪些课和任务？ | 首页聚合当天课程、待办、日程、账单和近期节点。 |
| 拿到新课表怎么录入？ | 支持粘贴文字、上传图片 OCR，或直接上传 XLS/XLSX/CSV/ODS 课程表；解析后先预览确认。 |
| 收到一条群通知怎么办？ | 粘贴后先识别类型、标题、行动和关键时间，再按待办、作业、日程或仅保存通知处理；所有结论都可快速修改。 |
| 临时想到一件事怎么办？ | 使用 `＋ 记录` 或 `Ctrl/Cmd + K`，输入一句话生成可编辑草稿。 |
| 想开始复习但没有计划？ | 从倒计时或待办进入专注计时，并记录实际专注时长。 |
| 换设备会丢数据吗？ | 可导出 JSON、使用加密二维码迁移，也可以手动选择云端推送或拉取。 |

## 项目预览

当前仓库没有提交经过脱敏处理的真实界面截图，因此 README 不使用示意图或 AI 生成图。后续建议补充以下 4 张截图：

1. 今天页（桌面端，展示课程、待办和提醒）
2. 课程表（校区 / 作息季切换，以及 Excel 导入预览）
3. 快速记录（手机端，展示自然语言和语音输入）
4. 数据管理（JSON 备份、二维码迁移、手动同步）

## 为什么做它

课程群通知、作业截止时间、消费记录和考试日期通常散落在不同应用里。学习生活台把这些高频信息放进一个个人工作台：

```text
捕获 → 识别 → 确认 → 关联 → 安排 → 执行 → 回顾
```

它不是要替代所有工具，而是减少“记过但没安排”“课表和待办脱节”这类日常摩擦。

## ✨ Highlights

- **学习与生活一体化**：课程、作业、日程、考试、账单和清单共用一套数据关系。
- **Local-first**：无需账号即可开始；核心数据保存在浏览器本地，并有 IndexedDB 设备内副本。
- **自然语言快速录入**：一句“周五交高数作业”或“午饭 18 元”即可生成可修改的结构化草稿。
- **通知理解与处理**：粘贴通知后展示“这是什么 / 讲什么 / 需要做什么 / 什么时候”，动态隐藏空字段；会议、考试、作业、缴费和普通公告分别推荐日程、作业、待办或仅保存。
- **课程表导入更灵活**：图片 OCR、框选裁切、批量文字和 Excel 一键导入均提供确认预览，不直接覆盖正式数据。
- **可配置的校园时间**：支持校区、作息季、自定义节次、单双周、学期模板和特殊日期。
- **移动端优先**：手机底部导航、`＋记录` Bottom Sheet、Safe Area 和桌面侧栏分别优化。
- **同步由用户掌控**：云同步是可选的手动能力，推送、拉取和冲突方向都需要明确确认。

## 🧩 核心功能

### 今天与学习管理

- 首页显示正在进行 / 即将开始的课程、当天待办、日程、固定账单和考试节点。
- 课程表支持编辑、批量录入、Excel 导入、单双周、例外日期、校区和作息季切换。
- 作业与待办支持课程关联、截止日期、优先级、预计时长、重复规则和通知粘贴解析。
- 倒计时可关联课程或节点，并快速生成复习待办。

### 快速记录与智能录入

- 文本输入支持待办、作业、日程、支出、收入、固定账单、倒计时和快速笔记。
- 支持中文金额、连续多笔消费、多行输入、剪贴板提示、语音输入和手动编辑。
- 通知粘贴解析支持乱序日期 / 时间 / 地点 / 动作，区分发布日期与截止日期，先预览确认，并始终保留原始通知。
- 通知确认页默认是阅读模式：关键事实和“你需要做什么”可点击修改，低频信息与原文默认折叠；可靠时支持多事项勾选，最终处理方式由用户确认。
- 语音使用浏览器 Web Speech API，转写后复用同一套文本解析链路；浏览器不支持或没有权限时，仍可使用键盘输入。
- 解析结果先作为草稿展示；无法确定类型时会保留原文，避免输入丢失。

### OCR 与 Excel 课程表

- 课表 / 作息图片在本机通过 Tesseract.js 识别，不把图片上传到服务器。
- 课表识别会分析表格布局，支持长截图、增强识别、按星期复核，以及单张图片框选裁切后重试。
- 直接上传 XLS、XLSX、CSV 或 ODS 后，解析器可识别“课程名称 / 星期 / 节次”清单，也可识别按星期排布的网格课表。
- 所有导入结果都会进入预览、冲突检查和人工确认流程，确认后才写入课程数据。

### 生活记录与回顾

- **账本**：支出、收入、分类、账户、日 / 月统计和固定账单；支付账单会生成关联交易并推进下一期。另有**多币种与汇率换算**（缺少汇率时明确提示，不按 1:1 静默计入）、**月度预算与超支提示**、**退款分摊**与**账单模板**。
- **清单**：购物和生活事项，可记录价格、完成状态和备注。
- **专注**：常用时长、自定义时长、完成提醒、待办关联和专注记录。
- **回顾**：按日、月、年汇总课程、待办、收支、日程、笔记、心情和节点。

### 数据管理与个性化

- JSON 备份与恢复，支持可选携带本地壁纸。
- 加密二维码在设备之间迁移数据，可选择合并或覆盖。
- 可选的多设备云同步：用户创建或加入同步空间后明确确认；设备端加密、版本元数据、冲突保护和撤销上次拉取均保留。
- 主题色、页面壁纸、首页模块、课表皮肤、节日氛围和手机左右滑动操作均可配置；**节日与纪念日支持农历（含闰月）**，回顾叙事文案可切换语言。
- PWA 可安装到桌面或手机主屏，并支持应用内检查更新。
- 更新说明按版本首次打开时提示一次；确认后不重复打扰，这是当前版本的设计行为。

## 🔐 Data & Privacy

- **默认不需要账号**：课程、待办、账本、设置和识别结果都可以只留在当前设备。
- **本地存储**：业务数据写入 `localStorage`，同时镜像到 IndexedDB；壁纸等较大资源也保存在本机。
- **备份优先**：清理浏览器数据、删除 iOS 桌面应用或更换设备前，建议先导出 JSON 或完成迁移。
- **云同步可选且需确认**：用户创建或加入同步空间并确认后，才会建立绑定；确认后可开启自动同步，联网时设备端加密数据会在已绑定设备之间同步，不会静默建立长期上传。同步前在浏览器端使用 PBKDF2 + AES-256-GCM 加密；服务端保存的是密文和版本元数据。
- **OCR 本地完成**：课表图片和作息图片不上传服务器。
- **仓库不收集用户数据**：运行时的 `sl_*` 本地数据、JSON 备份、账单、课程表、访问码、日志、缓存和构建产物均不应提交；提交前请检查 `git status` 和暂存区。

## 📱 桌面端与移动端

| 桌面端 | 移动端 |
| --- | --- |
| 完整侧栏、快捷键、宽表格预览 | 固定底部导航、居中的 `＋记录`、Bottom Sheet |
| 课程、待办、账本等页面保持多列布局 | 低频入口收进“更多”，表格预览转为卡片 |
| 大模块按需加载，减少首屏负担 | Safe Area、键盘区域和触控反馈单独处理 |

## 🛠 技术栈

| 层次 | 实际使用 |
| --- | --- |
| 前端 | Vue 3、Vue Router、`<script setup>` |
| 构建与 PWA | Vite 8、vite-plugin-pwa |
| 本地数据 | `localStorage` + IndexedDB 镜像 |
| OCR | Tesseract.js + `chi_sim` 语言模型 + Canvas 预处理 |
| Excel 解析 | `@e965/xlsx`，支持 XLS/XLSX/CSV/ODS 输入 |
| 质量检查 | ESLint、vue-tsc、Vitest、Vite production build |
| 可选同步 | Cloudflare Pages Functions、KV、Durable Objects、Web Crypto |

## 📁 项目结构

```text
study-life/
├─ src/
│  ├─ views/                 # 首页、课程表、待办、倒计时、清单、账本
│  ├─ components/            # 通用面板、弹窗、快速记录、导入与设置
│  ├─ composables/
│  │  ├─ domain/             # 关系、状态、提醒和领域选择器
│  │  ├─ quickRecord/        # 自然语言解析与快速记录适配器
│  │  └─ store/              # 响应式本地存储、课表与作息配置
│  ├─ types/                 # 领域类型定义
│  └─ main.js                # 应用启动、路由和数据恢复
├─ functions/api/            # Cloudflare Pages API：验证、推送、拉取
├─ sync-coordinator/         # Durable Object 同步协调器
├─ public/ocr/               # 本地 OCR 语言模型
├─ tests/                    # 解析、导入、同步、迁移和业务逻辑测试
├─ wrangler.jsonc            # Pages、KV 与 Durable Object 配置
└─ .github/workflows/ci.yml  # main 分支的质量检查
```

## 🚀 本地运行

```bash
git clone https://github.com/huadeng0830-gg/study-life.git
cd study-life
npm install
npm run dev
```

常用命令：

```bash
npm run lint       # ESLint
npm run typecheck  # Vue/TypeScript 类型检查
npm test           # Vitest
npm run build      # 构建到 dist/
npm run check      # lint + typecheck + test + build
npm run preview    # 预览生产构建
```

## ☁️ 部署到 Cloudflare Pages

静态页面可以直接发布 `dist/`。若要启用手动云同步，还需要在 Cloudflare 项目中配置 `wrangler.jsonc` 里的 KV 与 Durable Object 绑定。

```bash
npx wrangler login
npm run build
npx wrangler pages deploy dist --project-name=study-life --branch=main
```

仓库的 CI 会在 `main` 的提交和 Pull Request 上执行 lint、类型检查、测试和生产构建。

## 🧪 发布自检（scripts/audit/）

四个脚本只依赖 Node 内置模块和本机 Chrome，用来守住 PWA 最容易出问题的一环：**启动资源不完整**。
历史上出现过一次线上故障——某个懒加载分包 404，Service Worker 拿着旧入口、CDN 只剩新资源，
应用「清缓存 → 注销 SW → 重载」一路循环，手机端表现为打不开、一直在刷新首页。
下面三个自检分别从资源、行为、回归三个角度盯住这件事。

还有一类故障只有手机浏览器会踩：**iOS Safari 缺失的 Web API**。2026-09-20 的线上故障就是
`src/main.js` 在启动路径里裸调 `requestIdleCallback`（iOS 17.4 以前完全没有这个 API），
`ReferenceError` 被当成启动失败，最终弹出「页面没有完整加载」，而电脑端一切正常——
`audit:iphone-boot` 专门守这一类。

```bash
npm run audit:release       # 1. 线上资源图是否完整
npm run audit:first-visit   # 2. 全新用户首访会不会反复刷新
npm run audit:reload-loop   # 3. 分包 404 时还会不会无限刷新（回归闸门）
npm run audit:iphone-boot   # 4. iPhone Safari（没有 requestIdleCallback）首屏能不能打开
```

| 脚本 | 回答什么问题 | 什么时候用 |
| --- | --- | --- |
| `scripts/audit/release-integrity.mjs <baseUrl>` | 已部署站点的 `index.html` 引用、**所有 JS 内部出现的 `assets/xxx-hash.js\|css`（懒加载分包名只写在 JS 里，最容易漏）**、以及 `sw.js` 的 workbox 预缓存清单条目，是否都能返回 200 | 每次发布后对着线上地址跑一次；发布前也可以指向本地预览地址 |
| `scripts/audit/first-visit.mjs [url] [seconds] [windowSize]` | 一个全新 profile（无缓存、无 SW）打开线上地址，**主框架导航了几次**、有没有 console error / 未捕获异常 / 网络错误 | 改动启动流程或 SW 之后，在真机之前先量一次 |
| `scripts/audit/reload-loop.mjs <distDir> [brokenChunkPattern]` | 故意让 `dist` 里某个分包（默认 `TodayView`）404，用户会经历几次页面加载、最终看到的是失败界面还是白屏/永久骨架屏 | 每次改动启动恢复、更新流程或 SW 策略时跑一次，防回归 |
| `scripts/audit/iphone-boot.mjs [url] [seconds]` | 在 iPhone 视口里**删掉 `requestIdleCallback`**（模拟 iOS Safari）**并把钟点钉在晚上 20 点**，首屏还能不能挂上来、会不会出现「页面没有完整加载」；`--hour=N` 可换时段、`--keep-idle-callback` 作为对照 | 改动 `src/main.js` 的启动路径、预热或更新检查时跑一次 |

**RED 意味着什么**

- `audit:release` RED：有资源返回非 200（输出 JSON 里的 `missing` 会给出路径、状态码和「被谁引用」），
  或者 `sw.js` 的预缓存清单解析出 0 条——后者说明这项检查本身失效了，一样按 RED 处理。
  此时不要发布：分包 404 就是上面那个无限刷新故障的直接触发条件。
- `audit:first-visit` RED：全新用户首访的主框架导航 > 2 次（正常应为 1 次），说明页面已经在自己刷新。
- `audit:reload-loop` RED：分包 404 时页面加载次数 > 4（正常约 2 次：首访一次 + 一次受控恢复重载），
  或者刷不出来了却看不到「页面没有完整加载 / 重新加载」这类可操作提示（白屏或永久骨架屏，同样算没修好）。
- `audit:iphone-boot` RED：缺 `requestIdleCallback` 的浏览器里首屏没挂上来，
  或出现了 `main.startup-error`（致命错误页）。先查启动路径里有没有未守卫的 Web API 调用——
  这类缺陷在桌面 Chrome 上永远不会复现，必须靠这个装置兜住。

退出码统一为：`0` = GREEN，`1` = RED，`2` = 环境/装置问题（例如找不到 Chrome、`dist` 不存在、分包名匹配不到）。
stdout 始终是一段稳定 JSON（含版本号、各项检查条数、缺失明细），便于后续接进自动化；进度和结论摘要走 stderr。

**已知限制**

- 需要本机安装 Chrome；可用 `CHROME_PATH` 指定，脚本也会在 Windows/macOS/Linux 的常见路径里自动探测，找不到会明确报错而不是静默跳过。
  两个浏览器脚本会真的把页面跑一遍，单个脚本需要十几秒到一分钟，因此不适合放进 `npm run check` 或 CI——
  CI 里没有 Chrome，也不该让发布门禁依赖浏览器行为。
- `reload-loop` 依赖产物结构（`assets/` 目录、`index.html` 里的 `<head>`、失败界面文案），
  如果这些结构变了，脚本会报 `SETUP_FAILED` 而不是给出误导性的 GREEN。
- 临时文件全部放在系统临时目录，脚本结束会关闭本地服务、结束 Chrome 进程树并删除临时目录；
  设 `AUDIT_KEEP_TEMP=1` 可保留现场（会打印目录路径）用于复盘。

## 🗺 Roadmap

- [x] 今日页、课程表、作业与待办、倒计时、账本和清单
- [x] 本地 OCR、课表裁切复核、Excel 课程表导入与冲突预览
- [x] 本地备份、二维码迁移、PWA 和可选手动云同步
- [ ] 🚧 补充脱敏后的真实产品截图与演示数据
- [ ] 🚧 针对更多教务系统版式补充 OCR 回归样例和浏览器端测试

## 许可证

当前仓库未发现 `LICENSE` 文件，许可证类型待项目维护者决定。

## 反馈与贡献

欢迎提交 Issue 或 Pull Request。涉及数据结构、导入规则或同步协议的改动，请附上复现步骤和兼容策略；不要提交真实课程表、账单、访问码、JSON 备份或其他个人隐私数据。
