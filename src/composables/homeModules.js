export const HOME_MODULES = [
  { id: 'next', label: '接下来' },
  { id: 'tasks', label: '现在该做' },
  { id: 'countdowns', label: '需要注意' },
  { id: 'focus', label: '专注' },
  { id: 'week', label: '本周进展' },
  { id: 'finance', label: '本周收支' },
]

/** 保留已存的合法顺序与可见状态，并将新模块追加到末尾。 */
export function normalizeHomeModuleOrder(value, definitions = HOME_MODULES) {
  const existing = Array.isArray(value) ? value : []
  const knownIds = new Set(definitions.map((item) => item.id))
  const ordered = existing.filter((entry) => entry && knownIds.has(entry.id))
  const seen = new Set(ordered.map((entry) => entry.id))
  for (const item of definitions) {
    if (!seen.has(item.id)) ordered.push({ id: item.id, visible: true })
  }
  return ordered
}

export function findHomeModuleState(modules, id) {
  return modules.find((item) => item.id === id) ?? { id, visible: true }
}

/** 返回重排后的新数组；无效位置直接返回原数组。 */
export function reorderHomeModules(modules, from, to) {
  if (from === to || from < 0 || to < 0 || from >= modules.length || to >= modules.length) return modules
  const ordered = [...modules]
  const [moved] = ordered.splice(from, 1)
  ordered.splice(to, 0, moved)
  return ordered
}

/** 恢复标准模块顺序，同时保留用户逐项设置的可见状态。 */
export function resetHomeModuleOrder(modules, definitions = HOME_MODULES) {
  const visibility = new Map(modules.map((item) => [item.id, item.visible]))
  return definitions.map((item) => ({ id: item.id, visible: visibility.get(item.id) ?? true }))
}
