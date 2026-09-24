// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年09月25日-版本1',
    signature: '8d840b7189',
    notes: [
      '阶段6a（cloudSync拆分）：同步核心拆为 state/http/transfer/spaceOps 四模块并由 cloudSync.js 门面再导出全部公共API，补齐 syncPayloadMatchesBaseline 等缺失导入，行数均低于800且 175 个测试文件全绿',
    ],
  },
  {
    version: '2026年09月24日-版本5',
    signature: 'fa1d584f88',
    notes: [
      '阶段5（性能与分包）：release.config.js 历史从150条裁到3条并由bump脚本自动封顶，首屏不再背127KB发布说明；store/core 改经钩子回调本机变更并抽出轻量 syncKeys，断开 core 对 cloudSync 的静态依赖，timeConfig 等业务 chunk 不再拖入整张同步图；删除10个无引用旧图标约1MB，保留v2系列与OCR语言包',
    ],
  },
  {
    version: '2026年09月24日-版本4',
    signature: 'b3182c202f',
    notes: [
      '阶段4（设计令牌全量迁移）：字号/字重/圆角硬编码机械包裹为var()共1264处不改数值语义，:root新增v5刻度--fs-*/--fw-*/--radius-*与别名；对比度审计可静态解析登记过的--fs-*/--fw-大字门槛；DESIGN_TOKENS.md补全刻度表与例外清单；修复image/*被误当块注释导致LocalTransfer与BatchImport漏迁',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '8d840b7189'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
