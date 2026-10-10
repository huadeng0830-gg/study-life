import { describe, expect, it, vi } from 'vitest'
import { createProjectRequestScope } from '../src/composables/projects/projectRequestScope.js'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'

function setup() {
  const context = { accountGeneration: 1, userId: 'fictional-user', projectGeneration: 1, projectId: 'fictional-a' }
  const account = createCollaborationContext(() => [context.userId])
  const project = createCollaborationContext(() => [context.userId, context.projectId])
  let resolve, reject
  const request = vi.fn(() => new Promise((success, failure) => { resolve = success; reject = failure }))
  const scope = createProjectRequestScope(request, { captureAccount: account.capture, captureProject: project.capture, readProjectId: () => context.projectId })
  return { context, scope, project, request, finish: (result) => resolve(result), fail: (error) => reject(error) }
}

describe('project request context', () => {
  it('discards an earlier visit even after returning to the same project', async () => {
    const fixture = setup()
    const pending = fixture.scope.request('task_update', { projectId: 'fictional-a' })
    const outcome = expect(pending).rejects.toMatchObject({ code: 'project_context_changed' })
    fixture.project.invalidate()
    fixture.finish({ revision: 2 })
    await outcome
  })

  it('discards old failures after replacing the account', async () => {
    const fixture = setup()
    const pending = fixture.scope.request('inbox')
    const outcome = expect(pending).rejects.toMatchObject({ code: 'project_context_changed' })
    fixture.context.userId = 'fictional-replacement'
    fixture.fail(new Error('Old account error'))
    await outcome
  })

  it('keeps account-wide lists valid during project selection', async () => {
    const fixture = setup()
    const pending = fixture.scope.request('list')
    fixture.project.invalidate()
    fixture.finish({ projects: [] })
    await expect(pending).resolves.toEqual({ projects: [] })
  })

  it('prevents an old visible resource from being written under a new selection', async () => {
    const fixture = setup()
    await expect(fixture.scope.request('task_update', { projectId: 'fictional-b' }))
      .rejects.toMatchObject({ code: 'project_context_changed' })
    expect(fixture.request).not.toHaveBeenCalled()
  })

  it('completes invitation joins while the initial project is being selected', async () => {
    const fixture = setup()
    const pending = fixture.scope.request('invite_join', { token: 'fictional-invitation' })
    fixture.project.invalidate()
    fixture.context.projectId = 'fictional-b'
    fixture.finish({ projectId: 'fictional-joined' })
    await expect(pending).resolves.toEqual({ projectId: 'fictional-joined' })
  })
})
