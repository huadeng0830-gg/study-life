import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'
import { useProjectTaskActions } from '../src/composables/projects/useProjectTaskActions.js'

describe('project task action leases', () => {
  it('isolates a new visit from an old request for the same task', async () => {
    const context = createCollaborationContext(() => ['fictional-project'])
    const busy = context.state('')
    const actions = useProjectTaskActions(context, busy, () => context.capture())
    let finishOld, finishNew
    const old = actions.run('task', () => new Promise((resolve) => { finishOld = resolve }))
    context.invalidate()
    const next = actions.run('task', () => new Promise((resolve) => { finishNew = resolve }))
    finishOld(); await old
    expect(actions.pending.value.has('task')).toBe(true)
    expect(busy.value).toBe('task:task')
    finishNew(); await next
    expect(actions.pending.value.size).toBe(0)
    expect(busy.value).toBe('')
  })

  it('releases a failed task so it can be retried', async () => {
    const onError = vi.fn()
    const context = createCollaborationContext(() => ['fictional-project'], { onError })
    const actions = useProjectTaskActions(context, ref(''), () => context.capture())
    await actions.run('task', async () => { throw new Error('fictional failure') })
    expect(onError).toHaveBeenCalledOnce()
    expect(actions.pending.value.size).toBe(0)
    const retry = vi.fn(async () => true)
    expect(await actions.run('task', retry)).toBe(true)
    expect(retry).toHaveBeenCalledOnce()
  })
})
