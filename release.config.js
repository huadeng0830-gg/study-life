// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月04日-版本11',
    signature: 'd6e258c21d',
    notes: [
      '文档与工程化收口：HANDOVER §0 入口区块全面更新到当前基线（版本10/ 187 文件 / 1975 用例），并修正其中指向报告「一改就红的测试」表的行号指针（原位置已漂移约 687 行，改为给出行号加可搜索的定位词）',
      'docs/archive/README.md 从 3 行扩为完整的导航：明确写出「本目录数字几乎都已过期」并指明当前基线该看哪三份文档，同时说明为什么不能删（它们是唯一解释反直觉设计的证据链，例子已列全）',
      'README 补齐三处会导致误操作的遗漏：常用命令补上 release:bump 与 typecheck:ratchet 等 7 条并写明「改了 src/ 必须跑 release:bump」；部署小节明确警告只跑 pages deploy 连不上同步协调器、完整路径是 deploy:sync:production；项目结构补 scripts/、sync-protocol.js 与 release.config.js',
      '锁定 Node 版本：新增 .nvmrc（22）与 package.json 的 engines。原因不是惯例——Node 22 起内置的实验性 Web Storage 会遮蔽 happy-dom 的 Storage，本项目踩过一次导致 552 条用例连带变红；而 CI 此前锁在 20，等于永远跑不到那条路径，那次修复在 CI 上得不到任何验证。CI 已同步升到 22',
      'CI 加固：permissions 收到最小、timeout-minutes 20（此前默认 360 分钟，卡死的 job 能占配额一整天）、新增独立的 dependency-audit job',
    ],
  },
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
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'd6e258c21d'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
