// 安卓安装版的应用内更新：检查新版本 → 下载 APK → 交给系统安装器。
//
// 【为什么安卓要自己写一套】网页版的更新靠 Service Worker 换资源；
// APK 的资源是打进安装包里的，而且**刻意不跑 Service Worker**
// （见 composables/appUpdate.js），否则 SW 会覆盖签名包里的资源，
// "已安装的包"与"实际在跑的资源"就对不上，签名校验失去意义。
// 所以安卓只能走"换包"这条路。
//
// 【更新源】GitHub Releases。理由：
//   - 安装包本来就发布在那里（版本与更新面板里给的就是这个入口）；
//   - 桌面版的自动更新（electron-updater）走的是同一个通道，两端口径一致；
//   - API 直接给出安装包的下载地址与大小，不用在代码里猜标签名与文件名。
//
// 【为什么不读网页的 release.json】APK 的 origin 是 study-life.pages.dev，
// 而 WebView 的本地资源服务器会**拦截对同一 host 的所有请求**并返回安装包里
// 那份旧的 release.json —— 读到的永远是"自己"，永远查不到新版。
// GitHub 的域名不在拦截名单里，走的是真实网络。
import { ref } from 'vue'
import { isAndroidApp } from './androidRuntime.js'
import { compareRelease, safeUpdateError, updateError } from './updateProtocol.js'
import { APP_RELEASE } from './versionInfo.js'

/** GitHub Releases 的最新版本接口。 */
const RELEASES_API = 'https://api.github.com/repos/huadeng0830-gg/study-life/releases/latest'
/** 允许下载安装包的主机。原生插件那边也会再挡一次，两边都挡是为了不让单边失效。 */
const TRUSTED_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com']
const CHECK_TIMEOUT_MS = 12000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
/** 自动检查的最小间隔：反复打开这个面板不该反复去问更新服务。 */
const AUTO_CHECK_THROTTLE_MS = 90000

const STAGES = new Set(['idle', 'checking', 'latest', 'available', 'downloading', 'ready', 'installing', 'completed', 'cancelled', 'error'])

/** @typedef {{ version: string, notes: string, publishedAt: string, apkUrl: string, apkName: string, apkBytes: number, releaseUrl: string }} AndroidRelease */

/**
 * 解析 GitHub 的 release 载荷。
 *
 * 这是**不可信的外部数据**，所以每一项都单独校验后才返回；
 * 解析不出来就返回 null，调用方按"没有可用更新"处理。
 *
 * @param {unknown} value
 * @returns {AndroidRelease|null}
 */
export function parseAndroidRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = /** @type {Record<string, unknown>} */ (value)
  if (payload.draft === true || payload.prerelease === true) return null
  const rawTag = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : ''
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : ''
  // 标签通常是 v1.13.1；也接受纯版本号。
  const version = (rawTag || rawName).replace(/^v/i, '').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const assets = Array.isArray(payload.assets) ? payload.assets : []
  const apk = assets.find((item) => {
    if (!item || typeof item !== 'object') return false
    const asset = /** @type {Record<string, unknown>} */ (item)
    return typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.apk')
  })
  if (!apk) return null
  const asset = /** @type {Record<string, unknown>} */ (apk)
  const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''
  if (!isTrustedDownloadUrl(url)) return null
  const bytes = Number(asset.size)
  return {
    version,
    notes: typeof payload.body === 'string' ? payload.body.slice(0, 4000) : '',
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : '',
    apkUrl: url,
    apkName: typeof asset.name === 'string' ? asset.name.slice(0, 160) : 'update.apk',
    apkBytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0,
    releaseUrl: typeof payload.html_url === 'string' && isTrustedReleasePage(payload.html_url) ? payload.html_url : '',
  }
}

/** 下载地址必须是 https 且主机在白名单里。 */
export function isTrustedDownloadUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (url.username || url.password) return false
    return TRUSTED_DOWNLOAD_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed))
  } catch {
    return false
  }
}

function isTrustedReleasePage(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
      && url.pathname.startsWith('/huadeng0830-gg/study-life/releases')
  } catch {
    return false
  }
}

/** 原生插件（ApkUpdate）。浏览器里没有它，返回 null。 */
function apkUpdatePlugin() {
  if (!isAndroidApp) return null
  const plugin = globalThis.Capacitor?.Plugins?.ApkUpdate
  return plugin && typeof plugin.download === 'function' ? plugin : null
}

/** @type {import('vue').Ref<any>} */
export const androidUpdateState = ref({
  stage: isAndroidApp ? 'idle' : 'unavailable',
  currentVersion: APP_RELEASE,
  availableVersion: '',
  percent: null,
  transferred: 0,
  total: 0,
  notes: '',
  publishedAt: '',
  apkName: '',
  apkBytes: 0,
  releaseUrl: '',
  lastCheckedAt: 0,
  startedAt: 0,
  finishedAt: 0,
  error: null,
  message: '',
})

let activeRelease = null
let progressListener = null
let command = null

function setState(patch) {
  const next = { ...androidUpdateState.value, ...patch }
  if (!STAGES.has(next.stage)) return
  androidUpdateState.value = next
}

/** 状态文案，供界面直接显示。 */
export const androidUpdateMessage = {
  idle: '可以随时检查是否有新版本。',
  checking: '正在检查新版本…',
  latest: '已经是最新版本。',
  available: '有新版本可以安装。',
  downloading: '正在下载安装包…',
  ready: '安装包已下载完成，点击安装。',
  installing: '正在打开系统安装界面…',
  completed: '已交给系统安装器，安装完成后重新打开应用。',
  cancelled: '下载已取消。',
  error: '更新没有完成。',
  unavailable: '当前环境不支持应用内更新。',
}

/**
 * 记一次失败。
 *
 * 错误码用**协议层已有的那套**（updateProtocol.js 的 ERROR_CODES）：
 * 只有在白名单里的码，safeUpdateError 才会保留我们自己写的中文文案，
 * 否则一律换成"连接更新服务失败"这种通用话术，用户看不懂发生了什么。
 */
function fail(code, message, retryAction = 'check') {
  const error = safeUpdateError(updateError(code, message, retryAction), 'NETWORK')
  setState({ stage: 'error', error, message, finishedAt: Date.now(), taskPending: false })
  return false
}

/** 取出错误对象上的文案；不是字符串就退回默认说法。 */
function errorText(error, fallback) {
  const value = error && typeof error === 'object' ? /** @type {any} */ (error).message : ''
  return typeof value === 'string' && value ? value.slice(0, 200) : fallback
}

/** 取出错误对象上的错误码。 */
function errorCode(error) {
  const value = error && typeof error === 'object' ? /** @type {any} */ (error).code : ''
  return typeof value === 'string' ? value : ''
}

/** 取出错误对象上的 name（AbortError 之类）。 */
function errorName(error) {
  const value = error && typeof error === 'object' ? /** @type {any} */ (error).name : ''
  return typeof value === 'string' ? value : ''
}

/**
 * 检查是否有新版本。
 * @param {{ silent?: boolean }} [options] silent=true 时不弹错误提示（后台自动检查用）
 */
export async function checkAndroidAppUpdate({ silent = false } = {}) {
  if (!isAndroidApp) return false
  if (command) return false
  // 自动检查走节流：面板被反复打开时不至于每次都去问一次更新服务。
  if (silent && androidUpdateState.value.lastCheckedAt
    && Date.now() - androidUpdateState.value.lastCheckedAt < AUTO_CHECK_THROTTLE_MS) return true
  /** @type {{ promise: Promise<boolean> | null }} */
  const token = { promise: null }
  command = token
  setState({ stage: 'checking', error: null, message: androidUpdateMessage.checking, startedAt: Date.now(), finishedAt: 0, percent: null })
  token.promise = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
      const response = await fetch(RELEASES_API, {
        cache: 'no-store',
        headers: { accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
      const release = parseAndroidRelease(await response.json())
      if (!release) {
        setState({ stage: 'latest', availableVersion: '', message: '没有找到可安装的新版本。', lastCheckedAt: Date.now(), finishedAt: Date.now(), taskPending: false })
        return true
      }
      const comparison = compareRelease(release.version, APP_RELEASE)
      if (comparison === null || comparison <= 0) {
        setState({ stage: 'latest', availableVersion: '', notes: release.notes, lastCheckedAt: Date.now(), finishedAt: Date.now(), message: androidUpdateMessage.latest, taskPending: false })
        return true
      }
      activeRelease = release
      setState({
        stage: 'available',
        availableVersion: release.version,
        notes: release.notes,
        publishedAt: release.publishedAt,
        apkName: release.apkName,
        apkBytes: release.apkBytes,
        releaseUrl: release.releaseUrl,
        lastCheckedAt: Date.now(),
        finishedAt: Date.now(),
        message: androidUpdateMessage.available,
        taskPending: false,
      })
      return true
    } catch (error) {
      const message = errorCode(error) === 'AbortError' || errorName(error) === 'AbortError'
        ? '检查超时，请稍后再试。'
        : '无法连接更新服务，请检查网络。'
      if (silent) {
        setState({ stage: 'idle', message: '', finishedAt: Date.now(), taskPending: false })
        return false
      }
      fail('NETWORK', message, 'check')
      return false
    } finally {
      clearTimeout(timer)
      if (command === token) command = null
    }
  })()
  return token.promise
}

/**
 * 下载新的安装包。
 * 下载与落盘都在原生侧完成，JS 不碰那十几 MB 的字节。
 */
export async function downloadAndroidAppUpdate() {
  if (!isAndroidApp) return false
  const plugin = apkUpdatePlugin()
  if (!plugin) return fail('BRIDGE', '当前安装包缺少更新组件，请重新安装最新版。', 'check')
  if (!activeRelease) return fail('SOURCE_INVALID', '还没有检查到新版本，请先检查更新。', 'check')
  if (command) return false
  /** @type {{ promise: Promise<boolean> | null }} */
  const token = { promise: null }
  command = token
  setState({ stage: 'downloading', error: null, message: androidUpdateMessage.downloading, percent: 0, transferred: 0, total: activeRelease.apkBytes || 0, startedAt: Date.now(), finishedAt: 0 })
  token.promise = (async () => {
    try {
      if (!progressListener) {
        progressListener = plugin.addListener?.('progress', (event) => {
          const received = Number(event?.received) || 0
          const total = Number(event?.total) || 0
          const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((received / total) * 100))) : null
          setState({ transferred: received, total, percent })
        })
      }
      const timer = setTimeout(() => { void plugin.cancel?.() }, DOWNLOAD_TIMEOUT_MS)
      try {
        await plugin.download({ url: activeRelease.apkUrl, fileName: activeRelease.apkName })
      } finally {
        clearTimeout(timer)
      }
      setState({ stage: 'ready', percent: 100, message: androidUpdateMessage.ready, finishedAt: Date.now(), taskPending: false })
      return true
    } catch (error) {
      fail('DOWNLOAD', `下载失败：${errorText(error, '请检查网络后重试。')}`, 'download')
      return false
    } finally {
      if (command === token) command = null
    }
  })()
  return token.promise
}

/**
 * 把下载好的安装包交给系统安装器。
 * Android 8 以上还需要"安装未知应用"的一次性授权，没授权时先带用户去设置。
 */
export async function installAndroidAppUpdate() {
  if (!isAndroidApp) return false
  const plugin = apkUpdatePlugin()
  if (!plugin) return fail('BRIDGE', '当前安装包缺少更新组件，请重新安装最新版。', 'check')
  if (androidUpdateState.value.stage !== 'ready') return fail('SOURCE_INVALID', '请先下载安装包。', 'download')
  if (command) return false
  /** @type {{ promise: Promise<boolean> | null }} */
  const token = { promise: null }
  command = token
  setState({ stage: 'installing', error: null, message: androidUpdateMessage.installing, startedAt: Date.now(), finishedAt: 0 })
  token.promise = (async () => {
    try {
      const allowed = await plugin.canInstallPackages?.()
      if (allowed && allowed.allowed === false) {
        await plugin.openInstallPermissionSettings?.()
        setState({ stage: 'error', message: '请在系统设置里允许本应用「安装未知应用」，然后再点一次安装。', finishedAt: Date.now(), taskPending: false })
        return false
      }
      await plugin.install({ fileName: androidUpdateState.value.apkName })
      setState({ stage: 'completed', message: androidUpdateMessage.completed, finishedAt: Date.now(), taskPending: false })
      return true
    } catch (error) {
      const code = errorCode(error) === 'PERMISSION_REQUIRED' ? 'PERMISSION' : 'INSTALL'
      fail(code, `无法开始安装：${errorText(error, '无法打开系统安装界面。')}`, 'install')
      return false
    } finally {
      if (command === token) command = null
    }
  })()
  return token.promise
}

/** 取消正在进行的下载。 */
export async function cancelAndroidAppUpdate() {
  const plugin = apkUpdatePlugin()
  if (!plugin) return false
  try {
    await plugin.cancel?.()
  } catch { /* 取消失败不影响后续状态 */ }
  setState({ stage: 'idle', message: androidUpdateMessage.cancelled, percent: null, finishedAt: Date.now(), taskPending: false })
  return true
}

/** 供界面显示"新版本说明"：优先用发布说明，退回版本号。 */
export function androidReleaseSummary() {
  const state = androidUpdateState.value
  if (!state.availableVersion) return ''
  return state.notes ? state.notes : `版本 ${state.availableVersion}`
}
