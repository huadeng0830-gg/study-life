// 正式版本使用 SemVer；旧网页客户端所需的日期式标识由 release:bump 单独维护。
// 发布时运行 npm run release:bump -- --type patch|minor|major 并填写分类更新说明。
// 脚本会同步两个 package 版本、发布历史、README 和源码签名；生产构建会校验它们。
// RELEASE_UPDATES 仅保留最近 3 条内置说明，完整的简短发布历史保存在 release-history.json。
export const RELEASE_UPDATES = Object.freeze([
  {
    version: '1.1.0',
    legacyVersion: '2026年10月12日-版本1',
    channel: 'stable',
    summary: '以 SemVer 统一网页与 Windows 客户端版本，并建立可验证的更新流程',
    signature: 'b8b80fd873',
    changes: {
      features: [],
      improvements: [],
      fixes: [
      '改进浅色高对比配色、键盘焦点反馈和首页操作按钮的主题对比度',
      '调整全局表面与打印样式顺序，确保两类规则正确生效',
      ],
      security: [],
      breaking: [],
    },
    notes: [
      '改进浅色高对比配色、键盘焦点反馈和首页操作按钮的主题对比度',
      '调整全局表面与打印样式顺序，确保两类规则正确生效',
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
  {
    version: '2026年10月11日-版本1',
    signature: 'aee2384ace',
    notes: [
      '版本与更新采用统一任务状态，检查、下载与安装期间不再出现冲突操作。',
      '新增真实阶段进度、有限重试、诊断复制与重启后的实际版本验证。',
      '更新缓存恢复限定当前应用；Windows 安装确认进程启动后退出，权限失败不自动提权。',
      '使用现有 shadcn 组件重做更新面板，支持手机、深色主题与减少动画设置。',
      '电脑端待办整合视图、搜索与筛选，概览改为紧凑快捷入口，保留历史、导入与批量操作。',
      '电脑端周回顾优先展示复盘与下周事项，摘要收敛，分析按样本展示；侧栏设置入口不再横向拥挤。',
      '手机今天页突出下一行动，待办默认直达底栏，学习导航与高级筛选按需展开。',
      '手机待办采用独立列表和选择布局，复杂编辑全屏显示，兼顾短视口、长文本和触屏横屏。',
      '增大阶段、提醒、批量及月历触摸区域，保留全部入口；例行备份提醒在编辑结束后恢复。',
      '异步操作按钮按真实结果显示成功与错误，取消固定等待，统一动画、重试和减少动态效果。',
      '导航保存补齐防重复提交与关闭后结果隔离，失败保留草稿并支持重新保存。',
      '课表弹窗首次打开时加载，保留关闭动画与重开，并隔离离开页面后的迟到弹窗；日期导航和搜索投影独立维护。',
      '修复课表日期图标与文字动作样式，首页布局恢复时去除重复模块。',
      '同步启动补齐退出或切换账号后的迟到冲突读取校验。',
      '修复账号恢复与同步的身份竞态，隔离跨账号待写数据并保留按账号恢复草稿。',
      '保存失败时保留最新编辑、提供完整性明确的应急导出，并按项显示和清除错误。',
      '补充 P1 数据安全回归测试，覆盖跨账号恢复、未保存草稿和异步版本顺序。',
    ],
  },
])

// SemVer 是面向用户和发布的正式版本。日期式标识只用于旧网页客户端的升级兼容。
export const APP_VERSION = '1.1.0'
export const RELEASE_VERSION = APP_VERSION
export const RELEASE_CHANNEL = 'stable'
export const LEGACY_RELEASE_VERSION = RELEASE_UPDATES[0].legacyVersion || RELEASE_UPDATES[0].version

// 与第一条签名保持一致，交给 vite.config.js 校验源码一致性。
export const RELEASE_SOURCE_SIGNATURE = 'b8b80fd873'

// 兼容旧引用：当前版本的更新说明。
export const RELEASE_NOTES = RELEASE_UPDATES[0].notes
