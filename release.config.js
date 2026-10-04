// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月04日-版本10',
    signature: 'ab5670154a',
    notes: [
      '修复两处运行时会抛 ReferenceError 的真缺陷（由 vue-tsc --checkJs 报出，此前无任何守卫覆盖）：dataManagerPairing 调 revokeSyncDevice 但从未导入，点「移除设备」必炸；dataManagerSyncActions 引用 syncPreview 但从未定义，点「关闭预览」必炸。同族问题本仓已出过两次（currencyField、ledgerNowHM），而 templateBindingIntegrity 只校验「具名导入确实存在」，管不到「标识符压根没被导入」',
      '新增 scripts/typecheck-ratchet.mjs 与 typecheck:ratchet 命令：把类型债务变成棘轮，总数只许变少；并设一条硬红线——TS2304「引用了不存在的名字」必须为 0，不参与棘轮比较。已接进 CI',
      '实测数据（所以没有直接打开 checkJs）：全开 5477 条，关掉 noImplicitAny 后 2236 条，其中 1259 条是 ref([]) 被推断成 never[] 这一条根因的级联。tsconfig 里 checkJs 仍为 false，typecheck 这一项目前覆盖不到 221 个 js/vue 文件',
      '修正 cloudSyncData 里 5 处从未定义过的 JSDoc 类型名 SyncDefaultsType（正确写法是 keyof typeof SYNC_DEFAULTS，第 70 行本来就是对的）',
      '硬红线不收 TS2551「Did you mean」：那大量是合法的厂商前缀探测，例如 FocusPanel 的 window.AudioContext',
      'window.webkitAudioContext，把它算成缺陷只会逼人删掉兼容代码。已用变异验证：撤掉 syncPreview 的导入即变红并指名位置',
    ],
  },
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
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'ab5670154a'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
