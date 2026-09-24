import { ref } from 'vue'

/**
 * 常驻读屏播报区。
 *
 * 各页面原来的 `role="status"` 都是和文本一起 `v-if` 插进 DOM 的。
 * 对"新建的 live region 在插入瞬间就带内容"这种情况，VoiceOver 等读屏
 * 播报并不稳定（有些实现只监听既有节点的文本变化，不播报首次插入的内容）。
 *
 * 所以在应用外壳里放一个常驻容器，播报时只改它的文本，
 * 并统一加上 aria-atomic，保证整句被完整读出。
 */
export const liveMessage = ref('')

/**
 * 常驻的**紧急**播报区（第二十三轮）。
 *
 * 为什么错误提示不能只靠 `role="alert"` + `v-if`：那种写法同样是"插入一个带内容的
 * 新节点"，撞的正是上面那条规律（VoiceOver 可能一个字都不播）。
 * 偏偏出错是全应用最需要被听见的时刻：用户眼前页面已经坏了，如果连听也听不到，
 * 就彻底不知道发生了什么。所以错误走这条常驻通道，视觉 toast 照旧保留。
 */
export const liveAlert = ref('')

/**
 * 两条通道各有一套定时器。
 *
 * 刻意**不共用**：共用的话，一句礼貌播报（比如路由切换）会把刚刚排队的错误播报挤掉，
 * 而那恰恰是最不能丢的一条。
 */
const politeChannel = { target: liveMessage, writeTimer: 0, clearTimer: 0 }
const alertChannel = { target: liveAlert, writeTimer: 0, clearTimer: 0 }

/**
 * 「先清空、下一拍再写入」。
 *
 * 连续播报同一句话时读屏会认为"文本没变"而静默，所以必须制造一次可观察的变化。
 */
function scheduleAnnouncement(channel, message, clearAfter) {
  const text = String(message ?? '').trim()
  if (!text || typeof window === 'undefined') return

  window.clearTimeout(channel.writeTimer)
  window.clearTimeout(channel.clearTimer)
  channel.target.value = ''
  channel.writeTimer = window.setTimeout(() => {
    channel.writeTimer = 0
    channel.target.value = text
    if (clearAfter > 0) {
      channel.clearTimer = window.setTimeout(() => { channel.target.value = '' }, clearAfter)
    }
  }, 30)
}

/**
 * 礼貌播报一条消息。
 *
 * @param {string} message 要播报的文本
 * @param {{ clearAfter?: number }} [options] clearAfter 毫秒后清空容器（0 表示保留）
 */
export function announce(message, { clearAfter = 0 } = {}) {
  scheduleAnnouncement(politeChannel, message, clearAfter)
}

/**
 * 以 `assertive` 紧急级别播报（错误提示用）。
 *
 * @param {string} message 要播报的文本
 * @param {{ clearAfter?: number }} [options] clearAfter 毫秒后清空容器（0 表示保留）
 */
export function announceAlert(message, { clearAfter = 0 } = {}) {
  scheduleAnnouncement(alertChannel, message, clearAfter)
}

/** 清空两条播报通道，并取消尚未落下的写入（测试与页面卸载时用）。 */
export function clearAnnouncement() {
  for (const channel of [politeChannel, alertChannel]) {
    if (typeof window !== 'undefined') {
      window.clearTimeout(channel.writeTimer)
      window.clearTimeout(channel.clearTimer)
    }
    channel.writeTimer = 0
    channel.clearTimer = 0
    channel.target.value = ''
  }
}