// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useNavigationEditor } from '../src/composables/navigationEditor.js'
import { DEFAULT_DESKTOP_NAVIGATION, DEFAULT_MOBILE_NAVIGATION, DESKTOP_NAVIGATION_KEY, MOBILE_NAVIGATION_KEY, MAX_DESKTOP_NAV_GROUPS } from '../src/composables/navigationPreferences.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const clone = (value) => JSON.parse(JSON.stringify(value))
const scopes = []
afterEach(() => { scopes.splice(0).forEach((scope) => scope.stop()) })

function setup(options = {}) {
  const mobile = ref([...DEFAULT_MOBILE_NAVIGATION])
  const desktop = ref(clone(DEFAULT_DESKTOP_NAVIGATION))
  const user = ref(null)
  const persist = vi.fn(async (values) => {
    if (values[MOBILE_NAVIGATION_KEY]) mobile.value = clone(values[MOBILE_NAVIGATION_KEY])
    if (values[DESKTOP_NAVIGATION_KEY]) desktop.value = clone(values[DESKTOP_NAVIGATION_KEY])
  })
  const scope = effectScope()
  scopes.push(scope)
  const editor = scope.run(() => useNavigationEditor({ mobile, desktop, user, persist, ...options }))
  return { editor, mobile, desktop, user, persist }
}

describe('navigation editing sessions', () => {
  it('keeps both devices isolated until one combined save, then publishes both layouts', async () => {
    const { editor, mobile, desktop, persist } = setup()
    editor.apply({ type: 'mobile:remove', id: 'today' })
    editor.mode.value = 'desktop'
    editor.apply({ type: 'desktop:rename-group', id: 'learning', label: '我的学习' })
    expect(mobile.value).toEqual(DEFAULT_MOBILE_NAVIGATION)
    expect(desktop.value[1].label).toBe('学习')
    expect(editor.dirty.value).toEqual({ mobile: true, desktop: true })
    expect(await editor.save()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0]).toHaveProperty(MOBILE_NAVIGATION_KEY)
    expect(persist.mock.calls[0][0]).toHaveProperty(DESKTOP_NAVIGATION_KEY)
    expect(mobile.value).toEqual(['schedule', 'events'])
    expect(desktop.value[1].label).toBe('我的学习')
    expect(editor.hasChanges.value).toBe(false)
    expect(editor.canUndo.value).toBe(false)
  })

  it('has independent device history, coalesces one rename session, and invalidates redo after a new edit', async () => {
    const { editor } = setup()
    editor.apply({ type: 'mobile:remove', id: 'today' })
    editor.mode.value = 'desktop'
    await nextTick()
    editor.apply({ type: 'desktop:rename-group', id: 'learning', label: '我的' }, { batch: 'rename-1' })
    editor.apply({ type: 'desktop:rename-group', id: 'learning', label: '我的学习' }, { batch: 'rename-1' })
    editor.undo()
    expect(editor.drafts.value.desktop[1].label).toBe('学习')
    expect(editor.drafts.value.mobile).toEqual(['schedule', 'events'])
    editor.redo()
    expect(editor.drafts.value.desktop[1].label).toBe('我的学习')
    editor.mode.value = 'mobile'
    await nextTick()
    editor.undo()
    expect(editor.dirty.value).toEqual({ mobile: false, desktop: true })
    editor.apply({ type: 'mobile:move', id: 'today', to: 2 })
    expect(editor.canRedo.value).toBe(false)
  })

  it('stages defaults without writing, allows undo, and restores the exact custom layout', () => {
    const { editor, mobile, persist } = setup()
    editor.apply({ type: 'mobile:remove', id: 'today' })
    editor.apply({ type: 'defaults' })
    expect(persist).not.toHaveBeenCalled()
    expect(mobile.value).toEqual(DEFAULT_MOBILE_NAVIGATION)
    expect(editor.hasChanges.value).toBe(false)
    editor.undo()
    expect(editor.drafts.value.mobile).toEqual(['schedule', 'events'])
    expect(editor.hasChanges.value).toBe(true)
  })

  it('keeps all pages when removing a group, supports an explicit pin destination, and undoes both', () => {
    const { editor } = setup({ initialMode: 'desktop' })
    const before = clone(editor.drafts.value.desktop)
    editor.apply({ type: 'desktop:remove-group', id: 'learning', groupId: 'workspace' })
    expect(editor.drafts.value.desktop[0].items).toEqual(['today', 'schedule', 'course', 'tasks', 'exams'])
    expect(editor.drafts.value.desktop.flatMap((group) => group.items).sort()).toEqual(before.flatMap((group) => group.items).sort())
    editor.undo()
    expect(editor.drafts.value.desktop).toEqual(before)
    editor.apply({ type: 'desktop:unpin', id: 'tasks' })
    editor.apply({ type: 'desktop:pin', id: 'tasks', groupId: 'qixing' })
    expect(editor.drafts.value.desktop.find((group) => group.id === 'qixing').items).toContain('tasks')
    expect(editor.drafts.value.desktop.flatMap((group) => group.items).filter((id) => id === 'tasks')).toHaveLength(1)
  })

  it('rejects over-capacity edits and invalid names before either device can be saved', async () => {
    const { editor, persist } = setup()
    expect(editor.apply({ type: 'mobile:add', id: 'tasks' })).toBe(false)
    expect(editor.error.value).toContain('最多添加')
    expect(editor.canUndo.value).toBe(false)
    editor.apply({ type: 'mobile:remove', id: 'today' })
    editor.mode.value = 'desktop'
    editor.apply({ type: 'desktop:rename-group', id: 'learning', label: '  ' })
    expect(await editor.save()).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(editor.error.value).toContain('不能为空')
    editor.apply({ type: 'defaults' })
    for (let i = editor.drafts.value.desktop.length; i < MAX_DESKTOP_NAV_GROUPS; i++) {
      editor.apply({ type: 'desktop:add-group', label: `分组${i}` })
    }
    expect(editor.apply({ type: 'desktop:add-group', label: '超出上限' })).toBe(false)
    expect(editor.drafts.value.desktop).toHaveLength(MAX_DESKTOP_NAV_GROUPS)
  })

  it('preserves drafts and history after storage failure, blocks edits in flight, and allows a retry', async () => {
    let rejectSave
    const persist = vi.fn(() => new Promise((_, reject) => { rejectSave = reject }))
    const { editor, mobile } = setup({ persist })
    editor.apply({ type: 'mobile:remove', id: 'today' })
    const saving = editor.save()
    expect(editor.saving.value).toBe(true)
    expect(editor.apply({ type: 'mobile:add', id: 'tasks' })).toBe(false)
    expect(await editor.save()).toBe(false)
    rejectSave(new Error('存储空间不足'))
    expect(await saving).toBe(false)
    expect(editor.error.value).toBe('存储空间不足')
    expect(editor.hasChanges.value).toBe(true)
    expect(editor.canUndo.value).toBe(true)
    persist.mockImplementationOnce(async (values) => { mobile.value = clone(values[MOBILE_NAVIGATION_KEY]) })
    expect(await editor.save()).toBe(true)
    expect(editor.hasChanges.value).toBe(false)
  })

  it('does not display a conflict while its own save publishes the stored refs', async () => {
    let finishSave
    const { editor, mobile } = setup({ persist: () => {
      mobile.value = ['schedule', 'events']
      return new Promise((resolve) => { finishSave = resolve })
    } })
    editor.apply({ type: 'mobile:remove', id: 'today' })
    const pending = editor.save()
    expect(editor.conflicts.value).toEqual([])
    finishSave()
    expect(await pending).toBe(true)
    expect(editor.conflicts.value).toEqual([])
  })

  it('follows external changes on a clean device, protects a dirty draft, and saves only the changed device', async () => {
    const { editor, mobile, desktop, persist } = setup()
    editor.apply({ type: 'mobile:remove', id: 'today' })
    desktop.value = [{ id: 'custom', label: '新侧栏', items: ['tasks'] }]
    expect(editor.drafts.value.desktop).toEqual(desktop.value)
    mobile.value = ['projects']
    expect(editor.drafts.value.mobile).toEqual(['schedule', 'events'])
    expect(editor.conflicts.value).toEqual(['mobile'])
    expect(await editor.save()).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    editor.rebase('mobile', true)
    expect(await editor.save()).toBe(true)
    expect(Object.keys(persist.mock.calls[0][0])).toEqual([MOBILE_NAVIGATION_KEY])
    expect(desktop.value[0].label).toBe('新侧栏')
  })

  it('does not let an old save overwrite the editor after the account changes', async () => {
    let finishSave
    const { editor, user } = setup({ persist: () => new Promise((resolve) => { finishSave = resolve }) })
    editor.apply({ type: 'mobile:remove', id: 'today' })
    const pending = editor.save()
    user.value = { id: 'fictional-second-account' }
    finishSave()
    expect(await pending).toBe(false)
    expect(editor.drafts.value.mobile).toEqual(DEFAULT_MOBILE_NAVIGATION)
    expect(editor.hasChanges.value).toBe(false)
    expect(editor.message.value).toBe('')
  })

  it('treats a drag as one undo step and rolls back a canceled gesture', () => {
    const { editor } = setup()
    editor.apply({ type: 'mobile:move', id: 'today', to: 1 }, { batch: 'gesture-1' })
    editor.apply({ type: 'mobile:move', id: 'today', to: 2 }, { batch: 'gesture-1' })
    editor.undo({ cancel: true })
    expect(editor.drafts.value.mobile).toEqual(DEFAULT_MOBILE_NAVIGATION)
    expect(editor.canUndo.value).toBe(false)
    expect(editor.canRedo.value).toBe(false)
  })

  it('preserves the earlier redo branch when a drag is canceled', () => {
    const { editor } = setup()
    editor.apply({ type: 'mobile:remove', id: 'today' })
    editor.undo()
    editor.apply({ type: 'mobile:move', id: 'today', to: 2 }, { batch: 'gesture-2' })
    editor.undo({ cancel: true })
    expect(editor.canRedo.value).toBe(true)
    editor.redo()
    expect(editor.drafts.value.mobile).toEqual(['schedule', 'events'])
  })

  it('shows the actual stored layout when another update arrives during persistence', async () => {
    let finishSave
    const { editor, mobile } = setup({ persist: (values) => {
      mobile.value = values[MOBILE_NAVIGATION_KEY]
      return new Promise((resolve) => { finishSave = resolve })
    } })
    editor.apply({ type: 'mobile:remove', id: 'today' })
    const pending = editor.save()
    mobile.value = ['projects']
    finishSave()
    expect(await pending).toBe(true)
    expect(editor.drafts.value.mobile).toEqual(['projects'])
    expect(editor.hasChanges.value).toBe(false)
    expect(editor.message.value).toContain('最新布局')
  })

  it.each([false, true])('refreshes the untouched device after persistence settles (failed: %s)', async (failed) => {
    let finishSave
    const { editor, mobile, desktop } = setup({ persist: (values) => new Promise((resolve, reject) => {
      finishSave = () => {
        if (failed) reject(new Error('存储空间不足'))
        else { mobile.value = values[MOBILE_NAVIGATION_KEY]; resolve() }
      }
    }) })
    editor.apply({ type: 'mobile:remove', id: 'today' })
    const pending = editor.save()
    desktop.value = [{ id: 'custom', label: '其他窗口的新布局', items: ['tasks'] }]
    finishSave()
    expect(await pending).toBe(!failed)
    expect(editor.drafts.value.desktop).toEqual(desktop.value)
    expect(editor.dirty.value).toEqual({ mobile: failed, desktop: false })
    expect(editor.conflicts.value).toEqual([])
    expect(editor.drafts.value.mobile).toEqual(['schedule', 'events'])
    if (failed) expect(editor.error.value).toBe('存储空间不足')
  })
})
