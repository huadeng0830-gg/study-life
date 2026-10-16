import { BookOpen, Bus, CalendarDays, ClipboardList, Compass, GraduationCap, HandHelping, LayoutGrid, MapPin, NotebookPen, Search, ShieldCheck, ShoppingBag, Telescope } from '@lucide/vue'

export const campusNavigation = [
  { label: '校园总览', path: '/campus', icon: LayoutGrid, group: '发现校园', detail: '校园信息、发布、举报与共建入口' },
  { label: '怎么办', path: '/campus/matters', icon: Compass, group: '发现校园', detail: '把现实问题理清楚，找到能试的办法' },
  { label: '校园地点', path: '/campus/places', icon: MapPin, group: '发现校园', detail: '查找并共建同校地点资料' },
  { label: '全站搜索', path: '/campus/search', icon: Search, group: '发现校园' },
  { label: '统一发布', path: '/campus/publish', icon: NotebookPen, group: '参与共建', detail: '分享校园指南、活动、失物与互助信息' },
  { label: '老师与课程', path: '/campus/courses', icon: GraduationCap, group: '学习与出行', detail: '查资料，分享课程体验' },
  { label: '校车出行', path: '/campus/shuttle', icon: Bus, group: '学习与出行', detail: '查线路与计划班次' },
  { label: '校园指南', path: '/campus/guides', icon: BookOpen, group: '学习与出行', detail: '入学、办事与生活经验' },
  { label: '二手集市', path: '/campus/market', icon: ShoppingBag, group: '校园日常', detail: '闲置出售、求购与赠送' },
  { label: '校园互助', path: '/campus/help', icon: HandHelping, group: '校园日常', detail: '找人搭把手，帮人一个忙' },
  { label: '失物招领', path: '/campus/lost-found', icon: Telescope, group: '校园日常', detail: '寻找失物，核验后归还' },
  { label: '活动社团', path: '/campus/events', icon: CalendarDays, group: '校园日常', detail: '发现活动，安排课余时间' },
  { label: '我的投稿', path: '/campus/mine', icon: ClipboardList, group: '我的校园' },
  { label: '我的举报', path: '/campus/reports', icon: ShieldCheck, group: '我的校园' },
  { label: '管理中心', path: '/admin', icon: LayoutGrid, group: '我的校园' },
]
export const campusGroups = [...new Set(campusNavigation.map((item) => item.group))]

/**
 * 校园总览要分组展示服务入口，但同一个数组还被校园地点页和校园生活布局
 * 各过滤了一次，三处各写一套排除规则：某条导航换了位置或新增，
 * 有一处就会漏掉它。
 *
 * 分组与排除在这里各只有一个定义。
 */
export const CAMPUS_FEATURED_PATHS = Object.freeze(['/campus/matters', '/campus/publish', '/campus/mine', '/campus/reports'])
/** 校园总览「常用入口」：不重复出现在下面的服务分类里。 */
export const CAMPUS_NON_SERVICE_PATHS = Object.freeze(['/campus', '/admin'])

export function campusNavigationGrouped({ exclude = [] } = {}) {
  const skip = new Set(exclude)
  return campusGroups
    .map((group) => ({ label: group, items: campusNavigation.filter((item) => item.group === group && !skip.has(item.path)) }))
    .filter((group) => group.items.length)
}

/** 校园地点页的「校园常用」：排除总览自身、浏览与全站搜索。 */
export function campusPlaceServices() {
  return campusNavigation.filter((item) => item.detail && !['/campus', '/campus/places', '/campus/search'].includes(item.path))
}

export { Compass, MapPin }
