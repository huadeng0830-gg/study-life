export const RECORD_TYPES = Object.freeze({
  todo: { label: '待办', icon: '✓' },
  homework: { label: '作业', icon: '📚' },
  event: { label: '日程', icon: '📅' },
  expense: { label: '支出', icon: '💰' },
  income: { label: '收入', icon: '💵' },
  bill: { label: '固定账单', icon: '🧾' },
  countdown: { label: '倒计时', icon: '⏳' },
  note: { label: '快速笔记', icon: '📝' },
})

export const QUICK_ACTIONS = ['expense', 'todo', 'event', 'note']

export function recordTypeMeta(type) {
  return RECORD_TYPES[type] ?? RECORD_TYPES.todo
}
