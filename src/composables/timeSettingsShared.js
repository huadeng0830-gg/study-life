/**
 * 作息设置弹窗的共享轻量状态（第一步拆分）。
 *
 * 【为什么是模块级】`settingError` 要被基础设置区（校区/作息季/节次 CRUD）、
 * 草稿保存、快速生成预览、以及弹窗顶部的 `role="alert"` 四处共用；
 * `settingsToast` / `showToast` 要被草稿保存、复制方案、导入与撤销四处共用。
 * 拆出子组件之后它们必须跨实例共享，而"错误提示跟着弹窗走"这件事本来就该由
 * 一个常驻实例保证（父级没有 `v-if`，组件常驻，语义与改造前一致）。
 *
 * 同样常驻的还有两段"输入暂存"：粘贴文本与导入错误。它们被 OCR 流程、识别暂存层、
 * 导入计划三个模块同时读写，放在任何一个业务模块里都会逼出循环依赖，所以一并落在这里。
 */

import { ref } from 'vue'

/** 弹窗顶部的错误提示（`role="alert"`，切换分区/保存失败时写入）。 */
export const settingError = ref('')

/** 弹窗内的轻量成功提示（自动消失）。 */
export const settingsToast = ref('')

let settingsToastTimer = 0

export function showToast(message) {
  settingsToast.value = message
  window.clearTimeout(settingsToastTimer)
  settingsToastTimer = window.setTimeout(() => { settingsToast.value = '' }, 3200)
}

/** KeepAlive 离开页面不会卸载组件；主动取消时要把 toast 定时器一起收掉。 */
export function stopSettingsToast() {
  window.clearTimeout(settingsToastTimer)
}

/** 粘贴的作息原文：解析、识别、放弃识别三处共用同一份输入。 */
export const pasteText = ref('')

/** 导入/识别错误提示（OCR 流程与导入计划的失败回写共用）。 */
export const importError = ref('')
