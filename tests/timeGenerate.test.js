// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultTimeConfig, timeConfig } from '../src/composables/store/timeConfig.js'
import { applyBatch, batchDelta, batchFrom, batchPreview, batchTo, genPreview, openTimeShift } from '../src/composables/timePlanTools.js'
import { draft, loadPlanDraft, toHHMM } from '../src/composables/timePlanDraft.js'
import { gen, previewGenerate } from '../src/composables/timeGenerate.js'
import { settingError } from '../src/composables/timeSettingsShared.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

beforeEach(() => {
  timeConfig.value = defaultTimeConfig()
  settingError.value = ''
  const season = timeConfig.value.seasons[0].id
  const campus = timeConfig.value.campuses[0].id
  loadPlanDraft(season, campus)
  Object.assign(gen, {
    startId: timeConfig.value.periods[0].id,
    startTime: '08:00',
    duration: 45,
    breakMin: 10,
    lunchAfterIdx: 4,
    lunchMin: 120,
    dinnerAfterIdx: 8,
    dinnerMin: 60,
  })
})

describe('作息时间生成边界', () => {
  it('午休设为 0 时不校验已禁用的位置，也不添加午休', () => {
    gen.lunchAfterIdx = -1
    gen.lunchMin = 0
    gen.dinnerAfterIdx = -1
    gen.dinnerMin = 0

    previewGenerate()

    expect(settingError.value).toBe('')
    expect(genPreview.value?.rows.length).toBeGreaterThan(0)
  })

  it('生成结果超过 23:59 时显示错误，不产生回绕预览', () => {
    gen.startTime = '23:30'
    gen.lunchMin = 0
    gen.dinnerMin = 0

    previewGenerate()

    expect(genPreview.value).toBeNull()
    expect(settingError.value).toContain('超出 23:59')
  })

  it('时间格式化保留 00:00、23:59 与负数归零边界，拒绝 24:00 及非数字', () => {
    expect(toHHMM(0)).toBe('00:00')
    expect(toHHMM(1439)).toBe('23:59')
    expect(toHHMM(-1)).toBe('00:00')
    expect(() => toHHMM(1440)).toThrow(RangeError)
    expect(() => toHHMM(Number.NaN)).toThrow(RangeError)
  })

  it('批量平移越过 23:59 时显示错误并阻止写入草稿', () => {
    draft.value[0] = { start: '23:30', end: '23:50' }
    openTimeShift()
    batchFrom.value = 0
    batchTo.value = 0
    batchDelta.value = 15

    expect(batchPreview.value?.error).toContain('超出 23:59')
    applyBatch()
    expect(draft.value[0]).toEqual({ start: '23:30', end: '23:50' })
  })
})
