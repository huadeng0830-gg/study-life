// 语音输入（模块 C）：只用浏览器本地 Web Speech API，不接任何外部服务。
// 不支持（Firefox 桌面版 / 非 HTTPS / 无 API）时 isSupported() 返回 false、transcribe() 返回 null，
// UI 应隐藏或禁用语音按钮并给出一次性友好提示，保持可用不报错。
// 语音状态机：idle → listening → transcribing → done / error。
// 快速笔记模式不需要“理解中”状态，由调用方自行决定是否展示 transcribing 之后的流程。

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
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
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
export function transcribe(options = {}) {
  const API = speechRecognitionAPI()
  if (!API) return null

  const {
    lang = 'zh-CN',
    interimResults = true,
    continuous = false,
    maxSeconds = 30,
    onResult = () => {},
    onError = () => {},
    onEnd = () => {},
    onStateChange = () => {},
  } = options

  const recognition = new API()
  recognition.lang = lang
  recognition.interimResults = interimResults
  recognition.continuous = continuous

  let finalText = ''
  let interimText = ''
  let started = false
  let maxTimer = 0
  let stoppedByUser = false
  let failed = false

  function setState(state) {
    onStateChange(state)
  }

  function clearMaxTimer() {
    if (maxTimer) window.clearTimeout(maxTimer)
    maxTimer = 0
  }

  function finish() {
    started = false
    clearMaxTimer()
    const result = finalText
    finalText = ''
    interimText = ''
    setState(result ? VOICE_STATES.done : VOICE_STATES.idle)
    onEnd(result)
  }

  recognition.onstart = () => {
    started = true
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
    // interim 片段是「替换上一次临时结果」，不能累加；final 片段才追加到最终文本。
    let interim = ''
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]
      const transcript = result[0]?.transcript ?? ''
      if (result.isFinal) finalText += transcript
      else interim += transcript
    }
    interimText = interim
    if (finalText || interimText) setState(VOICE_STATES.transcribing)
    onResult(finalText, interimText)
  }

  recognition.onerror = (event) => {
    started = false
    failed = true
    clearMaxTimer()
    finalText = ''
    interimText = ''
    setState(VOICE_STATES.error)
    onError(event?.error ?? 'unknown')
  }

  recognition.onend = () => {
    if (failed) {
      failed = false
      clearMaxTimer()
      return
    }
    if (started) finish()
    else if (finalText) finish()
    else {
      started = false
      clearMaxTimer()
      if (!stoppedByUser) setState(VOICE_STATES.idle)
    }
  }

  return {
    start() {
      if (started) return
      finalText = ''
      interimText = ''
      try {
        recognition.start()
      } catch (error) {
        // start() 同步抛错（未授权、重复启动、环境禁用）时必须显式反馈，不能静默失败。
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
      try { recognition.abort() } catch {}
    },
  }
}