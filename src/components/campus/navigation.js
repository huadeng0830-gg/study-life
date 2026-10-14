import { BookOpen, Bus, CalendarDays, ClipboardList, Compass, GraduationCap, HandHelping, LayoutGrid, MapPin, NotebookPen, Search, ShoppingBag, Telescope } from '@lucide/vue'

export const campusNavigation = [
  { label: '校园总览', path: '/campus', icon: LayoutGrid, group: '发现校园' },
  { label: '全站搜索', path: '/campus/search', icon: Search, group: '发现校园' },
  { label: '老师与课程', path: '/campus/courses', icon: GraduationCap, group: '学习与出行', detail: '查资料，分享课程体验' },
  { label: '校车出行', path: '/campus/shuttle', icon: Bus, group: '学习与出行', detail: '查线路与计划班次' },
  { label: '校园指南', path: '/campus/guides', icon: BookOpen, group: '学习与出行', detail: '入学、办事与生活经验' },
  { label: '二手集市', path: '/campus/market', icon: ShoppingBag, group: '校园日常', detail: '闲置出售、求购与赠送' },
  { label: '校园互助', path: '/campus/help', icon: HandHelping, group: '校园日常', detail: '找人搭把手，帮人一个忙' },
  { label: '失物招领', path: '/campus/lost-found', icon: Telescope, group: '校园日常', detail: '寻找失物，核验后归还' },
  { label: '活动社团', path: '/campus/events', icon: CalendarDays, group: '校园日常', detail: '发现活动，安排课余时间' },
  { label: '我的投稿', path: '/campus/mine', icon: ClipboardList, group: '我的校园' },
  { label: '统一发布', path: '/campus/publish', icon: NotebookPen, group: '我的校园' },
]
export const campusGroups = [...new Set(campusNavigation.map((item) => item.group))]
export { Compass, MapPin }
