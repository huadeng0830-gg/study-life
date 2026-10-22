// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { routes } from '../src/router/routes.js'
import { desktopNavigationGroups, desktopShortcutRoutes, navigationRegistry } from '../src/router/navigation.js'
import { routeLoaders } from '../src/router/routePreload.js'
import { DEFAULT_MOBILE_NAVIGATION, normalizeMobileNavigation } from '../src/composables/navigationPreferences.js'
import { useNavigationViewModel } from '../src/composables/navigationViewModel.js'
import { SETTINGS_NAVIGATION_LABEL } from '../src/composables/settingsPolicy.js'

describe('导航信息架构', () => {
  it('只把真实页面注册为导航项，三个分组按学习、生活和校园协作组织', () => {
    expect(navigationRegistry).toHaveLength(13)
    expect(new Set(navigationRegistry.map((item) => item.path)).size).toBe(navigationRegistry.length)
    expect(desktopNavigationGroups.map((group) => group.label)).toEqual(['学习与计划', '生活与回顾', '校园与协作'])
    expect(desktopNavigationGroups.find((group) => group.id === 'workspace').items.map((item) => item.id)).toEqual(['today', 'schedule', 'course', 'tasks', 'exams', 'events'])
    expect(desktopNavigationGroups.find((group) => group.id === 'campus').items.map((item) => item.id)).toEqual(['places', 'together', 'projects', 'feedback'])
    expect(desktopNavigationGroups.find((group) => group.id === 'life').items.map((item) => item.id)).toEqual(['lists', 'bills', 'review'])
    expect(routes.find((route) => route.path === '/places')?.redirect).toBe('/campus/places')
    expect(navigationRegistry.find((item) => item.id === 'schedule').mobileLabel).toBe('课表')
    expect(routes.find((route) => route.path === '/notes')?.redirect).toBe('/')
  })

  it('保持既有数字快捷键映射，手机最多自选五个页面并保留两个常驻入口', () => {
    expect(desktopShortcutRoutes).toEqual(['/', '/schedule', '/tasks', '/exams', '/lists', '/bills', '/events', '/review'])
    expect(DEFAULT_MOBILE_NAVIGATION).toEqual(['today', 'schedule', 'tasks'])
    expect(normalizeMobileNavigation(['today', 'tasks', 'schedule'])).toEqual(['today', 'schedule', 'tasks'])
    expect(normalizeMobileNavigation(['tasks', 'tasks', 'course', 'bills', 'events'])).toEqual(['tasks', 'course', 'bills', 'events'])
    expect(normalizeMobileNavigation(['tasks', 'course', 'bills', 'events', 'projects', 'schedule'])).toHaveLength(5)
  })

  it('注册可直达但不混入业务导航的管理中心懒加载路由', () => {
    const adminRoute = routes.find((route) => route.path === '/admin')

    expect(adminRoute).toMatchObject({ name: 'admin-center', meta: { title: '管理中心' } })
    expect(adminRoute.meta.navigation).toBeUndefined()
    expect(routeLoaders['/admin']).toBeTypeOf('function')
    expect(navigationRegistry.some((item) => item.path === '/admin')).toBe(false)
  })

  it('为校园业务区注册投稿记录页和真实懒加载器', () => {
    const mineRoute = routes.find((route) => route.path === '/campus/mine')

    expect(mineRoute).toMatchObject({ name: 'campus-mine', meta: { title: '我的校园投稿' } })
    expect(routeLoaders['/campus/mine']).toBeTypeOf('function')
  })

  it('把校园功能总览设为直接入口，并将原有地点页保留在独立地址', () => {
    expect(routes.find((route) => route.path === '/campus')).toMatchObject({ name: 'campus', meta: { title: '校园' } })
    expect(routeLoaders['/campus']).toBeTypeOf('function')
    expect(routes.find((route) => route.path === '/campus/places')).toMatchObject({ name: 'campus-places', meta: { title: '校园地点' } })
    expect(routeLoaders['/campus/places']).toBeTypeOf('function')
    expect(routes.find((route) => route.path === '/places')?.redirect).toBe('/campus/places')
    expect(navigationRegistry.find((item) => item.id === 'places')?.path).toBe('/campus')
  })

  it('用同一名称指向覆盖快速记录、全局默认值和提醒的设置入口', () => {
    const navigation = useNavigationViewModel({ path: '/' }, '我的账号')
    const tool = navigation.moreGroups.value.find((group) => group.id === 'personalization')
      ?.tools.find((item) => item.key === 'quick-record')

    expect(SETTINGS_NAVIGATION_LABEL).toBe('记录与提醒设置')
    expect(tool?.label).toBe(SETTINGS_NAVIGATION_LABEL)
  })

  it.each(['/campus/reviewer-application', '/campus/guides'])('校园子页 %s 在更多可达，且支持校园入口的激活判断', (path) => {
    const navigation = useNavigationViewModel({ path }, '我的账号')
    const campus = navigationRegistry.find((item) => item.id === 'places')

    expect(campus).toBeDefined()
    expect(navigation.isBottomItemActive(campus)).toBe(true)
    expect(navigation.moreHasCurrentPage.value).toBe(true)
    expect(navigation.moreGroups.value.flatMap(group => group.items).some(item => item.id === 'places')).toBe(true)
  })
})

it('反馈只有独立入口，校园旧地址已删除', () => {
  expect(routes.some(route => route.path === '/campus/feedback')).toBe(false)
  expect(routeLoaders['/campus/feedback']).toBeUndefined()
  expect(navigationRegistry.find(item => item.id === 'feedback')).toMatchObject({ path: '/feedback', groupId: 'campus' })
  const model = useNavigationViewModel({ path: '/feedback' }, '我的账号')
  expect(model.moreGroups.value.flatMap(group => group.items).some(item => item.id === 'feedback')).toBe(true)
  expect(model.bottomItems.value.filter(model.isBottomItemActive)).toHaveLength(0)
})
