export const RECORD_TYPES = Object.freeze({
  todo: { label: '待办', icon: '✓' },
  homework: { label: '作业', icon: '📚' },
  event: { label: '日程', icon: '📅' },
  expense: { label: '支出', icon: '💰' },
  income: { label: '收入', icon: '💵' },
  // 退款是**冲抵项**而不是支出。快速记录的「最近记录」会列出账本里的退款条目，
  // 不登记这一项就会落到 `unknown`（显示「❓ 不确定类型」），而它其实类型明确。
  refund: { label: '退款', icon: '↩️' },
  bill: { label: '固定账单', icon: '🧾' },
  countdown: { label: '重要日期', icon: '⏳' },
  unknown: { label: '不确定类型', icon: '❓' },
})

// 快捷入口统一进入结构化记录，避免出现与待办、日程分离的自由笔记数据。
export const QUICK_ACTIONS = ['expense', 'todo', 'event']

export function recordTypeMeta(type) {
  return RECORD_TYPES[type] ?? RECORD_TYPES.unknown
}
