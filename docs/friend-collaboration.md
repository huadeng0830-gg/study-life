# 好友课表匹配与出行邀约

本方案在三两事现有 Vue、Supabase Auth 和账号同步快照上增加好友协作。课表仍按现有 `study-life-sync` v3 快照同步；本功能单独存储社交关系与邀约，不修改旧快照格式，也不接入目标舵。

## 已确认的首版范围

- 首次进入时创建昵称资料，学校可留空；不提供公开个人主页。
- 好友发现默认关闭。开启后，只允许已验证账号用完整邮箱精确搜索；搜索响应和好友资料都不返回邮箱。搜索无结果统一提示对方可能未注册、未验证邮箱或关闭发现权限。
- 首版只允许一对一匹配与邀约。参与者表为后续多人邀约留下扩展位，不引入群组或群权限模型。
- 双方的课程、事件、考试、具体繁忙区间和邮箱都不发送到客户端；服务器只返回共同空闲时间。
- 通知是应用内通知和 Realtime 更新，不发送邮件或系统推送。

## 数据库与迁移

`20261008045623_friend_collaboration.sql` 为已应用的主迁移；`20261008045755_social_foreign_key_indexes.sql` 为外键查询索引优化。

| 表 | 用途 |
| --- | --- |
| `social_profiles` | 昵称、可选学校、主动开启的邮箱发现、IANA 时区、课表完整日期、学期结束日、每日可约偏好 |
| `social_friend_requests` | 单向好友请求及接受、拒绝、撤回状态 |
| `social_friendships` | 规范化的双向好友关系，一对 UUID 顺序存储 |
| `social_invitations` | 活动、时间、地点、备注、状态、过期时间和版本 |
| `social_invitation_participants` | 每位参与者的角色、回应及一次改约提议；第一版仍固定两人 |
| `social_notifications` | 收件人可读、可标记已读的应用内通知 |
| `private.social_rate_buckets` | 服务端邮箱搜索、匹配、请求和邀约限流计数，不进入客户端 API |

所有公开社交表启用 RLS。用户可读取自己的资料、参与的请求/好友/邀约和自己的通知；资料写入受本人策略限制，通知只允许本人更新 `read_at`。好友关系、邀约和通知创建只通过 Edge Function 进入 `service_role` RPC。内部 helper 位于 `private` schema，撤销 `anon` 和 `authenticated` 的 schema/table/function 权限。账号快照表、其 RLS 与 CAS 同步 RPC保持不变。

`private.social_rate_buckets` 同样启用了 RLS；仅 `service_role` 获得表策略，`anon` 与 `authenticated` 没有访问策略或表授权。

## 服务端接口

前端统一调用已部署的 `campus-social` Edge Function，要求 Supabase JWT，并由服务端再次读取 Auth 用户、检查验证状态和关系权限。动作如下：

- `profile_get` / `profile_save`
- `email_search`
- `friends_list`、`friend_request_send`、`friend_request_respond`、`friend_remove`
- `availability_query`（`days` 为 7、14 或 30）
- `invitations_list`、`invitation_create`、`invitation_respond`、`invitation_cancel`
- `notifications_list`、`notifications_mark_read`

邮箱精确匹配只发生在服务端，响应仅含用户 ID、昵称和可选学校。未找到、邮箱未验证或发现关闭时统一返回空结果。邮箱搜索 10 分钟最多 12 次；共同时间最多 60 次；好友请求最多 10 次；邀约最多 30 次。客户端遇到离线、未验证、同步关闭、课表未知/变更、冲突、限流和服务错误时显示对应反馈；只有服务端持久化成功才显示成功。

创建、接受和改约确认会带上两人的快照 `revision` 与资料 `updated_at`。事务内再次锁定并比较版本，检查好友关系及确认邀约冲突；任一课表、偏好、关系或占用时间变化都会拒绝本次提交并要求刷新。按参与者 UUID 依次取得事务 advisory lock，防止两个不同邀约并发确认成重叠行程。

## 共同空闲计算

计算只在 Edge Function 中进行，输入为双方资料、服务端私有快照、双方已确认邀约和请求日期范围：

1. 按发起用户时区计算今天起的 7 天，用户可切换 14 天或 30 天；每位好友的课程与每日偏好按各自 IANA 时区展开。
2. 用现有课程表、校区与季节作息、学期起始周、周次/单双周、调课与放假例外生成课程忙碌区间；学期结束后停止重复课程。课程前缓冲取个人缓冲与课程出行分钟数的较大值，课程后应用个人缓冲。
3. 将有时间的事件和考试作为忙碌区间；没有时间的整日事项按全天占用处理。已确认邀约也占用双方时间。每天仅在资料设置的可约时段内搜索，默认 09:00–22:00、周末开放、最短 90 分钟。
4. 将忙碌区间从个人可约窗口扣除，再按绝对时间求交集；不足双方较长最短时长的区间过滤，结果按开始时间排序。夏令时不存在的墙上时间不生成候选；重复时间边界采取稳定的起止解析规则。
5. 如果任一人声明的课表完整日期未覆盖搜索末日，或课表缺少可解释的作息元数据，返回“课表范围未知”，不猜测为空闲。

邀请人从共同空闲区间选择候选，再设定区间内的精确起止；快捷时长是 90 分钟、2 小时、3 小时。服务器拒绝超出共同空闲区间、超过 12 小时、已过期或与确认邀约冲突的时间。最终回应再次校验当下快照与冲突。

## 邀约状态

| 当前状态 | 操作 | 新状态 |
| --- | --- | --- |
| `pending` | 好友接受 | `confirmed` |
| `pending` | 好友拒绝 | `declined` |
| `pending` | 好友提出一次改约 | `change_proposed` |
| `change_proposed` | 发起人接受 | `confirmed`，时间替换为提议时间 |
| `change_proposed` | 发起人拒绝改约 | `pending`，该邀约不可再提第二次改约 |
| `pending` / `change_proposed` / `confirmed` | 任一方取消或解除好友 | `cancelled` |
| 未回应且已到过期点/开始时间 | 查看邀约时惰性过期 | `expired` |

`declined`、`cancelled`、`expired` 为终态。即使列表尚未触发惰性过期，服务端也会拒绝对已到期邀约的回应。

## 页面与兼容

新增 `/together` 页面进入现有桌面侧栏和手机“更多”菜单，复用三两事的面板、按钮、字体和颜色变量。

- 桌面共同时间页左侧选好友，右侧按日期展示共同空闲和邀约操作；请求、邀约、通知、资料仍在同一模块内切换。
- 手机端改为单列卡片，好友以横向选择条切换；日期、空状态和快捷时长靠近主要操作，确认与移除操作均有忙碌状态和二次确认。
- 共同日程摘要同时出现在现有“今天”和“日程”页；只显示已确认邀约。无结果可扩展到 14/30 天或调整偏好。
- 旧账号快照保持 v3，新增社交资料默认不可发现。首次用社交功能前要求联网并确认账号同步已开启且成功，避免读取旧设备/未上传的本机课表；本机数据仍走既有本地保存路径。

## 验收标准

1. 两个已验证账号各自设置昵称、时区、学期结束日及完整课表日期后，能按精确邮箱发现对方；默认关闭发现时查不到，任何响应、好友列表和通知都不暴露完整邮箱。
2. 接受请求后双方都看到对方，能分别匹配不同学校/时区的空闲时间；响应只包含共同区间，不含课程名、事件名、单方空闲和原始快照。
3. 搜索可切换 7/14/30 天，近期结果靠前；未知课表显示原因，无结果提供扩展范围和偏好入口。
4. 90 分钟、2 小时、3 小时和自定义时长均不得越出候选区间；请求发出后修改课表、偏好或另一个确认邀约会使旧选择被服务端拒绝。
5. 接受、拒绝、改约、取消、删除好友、过期各状态与两端通知一致；确认邀约出现在现有今天/日程视图并从课表匹配中扣除。
6. 加载、成功、失败、离线、未登录/未验证、空好友、空结果、限流及冲突均有界面反馈；错误或离线不会假报已保存。
7. 桌面双栏与手机单列在现有设计体系中可用；现有登录、课表、事件、考试与 v3 账号同步继续读写原数据。

## 当前部署与外部依赖

主迁移、外键索引和限流表 RLS 迁移已应用到三两事 Supabase 项目 `xyuwjmswqmxfwtyzakan`，`campus-social` 已部署且启用 JWT 验证。Cloudflare Pages 生产站点已部署网页版本 `2026年10月08日-版本3`：<https://study-life.pages.dev/>。线上资源完整性审计为 GREEN：149 条 Service Worker 预缓存、101 个 JS 模块及 148 个静态资源均可访问，没有缺失项。GitHub 源码已推送，Windows 桌面版 `1.0.4` 已发布，且 Release 同时包含安装包、`latest.yml` 和 `.blockmap`：<https://github.com/huadeng0830-gg/study-life/releases/tag/v1.0.4>。

现有 Auth 文档记录自定义 SMTP 尚未配置：Supabase 默认邮件收件限制会妨碍普通邮箱注册/验证。因此要用两个新建普通邮箱完成首次真实验收，项目维护者还需配置自定义 SMTP、Site URL 和 Redirect URLs；已经可登录且邮箱已验证的两个账号不受该注册邮件限制。Supabase 组织当前是 Free 方案，而[泄露密码保护要求 Pro 或更高方案](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)，因此本次未升级付费方案。即使升级后仍需在 Supabase Auth 设置中开启该选项；当前 Supabase 工具没有 Auth 设置写接口，本机 UI 自动化初始化失败，不能代替项目维护者完成控制台设置。

Supabase Auth 顾问还提示“泄露密码保护”未启用，可在 Auth 密码安全设置中开启：[官方说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。
