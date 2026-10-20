/**
 * 齐行项目页的「作用域化动作」执行器。
 *
 * 【为什么需要它】抽取前 ProjectsView.vue 里有 16 处逐字重复的样板：
 *     if (actionBusy.value) return
 *     const isCurrent = projectContext.capture()
 *     actionBusy.value = 'xxx'
 *     try { …await projectRequest(…)… }
 *     catch (error) { if (!isCurrent()) return; notify('error', errorMessage(error)) }
 *     finally { if (isCurrent()) actionBusy.value = '' }
 * 再加 12 处成功后 `await loadProject(project.value.id)`。逐字重复的代价不是行数，而是：
 * 任何一处抄漏 `catch` 里的 isCurrent 判定，就会把旧账号/旧项目的失败提示打进新页面；
 * 抄漏 `finally` 里的判定，就会让旧请求清掉新请求的忙态。
 *
 * 【为什么不是新发明一套判定】它直接映射到 createCollaborationContext 已有的 run()
 * （生产代码里 useProjectTaskActions / useProjectMeetings 已经这么用）：
 *   - 「同一时刻只允许一个动作」= 调用点原本的门闩检查；run 的 busy 只负责登记/释放租约；
 *   - 「身份捕获、过期即丢弃」= run 的 current 守卫，默认就是 projectContext.capture()；
 *   - 「旧 finally 不能释放新请求的忙态」= run 的租约归属判定（pending.get(busy) === lease），
 *     invalidate() 会先把 pending 清空并把忙态复位，旧请求随后既不会提交也不会清错；
 *   - 「失败只通知当前访问」= run 的 onError 只在 isCurrent() 为真时触发，静默语义不变。
 *
 * 【身份判定不许被这里改掉】守卫由调用点显式传入：项目级动作传 projectContext.capture()
 * 或 currentProjectRequest()，表单动作传 createProjectEditorScope 的 capture()。
 * helper 只转发，不放宽也不收紧，尤其不会让旧账号/旧项目的响应写进新账号/新项目。
 */

/**
 * @param {object} options
 * @param {ReturnType<import('../collaborationContext.js').createCollaborationContext>} options.context 身份上下文
 * @param {import('vue').Ref<any>} options.busy 默认忙态 ref（齐行里是 projectContext.state('') 的 actionBusy）
 * @param {(kind: 'info'|'success'|'warning'|'error', text: string) => void} options.notify 顶部提示
 * @param {(error: unknown, fallback?: string) => string} options.describeError 错误文案（空字符串表示静默）
 * @param {() => Promise<any>} options.reload 默认的「成功后重载」
 */
export function useScopedProjectAction({ context, busy, notify, describeError, reload }) {
  /**
   * @param {object} options
   * @param {() => boolean|string} [options.check] 同步前置校验：返回 true 继续，false 静默中止，
   *   字符串则作为错误提示（调用点要写表单错误位时自己在 check 里写，再返回 false）。
   * @param {import('vue').Ref<any>} [options.busy] 本次动作的忙态 ref，默认共享的 actionBusy。
   * @param {string|boolean} [options.busyValue] 忙态值；字符串用于 actionBusy 这种带作用域前缀的租约。
   * @param {() => boolean} [options.current] 身份守卫工厂，默认 context.capture()。
   * @param {(isCurrent: () => boolean) => Promise<any>} options.operation 真正的请求。
   * @param {string|((result: any) => string)} [options.success] 成功提示。
   * @param {(result: any, isCurrent: () => boolean) => Promise<any>} [options.commit] 成功后、提示与重载前的收尾；
   *   需要再判一次身份时用第二个参数（它与本次请求捕获的是同一个守卫）。
   * @param {(() => Promise<any>)|false} [options.reload] 成功后的重载；false 表示不重载；默认用工厂的 reload。
   * @param {(error: unknown) => void} [options.onError] 失败提示；默认 notify('error', describeError(error))。
   * @returns {Promise<any>} 成功时是请求结果；被门闩/校验拦下、身份过期或失败时是 false。
   */
  async function run(options) {
    const { check, busy: lease = busy, busyValue = true, current, operation, success, commit, reload: afterReload, onError } = options
    if (check) {
      const blocked = check()
      if (typeof blocked === 'string') { if (blocked) notify('error', blocked); return false }
      if (!blocked) return false
    }
    // 调用点原来的 `if (actionBusy.value) return`：忙态是全局门闩，租约由 run 登记与释放。
    if (lease.value) return false
    return context.run(async (isCurrent) => {
      const result = await operation(isCurrent)
      // 对应原来 16 处 `catch`/请求后的 `if (!isCurrent()) return`：响应回来时身份已经
      // 换人/换项目，就既不提示、也不重载、也不写回任何状态。必须在收尾之前判，
      // 否则 stale 响应会先跑完 notify/commit 才轮到 run 的过期检查。
      if (!isCurrent()) return false
      if (success) notify('success', typeof success === 'function' ? success(result) : success)
      if (commit) await commit(result, isCurrent)
      if (afterReload !== false) await (afterReload || reload)()
      return result
    }, {
      busy: lease, busyValue, current: current || context.capture(),
      onError: onError || ((error) => notify('error', describeError(error))),
    })
  }

  return { run }
}