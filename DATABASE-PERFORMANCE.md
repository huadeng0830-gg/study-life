# 数据库性能与安全审计

核查日期：2026-10-16。生产 PostgreSQL 17，Singapore / ap-southeast-1，Supabase Free。统计读取生产实例；新迁移仅在事务中验证后回滚，尚未永久应用。

## 当前容量与实际样本

数据库基线为 19,502,771 字节（19.50 MB），Storage 0 对象。以下 total 包括表、TOAST 和索引，行数为统计估计，不能当作业务活跃用户数。

| public 表 | 行数估计 | 索引字节 | 总字节 |
|---|---:|---:|---:|
| account_sync_snapshots | 2 | 16,384 | 221,184 |
| campus_feedback_suggestions | 0 | 114,688 | 131,072 |
| team_project_tasks | 1 | 106,496 | 122,880 |
| campus_bean_ledger | 0 | 90,112 | 106,496 |
| campus_matter_responses | 0 | 81,920 | 98,304 |
| platform_admin_audit | 4 | 81,920 | 98,304 |
| social_notifications | 4 | 65,536 | 81,920 |

空表也可能有历史已分配空间；本次没有 VACUUM FULL、删表、删除用户内容、收缩字段或清空日志。样本规模不足以证明生产大数据量性能。

生产 pg_stat_statements 的代表性累计记录如下。同一个函数的外层调用与内部语句分别统计，表中只列代表性外层记录，不把它们相加为请求数；一行 JSON 返回值不等于 JSON 内只有一条业务记录。

| Query | 调用数 | 返回行/次 | 当前均值 ms | 当前最大 ms | 优化后生产耗时 |
|---|---:|---:|---:|---:|---|
| social_dispatch | 96 | 1 | 13.744 | 63.267 | 未测量 |
| campus_governance_queue | 10 | 1 | 35.412 | 157.374 | 未测量 |
| campus_bean_wallet | 20 | 1 | 15.201 | 90.880 | 未测量 |
| write_account_sync_snapshot | 10 | 1 | 23.330 | 42.078 | 未测量 |
| moderation_queue | 5 | 1 | 10.391 | 16.499 | 未测量 |

这些记录混有历史测试，不能推出稳定的查询 P95、TPS 或最大连接承载。校园审核队列曾超过 100ms，应在真实数据增长后继续 EXPLAIN，而不是用本次小样本宣布所有慢查询已消失。

## 已实施的读取优化

| Query/入口 | Before | After | 验证与索引 |
|---|---|---|---|
| 审核员申请邮箱补全 | 最多 200 条逐条 Auth 查询 | 去重后 1 次批量 RPC；空列表 0 次 | 200 条虚构申请经过真实 handler 的测试 |
| 审核抽查邮箱补全 | 对每个审核员调用 Auth，列表最多 500 条 | 唯一 ID 一次查询 | 100 条审计 / 10 位审核员仅一次 RPC |
| 平台审核员邮箱补全 | 25 次 getUserById | 1 次批量 RPC | 25 位虚构审核员；错误必须显式返回 |
| mine_list | 运行代码中 1 处 select('*')，11 类并发查询 | 每类明确字段；列表使用 summary，编辑继续读 detail | 运行读取通配投影 1 → 0；13 个输出分类全部保留 |
| mine_list 瞬时表请求 | 11 | 最大 3 | 请求总数没有伪装成减少；摘要免读校车子表 |
| campus_matter_marks 按 user_id | 原主键以 matter_id 开头 | 新增 (user_id,matter_id) | 覆盖用户筛选及外键清理入口 |
| campus_matter_response_feedback 按 user_id | 原索引首列不匹配 | 新增 (user_id,response_id) | 不替代原按 response_id 的索引 |
| campus_matter_outcomes 按 author_id | 无覆盖索引 | 新增 (author_id) | 外键检查/用户清理入口 |

mine_list 的每分类既有 100 条上限没有偷偷缩短。摘要移除大正文及编辑子记录；编辑入口仍获取明确的完整编辑字段。跨分类读取本身是固定扇出，不冒充 N+1。并发减小会增加少量聚合等待，换取较低瞬时数据库压力。

### 可复现的索引执行计划

supabase/tests/performance_capacity_plan.sql 在同一真实 PostgreSQL 中创建 30,000 条虚构 TEMP 记录，复制既有索引，再比较新增用户首列索引。整个事务回滚，没有将虚构记录加入业务表。

| 条件相同：user_id 等值，返回 30 行 | Before | After | 变化 |
|---|---:|---:|---:|
| Execution Time | 1.480ms | 0.088ms | -94.1% |
| local shared block 访问 | 352 | 30 | -91.5% |
| Plan | 原复合主键 Index Only Scan | 新索引 Bitmap Heap Scan | 更少扫描块 |

这是合成数据、暖内存样本，不是生产 API 加速倍数。原计划使用了索引，并非全表扫描；不得把它描述为消除了生产全表扫描。

## RLS、权限与迁移

生产 public 表全部启用 RLS；公开 schema 没有视图，没有可由 anon/authenticated 执行的 SECURITY DEFINER 函数。33 条“RLS enabled no policy”INFO 对应仅服务端访问的拒绝默认策略，不应为了消除提示增加公开 policy。账号所属表已使用 (select auth.uid()) 等可复用身份表达式；不放宽权限。相关优化依据见 [Supabase RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)。

生产 service_role 无 auth.users 的 SELECT 权限，不能简单在公开 RPC 内直接提权。迁移 20261016131336_performance_capacity_guards.sql 使用未暴露的 private schema 辅助函数：固定空 search_path、仅返回 id/email、最多 500 个 ID、检查操作者仍为 owner。public 包装函数为 SECURITY INVOKER。两个函数都撤销 PUBLIC/anon/authenticated 执行权，仅授予 service_role；服务端仍在分派前检查已认证操作者的 owner 权限。没有授予整个 auth.users 的读取权。

supabase/tests/performance_capacity_guards.sql 已在包含迁移的回滚事务执行，覆盖重复 ID、空集合、501 个 ID 拒绝、非 owner 拒绝、客户端 EXECUTE 拒绝，以及 SET LOCAL ROLE service_role 的实际调用。随后确认新函数、新索引、虚构账号均未残留。不可把这一步报告为生产迁移已经发布。

Storage 私有交付桶的 SELECT/INSERT/UPDATE/DELETE 都通过 qixing_private.object_access；UPDATE 同时验证 USING 与 WITH CHECK。没有公开私有附件。泄露密码保护的 WARN 是当前免费套餐不包含的能力，未为本任务开通付费项。

## 索引、分页、搜索与数据增长决定

- 顾问提示 4 个未覆盖外键：实现其中 3 个。platform_registration_settings 是单行配置，updated_by 不为消除提示额外建索引。
- 37 个“未使用索引”来自低样本，保留；不能据此删除唯一约束、业务去重或外键路径索引。
- 运行代码的 select('*') 已消除；迁移里的 SQL 局部行记录、RETURNING 和测试构造不按字符串机械替换，否则可能破坏存储过程语义。
- 反馈已有 limit/offset、全库搜索与全局排序；目录页仍有既有最近 100 条上限，部分服务端聚合会读取最多 1,000/3,000 条计数输入。它们不是本次新引入，也不是已经完成游标分页；需要后续按分类补充页游标、精确聚合和不遗漏旧数据的交互。不得宣称全站分页验收已完成。
- 搜索已有范围与长度校验、页面防抖；新增取消旧网络请求。literal imatch 避免把输入当成 SQL/正则表达式；当前没有因为空表提前加入成本较高的全字段 GIN。出现 10k 量级数据或 P95 >100ms 时，以真实 EXPLAIN 决定受控字段的 pg_trgm/全文索引，记录写入与空间代价。
- 本地草稿/待办仍采用既有持久化、写入队列、冲突与恢复机制。未把账号同步 JSON 拆表或裁减用户快照。快照增长和传输频次是容量模型中的敏感项。

## 发布与回退顺序

先备份并按项目现有迁移流程应用新增 migration，再发布 campus-community / platform-admin / campus-life，最后发布 Web/PWA。先上线新的后端而没有 RPC 会导致管理员列表报错。索引使用普通 CREATE INDEX，当前表很小；数据增长后需评估锁等待和迁移窗口。回退应用时可暂留这三个索引和受限函数，避免通过紧急 DROP 破坏正在运行的请求。数据库 schema 本轮未永久变更。
