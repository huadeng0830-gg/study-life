import { ref } from 'vue'

export const isAndroidApp = import.meta.env.MODE === 'android'

let exportBridgeInstalled = false

/* ---------- 系统返回键 ---------- */

/**
 * 「再按一次返回键退出」的提示文案。
 *
 * 原来在最外层按返回键会**直接退出应用**（canGoBack 为 false 就 exitApp）。
 * 手机上误触返回键的代价是"当前页面、滚动位置、打开着的筛选条件"全丢，
 * 而安卓自己的惯例是"再按一次退出"。这里补上确认这一步。
 */
export const ANDROID_EXIT_HINT = '再按一次返回键退出三两事'
export const androidExitHint = ref(false)

/** 两次返回键之间必须间隔多久才算"确认退出"。 */
const EXIT_CONFIRM_WINDOW_MS = 2000
let lastBackAt = 0
let exitHintTimer = 0

function showExitHint() {
  androidExitHint.value = true
  window.clearTimeout(exitHintTimer)
  exitHintTimer = window.setTimeout(() => { androidExitHint.value = false }, EXIT_CONFIRM_WINDOW_MS)
}

function hideExitHint() {
  window.clearTimeout(exitHintTimer)
  androidExitHint.value = false
}

/**
 * 处理安卓返回键。
 *
 * 【为什么直接用 history.back()】最上层的浮层（弹窗、底部面板）由
 * composables/overlayStack.js 压在**同一条 history** 上：打开浮层会 pushState
 * 一条同址记录，所以 history.back() 正好关掉最上面那一层，路由也不会跟着变。
 * 因此这里不需要（也不应该）另外去查浮层栈。
 *
 * @param {{ exitApp: Function, minimizeApp?: Function }} App Capacitor 的 App 插件
 * @param {{ canGoBack?: boolean }} payload 返回键事件载荷
 */
async function handleAndroidBack(App, payload) {
  const canGoBack = payload?.canGoBack ?? false
  if (canGoBack) {
    window.history.back()
    return
  }
  const now = Date.now()
  if (now - lastBackAt < EXIT_CONFIRM_WINDOW_MS) {
    lastBackAt = 0
    hideExitHint()
    // 退到后台而不是销毁 Activity：这样应用还留在最近任务里，
    // 用户切回来时页面状态还在（安卓自己的行为就是这样）。
    if (typeof App.minimizeApp === 'function') await App.minimizeApp()
    else await App.exitApp()
    return
  }
  lastBackAt = now
  showExitHint()
}

/* ---------- 系统状态栏 ---------- */

/**
 * Capacitor 的 SystemBars 插件在运行时写到 documentElement 上的安全区变量名。
 *
 * 安卓的 inset 不走 env()：原生层把状态栏/导航栏/刘海的高度算好后注入成这几个
 * CSS 变量，网页层再用 var(--safe-*) 读它们（见 styles/safe-area.css）。
 * 这四个名字**故意不在 CSS 里声明** —— 一旦声明成 0px，var() 的回退就永远不会
 * 触发，iOS 的 env() 会被吃掉。
 *
 * 这里留着名单是为了能做启动自检：变量一个都没注入时（插件没跑起来），
 * 界面会退回 env()，在有刘海的机型上顶部会被状态栏压住。
 */
export const NATIVE_SAFE_AREA_TOKENS = Object.freeze([
  '--safe-area-inset-top',
  '--safe-area-inset-right',
  '--safe-area-inset-bottom',
  '--safe-area-inset-left',
])

/** 原生是否已经注入安全区变量（用于启动自检与诊断）。 */
export function nativeSafeAreaInjected() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return false
  const style = getComputedStyle(document.documentElement)
  return NATIVE_SAFE_AREA_TOKENS.some((token) => style.getPropertyValue(token).trim() !== '')
}

/**
 * 状态栏图标的明暗要跟着**应用主题**走，而不是跟着系统深浅走。
 *
 * 应用主题由网页层决定（默认浅色，用户可切深色/跟随系统），
 * Capacitor 的 SystemBars 插件默认按**系统**深浅决定。两者不一致时，
 * 系统是深色、应用是浅色 → 状态栏是白图标压在浅色顶栏上，等于看不见。
 *
 * Capacitor 的命名是「底色深浅」：LIGHT = 浅底（深图标），DARK = 深底（浅图标）。
 */
function systemBarStyleForTheme() {
  const theme = globalThis.document?.documentElement?.dataset?.theme
  return theme === 'dark' ? 'DARK' : 'LIGHT'
}

async function applySystemBarStyle() {
  const plugin = globalThis.Capacitor?.Plugins?.SystemBars
  if (!plugin?.setStyle) return
  try {
    await plugin.setStyle({ style: systemBarStyleForTheme() })
  } catch {
    // 插件不可用（例如旧内核）时保持默认外观，不影响主流程。
  }
}

/**
 * 主题切换时同步状态栏。
 * 主题是写在 <html data-theme> 上的，所以直接观察这个属性，
 * 不必让 theme.js 反向依赖安卓层。
 */
function watchThemeForSystemBars() {
  const root = globalThis.document?.documentElement
  if (!root || typeof globalThis.MutationObserver !== 'function') return
  const observer = new globalThis.MutationObserver(() => { void applySystemBarStyle() })
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
}

/**
 * 安卓原生运行时接线。
 *
 * 整个函数包在 try/catch 里：原生插件缺失时（测试环境、浏览器里预览 APK 资源）
 * 只能是"少几个原生能力"，绝不能把整个应用带崩。
 */
export async function initializeAndroidRuntime() {
  if (!isAndroidApp) return
  installAndroidExportBridge()
  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', (payload) => {
      void handleAndroidBack(App, payload)
    })
    await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void import('./store/core.js').then(({ flushStoredWrites }) => flushStoredWrites())
    })
  } catch (error) {
    console.warn('[android] 原生插件不可用，返回键与状态栏保持默认行为', error)
  }
  await applySystemBarStyle()
  watchThemeForSystemBars()
  if (!nativeSafeAreaInjected()) {
    // 不是致命问题：样式会退回 env()（新内核上照样对），但值得留一条记录，
    // 免得将来出现"顶部被状态栏压住"时查不到原因。
    console.warn('[android] 原生未注入安全区变量，已退回浏览器原生的安全区数值')
  }
}

/* ---------- 导出结果回传 ---------- */

/**
 * 安卓导出结果事件名。
 *
 * 【为什么要回传】网页端的"下载"是同步的：link.click() 之后文件已经落到磁盘，
 * 于是代码可以立刻标记"已备份"。安卓不是这样：点击被原生桥接管，
 * 弹出的是**系统分享面板**，用户可以选"取消"——而且是异步的。
 * 原先不管成功失败都标记了"已备份"，于是用户点了取消、文件根本没保存，
 * 备份提醒却安静地停了七天（这是这个应用唯一的数据安全网）。
 */
export const ANDROID_EXPORT_EVENT = 'study-life:android-export'

function notifyAndroidExport(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ANDROID_EXPORT_EVENT, { detail }))
}

/**
 * 在触发安卓导出**之前**调用，返回一个等待结果的 Promise。
 *
 * 必须在点击之前调用：分享面板的结果是异步回来的，事件不等人。
 *
 * 超时取 10 分钟：分享面板是系统界面，用户可能挑很久才选一个目标应用；
 * 超时太短会在用户还在面板里时就报"未保存"。
 * 原生桥没装上时直接返回 null，调用方按网页端的旧行为处理（不阻塞）。
 *
 * @returns {Promise<{ ok: boolean, cancelled?: boolean }>|null} 非安卓或桥未就绪时返回 null
 */
export function expectAndroidExport({ timeoutMs = 600000 } = {}) {
  if (!isAndroidApp || !exportBridgeInstalled || typeof window === 'undefined') return null
  return new Promise((resolve) => {
    let timer = 0
    const finish = (detail) => {
      window.clearTimeout(timer)
      window.removeEventListener(ANDROID_EXPORT_EVENT, onEvent)
      resolve(detail)
    }
    const onEvent = (event) => finish(event?.detail || { ok: false })
    window.addEventListener(ANDROID_EXPORT_EVENT, onEvent)
    timer = window.setTimeout(() => finish({ ok: false, timedOut: true }), timeoutMs)
  })
}

export function installAndroidExportBridge() {
  if (!isAndroidApp || exportBridgeInstalled) return
  exportBridgeInstalled = true
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof window.Element ? event.target.closest('a[download]') : null
    if (!(anchor instanceof window.HTMLAnchorElement) || !anchor.href.startsWith('blob:')) return
    event.preventDefault()
    // Start reading while the caller's object URL is still alive.
    const content = fetch(anchor.href).then((response) => response.blob())
    void shareExport(content, anchor.download)
      .then(() => notifyAndroidExport({ ok: true }))
      .catch(async (error) => {
        if (error?.message === 'Share canceled') {
          notifyAndroidExport({ ok: false, cancelled: true })
          return
        }
        const notice = document.querySelector('[data-android-export-error]') || document.createElement('p')
        notice.setAttribute('data-android-export-error', '')
        notice.setAttribute('role', 'alert')
        notice.className = 'error'
        notice.textContent = '导出未完成，请重试，并在系统分享面板选择保存位置。'
        if (!notice.isConnected) (document.querySelector('main') || document.body).prepend(notice)
        notifyAndroidExport({ ok: false, cancelled: false })
      })
  }, true)
}

async function shareExport(content, name) {
  const blob = await content
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'), import('@capacitor/share'),
  ])
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const filename = String(name || '三两事导出.json').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-160)
  try {
    const existing = await Filesystem.readdir({ path: 'exports', directory: Directory.Cache })
    const sorted = existing.files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    await Promise.all(sorted.filter((file, index) => file.type === 'file' && (index >= 9 || (file.mtime || 0) < Date.now() - 86400000))
      .map((file) => Filesystem.deleteFile({ path: `exports/${file.name}`, directory: Directory.Cache }).catch(() => {})))
  } catch { /* No previous exports on a fresh installation. */ }
  const path = `exports/${Date.now()}-${crypto.randomUUID()}-${filename}`
  const saved = await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true })
  // Keep the bounded private cache alive while the receiving app reads the URI.
  await Share.share({ title: '保存三两事导出文件', url: saved.uri, dialogTitle: '保存或分享文件' })
}
