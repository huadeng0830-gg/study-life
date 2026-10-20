import { createNoticeRecord } from './noticeArchive.js'

/**
 * 通知批量导入后的「归档 + 可撤销」收尾。
 *
 * 以前这段逻辑整个写在 TasksView 里，只保存第一条通知原文（`firstData.__notice`），
 * 一次粘贴拆出 6 条就会静默丢掉 5 条；而且整条路径只有一行会消失的提示文字，
 * 连同最多 20 条记录 + 课表例外的写入没有任何回退。
 *
 * 抽出来不是为了拆文件，是因为它有两条与页面无关的硬规则：
 * 「每条原文都要进档案」和「整批可撤销」，放在视图里很容易被下一个人改回去。
 */

/**
 * 一次粘贴可以拆出多条通知，每一条都是独立的原文，都必须进通知档案。
 * 同一段原文重复出现时按原文去重，避免重复入档。
 *
 * @param {Array<{ __notice?: { raw?: string } }>} items 通知理解给出的每个事项
 * @param {{ raw?: string } | undefined} fallbackNotice items 上没有挂 __notice 时的兜底原文
 * @param {string} linkedEntityType 关联实体类型（task / event）
 * @param {string[]} createdIds 本次新建的实体 id，按事项顺序
 * @returns {string[]} 写入档案的通知记录 id，供撤销时清理
 */
export function archiveImportedNotices(items, fallbackNotice, linkedEntityType, createdIds) {
  const sources = []
  const seen = new Set()
  for (const item of items || []) {
    const raw = item?.__notice?.raw
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    sources.push(item.__notice)
  }
  if (!sources.length && fallbackNotice?.raw) sources.push(fallbackNotice)

  const ids = []
  const idsOf = Array.isArray(createdIds) ? createdIds : []
  sources.forEach((notice, index) => {
    try {
      // 条数一致时逐条对应自己那条记录；否则只能统一挂在第一条上。
      const linkedEntityId = idsOf.length === sources.length ? (idsOf[index] || '') : (idsOf[0] || '')
      ids.push(createNoticeRecord({ ...notice, status: 'handled', linkedEntityType, linkedEntityId })?.id)
    } catch {
      // 存盘失败不能连带回滚已建好的待办；由调用方负责把这句话显示出来。
      ids.push(null)
    }
  })
  return ids.filter(Boolean)
}

/**
 * 把通知理解给出的事项落成待办，返回新建的 id（顺序与事项一致）。
 * `__notice` 在这里剥掉：它是通知原文，不能混进待办字段里。
 */
export function createTasksFromNoticeItems(domain, items, { kind = 'todo', withCourse }) {
  const createdIds = []
  for (const item of items || []) {
    const { __notice: _notice, ...data } = item
    const created = domain.createTask({ ...withCourse(data), kind, createdFrom: 'clipboard', sourceType: 'notice' })
    if (created?.id) createdIds.push(created.id)
  }
  return createdIds
}

/** 同上，落成日程。日程的课程名取事项上解析出来的 course。 */
export function createEventsFromNoticeItems(domain, items, { withCourse }) {
  const createdIds = []
  for (const item of items || []) {
    const created = domain.createEvent({ ...withCourse(item), courseName: item.course || '', createdFrom: 'clipboard', sourceType: 'notice' })
    if (created?.id) createdIds.push(created.id)
  }
  return createdIds
}

/**
 * 通知批量导入是全应用单次写入面最宽的一条路径，必须能整体撤销——
 * 快速记录和课表导入都已有撤销，这里原本什么都没有。
 *
 * `options` 字段：
 *  - `createdIds` 本次新建的实体 id（待办 / 日程）
 *  - `noticeIds` 本次写入档案的通知记录 id
 *  - `removeEntity` 删除实体、`removeNotice` 删除通知档案记录
 *  - `notify` 展示带「撤销」按钮的提示、`reportFallback` 没有可撤销内容时的降级提示
 *  - `message` 成功提示文案
 *
 * @param {{
 *  createdIds: string[], noticeIds: string[],
 *  removeEntity: (id: string) => void, removeNotice: (id: string) => void,
 *  notify: (message: string, options?: Record<string, unknown>) => void,
 *  reportFallback: (message: string) => void, message: string,
 * }} options
 */
export function offerNoticeImportUndo(options) {
  const { createdIds, noticeIds, removeEntity, removeNotice, notify, reportFallback, message } = options
  const entities = Array.isArray(createdIds) ? createdIds : []
  const notices = Array.isArray(noticeIds) ? noticeIds : []
  if (!entities.length && !notices.length) {
    reportFallback(message)
    return
  }
  notify(message, {
    actionLabel: '撤销',
    duration: 0,
    undoFn: () => {
      for (const id of entities) removeEntity(id)
      for (const id of notices) removeNotice(id)
    },
  })
}

/**
 * 把与页面无关的依赖（domain、提示函数、档案删除）绑一次，
 * 调用方每次只需要给出「建了什么实体」和「成功说什么」。
 *
 * 两个分支（转待办 / 转日程）过去各自重复一遍 notify/removeNotice/reportFallback，
 * 迟早会只改到一边。现在 entityType 同时决定了归档关联类型和撤销时删哪种实体，
 * 这两者本来就该是同一个选择。
 *
 * @param {{
 *  domain: { deleteTask: (id: string) => void, deleteEvent: (id: string) => void },
 *  notify: (message: string, options?: Record<string, unknown>) => void,
 *  reportFallback: (message: string) => void,
 *  removeNotice: (id: string) => void,
 * }} deps
 */
export function createNoticeImportFinisher({ domain, notify, reportFallback, removeNotice }) {
  return function finish({ createdIds, noticeIds, entityType, message }) {
    offerNoticeImportUndo({
      createdIds,
      noticeIds,
      removeEntity: (id) => { if (entityType === 'task') domain.deleteTask(id); else domain.deleteEvent(id) },
      removeNotice,
      notify,
      reportFallback,
      message,
    })
  }
}