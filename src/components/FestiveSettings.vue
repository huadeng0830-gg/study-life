<script setup>
import { ref, watch, computed } from 'vue'
import Modal from './Modal.vue'
import { Badge } from './ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Field, FieldDescription, FieldGroup } from './ui/field'
import { festiveConfig } from '../composables/atmosphereStore.js'
import { builtInFestivalTable, isRealMonthDay, normalizeFestiveConfig } from '../composables/festive.js'
import {
  LUNAR_ANNIVERSARY_HINT,
  LUNAR_DAY_OPTIONS,
  LUNAR_MONTH_OPTIONS,
  toDateKey,
} from '../composables/lunarAnniversaries.js'
import { ANNIVERSARY_SOURCE, upcomingAnniversaries } from '../composables/anniversarySchedule.js'
import { useLunarAnniversaryEditor } from '../composables/lunarAnniversaryEditor.js'
import { NARRATIVE_LANGUAGES, narrativeLang } from '../composables/narrative.js'
import { useStoredRef } from '../composables/store/index.js'
import { appToday } from '../composables/timeContext.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

// 内置节日对照表（只读，纯函数生成，内容与 festive.js 内置常量一致）
const table = ref({ solar: [], lunarFestivals: [], lunar: [] })
const tableLoading = ref(false)
const tableError = ref('')

let anniversarySeq = 0
const UPCOMING_SOURCE_LABELS = Object.freeze({
  [ANNIVERSARY_SOURCE.BIRTHDAY]: '生日',
  [ANNIVERSARY_SOURCE.ANNIVERSARY]: '公历纪念日',
  [ANNIVERSARY_SOURCE.INSTALL]: '使用周年',
  [ANNIVERSARY_SOURCE.LUNAR]: '农历纪念日',
})

// 生日祝福只按月-日触发（sl_festive_config.birthday 保持 MM-DD 语义不变）。
// 「我的生日」date 输入框需要完整年月日，故用独立 key 记住出生年份，
// 关闭面板再打开时年份也不会被重设成占位年份。
const BIRTHDAY_FULL_KEY = 'sl_festive_birthday_full'
const birthdayFull = useStoredRef(BIRTHDAY_FULL_KEY, '')
function readBirthdayFull() {
  const value = String(birthdayFull.value ?? '')
  return toDateKey(value) === value ? value : ''
}
function writeBirthdayFull(value) {
  birthdayFull.value = value || ''
}
function birthdayInputOf(cfg) {
  const full = readBirthdayFull()
  if (full) return full
  // 兼容旧数据：只有 MM-DD 没有年份时，用当前年份补齐一次；用户重选后即会记住年份。
  return /^\d{2}-\d{2}$/.test(String(cfg?.birthday ?? '')) ? `${appToday.value.slice(0, 4)}-${cfg.birthday}` : ''
}

const enabled = ref(festiveConfig.value.enabled)
const birthdayInput = ref(birthdayInputOf(festiveConfig.value))
const installDateInput = ref(festiveConfig.value.installDate)
const anniversaries = ref(toRows(festiveConfig.value.anniversaries))

function toRows(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: `anni-${Date.now()}-${anniversarySeq++}`,
    date: String(item?.date ?? ''),
    label: String(item?.label ?? ''),
    savedDate: String(item?.date ?? ''),
    savedLabel: String(item?.label ?? '').trim(),
  }))
}

function syncFromConfig() {
  const cfg = normalizeFestiveConfig(festiveConfig.value)
  enabled.value = cfg.enabled
  birthdayInput.value = birthdayInputOf(cfg)
  installDateInput.value = cfg.installDate
  anniversaries.value = toRows(cfg.anniversaries)
  // 农历纪念日走独立的新键：打开面板时重读一次，并同步内存镜像（供首页氛围判断使用）。
  syncLunarAnniversaries()
}

async function refreshTable() {
  tableLoading.value = true
  tableError.value = ''
  try {
    table.value = await builtInFestivalTable(Number(appToday.value.slice(0, 4)))
  } catch {
    tableError.value = '节日对照表暂时无法加载，基础日期功能不受影响。'
  } finally {
    tableLoading.value = false
  }
}

function setBirthday(value) {
  const dateKey = toDateKey(value)
  birthdayInput.value = dateKey
  writeBirthdayFull(dateKey)
  commit()
}

// 每次修改立即归一化后写回 festiveConfig；useStoredRef 会自动持久化。
function commit() {
  const savedAnniversaries = anniversaries.value.map((row) => {
    const label = String(row.label ?? '').trim()
    if (isRealMonthDay(row.date) && label) {
      row.savedDate = row.date
      row.savedLabel = label
      return { date: row.date, label }
    }
    if (row.savedDate && row.savedLabel) {
      return { date: row.savedDate, label: row.savedLabel }
    }
    return { date: row.date, label: row.label }
  })
  festiveConfig.value = normalizeFestiveConfig({
    enabled: enabled.value,
    birthday: birthdayInput.value ? birthdayInput.value.slice(5) : '',
    installDate: installDateInput.value,
    anniversaries: savedAnniversaries,
  })
}

function addAnniversary() {
  anniversaries.value.push({
    id: `anni-${Date.now()}-${anniversarySeq++}`,
    date: '',
    label: '',
    savedDate: '',
    savedLabel: '',
  })
}

function anniversaryNeedsFields(row) {
  return !row?.date || !String(row?.label ?? '').trim()
}

function anniversaryDraftHint(row) {
  return row?.savedDate && row?.savedLabel
    ? '本次修改未保存，上次保存的纪念日仍会保留；补齐日期和名称后自动更新。'
    : '同时填写日期和名称后，这条纪念日才会保存。'
}

function lunarNameNeedsField(row) {
  return !String(row?.label ?? '').trim()
}

function lunarDraftHint(row) {
  return row?.saved
    ? '本次修改未保存，上次保存的农历纪念日仍会保留；填写名称后自动更新。'
    : '填写名称后，这条农历纪念日才会保存。'
}

function upcomingSourceLabel(source) {
  return UPCOMING_SOURCE_LABELS[source] || '纪念日'
}

function setAnniversaryDate(id, value) {
  const row = anniversaries.value.find((item) => item.id === id)
  if (!row) return
  row.date = value ? value.slice(5) : ''
  commit()
}

function setAnniversaryLabel(id, value) {
  const row = anniversaries.value.find((item) => item.id === id)
  if (!row) return
  row.label = String(value ?? '')
  commit()
}

function removeAnniversary(id) {
  anniversaries.value = anniversaries.value.filter((item) => item.id !== id)
  commit()
}

// 农历纪念日单独存储与归一化，由编辑模型维护；组件仅接收字段变化并展示解析结果。
const {
  rows: lunarAnniversaries,
  sync: syncLunarAnniversaries,
  add: addLunarAnniversary,
  setLabel: setLunarLabel,
  setMonth: setLunarMonth,
  setDay: setLunarDay,
  setLeapMonth: setLunarLeap,
  remove: removeLunarAnniversary,
  resolutionText: lunarResolveText,
  resolutionClass: lunarResolveClass,
} = useLunarAnniversaryEditor(appToday)

// 「即将到来」：生日 / 公历纪念日 / 使用周年 / 农历纪念日的下一次落点，按时间升序。
// 农历行直接用编辑器草稿（比存储新），公历三类走 `festiveConfig`。
// 不受"启用节日氛围"影响 —— 那是装饰开关，这里回答的是"我登记的日子什么时候回来"。
const upcoming = computed(() => upcomingAnniversaries(
  { ...festiveConfig.value, anniversaries: anniversaries.value.map((row) => ({ date: row.date, label: row.label })) },
  lunarAnniversaries.value,
  appToday.value,
))

watch(
  () => props.open,
  (open) => { if (open) { syncFromConfig(); void refreshTable() } },
  { immediate: true }
)
</script>

<template>
  <Modal :open="open" title="节日与纪念日设置" medium @close="emit('close')">
    <div class="festive-settings">
      <label class="switch-row">
        <input v-model="enabled" type="checkbox" @change="commit" />
        <span>启用节日氛围<small>首页的祝福语与彩带 / 雪花 / 灯笼装饰</small></span>
      </label>

      <!--
        叙事语言（新键 sl_ui_language）。注意范围：**只翻译节日的祝福语**，
        界面其它文字仍是中文；个人纪念日与「使用周年」因为文案里拼了用户自己填的
        标签与年数（`${label}快乐…`、`已经一起走过 ${n} 年…`），整句翻译会丢信息，
        所以按原样回落中文 —— 这是有意划的范围，不是漏掉的条目，见 tests/narrativeI18n.test.js。
      -->
      <FieldGroup class="festive-field-group">
        <Field class="field">
          <label for="festive-language">祝福语语言</label>
          <select id="festive-language" v-model="narrativeLang">
            <option v-for="item in NARRATIVE_LANGUAGES" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
          <FieldDescription class="field-help">只影响节日祝福语的文案；界面其它文字仍是中文，个人纪念日与使用周年照原样显示</FieldDescription>
        </Field>

        <Field class="field">
          <label for="festive-birthday">我的生日（月-日）</label>
          <input
            id="festive-birthday"
            type="date"
            :value="birthdayInput"
            @change="setBirthday($event.target.value)"
          />
          <FieldDescription class="field-help">生日祝福按「月-日」触发；你选的出生年份会一并记住</FieldDescription>
        </Field>

        <Field class="field">
          <label for="festive-install">开始使用日期</label>
          <input
            id="festive-install"
            type="date"
            :value="installDateInput"
            @change="installDateInput = $event.target.value; commit()"
          />
          <FieldDescription class="field-help">满一年后，每年当天会送上「使用周年」祝福</FieldDescription>
        </Field>
      </FieldGroup>

      <div class="anni-section">
        <div class="anni-head">
          <span>纪念日列表</span>
          <button type="button" class="btn add-btn" @click="addAnniversary">＋ 添加纪念日</button>
        </div>
        <small class="anni-hint">纪念日只保存「月-日」，每年同一天提醒（年份不参与）</small>
        <p v-if="!anniversaries.length" class="empty-line">还没有纪念日，点「添加纪念日」新建一条。</p>
        <div v-else class="anni-list">
          <div v-for="(row, index) in anniversaries" :key="row.id" class="anni-row">
            <input
              type="date"
              :value="row.date ? '2000-' + row.date : ''"
              :aria-label="`纪念日 ${row.label || '未命名'} 的日期`"
              :aria-invalid="anniversaryNeedsFields(row)"
              :aria-describedby="anniversaryNeedsFields(row) ? `anniversary-hint-${row.id}` : undefined"
              @change="setAnniversaryDate(row.id, $event.target.value)"
            />
            <input
              :value="row.label"
              maxlength="30"
              placeholder="名称，如：在一起"
              :aria-label="'纪念日 ' + (row.label || '第 ' + (index + 1) + ' 条') + ' 的名称'"
              :aria-invalid="anniversaryNeedsFields(row)"
              :aria-describedby="anniversaryNeedsFields(row) ? `anniversary-hint-${row.id}` : undefined"
              @input="setAnniversaryLabel(row.id, $event.target.value)"
            />
            <button type="button" class="del-btn" :aria-label="`删除纪念日 ${row.label || ''}`" @click="removeAnniversary(row.id)">删除</button>
            <p v-if="anniversaryNeedsFields(row)" :id="`anniversary-hint-${row.id}`" class="anniversary-draft-hint">{{ anniversaryDraftHint(row) }}</p>
          </div>
        </div>
      </div>

      <div class="lunar-section">
        <div class="anni-head">
          <span>农历纪念日</span>
          <button type="button" class="btn add-btn" @click="addLunarAnniversary">＋ 添加农历纪念日</button>
        </div>
        <small class="lunar-hint">{{ LUNAR_ANNIVERSARY_HINT.section }}。{{ LUNAR_ANNIVERSARY_HINT.support }}</small>
        <p v-if="!lunarAnniversaries.length" class="empty-line">还没有农历纪念日，点「添加农历纪念日」新建一条。</p>
        <div v-else class="lunar-list">
          <div v-for="row in lunarAnniversaries" :key="row.id" class="lunar-row">
            <input
              v-model="row.label"
              maxlength="30"
              placeholder="名称，如：外婆生日"
              aria-label="农历纪念日名称"
              :aria-invalid="lunarNameNeedsField(row)"
              :aria-describedby="lunarNameNeedsField(row) ? 'lunar-anniversary-hint-' + row.id : undefined"
              @input="setLunarLabel(row.id, $event.target.value)"
            />
            <select :value="row.lunarMonth" aria-label="农历月份" @change="setLunarMonth(row.id, $event.target.value)">
              <option v-for="option in LUNAR_MONTH_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <select :value="row.lunarDay" aria-label="农历日期" @change="setLunarDay(row.id, $event.target.value)">
              <option v-for="option in LUNAR_DAY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <label class="lunar-leap">
              <input
                type="checkbox"
                :checked="row.isLeapMonth"
                @change="setLunarLeap(row.id, $event.target.checked)"
              />
              <span>闰月</span>
            </label>
            <button
              type="button"
              class="del-btn"
              :aria-label="`删除农历纪念日 ${row.label || ''}`"
              @click="removeLunarAnniversary(row.id)"
            >删除</button>
            <p class="lunar-resolve" :class="lunarResolveClass(row)">{{ lunarResolveText(row) }}</p>
            <p
              v-if="lunarNameNeedsField(row)"
              :id="'lunar-anniversary-hint-' + row.id"
              class="lunar-draft-hint"
            >{{ lunarDraftHint(row) }}</p>
          </div>
        </div>
      </div>

      <!--
        「即将到来」：四类个人节点的下一次落点，按时间升序。
        放在两段编辑列表之后、只读对照表之前 —— 用户改完一条，立刻能在这里看到
        它哪天回来，不必自己心算。这里是**唯一**的倒计时落点，首页刻意不做
        （首页只渲染"今天"的氛围，见 composables/anniversarySchedule.js 的说明）。
      -->
      <Card class="upcoming-section">
        <CardHeader class="upcoming-heading">
          <div class="upcoming-heading-copy">
            <CardTitle class="upcoming-title">即将到来</CardTitle>
            <CardDescription class="upcoming-description">生日、公历纪念日、使用周年与农历纪念日</CardDescription>
          </div>
          <Badge as="span" variant="outline" class="readonly-badge" :class="{ 'is-off': !enabled }">
            {{ enabled ? upcoming.length + ' 项 · 按日期排序' : '氛围已关闭 · 仍会列出' }}
          </Badge>
        </CardHeader>
        <CardContent class="upcoming-content">
          <Empty v-if="!upcoming.length" class="upcoming-empty">
            <EmptyHeader class="upcoming-empty-header">
              <EmptyTitle class="upcoming-empty-title">还没有登记任何日子</EmptyTitle>
              <EmptyDescription class="upcoming-empty-description">添加生日、公历或农历纪念日、开始使用日期后，这里会显示下一次日期。</EmptyDescription>
            </EmptyHeader>
          </Empty>
          <ol v-else class="upcoming-list">
            <li
              v-for="row in upcoming"
              :key="row.id"
              class="upcoming-row"
              :class="{ 'is-today': row.isToday, 'is-off': row.status !== 'ok' }"
            >
              <span class="upcoming-name">
                {{ row.label }}
                <small v-if="row.recurrence">{{ row.recurrence }}</small>
              </span>
              <Badge as="span" variant="secondary" class="upcoming-kind">{{ upcomingSourceLabel(row.source) }}</Badge>
              <span class="upcoming-when">
                <b>{{ row.nextDateKey }}</b>
                <small>{{ row.relativeText }}</small>
                <small v-if="row.statusText" class="upcoming-warn">{{ row.statusText }}</small>
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>

      <div class="table-section">
        <h4>内置节日对照表<span class="readonly-badge">只读 · 供核对</span></h4>
        <p v-if="tableLoading" class="table-note">正在加载农历对照表…</p>
        <p v-else-if="tableError" class="table-note">{{ tableError }}</p>
        <div class="solar-chips">
          <span v-for="item in table.solar" :key="item.name" class="chip">{{ item.name }} <b>{{ item.date }}</b></span>
        </div>
        <div class="lunar-table-wrap">
          <table class="lunar-table">
            <thead>
              <tr>
                <th scope="col">年份</th>
                <th v-for="item in table.lunarFestivals" :key="item.key" scope="col">{{ item.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in table.lunar" :key="row.year">
                <!-- 年份这一列是**行表头**：它给整行做标签。用 th scope="row" 之后，
                     读屏在格子里横向移动时会念出「2026 春节 …」而不是一列孤立的日期。
                     视觉上不会变：共用规则已设 text-align: center，:first-child 规则本就
                     给了 font-weight: 700（见 <style> 里的注释）。 -->
                <th class="year" scope="row">{{ row.year }}</th>
                <td v-for="item in table.lunarFestivals" :key="item.key">{{ row.cells[item.key] || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="table-note">农历与节气日期来自内置静态日期表（2015–2050）；表格默认展示当前年前后各六年，供随时核对。</p>
      </div>

      <p class="saved-hint">✓ 修改即时自动保存</p>
    </div>
  </Modal>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.festive-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.festive-field-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
  cursor: pointer;
}
.switch-row input {
  accent-color: var(--primary);
  width: 18px;
  height: 18px;
}
.switch-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-13);
  font-weight: var(--fw-650);
}
.switch-row small,
.field-help {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-weight: var(--fw-400);
  line-height: 1.5;
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 5px;
}
.field label {
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  font-weight: var(--fw-700);
}
.field input {
  min-height: 40px;
  width: 100%;
}

.anni-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.anni-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.anni-head span {
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  font-weight: var(--fw-700);
}
.anni-hint {
  color: var(--ink-faint);
  font-size: var(--fs-11);
}
.add-btn {
  min-height: 40px;
  padding: 8px 12px;
  font-size: var(--fs-12-5);
}
.empty-line {
  padding: 10px 12px;
  color: var(--ink-faint);
  font-size: var(--fs-12);
  border: 1px dashed var(--border);
  border-radius: var(--radius-9);
  background: var(--bg);
}
.anni-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.anni-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr) auto;
  gap: 8px;
  align-items: center;
}
.anni-row input {
  min-width: 0;
  width: 100%;
  min-height: 40px;
}
.del-btn {
  min-height: 40px;
  padding: 0 11px;
  color: var(--danger);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--card);
}
.del-btn:hover {
  background: var(--danger-soft);
}
.anni-row input[aria-invalid="true"],
.lunar-row input[aria-invalid="true"] {
  border-color: color-mix(in srgb, var(--warning) 48%, var(--border));
}

/* 农历纪念日分区：与上面的公历纪念日同构，但多一列「闰月」与一行解析结果。 */
.lunar-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.lunar-hint {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.5;
}
.lunar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lunar-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) auto auto auto auto;
  gap: 8px;
  align-items: center;
}
.lunar-row input:not([type]),
.lunar-row select {
  min-width: 0;
  width: 100%;
  min-height: 40px;
}
.lunar-row select {
  width: auto;
}
.lunar-leap {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-soft);
  font-size: var(--fs-12);
  white-space: nowrap;
}
.lunar-leap input {
  accent-color: var(--primary);
  width: 16px;
  height: 16px;
}
/* 解析结果单独占一行：命中是公历日期 + 距今天数，不可用是明确的状态文案。 */
.lunar-resolve {
  grid-column: 1 / -1;
  color: var(--text);
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
}
.lunar-resolve.off {
  color: var(--ink-faint);
}

/* 「即将到来」清单：只读汇总，纯展示，没有可聚焦控件。
   语义层级刻意分三层 —— 名称 > 日期 > 相对天数/状态，避免一行里三段同等字重。 */
.upcoming-section {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--primary) 18%, var(--border));
  border-radius: var(--radius-12);
  background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 5%, var(--card)), var(--card) 68%);
}
.upcoming-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 14px 10px;
}
.upcoming-content {
  padding: 0 14px 14px;
}
.upcoming-heading-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.upcoming-title {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-13);
  font-weight: var(--fw-750);
}
.upcoming-description {
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.4;
}
.upcoming-heading > .readonly-badge {
  flex: 0 0 auto;
  white-space: nowrap;
}
.readonly-badge.is-off {
  color: var(--ink-faint);
  background: color-mix(in srgb, var(--ink-faint) 10%, var(--card));
}
.upcoming-empty {
  min-height: 0;
  gap: 0;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-10);
  background: var(--bg);
}
.upcoming-empty-header {
  gap: 4px;
}
.upcoming-empty-title {
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  font-weight: var(--fw-700);
}
.upcoming-empty-description {
  max-width: 36em;
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.5;
}
.upcoming-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.upcoming-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
}
.upcoming-row.is-today {
  border-left-color: var(--atmosphere-accent, var(--primary));
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
}
.upcoming-row.is-off {
  border-left-color: var(--warning);
}
.upcoming-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--text);
  font-size: var(--fs-13);
  font-weight: var(--fw-650);
  overflow-wrap: anywhere;
}
.upcoming-kind {
  flex: 0 0 auto;
  font-size: var(--fs-10);
}
.upcoming-when {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.upcoming-when b {
  color: var(--text);
  font-size: var(--fs-12-5);
  font-weight: var(--fw-700);
}
.upcoming-name small,
.upcoming-when small {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-weight: var(--fw-400);
}
/* 农历行"今年没有这个闰月 / 是小月没有三十"—— 状态必须看得见，
   不能因为倒计时还找得到下一次就当成没事发生。 */
.upcoming-when .upcoming-warn {
  max-width: 15em;
  color: var(--warning);
  text-align: right;
}

.table-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.table-section h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-13);
}
/* 「只读」徽标是琥珀色语义的「字 + 浅底」成对写法，底一起从 --card 混出来：
   只改字的话深色主题下 #fff2d8 仍是白药丸，亮琥珀字压上去约 1.7:1。 */
.readonly-badge {
  padding: 2px 7px;
  color: var(--warning);
  font-size: var(--fs-10);
  font-weight: var(--fw-700);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--warning) 10%, var(--card));
}
.solar-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 5px 9px;
  color: var(--ink-soft);
  font-size: var(--fs-12);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--card);
}
.chip b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.lunar-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-9);
  background: var(--card);
}
.lunar-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
}
.lunar-table th,
.lunar-table td {
  padding: 7px 8px;
  text-align: center;
  white-space: nowrap;
  border-top: 1px solid var(--border);
}
.lunar-table thead th {
  color: var(--ink-soft);
  font-size: var(--fs-11-5);
  font-weight: var(--fw-700);
  background: var(--bg);
}
.lunar-table th:first-child,
.lunar-table td:first-child {
  position: sticky;
  left: 0;
  background: var(--card);
  font-weight: var(--fw-700);
}
/* 首行去上边框要同时匹配 th 和 td：年份那一列现在是 <th scope="row">，
   只写 td 的话改完之后首行的年份格会重新长出上边框。 */
.lunar-table tbody tr:first-child th,
.lunar-table tbody tr:first-child td {
  border-top: 0;
}
.lunar-table .year {
  color: var(--primary);
}
.lunar-table thead th:first-child {
  /* 表头首列（年份）同样 sticky，避免横向滚动时错位 */
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg);
}
.table-note {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.5;
}
.table-note code {
  padding: 1px 5px;
  border-radius: var(--radius-5);
  background: var(--bg);
}
/* 未完成行使用警告色提示用户当前编辑尚未保存。 */
.anniversary-draft-hint,
.lunar-draft-hint {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--warning);
  font-size: var(--fs-11);
  line-height: 1.45;
}
.saved-hint {
  color: var(--success);
  font-size: var(--fs-12);
  text-align: right;
}

@media (max-width: 520px) {
  .upcoming-heading {
    flex-direction: column;
    align-items: stretch;
  }
  .upcoming-heading > .readonly-badge {
    align-self: flex-start;
  }
  .anni-row,
  .lunar-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-10);
    background: var(--bg);
  }
  .del-btn,
  .lunar-row select {
    width: 100%;
  }
  /* 窄屏上名称与日期挤在一行会互相换行成锯齿状，改为上下堆叠。 */
  .upcoming-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }
  .upcoming-name {
    grid-column: 1 / -1;
  }
  .upcoming-kind {
    grid-column: 1;
    justify-self: start;
  }
  .upcoming-when {
    grid-column: 2;
    align-items: flex-start;
  }
  .upcoming-when .upcoming-warn {
    max-width: none;
    text-align: left;
  }
}
</style>
