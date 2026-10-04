<script setup>
// 日历导出：把课程表、日程与重要日期导出成 .ics，导入系统日历。
//
// 【定位必须说清】这是**导出快照文件**，不是"日历订阅"。订阅需要一个 URL
// （webcal:// 或 https），本项目是 Local-first、没有服务端，所以不存在订阅源。
// 导入一次之后它就是一个静态事件，后续课表调整需要重新导出。
//
// 入口放在数据管理页而不是课表页顶部：导出是低频动作，不该在"今天要做什么"
// 的主线里抢位置，而这里已经是所有低频出口的收敛点。
import { computed, ref } from 'vue'
import { buildVCalendar, downloadIcs } from '../../composables/icalExport.js'
import { semester } from '../../composables/store/schedule.js'
import { useStoredRef } from '../../composables/store/core.js'
import { settingsPolicy } from '../../composables/settingsPolicy.js'

// 直接注册存储 ref：与 icalExport.js / reminderScheduler.js 同一套用法，
// 不必为了拿数据把 domain 整个拉进来（会连带 clock 等一堆依赖）。
const courses = useStoredRef('sl_courses', [])
const events = useStoredRef('sl_events', [])
const milestones = useStoredRef('sl_exams', [])

const VARIANTS = [
  { key: 'schedule', label: '课程表', hint: '按学期重复，可被系统日历重复提醒' },
  { key: 'events', label: '日程', hint: '带 VALARM，由系统在 App 关闭时也能提醒' },
  { key: 'milestones', label: '重要日期', hint: '考试、节点等，按全天事件导出' },
]

const selected = ref(new Set(VARIANTS.map((item) => item.key)))
const busy = ref(false)
const message = ref('')

const canExport = computed(() => selected.value.size > 0)

function toggle(key) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

function fileName() {
  const parts = VARIANTS.filter((item) => selected.value.has(item.key)).map((item) => item.label)
  return `学习生活台-${parts.join('-')}-${(semester.value?.start || '').slice(0, 7) || '导出'}.ics`
}

function exportCalendar() {
  if (!canExport.value || busy.value) return
  busy.value = true
  message.value = ''
  try {
    const text = buildVCalendar({
      courses: courses.value || [],
      events: events.value || [],
      milestones: milestones.value || [],
      semesterStart: semester.value?.start || '',
      timezone: settingsPolicy.value?.timezone || 'local',
      variants: selected.value,
    })
    const count = (text.match(/BEGIN:VEVENT/g) || []).length
    if (!count) {
      message.value = '所选范围内还没有可导出的内容。'
      return
    }
    downloadIcs(text, fileName())
    message.value = `已导出 ${count} 个事件。首次打开 .ics 文件时，系统会询问要添加到哪个日历。`
  } catch (error) {
    message.value = `导出失败：${error?.message || '未知错误'}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section id="calendar-export" class="data-section">
    <div class="section-icon calendar">▤</div>
    <div class="section-copy calendar-copy">
      <div class="calendar-head">
        <div>
          <h4>导出到系统日历</h4>
          <p>导出标准 <code>.ics</code> 文件，可在手机或电脑上导入 Apple / Google / Outlook 日历。</p>
        </div>
        <button class="btn" :disabled="!canExport || busy" @click="exportCalendar">
          {{ busy ? '正在导出…' : '导出 .ics' }}
        </button>
      </div>
      <div class="calendar-options">
        <label v-for="item in VARIANTS" :key="item.key" class="calendar-option">
          <input type="checkbox" :checked="selected.has(item.key)" @change="toggle(item.key)" />
          <span><b>{{ item.label }}</b><small>{{ item.hint }}</small></span>
        </label>
      </div>
      <p class="calendar-note"><small>建议把「课程表」和「日程」导进<strong>不同日历</strong>：混在一个日历里，系统通知会被课程提醒淹没。导出的是快照，之后调整课表需要重新导出一次；课表里标记为调休停课的日期会以 EXDATE 排除。</small></p>
      <p v-if="message" class="calendar-message" role="status">{{ message }}</p>
    </div>
  </section>
</template>

<style scoped>
.section-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:var(--radius-10);
  flex:0 0 38px;
  place-items:center;
  font-size:var(--fs-20);
  font-weight:var(--fw-800);
  display:grid}
.section-icon.calendar {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 12%, var(--card))}
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.calendar-head {
  width:100%;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  display:flex}
.calendar-head h4 {
  margin:0;
  font-size:var(--fs-15);
  font-weight:var(--fw-700)}
.calendar-head p {
  margin:3px 0 0;
  font-size:var(--fs-12);
  color:var(--text-muted)}
.calendar-head code {
  padding:1px 4px;
  border-radius:var(--radius-6);
  background:var(--surface-soft);
  font-size:var(--fs-11)}
.calendar-options {
  width:100%;
  gap:8px;
  display:flex;
  flex-wrap:wrap}
.calendar-option {
  align-items:flex-start;
  gap:6px;
  padding:7px 9px;
  border:1px solid var(--border);
  border-radius:var(--radius-8);
  cursor:pointer;
  display:flex}
.calendar-option span {
  flex-direction:column;
  align-items:flex-start;
  gap:2px;
  display:flex}
.calendar-option b {
  font-size:var(--fs-12);
  font-weight:var(--fw-600)}
.calendar-option small {
  color:var(--text-muted);
  font-size:var(--fs-11)}
.calendar-note {
  margin:0;
  font-size:var(--fs-11);
  line-height:1.6;
  color:var(--text-muted)}
.calendar-message {
  margin:0;
  padding:7px 9px;
  border-radius:var(--radius-8);
  background:var(--primary-soft);
  font-size:var(--fs-12);
  line-height:1.5}
</style>