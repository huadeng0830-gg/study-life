import { beforeEach, describe, expect, it, vi } from 'vitest'

const socialRequest = vi.hoisted(() => vi.fn())
vi.mock('../src/services/social.js', () => ({ socialRequest }))

import { newProjectId, normalizeProjectForm, projectRequest, validateProjectForm } from '../src/services/projects.js'

// 与 uploadProjectDeliverableFile / getProjectDeliverableFileUrl 校验成果文件路径用的是
// 同一个 UUID_PATTERN。ID 生成器的兜底分支必须也满足它，否则非安全上下文（桌面版以
// file:// 打开、旧浏览器缺 randomUUID）下能建项目却传不了附件。
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('齐行项目服务', () => {
  beforeEach(() => socialRequest.mockReset())

  it('在没有 randomUUID 的环境下仍产出合法的 v4 形状编号', () => {
    const real = globalThis.crypto
    const realGetRandomValues = real?.getRandomValues?.bind(real)
    try {
      Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: realGetRandomValues }, configurable: true })
      expect(newProjectId()).not.toBe('')
      expect(UUID_PATTERN.test(newProjectId())).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
    }
    // 恢复真实环境后同样成立，且抽样不会漂移出版本位/variant 位允许的范围。
    for (let index = 0; index < 500; index += 1) expect(UUID_PATTERN.test(newProjectId())).toBe(true)
  })

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
