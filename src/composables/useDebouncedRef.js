import { onScopeDispose, ref, watch } from 'vue'

/**
 * 输入防抖：返回「立即跟着输入框走的 ref」与「防抖后真正驱动查询的 ref」。
 *
 * 【为什么需要】
 * 账本、待办、清单、笔记、日程、全局搜索这几处的查询框，都把输入值直接喂给一个
 * computed，而这个 computed 会**整表扫描**：账本一次搜索要过三遍（filter → 按日汇总 →
 * 造列表项），全局搜索更是一次扫任务、日程、笔记、重要日期、账单、流水、课程与清单条目。
 * 每敲一个字跑一趟，10 键/秒就是每秒钟几趟全表扫描 —— 中端手机上这是能看见的卡顿，
 * 而且随着数据增长线性变差。
 *
 * 用法：
 *   const q = ref('')                 // 绑到 <input v-model="q">
 *   const qDebounced = useDebouncedRef(q, 160)
 *   // 查询的 computed 只依赖 qDebounced
 *
 * 150~200ms 是刻意的：短到感觉不到，长到足以把一串快速输入合并成一趟查询。
 * 作用域销毁时定时器会被清掉，不会在组件卸载后再写一次 ref。
 */
export function useDebouncedRef(source, delay = 160) {
  const debounced = ref(source.value)
  let timer = null

  const stop = watch(source, (value) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      debounced.value = value
    }, delay)
  })

  onScopeDispose(() => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    stop()
  })

  return debounced
}
