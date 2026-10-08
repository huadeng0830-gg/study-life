// 每次发布必须同时更新说明和源码签名。
// vite.config.js 会校验签名；业务源码变了但这里没更新时，构建会直接失败。
//
// 发布流程：
// 1. 修改业务源码后构建，构建错误会提示新的源码签名；
// 2. 把新签名和“年-月-日-v序号”版本写入 RELEASE_UPDATES 第一条，并在 notes 里写清本次更新内容；
// 3. 更早的版本逐条下移，最多保留 3 个版本，超出即删除。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '2026年10月08日-版本9',
    signature: '06e0da06c7',
    notes: [
      '优化首页空状态与专注模块布局',
    ],
  },
  {
    version: '2026年10月08日-版本8',
    signature: 'a8ca62573f',
    notes: [
      '修复 Windows 桌面版应用内自动检查、下载与安装更新',
    ],
  },
  {
    version: '2026年10月08日-版本7',
    signature: '1fb16c5171',
    notes: [
      '修复搜索、提醒、专注计时和账单周期边界问题',
      '加固账号登出隔离、同步、笔记归档与云存储权限',
      '改进无障碍、备份恢复、课程导入和大数据量存储',
    ],
  },
])

// 对用户展示、version.txt 和更新检测统一使用此版本号；后续同日发布只递增“版本”序号。
export const RELEASE_VERSION = RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '06e0da06c7'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
