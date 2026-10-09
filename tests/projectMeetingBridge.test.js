import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { detachProjectMeetingEvents, syncProjectMeetingEvents } from '../src/composables/projectMeetingBridge.js'

function createDomain(initial = []) {
  const domain = { events: ref(initial), createEvent: vi.fn(), updateEvent: vi.fn() }
  domain.createEvent.mockImplementation((data) => {
    domain.events.value.push({ id: data.id || `local-${domain.events.value.length + 1}`, ...data })
  })
  domain.updateEvent.mockImplementation((id, data) => {
    const event = domain.events.value.find((item) => item.id === id)
    if (event) Object.assign(event, data)
    return event
  })
  return domain
}

const project = { id: 'project-1', name: '数学建模' }
const meeting = {
  id: 'meeting-1', projectId: project.id, title: '模型评审', note: '讨论误差分析',
  startsAt: '2026-10-10T01:30:00.000Z', endsAt: '2026-10-10T02:30:00.000Z', status: 'confirmed',
  participants: [{ userId: 'user-1', status: 'accepted' }],
}

describe('齐行讨论与个人日程联动', () => {
  it('只为已接受成员创建个人日程，并按账号时区转换时间', () => {
    const domain = createDomain()
    expect(syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1', 'Asia/Shanghai')).toBe(1)
    expect(domain.events.value[0]).toMatchObject({
      id: 'qixing-meeting-meeting-1', title: '小组讨论：模型评审', date: '2026-10-10', time: '09:30', endTime: '10:30',
      sourceType: 'project-meeting', sourceId: meeting.id, relationId: project.id,
    })
    expect(syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1', 'Asia/Shanghai')).toBe(0)
    expect(domain.createEvent).toHaveBeenCalledOnce()
  })

  it('讨论失去确认后标记为待确认，取消后保留历史并可在重新确认时恢复', () => {
    const domain = createDomain()
    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    const reopened = { ...meeting, status: 'open' }
    syncProjectMeetingEvents(project.id, [reopened], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('待确认：小组讨论：模型评审')
    expect(domain.events.value[0].sourceType).toBe('project-meeting')

    syncProjectMeetingEvents(project.id, [{ ...meeting, status: 'cancelled' }], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('已取消：小组讨论：模型评审')
    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('小组讨论：模型评审')
    expect(domain.createEvent).toHaveBeenCalledOnce()
  })

  it('不会将其他成员或拒绝邀请者的讨论写入个人日程', () => {
    const domain = createDomain()
    const otherAccepted = { ...meeting, participants: [{ userId: 'user-2', status: 'accepted' }] }
    syncProjectMeetingEvents(project.id, [otherAccepted], project, domain, 'user-1')
    expect(domain.createEvent).not.toHaveBeenCalled()

    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    const declined = { ...meeting, status: 'open', participants: [{ userId: 'user-1', status: 'declined' }] }
    syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('已拒绝：小组讨论：模型评审')
  })

  it('无法访问项目时只更新自己的关联日程状态', () => {
    const domain = createDomain()
    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    expect(detachProjectMeetingEvents(project.id, domain, 'user-1')).toBe(1)
    expect(domain.events.value[0]).toMatchObject({ title: '已退出：小组讨论：模型评审', sourceType: 'project-meeting' })
  })

  // 【前缀叠加回归】状态前缀是叠在日程标题上的，所以每次同步都必须能把它剥干净再重新加。
  // 原来剥离用的正则漏了「已拒绝：」，而前缀判定在"有人拒绝 + 讨论仍 open"时正会产出它。
  // 拒绝一次之后，这个函数每被调用一次标题就多一层前缀——而它在每次 loadProject 都会跑
  // （120 秒自动刷新、切换项目、手动刷新），标题因此无限膨胀。
  it('拒绝过一次后反复同步，标题前缀不会层层叠加', () => {
    const domain = createDomain()
    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    const declined = { ...meeting, status: 'open', participants: [{ userId: 'user-1', status: 'declined' }] }

    expect(syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')).toBe(1)
    expect(domain.events.value[0].title).toBe('已拒绝：小组讨论：模型评审')

    // 后续同步不应再改动标题，也不应再报告"有变更"。
    for (let round = 0; round < 4; round += 1) {
      expect(syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')).toBe(0)
      expect(domain.events.value[0].title).toBe('已拒绝：小组讨论：模型评审')
    }
  })

  it('前缀在各状态之间来回切换时也能干净地换掉', () => {
    const domain = createDomain()
    const cancelled = { ...meeting, status: 'cancelled' }
    const declined = { ...meeting, status: 'open', participants: [{ userId: 'user-1', status: 'declined' }] }

    // 先让本人接受，日程才会被创建（前缀才有载体可改）。
    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('小组讨论：模型评审')

    // 待确认 → 已拒绝 → 已取消 → 重新确认，任何序列都不该留下多层前缀。
    for (const state of [{ ...meeting, status: 'open' }, declined, cancelled, { ...meeting, status: 'open' }]) {
      syncProjectMeetingEvents(project.id, [state], project, domain, 'user-1')
    }
    expect(domain.events.value[0].title).toBe('待确认：小组讨论：模型评审')

    syncProjectMeetingEvents(project.id, [meeting], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('小组讨论：模型评审')
    syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')
    expect(domain.events.value[0].title).toBe('已拒绝：小组讨论：模型评审')
  })

  it('状态未变化时 changed 返回 0，调用方才能判断有无实际写入', () => {
    const domain = createDomain()
    const declined = { ...meeting, status: 'open', participants: [{ userId: 'user-1', status: 'declined' }] }
    syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')
    // 重复同一状态不应被算成一次变更。
    expect(syncProjectMeetingEvents(project.id, [declined], project, domain, 'user-1')).toBe(0)
  })
})
