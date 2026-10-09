// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExceptionsModal from '../src/components/schedule/ExceptionsModal.vue'
import ScheduleGrid from '../src/components/schedule/ScheduleGrid.vue'
import { coursesForDate, removeScheduleException, scheduleExceptions, semester, upsertScheduleException } from '../src/composables/store/schedule.js'

const DATE = '2026-10-14'
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const COURSES = [
  { id: 'math', name: '示例数学', day: 2, start: 'p1', end: 'p2', startWeek: 1, endWeek: 8, weekType: 'odd' },
  { id: 'english', name: '示例英语', day: 2, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
  { id: 'physics', name: '示例物理', day: 0, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
]
let app
let host
let submissions

beforeEach(() => {
  // 本例日期为第 7 周，可检测单双周和错误的“全学期”标签。
  semester.value = { start: '2026-08-31' }
  scheduleExceptions.value = []
  submissions = []
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
})

async function mountModal(courses = COURSES) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(ExceptionsModal, {
    show: true, exceptions: scheduleExceptions.value, days: DAYS, allCourses: courses, initialDate: DATE,
    onSubmit: (value) => { submissions.push(value); upsertScheduleException(value) },
    onRemove: removeScheduleException,
  }) })
  app.mount(host)
  await nextTick()
}
const root = () => document.querySelector('.exception-editor')
const checkboxes = () => [...root().querySelectorAll('.course-option input')]
const optionNames = () => [...root().querySelectorAll('.course-option b')].map((element) => element.textContent)
const button = (text) => [...root().querySelectorAll('button')].find((element) => element.textContent.trim() === text)
async function selectType(type) {
  root().querySelector(`#exceptions-tab-${type}`).click()
  await nextTick()
}
async function input(element, value) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function save() {
  root().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}

describe('课程调整的真实表单交互', () => {
  it('首次挂载按当前查看日期初始化，改开始日期时单日结束日期跟随', async () => {
    await mountModal()
    const dates = [...root().querySelectorAll('input[type="date"]')]
    expect(dates.map((element) => element.value)).toEqual([DATE, DATE])
    await input(dates[0], '2026-10-15')
    expect(dates[1].value).toBe('2026-10-15')
    expect(root().querySelector('.arrangement-preview').textContent).toContain('共 1 天')
  })

  it('部分停课只选择当天上课的课程，课程显示原节次及准确的单双周范围', async () => {
    await mountModal()
    await selectType('session_off')
    expect(optionNames()).toEqual(['示例数学', '示例英语'])
    const details = root().querySelector('.course-option small').textContent
    expect(details).toContain('第一节课至第二节课')
    expect(details).toContain('1-8周 单')
    expect(details).not.toContain('全学期')
  })

  it('编辑部分停课时，被原安排停掉的课程可以重新选择', async () => {
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'] })
    await mountModal()
    root().querySelector('.exception-actions button').click()
    await nextTick()
    expect(optionNames()).toEqual(['示例数学', '示例英语'])
    expect(checkboxes()[0].checked).toBe(true)
    await save()
    expect(scheduleExceptions.value).toHaveLength(1)
    expect(root().querySelector('[role="status"]').textContent).toContain('已保存修改')
  })

  it('部分补课不重复列出已上课或已停课的课程', async () => {
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'] })
    await mountModal()
    await selectType('session_makeup')
    expect(optionNames()).toEqual(['示例物理'])
  })

  it('空选课程保存时，错误关联课程选择区并聚焦复选框', async () => {
    await mountModal()
    await selectType('session_off')
    await save()
    expect(submissions).toHaveLength(0)
    expect(root().querySelector('[role="alert"]').textContent).toContain('至少选择一门')
    expect(root().querySelector('fieldset').getAttribute('aria-describedby')).toBe('exception-form-error')
    expect(document.activeElement).toBe(checkboxes()[0])
  })

  it('保存后清空选择，连续点保存不会重复添加相同的部分停课', async () => {
    await mountModal()
    await selectType('session_off')
    checkboxes()[0].click()
    await nextTick()
    await save()
    expect(submissions).toHaveLength(1)
    expect(scheduleExceptions.value).toHaveLength(1)
    await save()
    expect(submissions).toHaveLength(1)
  })

  it('切换类型或日期后清空原选择，避免把别的日期的课程带入', async () => {
    await mountModal()
    await selectType('session_off')
    checkboxes()[0].click()
    await nextTick()
    await selectType('session_makeup')
    expect(checkboxes().some((element) => element.checked)).toBe(false)
    checkboxes()[0].click()
    await nextTick()
    await input(root().querySelector('input[type="date"]'), '2026-10-15')
    expect(checkboxes().some((element) => element.checked)).toBe(false)
  })

  it('备注与实际课程安排同时显示，备注不会遮住停了哪门课', async () => {
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'], note: '示例通知' })
    await mountModal()
    const item = root().querySelector('.exception-item')
    expect(item.textContent).toContain('示例数学')
    expect(item.textContent).toContain('示例通知')
  })

  it('弹窗内撤销删除恢复同一条记录和课程，可通过键盘直接操作', async () => {
    const saved = upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'], note: '示例通知' })
    await mountModal()
    button('删除').click()
    await nextTick()
    expect(scheduleExceptions.value).toHaveLength(0)
    const undo = button('撤销删除')
    undo.focus()
    expect(document.activeElement).toBe(undo)
    undo.click()
    await nextTick()
    expect(scheduleExceptions.value[0]).toMatchObject({ id: saved.id, courseIds: ['math'], note: '示例通知' })
    expect(coursesForDate(COURSES, DATE).map((course) => course.id)).toEqual(['english'])
    expect(button('撤销删除')).toBeUndefined()
  })

  it('删除后新建同日整天安排，撤销不会覆盖新的记录', async () => {
    upsertScheduleException({ date: DATE, type: 'off' })
    await mountModal()
    button('删除').click()
    await nextTick()
    const replacement = upsertScheduleException({ date: DATE, type: 'makeup', sourceDay: 0 })
    await nextTick()
    button('撤销删除').click()
    await nextTick()
    expect(scheduleExceptions.value).toHaveLength(1)
    expect(scheduleExceptions.value[0].id).toBe(replacement.id)
    expect(root().querySelector('.saved-arrangements [role="alert"]').textContent).toContain('已有新安排')
  })

  it('整天调课预览遵守单双周，并提示实际的节次冲突', async () => {
    await mountModal()
    await selectType('makeup')
    const week = root().querySelectorAll('select')[0]
    week.value = '2'
    week.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(root().querySelector('.arrangement-preview').textContent).toContain('当天共 1 门课')
    await selectType('session_makeup')
    checkboxes()[0].click()
    await nextTick()
    expect(root().querySelector('.arrangement-preview').textContent).toContain('1 组课程节次重叠')
    expect(root().querySelector('.arrangement-preview').textContent).toContain('当天共 3 门课')
  })

  it('已有部分补课时，整天调课预览仍明确提示空的来源课表', async () => {
    upsertScheduleException({ date: DATE, type: 'session_makeup', courseIds: ['physics'] })
    await mountModal()
    await selectType('makeup')
    const day = root().querySelectorAll('select')[1]
    day.value = '6'
    day.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    const preview = root().querySelector('.arrangement-preview').textContent
    expect(preview).toContain('当天共 1 门课')
    expect(preview).toContain('没有常规课程')
    expect(preview).toContain('预览已包含这些安排')
  })

  it('课程搜索的全选只选搜索结果，不改变已保存课表', async () => {
    const extra = Array.from({ length: 7 }, (_, index) => ({ ...COURSES[2], id: `extra-${index}`, name: `演示课程${index}` }))
    await mountModal([...COURSES, ...extra])
    await selectType('session_makeup')
    await input(root().querySelector('input[type="search"]'), '演示课程2')
    button('选择搜索结果').click()
    await nextTick()
    expect(root().querySelector('legend').textContent).toContain('已选 1 门')
    expect(scheduleExceptions.value).toHaveLength(0)
    await save()
    expect(submissions[0].courseIds).toEqual(['extra-2'])
  })

  it('编辑整天安排不能无提示覆盖另一日期已有的安排', async () => {
    upsertScheduleException({ date: DATE, type: 'off' })
    upsertScheduleException({ date: '2026-10-15', type: 'off' })
    await mountModal()
    root().querySelector('.exception-actions button').click()
    await nextTick()
    await input(root().querySelector('input[type="date"]'), '2026-10-15')
    await save()
    expect(submissions).toHaveLength(0)
    expect(root().querySelector('[role="alert"]').textContent).toContain('目标日期已有整天安排')
    expect(scheduleExceptions.value).toHaveLength(2)
  })
})

describe('课表的课程调整标记', () => {
  it('按去重后的课程数标记，点击标记传入准确日期', async () => {
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math', 'english'] })
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['english'] })
    const opened = []
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(ScheduleGrid, { courses: COURSES, viewWeek: 7, currentWeek: 7,
      currentDayIndex: 2, mobileView: 'week', mobileDay: 2, appearance: { scheduleSkin: 'classic' },
      onOpenAdjustments: (date) => opened.push(date) })
    app.mount(host)
    await nextTick()
    const tag = host.querySelector('.exception-tag')
    expect(tag.textContent).toBe('停2门')
    tag.click()
    expect(opened).toEqual([DATE])
    expect(coursesForDate(COURSES, DATE)).toHaveLength(0)
  })
})
