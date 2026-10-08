/**
 * 方案编辑器的三块工具（第三步拆分）：批量平移、复制已有方案，以及四个互斥开关。
 *
 * 【为什么四个开关放这里】`batchOpen / copyOpen / importOpen / genPreview` 彼此互斥
 * （打开一个就关掉另外三个），而 `loadPlanDraft()` 切换方案时要把它们**一起**复位。
 * 把复位收成一个 `resetPlanTools()`，切换方案的代码就不必认识四个模块的内部状态——
 * 这也是 timePlanDraft 唯一反向依赖本文件的地方。
 */

import { computed, ref } from 'vue'
import { timeConfig, campusName, seasonName } from './store/timeConfig.js'
import { currentPlanKey, draft, draftDirty, planKeyOf, settingsCombos, toHHMM, toMinutes } from './timePlanDraft.js'
import { showToast } from './timeSettingsShared.js'

// ---------- 批量调整（±分钟，先预览） ----------
export const batchOpen = ref(false)
export const batchFrom = ref(0)
export const batchTo = ref(0)
export const batchDelta = ref(10)
export const batchCustom = ref('')

export const batchPreview = computed(() => {
  const delta = batchDelta.value === 0 ? Number(batchCustom.value || 0) : Number(batchDelta.value)
  if (!Number.isFinite(delta) || delta === 0) return null
  const rows = []
  for (let i = batchFrom.value; i <= batchTo.value && i < draft.value.length; i++) {
    const row = draft.value[i]
    if (!row?.start || !row?.end) continue
    try {
      rows.push({
        index: i,
        label: timeConfig.value.periods[i].label,
        from: `${row.start}–${row.end}`,
        to: `${toHHMM(toMinutes(row.start) + delta)}–${toHHMM(toMinutes(row.end) + delta)}`,
      })
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return { delta, rows: [], error: '平移后的时间超出 23:59，请减小调整幅度' }
    }
  }
  return rows.length ? { delta, rows } : null
})

export function openTimeShift() {
  batchFrom.value = 0
  batchTo.value = Math.max(0, timeConfig.value.periods.length - 1)
  batchDelta.value = 10
  batchCustom.value = ''
  batchOpen.value = true
  copyOpen.value = false
  importOpen.value = false
  genPreview.value = null
}

export function applyBatch() {
  const preview = batchPreview.value
  if (!preview || preview.error) return
  for (const row of preview.rows) {
    const [s, e] = row.to.split('–')
    draft.value[row.index] = { start: s, end: e }
  }
  draftDirty.value = true
  batchOpen.value = false
}

// ---------- 复制已有方案（拷贝进草稿，独立不联动） ----------
export const copyOpen = ref(false)

export const otherPlans = computed(() =>
  settingsCombos.value.filter((c) => planKeyOf(c.season, c.campus) !== currentPlanKey.value)
)

export function toggleCopy() {
  copyOpen.value = !copyOpen.value
  batchOpen.value = false
  importOpen.value = false
  genPreview.value = null
}

export function copyFrom(seasonId, campusId) {
  const source = timeConfig.value.times[seasonId]?.[campusId] ?? []
  draft.value = timeConfig.value.periods.map((_, i) => ({
    start: source[i]?.start ?? '',
    end: source[i]?.end ?? '',
  }))
  draftDirty.value = true
  copyOpen.value = false
  showToast(`已复制「${seasonName(seasonId)} · ${campusName(campusId)}」到当前方案（未保存）`)
}

// ---------- 另外两个互斥开关（复位入口统一走 resetPlanTools） ----------
/** 新建 / 导入面板（粘贴与图片识别）。 */
export const importOpen = ref(false)
/** 快速生成的预览结果 `{ rows: [{index,label,from,to}] }`。 */
export const genPreview = ref(null)

/** 切换方案时一次性收掉全部工具面板。 */
export function resetPlanTools() {
  batchOpen.value = false
  copyOpen.value = false
  importOpen.value = false
  genPreview.value = null
}
