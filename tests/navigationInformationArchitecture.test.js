// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { routes } from '../src/router/routes.js'
import { desktopNavigationGroups, desktopShortcutRoutes, navigationRegistry } from '../src/router/navigation.js'
import { routeLoaders } from '../src/router/routePreload.js'
import { DEFAULT_MOBILE_NAVIGATION, normalizeMobileNavigation } from '../src/composables/navigationPreferences.js'

describe('导航信息架构', () => {
  it('只把真实页面注册为导航项，一级分组聚焦四个核心空间，低频页面收进其他', () => {
    expect(navigationRegistry).toHaveLength(12)
    expect(new Set(navigationRegistry.map((item) => item.path)).size).toBe(navigationRegistry.length)
    expect(desktopNavigationGroups.map((group) => group.label)).toEqual(['今日', '学习', '日程', '齐行', '其他'])
    expect(desktopNavigationGroups.find((group) => group.id === 'learning').items.map((item) => item.id)).toEqual(['schedule', 'course', 'tasks', 'exams'])
    expect(desktopNavigationGroups.find((group) => group.id === 'other').items.map((item) => item.id)).toEqual(['lists', 'bills', 'places', 'review'])
    expect(navigationRegistry.find((item) => item.id === 'schedule').mobileLabel).toBe('课表')
    expect(routes.find((route) => route.path === '/notes')?.redirect).toBe('/')
  })

  it('保持既有数字快捷键映射，手机最多自选三个页面并保留两个常驻入口', () => {
    expect(desktopShortcutRoutes).toEqual(['/', '/schedule', '/tasks', '/exams', '/lists', '/bills', '/events', '/review'])
    expect(DEFAULT_MOBILE_NAVIGATION).toEqual(['today', 'tasks', 'schedule'])
    expect(normalizeMobileNavigation(['tasks', 'tasks', 'course', 'bills', 'events'])).toEqual(['tasks', 'course', 'bills'])
    expect(normalizeMobileNavigation(['tasks', 'course', 'bills', 'events', 'projects'])).toHaveLength(3)
  })

  it('注册可直达但不混入业务导航的管理中心懒加载路由', () => {
    const adminRoute = routes.find((route) => route.path === '/admin')

    expect(adminRoute).toMatchObject({ name: 'admin-center', meta: { title: '管理中心' } })
    expect(adminRoute.meta.navigation).toBeUndefined()
    expect(routeLoaders['/admin']).toBeTypeOf('function')
    expect(navigationRegistry.some((item) => item.path === '/admin')).toBe(false)
  })
})
