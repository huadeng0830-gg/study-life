<script setup>
/**
 * 基础设置面板：校区 / 作息季 / 节次。
 *
 * 【为什么这三块必须是同一个组件】它们共享一个很容易被忽略的契约：增删之后都要
 * `initPlanSelection()`（或 `loadPlanDraft()`）把方案编辑器拉回一个仍然有效的组合。
 * 分成三个小组件就得把这条副作用复制三份，而漏掉任何一份的表现都是"列表变了、
 * 编辑器却还停在刚被删掉的方案上"。
 *
 * 【为什么删除确认框跟着面板走】`removeCampusTarget` / `removeSeasonTarget` 是在
 * **打开对话框之前**就把文案算好存进去的（晚算会读到用户在对话框期间改过的配置）。
 * 文案的计算与对话框的绑定必须在同一个文件里，否则 `tests/confirmDialogMigration`
 * 会直接报"指向的名字没在本文件声明"。
 */
import { computed, ref } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import {
  addCampus,
  addPeriod,
  addSeason,
  autoSeasonIdFor,
  currentCampusId,
  currentSeasonId,
  isValidSeasonDate,
  removeCampus,
  removePeriod,
  removeSeason,
  renameCampus,
  renamePeriod,
  renameSeason,
  seasonAppliesTo,
  seasonConflicts,
  timeConfig,
} from '../../composables/store/timeConfig.js'
import { settingError } from '../../composables/timeSettingsShared.js'
import {
  initPlanSelection,
  loadPlanDraft,
  planCampusId,
  planSeasonId,
} from '../../composables/timePlanDraft.js'

const props = defineProps({
  courseCountByPeriodId: { type: Function, required: true },
})

/* ---------- 基础设置：校区 / 作息季 / 节次 ---------- */
const newCampusName = ref('')
const newSeasonName = ref('')
const newSeasonDate = ref('03-01')
const newPeriodLabel = ref('')

function onAddCampus() {
  settingError.value = ''
  if (addCampus(newCampusName.value)) {
    newCampusName.value = ''
    initPlanSelection()
  }
  else settingError.value = '请输入校区名称'
}

// 删除校区 / 作息季的确认文案依赖**确认前**算出的 planCount / isCurrent，
// 所以整段文案在打开对话框之前就定稿存进目标 ref，确认时不再重算。
// 晚算会读到用户已经改过的配置（对话框期间还能从别处改数据），
// 于是"将删除 3 个方案"与真正删掉的对不上。
const removeCampusTarget = ref(null)
const removeSeasonTarget = ref(null)

function onRemoveCampus(id) {
  settingError.value = ''
  const cfg = timeConfig.value
  if (cfg.campuses.length <= 1) { settingError.value = '至少保留一个校区'; return }
  const campus = cfg.campuses.find((c) => c.id === id)
  const planCount = cfg.seasons.filter((s) => seasonAppliesTo(s, id)).length
  const isCurrent = currentCampusId() === id
  const lines = [`确定删除校区「${campus?.name}」？`, `将同时删除 ${planCount} 个作息季在该校区的时间方案。`]
  if (isCurrent) lines.push('该校区是当前查看的校区，删除后会切换到其他校区。')
  removeCampusTarget.value = { id, message: lines.join('\n') }
}

function confirmRemoveCampus() {
  const target = removeCampusTarget.value
  removeCampusTarget.value = null
  if (!target) return
  removeCampus(target.id)
  initPlanSelection()
}

function onAddSeason() {
  settingError.value = ''
  if (newSeasonDate.value && !isValidSeasonDate(newSeasonDate.value)) {
    settingError.value = '起始日期格式应为 MM-DD，例如 05-01'
    return
  }
  if (addSeason(newSeasonName.value, newSeasonDate.value)) {
    newSeasonName.value = ''
    newSeasonDate.value = '03-01'
    initPlanSelection()
  } else {
    settingError.value = '请输入作息季名称'
  }
}

function onRemoveSeason(id) {
  settingError.value = ''
  const cfg = timeConfig.value
  if (cfg.seasons.length <= 1) { settingError.value = '至少保留一个作息季'; return }
  const season = cfg.seasons.find((s) => s.id === id)
  const campusCount = cfg.campuses.filter((c) => seasonAppliesTo(season, c.id)).length
  const activeId = timeConfig.value.autoSeason ? autoSeasonIdFor(currentCampusId()) : currentSeasonId()
  const lines = [`确定删除作息季「${season?.name}」？`, `将同时删除 ${campusCount} 个校区在该季的时间方案。`]
  if (activeId === id) lines.push('该季是当前生效的作息季，删除后会自动切换到其他作息季。')
  // 文案同上：确认前定稿，不晚算。
  removeSeasonTarget.value = { id, message: lines.join('\n') }
}

function confirmRemoveSeason() {
  const target = removeSeasonTarget.value
  removeSeasonTarget.value = null
  if (!target) return
  removeSeason(target.id)
  initPlanSelection()
}

function onSeasonDateChange(season, value, input) {
  const date = String(value ?? '').trim()
  settingError.value = ''
  if (date && !isValidSeasonDate(date)) {
    settingError.value = '生效日期无效，请使用 MM-DD，例如 05-01'
    if (input) input.value = season.startDate || ''
    return
  }
  renameSeason(season.id, null, date)
}

// 作息季适用校区（多校区时显示；空 = 全部适用，兼容旧数据）
function seasonCampusOn(season, campusId) {
  return seasonAppliesTo(season, campusId)
}
function toggleSeasonCampus(season, campusId) {
  const current = Array.isArray(season.campuses) ? [...season.campuses] : timeConfig.value.campuses.map((c) => c.id)
  const idx = current.indexOf(campusId)
  if (idx >= 0) {
    if (current.length <= 1) { settingError.value = '作息季至少需要一个适用校区'; return }
    current.splice(idx, 1)
  } else {
    current.push(campusId)
  }
  season.campuses = current
  settingError.value = ''
  initPlanSelection()
}
const seasonDateConflicts = computed(() => seasonConflicts(timeConfig.value))

function onAddPeriod() {
  settingError.value = ''
  if (addPeriod(newPeriodLabel.value)) {
    newPeriodLabel.value = ''
    loadPlanDraft(planSeasonId.value, planCampusId.value)
  }
  else settingError.value = '请输入节次名称'
}

function onRemovePeriod(id) {
  settingError.value = ''
  const result = removePeriod(id, props.courseCountByPeriodId)
  if (result !== true) {
    settingError.value = result
    return
  }
  loadPlanDraft(planSeasonId.value, planCampusId.value)
}

function periodUseCount(id) {
  return Number(props.courseCountByPeriodId(id)) || 0
}
</script>

<template>
  <section class="setting-section">
    <div class="setting-head">
      <h4>🏫 校区（{{ timeConfig.campuses.length }}）</h4>
    </div>
    <div v-for="campus in timeConfig.campuses" :key="campus.id" class="setting-row">
      <input
        :value="campus.name"
        :aria-label="`校区名称：${campus.name}`"
        @change="renameCampus(campus.id, $event.target.value)"
      />
      <button
        class="setting-del"
        :disabled="timeConfig.campuses.length <= 1"
        aria-label="删除校区"
        title="删除校区"
        @click="onRemoveCampus(campus.id)"
      >✕</button>
    </div>
    <div class="setting-add">
      <input v-model="newCampusName" aria-label="新校区名称" placeholder="新校区名称，例如：东校区" @keyup.enter="onAddCampus" />
      <button class="btn btn-ghost" @click="onAddCampus">＋ 添加</button>
    </div>
  </section>

  <section class="setting-section">
    <div class="setting-head">
      <h4>☀️ 作息季（{{ timeConfig.seasons.length }}）</h4>
      <span class="setting-note">按起始日期自动切换；同一天开始会无法判断先后</span>
    </div>
    <p v-if="seasonDateConflicts.length" class="error conflict-tip" role="alert">
      ⚠ 生效日期冲突：{{ seasonDateConflicts.map((c) => `${c.campusName} · ${c.date}（${c.names.join(' / ')}）`).join('；') }} —— 对应校区的自动模式无法判断先后，请调整日期。
    </p>
    <div v-for="season in timeConfig.seasons" :key="season.id" class="season-block">
      <div class="setting-row season">
        <input
          class="grow"
          :value="season.name"
          :aria-label="`作息季名称：${season.name}`"
          @change="renameSeason(season.id, $event.target.value, null)"
        />
        <input
          class="date"
          :class="{ invalid: !isValidSeasonDate(season.startDate) }"
          :value="season.startDate"
          :aria-label="`作息季生效日期（MM-DD）：${season.name}`"
          placeholder="05-01"
          @blur="onSeasonDateChange(season, $event.target.value, $event.target)"
        />
        <button
          class="setting-del"
          :disabled="timeConfig.seasons.length <= 1"
          aria-label="删除作息季"
          title="删除作息季"
          @click="onRemoveSeason(season.id)"
        >✕</button>
      </div>
      <small v-if="!isValidSeasonDate(season.startDate)" class="season-date-warning">
        未配置有效生效日期；适用校区存在多个作息季时，自动模式将不可用。
      </small>
      <div v-if="timeConfig.campuses.length > 1" class="season-scope">
        <span class="scope-label">适用校区</span>
        <button
          v-for="campus in timeConfig.campuses"
          :key="campus.id"
          class="chip"
          :class="{ on: seasonCampusOn(season, campus.id) }"
          @click="toggleSeasonCampus(season, campus.id)"
        >{{ campus.name }}</button>
        <small class="scope-note">不勾选的校区不会使用该作息季（时间方案保留但不再参与自动切换）</small>
      </div>
    </div>
    <div class="setting-add">
      <input v-model="newSeasonName" class="grow" aria-label="新作息季名称" placeholder="新作息季名称，例如：春季时间" @keyup.enter="onAddSeason" />
      <input v-model="newSeasonDate" class="date" aria-label="新作息季生效日期（MM-DD）" placeholder="03-01" />
      <button class="btn btn-ghost" @click="onAddSeason">＋ 添加</button>
    </div>
  </section>

  <section class="setting-section">
    <div class="setting-head">
      <h4>📋 节次（{{ timeConfig.periods.length }}）</h4>
      <span class="setting-note">被课程占用的节次无法删除</span>
    </div>
    <div class="period-grid">
      <div v-for="period in timeConfig.periods" :key="period.id" class="setting-row">
        <input
          :value="period.label"
          :aria-label="`节次名称：${period.label}`"
          @change="renamePeriod(period.id, $event.target.value)"
        />
        <small v-if="periodUseCount(period.id)" class="period-use-count">
          {{ periodUseCount(period.id) }} 门占用
        </small>
        <button
          class="setting-del"
          :disabled="timeConfig.periods.length <= 1 || periodUseCount(period.id) > 0"
          aria-label="删除节次"
          :title="periodUseCount(period.id) ? `有 ${periodUseCount(period.id)} 门课程或模板课程占用` : '删除节次'"
          @click="onRemovePeriod(period.id)"
        >✕</button>
      </div>
    </div>
    <div class="setting-add">
      <input v-model="newPeriodLabel" aria-label="新节次名称" placeholder="新节次名称，例如：第十三节课" @keyup.enter="onAddPeriod" />
      <button class="btn btn-ghost" @click="onAddPeriod">＋ 添加</button>
    </div>
  </section>

  <ConfirmDialog
    v-if="removeCampusTarget"
    :open="Boolean(removeCampusTarget)"
    title="删除校区"
    :message="removeCampusTarget?.message || ''"
    confirm-label="删除校区"
    @close="removeCampusTarget = null"
    @confirm="confirmRemoveCampus"
  />

  <ConfirmDialog
    v-if="removeSeasonTarget"
    :open="Boolean(removeSeasonTarget)"
    title="删除作息季"
    :message="removeSeasonTarget?.message || ''"
    confirm-label="删除作息季"
    @close="removeSeasonTarget = null"
    @confirm="confirmRemoveSeason"
  />
</template>

<style scoped>
.setting-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setting-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.setting-head h4 {
  font-size: var(--fs-14);
}
.setting-note {
  color: var(--muted);
  font-size: var(--fs-11);
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-row input {
  flex: 1;
  min-width: 0;
}
.setting-row input.date {
  flex: 0 0 90px;
  text-align: center;
}
/* 校验失败的输入框：琥珀色底/边同样是写死的，而输入框文字是 var(--text)——
   深色主题下 #fffaf0 白底会让输入内容掉到 1.15:1。 */
.setting-row input.invalid {
  border-color: color-mix(in srgb, var(--warning) 35%, var(--card));
  background: color-mix(in srgb, var(--warning) 10%, var(--card));
}
.setting-del {
  flex: 0 0 30px;
  height: 30px;
  color: var(--muted);
  font-size: var(--fs-12);
  border: 1px solid var(--border);
  border-radius: var(--radius-7);
  background: var(--card);
}
.setting-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.setting-del:disabled {
  opacity: 0.35;
  cursor: default;
}
.setting-add {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.setting-add input {
  flex: 1;
  min-width: 0;
}
.setting-add input.date {
  flex: 0 0 90px;
  text-align: center;
}
.period-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.period-use-count {
  flex: 0 0 auto;
  /* 这一行没有自己的底色，落在 Modal 的 var(--card) 上：写死的 #9a6414 在深色只有 3.18:1。 */
  color: var(--warning);
  font-size: var(--fs-10-5);
  white-space: nowrap;
}
.error {
  color: var(--danger);
  font-size: var(--fs-13);
}
.grow {
  min-width: 0;
  flex: 1;
}
.conflict-tip { margin: 0 0 8px; }
.season-block + .season-block { margin-top: 12px; }
.season-scope { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 0 2px 6px; }
.scope-label { color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-700); }
.scope-note { flex-basis: 100%; color: var(--ink-faint); font-size: var(--fs-10-5); }
.season-date-warning { display: block; margin: 4px 0 0 6px; color: var(--warning); font-size: var(--fs-10-5); }
</style>
