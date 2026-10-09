import { ref } from 'vue'

/**
 * 服务端数据整体替换时，保住用户正在输入、尚未保存的字段值。
 *
 * 【为什么需要】
 * 页面普遍有「定时重新拉取 + 整体替换数组」的自动刷新（齐行每 120 秒一次）。凡是
 * 用 `v-model` 直接绑在**服务端返回对象**上的输入框，都会在刷新时被静默清空：
 * 用户刚打了一半的字消失，没有任何报错，也没有撤销机会。齐行的交付检查「凭证或说明」
 * 就是这样丢数据的。
 *
 * 【为什么不能靠"刷新前先保存"】
 * 自动刷新不该触发写入：它会在用户没做任何操作时也发请求，也会把编辑中的中间态推给
 * 服务端。所以只能在**替换之后**把本机的未保存值盖回去。
 *
 * 【为什么存值而不只是存脏 id】
 * 存值之后调用方就不必在替换前"捕获旧值"——那需要额外一份 Map，还要处理刷新与输入
 * 之间的时序。这里直接持有草稿值，替换后一次 `reapply` 即可。
 *
 * 【为什么不自动失效】
 * 草稿值的生命周期由调用方决定：本实现刻意**不**做"多久之后算过期"。凭据说明这类
 * 字段可能隔很久才提交，自动过期会重新引入数据丢失。真正的失效点是调用方写完服务端
 * 之后显式 `clear`（见齐行的 saveDeliveryCheck），以及切换数据源时 `clearAll`。
 */
export function usePendingFieldEdits() {
  const pending = ref(new Map())

  function mark(id, value) {
    if (id === undefined || id === null || id === '') return
    const next = new Map(pending.value)
    next.set(id, value)
    pending.value = next
  }

  function clear(id) {
    if (!pending.value.has(id)) return
    const next = new Map(pending.value)
    next.delete(id)
    pending.value = next
  }

  function clearAll() {
    if (pending.value.size) pending.value = new Map()
  }

  /**
   * 把未保存的值盖回服务端刚返回的记录上。就地修改传入的记录并返回命中数量，
   * 这样调用方可以直接写成 `list.value = fetched; edits.reapply(list.value, 'field')`。
   */
  function reapply(records, field) {
    if (!pending.value.size || !Array.isArray(records) || !field) return 0
    let applied = 0
    for (const record of records) {
      if (!record || !pending.value.has(record.id)) continue
      record[field] = pending.value.get(record.id)
      applied += 1
    }
    return applied
  }

  return { pending, mark, clear, clearAll, reapply }
}