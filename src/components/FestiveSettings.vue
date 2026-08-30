<script setup>
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { festiveConfig } from '../composables/atmosphereStore.js'
import { builtInFestivalTable, normalizeFestiveConfig } from '../composables/festive.js'
import { useStoredRef } from '../composables/store/index.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

// 内置节日对照表（只读，纯函数生成，内容与 festive.js 内置常量一致）
const table = builtInFestivalTable()

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
  return /^\d{2}-\d{2}$/.test(String(cfg?.birthday ?? '')) ? `${new Date().getFullYear()}-${cfg.birthday}` : ''
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

watch(
  () => props.open,
  (open) => { if (open) syncFromConfig() }
)
</script>

<template>
  <Modal :open="open" title="节日与纪念日设置" medium @close="emit('close')">
    <div class="festive-settings">
      <label class="switch-row">
        <input v-model="enabled" type="checkbox" @change="commit" />
        <span>启用节日氛围<small>首页的祝福语与彩带 / 雪花 / 灯笼装饰</small></span>
      </label>

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
              @change="setAnniversaryDate(row.id, $event.target.value)"
            />
            <input
              v-model="row.label"
              maxlength="30"
              placeholder="名称，如：在一起"
              aria-label="纪念日名称"
              @input="commit"
            />
            <button type="button" class="del-btn" :aria-label="`删除纪念日 ${row.label || ''}`" @click="removeAnniversary(row.id)">删除</button>
          </div>
        </div>
      </div>

      <div class="table-section">
        <h4>内置节日对照表<span class="readonly-badge">只读 · 供核对</span></h4>
        <div class="solar-chips">
          <span v-for="item in table.solar" :key="item.name" class="chip">{{ item.name }} <b>{{ item.date }}</b></span>
        </div>
        <div class="lunar-table-wrap">
          <table class="lunar-table">
            <thead>
              <tr>
                <th>年份</th>
                <th v-for="item in table.lunarFestivals" :key="item.key">{{ item.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in table.lunar" :key="row.year">
                <td class="year">{{ row.year }}</td>
                <td v-for="item in table.lunarFestivals" :key="item.key">{{ row.cells[item.key] || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="table-note">农历与节气日期由本地历法计算生成；表格默认展示当前年前后各六年，供随时核对。</p>
      </div>

      <p class="saved-hint">✓ 修改即时自动保存</p>
    </div>
  </Modal>
</template>

<style scoped>
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
  border-radius: 10px;
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
  font-size: 13px;
  font-weight: 650;
}
.switch-row small,
.field small {
  color: var(--ink-faint);
  font-size: 11px;
  font-weight: 400;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field label {
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 700;
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
  font-size: 12.5px;
  font-weight: 700;
}
.anni-hint {
  color: var(--ink-faint);
  font-size: 11px;
}
.add-btn {
  min-height: 40px;
  padding: 8px 12px;
  font-size: 12.5px;
}
.empty-line {
  padding: 10px 12px;
  color: var(--ink-faint);
  font-size: 12px;
  border: 1px dashed var(--border);
  border-radius: 9px;
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
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
}
.del-btn:hover {
  background: #fff2f0;
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
  font-size: 13px;
}
.readonly-badge {
  padding: 2px 7px;
  color: #8a6845;
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  background: #fff2d8;
}
.solar-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 5px 9px;
  color: var(--ink-soft);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
}
.chip b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.lunar-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
}
.lunar-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
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
  font-size: 11.5px;
  font-weight: 700;
  background: var(--bg);
}
.lunar-table th:first-child,
.lunar-table td:first-child {
  position: sticky;
  left: 0;
  background: var(--card);
  font-weight: 700;
}
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
  font-size: 11px;
  line-height: 1.5;
}
.table-note code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--bg);
}
.saved-hint {
  color: #0d9463;
  font-size: 12px;
  text-align: right;
}

@media (max-width: 520px) {
  .anni-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
  }
  .del-btn {
    width: 100%;
  }
}
</style>
