// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { useTaskViewQuery } from '../src/composables/tasks/useTaskViewQuery.js'

let app, host

async function mountQuery(url = '/tasks?f=all') {
  let model
  const component = {
    setup() {
      model = useTaskViewQuery({ searchDelay: 5 })
      return () => h('div', model.state.value.q)
    },
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/tasks', component },
  ] })
  await router.push(url)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(host)
  await nextTick()
  return { model, router }
}

afterEach(() => {
  app?.unmount()
  host?.remove()
})

describe('待办筛选的真实异步路由', () => {
  it('连续操作保留尚未进入 URL 的筛选、排序和视图', async () => {
    const { model, router } = await mountQuery()
    model.apply({ priority: 'low' }, { also: { view: 'board' } })
    model.apply({ sort: 'created' })
    model.apply({ period: 'unplanned' })
    expect(model.state.value).toMatchObject({ priority: 'low', sort: 'created', dir: 'desc', period: 'unplanned' })
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ f: 'all', prio: 'low', sort: 'created', when: 'unplanned', view: 'board' }))
  })

  it('等待导航守卫期间继续筛选不会丢掉前一项选择', async () => {
    const { model, router } = await mountQuery()
    let release, entered = false
    const gate = new Promise((resolve) => { release = resolve })
    router.beforeEach(async () => { entered = true; await gate })
    model.apply({ sort: 'created' })
    await vi.waitFor(() => expect(entered).toBe(true))
    model.apply({ priority: 'high' })
    release()
    expect(model.state.value).toMatchObject({ sort: 'created', priority: 'high', dir: 'desc' })
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ f: 'all', sort: 'created', prio: 'high' }))
  })

  it('切换排序后立即翻转方向仍以刚选的排序为准', async () => {
    const { model, router } = await mountQuery()
    model.apply({ sort: 'created' })
    model.toggleSortDirection()
    expect(model.state.value).toMatchObject({ sort: 'created', dir: 'asc' })
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ f: 'all', sort: 'created', dir: 'asc' }))
  })

  it('前进后退回到自己曾写过的地址也会恢复状态', async () => {
    const { model, router } = await mountQuery()
    model.apply({ priority: 'low' })
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBe('low'))
    await router.push('/tasks?f=all&prio=high&q=other')
    await nextTick()
    expect(model.state.value.priority).toBe('high')
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBe('low'))
    expect(model.state.value.priority).toBe('low')
    expect(model.queryInput.value).toBe('')
    router.forward()
    await vi.waitFor(() => expect(model.state.value.q).toBe('other'))
    expect(model.state.value.priority).toBe('high')
  })

  it('用户显式选择默认的已安排状态也写入地址，自动默认保持无参数', async () => {
    const { model, router } = await mountQuery('/tasks')
    expect(router.currentRoute.value.query).toEqual({})
    expect(model.filterTouched.value).toBe(false)
    model.apply({ filter: 'scheduled' }, { touchFilter: true })
    await vi.waitFor(() => expect(router.currentRoute.value.query.f).toBe('scheduled'))
    model.apply({ priority: 'high' })
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ f: 'scheduled', prio: 'high' }))
  })

  it('导航被拒绝时恢复实际地址的状态，给出错误后允许重试', async () => {
    const { model, router } = await mountQuery()
    const removeGuard = router.beforeEach(() => false)
    const finished = new Promise((resolve) => router.afterEach(resolve))
    model.apply({ priority: 'low' })
    await finished
    await nextTick()
    expect(model.state.value.priority).toBe('all')
    expect(model.navigationError.value).toBeTruthy()
    removeGuard()
    model.apply({ priority: 'low' })
    await vi.waitFor(() => expect(router.currentRoute.value.query.prio).toBe('low'))
    expect(model.navigationError.value).toBe('')
  })

  it('导航异常由调用处接住，搜索输入和结果一起恢复', async () => {
    const { model, router } = await mountQuery('/tasks?f=all&q=before')
    const failed = new Promise((resolve) => router.onError(resolve))
    router.beforeEach(() => { throw new Error('synthetic navigation failure') })
    model.apply({ q: 'after' })
    await failed
    await vi.waitFor(() => expect(model.state.value.q).toBe('before'))
    expect(model.queryInput.value).toBe('before')
    expect(model.searchQuery.value).toBe('before')
    expect(model.navigationError.value).toBeTruthy()
  })

  it('后退到干净地址时重新启用智能默认', async () => {
    const { model, router } = await mountQuery('/tasks')
    await router.push('/tasks?f=scheduled')
    await nextTick()
    expect(model.filterTouched.value).toBe(true)
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({}))
    expect(model.filterTouched.value).toBe(false)
  })

  it('旧导航的失败结果不能覆盖后完成的新选择', async () => {
    const { model, router } = await mountQuery()
    let release, entered = false
    const gate = new Promise((resolve) => { release = resolve })
    router.beforeEach(async (to) => {
      if (to.query.prio === 'low') { entered = true; await gate; return false }
    })
    const previous = model.apply({ priority: 'low' })
    await vi.waitFor(() => expect(entered).toBe(true))
    await model.apply({ priority: 'high' })
    release()
    await previous
    expect(model.state.value.priority).toBe('high')
    expect(router.currentRoute.value.query.prio).toBe('high')
    expect(model.navigationError.value).toBe('')
  })

  it('外部导航使未完成的本页写入失效', async () => {
    const { model, router } = await mountQuery()
    let release, entered = false
    const gate = new Promise((resolve) => { release = resolve })
    router.beforeEach(async (to) => {
      if (to.query.sort === 'created') { entered = true; await gate }
    })
    const previous = model.apply({ sort: 'created' })
    await vi.waitFor(() => expect(entered).toBe(true))
    await router.push('/tasks?f=unplanned&prio=high')
    release()
    await previous
    expect(model.state.value).toMatchObject({ filter: 'unplanned', sort: 'due', priority: 'high' })
    expect(model.navigationError.value).toBe('')
  })

  it('两次写入等待守卫时后退到旧目标地址仍立即恢复，再操作沿用该地址', async () => {
    const { model, router } = await mountQuery('/tasks?f=all&prio=low')
    await router.push('/tasks?f=all')
    let releaseLow, releaseHigh, lowEntered = false, highEntered = false
    const lowGate = new Promise((resolve) => { releaseLow = resolve })
    const highGate = new Promise((resolve) => { releaseHigh = resolve })
    let lowCalls = 0, highCalls = 0
    router.beforeEach(async (to) => {
      if (to.query.prio === 'low' && ++lowCalls === 1) { lowEntered = true; await lowGate }
      if (to.query.prio === 'high' && ++highCalls === 1) { highEntered = true; await highGate }
    })
    const previous = model.apply({ priority: 'low' })
    await vi.waitFor(() => expect(lowEntered).toBe(true))
    const latest = model.apply({ priority: 'high' })
    await vi.waitFor(() => expect(highEntered).toBe(true))
    try {
      const backFinished = new Promise((resolve) => router.afterEach((to, from, failure) => {
        if (to.query.prio === 'low' && !failure) resolve()
      }))
      router.back()
      await backFinished
      await nextTick()
      expect(model.state.value.priority).toBe('low')
      await model.apply({ sort: 'created' })
      expect(router.currentRoute.value.query).toEqual({ f: 'all', prio: 'low', sort: 'created' })
    } finally {
      releaseLow()
      releaseHigh()
      await Promise.all([previous, latest])
    }
    expect(model.state.value).toMatchObject({ priority: 'low', sort: 'created' })
    expect(model.navigationError.value).toBe('')
  })
})
