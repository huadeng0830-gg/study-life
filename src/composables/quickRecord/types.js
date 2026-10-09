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
export const QUICK_ACTIONS = ['todo', 'homework', 'event', 'expense', 'income', 'countdown', 'bill']

export const QUICK_RECORD_EXAMPLES = {
  auto: ['午饭18元，微信', '明天下午三点开组会', '早餐6元\n公交2元\n奶茶9元'],
  todo: ['明天买洗衣液', '周五整理学习资料', '今天晚上八点取快递'],
  homework: ['周五18点交高数第三章作业', '明天提交实验报告', '下周一交英语作文'],
  event: ['明天下午三点开组会', '周五上午十点面试', '下周一14:00到15:00班会'],
  expense: ['午饭18元，微信', '咖啡12块5', '早餐6元\n公交2元\n奶茶9元'],
  income: ['生活费到账500微信', '兼职收入200元', '收到奖学金1000元'],
  countdown: ['距离六级考试还有90天', '12月20日期末考试', '明年1月1日新年'],
  bill: ['每月15号39元话费', '每月6元iCloud订阅', '每年120元会员'],
}

export function recordTypeMeta(type) {
  return RECORD_TYPES[type] ?? RECORD_TYPES.unknown
}
