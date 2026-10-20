// @vitest-environment happy-dom
/**
 * NoticeUnderstanding 多段确认页的「段 → 事项」两级展开守卫（功能报告 2.4）。
 *
 * 【问题】多段模式（`segments.length > 1`）下每段各自走一遍 `parseNotice`，而一段里
 * 完全可能解析出多个事项（`parsed.items`，noticeParser 的 `extractNoticeItems`：
 * 2~5 个动作短句才算多事项）。单条视图早就有「多事项」卡片（`.items-card`）逐项勾选，
 * 多段卡片却只显示到「段」这一级：一段里的多个事项只能跟着整段一起保存，无法单独取消。
 *
 * 【本文件的写法】先按**改前**的行为把四类场景特征化（单段多事项 / 多段各一事 /
 * 多段各多事 / 只勾选子集），锁住既有保存语义；实现两级展开后，只有「多段各多事」与
 * 「只勾选子集」两组断言升级为逐事项的预期，其余断言原样保留继续守着单条路径。
 *
 * 断言都落在**组件对外提交的 payload**上（`@commit`），因为这条链路下游是
 * noticeImportResult.js 的 `archiveImportedNotices`（按原文去重）与 TasksView 的
 * `createTasksFromNoticeItems`（按 items 顺序建实体）——「一段内的多个事项不得错配、
 * 丢失、重复」只有在这一层才看得出来。
 */
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import NoticeUnderstanding from '../src/components/NoticeUnderstanding.vue'
import { notices } from '../src/composables/noticeArchive.js'
import { archiveImportedNotices, createTasksFromNoticeItems } from '../src/composables/noticeImportResult.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

/**
 * 【相对日期的期望值必须跟着"今天"走】
 * 下面的文案全是相对日期（「周五前」「下周一」「周三」），而断言里原本写死了
 * 2026-10-19 / 21 / 22 / 23 —— 这组日期只在「今天 = 2026-10-16（周五）」时成立。
 * 换句话说这是一颗**定时炸弹**：过了 10 月 19 日，「下周一」自然落到 10 月 26 日，
 * 测试会因为日期走掉而变红，与被测代码毫无关系。
 *
 * 修法不是把断言改成"随便哪个日期都行"，而是**按解析器自己的规则把期望值算出来**：
 * 下/本/这 + 周X 走"周内偏移"，无前缀的周X 走"下一个同 weekday（今天算 7 天后）"。
 * 规则与 noticeParser.js 的 relativeDateValue 一一对应，见下面两个函数。
 */
const WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 与 noticeParser.relativeDateValue 同规则：prefix 取 '下' / '本' / '这' / ''（无前缀）。 */
function weekdayKey(prefix, weekday) {
  const now = new Date()
  const target = WEEKDAY[weekday]
  const currentFromMonday = (now.getDay() + 6) % 7
  const targetFromMonday = (target + 6) % 7
  const delta = prefix === '下'
    ? 7 - currentFromMonday + targetFromMonday
    : prefix === '本' || prefix === '这'
      ? targetFromMonday - currentFromMonday
      : (target - now.getDay() + 7) % 7 || 7
  const result = new Date(now)
  result.setDate(result.getDate() + delta)
  return localDateKey(result)
}

const TEXTS = {
  // 一段 = 单条视图：逗号分隔的两个动作短句被 noticeParser 解析成 2 个事项。
  singleWithTwoItems: '9月10日前提交实验报告，9月12日参加班会',
  // 两段、每段各一个事项：多段确认页，段内没有多事项可展开。
  segmentsSingleItem: '周五前提交实验报告。\n\n下周一参加班会。',
  // 两段、每段各两个事项：本轮要支持的两级展开。
  segmentsTwoItems: '周五前提交实验报告，下周一参加班会。\n\n周三提交数学作业，周四参加小组讨论。',
  // 三段：两个事项 + 两个事项 + 一个事项，用来验证「只勾选子集」。
  segmentsMixed: '周五前提交实验报告，下周一参加班会。\n\n周三提交数学作业，周四参加小组讨论。\n\n周日参加志愿活动。',
}

const SEGMENT_TWO_ITEMS_RAW = '周五前提交实验报告，下周一参加班会。'
const SEGMENT_TWO_ITEMS_RAW_2 = '周三提交数学作业，周四参加小组讨论。'

let app = null
let host = null
let open = null
let commits = []

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
  notices.value = []
  app = null
  host = null
  commits = []
})

async function mountNotice() {
  commits = []
  open = ref(false)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    setup() {
      return () => h(NoticeUnderstanding, {
        open: open.value,
        tasks: [],
        courses: [],
        onCommit: (payload) => commits.push(payload),
        onClose: () => { open.value = false },
      })
    },
  })
  app.mount(host)
  open.value = true
  await flush()
}

async function analyze(text) {
  const textarea = document.querySelector('.paste-card textarea')
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
  click(buttonByText('分析通知'))
}

function buttonByText(text, root = document) {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === text)
  expect(button, `找不到按钮「${text}」`).toBeTruthy()
  return button
}

async function click(target) {
  expect(target, '待点击的元素不存在').toBeTruthy()
  target.click()
  await flush()
}

const segmentRows = () => [...document.querySelectorAll('.segments-card .segment-row')]
const singleItemRows = () => [...document.querySelectorAll('.items-card .item-row')]
const nestedItemRows = (row) => [...row.querySelectorAll('.segment-items .item-row')]
const pickOf = (row) => row.querySelector('.segment-pick')
const nestedText = (row) => [...row.querySelectorAll('.segment-text small')].map((node) => node.textContent)

async function setSegmentProcess(row, key) {
  const select = row.querySelector('.segment-kind select')
  expect(select, '每段应有自己的处理方式下拉').toBeTruthy()
  select.value = key
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}

/** 单条视图的处理方式藏在「更改处理方式」里（按钮文本带一个展开箭头）。 */
async function chooseSingleProcess(label) {
  const toggle = [...document.querySelectorAll('button')].find((item) => item.textContent.trim().startsWith('更改处理方式'))
  expect(toggle, '找不到「更改处理方式」').toBeTruthy()
  await click(toggle)
  const option = [...document.querySelectorAll('.process-options label')].find((item) => item.textContent.includes(label))
  expect(option, `找不到处理方式「${label}」`).toBeTruthy()
  await click(option.querySelector('input'))
}

async function save() {
  await click(document.querySelector('.notice-footer .btn-primary'))
}

const titlesOf = (payload) => payload.items.map((item) => item.title)
const datesOf = (payload) => payload.items.map((item) => item.dueDate)

describe('单段多事项：单条视图（既有行为，两级展开不得改动）', () => {
  it('逐项勾选后只保存勾中的事项，字段仍来自该事项自己', async () => {
    await mountNotice()
    await analyze(TEXTS.singleWithTwoItems)

    expect(document.querySelector('.segments-card'), '只有一段时不该出现多段确认页').toBeNull()
    expect(singleItemRows()).toHaveLength(2)
    await chooseSingleProcess('创建待办')
    await click(singleItemRows()[0]) // 取消勾选第一项
    await save()

    expect(commits).toHaveLength(1)
    expect(commits[0].type).toBe('create')
    expect(titlesOf(commits[0])).toEqual(['参加班会'])
    expect(datesOf(commits[0])).toEqual(['2026-09-12'])
    expect(commits[0].notice.raw).toContain('提交实验报告')
    expect(commits[0].notice.raw).toContain('参加班会')
  })
})

describe('多段各一事：段级勾选（既有行为）', () => {
  it('默认按每段自己的推荐方式分组提交，各段的原文与字段不串段', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsSingleItem)

    const rows = segmentRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.querySelector('.segment-kind select').value)).toEqual(['homework', 'event'])
    expect(nestedItemRows(rows[0]), '段内只有一个事项时不展开子行').toHaveLength(0)
    await save()

    expect(commits).toHaveLength(2)
    const [homework, event] = commits
    expect(homework).toMatchObject({ type: 'create', kind: 'homework' })
    expect(titlesOf(homework)).toEqual(['提交实验报告'])
    expect(datesOf(homework)).toEqual([weekdayKey('', '五')])
    expect(homework.items[0].__notice.raw).toBe('周五前提交实验报告。')
    expect(event).toMatchObject({ type: 'event' })
    expect(titlesOf(event)).toEqual(['参加班会'])
    expect(datesOf(event)).toEqual([weekdayKey('下', '一')])
    expect(event.items[0].__notice.raw).toBe('下周一参加班会。')
  })
})

describe('多段各多事：段 → 事项两级展开', () => {
  it('每段的多个事项逐个提交，字段、日期与原文都不错配', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsTwoItems)

    const rows = segmentRows()
    expect(rows).toHaveLength(2)
    await setSegmentProcess(rows[0], 'task')
    await setSegmentProcess(rows[1], 'task')
    // 一段里的多个事项展开成可单独勾选的行；段这一级的按钮仍是「整段全选/取消」。
    expect(nestedItemRows(rows[0])).toHaveLength(2)
    expect(nestedItemRows(rows[1])).toHaveLength(2)
    expect(pickOf(rows[0]).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.notice-footer .btn-primary').textContent.trim()).toBe('添加 4 项')
    await save()

    expect(commits).toHaveLength(1)
    expect(commits[0].type).toBe('create')
    // 四个事项各提交一条：标题与日期都来自事项自己（不是整段的 actionText / 最后那个日期）。
    expect(titlesOf(commits[0])).toEqual(['提交实验报告', '参加班会', '提交数学作业', '处理小组讨论'])
    expect(datesOf(commits[0])).toEqual([
      weekdayKey('', '五'), weekdayKey('下', '一'), weekdayKey('', '三'), weekdayKey('', '四'),
    ])
    expect(new Set(titlesOf(commits[0])).size, '同一段里的多个事项不得重复或错配').toBe(4)
    // 每个事项仍挂着自己那一段的原文：下游按原文去重，一段只入档一条通知。
    expect(commits[0].items.map((item) => item.__notice.raw)).toEqual([
      SEGMENT_TWO_ITEMS_RAW, SEGMENT_TWO_ITEMS_RAW,
      SEGMENT_TWO_ITEMS_RAW_2, SEGMENT_TWO_ITEMS_RAW_2,
    ])
  })

  it('取消一个事项不影响同段的其他事项', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsTwoItems)

    const rows = segmentRows()
    for (const row of rows) await setSegmentProcess(row, 'task')
    await click(nestedItemRows(rows[0])[0]) // 只取消第一段的第一个事项
    expect(document.querySelector('.notice-footer .btn-primary').textContent.trim()).toBe('添加 3 项')
    await save()

    expect(titlesOf(commits[0])).toEqual(['参加班会', '提交数学作业', '处理小组讨论'])
  })
})

describe('只勾选子集：勾选状态与提交结果一致', () => {
  it('事项级与段级取消混合时，只提交仍然勾中的那些', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsMixed)

    const rows = segmentRows()
    expect(rows).toHaveLength(3)
    for (const row of rows) await setSegmentProcess(row, 'task')
    expect(nestedItemRows(rows[0])).toHaveLength(2)
    expect(nestedItemRows(rows[1])).toHaveLength(2)
    expect(nestedItemRows(rows[2]), '只有一个事项的段不展开子行').toHaveLength(0)

    await click(nestedItemRows(rows[0])[1]) // 取消第一段的第二个事项（段变成部分选中）
    expect(pickOf(rows[0]).getAttribute('aria-pressed'), '整段全选态不再成立').toBe('false')
    expect(rows[0].classList.contains('selected'), '仍然有勾中的事项时整段保持高亮').toBe(true)
    await click(pickOf(rows[1])) // 整段取消
    expect(pickOf(rows[1]).getAttribute('aria-pressed')).toBe('false')
    expect(nestedItemRows(rows[1]).map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    await save()

    expect(commits).toHaveLength(1)
    expect(titlesOf(commits[0])).toEqual(['提交实验报告', '参加志愿活动'])
    expect(commits[0].items.map((item) => item.__notice.raw)).toEqual([
      SEGMENT_TWO_ITEMS_RAW,
      '周日参加志愿活动。',
    ])
  })

  it('段级按钮在部分选中时补全，在全选状态下整体取消', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsTwoItems)

    const rows = segmentRows()
    await click(nestedItemRows(rows[0])[1])
    expect(pickOf(rows[0]).getAttribute('aria-pressed')).toBe('false')
    await click(pickOf(rows[0])) // 部分选中 → 补全
    expect(pickOf(rows[0]).getAttribute('aria-pressed')).toBe('true')
    await click(pickOf(rows[0])) // 全选 → 整体取消
    expect(pickOf(rows[0]).getAttribute('aria-pressed')).toBe('false')
    expect(nestedItemRows(rows[0]).map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
  })

  it('归档粒度是通知原文：一段里多个事项只入档一次', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsTwoItems)

    const rows = segmentRows()
    for (const row of rows) await setSegmentProcess(row, 'archive')
    await click(nestedItemRows(rows[0])[1]) // 第一段只留一个事项
    await save()

    expect(commits).toHaveLength(1)
    expect(commits[0].type).toBe('archive')
    // 两段各两个事项，但归档以「段」为单位：只写两条原文，且不因为事项多而重复。
    expect(commits[0].items.map((notice) => notice.raw)).toEqual([SEGMENT_TWO_ITEMS_RAW, SEGMENT_TWO_ITEMS_RAW_2])
  })
})

describe('下游导入：多事项 payload 不丢失、不重复', () => {
  it('四个事项 → 四个待办 + 两条通知档案（同一段的原文只入档一次）', async () => {
    await mountNotice()
    await analyze(TEXTS.segmentsTwoItems)

    const rows = segmentRows()
    for (const row of rows) await setSegmentProcess(row, 'task')
    await save()
    const items = commits[0].items
    expect(items).toHaveLength(4)

    // 走真实的导入收尾函数：TasksView 的 onNoticeCommit 就是这两步。
    const tasks = []
    const domain = { createTask: (value) => { const task = { id: `task-${tasks.length + 1}`, ...value }; tasks.push(task); return task } }
    const createdIds = createTasksFromNoticeItems(domain, items, { kind: 'todo', withCourse: (value) => ({ ...value, courseId: '' }) })
    expect(createdIds).toHaveLength(4)
    expect(tasks.map((task) => task.title)).toEqual(['提交实验报告', '参加班会', '提交数学作业', '处理小组讨论'])
    expect(tasks.every((task) => !('__notice' in task)), '__notice 不该混进待办字段').toBe(true)

    const noticeIds = archiveImportedNotices(items, items[0].__notice, 'task', createdIds)
    expect(noticeIds, '一段 = 一条通知档案：两段不该写出四条').toHaveLength(2)
    // 档案列表按新→旧排列，所以只比较集合：两条原文各一条，没有重复。
    expect(new Set(notices.value.map((notice) => notice.raw)))
      .toEqual(new Set([SEGMENT_TWO_ITEMS_RAW, SEGMENT_TWO_ITEMS_RAW_2]))
    expect(notices.value).toHaveLength(2)
  })
})