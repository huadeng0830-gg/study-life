// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.1.1',
    legacyVersion: '2026年10月13日-版本1',
    channel: 'stable',
    summary: '修复网页更新并上线平台运维',
    signature: '82c87c2078',
    changes: {
      features: [
      '新增仅限平台所有者访问的账号运维页，展示真实账号与协作服务状态',
      ],
      improvements: [
      '暂停与恢复账号必须填写原因并记录审计；暂停不会立即撤销未过期的访问令牌',
      ],
      fixes: [
      '修复 1.1.0 构建签名不一致导致网页端阻止刷新的问题，发布独立的 1.1.1 补丁版本',
      ],
      security: [
      '管理请求逐次验证 Supabase 会话和服务端所有者登记',
      ],
      breaking: [],
    },
    notes: [
      '新增仅限平台所有者访问的账号运维页，展示真实账号与协作服务状态',
      '暂停与恢复账号必须填写原因并记录审计；暂停不会立即撤销未过期的访问令牌',
      '修复 1.1.0 构建签名不一致导致网页端阻止刷新的问题，发布独立的 1.1.1 补丁版本',
      '管理请求逐次验证 Supabase 会话和服务端所有者登记',
    ],
  },
  {
    version: '1.1.0',
    legacyVersion: '2026年10月12日-版本1',
    channel: 'stable',
    summary: '以 SemVer 统一网页与 Windows 客户端版本，并建立可验证的更新流程',
    signature: 'deed9b789a',
    changes: {
      features: [
      '新增个人管理中心，集中查看本机数据、保存状态和账号同步事项',
      ],
      improvements: [
      '从桌面侧栏和手机更多入口进入，并直达现有业务管理页面',
      '管理页适配现有移动端断点与标题层级规范',
      ],
      fixes: [
      '改进浅色高对比配色、键盘焦点反馈和首页操作按钮的主题对比度',
      '调整全局表面与打印样式顺序，确保两类规则正确生效',
      '修正首次读取数据时误显示为无待处理事项',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '新增个人管理中心，集中查看本机数据、保存状态和账号同步事项',
      '从桌面侧栏和手机更多入口进入，并直达现有业务管理页面',
      '管理页适配现有移动端断点与标题层级规范',
      '改进浅色高对比配色、键盘焦点反馈和首页操作按钮的主题对比度',
      '调整全局表面与打印样式顺序，确保两类规则正确生效',
      '修正首次读取数据时误显示为无待处理事项',
    ],
  },
  {
    version: '2026年10月11日-版本2',
    signature: 'aee4defa00',
    notes: [
      '日程时间刻度改为首尾相接的循环滚轮，分钟精确到每一分钟，已有时间原样落位',
      '去掉滚轮上下淡出遮罩，并修复刻度列宽、滚动与时间选择问题',
      '调整桌面侧栏与今天页层级，优化内容区留白、快捷入口和中文字体',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.1.1'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '82c87c2078'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
