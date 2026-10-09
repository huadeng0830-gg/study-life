/**
 * Fetch optional checkpoint history without making project loading depend on it.
 * @param {string} projectId
 * @param {(action: string, payload: Record<string, unknown>) => Promise<any>} request
 * @param {(error: unknown) => string} describeError
 */
export async function loadProjectTaskCheckpoints(projectId, request, describeError) {
  try {
    const result = await request('task_checkpoints', { projectId })
    return { items: Array.isArray(result?.checkpoints) ? result.checkpoints : [], error: '' }
  } catch (error) {
    return { items: [], error: describeError(error) }
  }
}

/** Add server checkpoints to the existing project-task objects in memory. */
export function attachProjectTaskCheckpoints(tasks, checkpoints) {
  const byTaskId = new Map(checkpoints.map((entry) => [String(entry.taskId), entry]))
  return tasks.map((task) => {
    const saved = byTaskId.get(String(task.id))
    if (!saved) return task
    const checkpoint = saved.checkpoint || {}
    const isCleared = !checkpoint.lastStep && !checkpoint.blocker && !checkpoint.nextStep && !checkpoint.resources?.length
    return {
      ...task,
      workCheckpoint: isCleared ? null : { ...checkpoint, updatedAt: saved.updatedAt },
      workCheckpointUpdatedAt: saved.updatedAt,
      workCheckpointActorName: saved.actorName || '',
    }
  })
}
