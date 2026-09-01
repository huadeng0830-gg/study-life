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
      this.onstart?.()
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

  it('重复 start 不创建第二个识别实例，stop 后仍交付最后一段 final', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onEnd = vi.fn()
    const controller = transcribe({ onEnd })
    controller.start()
    controller.start()
    expect(instances).toHaveLength(1)
    const rec = instances[0]
    controller.stop()
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '停止前的最后一句' } }] })
    rec.onend()
    expect(onEnd).toHaveBeenLastCalledWith('停止前的最后一句')
  })

  it('同一控制器重新开始时清理上一轮片段并允许再次结束', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onEnd = vi.fn()
    const controller = transcribe({ onEnd })
    controller.start()
    const rec = instances[0]
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '第一轮' } }] })
    rec.onend()
    controller.start()
    expect(instances).toHaveLength(1)
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '第二轮' } }] })
    rec.onend()
    expect(onEnd).toHaveBeenLastCalledWith('第二轮')
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

  it('重复收到同一个 final result 时不会重复拼接', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onResult = vi.fn()
    const controller = transcribe({ onResult })
    controller.start()
    const rec = instances[0]
    const event = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '明天下午三点' } }] }
    rec.onresult(event)
    rec.onresult(event)
    expect(onResult).toHaveBeenLastCalledWith('明天下午三点', '')
  })

  it('识别发生错误时保留已识别文本，并把 partial transcript 传给调用方', () => {
    const { FakeRecognition, instances } = makeFakeRecognition()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    const onResult = vi.fn()
    const onError = vi.fn()
    const controller = transcribe({ onResult, onError })
    controller.start()
    const rec = instances[0]
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '明天交英语作业' } }] })
    rec.onerror({ error: 'network' })
    expect(onError).toHaveBeenLastCalledWith('network', '明天交英语作业')
    expect(onResult).toHaveBeenLastCalledWith('明天交英语作业', '')
  })

  it('voiceErrorMessage 覆盖常见错误码并有兜底文案', () => {
    expect(voiceErrorMessage('not-allowed')).toContain('麦克风权限')
    expect(voiceErrorMessage('no-speech')).toContain('没有听到声音')
    expect(voiceErrorMessage('some-unknown')).toContain('语音识别失败')
  })
})
