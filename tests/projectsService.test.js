import { beforeEach, describe, expect, it, vi } from 'vitest'

const socialRequest = vi.hoisted(() => vi.fn())
vi.mock('../src/services/social.js', () => ({ socialRequest }))

import { normalizeProjectForm, projectRequest, validateProjectForm } from '../src/services/projects.js'

describe('齐行项目服务', () => {
  beforeEach(() => socialRequest.mockReset())

  it('规范化项目表单并保留允许的项目类型', () => {
    expect(normalizeProjectForm({ name: '  课程设计 ', type: 'course', description: '  分工与交付  ' })).toEqual({
      name: '课程设计', description: '分工与交付', type: 'course', startsOn: '', targetEndOn: '',
    })
    expect(normalizeProjectForm({ name: '项目', type: 'unknown' }).type).toBe('blank')
  })

  it('接受只有名称的个人项目，并拒绝无效日期范围', () => {
    expect(validateProjectForm({ name: '独立开发' })).toMatchObject({ ok: true, value: { type: 'blank', targetEndOn: '' } })
    expect(validateProjectForm({ name: '竞赛', startsOn: '2026-10-10', targetEndOn: '2026-10-09' })).toMatchObject({
      ok: false, field: 'targetEndOn',
    })
    expect(validateProjectForm({ name: ' ' })).toMatchObject({ ok: false, field: 'name' })
  })

  it('将项目动作转发到现有好友协作服务', async () => {
    socialRequest.mockResolvedValue({ projects: [] })
    await expect(projectRequest('list')).resolves.toEqual({ projects: [] })
    expect(socialRequest).toHaveBeenCalledWith('project_list', {})
  })
})
