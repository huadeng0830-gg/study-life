// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const loaded = vi.hoisted(() => new Set())
vi.mock('../src/components/schedule/CourseEditorModal.vue', () => { loaded.add('editor'); return { __esModule: true, default: { name: 'CourseEditorModal', props: ['open'], template: '<div v-if="open" data-test="editor"></div>' } } })
vi.mock('../src/components/schedule/CourseManagerModal.vue', () => { loaded.add('manager'); return { __esModule: true, default: { name: 'CourseManagerModal', props: ['open'], template: '<div v-if="open" data-test="manager"></div>' } } })
vi.mock('../src/components/schedule/BatchImportModal.vue', () => { loaded.add('batch'); return { __esModule: true, default: { template: '<div></div>' } } })
vi.mock('../src/components/schedule/ImageCropModal.vue', () => { loaded.add('crop'); return { __esModule: true, default: { template: '<div></div>' } } })
vi.mock('../src/components/schedule/ImportConflictModal.vue', () => { loaded.add('conflict'); return { __esModule: true, default: { template: '<div></div>' } } })
vi.mock('../src/components/schedule/ExceptionsModal.vue', () => { loaded.add('exceptions'); return { __esModule: true, default: { template: '<div></div>' } } })
vi.mock('../src/components/schedule/SemesterModal.vue', () => { loaded.add('semester'); return { __esModule: true, default: { template: '<div></div>' } } })
vi.mock('../src/components/schedule/TimeSettingsModal.vue', () => { loaded.add('time'); return { __esModule: true, default: { methods: { stopBackgroundWork() {} }, template: '<div></div>' } } })
vi.mock('../src/components/QuickRecordPanel.vue', () => { loaded.add('quick-record'); return { __esModule: true, default: { template: '<div></div>' } } })

let app, host
afterEach(() => { app?.unmount(); host?.remove() })

describe('课表首次查看的弹窗加载边界', () => {
  it('关闭时不导入弹窗；打开编辑/管理只加载该入口，关闭后保留实例', async () => {
    const ScheduleView = (await import('../src/views/ScheduleView.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/schedule', component: ScheduleView }] })
    await router.push('/schedule')
    await router.isReady()
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(ScheduleView) }).use(router)
    app.mount(host)
    await new Promise(resolve => setTimeout(resolve, 100))
    console.info('[schedule-cold-dialog-imports]', loaded.size, [...loaded])
    expect([...loaded]).toEqual([])
    const add = [...host.querySelectorAll('button')].find(button => button.textContent.includes('添加课程'))
    add.click()
    await vi.waitFor(() => expect(host.querySelector('[data-test="editor"]')).toBeTruthy())
    expect([...loaded]).toEqual(['editor'])
    // Inspect the actual page's component tree so a v-if tied directly to open
    // cannot silently destroy a loaded editor on close.
    function componentInstances(node, name, result = []) {
      if (!node) return result
      if (node.component) {
        if (node.component.type.name === name) result.push(node.component)
        componentInstances(node.component.subTree, name, result)
      }
      if (Array.isArray(node.children)) node.children.forEach(child => componentInstances(child, name, result))
      return result
    }
    const instance = componentInstances(app._instance.subTree, 'CourseEditorModal')[0]
    instance.emit('close')
    await nextTick()
    expect(host.querySelector('[data-test="editor"]')).toBeNull()
    expect(componentInstances(app._instance.subTree, 'CourseEditorModal')[0]).toBe(instance)
    add.click()
    await nextTick()
    expect(host.querySelector('[data-test="editor"]')).toBeTruthy()
    instance.emit('close')
    await nextTick()
    ;[...host.querySelectorAll('button')].find(button => button.textContent.includes('课表设置')).click()
    await nextTick()
    const manage = [...host.querySelectorAll('button')].find(button => button.textContent.includes('批量管理'))
    manage.click()
    await vi.waitFor(() => expect(host.querySelector('[data-test="manager"]')).toBeTruthy())
    expect([...loaded]).toEqual(['editor', 'manager'])
  })
})
