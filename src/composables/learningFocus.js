/** Prepare a linked focus session on Today; starting the timer stays explicit. */
export function taskFocusLocation(task, minutes = 25) {
  const duration = Math.max(5, Math.min(180, Math.round(Number(minutes) || 25)))
  return { path: '/', query: { focusTask: String(task.id), focusMinutes: String(duration) } }
}
