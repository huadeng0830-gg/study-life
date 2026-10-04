// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
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
  {
    version: '2026年10月04日-版本6',
    signature: '6ef588c623',
    notes: [
      '新增日历导出：课程表、日程与重要日期可导出为标准 .ics 文件，导入 Apple / Google / Outlook 日历。零依赖，纯 RFC 5545 生成器',
      '课表按学期重复（RRULE + UNTIL），调休停课写入 EXDATE；单双周课程按周次展开成各自的事件，而不是写成 INTERVAL=2（那是隔周不是单周）',
      '日程的 reminderMinutes 一并导出为 VALARM，由系统在 App 关闭时也能提醒 —— 正好补上 Web Notification「只在App 打开时可靠」这个边界',
      '支持按类别分开导出（课表 / 日程 / 重要日期），避免系统通知被课程提醒淹没',
      '实现细节：一律用 UTC 而非 TZID（绕开手写 VTIMEZONE 这个最大错误源，且 UTC 锚定的重复规则在夏令时切换日不会平移一小时）；全天事件走 dateOnlyMs 而非 policyDateTime，避免东八区午夜换算后退到前一天',
      '入口放在数据管理页，与备份、迁移、数据健康同级',
      '新增 tests/icalExport.test.js 11 条用例，覆盖字节级折行不切断中文、UNTIL 必须 UTC、绝不出VTIMEZONE/TZID、单双周展开数、调休 EXDATE、VALARM、CRLF 行尾与结构配对',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '0ff1616c39'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
