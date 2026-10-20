/**
 * 齐行确认弹窗文案的冻结守卫。
 *
 * 【为什么值得守】这段文案原来挤在 ProjectsView.vue 一条 1452 字符的单行里（三个内联对象
 * 字面量 + 两串三元链）。拆分时最容易出的错不是写坏逻辑，而是**顺手改了字**：
 * 「未完成的分工会释放」变成「未完成的任务会释放」这种改动没有任何测试会红，
 * 但用户看到的是权限后果被描述错了。所以这里把 11 种 kind 的文案逐字冻结。
 */
import { describe, expect, it } from 'vitest'
import { CONFIRM_COPY, confirmCommand, confirmDialogCopy } from '../src/composables/projects/projectConfirmCopy.js'

/** 拆分当天的逐字文案（只准在确实要改文案时同步改这里）。 */
const FROZEN = {
  archive: { title: '归档项目', message: '归档后，成员可以查看历史内容，但不能新增成员或任务。', confirmLabel: '确认', tone: 'primary' },
  delete: { title: '删除项目', message: '项目会移入回收站，成员暂时不能进入；可以通过负责人恢复项目。', confirmLabel: '确认删除', tone: 'danger' },
  leave: { title: '退出项目', message: '退出后，你的个人待办会保留为个人记录，项目负责人可以重新分配未完成任务。', confirmLabel: '确认', tone: 'danger' },
  restore: { title: '恢复项目', message: '恢复后，项目成员可以继续协作。', confirmLabel: '确认', tone: 'primary' },
  'decline-invite': { title: '拒绝项目邀请', message: '拒绝后，项目邀请会从待处理列表移除。', confirmLabel: '确认', tone: 'primary' },
  'delete-milestone': { title: '删除里程碑', message: '删除后，关联任务仍会保留，只解除与此阶段的关联。', confirmLabel: '确认删除', tone: 'danger' },
  'meeting-confirm': { title: '确认小组讨论', message: '所有受邀成员已接受。确认后会将讨论加入已接受成员的个人日程。', confirmLabel: '确认', tone: 'primary' },
  'meeting-cancel': { title: '取消讨论邀约', message: '取消后，成员的个人日程会标记为已取消。', confirmLabel: '确认', tone: 'danger' },
  'meeting-apply-proposal': { title: '采用改期建议', message: '采用后将新的时间发给全体受邀成员重新确认。', confirmLabel: '确认', tone: 'primary' },
  'delivery-check-delete': { title: '删除交付检查项', message: '删除后，交付清单会移除此检查项。', confirmLabel: '确认删除', tone: 'danger' },
}

describe('齐行确认弹窗文案', () => {
  it('每种 kind 的标题、正文、确认键与观感都和拆分前逐字一致', () => {
    for (const [kind, copy] of Object.entries(FROZEN)) {
      expect(confirmDialogCopy({ kind }), `${kind} 的文案变了`).toEqual(copy)
    }
  })

  it('移出成员的正文按成员名插值，缺名字时退回「该成员」', () => {
    expect(confirmDialogCopy({ kind: 'remove', targetName: '虚构同学' }).message)
      .toBe('确定将虚构同学移出项目吗？未完成的分工会释放。')
    expect(confirmDialogCopy({ kind: 'remove' }).message).toBe('确定将该成员移出项目吗？未完成的分工会释放。')
    expect(confirmDialogCopy({ kind: 'remove', targetName: '' }).message)
      .toBe('确定将该成员移出项目吗？未完成的分工会释放。')
    expect(confirmDialogCopy({ kind: 'remove', targetName: '虚构同学' }))
      .toMatchObject({ title: '移出成员', confirmLabel: '确认删除', tone: 'danger' })
  })

  it('未知/空 kind 沿用原来的兜底（标题「确认操作」、空正文、primary）', () => {
    const fallback = { title: '确认操作', message: '', confirmLabel: '确认', tone: 'primary' }
    expect(confirmDialogCopy({ kind: 'fictional-unknown' })).toEqual(fallback)
    expect(confirmDialogCopy(null)).toEqual(fallback)
    expect(confirmDialogCopy(undefined)).toEqual(fallback)
  })

  it('表里登记的 kind 数与齐行的动作表一致（新增 kind 必须同步补文案）', () => {
    expect(Object.keys(CONFIRM_COPY).sort()).toEqual([...Object.keys(FROZEN), 'remove'].sort())
    for (const copy of Object.values(CONFIRM_COPY)) {
      expect(typeof copy.title === 'string' && copy.title.length > 0).toBe(true)
      expect(['string', 'function']).toContain(typeof copy.message)
    }
  })
})

describe('齐行确认动作对应的项目命令', () => {
  const action = { kind: '', targetId: 'fictional-member', milestoneId: 'fictional-milestone', checkId: 'fictional-check', meetingId: 'fictional-meeting', participantId: 'fictional-participant' }

  it('每个有文案的 kind 都有对应命令，命令名与 payload 原样保留', () => {
    const expected = {
      archive: ['archive', { archived: true }],
      restore: ['archive', { archived: false }],
      delete: ['delete', {}],
      leave: ['member_leave', {}],
      'decline-invite': ['invite_respond', { decision: 'decline' }],
    }
    for (const copyKind of Object.keys(CONFIRM_COPY)) {
      expect(confirmCommand({ ...action, kind: copyKind }), `${copyKind} 缺命令`).not.toBeNull()
    }
    for (const [kind, [command, payload]] of Object.entries(expected)) {
      const entry = confirmCommand({ ...action, kind })
      expect(entry.command, kind).toBe(command)
      expect(entry.payload({ ...action, kind }), kind).toEqual(payload)
    }
    expect(confirmCommand({ ...action, kind: 'remove' }).payload({ ...action, kind: 'remove' })).toEqual({ targetId: action.targetId })
    expect(confirmCommand({ ...action, kind: 'delete-milestone' }).payload({ ...action, kind: 'delete-milestone' })).toEqual({ milestoneId: action.milestoneId })
    expect(confirmCommand({ ...action, kind: 'delivery-check-delete' }).payload({ ...action, kind: 'delivery-check-delete' })).toEqual({ checkId: action.checkId })
    expect(confirmCommand({ ...action, kind: 'meeting-apply-proposal' }).payload({ ...action, kind: 'meeting-apply-proposal' }))
      .toEqual({ meetingId: action.meetingId, participantId: action.participantId })
  })

  it('命令成功后展示的文案和弹窗正文是两套，各自不串台', () => {
    expect(confirmCommand({ kind: 'delete' }).message).toBe('项目已移入回收站。你可以立即撤销。')
    expect(confirmCommand({ kind: 'meeting-confirm' }).message).toBe('讨论已确认，并加入已接受成员的个人日程。')
    expect(confirmCommand({ kind: 'delete' }).message).not.toBe(confirmDialogCopy({ kind: 'delete' }).message)
  })

  it('未登记/空 action 返回 null（调用点静默中止）', () => {
    expect(confirmCommand({ kind: 'fictional-unknown' })).toBeNull()
    expect(confirmCommand(null)).toBeNull()
    expect(confirmCommand(undefined)).toBeNull()
  })
})