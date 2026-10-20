/**
 * 齐行确认弹窗（ConfirmDialog）的文案与观感，按 confirmAction.kind 组织成一张表。
 *
 * 【为什么拆出来】抽取前这些内容是 `<ConfirmDialog>` 上一条 1452 字符的单行：三个内联对象
 * 字面量 + 两串 `? :` 三元链挤在同一行，加一个 confirm kind 得在同一行里改三处，漏一处就是
 * 「标题写了、文案空着」这种沉默缺陷。现在一个 kind 一行数据，缺项由下面的默认值兜底
 * （与原来的 `|| '确认操作'` / `|| ''` 完全一致）。
 *
 * 文案本身一个字都没改（包括 `remove` 里的 `targetName` 插值）；只有需要按成员名插值的
 * message 写成函数。
 */

/** 需要红色确认键的 kind（删除、移出、退出、取消讨论这类不可逆操作）。 */
const DANGER_TONES = new Set(['delete', 'remove', 'leave', 'delivery-check-delete', 'meeting-cancel', 'delete-milestone'])

/** 确认键文案为「确认删除」的 kind。 */
const DESTRUCTIVE_LABELS = new Set(['delete', 'remove', 'delivery-check-delete', 'delete-milestone'])

/** 每个 kind 的标题与正文；message 可以是字符串，也可以是 (action) => string。 */
const CONFIRM_COPY = {
  archive: { title: '归档项目', message: '归档后，成员可以查看历史内容，但不能新增成员或任务。' },
  delete: { title: '删除项目', message: '项目会移入回收站，成员暂时不能进入；可以通过负责人恢复项目。' },
  leave: { title: '退出项目', message: '退出后，你的个人待办会保留为个人记录，项目负责人可以重新分配未完成任务。' },
  remove: { title: '移出成员', message: (action) => `确定将${action.targetName || '该成员'}移出项目吗？未完成的分工会释放。` },
  restore: { title: '恢复项目', message: '恢复后，项目成员可以继续协作。' },
  'decline-invite': { title: '拒绝项目邀请', message: '拒绝后，项目邀请会从待处理列表移除。' },
  'delete-milestone': { title: '删除里程碑', message: '删除后，关联任务仍会保留，只解除与此阶段的关联。' },
  'meeting-confirm': { title: '确认小组讨论', message: '所有受邀成员已接受。确认后会将讨论加入已接受成员的个人日程。' },
  'meeting-cancel': { title: '取消讨论邀约', message: '取消后，成员的个人日程会标记为已取消。' },
  'meeting-apply-proposal': { title: '采用改期建议', message: '采用后将新的时间发给全体受邀成员重新确认。' },
  'delivery-check-delete': { title: '删除交付检查项', message: '删除后，交付清单会移除此检查项。' },
}

/**
 * @param {{ kind?: string, targetName?: string } | null} action 当前的 confirmAction
 * @returns {{ title: string, message: string, confirmLabel: string, tone: 'primary'|'danger' }}
 */
export function confirmDialogCopy(action) {
  const kind = action?.kind
  const copy = CONFIRM_COPY[kind] || {}
  return {
    title: copy.title || '确认操作',
    message: typeof copy.message === 'function' ? copy.message(action) : copy.message || '',
    confirmLabel: DESTRUCTIVE_LABELS.has(kind) ? '确认删除' : '确认',
    tone: DANGER_TONES.has(kind) ? 'danger' : 'primary',
  }
}

export { CONFIRM_COPY }

/** 每个确认动作对应的一条项目命令：命令名 + 额外 payload(action) + 成功文案。 */
const CONFIRM_COMMANDS = {
  archive: { command: 'archive', payload: () => ({ archived: true }), message: '项目已归档。' },
  restore: { command: 'archive', payload: () => ({ archived: false }), message: '项目已恢复。' },
  delete: { command: 'delete', message: '项目已移入回收站。你可以立即撤销。' },
  leave: { command: 'member_leave', message: '你已退出项目。' },
  remove: { command: 'member_remove', payload: (action) => ({ targetId: action.targetId }), message: '成员已移出项目。' },
  'decline-invite': { command: 'invite_respond', payload: () => ({ decision: 'decline' }), message: '已拒绝项目邀请。' },
  'delete-milestone': { command: 'milestone_delete', payload: (action) => ({ milestoneId: action.milestoneId }), message: '里程碑已删除，关联任务仍会保留。' },
  'meeting-cancel': { command: 'meeting_cancel', payload: (action) => ({ meetingId: action.meetingId }), message: '讨论邀约已取消。' },
  'meeting-confirm': { command: 'meeting_confirm', payload: (action) => ({ meetingId: action.meetingId }), message: '讨论已确认，并加入已接受成员的个人日程。' },
  'meeting-apply-proposal': { command: 'meeting_apply_proposal', payload: (action) => ({ meetingId: action.meetingId, participantId: action.participantId }), message: '已采用建议时间，成员需要重新确认。' },
  'delivery-check-delete': { command: 'delivery_check_delete', payload: (action) => ({ checkId: action.checkId }), message: '交付检查项已删除。' },
}

/**
 * 确认弹窗按下确认后要发的项目命令。
 * @param {{ kind?: string } | null} action
 * @returns {{ command: string, payload: (action: any) => Record<string, any>, message: string } | null}
 *   未登记的 kind 返回 null（调用点静默中止，和原来的 `if (!command) return` 一致）。
 */
export function confirmCommand(action) {
  const entry = action && CONFIRM_COMMANDS[action.kind]
  if (!entry) return null
  return { command: entry.command, payload: entry.payload || (() => ({})), message: entry.message }
}

export { CONFIRM_COMMANDS }