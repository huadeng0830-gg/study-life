export const feedbackStatusLabels = Object.freeze({ pending: '待回应', needs_info: '待补充', planned: '已计划', processing: '处理中', resolved: '已解决', not_adopted: '暂不采纳', duplicate: '重复反馈' })
export const feedbackCategoryLabels = Object.freeze({ product: '问题与产品建议', campus: '校园功能', accessibility: '无障碍体验', other: '其他反馈' })
export const feedbackStatusHelp = Object.freeze({ pending: '已收到，等待管理员回应。', needs_info: '需要提交人补充信息后继续处理。', planned: '已采纳并进入计划，尚未开始实施。', processing: '正在排查问题或实施改进。', resolved: '已完成处理，可查看管理员的解决说明。', not_adopted: '本次暂不实施，可查看具体原因。', duplicate: '与已有反馈重复，可查看管理员给出的跟进入口。' })
export function feedbackValidation(form) {
  if (!Object.hasOwn(feedbackStatusLabels, form.status)) return '请选择有效的处理状态。'
  if (['not_adopted', 'duplicate'].includes(form.status) && !form.publicReason.trim()) return '请填写不采纳的原因，或重复反馈的跟进说明。'
  if (!['pending', 'not_adopted', 'duplicate'].includes(form.status) && !form.reply.trim()) return '请填写公开进展、补充要求或解决说明。'
  if (form.reward !== '' && (!Number.isInteger(Number(form.reward)) || Number(form.reward) < 0 || Number(form.reward) > 20 || form.status !== 'resolved')) return '只有已解决的反馈可设置 0–20 个贡献豆奖励。'
  return ''
}
