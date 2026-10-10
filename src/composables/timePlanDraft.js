/**
 * 作息方案草稿编辑器（第二步拆分）：一次只编辑一个「季 × 校区」组合。
 *
 * 【为什么必须是模块级单例】`planSeasonId / planCampusId / draft / draftDirty`
 * 被弹窗本体、基础设置区（增删校区/作息季后要重选方案）、导入计划（导入后要刷新
 * 当前草稿）三方共享。拆成子组件之后若各自 `ref()`，"有未保存修改"这个状态就会
 * 在组件之间各说各话——草稿守卫也就守不住了。
 *
 * 【同步守卫不能改成 async】返回值决定"要不要把焦点移到新 tab"：
 *   1. `useTabKeys` 是**同步**判定的（`if (select(key) === false) return`，见
 *      composables/tabKeys.js）。改成异步会让焦点先跑到一个并未选中的 tab 上，
 *      与 roving tabindex 自相矛盾；而 tabKeys.js 有多个调用方，
 *      不能为了这一处把整个键盘模型改成 await。
 *   2. `switchPlan` 与 `tryCloseTimeEditor` 原本也是同步消费这个布尔值。
 * 所以保留两阶段：现阶段只把"用户想做的事"挂起并立刻返回，真正的动作放到
 * ConfirmDialog 的 `@confirm` 里执行。三个入口（切方案 / 切分区 / 关闭弹窗）问的是
 * 同一个问题（是否放弃未保存修改），因此共用一份待确认状态与一个对话框。
 *
 * 【关闭动作从哪来】`emit('close')` 是父组件的事，模块里拿不到。所以父组件在
 * setup 里用 `setDraftCloseHandler(() => emit('close'))` 把关闭动作注进来，
 * 本模块只负责"什么时候该关"。
 */

import { computed, nextTick, ref } from 'vue'
import {
  timeConfig,
  currentCampusId,
  currentSeasonId,
  normalizeTimes,
  seasonAppliesTo,
  validCombos,
} from './store/timeConfig.js'
import { timeSettingsTab } from './modalSections.js'
import { settingError, showToast } from './timeSettingsShared.js'
import { resetPlanTools } from './timePlanTools.js'
import { restoreStoredValues } from './store/core.js'

export function toMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''))
  if (!match) return Number.NaN
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : Number.NaN
}

export function toHHMM(minutes) {
  const rounded = Math.round(Number(minutes))
  if (!Number.isFinite(rounded)) throw new RangeError('分钟数必须是有限数字')
  // 保留旧行为：负数按 00:00 处理；24:00 及之后必须由调用方显式拒绝，不能回绕到次日。
  const total = Math.max(0, rounded)
  if (total >= 24 * 60) throw new RangeError('时间必须在 00:00 至 23:59 之间')
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const planSeasonId = ref(null)
export const planCampusId = ref(null)
export const draft = ref([]) // [{start,end}] 与 periods 对齐
export const draftDirty = ref(false)

export const settingsCombos = computed(() => validCombos(timeConfig.value))

export function planKeyOf(seasonId, campusId) {
  return `${seasonId}::${campusId}`
}

export const currentPlanKey = computed(() =>
  planSeasonId.value && planCampusId.value ? planKeyOf(planSeasonId.value, planCampusId.value) : ''
)

// 当前编辑季适用于的校区（用于校区选择与适用性开关）
export const seasonsForPlanCampus = computed(() =>
  planCampusId.value
    ? timeConfig.value.seasons.filter((s) => seasonAppliesTo(s, planCampusId.value))
    : []
)

export function loadPlanDraft(seasonId, campusId) {
  planSeasonId.value = seasonId
  planCampusId.value = campusId
  const list = timeConfig.value.times[seasonId]?.[campusId] ?? []
  draft.value = timeConfig.value.periods.map((_, i) => ({
    start: list[i]?.start ?? '',
    end: list[i]?.end ?? '',
  }))
  draftDirty.value = false
  resetPlanTools()
}

// 打开设置时初始化：优先当前生效组合，否则第一个有效组合
export function initPlanSelection() {
  const combos = settingsCombos.value
  if (!combos.length) return
  const activeKey = planKeyOf(currentSeasonId(), currentCampusId())
  const found = combos.find((c) => planKeyOf(c.season, c.campus) === activeKey) ?? combos[0]
  if (planKeyOf(planSeasonId.value, planCampusId.value) !== planKeyOf(found.season, found.campus)) {
    loadPlanDraft(found.season, found.campus)
  }
}

// 三个入口共用的"待确认动作"：{kind:'plan'|'tab'|'close', ...}
export const pendingDraftAction = ref(null)

let closeHandler = () => {}

/** 父组件把 `emit('close')` 注进来（模块拿不到组件实例）。 */
export function setDraftCloseHandler(fn) {
  closeHandler = fn
}

// 返回 true = 可以立即继续；false = 已把动作挂起，等用户在对话框里决定。
export function guardDraft(action) {
  if (!draftDirty.value) return true
  pendingDraftAction.value = action
  return false
}

export function switchPlan(seasonId, campusId) {
  if (planKeyOf(seasonId, campusId) === currentPlanKey.value) return
  if (!guardDraft({ kind: 'plan', seasonId, campusId })) return
  loadPlanDraft(seasonId, campusId)
}

export function switchSettingsTab(tab) {
  if (tab === timeSettingsTab.value) return true
  // 返回 false：useTabKeys 因此不会移动焦点（焦点移动改由下面手动补）。
  if (!guardDraft({ kind: 'tab', tab })) return false
  timeSettingsTab.value = tab
  return true
}

/** 用户确认放弃：按挂起的动作继续执行。 */
export function confirmDiscardDraft() {
  const action = pendingDraftAction.value
  pendingDraftAction.value = null
  if (!action) return
  if (action.kind === 'plan') {
    loadPlanDraft(action.seasonId, action.campusId)
    return
  }
  if (action.kind === 'tab') {
    // 与改造前一致：确认放弃后先把草稿复位，再切分区。
    if (draftDirty.value) discardDraft()
    timeSettingsTab.value = action.tab
    // useTabKeys 因为 select 返回 false 而没有移动焦点，这里必须手动补上，
    // 否则焦点会停在一个并未选中的 tab 上。用 nextTick 是因为 ConfirmDialog
    // 关闭时 Modal 会先把焦点还给它的 previousFocus（就是原来那个 tab 按钮），
    // 同步 focus 会被那一步覆盖掉。
    nextTick(() => {
      document.getElementById(`time-settings-tab-${action.tab}`)?.focus?.()
    })
    return
  }
  if (action.kind === 'close') {
    // 顺序不能反：先按原样复位草稿，再关闭（改造前 loadPlanDraft 就在 emit('close') 之前）。
    loadPlanDraft(planSeasonId.value, planCampusId.value)
    closeHandler()
  }
}

export function markDirty() {
  draftDirty.value = true
}

export function saveDraft({ notify = true } = {}) {
  if (!planSeasonId.value || !planCampusId.value) return false
  if (planHasError.value) {
    settingError.value = '存在时间问题（结束需晚于开始、不能重叠等），请先修正后再保存'
    return false
  }
  normalizeTimes(timeConfig.value)
  const list = timeConfig.value.times[planSeasonId.value][planCampusId.value]
  timeConfig.value.periods.forEach((_, i) => {
    if (draft.value[i]) list[i] = { start: draft.value[i].start, end: draft.value[i].end }
  })
  draftDirty.value = false
  settingError.value = ''
  if (notify) showToast('作息方案已保存')
  return true
}

export function discardDraft() {
  loadPlanDraft(planSeasonId.value, planCampusId.value)
}

// The editor uses the existing durable commit seam before showing success.
// Legacy synchronous callers keep saveDraft's validation and toast behavior.
/** @param {{signal?: AbortSignal}} [context] */
export async function saveDraftWithFeedback({ signal } = {}) {
  if (!draftDirty.value) { tryCloseTimeEditor(); return false }
  if (!saveDraft({ notify: false })) return false
  try {
    await restoreStoredValues({ sl_timecfg: JSON.parse(JSON.stringify(timeConfig.value)) })
    return !signal?.aborted && (draftDirty.value ? { feedback: false } : true)
  } catch (cause) {
    draftDirty.value = true
    if (!signal?.aborted) settingError.value = cause instanceof Error ? cause.message : '作息保存失败，请重试'
    throw cause
  }
}

// 关闭弹窗时守卫（确认放弃才复位草稿并关闭）。
// 【取消时必须什么都不做】Modal 的 close 有 4 个来源（Esc / 遮罩点击 / ✕ / 抽屉下拖），
// 全是**同步 emit**、不会 await 处理器。所以这里既不清草稿也不调用 closeHandler——
// 一旦在挂起前就动了草稿，用户点「继续编辑」回来会发现改动已经没了。
export function tryCloseTimeEditor() {
  if (!draftDirty.value) { closeHandler(); return }
  pendingDraftAction.value = { kind: 'close' }
}

// ---------- 上午/下午/晚上 视觉分组（按开始时间自动划分，不写死节次区间） ----------
export const planSections = computed(() => {
  const groups = [
    { key: 'morning', label: '上午', rows: [] },
    { key: 'afternoon', label: '下午', rows: [] },
    { key: 'evening', label: '晚上', rows: [] },
  ]
  timeConfig.value.periods.forEach((period, i) => {
    const row = { period, index: i, ...draft.value[i] }
    const minutes = toMinutes(row.start)
    if (!Number.isFinite(minutes) || minutes < 12 * 60) groups[0].rows.push(row)
    else if (minutes < 18 * 60) groups[1].rows.push(row)
    else groups[2].rows.push(row)
  })
  return groups.filter((g) => g.rows.length)
})

// ---------- 行级错误检查 ----------
export function rowError(index) {
  const row = draft.value[index]
  if (!row) return ''
  if (!row.start || !row.end) return '时间尚未设置'
  if (!Number.isFinite(toMinutes(row.start)) || !Number.isFinite(toMinutes(row.end))) return '时间必须在 00:00 至 23:59 之间'
  if (toMinutes(row.end) <= toMinutes(row.start)) return '结束时间需要晚于开始时间'
  const prev = draft.value[index - 1]
  if (index > 0 && prev?.end && toMinutes(row.start) < toMinutes(prev.end)) {
    return `与「${timeConfig.value.periods[index - 1].label}」时间重叠`
  }
  return ''
}

export const planHasError = computed(() =>
  draft.value.some((_, i) => rowError(i) !== '')
)
