import { onMounted, ref, watch } from 'vue'

/**
 * 通知档案 → 通知理解 的一次性交接。
 *
 * 档案页只有「标记已处理 / 归档 / 关联优惠」三个动作，没有任何办法把一条存档通知
 * 变成待办或日程——用户必须自己记得原文、跑到待办页、再从剪贴板粘一遍。
 * 这个模块只做一件事：把原文带到待办页，通知理解面板直接解析。
 *
 * 是一次性交接而不是长期状态：取走即清空，刷新页面也不会残留用户内容。
 * 刻意不放路由 query——通知原文可能很长，放进 URL 会进浏览器历史与日志。
 */
export const pendingNoticeText = ref('')

/** @param {string} raw 通知原文 */
export function handOffNoticeToTasks(raw) {
  pendingNoticeText.value = String(raw ?? '')
}

/** 取出并清空，避免同一段原文被下一次打开重复解析。 */
export function takePendingNoticeText() {
  const value = pendingNoticeText.value
  pendingNoticeText.value = ''
  return value
}

/**
 * 待办页的接收端：把交接过来的原文填进通知理解面板。
 * 面板关闭时必须调用返回的 `reset`，否则下次普通粘贴会又冒出上一条存档原文。
 *
 * @param {{ open: import('vue').Ref<boolean>, prefill: import('vue').Ref<string>, beforeOpen?: () => void }} target
 */
export function useNoticeHandoffTarget({ open, prefill, beforeOpen }) {
  function consume() {
    const text = takePendingNoticeText()
    if (!text) return
    beforeOpen?.()
    prefill.value = text
    open.value = true
  }
  function reset() {
    open.value = false
    prefill.value = ''
  }
  return { consume, reset }
}

/**
 * 通知理解面板的开关状态 + 一次性预填，全部收在一处。
 *
 * 页面只需要在模板上绑 `noticeOpen` / `noticePrefill`，关闭时调 `closeNotice`；
 * 交接的接收（挂载时与交接发生时）在这里挂好，页面不用自己写监听，
 * 也就不会出现「忘了卸载监听 / 忘了清空预填」这类只在真机上出现的怪问题。
 *
 * @param {{ beforeOpen?: () => void }} [options]
 */
export function useNoticePasteGate({ beforeOpen } = {}) {
  const noticeOpen = ref(false)
  const noticePrefill = ref('')
  const { consume, reset } = useNoticeHandoffTarget({ open: noticeOpen, prefill: noticePrefill, beforeOpen })
  onMounted(consume)
  watch(pendingNoticeText, consume)
  return { noticeOpen, noticePrefill, consumeNoticePrefill: consume, closeNotice: reset }
}