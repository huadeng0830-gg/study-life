import { computed, ref } from 'vue'
import {
  LUNAR_ANNIVERSARY_KEY,
  LUNAR_ANNIVERSARY_STATUS,
  normalizeLunarAnniversaries,
  publishLunarAnniversaries,
  resolveLunarAnniversary,
} from './lunarAnniversaries.js'
import { useStoredRef } from './store/index.js'

/**
 * 农历纪念日设置面板的编辑模型。
 *
 * 存储仍由 sl_festive_lunar 承载；这里负责把持久化形状转成稳定的编辑行，
 * 在每次编辑后归一化写回，并同步氛围模块使用的内存镜像。空名称行只留在
 * 面板草稿里，不进入存储，也不会改变既有同步 / 备份数据形状。
 */
export function useLunarAnniversaryEditor(today) {
  const stored = useStoredRef(LUNAR_ANNIVERSARY_KEY, [])
  let idSequence = 0

  function rowsFrom(list) {
    const seen = new Set()
    return normalizeLunarAnniversaries(list).map((item) => {
      let id = item.id
      while (seen.has(id)) id = `${item.id}-${idSequence++}`
      seen.add(id)
      return {
        id,
        label: item.label,
        lunarMonth: item.lunarMonth,
        lunarDay: item.lunarDay,
        isLeapMonth: item.isLeapMonth,
      }
    })
  }

  const rows = ref(rowsFrom(stored.value))

  /** 重开面板时从持久化真源补入，并立即刷新氛围判断使用的镜像。 */
  function sync() {
    const normalized = normalizeLunarAnniversaries(stored.value)
    rows.value = rowsFrom(normalized)
    publishLunarAnniversaries(normalized)
  }

  function commit() {
    const normalized = normalizeLunarAnniversaries(rows.value.map((row) => ({
      id: row.id,
      label: row.label,
      lunarMonth: row.lunarMonth,
      lunarDay: row.lunarDay,
      isLeapMonth: row.isLeapMonth,
    })))
    stored.value = normalized
    publishLunarAnniversaries(normalized)
  }

  function rowOf(id) {
    return rows.value.find((row) => row.id === id)
  }

  function add() {
    const row = {
      id: `lunar-${Date.now()}-${idSequence++}`,
      label: '',
      lunarMonth: 1,
      lunarDay: 1,
      isLeapMonth: false,
    }
    rows.value.push(row)
    return row.id
  }

  function setLabel(id, value) {
    const row = rowOf(id)
    if (!row) return
    row.label = String(value ?? '')
    commit()
  }

  function setMonth(id, value) {
    const row = rowOf(id)
    if (!row) return
    row.lunarMonth = Number(value)
    commit()
  }

  function setDay(id, value) {
    const row = rowOf(id)
    if (!row) return
    row.lunarDay = Number(value)
    commit()
  }

  function setLeapMonth(id, checked) {
    const row = rowOf(id)
    if (!row) return
    row.isLeapMonth = checked === true
    commit()
  }

  function remove(id) {
    rows.value = rows.value.filter((row) => row.id !== id)
    commit()
  }

  const resolutions = computed(() =>
    new Map(rows.value.map((row) => [row.id, resolveLunarAnniversary(row, today.value)])),
  )

  function resolutionText(row) {
    const resolved = resolutions.value.get(row.id)
    if (!resolved) return ''
    const head = resolved.lunarText ? `${resolved.lunarText} · ` : ''
    if (resolved.status === LUNAR_ANNIVERSARY_STATUS.OK) {
      const next = resolved.nextDateKey && resolved.daysFromToday < 0 ? `，${resolved.nextText}` : ''
      return `${head}${resolved.dateKey}（${resolved.relativeText}${next}）`
    }
    return resolved.nextText
      ? `${head}${resolved.statusText}；${resolved.nextText}`
      : `${head}${resolved.statusText}`
  }

  function resolutionClass(row) {
    const resolved = resolutions.value.get(row.id)
    return resolved && resolved.status === LUNAR_ANNIVERSARY_STATUS.OK ? '' : 'off'
  }

  return {
    rows,
    sync,
    add,
    setLabel,
    setMonth,
    setDay,
    setLeapMonth,
    remove,
    resolutionText,
    resolutionClass,
  }
}
