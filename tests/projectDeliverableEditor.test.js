// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'

const uploadFile = vi.hoisted(() => vi.fn())
vi.mock('../src/services/projects.js', () => ({
  newProjectId: () => globalThis.crypto.randomUUID(),
  uploadProjectDeliverableFile: uploadFile,
}))
import { useProjectDeliverableEditor } from '../src/composables/projects/useProjectDeliverableEditor.js'

function setup(item = {}) {
  const project = ref({ id: 'fictional-project', status: 'active' })
  const accountUser = ref({ id: 'fictional-account' })
  const context = createCollaborationContext(() => [project.value.id, accountUser.value.id])
  const projectRequest = vi.fn(async (action) => action === 'deliverable_draft_save' ? { revision: 6 } : { version: 1 })
  const loadProject = vi.fn()
  const loadInbox = vi.fn()
  const notify = vi.fn()
  const editor = useProjectDeliverableEditor({
    project, accountUser, projectRequest, loadProject, loadInbox, notify,
    captureRequest: context.capture, describeError: (error) => error.message,
  })
  editor.open({ id: 'fictional-deliverable', ...item })
  return { editor, project, accountUser, context, projectRequest, loadProject, loadInbox, notify }
}
const savedDraft = () => ({ draft: { revision: 5, content: { summary: '虚构原成果', links: [], files: [] } } })
const fileEvent = (files) => ({ target: { files, value: 'selected' } })
beforeEach(() => { localStorage.clear(); uploadFile.mockReset() })

describe('project deliverable editor', () => {
  it('saves current edits before freezing a submitted version', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    editor.draftContent.value.summary = '虚构新的成果'
    await editor.submit()
    expect(projectRequest.mock.calls.map(([action]) => action)).toEqual(['deliverable_draft_save', 'deliverable_submit'])
    expect(projectRequest.mock.calls[0][1]).toMatchObject({ expectedRevision: 5, content: { summary: '虚构新的成果' } })
    expect(editor.showDeliverableEditor.value).toBe(false)
  })

  it('allows a first submission without manually saving a draft', async () => {
    const { editor, projectRequest } = setup()
    editor.draftContent.value.summary = '虚构首次提交'
    await editor.submit()
    expect(projectRequest.mock.calls[0]).toEqual(['deliverable_draft_save', expect.objectContaining({ expectedRevision: 0 })])
    expect(projectRequest.mock.calls[1][0]).toBe('deliverable_submit')
  })

  it('edits link objects independently of the server draft', () => {
    const item = { draft: { revision: 1, content: { links: [{ type: 'document', title: '虚构文档', url: 'https://example.invalid/original' }] } } }
    const { editor } = setup(item)
    editor.draftContent.value.links[0].url = 'https://example.invalid/new'
    expect(item.draft.content.links[0].url).toBe('https://example.invalid/original')
  })

  it('preserves unsaved changes when closing and reopening in the same project', () => {
    const { editor } = setup(savedDraft())
    editor.draftContent.value.summary = '尚未保存的虚构草稿'
    editor.close()
    editor.open({ id: 'fictional-deliverable', ...savedDraft() })
    expect(editor.draftContent.value.summary).toBe('尚未保存的虚构草稿')
    expect(editor.dirty.value).toBe(true)
    editor.reset()
    editor.open({ id: 'fictional-deliverable', ...savedDraft() })
    expect(editor.draftContent.value.summary).toBe('虚构原成果')
  })

  it('rejects an oversized selection before uploading any file', async () => {
    const { editor } = setup()
    editor.draftContent.value.files = Array.from({ length: 9 }, (_, index) => ({ path: 'fictional-' + index }))
    await editor.upload(fileEvent([new File(['a'], 'fictional-a.txt'), new File(['b'], 'fictional-b.txt')]))
    expect(uploadFile).not.toHaveBeenCalled()
    expect(editor.error.value).toContain('最多 10 个文件')
    expect(editor.fileUploadBusy.value).toBe(false)
  })

  it('retains earlier files when a later upload fails', async () => {
    const { editor } = setup()
    uploadFile.mockResolvedValueOnce({ path: 'fictional-first', name: 'fictional-a.txt', size: 1 }).mockRejectedValueOnce(new Error('模拟网络失败'))
    await editor.upload(fileEvent([new File(['a'], 'fictional-a.txt'), new File(['b'], 'fictional-b.txt')]))
    expect(editor.draftContent.value.files).toHaveLength(1)
    expect(editor.error.value).toContain('已保留前 1 个文件')
  })

  it('keeps a replacement upload busy when an earlier editor resolves late', async () => {
    const { editor, context } = setup()
    const responses = []
    uploadFile.mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
    const first = editor.upload(fileEvent([new File(['a'], 'fictional-a.txt')]))
    context.invalidate(); editor.reset(); editor.open({ id: 'fictional-new-deliverable' })
    const second = editor.upload(fileEvent([new File(['b'], 'fictional-b.txt')]))
    responses[0]({ path: 'old', name: 'fictional-a.txt', size: 1 }); await first
    expect(editor.fileUploadBusy.value).toBe(true)
    expect(editor.draftContent.value.files).toEqual([])
    responses[1]({ path: 'new', name: 'fictional-b.txt', size: 1 }); await second
    expect(editor.fileUploadBusy.value).toBe(false)
  })

  it('keeps the submission key stable across a lost response and retry', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    let attempts = 0
    projectRequest.mockImplementation(async (action) => {
      if (action === 'deliverable_draft_save') return { revision: 6 }
      if (++attempts === 1) throw new Error('模拟响应丢失')
      return { version: 1 }
    })
    await editor.submit(); await editor.submit()
    const submits = projectRequest.mock.calls.filter(([action]) => action === 'deliverable_submit')
    expect(projectRequest.mock.calls.map(([action]) => action)).toEqual(['deliverable_draft_save', 'deliverable_submit', 'deliverable_submit'])
    expect(submits[0][1].submissionKey).toBe(submits[1][1].submissionKey)
    expect(submits[0][1].expectedRevision).toBe(6)
  })

  it('keeps edits and the editor open when a save conflicts', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    editor.draftContent.value.summary = '虚构未保存修改'
    projectRequest.mockRejectedValue(new Error('草稿版本冲突'))
    await editor.submit()
    expect(projectRequest.mock.calls.map(([action]) => action)).toEqual(['deliverable_draft_save'])
    expect(editor.showDeliverableEditor.value).toBe(true)
    expect(editor.draftContent.value.summary).toBe('虚构未保存修改')
    expect(editor.error.value).toBe('草稿版本冲突')
  })

  it('does not submit after closing the editor while its save is pending', async () => {
    const { editor, projectRequest } = setup()
    let finish
    projectRequest.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    editor.draftContent.value.summary = '虚构成果'
    const pending = editor.submit()
    editor.close()
    finish({ revision: 1 }); await pending
    expect(projectRequest).toHaveBeenCalledTimes(1)
  })

  it('checks the saved revision before submitting even without local edits', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    projectRequest.mockRejectedValue(new Error('另一标签页已更新草稿'))
    await editor.submit()
    expect(projectRequest.mock.calls.map(([action]) => action)).toEqual(['deliverable_draft_save'])
    expect(projectRequest.mock.calls[0][1].expectedRevision).toBe(5)
    expect(editor.showDeliverableEditor.value).toBe(true)
  })

  it('resumes with the completed save revision after closing during a save', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    let finish
    projectRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    editor.draftContent.value.summary = '虚构已保存内容'
    const pending = editor.save()
    editor.draftContent.value.summary = '虚构关闭前的最新修改'
    editor.close()
    finish({ revision: 6 }); await pending
    editor.open({ id: 'fictional-deliverable', draft: { revision: 6, content: { summary: '虚构已保存内容' } } })
    expect(editor.draftRevision.value).toBe(6)
    expect(editor.draftContent.value.summary).toBe('虚构关闭前的最新修改')
    await editor.save()
    expect(projectRequest.mock.calls[1][1]).toMatchObject({ expectedRevision: 6, content: { summary: '虚构关闭前的最新修改' } })
  })

  it('requires content and rejects non-HTTPS links inline', async () => {
    const { editor, projectRequest } = setup()
    await editor.submit()
    expect(editor.error.value).toContain('请添加成果')
    editor.addLink()
    editor.draftContent.value.links[0].url = 'http://example.invalid'
    await editor.save()
    expect(editor.error.value).toContain('HTTPS')
    expect(projectRequest).not.toHaveBeenCalled()
  })

  it('lets the user compare and keep local changes after a remote conflict', async () => {
    const { editor, projectRequest } = setup(savedDraft())
    editor.draftContent.value.summary = '虚构本次修改'
    projectRequest.mockRejectedValueOnce(Object.assign(new Error('项目版本冲突'), { code: 'conflict' }))
    await editor.save()
    expect(editor.conflict.value).toBe(true)
    projectRequest.mockResolvedValueOnce({ deliverables: [{ id: 'fictional-deliverable', draft: { revision: 7, content: { summary: '虚构远端修改' } } }] })
    await editor.loadLatestDraft()
    expect(editor.draftContent.value.summary).toBe('虚构本次修改')
    expect(editor.draftRevision.value).toBe(5)
    expect(editor.latestDraft.value.content.summary).toBe('虚构远端修改')
    editor.resolveConflict(true)
    expect(editor.draftRevision.value).toBe(7)
    expect(editor.draftContent.value.summary).toBe('虚构本次修改')
    await editor.save()
    expect(projectRequest.mock.calls.at(-1)[1].expectedRevision).toBe(7)
  })

  it('adopts the latest draft only after the user explicitly chooses it', async () => {
    const { editor } = setup(savedDraft())
    editor.draftContent.value.summary = '虚构本次修改'
    editor.latestDraft.value = { revision: 7, content: { summary: '虚构最新内容', links: [], files: [] } }
    editor.resolveConflict(false)
    expect(editor.draftContent.value.summary).toBe('虚构最新内容')
    expect(editor.dirty.value).toBe(false)
  })

  it('waits for a pending upload before adopting a remote draft', async () => {
    const { editor } = setup(savedDraft())
    let finish
    uploadFile.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    editor.latestDraft.value = { revision: 7, content: { summary: '虚构最新内容', links: [], files: Array.from({ length: 10 }, (_, index) => ({ path: `remote-${index}` })) } }
    const uploading = editor.upload(fileEvent([new File(['a'], 'fictional.txt')]))
    editor.resolveConflict(false)
    expect(editor.draftRevision.value).toBe(5)
    finish({ path: 'fictional-local-upload', name: 'fictional.txt', size: 1 }); await uploading
    editor.resolveConflict(false)
    expect(editor.draftContent.value.files).toHaveLength(10)
    expect(editor.draftContent.value.files.some((file) => file.path === 'fictional-local-upload')).toBe(false)
  })
})
