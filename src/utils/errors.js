/**
 * 把 catch 到的任意值收敛成一句可以直接展示给用户的话。
 *
 * 这个函数此前在列表页、平台运维页、项目协作页各写过一版，签名和默认文案还各不相同：
 * 列表页没有 fallback 参数、运维页强制要传、项目页额外把 `project_context_changed` 静默掉。
 * 三份副本意味着「用户看到的失败提示」要改三个地方，而且早晚会漂移。
 *
 * 领域特有的分支（项目页那个错误码）不往这里塞——那属于调用方的规则，
 * 它在自己的文件里包一层薄壳即可，通用部分由本函数提供。
 *
 * @param {unknown} cause
 * @param {string} [fallback] 拿不到可用信息时展示的兜底文案
 * @returns {string} 空串表示调用方应保持静默
 */
export function errorMessage(cause, fallback = '操作没有完成，请稍后重试。') {
  if (typeof cause === 'string' && cause.trim()) return cause.trim()
  if (cause && typeof cause === 'object') {
    const message = /** @type {{ message?: unknown }} */ (cause).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}