// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import EventsView from '../src/views/EventsView.vue'
import LedgerView from '../src/views/LedgerView.vue'

/*
 * 表单错误必须能被读屏用户听见。
 *
 * 背景：style.css:182 定义了 [aria-invalid='true'] 的无效态样式，注释还写着
 * 「同时支持手写类名 / aria-invalid，供自定义校验逻辑复用」，但全仓没有任何一处
 * 设置 aria-invalid，aria-describedby 更是零使用。于是校验失败时：
 *   - 输入框不会被标成无效（那条 CSS 从未生效）
 *   - 错误文案只是"恰好出现在附近"，与出错的字段没有程序化关联
 *   - 焦点停在提交按钮上，读屏用户得自己在表单里找回出错的字段
 * 三条都已修，这个测试盯住它们。
 *
 * 注意：Modal 的内容不是在同一帧就位，固定等 N 个 nextTick 会时灵时不灵，
 * 所以这里一律用 waitFor 轮询（与 backupIntegrity.test.js 同一套做法）。
 */

const projectRoot = resolve(import.meta.dirname, '..')
let app = null
let host = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

async function waitFor(check, timeout = 1000) {
  const started = Date.now()
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() - started > timeout) return null
    await new Promise((resolveTick) => setTimeout(resolveTick, 5))
  }
}

async function mountView(component, path, errors = []) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path, component }],
  })
  await router.push(path)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(component)
  app.config.errorHandler = (error) => errors.push(error)
  app.use(router)
  app.mount(host)
  await nextTick()
  return host
}

function byText(selector, text) {
  return [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))
}

/*
 * 点击前必须让元素"老"几毫秒，否则这个测试会随机失败。
 *
 * Vue 的事件 invoker 有一条去重守卫：先到的 invoker 会给事件打上 e._vts = Date.now()，
 * 后续 invoker 若发现 e._vts <= 自己被挂载的时刻就直接 return。
 * LedgerView 根节点上有 @click.capture="closeSwipe"，它一定先跑并打上时间戳；
 * 如果我们在按钮挂载的同一毫秒内点击，按钮自己的 @click 就会被这条守卫跳过，
 * 表现成"点了没反应"——而 Date.now() 只有 1ms 分辨率，所以是约一半概率的抛硬币。
 * 真实用户点击距离元素挂载至少几十毫秒，产品侧不存在这个问题。
 * 这里等 8ms 让 attached 严格早于 e._vts，把假象消掉。
 */
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await nextTick()
}

async function clickAndFind(trigger, selector) {
  await click(trigger)
  const found = await waitFor(() => document.querySelector(selector))
  expect(found, `点击后没有等到 ${selector}`).not.toBeNull()
  return found
}

describe('表单校验的无障碍接线', () => {
  it('日程视图：内容为空时标记字段、关联错误文案并把焦点移回去', async () => {
    const errors = []
    await mountView(EventsView, '/events', errors)

    await clickAndFind(byText('button', '新建日程'), '.modal')
    await clickAndFind(byText('button', '添加'), '#event-form-error')

    const errorText = document.querySelector('#event-form-error')
    expect(errorText.textContent).toContain('请填写日程内容')

    const titleInput = document.querySelector('[aria-describedby="event-form-error"]')
    expect(titleInput, '错误文案没有通过 aria-describedby 关联到输入框').not.toBeNull()
    expect(titleInput.getAttribute('aria-invalid')).toBe('true')
    // 焦点必须回到出错的字段，而不是留在提交按钮上。
    expect(document.activeElement).toBe(titleInput)
    expect(errors).toEqual([])
  })

  it('账本视图：只有出错的字段被标红，其余字段不受影响', async () => {
    const errors = []
    await mountView(LedgerView, '/bills', errors)

    await click(byText('[role="tab"]', '固定账单'))
    await clickAndFind(byText('button', '添加固定账单'), '.modal')
    await clickAndFind(byText('button', '保存'), '#bill-form-error')

    // 名称留空 → 只有名称该被标记。
    const errorText = document.querySelector('#bill-form-error')
    expect(errorText.textContent).toContain('请填写名称')

    const marked = [...document.querySelectorAll('[aria-invalid="true"]')]
    expect(marked).toHaveLength(1)
    expect(marked[0].getAttribute('aria-describedby')).toBe('bill-form-error')
    expect(document.activeElement).toBe(marked[0])

    // 填上名称后再次提交：错误清掉，金额为空转而标金额。
    marked[0].value = '话费'
    marked[0].dispatchEvent(new window.Event('input', { bubbles: true }))
    await nextTick()
    await click(byText('button', '保存'))
    await nextTick()

    expect(document.querySelector('#bill-form-error').textContent).toContain('金额需大于 0')
    const markedNow = [...document.querySelectorAll('[aria-invalid="true"]')]
    expect(markedNow).toHaveLength(1)
    expect(markedNow[0].getAttribute('aria-label')).toBe('固定账单金额')
    expect(document.activeElement).toBe(markedNow[0])
    expect(errors).toEqual([])
  })

  it('笔记视图的正文框同样接线（源码级：需要选中笔记才能进编辑态）', () => {
    const source = readFileSync(resolve(projectRoot, 'src/views/NotesView.vue'), 'utf8')
    expect(source).toContain(':aria-invalid="noteErrorField === \'content\' || undefined"')
    expect(source).toContain(':aria-describedby="noteError ? \'note-edit-error\' : undefined"')
    expect(source).toMatch(/<p v-if="noteError" id="note-edit-error"/)
    // 保存失败（笔记已删除 / 落盘失败）不得把输入框标成无效。
    expect(source).toMatch(/setNoteError\('这条笔记可能已删除或已移动。'\)/)
    expect(source).toMatch(/setNoteError\(persistenceState\.value\.message[^)]*\)/)
  })

  it('错误文案的 id 在整个文档里唯一，且都带 role=alert', () => {
    const files = ['src/views/NotesView.vue', 'src/views/LedgerView.vue', 'src/views/EventsView.vue']
    const ids = []
    for (const file of files) {
      const source = readFileSync(resolve(projectRoot, file), 'utf8')
      for (const match of source.matchAll(/<p v-if="[^"]*Error" id="([^"]+)"[^>]*role="alert"/g)) ids.push(match[1])
    }
    expect(ids).toEqual(['note-edit-error', 'bill-form-error', 'event-form-error'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})