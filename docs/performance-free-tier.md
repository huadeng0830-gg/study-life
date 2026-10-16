# 免费版加载与请求优化（1.10.1）

本次联合版本包含校园「怎么办」和免费版性能优化。性能部分针对重复打开页面、校园页面反复读取同一数据，以及懒加载分包命中缓存后的额外请求；未增加付费服务或依赖。

## 修改

- 已下载的路由组件同步渲染；只保留组件定义，不额外保留页面表单、监听器和业务状态。
- 从书签进入时，在本机数据准备期间并行下载目标页面。校园页面链接支持聚焦、悬停、按下预热；后台悬停预热保留省流量和弱网检查。
- 校园列表、学校资料和地点目录在当前浏览器内存中复用 15 秒，最多保留 40 个查询。相同查询同时发起时共用一个请求，每个调用方获得独立数据副本。
- 缓存按账号、接口和参数隔离；退出登录、切换账号和提交修改会清除缓存。失败不缓存。账号正常续期继续读取；权限检查、项目工作台和写入不缓存。
- “刷新地点”和“我的投稿 → 刷新”立即绕过缓存。其他用户的变更最多延迟至短时缓存到期；写操作仍由服务端重新核验身份、权限和版本。
- 带内容哈希的静态分包使用 Workbox `CacheFirst`；版本清单继续按已有更新流程检查。
- 公开反馈也按查询参数在内存复用 15 秒，最多 30 个查询；写入、点赞和管理操作清除本机缓存，主动刷新绕过本机缓存。Worker 原有 15 秒共享缓存仍独立生效。
- 健康同步合并焦点/可见性重复唤醒；下一次轮询从上次检查完成后计时。本机修改、主动同步和断网恢复保持原有调度。
- 校园 Edge Functions 的预检响应设置 7200 秒复用时间，实际时长受浏览器限制；响应数据及鉴权规则不因此公开缓存。业务请求最多等待 30 秒，不自动重发写入。
- 「怎么办」概览从 5 个前端请求改为 1 个，每组只取页面展示的 3 条摘要；正文及补充回答在详情中读取。

## 验证与边界

修改前执行 `npm test -- tests/socialReadCache.test.js tests/routeResolvedCache.test.js`，复现两项失败：11 次相同读取发出 11 个云端请求；已预热页面仍插入加载占位。修改后，相同场景只发出 1 个云端请求，已预热页面直接渲染。该请求减少比例只对应此测试场景，不代表整体容量提升比例。

联合版本最终全套 377 个测试文件、3464 项测试通过。正式构建、ESLint、类型检查、类型基线检查、Pages 配置检查、Supabase 构建配置检查，以及本地真实 Workers 和 Chrome 路由回归均已通过。新页面和反馈页还通过 375px/1280px 的真实 Chrome 检查，无控制台错误、横向溢出或无名称控件。类型基线未上调。

新功能迁移和 `supabase/tests/campus_matter_workflow.sql` 已在真实 PostgreSQL 的单一回滚事务中验证，测试结束后确认没有留下新表或虚构用户。修正了不存在的 JSON 函数、错误的函数权限签名、测试变量歧义和版本号；回归覆盖匿名昵称与通知身份、未审核回应和回答隔离、澄清回答自审拒绝。

线上数据库只读统计中，抽样校园业务查询平均耗时为十几到几十毫秒。样本规模较小，不能代替并发压测，也不足以推导免费版能承载的总用户数。本次未删除既有索引。新校园事务表开启 RLS、关闭客户端直接访问，写操作由受控服务端 RPC 验证。

## 联合发布顺序

1. 完成源码与隐私扫描、审查和正式构建，提交经过验证的完整候选。
2. 应用 `20261016094824_campus_matter_resolution_v1.sql`，读回验证表权限和函数权限。
3. 部署 `campus-life`、`campus-social`、`campus-community`；保留既有 JWT 配置。
4. 推送至已核对的 `main`，等待 Cloudflare Pages Git 构建成功，核对线上版本和源码签名。

既有迁移历史存在时间戳差异，因此本次只应用经过单独验证的新迁移，不执行全库 `db push`，不重写旧历史。安全顾问对既有服务端专用表的“RLS 无策略”和免费套餐密码保护限制不通过开放表权限或购买套餐来消除。

首次下载、网络距离、Supabase 冷启动和免费额度上限仍会影响体验；本次没有承诺所有入口首次打开都能立即完成。

## 复查命令

```powershell
npm run lint
npm run typecheck
npm run typecheck:ratchet
npm test
npm run build
npm run worker:check
npm run pages:verify-config
npm run supabase:verify-config -- production
npm run supabase:verify-bundle -- dist production
node scripts/audit/route-loading.mjs dist
```

Windows 沙箱若阻止临时目录重命名，可将 `TEMP` 和 `TMP` 指向项目已忽略的 `.vitest-tmp`。原生 workerd 和 Chrome 调试端口可能需要在允许启动本地进程的环境运行。

## 参考

- [Cloudflare Pages 静态资源缓存头](https://developers.cloudflare.com/pages/configuration/headers/)
- [Workbox 缓存策略](https://developer.chrome.com/docs/workbox/modules/workbox-strategies)
- [Supabase Edge Functions 调用](https://supabase.com/docs/reference/javascript/functions-invoke)
- [Supabase 查询优化](https://supabase.com/docs/guides/database/query-optimization)
