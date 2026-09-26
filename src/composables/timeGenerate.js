/**
 * 一键生成作息时间（第四步拆分）：预览制——先算出预览，再决定填充空白还是整体覆盖。
 *
 * 【预览制而不是直接写】生成只是**辅助填充**：用户可能只想补上空着的节次。
 * 所以 `previewGenerate()` 只算不写，`applyGenerate(mode)` 才把结果落进草稿。
 * `genPreview` 这个开关本身归 timePlanTools 所有（它与批量调整/复制/导入互斥）。
 */

import { computed, reactive } from 'vue'
import { timeConfig, periodIndex } from './store/timeConfig.js'
import { settingError } from './timeSettingsShared.js'
import { draft, draftDirty, toHHMM, toMinutes } from './timePlanDraft.js'
import { batchOpen, copyOpen, genPreview, importOpen } from './timePlanTools.js'

export const gen = reactive({
  startId: null,
  startTime: '08:00',
  duration: 45,
  breakMin: 10,
  lunchAfterIdx: 4,
  lunchMin: 120,
  dinnerAfterIdx: 8,
  dinnerMin: 60,
  allSeasons: false,
  allCampuses: false,
})

export const genStartOptions = computed(() => timeConfig.value.periods)
export const genAfterOptions = computed(() => timeConfig.value.periods)

export function previewGenerate() {
  settingError.value = ''
  const cfg = timeConfig.value
  const periods = cfg.periods
  const startIdx = periodIndex(gen.startId ?? periods[1]?.id ?? periods[0]?.id)
  if (startIdx < 0) { settingError.value = '请选择起始节次'; return }
  const lunchIdx = gen.lunchMin > 0 ? gen.lunchAfterIdx : -1
  const dinnerIdx = gen.dinnerMin > 0 ? gen.dinnerAfterIdx : -1
  if (lunchIdx < startIdx || lunchIdx >= periods.length - 1) {
    settingError.value = '午休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }
  if (gen.dinnerMin > 0 && (dinnerIdx < startIdx || dinnerIdx >= periods.length - 1)) {
    settingError.value = '晚休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }
  let cursor = toMinutes(gen.startTime)
  const generated = periods.map((_, i) => {
    if (i < startIdx) return null
    if (i > startIdx) {
      const prev = i - 1
      if (prev === lunchIdx) cursor += gen.lunchMin
      else if (prev === dinnerIdx) cursor += gen.dinnerMin
      else cursor += gen.breakMin
    }
    const start = toHHMM(cursor)
    cursor += Number(gen.duration) || 45
    return { start, end: toHHMM(cursor) }
  })
  const rows = []
  for (let i = startIdx; i < periods.length; i++) {
    if (!generated[i]) continue
    rows.push({
      index: i,
      label: periods[i].label,
      from: draft.value[i] ? `${draft.value[i].start}–${draft.value[i].end}` : '',
      to: `${generated[i].start}–${generated[i].end}`,
      blank: !draft.value[i] || !draft.value[i].start || !draft.value[i].end || (draft.value[i].start === '08:00' && draft.value[i].end === '08:45'),
    })
  }
  genPreview.value = { rows }
}

export function applyGenerate(mode) {
  const preview = genPreview.value
  if (!preview) return
  for (const row of preview.rows) {
    if (mode === 'fill' && !row.blank) continue
    const [s, e] = row.to.split('–')
    draft.value[row.index] = { start: s, end: e }
  }
  draftDirty.value = true
  genPreview.value = null
}

export function toggleGenPreview() {
  if (genPreview.value) genPreview.value = null
  else previewGenerate()
  copyOpen.value = false
  batchOpen.value = false
  importOpen.value = false
}
