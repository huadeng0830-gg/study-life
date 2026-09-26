import { computed, ref } from 'vue'
import {
  timeConfig,
  seasonName,
  courseUsesPeriod,
  seasonsForCampus,
  autoSeasonStatusFor,
} from './store/timeConfig.js'
import { schedulePolicy } from './settingsPolicy.js'

/**
 * 校区 / 作息季切换与作息设置入口（从 ScheduleView 拆出）。
 * 这一块只服务于工具条上的校区、作息按钮和「作息与节次」弹窗。
 */
export function useScheduleCampusSeason({ courses, courseTemplates }) {
  const showTimeEditor = ref(false)

  // 当前生效季在当前校区的有效选择（供主页作息按钮渲染）
  const settingsSchedule = computed(() => schedulePolicy())
  const seasonsForCurrentCampus = computed(() =>
    seasonsForCampus(settingsSchedule.value.campusId, timeConfig.value),
  )
  const showCampusSwitcher = computed(() => timeConfig.value.campuses.length > 1)
  const showSeasonSwitcher = computed(() => seasonsForCurrentCampus.value.length > 1)
  const currentAutoStatus = computed(() => autoSeasonStatusFor(settingsSchedule.value.campusId, timeConfig.value))

  function selectScheduleCampus(campusId) {
    timeConfig.value.currentCampus = campusId
    if (timeConfig.value.autoSeason) return
    const available = seasonsForCampus(campusId, timeConfig.value)
    if (!available.some((season) => season.id === timeConfig.value.currentSeason)) {
      timeConfig.value.currentSeason = available[0]?.id ?? null
    }
  }

  function enableAutoSeason() {
    if (currentAutoStatus.value.available) timeConfig.value.autoSeason = true
  }

  const autoModeInfo = computed(() => {
    if (!showSeasonSwitcher.value) return null
    if (timeConfig.value.autoSeason) {
      const status = currentAutoStatus.value
      if (!status.available) {
        const reason = status.reason === 'missing-date'
          ? `请完善「${status.missing.map((season) => season.name).join(' / ')}」的生效日期`
          : status.reason === 'date-conflict'
            ? '当前校区存在相同生效日期，请在基础设置中调整'
            : '当前校区没有可用作息季'
        return {
          mode: 'unavailable',
          text: '自动模式暂不可用',
          hint: `${reason}；当前暂用「${seasonName(settingsSchedule.value.seasonId) || '—'}」`,
        }
      }
      return {
        mode: 'auto',
        text: `自动模式 · 当前使用「${seasonName(status.seasonId) || '—'}」`,
        hint: '根据作息季生效日期自动选择',
      }
    }
    const manual = timeConfig.value.seasons.find((s) => s.id === timeConfig.value.currentSeason)
    return {
      mode: 'manual',
      text: `当前手动使用「${manual?.name ?? '—'}」`,
      hint: '自动切换暂时关闭，点击「自动」恢复',
    }
  })

  function openTimeSettings() {
    showTimeEditor.value = true
  }

  function courseCountByPeriodId(periodId) {
    const activeCount = courses.value.filter((course) =>
      courseUsesPeriod(course, periodId, timeConfig.value.periods),
    ).length
    const templateCount = courseTemplates.value.reduce((count, template) =>
      count + (template.courses ?? []).filter((course) =>
        courseUsesPeriod(course, periodId, timeConfig.value.periods),
      ).length,
    0)
    return activeCount + templateCount
  }

  return {
    showTimeEditor,
    settingsSchedule,
    seasonsForCurrentCampus,
    showCampusSwitcher,
    showSeasonSwitcher,
    currentAutoStatus,
    autoModeInfo,
    selectScheduleCampus,
    enableAutoSeason,
    openTimeSettings,
    courseCountByPeriodId,
  }
}
