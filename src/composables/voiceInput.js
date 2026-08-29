// 语音输入（模块 C）：只用浏览器本地 Web Speech API，不接任何外部服务。
// 不支持（Firefox 桌面版 / 非 HTTPS / 无 API）时 isSupported() 返回 false、transcribe() 返回 null，
// UI 应隐藏或禁用语音按钮并给出一次性友好提示，保持可用不报错。

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
export function transcribe(options = {}) {
  const API = speechRecognitionAPI()
  if (!API) return null

  const {
    lang = 'zh-CN',
    interimResults = true,
    continuous = false,
    onResult = () => {},
    onError = () => {},
    onEnd = () => {},
  } = options

  const recognition = new API()
  recognition.lang = lang
  recognition.interimResults = interimResults
  recognition.continuous = continuous

  let finalText = ''
  let interimText = ''
  let started = false

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
    onResult(finalText, interimText)
  }
  recognition.onerror = (event) => {
    started = false
    onError(event?.error ?? 'unknown')
  }
  recognition.onend = () => {
    started = false
    onEnd(finalText)
  }

  return {
    start() {
      if (started) return
      finalText = ''
      interimText = ''
      try {
        recognition.start()
        started = true
      } catch (error) {
        // start() 同步抛错（未授权、重复启动、环境禁用）时必须显式反馈，不能静默失败。
        started = false
        onError(error?.name ?? 'start-error')
      }
    },
    stop() {
      try { recognition.stop() } catch { started = false }
    },
    abort() {
      started = false
      try { recognition.abort() } catch {}
    },
  }
}