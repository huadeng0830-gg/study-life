// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import NoticeUnderstanding from '../src/components/NoticeUnderstanding.vue'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

let app
let host

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

describe('通知确认页中的调课应用', () => {
  it('先展示候选和课表预览，用户确认后才提交调课与通知状态', async () => {
    const open = ref(false)
    const commits = []
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({
      setup() {
        return () => h(NoticeUnderstanding, {
          open: open.value,
          tasks: [],
          courses: [{ id: 'demo-math', name: '高等数学', day: 2, start: 'p2', end: 'p3' }],
          onCommit: (payload) => commits.push(payload),
          onClose: () => { open.value = false },
        })
      },
    })
    app.mount(host)
    open.value = true
    await flush()

    const textarea = document.querySelector('.paste-card textarea')
    textarea.value = '高等数学本周三第3节调到B204'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    ;[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '分析通知').click()
    await flush()

    expect(document.querySelector('.schedule-preview')?.textContent).toContain('课表变更预览')
    expect(document.querySelector('.schedule-preview select')?.value).toBe('demo-math')
    expect(commits).toEqual([])
    document.querySelector('.notice-footer .btn-primary').click()
    await flush()

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      type: 'schedule',
      courseId: 'demo-math',
      scheduleProposal: { kind: 'move', location: 'B204' },
      notice: { status: 'handled', raw: '高等数学本周三第3节调到B204' },
    })
  })
})
