// 公共分享工具：四个模块统一复用。
// 优先走系统分享面板（navigator.share），失败或不可用时回退到剪贴板；
// 剪贴板权限不足时再用隐藏 textarea 兜底，保证离线环境也能“复制一份”。
import { isAndroidApp } from './androidRuntime.js'

function legacyCopy(text) {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  area.style.top = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  return ok
}

// 返回结构化结果，方便调用方区分“分享成功 / 已复制 / 用户取消 / 失败”。
async function copyText(text) {
  const value = String(text ?? '')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(value)
      return { ok: true, method: 'clipboard', cancelled: false }
    }
  } catch {
    // 剪贴板被拒或不可用，继续走兜底方案。
  }
  const ok = legacyCopy(value)
  return ok
    ? { ok: true, method: 'legacy', cancelled: false }
    : { ok: false, method: 'none', cancelled: false }
}

export function useShareText() {
  async function share(text, { title = '' } = {}) {
    const value = String(text ?? '')
    // 安卓 WebView **没有** Web Share API：navigator.share 只在浏览器应用里存在，
    // 在 APK 里它恒为 undefined，于是"分享"会静默退化成"复制到剪贴板"——
    // 用户点了分享却什么都没发生，只能看到一句"已复制到剪贴板"。
    // 安卓上改用系统分享面板（@capacitor/share，APK 里已经装了）。
    if (isAndroidApp) {
      try {
        const { Share } = await import('@capacitor/share')
        await Share.share({ title: title || document.title, text: value })
        return { ok: true, method: 'share', cancelled: false }
      } catch (error) {
        if (error?.message === 'Share canceled') return { cancelled: true, ok: false, method: 'share' }
        // 分享面板起不来（极少见）时继续走下面的通用路径。
      }
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: title || document.title, text: value })
        return { ok: true, method: 'share', cancelled: false }
      } catch (error) {
        // 用户取消分享面板不算失败，直接返回，不再回退复制。
        if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          return { cancelled: true, ok: false, method: 'share' }
        }
        // 其他异常回退到剪贴板，尽量不打断用户。
      }
    }
    return copyText(value)
  }

  return { share, copy: copyText }
}