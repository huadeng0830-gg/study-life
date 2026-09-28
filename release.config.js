// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年09月28日-版本1',
    signature: '3a012ac53c',
    notes: [
      '阶段6d/6e：拆分 DataManager（2502→469行，4个composables+6子组件）与 LedgerView（3475→930行，9个composables+8子组件/面板），LedgerView 仍超目标 130 行待后续优化',
    ],
  },
  {
    version: '2026年09月26日-版本1',
    signature: '88d4c3323e',
    notes: [
      '阶段6b/6c：拆分 ScheduleView（1849→706行，7个composables）与 TimeSettingsModal（2238→726行，7个composables+4子组件）',
    ],
  },
  {
    version: '2026年09月25日-版本1',
    signature: '8d840b7189',
    notes: [
      '阶段6a（cloudSync拆分）：同步核心拆为 state/http/transfer/spaceOps 四模块并由 cloudSync.js 门面再导出全部公共API，补齐 syncPayloadMatchesBaseline 等缺失导入，行数均低于800且 175 个测试文件全绿',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '3a012ac53c'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
