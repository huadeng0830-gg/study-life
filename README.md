<div align="center">

# 三两事

### 把课程、待办、专注和日常记录放在同一条行动线上

一个面向个人使用的 Local-first 学习生活工作台：打开就能看今天要做什么，想到什么可以快速记下，课程表可以从图片或 Excel 直接导入。

[🌐 在线体验](https://study-life.pages.dev/) · [📦 GitHub](https://github.com/huadeng0830-gg/study-life)

<!-- RELEASE_STATUS:START -->
> **当前源码版本**：网页 / PWA `2026年10月10日-版本3` · Windows 桌面版 `1.0.16`
> **最近更新**：
> - 修复页面尚在加载时快速切换导航导致的渲染异常，保留页面切换动效与缓存
> - 补充真实浏览器回归，校验模块在页面退场时完成加载以及返回缓存页面
> [下载已发布的 Windows 安装包与版本说明](https://github.com/huadeng0830-gg/study-life/releases/latest)
<!-- RELEASE_STATUS:END -->

本轮上线范围为网页 / PWA 与云端服务，Windows 安装包发布已取消；上面的桌面版本号表示源码版本。

![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-可安装-5a0fc8?logo=pwa&logoColor=white)
![CI](https://github.com/huadeng0830-gg/study-life/actions/workflows/ci.yml/badge.svg)

</div>

> 记录一次，课程、任务、账单和回顾页面都会沿着同一份数据更新。

## 30 秒了解

| 问题 | 三两事的处理方式 |
| --- | --- |
| 今天有哪些课和任务？ | 首页聚合当天课程、待办、日程、账单和近期节点。 |
| 拿到新课表怎么录入？ | 支持粘贴文字、上传图片 OCR，或直接上传 XLS/XLSX/CSV/ODS 课程表；解析后先预览确认。 |
| 收到一条群通知怎么办？ | 粘贴后先识别类型、标题、行动和关键时间，再按待办、作业、日程或仅保存通知处理；所有结论都可快速修改。 |
| 临时想到一件事怎么办？ | 使用 `＋ 记录` 或 `Ctrl/Cmd + K`，输入一句话生成可编辑草稿。 |
| 想开始复习但没有计划？ | 从倒计时或待办进入专注计时，并记录实际专注时长。 |
| 换设备会丢数据吗？ | 登录同一账号自动同步，也可导出 JSON 文件备份与恢复。 |

## 项目预览

当前仓库没有提交经过脱敏处理的真实界面截图，因此 README 不使用示意图或 AI 生成图。后续建议补充以下 4 张截图：

1. 今天页（桌面端，展示课程、待办和提醒）
2. 课程表（校区 / 作息季切换，以及 Excel 导入预览）
3. 快速记录（手机端，展示自然语言和语音输入）
4. 数据管理（JSON 备份、账号自动同步与恢复）

## 为什么做它

课程群通知、作业截止时间、消费记录和考试日期通常散落在不同应用里。三两事把这些高频信息放进一个个人工作台：

```text
捕获 → 识别 → 确认 → 关联 → 安排 → 执行 → 回顾
```

它不是要替代所有工具，而是减少“记过但没安排”“课表和待办脱节”这类日常摩擦。

## ✨ Highlights

- **学习与生活一体化**：课程、作业、日程、考试、账单和清单共用一套数据关系。
- **Local-first**：无需账号即可开始；核心数据保存在浏览器本地，并有 IndexedDB 设备内副本。
- **可选邮箱账号**：桌面侧栏或手机“更多”中可注册、登录、找回与修改密码；账号概览展示邮箱与同步状态，退出前确认本机数据清理；账号由 Supabase Auth 管理，登录后自动合并同步记录，离线时继续本机使用。
- **自然语言快速录入**：一句“周五交高数作业”或“午饭 18 元”即可生成可修改的结构化草稿。
- **通知理解与处理**：粘贴通知后展示“这是什么 / 讲什么 / 需要做什么 / 什么时候”，动态隐藏空字段；会议、考试、作业、缴费和普通公告分别推荐日程、作业、待办或仅保存。
- **课程表导入更灵活**：图片 OCR、框选裁切、批量文字和 Excel 一键导入均提供确认预览，不直接覆盖正式数据。
- **可配置的校园时间**：支持校区、作息季、自定义节次、单双周、学期模板和特殊日期。
- **移动端优先**：手机底部导航、`＋记录` Bottom Sheet、Safe Area 和桌面侧栏分别优化。
- **账号自动同步**：登录同一账号即可同步；内容冲突时暂停并确认，退出前可导出备份，确认退出后清除当前设备的业务数据。

## 🧩 核心功能

### 今天与学习管理

- 首页显示正在进行 / 即将开始的课程、当天待办、日程、固定账单和考试节点。
- 课程表支持编辑、批量录入、Excel 导入、单双周、例外日期、校区和作息季切换。
- 学习入口首先显示课表，课程卡片提示待办与逾期；点击课程可查看进度、记录作业或考试、准备任务专注。
- 课表下方的学习安排默认收起，按课程和日程空档安排今天、明天或自选日期的任务，支持冲突复核、加入日程、撤回与撤销。
- 作业与待办支持课程关联、截止日期、优先级、预计时长、重复规则和通知粘贴解析。
- 倒计时可关联课程或节点，并快速生成复习待办。
- 专注带入原任务与下一步，确认后开始计时；结束后回写实际时长，并可记录做到哪里、下次继续什么。

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
- **清单**：购物、出行和生活事项，支持常用模板、多行批量添加、搜索分类、排序和批量管理；可记录数量、单价与预算，复制或重置清单再次使用，并撤销删除、导出文本。
- **专注**：常用时长、自定义时长、完成提醒、待办关联和专注记录。
- **回顾**：按日、月、年汇总课程、待办、收支、日程、笔记、心情和节点。

### 齐行项目协作

- 项目数据模型、权限边界和发布步骤见[项目协作文档](docs/project-collaboration.md)。
- 创建小组项目、邀请成员或生成可撤销的限额邀请链接，并处理加入申请。
- 项目内支持任务分派、截止日期、优先级、依赖关系、里程碑和协作动态。
- 交付项支持草稿、版本提交、清单验收与反馈；必需成果通过验收后才允许完成关联任务。
- 会议可邀请项目成员、收集回应、提出改期，并在符合成员共同空闲时确认；已确认会议会进入个人日程。
- 项目数据由 Supabase `campus-social` Edge Function 按登录身份处理；项目表启用 RLS，服务端 RPC 校验成员权限。成果文件存入私有 Storage bucket，上传与读取均检查项目成员关系。
- 项目协作需要联网及已验证的账号。成员的个人课表、事件和账单不会展示给项目；共同空闲只返回可约时段。

### 数据管理与个性化

- JSON 备份与恢复，支持可选携带本地壁纸。
- 登录同一账号自动同步课程、待办、账本和笔记，支持离线修改、冲突确认与账号切换隔离。
- 数据管理只提供本地备份导出、从备份恢复和账号同步。设备码、绑定码、同步空间与二维码迁移已停用。
- 更新后会清除本机保存的旧同步凭据；旧同步空间中的远端数据不会由应用自动删除。
- 主题色、页面壁纸、首页模块、课表皮肤、节日氛围和手机左右滑动操作均可配置；**节日与纪念日支持农历（含闰月）**，回顾叙事文案可切换语言。
- 网页 / PWA 版可安装到桌面或手机主屏；Windows 原生桌面版另有安装包，并支持在应用内检查、下载和安装更新。
- 更新说明按版本首次打开时提示一次；确认后不重复打扰，这是当前版本的设计行为。

## 🔐 Data & Privacy

- **默认不需要账号**：课程、待办、账本、设置和识别结果都可以只留在当前设备。
- **本地存储**：业务数据写入 `localStorage`，同时镜像到 IndexedDB；壁纸等较大资源也保存在本机。
- **备份优先**：清理浏览器数据、删除 iOS 桌面应用或更换设备前，建议先导出 JSON 或确认账号同步已完成。
- **登录后自动同步**：账号业务快照经 HTTPS 传输，以 JSON 存储在 Supabase；RLS 限制每个用户只能访问自己的数据。账号同步未实现端到端加密，确认退出会停止同步并清除当前设备的业务记录，已同步的云端记录不会删除。
- **OCR 本地完成**：课表图片和作息图片不上传服务器。
- **仓库不收集用户数据**：运行时的 `sl_*` 本地数据、JSON 备份、账单、课程表、访问码、日志、缓存和构建产物均不应提交；提交前请检查 `git status` 和暂存区。

## 📱 桌面端与移动端

| 桌面端 | 移动端 |
| --- | --- |
| 完整侧栏、快捷键、宽表格预览 | 固定底部导航、居中的 `＋记录`、Bottom Sheet |
| 课程、待办、账本等页面保持多列布局 | 低频入口收进“更多”，表格预览转为卡片 |
| 大模块按需加载，减少首屏负担 | Safe Area、键盘区域和触控反馈单独处理 |

## 🪟 Windows 桌面版

Windows x64 桌面版使用 Electron + NSIS 安装向导。可从 [GitHub Releases](https://github.com/huadeng0830-gg/study-life/releases/latest) 下载已发布安装包，并在向导中选择安装目录，例如 `D:\三两事`。本机资料、登录会话、缓存、更新暂存文件、日志和默认备份跟随所选目录；覆盖安装会保留资料，卸载时默认保留本机数据。

应用启动并联网时会自动检查更新，也可在“设置 → 应用更新”里手动检查。发现新版本后，用户选择下载，再选择重启安装；安装程序沿用原来的安装目录。网页与手机继续使用 Cloudflare Pages 和 PWA 更新流程，桌面发行不会改变在线版本。

应用内更新依赖 GitHub Releases 中同一版本构建生成的 NSIS 安装包、`latest.yml` 和 `.blockmap` 文件。仓库按公开发布配置，客户端不包含发布令牌；如果仓库或发行资产不可匿名访问，应用内检查与下载就无法工作。更新失败时，可先从 Releases 下载完整安装包并覆盖安装。

已安装的 `1.0.3` 版本内嵌的更新源指向一个已不存在的旧发行仓库，因此它无法自动发现新仓库中的版本。请从本仓库 Releases 下载 `1.0.4` 安装包并覆盖安装一次；之后安装的版本会从本仓库检查并应用更新。覆盖安装会保留所选安装目录中的本机资料。

### 从源码构建桌面版

需要 Windows x64、Node.js 22 或更高版本。根目录依赖和 Electron 应用依赖分开锁定；桌面命令会先按 `desktop-app/package-lock.json` 安装生产依赖，再构建安装包。

```powershell
npm ci
npm run desktop:dir       # 生成未安装目录包供预览
npm run desktop:installer # 生成 NSIS 安装程序并校验应用内更新配置
```

### 发布桌面更新

每次新版本先运行 `npm run release:bump -- --notes "更新说明一|更新说明二"`。脚本会递增网页日期版本和 Windows 桌面 SemVer patch，更新源码签名，并同步本 README 中的版本号与最近更新内容。完成 `npm run check`、提交并推送到 `main` 后，为桌面版本创建同名标签（例如 `v1.0.5`）并推送；GitHub Actions 会在 Windows runner 上重跑质量检查，构建并验证 NSIS 安装包，再将安装包、`.blockmap` 和 `latest.yml` 一次发布到同一个 GitHub Release；任一发布文件缺失都会让工作流失败。用户可在桌面版“设置 → 应用更新”内检查、下载并安装新版本。

标签必须与 `desktop-app/package.json` 中的版本完全一致。发布流水线只在收到 `v*` 标签时运行，日常网页部署仍走 Cloudflare Pages；本地构建使用 `--publish never`，不会意外创建公开发行版。README 版本区块由发布脚本维护，`npm run check` 会阻止版本说明漏同步。

## 🛠 技术栈

| 层次 | 实际使用 |
| --- | --- |
| 前端 | Vue 3、Vue Router、`<script setup>` |
| 构建与 PWA | Vite 8、vite-plugin-pwa |
| 本地数据 | `localStorage` + IndexedDB 镜像 |
| OCR | Tesseract.js + `chi_sim` 语言模型 + Canvas 预处理 |
| Excel 解析 | `@e965/xlsx`，支持 XLS/XLSX/CSV/ODS 输入 |
| 质量检查 | ESLint、vue-tsc、Vitest、Vite production build |
| 账号与同步 | Supabase Auth、Postgres、RLS |
| 好友与项目协作 | Supabase Edge Functions、Postgres RPC、私有 Storage |

## 📁 项目结构

```text
study-life/
├─ src/
│  ├─ views/                 # 首页、课程表、待办、倒计时、清单、账本
│  ├─ components/            # 通用面板、弹窗、快速记录、导入与设置
│  ├─ composables/
│  │  ├─ accountSyncSchema.js # 账号同步数据结构版本
│  │  ├─ domain/             # 关系、状态、提醒和领域选择器
│  │  ├─ quickRecord/        # 自然语言解析与快速记录适配器
│  │  └─ store/              # 响应式本地存储、课表与作息配置
│  ├─ types/                 # 领域类型定义
│  └─ main.js                # 应用启动、路由和数据恢复
├─ functions/api/            # 旧设备同步端点统一返回 410
├─ desktop-app/              # Electron 主进程、preload 与独立生产依赖
├─ desktop/                  # Windows 图标、NSIS 安装向导资源
├─ supabase/
│  ├─ functions/campus-social/ # 好友课表与齐行项目协作 API
│  ├─ migrations/            # 账号同步、好友及项目协作数据库结构
│  └─ tests/                 # 数据库安全与同步约束验证
├─ public/ocr/               # 本地 OCR 语言模型 + 引擎（自托管，断网也能识课）
├─ scripts/                  # 发布、审计与质量门禁脚本（含 scripts/audit/ 四个自检）
├─ tests/                    # 解析、导入、同步、迁移和业务逻辑测试
├─ release.config.js         # 更新说明与源码签名（构建闸门会校验）
├─ wrangler.jsonc            # Cloudflare Pages 静态部署配置
└─ .github/workflows/        # Web 质量检查、桌面包校验与 Windows Release 发布
```

## 🚀 本地运行

```bash
git clone https://github.com/huadeng0830-gg/study-life.git
cd study-life
npm install
npm run dev
```

启用注册与账号同步时，将 `.env.example` 复制为 `.env.local`，填写 Supabase 项目 URL 和 publishable key，再重启开发服务。数据库迁移、邮箱验证、SMTP 和 Cloudflare 构建变量的说明见 [账号接入说明](docs/supabase-auth.md)。

> **需要 Node 22 或更高版本。** Node 22 起内置了实验性的 Web Storage 全局，
> 会遮蔽测试环境里 happy-dom 的 `Storage`——这个项目踩过一次，导致约三分之一的
> 用例连带变红。仓库根目录有 `.nvmrc`，CI 也锁在 22。
> 注意 Node 20 与 22+ 的行为**不同**，所以 CI 特意不跑 20。

常用命令：

```bash
npm run lint              # ESLint
npm run typecheck         # Vue/TypeScript 类型检查
npm test                  # Vitest
npm run build             # 构建到 dist/
npm run check             # lint + typecheck + test + build（唯一的完整门禁）
npm run preview           # 预览生产构建
npm run check:release-readme # 检查 README、网页与桌面版本是否同步
npm run desktop:installer # Windows NSIS 安装包（可选安装目录）

npm run release:bump      # 发布必需：改了 src/ 后执行，写更新说明并同步源码签名
npm run typecheck:ratchet # 类型债务棘轮：TS2304 必须为 0，总数不许超基线
npm run typecheck:report  # 类型错误的分布报告（按错误码 / 按文件）
npm run audit:contrast    # 6 套调色板 × 144 组配色 → WCAG AA
npm run deploy:production # 构建并发布 Cloudflare Pages
```

> **发布业务或桌面源码的新版本时必须跑 `npm run release:bump -- --notes "说明|说明"`**，
> 否则生产构建会因源码签名不匹配而失败。发布脚本会把说明和签名一起写好，递增桌面版本并更新 README；
> 对当前版本只修正文案时用 `--amend-notes`，它不会递增桌面版本或创建新发行版。
> 详见 `release.config.js` 顶部注释。

## ☁️ 部署到 Cloudflare Pages

页面可以直接发布 `dist/`。账号同步需要 Supabase 环境变量及数据库迁移，不再需要 Cloudflare KV 或 Durable Object 同步服务。

```bash
npx wrangler login
npm run build
npx wrangler pages deploy dist --project-name=study-life --branch=main
```

> 账号同步直接使用 Supabase。页面部署不需要单独发布同步协调器。
>
> ```bash
> npm run deploy:production
> ```

仓库的 CI 会在 `main` 的提交和 Pull Request 上执行 lint、类型检查、测试、生产构建，
以及类型债务棘轮（`npm run typecheck:ratchet`）。

## 🗄 Supabase 服务端

邮箱账号、自动同步、好友课表与齐行项目协作运行在独立的 Supabase 项目中。数据库结构按时间顺序保存在 `supabase/migrations/`；2026-10-10 生产数据库已应用全部 13 条迁移，包括协作日历与任务依赖约束、成果提交草稿版本校验。Edge Function `campus-social` 当前为 v4，JWT 验证保持开启，同时处理好友和项目操作。

项目协作的 15 张表均开启 RLS，并撤销 `anon` 与 `authenticated` 的表权限；浏览器只能携带登录 JWT 调用 Edge Function，由服务端检查成员角色后使用 `service_role` 访问数据库。成果文件放在私有 `qixing-deliverables` Storage bucket，最大 20 MiB。不要把 `service_role` 密钥写入网页变量、客户端代码或仓库。

首次使用 Supabase CLI 时，先准备有权访问目标项目的账号和数据库密码；`supabase/config.toml` 已保留函数 JWT 设置：

```bash
npx supabase login
npx supabase link --project-ref xyuwjmswqmxfwtyzakan
npx supabase db push
npx supabase functions deploy campus-social --project-ref xyuwjmswqmxfwtyzakan
```

发布顺序是先数据库迁移，再部署 `campus-social`，最后发布 Cloudflare Pages 前端。新的项目协作功能需已验证的邮箱账号和网络连接；开放普通邮箱注册前，还要配置 Supabase Site URL、Redirect URLs 与 SMTP。当前 Supabase Auth 仍提示泄露密码保护未开启；启用该设置需要在项目 Auth 密码安全设置中处理。

## 🧪 发布自检（scripts/audit/）

四个脚本只依赖 Node 内置模块和本机 Chrome，用来守住 PWA 最容易出问题的一环：**启动资源不完整**。
历史上出现过一次线上故障——某个懒加载分包 404，Service Worker 拿着旧入口、CDN 只剩新资源，
应用「清缓存 → 注销 SW → 重载」一路循环，手机端表现为打不开、一直在刷新首页。
下面四个自检覆盖资源完整性、实际启动、故障恢复与缺失 API。

还有一类故障只有手机浏览器会踩：**iOS Safari 缺失的 Web API**。2026-09-20 的线上故障就是
`src/main.js` 在启动路径里裸调 `requestIdleCallback`，而目标 Safari 环境没有这个 API，
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
| `scripts/audit/first-visit.mjs [url] [seconds] [windowSize]` | 一个全新 profile（无缓存、无 SW）按实际布局视口打开地址，检查主框架导航、应用界面挂载、启动占位与错误页、console error / 未捕获异常 / 网络错误 | 改动启动流程或 SW 之后，在真机之前先量一次 |
| `scripts/audit/reload-loop.mjs <distDir> [brokenChunkPattern]` | 故意让 `dist` 里某个分包（默认 `TodayView`）404，用户会经历几次页面加载、最终看到的是失败界面还是白屏/永久骨架屏 | 每次改动启动恢复、更新流程或 SW 策略时跑一次，防回归 |
| `scripts/audit/iphone-boot.mjs [url] [seconds]` | 在 iPhone 视口里**删掉 `requestIdleCallback`**（模拟 iOS Safari）**并把钟点钉在晚上 20 点**，首屏还能不能挂上来、会不会出现「页面没有完整加载」；`--hour=N` 可换时段、`--keep-idle-callback` 作为对照 | 改动 `src/main.js` 的启动路径、预热或更新检查时跑一次 |

**RED 意味着什么**

- `audit:release` RED：有资源返回非 200（输出 JSON 里的 `missing` 会给出路径、状态码和「被谁引用」），
  或者 `sw.js` 的预缓存清单解析出 0 条——后者说明这项检查本身失效了，一样按 RED 处理。
  此时不要发布：分包 404 就是上面那个无限刷新故障的直接触发条件。
- `audit:first-visit` RED：主框架导航不在 1–2 次范围，应用界面未打开，启动占位或错误页仍存在，或有控制台、运行时、网络错误。
- `audit:reload-loop` RED：分包 404 时页面加载次数 > 4（正常约 2 次：首访一次 + 一次受控恢复重载），
  或者刷不出来了却看不到「页面没有完整加载 / 重新加载」这类可操作提示（白屏或永久骨架屏，同样算没修好）。
- `audit:iphone-boot` RED：缺 `requestIdleCallback` 的浏览器里首屏没挂上来，
  出现了 `main.startup-error`（致命错误页），发生异常或进入重载循环。先查启动路径里有没有未守卫的 Web API 调用——
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
- [x] 本地备份与恢复、PWA、邮箱账号与自动同步
- [ ] 🚧 补充脱敏后的真实产品截图与演示数据
- [ ] 🚧 针对更多教务系统版式补充 OCR 回归样例和浏览器端测试

## 许可证

当前仓库未发现 `LICENSE` 文件，许可证类型待项目维护者决定。

## 反馈与贡献

欢迎提交 Issue 或 Pull Request。涉及数据结构、导入规则或同步协议的改动，请附上复现步骤和兼容策略；不要提交真实课程表、账单、访问码、JSON 备份或其他个人隐私数据。
