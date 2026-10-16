# 三两豆与兑换闭环

## 一句话

贡献豆现在有明确的「赚」和「花」两条路：参与校园审核、或提交被采纳的建议获得贡献豆，
在「三两豆与兑换」（`/campus/beans`）兑换徽章一类的应用内数字权益。

修复前只有收入侧：`campus_bean_ledger` 允许 `entry_type='redemption'`，钱包也预留了
`entitlementRedemptionEnabled`，但全仓没有任何写入方 —— 余额只涨不减，用户拿到豆没有用处。

## 账本与规则（服务端）

| 表 / 函数 | 作用 |
| --- | --- |
| `campus_bean_wallets` | 充值豆、贡献豆、待抵扣债务三个余额 |
| `campus_bean_ledger` | 每一笔变动：`review_award`（每条审核 3 豆，每日最多计入 20 条）、`feedback_award`（0–20 豆，每条建议一次）、`audit_reversal`（复核追回，不足部分转债务）、`redemption`（兑换扣豆） |
| `campus_entitlements` | 权益目录：价格、库存、有效期、上下架、排序 |
| `campus_entitlement_redemptions` | 兑换归属：抄下成交价，记录有效期与使用时间 |
| `campus_bean_redeem(actor, code, key)` | 兑换：幂等短路 → 锁目录行 → 锁钱包行 → 校验余额 → 扣豆 → 写流水 → 写归属 |
| `campus_bean_entitlements(actor)` | 目录 + 我的权益，一次取全 |
| `campus_bean_wallet(actor)` | 余额；`entitlementRedemptionEnabled` 由「目录里有没有上架权益」决定，不再写死 |

上游动作在 Edge Function `campus-community`：`beans_home`（一次请求取全余额、目录、我的权益
与流水，避免页面为四块内容各发一次）与 `bean_redeem`（要求邮箱已验证，按账号限流 20 次/小时）。

## 幂等键为什么由前端生成

扣豆不可逆。`bean_redeem` 要求客户端提供 `idempotencyKey`（8–220 位，只含 `[A-Za-z0-9:_-]`），
并在**失败重试时复用同一个键**：服务端据此返回原结果，而不是重复扣费。
生成与复用见 `src/composables/campusBeans.js`；`tests/campusBeans.test.js` 专门断言
「兑换失败后重试必须用同一个键」—— 这条保护比「点了没反应」重要得多。

## 界面入口

- `/campus/beans`：余额、权益目录、我的权益、最近变动（`src/views/campus/CampusBeansView.vue`）。
  该路由刻意不注册 `meta.navigation`，由校园一级入口承载，不进入用户可编辑的业务导航。
- 校园总览「校园贡献与三两豆」卡片底部有「三两豆与兑换」。
- 账号面板「三两豆」分区底部同样有入口；该分区保持只读余额与流水，不再重复目录。

## 上线顺序

1. 应用 `supabase/migrations/20261016234500_campus_entitlement_redemption.sql`；
2. 部署 `campus-community` Edge Function（新增两个 action）；
3. 发布 Web/PWA。

迁移只新增两张表、两个函数并重建 `campus_bean_wallet`，不改写既有账本与钱包数据。
回退网页代码时保留迁移与流水记录，不要删除或重置生产数据。
SQL 回归见 `supabase/tests/campus_entitlement_redemption.sql`（虚构数据、整个事务回滚）。

## 还没做的

- 充值（`purchase`）与提现：需要应用主体与支付资质，`rechargeEnabled` 保持 false。
- `manual_adjustment` 仍没有写入方：管理员手工补豆/扣豆入口未开放。
- 权益目前是「归属记录 + 页面展示」。要让徽章真正长在个人资料上，还需要在资料渲染里
  读取 `campus_entitlement_redemptions`；这一步没做之前，不要对外宣称「已生效的徽章」。