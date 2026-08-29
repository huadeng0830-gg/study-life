// 智能归类引擎（模块 D）：只改字段、不删数据。
// classifyTask 依据课程名 / 标题关键词 / 截止时间补齐 courseId、分类与优先级。
import { findUniqueCourseByName } from './courseLinks.js'

const CATEGORY_KEYWORDS = [
  ['学习', '作业 论文 考试 复习 预习 报告 实验 练习 单词 背诵 阅读 题目 笔记 项目 测验 默写 习题 演算 课'],
  ['健康', '跑步 健身 运动 体检 药 早睡 喝水 拉伸 瑜伽 冥想'],
  ['生活', '购物 超市 快递 取件 理发 充值 维修 打扫 整理 卫生 家务 缴费 邮寄'],
  ['工作', '会议 开会 报名 填写 办理 申请 面试 汇报 材料 盖章 截止'],
  ['娱乐', '电影 游戏 唱歌 出游 旅行 聚会 演出 展览 演唱会'],
]

const URGENT_WORDS = ['紧急', '马上', '立即', '尽快', '赶紧', '今天', '截止']

export function categoryFromTitle(title) {
  const text = String(title ?? '')
  if (!text.trim()) return ''
  for (const [category, words] of CATEGORY_KEYWORDS) {
    for (const word of words.split(/\s+/)) {
      if (word && text.includes(word)) return category
    }
  }
  return ''
}

function courseInTitle(title, courses) {
  const text = String(title ?? '')
  const names = courses
    .map((course) => String(course?.name ?? '').trim())
    .filter(Boolean)
  if (!text || !names.length) return null
  const matched = names.filter((name) => text.includes(name))
  if (matched.length !== 1) return null
  // 复用唯一匹配语义：重名时不自动关联，避免误导。
  return findUniqueCourseByName(courses, matched[0])
}

function daysUntil(dateStr, now) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

export function resolvePriority(task, now = new Date()) {
  if (!task || typeof task !== 'object') return 'normal'
  if (task.priority === 'high') return 'high'
  const title = String(task.title ?? '')
  if (URGENT_WORDS.some((word) => title.includes(word))) return 'high'
  const days = daysUntil(task.dueDate, now)
  if (days !== null && days >= 0 && days <= 3) return 'high'
  return task.priority || 'normal'
}

export function classifyTask(task, courses = [], now = new Date()) {
  if (!task || typeof task !== 'object') return task
  const list = Array.isArray(courses) ? courses : []
  const next = { ...task }

  // 1) 课程匹配：已有课程名，或标题里出现唯一课程名 → 补 courseId。
  let matched = next.courseId ? null : findUniqueCourseByName(list, next.course)
  if (!matched) matched = courseInTitle(next.title, list)
  if (matched) {
    next.courseId = matched.id
    next.course = matched.name
  }

  // 2) 标题关键词 → 分类：仅在尚未关联课程时补充，避免覆盖用户已有课程。
  if (!next.courseId && !String(next.course ?? '').trim()) {
    const category = categoryFromTitle(next.title)
    if (category) next.course = category
  }

  // 3) 优先级：仅在需要时提升为 high，绝不降级。
  next.priority = resolvePriority(next, now)
  return next
}

function signatureKey(task) {
  return JSON.stringify({
    courseId: task?.courseId ?? '',
    course: String(task?.course ?? '').trim(),
    priority: task?.priority ?? 'normal',
  })
}

// 批量整理：返回新数组与变化条数，供“一键智能整理”展示结果。
export function classifyTasks(tasks, courses = [], now = new Date()) {
  const list = Array.isArray(tasks) ? tasks : []
  let changed = 0
  const result = list.map((task) => {
    const before = signatureKey(task)
    const after = classifyTask(task, courses, now)
    if (after !== task && before !== signatureKey(after)) changed += 1
    return after
  })
  return { list: result, changed }
}