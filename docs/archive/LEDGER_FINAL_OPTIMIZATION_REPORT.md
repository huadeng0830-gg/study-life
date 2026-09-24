# LEDGER FINAL OPTIMIZATION REPORT

Date: 2026-09-05

## Categories

Default expense categories:

餐饮、饮品、零食、交通、购物、学习、数码、娱乐、生活用品、日用服务、沐浴、住房、水电网、通讯、医疗、运动、社交、旅行、宠物、订阅会员、其它。

Default income categories:

工资、兼职、奖学金、生活费、报销、退款、红包、二手出售、其它收入。

New categories:

本轮补充了饮品、零食、数码、生活用品、日用服务、沐浴、住房、水电网、通讯、运动、社交、旅行、宠物，以及独立的收入分类体系。沐浴使用独立稳定 key `bathing`，常见“洗浴、洗澡、澡堂、温泉、浴资、足浴”会进入该分类。

Removed/merged categories:

没有物理删除历史分类。旧 `life`（生活）保留为隐藏的历史兼容分类；`transit`、`health`、`sub`、`other` 仅更新展示名称为交通、医疗、订阅会员、其它，底层 key 不变。

Stable IDs:

分类 ID 不使用中文名称。旧 ID `food`、`transit`、`shop`、`life`、`study`、`fun`、`health`、`sub`、`other` 保留；新增分类使用 `drink`、`snack`、`digital`、`daily-supplies`、`daily-service`、`bathing`、`housing`、`utilities`、`communication`、`sports`、`social`、`travel`、`pet` 等稳定 key。交易仍通过 `cat` 关联分类。

Keyword rules:

统一分类服务按“明确消费内容 → 服务类型 → 商户辅助 → 最近分类 → 其它”判断。正餐、主食、外卖、牛肉面、米饭、火锅等归餐饮；奶茶、咖啡、可乐、饮料、矿泉水等归饮品；薯片、饼干、巧克力、辣条等归零食。洗衣液、沐浴露等日常消耗品归生活用品，洗浴/沐浴服务归沐浴；论文/教材/作业打印归学习，普通打印归日用服务；手机、电脑、耳机、数据线等归数码。饭加饮料的未拆分交易按主消费餐饮处理；饮品与生活用品同时出现且未拆金额时标记为有歧义。

Merchant rules:

瑞幸、星巴克、蜜雪冰城、霸王茶姬辅助识别饮品；肯德基、麦当劳、海底捞、食堂辅助识别餐饮。淘宝、京东、拼多多只作为低置信度平台提示，内容词优先，因此“淘宝买洗衣液”仍归生活用品，“京东买耳机”仍归数码。

Confidence rules:

统一阈值为 `0.75`。明确内容规则通常为 `0.90–0.98`；平台商户规则可低至 `0.56`。混合消费未拆分金额时输出候选分类并标记歧义；用户明确修改后置信度为 `0.99`。QuickRecord 对低置信度分类先展示建议，用户确认或修改后才允许入账；高置信度记录可直接保存。

User override:

用户在智能记录、手动快速记账中选择其它分类后，会把该条描述与分类写入 `sl_ledger_freq.categoryOverrides`，上限 100 条；用户覆盖优先于系统关键词。无效分类 key 不会写入。分类覆盖也会随本地迁移合并，本机同关键词规则优先。

Custom categories:

分类管理支持支出/收入分开查看，提供常用、全部、隐藏、自定义视图，以及新增、重命名、排序、换图标、隐藏。自定义分类使用 `custom-*` 稳定 ID；有历史记录的分类不提供物理删除，避免历史交易出现 dangling categoryId。选择自定义分类后同样可以形成轻量用户映射，不会破坏系统饮品等默认分类。

Historical migration:

启动时只归一化并补齐分类定义，不修改任何历史交易的 `cat`。旧“生活”分类隐藏但保留；旧分类改名仍沿用原 key。新增规则只影响新记录，固定账单支付生成的交易也复用同一分类服务。

Tests:

覆盖金额位置变化、饮品/餐饮边界、沐浴与沐浴露边界、平台词、打印分类、复合消费、收入分类、用户覆盖、旧分类迁移、自定义分类偏好迁移。全量测试：68 个文件、580 个测试通过；Lint 和 Typecheck 通过。生产构建未执行完成，因仓库已有发布签名门禁要求先同步 `release.config.js`，不是编译错误。

DRINK CATEGORY READY: YES

COMMON CATEGORY COVERAGE: YES

NATURAL LANGUAGE CLASSIFICATION: YES

CATEGORY FALSE-MATCH RISK: MEDIUM

HISTORICAL TRANSACTIONS PRESERVED: YES
