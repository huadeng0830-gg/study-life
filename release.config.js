// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.9.0',
    legacyVersion: '2026年10月16日-版本1',
    channel: 'stable',
    summary: '反馈中心与大量反馈浏览',
    signature: 'f3c47ffec1',
    changes: {
      features: [],
      improvements: [],
      fixes: [],
      security: [],
      breaking: [],
    },
    notes: [
      '反馈与建议独立为全局功能，支持匿名或昵称署名',
      '反馈改为分页摘要列表，支持全量搜索、组合筛选和详情按需读取',
      '新增独立反馈处理页，公开进展与时间线，完善保存冲突和一次性贡献奖励',
    ],
  },
  {
    version: '1.8.1',
    legacyVersion: '2026年10月15日-版本9',
    channel: 'stable',
    summary: '优化表单、账号隔离与全端体验',
    signature: '9ac923d59e',
    changes: {
      features: [],
      improvements: [
      '撤销操作和清单快捷输入按账号归属隔离',
      '校外考试日期快捷入口校验正确字段',
      ],
      fixes: [
      '防止 Toast、快速记录和学习计划中的旧撤销操作跨账号生效',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '撤销操作和清单快捷输入按账号归属隔离',
      '校外考试日期快捷入口校验正确字段',
      '防止 Toast、快速记录和学习计划中的旧撤销操作跨账号生效',
    ],
  },
  {
    version: '1.8.0',
    legacyVersion: '2026年10月15日-版本8',
    channel: 'stable',
    summary: '校园集市支持紧凑浏览、分类排序和分页',
    signature: 'e0577a69ee',
    changes: {
      features: [],
      improvements: [
      '校园集市支持紧凑浏览、分类排序、分页和筛选清除',
      '校园搜索改为数据库筛选并优化投稿按需读取',
      '简化可约设置，默认包含周末并支持选填星期',
      '统一校园发布校验并完善账号切换与草稿保护',
      ],
      fixes: [
      '修复手机端审核申请表单重叠和公开建议加载问题',
      '修复双方邀约最短时长校验不一致',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '校园集市支持紧凑浏览、分类排序、分页和筛选清除',
      '校园搜索改为数据库筛选并优化投稿按需读取',
      '简化可约设置，默认包含周末并支持选填星期',
      '统一校园发布校验并完善账号切换与草稿保护',
      '修复手机端审核申请表单重叠和公开建议加载问题',
      '修复双方邀约最短时长校验不一致',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.9.0'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'f3c47ffec1'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
