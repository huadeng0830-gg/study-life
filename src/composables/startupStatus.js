/**
 * 启动占位状态。
 *
 * index.html 里先画出真实的结构骨架（步骤清单 + 卡片轮廓），
 * main.js 按 runStartupGate 的实际阶段点亮对应的一步。
 * 这样「短等待看结构」在 Vue 挂载之前就成立，不必等首屏 JS。
 */

/** 把 index.html 占位里的步骤清单更新到指定的当前阶段。 */
export function markStartupStep(stepId, root = null) {
  if (typeof document === 'undefined') return false
  const scope = root || document
  const steps = [...scope.querySelectorAll('[data-startup-step]')]
  if (!steps.length) return false
  const targetIndex = steps.findIndex((node) => node.getAttribute('data-startup-step') === stepId)
  if (targetIndex < 0) return false
  steps.forEach((node, index) => {
    node.dataset.state = index < targetIndex ? 'done' : index === targetIndex ? 'active' : 'pending'
  })
  return true
}

/** 把占位区域整体收尾（例如挂载完成后淡出）。 */
export function clearStartupPlaceholder(root = null) {
  if (typeof document === 'undefined') return false
  const scope = root || document
  const placeholder = scope.querySelector('[data-startup-placeholder]')
  if (!placeholder) return false
  placeholder.remove()
  return true
}