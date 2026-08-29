# 学习生活台(STUDY & LIFE)

个人的学习生活管理 PWA:课程表、作业待办、考试倒计时、生活清单、固定账单、今天吃什么,数据默认全部保存在本机。

## 功能

- **今日总览**:问候语、下一节课、今日待办、今天课程、近期提醒、本周统计、近期账单,模块可拖拽排序
- **课程表**:多校区 × 作息季 × 自定义节次,支持课表模板、周次筛选(单双周)、批量导入、文本/图片 OCR 识别
- **作业与待办**:优先级、课程关联、截止提醒、预计时长、每周重复;粘贴老师通知自动解析出日期时间和标题(纯本地解析)
- **倒计时**:分类、置顶、年度重复、精确到分钟,学习类可关联课程与复习进度
- **我的清单**:多清单管理、购物分类与单价统计
- **固定账单**:订阅/缴费周期换算月成本,临近支付提醒;附随手记账与月度回顾
- **今天吃什么**:地点库 + 随机/转盘挑选,预算与时长过滤、暂时不吃(次日自动恢复)
- **个性化**:主题色、本地壁纸(压缩 + 自动取色)、励志语、页面皮肤、减少动态效果

## 数据与隐私

- 核心数据仅保存在当前浏览器(localStorage),**不会主动上传任何服务器**
- IndexedDB 保存一份设备内影子副本,localStorage 意外丢失时可自动恢复;壁纸图片在本机压缩后存入 IndexedDB
- 数据迁移:
  - **JSON 备份文件**(可携带壁纸)
  - **二维码迁移**(AES-GCM 加密 + gzip,设备间扫码直传)
  - 跨标签页实时同步(storage 事件)
- **云同步(可选)**:通过 Cloudflare Pages Functions + Durable Objects 中转,6 位连接码配对设备;同步**严格手动**——只有你点击「推送到云端」/「从云端拉取」才会传输,带 revision 冲突保护,数据在设备上加密后再发送

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 本地开发
npm run build     # 生产构建(dist/)
npm run preview   # 预览构建产物
npm run lint      # ESLint 检查
npm run test      # Vitest 单元测试
npm run typecheck # vue-tsc 类型检查
npm run check     # 发布前全量门禁:lint + typecheck + test + build
npm run release:bump -- --notes "本次说明一|说明二"   # 自动更新版本说明与源码签名
```

发布说明与构建联动:`release.config.js` 里保存版本与说明,`vite.config.js` 会校验源码签名,业务源码变化后必须更新说明(用 `release:bump` 自动完成)。

## 部署

Cloudflare Pages:

```bash
npx wrangler pages deploy dist --project-name=study-life --branch=main
```

- PWA 由 vite-plugin-pwa 生成,service worker 自动更新
- `functions/`(云同步 API)与 `sync-coordinator/`(Durable Object)随 Pages 一起部署,`wrangler.jsonc` 已配置绑定
- `*.study-life.pages.dev` 预览地址会自动重定向回正式域名,避免多来源数据隔离

## CI

GitHub Actions 在 `main` 分支的 push / PR 上自动运行 `npm run check`(lint、类型检查、单元测试、生产构建)并上传 `dist` 产物,保证发布前质量门禁必过。

## 技术栈

Vue 3(`<script setup>`)· Vue Router · Vite · vite-plugin-pwa · tesseract.js(本地 OCR)· Cloudflare Pages Functions · Durable Objects