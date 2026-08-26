# 学习生活台(STUDY & LIFE)

个人的学习生活管理 PWA:课程表、作业待办、考试倒计时、生活清单、固定账单、今天吃什么,全部数据保存在本机。

## 功能

- **今日总览**:问候语、成长等级、本周统计、下一节课、近期倒计时,模块可拖拽排序
- **课程表**:多校区 × 作息季 × 自定义节次,支持课表模板、周次筛选(单双周)、批量导入
- **作业与待办**:优先级、课程关联、截止提醒;粘贴老师通知自动解析出日期时间和标题(纯本地解析)
- **倒计时**:分类、置顶、年度重复、精确到分钟
- **我的清单**:多清单管理、购物分类与单价统计
- **固定账单**:订阅/缴费周期换算月成本,临近支付提醒
- **今天吃什么**:地点库 + 随机/转盘挑选,预算与时长过滤
- **个性化**:主题色、本地壁纸(压缩 + 自动取色)、励志语、页面皮肤

## 数据与隐私

- 所有数据仅保存在当前浏览器(localStorage),**不上传任何服务器**
- IndexedDB 保存一份设备内影子副本,localStorage 意外丢失时可自动恢复
- 壁纸图片在本机压缩后存入 IndexedDB,不占 localStorage 配额
- 数据迁移:
  - **JSON 备份文件**(可携带壁纸)
  - **二维码迁移**(AES-GCM 加密 + gzip,设备间扫码直传)
  - 跨标签页实时同步(storage 事件)

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 本地开发
npm run build     # 生产构建(dist/)
npm run preview   # 预览构建产物
npm run lint      # ESLint 检查
npm run test      # Vitest 单元测试
```

## 部署

Cloudflare Pages:

```bash
npx wrangler pages deploy dist --project-name=study-life --branch=main
```

PWA 由 vite-plugin-pwa 生成,service worker 自动更新;`*.study-life.pages.dev` 预览地址会自动重定向回正式域名,避免多来源数据隔离。

## 技术栈

Vue 3(`<script setup>`)· Vue Router · Vite · vite-plugin-pwa · 无后端
