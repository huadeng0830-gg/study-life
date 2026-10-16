export const adminSections = Object.freeze([
  { id: 'overview', title: '管理概览', group: '工作台', path: '/admin', icon: 'LayoutDashboard' },
  { id: 'feedback', title: '反馈处理', group: '工作台', path: '/admin/feedback', icon: 'MessagesSquare', owner: true },
  { id: 'campus', title: '内容审核', group: '工作台', path: '/admin/campus', icon: 'ClipboardCheck', reviewer: true },
  { id: 'places', title: '地点审核', group: '工作台', path: '/platform-admin?section=places', icon: 'MapPin', owner: true },
  { id: 'team', title: '审核人员', group: '平台管理', path: '/admin/campus?tab=reviewers', icon: 'UsersRound', owner: true },
  { id: 'accounts', title: '账号管理', group: '平台管理', path: '/platform-admin?section=accounts', icon: 'ContactRound', owner: true },
  { id: 'activity', title: '操作记录', group: '平台管理', path: '/platform-admin?section=activity', icon: 'History', owner: true },
  { id: 'system', title: '运行维护', group: '平台管理', path: '/platform-admin?section=system', icon: 'Activity', owner: true },
  { id: 'data', title: '本机数据', group: '设备工具', path: '/admin?section=data', icon: 'Database' },
])
export function adminSectionForRoute(route) {
  if (route.path === '/admin/feedback') return 'feedback'
  if (route.path === '/admin/campus') return ['reviewers', 'applications', 'audits'].includes(route.query.tab) ? 'team' : 'campus'
  if (route.path === '/platform-admin') return ['places', 'accounts', 'activity', 'system'].includes(route.query.section) ? route.query.section : 'system'
  return route.query.section === 'data' ? 'data' : 'overview'
}
export function visibleAdminSections(access) {
  return adminSections.filter(item => (!item.owner || access?.owner) && (!item.reviewer || access?.reviewer))
}

export function adminTitleForRoute(route) {
  if (!['/admin', '/admin/feedback', '/admin/campus', '/platform-admin'].includes(route.path)) return ''
  return adminSections.find(item => item.id === adminSectionForRoute(route))?.title || '管理中心'
}
