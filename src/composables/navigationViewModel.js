import { computed, ref } from 'vue'
import { accountUser } from './accountAuth.js'
import { availableNavigationItems } from '../router/navigation.js'
import { FIXED_MOBILE_NAV_ITEMS, desktopNavigation, mobileNavigation, visibleDesktopNavigation, visibleNavigationItems } from './navigationPreferences.js'

/** Build the desktop and mobile menu projections from the same saved route IDs. */
export function useNavigationViewModel(currentRoute, accountLabel) {
  const availableItems = computed(() => availableNavigationItems(accountUser.value))
  const collapsedGroups = ref({ other: true })
  const desktopGroups = computed(() => visibleDesktopNavigation(desktopNavigation.value, accountUser.value).map((group) => ({
    ...group,
    collapsed: Boolean(collapsedGroups.value[group.id]),
  })))
  const bottomItems = computed(() => visibleNavigationItems(mobileNavigation.value, accountUser.value))
  const mobileBarItems = computed(() => bottomItems.value.length + FIXED_MOBILE_NAV_ITEMS)
  const moreHasCurrentPage = computed(() => !bottomItems.value.some((item) => item.path === currentRoute.path))
  const moreGroups = computed(() => {
    const bottomIds = new Set(bottomItems.value.map((item) => item.id))
    const groups = new Map()
    for (const item of availableItems.value) {
      if (bottomIds.has(item.id)) continue
      if (!groups.has(item.groupId)) groups.set(item.groupId, { id: item.groupId, label: item.groupLabel, items: [], tools: [] })
      groups.get(item.groupId).items.push(item)
    }
    const common = { id: 'common', label: '常用', items: [], tools: [
      { key: 'account', label: accountLabel, icon: '👤' },
      { key: 'update', label: '版本与更新', icon: '↻' },
    ] }
    const tools = [
      { id: 'mobile-tools', label: '搜索与导航', items: [], tools: [
        { key: 'search', label: '搜索', icon: '🔍' },
        { key: 'navigation', label: '编辑导航', icon: '☷' },
      ] },
      { id: 'personalization', label: '个性化与专注', items: [], tools: [
        { key: 'appearance', label: '个性化', icon: '🎨' },
        { key: 'festive', label: '氛围与纪念日', icon: '🎉' },
        { key: 'focus', label: '专注设置', icon: '⏱' },
        { key: 'quick-record', label: '快速记录设置', icon: '⚡' },
      ] },
      { id: 'account-tools', label: '账号、数据与系统', items: [], tools: [
        { key: 'data', label: '数据管理', icon: '💾' },
      ] },
    ]
    return [common, ...groups.values(), ...tools]
  })

  function toggleGroup(id) {
    collapsedGroups.value = { ...collapsedGroups.value, [id]: !collapsedGroups.value[id] }
  }

  return {
    desktopGroups,
    bottomItems,
    mobileBarItems,
    moreHasCurrentPage,
    moreGroups,
    toggleGroup,
  }
}
