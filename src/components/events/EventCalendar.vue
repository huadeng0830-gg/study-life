<script setup>
import { computed, nextTick, ref } from 'vue'
import { eventCalendarDays, shiftEventDate, shiftEventMonth } from '../../composables/events/eventPlanning.js'
import { formatAppDate } from '../../composables/timeContext.js'

const props = defineProps({
  month: { type: String, required: true },
  selectedDate: { type: String, default: '' },
  today: { type: String, required: true },
  events: { type: Array, default: () => [] },
})
const emit = defineEmits(['select', 'month'])
const grid = ref(null)
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const days = computed(() => eventCalendarDays(props.month, props.events))
const monthLabel = computed(() => `${Number(props.month.slice(0, 4))} 年 ${Number(props.month.slice(5))} 月`)
const tabDate = computed(() => days.value.some((day) => day.date === props.selectedDate) ? props.selectedDate : days.value.find((day) => day.inMonth)?.date)
const monthCount = computed(() => props.events.filter((event) => event.date?.startsWith(props.month)).length)

function select(date) {
  if (!date.startsWith(props.month)) emit('month', date.slice(0, 7))
  emit('select', date)
}

async function navigate(event, date) {
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  let target = ''
  if (event.key in offsets) target = shiftEventDate(date, offsets[event.key])
  else if (event.key === 'Home' || event.key === 'End') {
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    target = shiftEventDate(date, event.key === 'Home' ? -weekday : 6 - weekday)
  } else return
  event.preventDefault()
  select(target)
  await nextTick()
  grid.value?.querySelector(`[data-date="${target}"]`)?.focus()
}

function moveMonth(amount) { emit('month', shiftEventMonth(props.month, amount)) }
function resetToday() { emit('month', props.today.slice(0, 7)); emit('select', props.today) }
</script>

<template>
  <section class="event-calendar panel" aria-label="日程月历">
    <header class="calendar-header">
      <div><h2>{{ monthLabel }}</h2><p>本月 {{ monthCount }} 条日程</p></div>
      <div class="calendar-navigation">
        <button type="button" aria-label="上个月" @click="moveMonth(-1)">‹</button>
        <button type="button" class="calendar-today" @click="resetToday">今天</button>
        <button type="button" aria-label="下个月" @click="moveMonth(1)">›</button>
      </div>
    </header>
    <label class="calendar-jump">跳转月份 <input type="month" :value="month" min="0100-01" max="9998-12" @change="$emit('month', $event.target.value)" /></label>
    <div class="calendar-weekdays" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
    <div ref="grid" class="calendar-days" role="group" aria-label="选择日期，可用方向键移动">
      <button
        v-for="day in days"
        :key="day.date"
        type="button"
        :data-date="day.date"
        :tabindex="day.date === tabDate ? 0 : -1"
        :aria-label="`${formatAppDate(day.date)}，${day.events.length ? `${day.events.length} 条日程` : '没有日程'}`"
        :aria-pressed="day.date === selectedDate"
        :aria-current="day.date === today ? 'date' : undefined"
        :class="['calendar-day', { outside: !day.inMonth, selected: day.date === selectedDate, today: day.date === today }]"
        @click="select(day.date)"
        @keydown="navigate($event, day.date)"
      >
        <span class="calendar-day-number">{{ day.day }}</span>
        <span v-if="day.events.length" class="calendar-event-title" aria-hidden="true">{{ day.events[0].title }}</span>
        <span v-if="day.events.length" class="calendar-event-count" aria-hidden="true"><i></i>{{ day.events.length }} 条</span>
      </button>
    </div>
    <p class="calendar-hint">点选日期查看安排，也可以直接新增当天日程。</p>
  </section>
</template>

<style scoped>
.event-calendar { min-width:0; padding:20px; align-self:start; }
.calendar-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.calendar-header h2 { margin:0; color:var(--text); font-size:var(--fs-17); }
.calendar-header p { margin:5px 0 0; color:var(--muted); font-size:var(--fs-12); }
.calendar-navigation { display:flex; gap:5px; }
.calendar-navigation button { min-width:40px; min-height:40px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg); color:var(--ink-soft); font-size:var(--fs-21); cursor:pointer; }
.calendar-navigation .calendar-today { padding:0 10px; font-size:var(--fs-12); font-weight:var(--fw-700); }
.calendar-jump { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin:14px 0; color:var(--muted); font-size:var(--fs-11); }
.calendar-jump input { min-width:0; max-width:160px; min-height:34px; padding:5px 8px; border:1px solid var(--border); border-radius:var(--radius-6); background:var(--bg); color:var(--text); font:inherit; }
.calendar-weekdays, .calendar-days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:4px; }
.calendar-weekdays { padding-bottom:8px; color:var(--muted); text-align:center; font-size:var(--fs-11); }
.calendar-day { display:flex; flex-direction:column; align-items:flex-start; gap:6px; min-width:0; min-height:82px; padding:8px; border:1px solid transparent; border-radius:var(--radius-8); background:var(--bg-tint); color:var(--ink-soft); text-align:left; cursor:pointer; }
.calendar-day:hover { border-color:var(--primary); }
.calendar-day.outside { background:var(--bg); color:var(--muted); }
.calendar-day.selected { border-color:var(--primary); background:var(--primary-soft); }
.calendar-day-number { display:grid; place-items:center; width:24px; height:24px; font-size:var(--fs-12); font-weight:var(--fw-700); }
.calendar-day.today .calendar-day-number { border-radius:var(--radius-pill); background:var(--primary); color:var(--on-primary); }
.calendar-event-title { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-10); }
.calendar-event-count { display:flex; align-items:center; gap:4px; color:var(--primary); font-size:var(--fs-10); }
.calendar-event-count i { width:4px; height:4px; border-radius:50%; background:currentColor; }
.calendar-hint { margin:14px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
@media (max-width:520px) {
  .event-calendar { padding:14px; }
  .calendar-days, .calendar-weekdays { gap:3px; }
  .calendar-day { min-height:58px; gap:4px; padding:5px 3px; align-items:center; }
  .calendar-event-title { display:none; }
  .calendar-event-count { font-size:var(--fs-10); }
}
</style>
