// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: null, client: null, getClient: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  mocks.user = ref(null)
  return { accountUser: mocks.user }
})
vi.mock('../src/services/supabase.js', () => ({ getSupabaseClient: mocks.getClient }))
vi.mock('../src/composables/accountSyncState.js', () => ({ accountSyncStatus: { value: 'synced' }, syncAccountNow: vi.fn() }))
vi.mock('../src/composables/accountSyncMode.js', () => ({ accountSyncViaAccount: { value: true } }))
import { getProjectDeliverableFileUrl, uploadProjectDeliverableFile } from '../src/services/projects.js'
import { socialRequest } from '../src/services/social.js'

const userId = '00000001-0000-4000-8000-000000000001'
const projectId = '00000002-0000-4000-8000-000000000002'
const deliverableId = '00000003-0000-4000-8000-000000000003'
const upload = vi.fn(), signedUrl = vi.fn()
beforeEach(() => {
  mocks.user.value = { id: userId, email_confirmed_at: '2026-01-01T00:00:00Z' }
  upload.mockReset().mockResolvedValue({ error: null })
  signedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://example.invalid/fictional-file' }, error: null })
  mocks.client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: userId }, access_token: 'fictional-token' } } })) },
    functions: { invoke: vi.fn() }, storage: { from: vi.fn(() => ({ upload, createSignedUrl: signedUrl })) },
  }
  mocks.getClient.mockResolvedValue(mocks.client)
})
describe('project files and service errors', () => {
  it('uploads a safe path for filenames with consecutive dots and preserves the visible name', async () => {
    const result = await uploadProjectDeliverableFile(projectId, deliverableId, new File(['fictional data'], 'fictional-report..txt'))
    expect(result.path).not.toContain('..')
    expect(result.name).toBe('fictional-report..txt')
    expect(upload).toHaveBeenCalledOnce()
  })
  it('rejects traversal segments but can download legitimate existing dot filenames', async () => {
    await expect(getProjectDeliverableFileUrl(`${projectId}/${deliverableId}/${userId}/..`)).rejects.toThrow('路径无效')
    expect(signedUrl).not.toHaveBeenCalled()
    await expect(getProjectDeliverableFileUrl(`${projectId}/${deliverableId}/${userId}/fictional-report..txt`)).resolves.toContain('example.invalid')
  })
  it('preserves the project conflict message instead of replacing it with time availability text', async () => {
    mocks.client.functions.invoke.mockResolvedValue({ error: { context: new Response(JSON.stringify({ code: 'conflict', error: '项目刚刚发生变化，请刷新后重新提交。' }), { status: 409 }) } })
    await expect(socialRequest('project_deliverable_submit')).rejects.toMatchObject({ code: 'conflict', message: '项目刚刚发生变化，请刷新后重新提交。' })
  })
})
