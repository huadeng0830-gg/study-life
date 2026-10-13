// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.1.2',
    legacyVersion: '2026年10月13日-版本2',
    channel: 'stable',
    summary: '管理中心新增可复制的诊断信息，含版本、结构版本、分区计数与静默失败的作用域',
    signature: '39f19577e3',
    changes: {
      features: [],
      improvements: [
      '管理中心新增可复制的诊断信息，含版本、结构版本、分区计数与静默失败的作用域',
      ],
      fixes: [
      '本机写入失败时不再静默：管理中心会提示有多少项修改尚未保存，避免刷新后丢失',
      '修正分区清单指向：专注记录不再跳到无关的周回顾页，无页面的分区改为显示实际归属',
      '修正运行状态列表的无效 dl 结构，并去除同屏重复的刷新按钮与分区明细',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '管理中心新增可复制的诊断信息，含版本、结构版本、分区计数与静默失败的作用域',
      '本机写入失败时不再静默：管理中心会提示有多少项修改尚未保存，避免刷新后丢失',
      '修正分区清单指向：专注记录不再跳到无关的周回顾页，无页面的分区改为显示实际归属',
      '修正运行状态列表的无效 dl 结构，并去除同屏重复的刷新按钮与分区明细',
    ],
  },
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
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.1.2'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = '39f19577e3'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
