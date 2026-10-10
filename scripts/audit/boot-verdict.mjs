// A navigation count alone cannot prove that the application opened.
export function bootAuditFailures({ navigationCount, probe, consoleErrors = [], exceptions = [], networkErrors = [] }) {
  const failures = []
  if (navigationCount < 1) failures.push('没有完成主框架导航')
  if (navigationCount > 2) failures.push('主框架导航超过 2 次，存在刷新循环')
  if (!probe?.appMounted) failures.push('应用没有挂载')
  if (probe?.placeholder) failures.push('启动占位界面仍可见')
  if (probe?.errorScreen) failures.push('启动失败界面可见')
  if (consoleErrors.length) failures.push('存在控制台错误')
  if (exceptions.length) failures.push('存在未捕获异常')
  if (networkErrors.length) failures.push('存在网络资源错误')
  return failures
}
