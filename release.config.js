// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.2.2',
    legacyVersion: '2026年10月14日-版本3',
    channel: 'stable',
    summary: '校园生活中心、地点目录与跨模块审核流程升级',
    signature: '72add44ef7',
    changes: {
      features: [
      '地点目录与教师课程、二手集市、校园互助、校车、失物招领、活动和校园指南',
      '全站搜索、收藏、统一发布、我的投稿、内容审核与审计',
      ],
      improvements: [
      '学校校区范围筛选、版本化拒绝重提和事务状态流转',
      '可翻页审核队列及校车班次、课程关联审核详情',
      ],
      fixes: [
      '修复投稿状态竞态、通知失败误报和班车投稿记录读取',
      ],
      security: [
      'Supabase Edge 鉴权、RLS 与受限事务 RPC',
      '私信限定发布者与对应联系对象并清理账号切换缓存',
      ],
      breaking: [],
    },
    notes: [
      '地点目录与教师课程、二手集市、校园互助、校车、失物招领、活动和校园指南',
      '全站搜索、收藏、统一发布、我的投稿、内容审核与审计',
      '学校校区范围筛选、版本化拒绝重提和事务状态流转',
      '可翻页审核队列及校车班次、课程关联审核详情',
      '修复投稿状态竞态、通知失败误报和班车投稿记录读取',
      'Supabase Edge 鉴权、RLS 与受限事务 RPC',
      '私信限定发布者与对应联系对象并清理账号切换缓存',
      '为地点和校园业务表补齐外键索引',
    ],
  },
  {
    version: '1.2.1',
    legacyVersion: '2026年10月14日-版本2',
    channel: 'stable',
    summary: '新增校园地点发现、细分类筛选、想去清单和审核结果通知',
    signature: '69eabc762c',
    changes: {
      features: [
      '新增校园地点发现、细分类筛选、想去清单和审核结果通知',
      ],
      improvements: [],
      fixes: [
      '隔离本机到访隐私与公开评分，并为审核版本及分页补齐保护',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '新增校园地点发现、细分类筛选、想去清单和审核结果通知',
      '隔离本机到访隐私与公开评分，并为审核版本及分页补齐保护',
    ],
  },
  {
    version: '1.2.0',
    legacyVersion: '2026年10月14日-版本1',
    channel: 'stable',
    summary: '新增调课通知应用、通知档案、只读提问、考试日历、去年今日、值日班务、数据体检和地点档案；支持可拒收的好友地点预设',
    signature: '0bb6a85c02',
    changes: {
      features: [
      '新增调课通知应用、通知档案、只读提问、考试日历、去年今日、值日班务、数据体检和地点档案；支持可拒收的好友地点预设',
      ],
      improvements: [],
      fixes: [],
      security: [],
      breaking: [],
    },
    notes: [
      '新增调课通知应用、通知档案、只读提问、考试日历、去年今日、值日班务、数据体检和地点档案；支持可拒收的好友地点预设',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.2.2'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '72add44ef7'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
