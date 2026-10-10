const ACCOUNT_ACTIONS = new Set(['list', 'inbox', 'create', 'invite_join', 'invite_respond', 'restore'])

function cancelledRequest() {
  const error = new Error('项目或账号已切换。')
  error.code = 'project_context_changed'
  return error
}

/** Discards both successes and failures from an earlier account or project visit. */
export function createProjectRequestScope(request, { captureProject, captureAccount, readProjectId }) {

  async function scopedRequest(action, payload = {}) {
    const accountOnly = ACCOUNT_ACTIONS.has(action)
    const isCurrent = accountOnly ? captureAccount() : captureProject()
    if (!accountOnly && payload.projectId
      && payload.projectId !== readProjectId()) throw cancelledRequest()
    try {
      const result = await request(action, payload)
      if (!isCurrent()) throw cancelledRequest()
      return result
    } catch (error) {
      if (!isCurrent()) throw cancelledRequest()
      throw error
    }
  }

  return { request: scopedRequest }
}
