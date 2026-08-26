import { registerSW } from 'virtual:pwa-register'
import { ref } from 'vue'

let registration = null
let updateSW = () => Promise.resolve()
export const updateMessage = ref('')

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // 所有业务数据都已同步写入本地，可安全切换到新版本。
    updateMessage.value = '发现新版本，正在更新…'
    void updateSW(true)
  },
  onRegisteredSW(_url, value) {
    registration = value
    void checkForAppUpdate(false)
  },
})

export async function checkForAppUpdate(showResult = true) {
  if (!navigator.onLine) {
    if (showResult) updateMessage.value = '当前没有网络，暂时无法检查更新'
    return false
  }
  if (!registration) {
    if (showResult) updateMessage.value = '更新服务正在准备，请稍后再试'
    return false
  }
  try {
    if (showResult) updateMessage.value = '正在检查新版本…'
    await registration.update()
    if (showResult && updateMessage.value === '正在检查新版本…') {
      updateMessage.value = '已是最新版本'
      window.setTimeout(() => {
        if (updateMessage.value === '已是最新版本') updateMessage.value = ''
      }, 3000)
    }
    return true
  } catch {
    if (showResult) updateMessage.value = '检查失败，请确认网络后重试'
    return false
  }
}

function silentCheck() {
  void checkForAppUpdate(false)
}

window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') silentCheck()
})
window.setInterval(silentCheck, 20 * 60 * 1000)
