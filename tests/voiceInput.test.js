// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isSupported,
  speechRecognitionAPI,
  transcribe,
  voiceErrorMessage,
} from '../src/composables/voiceInput.js'

function makeFakeRecognition({ throwOnStart = false } = {}) {
  const instances = []
  class FakeRecognition {
    constructor() {
      this.lang = ''
      this.interimResults = false
      this.continuous = false
      this.onresult = null
      this.onerror = null
      this.onend = null
      instances.push(this)
    }
    start() {
      if (throwOnStart) {
        const error = new Error('not allowed')
        error.name = 'NotAllowedError'
        throw error
      }
    }
    stop() {}
    abort() {}
  }
  return { FakeRecognition, instances }
}

describe('语音输入兼容性', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('无 SpeechRecognition 时判定不可用', () => {
    expect(speechRecognitionAPI()).toBeNull()
    expect(isSupported()).toBe(false)
  })

  it('仅有 webkitSpeechRecognition 前缀时仍判定可用', () => {
    vi.stubGlobal('webkitSpeechRecognition', class {})
    expect(isSupported()).toBe(true)
  })

  it('不可用环境 transcribe 返回 null 不抛错', () => {
    expect(transcribe()).toBeNull()
  })

  it('可用环境返回控制器并在 start 时实例化引擎', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const controller = transcribe({})
    expect(controller).not.toBeNull()
    controller.start()
    expect(instances).toHaveLength(1)
    expect(instances[0].lang).toBe('zh-CN')
  })

  it('start 同步抛错时显式回调 onError 而不是静默失败', () => {
    const { FakeRecognition } = makeFakeRecognition({ throwOnStart: true })
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onError = vi.fn()
    const controller = transcribe({ onError })
    expect(() => controller.start()).not.toThrow()
    expect(onError).toHaveBeenCalledWith('NotAllowedError')
  })

  it('onresult 把 final 追加、把未结束的 interim 替换后回调', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onResult = vi.fn()
    const controller = transcribe({ onResult })
    controller.start()
    const rec = instances[0]
    rec.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: '午饭' } }] })
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '午饭 18' } }] })
    expect(onResult).toHaveBeenLastCalledWith('午饭 18', '')
  })

  it('voiceErrorMessage 覆盖常见错误码并有兜底文案', () => {
    expect(voiceErrorMessage('not-allowed')).toContain('麦克风权限')
    expect(voiceErrorMessage('no-speech')).toContain('没有听到声音')
    expect(voiceErrorMessage('some-unknown')).toContain('语音识别失败')
  })
})