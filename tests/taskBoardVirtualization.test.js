// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import TaskBoard from '../src/components/task-views/TaskBoard.vue'

let app = null
let host = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

describe('待办看板长列表', () => {
  it('超过阈值时只渲染可见窗口，并保留分组数量', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const tasks = Array.from({ length: 80 }, (_, id) => ({ id: `task-${id}`, title: `待办 ${id}`, status: 'pending' }))
    app = createApp({
      render: () => h(TaskBoard, {
        columns: { pending: tasks, in_progress: [], completed: [] },
        dueInfoOf: () => ({ text: '', cls: '' }),
        statusOf: (task) => task.status,
        courseNameOf: () => '',
      }),
    })
    app.mount(host)
    await nextTick()

    expect(host.querySelector('.board-col[role="group"]').getAttribute('aria-label')).toContain('80 条')
    expect(host.querySelector('.board-task-list[data-virtual="on"]')).not.toBeNull()
    expect(host.querySelectorAll('.board-card').length).toBeLessThan(tasks.length)
  })
})
