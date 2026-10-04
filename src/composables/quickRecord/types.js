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
  note: { label: '快速笔记', icon: '📝' },
  unknown: { label: '不确定类型', icon: '❓' },
})

// 顶部四个快捷入口：前三类继续走智能解析，笔记是完全自由模式。
export const QUICK_ACTIONS = ['expense', 'todo', 'event', 'note']

export function recordTypeMeta(type) {
  return RECORD_TYPES[type] ?? RECORD_TYPES.unknown
}

export const QUICK_MODES = Object.freeze({
  smart: 'smart',
  note: 'note',
})
