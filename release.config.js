// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.11.3',
    legacyVersion: '2026年10月17日-版本1',
    channel: 'stable',
    summary: '三两豆兑换数字权益并查看归属与贡献豆流水',
    signature: '10f214b1dd',
    changes: {
      features: [
      '三两豆兑换数字权益并查看归属与贡献豆流水',
      ],
      improvements: [
      '已就绪的新版本可安全自动应用，全局和手机端都会提示更新',
      ],
      fixes: [
      '修复标签页并行编辑时的未保存保护，补齐校园队列索引和反馈审计',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '三两豆兑换数字权益并查看归属与贡献豆流水',
      '已就绪的新版本可安全自动应用，全局和手机端都会提示更新',
      '修复标签页并行编辑时的未保存保护，补齐校园队列索引和反馈审计',
    ],
  },
  {
    version: '1.11.2',
    legacyVersion: '2026年10月16日-版本6',
    channel: 'stable',
    summary: '账号封禁与禁发支持自定义期限，处理通知清晰可见',
    signature: '1c8dd69e8a',
    changes: {
      features: [],
      improvements: [
      '账号封禁与禁止发布独立管理，支持任意分钟、小时、天和指定解除时间',
      '增加永久限制、单独提前解除和到期自动恢复',
      '账号展示处理原因、剩余期限和解除通知，封禁后进入告知页',
      '管理弹窗适配手机和桌面，确认前可预览解除时间',
      ],
      fixes: [
      '防止过期管理页面覆盖新限制',
      '封禁期间暂停云端同步，退出前保留备份确认',
      '统一约束旧会话、内容重提与文件访问路径',
      ],
      security: [
      '限制状态与审计通知原子保存，账号仅能查询本人的处理说明',
      ],
      breaking: [],
    },
    notes: [
      '账号封禁与禁止发布独立管理，支持任意分钟、小时、天和指定解除时间',
      '增加永久限制、单独提前解除和到期自动恢复',
      '账号展示处理原因、剩余期限和解除通知，封禁后进入告知页',
      '管理弹窗适配手机和桌面，确认前可预览解除时间',
      '防止过期管理页面覆盖新限制',
      '封禁期间暂停云端同步，退出前保留备份确认',
      '统一约束旧会话、内容重提与文件访问路径',
      '限制状态与审计通知原子保存，账号仅能查询本人的处理说明',
    ],
  },
  {
    version: '1.11.1',
    legacyVersion: '2026年10月16日-版本5',
    channel: 'stable',
    summary: '降低云端读取与首屏开销，增强弱网和后台恢复',
    signature: '0f49be9a02',
    changes: {
      features: [],
      improvements: [
      '减少首页分包请求与无意图预加载',
      '管理员列表批量查询邮箱，我的投稿只读取所需摘要',
      '限制读取缓存大小并合并重复请求',
      ],
      fixes: [
      '切换搜索和离开页面时取消过时读取',
      '后台通知恢复后补读，避免遗漏变化',
      '公开服务限流或超时时退避，避免重复冲击上游',
      ],
      security: [
      '保持私有数据隔离，批量邮箱查询仅授权服务端可用',
      ],
      breaking: [],
    },
    notes: [
      '减少首页分包请求与无意图预加载',
      '管理员列表批量查询邮箱，我的投稿只读取所需摘要',
      '限制读取缓存大小并合并重复请求',
      '切换搜索和离开页面时取消过时读取',
      '后台通知恢复后补读，避免遗漏变化',
      '公开服务限流或超时时退避，避免重复冲击上游',
      '保持私有数据隔离，批量邮箱查询仅授权服务端可用',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.11.3'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '10f214b1dd'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
