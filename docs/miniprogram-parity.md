# 微信小程序与网页版对照（2026-10-16）

用户确认：小程序对齐整个学习生活工作台，底部入口为今天、学习、记录、校园、更多；小程序使用独立微信云开发，网页端保持现状。

## 本轮实现

| 工作区 | 小程序实际行为 | 对照来源 |
| --- | --- | --- |
| 导航与外观 | 五个底部入口，蓝色主色、浅灰底、白面板、四种主题 | `src/router/navigation.js`、`src/composables/navigationPreferences.js`、`DESIGN_TOKENS.md` |
| 今天 | 课程/日程时间线、待办完成、近期重要日期、本周人民币收支、专注入口和心情 | `src/views/TodayView.vue` |
| 学习 | 日期/周视图、学期周数、单双周、课程起止周、教师/地点、待办、课程关联与专注时长 | `src/views/ScheduleView.vue`、`src/views/TasksView.vue` |
| 记录 | 日期/时间/金额的基础识别，保留原文，用户确认后保存；八类手动新建 | `src/components/QuickRecordPanel.vue` |
| 日程与重要日期 | 新建/编辑/删除、全天与时段、地点、课程关联、倒计时 | `src/views/EventsView.vue`、`src/views/ExamsView.vue` |
| 账本 | 收入/支出、分类/账户、月筛选、预算、按币种展示；其他币种不静默按1:1折算 | `src/views/LedgerView.vue` |
| 固定账单 | 月/周/年/一次性周期；确认支付后成组创建收支并推进下一期；保留月内日期锚点 | `src/composables/domain/commands.js` |
| 清单与笔记 | 清单多行创建、勾选、保留已完成状态、编辑/删除；笔记正文存储 | `src/views/ListsView.vue` |
| 专注与回顾 | 自定义时长、暂停/继续、离开后恢复、进展草稿、按实际秒数记账并回写待办；月度统计 | `src/components/FocusPanel.vue`、`src/views/WeeklyReviewView.vue` |
| 校园 | 地点及七类文字目录、筛选服务、投稿、举报、个人投稿修改/撤回、审核与建议管理 | `src/components/CampusHome.vue`、`src/views/campus/*` |
| 数据与账号 | 本机使用、微信账号隔离、持久化同步队列、版本冲突确认、原子批次、JSON导出/恢复 | 独立原生实现，未复用 Web 的 Supabase 账号 |

上述均连接实际记录处理，页面没有用示例数据冒充已保存内容。校园二手/互助/活动目前是信息目录，不能声称已有交易、接单、报名闭环。

## 尚未等价的高级功能

- 课表图片 OCR、Excel 导入、节次模板、多套课表/作息、特殊日期调课。
- 网页端完整自然语言解析、通知多事项识别、语音录入、重复待办和自动学习安排。
- 多币种汇率折算、退款分摊、账单模板、复杂账户管理。
- 农历、节日氛围、壁纸、导航自定义与完整无障碍交互。
- 齐行项目协作、交付验收、一起约和共同空闲计算。
- 校园交易、接单、活动报名、私信、授课安排与评价、完整地点服务详情。

这些条目没有添加无效按钮，也没有记为已迁移。当前实现覆盖主要个人工作流和校园目录，不能称为网页功能的完整一比一移植。

## 部署与验证边界

开发源在 `D:\study-life\study-life\miniprogram`，实际用户工程在 `D:\微信开发者工具\工作区\study-life`。同步脚本先备份旧源码，保留目标的真实 `config.js` 和 `project.private.config.json`。

微信云环境 ID 已配置为 `cloud1-d4gkg8d2k03c3ad3c`。2026-10-16 已部署 `study-life` 云函数并确认状态 `Active`，保留既有 `Nodejs16.13` 运行时，超时改为 20 秒、内存 256 MB。13 个集合、18 个复合索引（含字段顺序与方向）和全部集合的 `ADMINONLY` 权限已配置并回读验证，包含 `sl_personal_records`。真实模拟器调用验证了账号、资料、钱包、审核申请、校园授权、个人同步、公开建议和我的投稿等 8 个接口；13 个集合的客户端直读直写均被拒绝。账号页同步完成后 `loggedIn: true`、`error: ""`。资料尚不完整，未用虚构资料替用户保存；内容安全提交与真机完整业务验收仍待进行。

CloudBase CLI 安装在仓库外的 `D:\study-life\.tools\cloudbase-cli`，通过浏览器授权登录。`miniprogram/cloudbaserc.json` 保存部署配置，`scripts/configure-wechat-cloud.mjs` 默认只读检查，`--apply` 仅收紧集合权限和更新超时，不修改用户文档。CLI 凭证不进入项目。

本地验证包括微信原生 WCSC/WCC 的全局样式、所有页面和自定义 tabBar 编译，以及真实客户端处理器连接持久化替身的行为测试。开发者工具服务端口现已开启为 `29440`。2026-10-16 已授权官方模拟器自动化，取得五个主页面的实际截图；重新编译后未再出现首页文字叠层，并修复了 v2 默认按钮宽度导致的记录页网格溢出和学习页筛选换行。`scripts/check-miniprogram-layout.ps1` 读取实际元素尺寸，检查四列记录入口、学习筛选和首页图标。模拟器检查不等于真机视觉验收。
