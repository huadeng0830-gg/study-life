// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
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
  {
    version: '2026年10月04日-版本5',
    signature: '3ed0aa7cc3',
    notes: [
      '数据健康卡新增容量预警：本地数据达到 5MB 上限的 60% / 85% 时分别给出\'建议清理\'与\'必须导出备份\'两档提示。阈值基准说明写进代码注释 —— navigator.storage.estimate() 的 quota 自 Chrome M144 起变成随 usage 增长的估算值，usage/quota 比值已失去填充率含义，且统计的是 IDB+Cache+localStorage 合计，真正该盯的只有 dataHealth.bytes（refreshDataHealth 自己按键累加，口径是对的）',
      '之前的\'浏览器已用 1.2MB / 8MB\'改名为\'浏览器已用（含缓存，仅参考）\'，避免把它误读成 localStorage 容量',
    ],
  },
  {
    version: '2026年10月04日-版本4',
    signature: '4bb0b3522a',
    notes: [
      '「提醒」从此前只写不读的死数据变成真实功能。QuickRecordSettings 里的待办/日程/节点提醒分钟数此前只写进每条记录、从无消费者 —— 现在接入本地调度器：App 打开时按时触发 Notification，去重记录落盘（新键 sl_reminder_log，同步两台设备不会各响一次，刷新不会重复响）。设置面文案同步把能力边界说清楚：提醒只在 App 打开时可靠，后台/被系统回收时不触发',
      '新键 sl_reminder_log 已登记到云同步默认值与模块分组、备份三处、应急导出、本地迁移含 ARRAY_KEYS；提醒 minutes 默认值语义修正：0 是\\',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '6ef588c623'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
