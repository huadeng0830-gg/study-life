// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月04日-版本9',
    signature: '32c7677665',
    notes: [
      '修复显式提交清单的一处契约破坏：sl_mood_log 此前在 EXPLICIT_COMMIT_KEY_LIST 里，但全仓没有任何一处 touchStoredRef(\'sl_mood_log\')，违反 core.js 自己写的第 1 条前提。它之所以一直没出事，是因为所有写入都是整体替换引用；只要有人改成就地改字段就是静默丢数据。按契约（前提 1 不成立就不该进清单）把它移出——它是很小的日期→心情映射，deep watch 开销可忽略，换来任何改法都存得下去',
      '新增 tests/explicitCommitContract.test.js：断言清单里每个键都至少有一处 touchStoredRef 调用，并解析 const NAME = \'sl_...\' 的常量间接（ledger 三个键正是走常量，否则会被误判成孤儿）。守卫经变异验证：移除 checklists 的 touch 调用即变红',
      '守卫同文件内附行为侧证据：就地改字段确实不落盘、touch 之后才落盘。写这条时踩了两个坑，缺一个都会变成假绿——watcher 的安装是延迟的（requestIdleCallback），且 Vue 的 watch 回调是异步的，必须先 nextTick 再 flush',
    ],
  },
  {
    version: '2026年10月04日-版本8',
    signature: '0ff1616c39',
    notes: [
      'cloudSync.js 改为按需动态加载：此前 App.vue 用静态 import 把它（约 50KB raw）拉进首屏闭包，导致 main.js 里的 await import 完全失效——模块早已在首屏，加载器只是取缓存。没绑定同步空间的用户白付这50KB 首屏成本',
      'formatAppDate 改为复用 settingsPolicy 的 Intl.DateTimeFormat 缓存：此前每次调用都new 一个，而构造比 format 贵一个数量级，且它的调用点有 5 个在 v-for 列表行里',
      '修复应急导出的静默失败：动态 import 失败此前被空 catch 完全吞掉，用户点「导出数据」什么都不会发生也没有任何提示。应急导出恰恰是最不能静默失败的场景（通常是发现数据异常后的最后手段），现在会记录错误并提示可能原因',
      '删除死代码 src/composables/ledgerView/useLedgerFilters.js：LedgerView 早已改用 feed.js 的筛选逻辑并注释掉了这个调用。它与 feed.js 维护着两份同名的 filteredExpenses/filtersActive/clearFilters，且这一份的查询没有防抖——哪天有人把注释解开，会同时得到两个全表扫描',
    ],
  },
  {
    version: '2026年10月04日-版本7',
    signature: 'da824e26de',
    notes: [
      '新增微信 / 支付宝账单 CSV 导入：解析后进入预览与冲突确认，确认后才写入账本。零新增依赖',
      'GBK / GB18030 是 WHATWG Encoding 规范强制要求浏览器原生支持的标签，所以支付宝账单的 GBK 编码用 TextDecoder(\'gbk\') 即可，不需要任何编解码库',
      '表头行号会漂移（微信前若干行、支付宝前若干行都是官方说明文案，且随版本变化），所以扫到表头行为止而不是写死行号',
      '修正三处按微信列名想当然导致的真实缺陷：支付宝没有「收/支」列（方向靠「资金状态」的已支出/已收入）、金额列是全角括号的「金额（元）」、时间列叫「交易创建时间」。之前这三处会让支付宝文件一律判成「不是账单文件」',
      '中性交易与资金搬运（充值、提现、零钱通、信用卡还款、花呗、转账、理财）一律排除：它们不是消费，计入会污染月度预算与分类排行。转账判定优先于收支判定，因为微信「转账」类型无法仅凭收/支区分方向',
      '退款映射成 direction:refund 而不是负数支出：金额恒为正，方向由 direction 表达，负数会让分类分布与月度合计算错',
      '去重优先用交易单号，缺失时退化为日期+金额+方向+对方 的稳定指纹，同一份文件重复导入不会产生重复记录',
      '新增 tests/ledgerBillImport.test.js 13 条用例：GBK 字节真的按 GBK 解出中文（常量由TextDecoder 反查得到，不靠猜）、表头行漂移、转账排除、退款方向、单双次导入不重复、损坏行跳过而不是整份失败',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '32c7677665'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
