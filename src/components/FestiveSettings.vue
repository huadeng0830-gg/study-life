<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { festiveConfig } from '../composables/atmosphereStore.js'
import { builtInFestivalTable, normalizeFestiveConfig } from '../composables/festive.js'
import {
  LUNAR_ANNIVERSARY_HINT,
  LUNAR_DAY_OPTIONS,
  LUNAR_MONTH_OPTIONS,
} from '../composables/lunarAnniversaries.js'
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

// 生日祝福只按月-日触发（sl_festive_config.birthday 保持 MM-DD 语义不变）。
// 「我的生日」date 输入框需要完整年月日，故用独立 key 记住出生年份，
// 关闭面板再打开时年份也不会被重设成占位年份。
const BIRTHDAY_FULL_KEY = 'sl_festive_birthday_full'
const birthdayFull = useStoredRef(BIRTHDAY_FULL_KEY, '')
function readBirthdayFull() {
  const value = String(birthdayFull.value ?? '')
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
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
  birthdayInput.value = value
  writeBirthdayFull(value)
  commit()
}

// 每次修改立即归一化后写回 festiveConfig；useStoredRef 会自动持久化。
function commit() {
  festiveConfig.value = normalizeFestiveConfig({
    enabled: enabled.value,
    birthday: birthdayInput.value ? birthdayInput.value.slice(5) : '',
    installDate: installDateInput.value,
    anniversaries: anniversaries.value.map((row) => ({ date: row.date, label: row.label })),
  })
}

function addAnniversary() {
  anniversaries.value.push({
    id: `anni-${Date.now()}-${anniversarySeq++}`,
    date: '',
    label: '',
  })
}

function anniversaryNeedsFields(row) {
  return !row?.date || !String(row?.label ?? '').trim()
}

function setAnniversaryDate(id, value) {
  const row = anniversaries.value.find((item) => item.id === id)
  if (!row) return
  row.date = value ? value.slice(5) : ''
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
      <div class="field">
        <label for="festive-language">祝福语语言</label>
        <select id="festive-language" v-model="narrativeLang">
          <option v-for="item in NARRATIVE_LANGUAGES" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
        <small>只影响节日祝福语的文案；界面其它文字仍是中文，个人纪念日与使用周年照原样显示</small>
      </div>

      <div class="field">
        <label for="festive-birthday">我的生日（月-日）</label>
        <input
          id="festive-birthday"
          type="date"
          :value="birthdayInput"
          @change="setBirthday($event.target.value)"
        />
        <small>生日祝福按「月-日」触发；你选的出生年份会一并记住</small>
      </div>

      <div class="field">
        <label for="festive-install">开始使用日期</label>
        <input
          id="festive-install"
          type="date"
          :value="installDateInput"
          @change="installDateInput = $event.target.value; commit()"
        />
        <small>满一年后，每年当天会送上「使用周年」祝福</small>
      </div>

      <div class="anni-section">
        <div class="anni-head">
          <span>纪念日列表</span>
          <button type="button" class="btn add-btn" @click="addAnniversary">＋ 添加纪念日</button>
        </div>
        <small class="anni-hint">纪念日只保存「月-日」，每年同一天提醒（年份不参与）</small>
        <p v-if="!anniversaries.length" class="empty-line">还没有纪念日，点「添加纪念日」新建一条。</p>
        <div v-else class="anni-list">
          <div v-for="row in anniversaries" :key="row.id" class="anni-row">
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
              aria-label="纪念日名称"
              :aria-invalid="anniversaryNeedsFields(row)"
              :aria-describedby="anniversaryNeedsFields(row) ? `anniversary-hint-${row.id}` : undefined"
              @input="commit"
            />
            <button type="button" class="del-btn" :aria-label="`删除纪念日 ${row.label || ''}`" @click="removeAnniversary(row.id)">删除</button>
            <p v-if="anniversaryNeedsFields(row)" :id="`anniversary-hint-${row.id}`" class="anniversary-draft-hint">同时填写日期和名称后，这条纪念日才会保存。</p>
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
          </div>
        </div>
      </div>

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
.field small {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-weight: var(--fw-400);
}

.field {
  display: flex;
  flex-direction: column;
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
/* 「已自动保存」提示落在 Modal 的 var(--card) 上：原 #0d9463 浅色 3.87:1、深色 4.11:1。 */
.anniversary-draft-hint {
  grid-column:1/-1;
  margin:0;
  color:var(--warning);
  font-size:var(--fs-11);
  line-height:1.45}
.saved-hint {
  color: var(--success);
  font-size: var(--fs-12);
  text-align: right;
}

@media (max-width: 520px) {
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
}
</style>
