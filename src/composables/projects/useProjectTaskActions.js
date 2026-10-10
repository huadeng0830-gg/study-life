/** Track every task action while keeping the shared action lease intact. */
export function useProjectTaskActions(projectContext, actionBusy, currentRequest) {
  const pending = projectContext.state(() => new Set())

  async function run(taskId, operation) {
    if (pending.value.has(taskId)) return false
    const inFlight = pending.value
    inFlight.add(taskId)
    try {
      return await projectContext.run(operation, {
        busy: actionBusy, busyValue: `task:${taskId}`, current: currentRequest(),
      })
    } finally {
      // An old project's completion must not release the new project's action.
      inFlight.delete(taskId)
    }
  }

  return { pending, run }
}
