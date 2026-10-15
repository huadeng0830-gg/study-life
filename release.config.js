// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.7.0',
    legacyVersion: '2026年10月15日-版本7',
    channel: 'stable',
    summary: '新增校园反馈、审核申请与贡献积分',
    signature: 'cb28c3a1a7',
    changes: {
      features: [
      '新增校园反馈、审核申请与贡献积分',
      ],
      improvements: [
      '优化账号同步、备份恢复与校园导航',
      ],
      fixes: [
      '修复同步启动竞态及多个校园页面状态问题',
      ],
      security: [
      '收紧微信内部账号与邮箱验证功能的服务端边界',
      ],
      breaking: [],
    },
    notes: [
      '新增校园反馈、审核申请与贡献积分',
      '优化账号同步、备份恢复与校园导航',
      '修复同步启动竞态及多个校园页面状态问题',
      '收紧微信内部账号与邮箱验证功能的服务端边界',
    ],
  },
  {
    version: '1.6.0',
    legacyVersion: '2026年10月15日-版本6',
    channel: 'stable',
    summary: '账号登录、同步用量和成果附件优化',
    signature: 'ca2a21c303',
    changes: {
      features: [
      '账号可按配置使用 GitHub 或 Google 登录',
      ],
      improvements: [
      '同步增加本次会话用量估算并减少重复下载',
      '成果附件新上传限制为 5 MB，支持大文件外部链接',
      ],
      fixes: [
      '邮件服务尚未配置时隐藏不可用的注册和找回入口',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '账号可按配置使用 GitHub 或 Google 登录',
      '同步增加本次会话用量估算并减少重复下载',
      '成果附件新上传限制为 5 MB，支持大文件外部链接',
      '邮件服务尚未配置时隐藏不可用的注册和找回入口',
    ],
  },
  {
    version: '1.5.0',
    legacyVersion: '2026年10月15日-版本5',
    channel: 'stable',
    summary: '公开三两豆余额、获取规则与建议奖励',
    signature: '6ec39d73a1',
    changes: {
      features: [
      '公开三两豆余额、获取规则与建议奖励',
      ],
      improvements: [
      '手机导航最多自选五个页面',
      ],
      fixes: [],
      security: [],
      breaking: [],
    },
    notes: [
      '公开三两豆余额、获取规则与建议奖励',
      '手机导航最多自选五个页面',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.7.0'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'cb28c3a1a7'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
