// 语音输入（模块 C）：只用浏览器内置的 Web Speech API。
// 应用自身不接任何外部服务、不带 API key、不请求第三方端点。
//
// 但要区分清楚「无自有后端」与「完全离线可用」：Chrome / Edge / Safari 对这个
// API 的实现会把音频送给各自厂商的云端去识别，所以断网时识别会以 'network'
// 错误失败（文案见 explainSpeechError）。离线场景请走手动输入或 OCR。
// 不支持（Firefox 桌面版 / 非 HTTPS / 无 API）时 isSupported() 返回 false、transcribe() 返回 null，
// UI 应隐藏或禁用语音按钮并给出一次性友好提示，保持可用不报错。
// 语音状态机：idle → listening → transcribing → done / error。
// 当前快速记录流程统一展示转写状态，由调用方决定转写后如何预览和保存。

export const VOICE_STATES = Object.freeze({
  idle: 'idle',
  listening: 'listening',
  transcribing: 'transcribing',
  done: 'done',
  error: 'error',
})

export function speechRecognitionAPI() {
  if (typeof window === 'undefined') return null
  // Chrome/Edge 用 webkit 前缀，Safari 用无前缀；两者都不存在即为不可用环境。
  // 部分 WebView 可能只有 mozSpeechRecognition 或 msSpeechRecognition
  return window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition || null
}

export function isSupported() {
  return Boolean(speechRecognitionAPI())
}

// 把 Web Speech 的错误码翻译成一句中文提示，供 UI 直接展示。
export function voiceErrorMessage(errorCode) {
  const code = String(errorCode ?? '').toLowerCase()
  if (code === 'not-allowed' || code === 'service-not-allowed') return '没有麦克风权限，请在浏览器设置中允许后重试'
  if (code === 'audio-capture') return '未检测到可用麦克风，请手动输入'
  if (code === 'no-speech') return '没有听到声音，请重试'
  if (code === 'network') return '语音识别需要联网，请检查网络或改手动输入'
  if (code === 'start-error' || code === 'invalidstateerror' || code === 'notsupportederror') return '语音识别启动失败，请手动输入'
  return '语音识别失败，可继续手动输入'
}

// 返回可 start/stop/abort 的控制器；不支持时返回 null。
// 新增 onStateChange 状态回调与 maxSeconds 安全超时，兼容原 onResult/onError/onEnd 参数。
//
// 【joinWith 为什么默认是空串】Web Speech 的多个 final 结果之间**没有可靠标点**：
// 连续说话时浏览器可能只给"周三下午三点图书馆还书"和"周五交报告"两段，直接首尾相接
// 会读成一句连写的话。要在语音侧支持"一次说多件事"，调用方需要能在两段之间放一个
// 可被下游识别的分界（通知侧用逗号）。但**默认必须保持空串**：既有调用方
// （QuickRecordPanel）依赖"原样拼接"的既有行为，改默认等于悄悄改变它的产物。
export function transcribe(options = {}) {
  const API = speechRecognitionAPI()
  if (!API) return null

  const {
    lang = 'zh-CN',
    interimResults = true,
    continuous = false,
    maxSeconds = 30,
    joinWith = '',
    onResult = () => {},
    onError = () => {},
    onEnd = () => {},
    onStateChange = () => {},
  } = options

  const recognition = new API()
  recognition.lang = lang
  recognition.interimResults = interimResults
  recognition.continuous = continuous

  // Web Speech 的 results 是“按索引更新”的快照，不是可无限 append 的事件流。
  // 按 result index 保存片段，可以避免 finalResult 重发时重复文字。
  let finalSegments = []
  let interimSegments = []
  let started = false
  let maxTimer = 0
  let stoppedByUser = false
  let failed = false
  let finished = false

  function snapshot() {
    return {
      finalText: finalSegments.join(joinWith),
      interimText: interimSegments.join(joinWith),
    }
  }

  function setState(state) {
    onStateChange(state)
  }

  function clearMaxTimer() {
    if (maxTimer) window.clearTimeout(maxTimer)
    maxTimer = 0
  }

  function finish() {
    if (finished) return
    finished = true
    started = false
    clearMaxTimer()
    const snapshotText = snapshot()
    const result = snapshotText.finalText || snapshotText.interimText
    setState(result ? VOICE_STATES.done : VOICE_STATES.idle)
    onEnd(result)
  }

  recognition.onstart = () => {
    started = true
    finished = false
    failed = false
    stoppedByUser = false
    setState(VOICE_STATES.listening)
    clearMaxTimer()
    if (maxSeconds > 0) {
      maxTimer = window.setTimeout(() => {
        // 到达最长聆听时间自动结束，避免误留后台录音。
        try { recognition.stop() } catch { finish() }
      }, maxSeconds * 1000)
    }
  }

  recognition.onresult = (event) => {
    const start = Math.max(0, Number(event?.resultIndex) || 0)
    for (let index = start; index < event.results.length; index++) {
      const result = event.results[index]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) {
        finalSegments[index] = transcript
        interimSegments[index] = ''
      } else {
        interimSegments[index] = transcript
      }
    }
    const current = snapshot()
    if (current.finalText || current.interimText) setState(VOICE_STATES.transcribing)
    onResult(current.finalText, current.interimText)
  }

  recognition.onerror = (event) => {
    started = false
    failed = true
    clearMaxTimer()
    const current = snapshot()
    // 错误只结束识别，不抹掉已经拿到的文字；调用方可保留 partial transcript 让用户继续编辑。
    if (current.finalText || current.interimText) onResult(current.finalText, current.interimText)
    setState(VOICE_STATES.error)
    onError(event?.error ?? 'unknown', current.finalText || current.interimText)
  }

  recognition.onend = () => {
    if (failed) {
      failed = false
      clearMaxTimer()
      return
    }
    if (started) finish()
    else if (snapshot().finalText || snapshot().interimText) finish()
    else {
      started = false
      clearMaxTimer()
      if (!stoppedByUser) setState(VOICE_STATES.idle)
    }
  }

  return {
    start() {
      if (started) return
      finalSegments = []
      interimSegments = []
      finished = false
      failed = false
      try {
        recognition.start()
      } catch (error) {
        // start() 同步抛错（未授权、重复启动、环境禁用）时必须显式反馈，不能静默失败。
        setState(VOICE_STATES.error)
        onError(error?.name ?? 'start-error')
      }
    },
    stop() {
      stoppedByUser = true
      try { recognition.stop() } catch { finish() }
    },
    abort() {
      stoppedByUser = true
      started = false
      clearMaxTimer()
      finished = true
      try { recognition.abort() } catch {}
    },
  }
}
