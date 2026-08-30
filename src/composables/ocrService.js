// 兼容入口：旧调用方仍可请求“快速 OCR”，但统一复用布局感知管线的 Worker、
// 超时、内存回收和本地语言包策略，避免维护两份 Tesseract 生命周期代码。
import {
  cleanupOCR,
  getOCRState,
  performOCR as performPipelineOCR,
  resetOCRStatus,
} from './ocrPipeline.js'

export const ocrState = getOCRState()

export function performOCR(file, onProgress = null, options = {}) {
  return performPipelineOCR(file, onProgress, {
    ...options,
    mode: options.mode || 'fast',
    kind: options.kind || 'generic',
  })
}

export { cleanupOCR, getOCRState, resetOCRStatus }
