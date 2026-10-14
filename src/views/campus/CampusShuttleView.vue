<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusShuttles, submitCampusShuttleCorrection, submitCampusShuttleException } from '../../services/campusLife.js'

const page = useCampusLifePage()
function localDate(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const selectedDate = ref(localDate())
const serviceDay = ref('')
const correctionRoute = ref('')
const correction = ref({ detail: '', sourceUrl: '' })
const exceptionRoute = ref('')
const exception = ref({ serviceDate: localDate(), exceptionType: 'suspended', departureTime: '', direction: 'outbound', note: '', sourceUrl: '' })
const busy = ref(false)
const now = ref(Date.now())
let clockTimer = 0

async function refresh() { return page.load(() => campusShuttles()) }
onMounted(() => { void refresh(); clockTimer = window.setInterval(() => { now.value = Date.now() }, 60000) })
onUnmounted(() => window.clearInterval(clockTimer))

const routes = computed(() => page.data.value?.routes || [])
function applicable(route) { return Boolean(selectedDate.value) && (!route.effective_from || selectedDate.value >= route.effective_from) && (!route.effective_to || selectedDate.value <= route.effective_to) }
function dayForDate() {
  if (serviceDay.value) return serviceDay.value
  const weekday = new Date(`${selectedDate.value}T12:00:00`).getDay()
  return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday'
}
function dayLabel(day) { return ({ weekday: '工作日', weekend: '周末', holiday: '节假日' })[day] || day }
function directionLabel(direction) { return direction === 'inbound' ? '返程' : '去程' }
function tripLabel(minutes) {
  if (minutes < 1) return '即将发车'
  const hours = Math.floor(minutes / 60)
  return `${hours ? `${hours} 小时 ` : ''}${minutes % 60} 分钟后`
}
// 模板里每条线路每个方向都会用到 stops / scheduled / nextTrip，原来每次调用都要
// 重扫一遍班次与特殊安排（nextTrip 一处就调了三次）。这里按 selectedDate / serviceDay /
// now 一次性算好，模板只做查表；now 每分钟跳动一次，改日期或改运行日历时自动重算。
const schedule = computed(() => {
  const day = dayForDate()
  const today = localDate(new Date(now.value))
  const departures = page.data.value?.departures || []
  const exceptions = page.data.value?.exceptions || []
  const stops = page.data.value?.stops || []
  const rows = new Map()
  for (const route of routes.value) {
    for (const direction of ['outbound', 'inbound']) {
      let values = departures
        .filter((item) => item.route_id === route.id && item.direction === direction && item.service_day === day)
        .map((item) => ({ id: item.id, time: String(item.departure_time).slice(0, 5), stop: item.stop_name, source: '常规班次' }))
      const overrides = exceptions.filter((item) => item.route_id === route.id && item.direction === direction && item.service_date === selectedDate.value)
      if (overrides.some((item) => item.exception_type === 'suspended' && !item.departure_time)) values = []
      for (const item of overrides) {
        const time = item.departure_time ? String(item.departure_time).slice(0, 5) : ''
        if (item.exception_type === 'suspended' && time) values = values.filter((row) => row.time !== time)
        if (['additional', 'changed'].includes(item.exception_type) && time) {
          values = values.concat({ id: item.id, time, stop: '', source: item.exception_type === 'additional' ? '特殊加班车' : '经审核的调整班次', note: item.note })
        }
      }
      values.sort((left, right) => left.time.localeCompare(right.time))
      const upcoming = applicable(route)
        ? values.find((item) => selectedDate.value > today || Date.parse(`${selectedDate.value}T${item.time}:00`) >= now.value)
        : null
      const departureEpoch = upcoming ? new Date(`${selectedDate.value}T${upcoming.time}:00`).getTime() : NaN
      const minutes = Number.isFinite(departureEpoch) ? Math.max(0, Math.ceil((departureEpoch - now.value) / 60000)) : null
      rows.set(`${route.id}:${direction}`, {
        stops: stops.filter((item) => item.route_id === route.id && item.direction === direction).sort((left, right) => left.position - right.position),
        scheduled: values,
        next: upcoming ? { ...upcoming, minutes, label: tripLabel(minutes) } : null,
      })
    }
  }
  return rows
})
function tripFor(route, direction) { return schedule.value.get(`${route.id}:${direction}`) || { stops: [], scheduled: [], next: null } }
function stops(route, direction) { return tripFor(route, direction).stops }
function scheduled(route, direction) { return tripFor(route, direction).scheduled }
function nextTrip(route, direction) { return tripFor(route, direction).next }
function exceptionsFor(route) { return (page.data.value?.exceptions || []).filter((item) => item.route_id === route.id && item.service_date === selectedDate.value) }
function exceptionLabel(item) { return ({ suspended: '停运覆盖', additional: '加班车', changed: '调整班次' })[item.exception_type] || '特殊安排' }

async function submitCorrection(route) {
  busy.value = true
  const result = await page.act(() => submitCampusShuttleCorrection(route.id, correction.value.detail, correction.value.sourceUrl), '纠错内容已送审，不会直接覆盖现有时刻表。')
  busy.value = false
  if (result) { correctionRoute.value = ''; correction.value = { detail: '', sourceUrl: '' } }
}
async function submitException(route) {
  busy.value = true
  const result = await page.act(() => submitCampusShuttleException({ routeId: route.id, ...exception.value }), '特殊日期班次已提交审核。')
  busy.value = false
  if (result) exceptionRoute.value = ''
}
</script>

<template>
  <CampusLifeLayout title="校车与校园出行" description="选好出行日期，查看校车线路、计划班次与特殊安排。">
    <template #default>
      <section class="campus-life-panel campus-shuttle-filter">
        <label>出行日期 <input v-model="selectedDate" type="date" /></label>
        <label>运行日历 <select v-model="serviceDay"><option value="">按周末 / 工作日推算</option><option value="weekday">工作日</option><option value="weekend">周末</option><option value="holiday">节假日</option></select></label>
        <p>当前使用：{{ dayLabel(dayForDate()) }}计划班次。法定节假日、调休工作日请手动选择，直到官方日历来源接入。</p>
      </section>
      <section class="campus-life-panel">
        <div class="campus-shuttle-heading"><div><h2>线路与班次</h2><p>更新时间和来源随线路展示；过期或日期不适用时不会计算“下一班”。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=shuttle">提交线路</RouterLink></div>
        <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取校车时刻表…</CampusLoadingState>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <CampusEmptyState v-else-if="!routes.length" title="还没有已核实的校车线路" description="有学校或运营方公开时刻表时，可以提交线路供同校同学查阅。" action="提交校车线路" to="/campus/publish?kind=shuttle" />
        <div v-else class="campus-shuttle-routes">
          <article v-for="route in routes" :key="route.id" class="campus-shuttle-route campus-life-card">
            <div class="campus-life-meta"><span class="campus-life-tag">计划班次</span><span v-if="route.campus">{{ route.campus }}</span><span>更新时间：{{ route.updated_at.slice(0, 10) }}</span></div>
            <h3>{{ route.name }}</h3><a :href="route.source_url" target="_blank" rel="noopener noreferrer">查看公开时刻表来源</a>
            <p v-if="!applicable(route)" class="campus-life-inline-state">该日期超出线路生效期，时刻表待核实。</p>
            <div v-else class="campus-shuttle-directions">
              <section v-for="direction in ['outbound','inbound']" :key="direction" class="campus-shuttle-direction">
                <div><h4>{{ directionLabel(direction) }}</h4><p>经停：{{ stops(route, direction).map((item) => item.name).join(' → ') || '站点待核实' }}</p></div>
                <div v-if="nextTrip(route, direction)" class="campus-shuttle-next"><strong>下一班计划：{{ nextTrip(route, direction).time }}</strong><span>{{ nextTrip(route, direction).label }} · {{ nextTrip(route, direction).stop || stops(route, direction)[0]?.name || '上车站点待核实' }}</span></div>
                <div class="campus-shuttle-times"><span v-for="departure in scheduled(route, direction)" :key="departure.id" class="campus-shuttle-time"><b>{{ departure.time }}</b><small>{{ departure.stop || '站点待核实' }} · {{ departure.source }}</small></span><span v-if="!scheduled(route, direction).length" class="campus-life-state">该日期没有已核实的{{ directionLabel(direction) }}班次。</span></div>
              </section>
            </div>
            <div v-if="exceptionsFor(route).length" class="campus-shuttle-exceptions"><b>该日期的特殊安排</b><p v-for="item in exceptionsFor(route)" :key="item.id">{{ exceptionLabel(item) }}<template v-if="item.departure_time"> · {{ item.departure_time.slice(0,5) }}</template><template v-if="item.note"> · {{ item.note }}</template></p></div>
            <CampusContentActions target-type="shuttle_route" :target-id="route.id" />
            <div class="campus-life-actions"><button class="btn btn-ghost" type="button" @click="correctionRoute = correctionRoute === route.id ? '' : route.id">提交纠错</button><button class="btn btn-ghost" type="button" @click="exceptionRoute = exceptionRoute === route.id ? '' : route.id">提交特殊日期安排</button></div>
            <form v-if="correctionRoute === route.id" class="campus-shuttle-form" @submit.prevent="submitCorrection(route)"><label>纠错内容<textarea v-model="correction.detail" maxlength="1500" required /></label><label>来源 HTTPS 链接<input v-model="correction.sourceUrl" type="url" maxlength="500" /></label><button class="btn btn-primary" type="submit" :disabled="busy">送审纠错</button></form>
            <form v-if="exceptionRoute === route.id" class="campus-shuttle-form" @submit.prevent="submitException(route)"><label>适用日期<input v-model="exception.serviceDate" type="date" required /></label><label>类型<select v-model="exception.exceptionType"><option value="suspended">临时停运</option><option value="additional">加班车</option><option value="changed">调整班次</option></select></label><label>方向<select v-model="exception.direction"><option value="outbound">去程</option><option value="inbound">返程</option></select></label><label v-if="exception.exceptionType !== 'suspended'">发车时间<input v-model="exception.departureTime" type="time" required /></label><label>说明<input v-model="exception.note" maxlength="300" /></label><label>官方来源 HTTPS 链接<input v-model="exception.sourceUrl" type="url" maxlength="500" required /></label><button class="btn btn-primary" type="submit" :disabled="busy">送审特殊安排</button></form>
          </article>
        </div>
      </section>
      <p class="campus-life-inline-state">班次来自用户提交的公开来源并经平台审核。日期规则可能不完整，请在特殊时期核对来源链接；浏览器没有获得推送权限时不发送提醒。</p>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-shuttle-filter{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-items:end}.campus-shuttle-filter label{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-shuttle-filter input,.campus-shuttle-filter select{padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text)}.campus-shuttle-filter p{grid-column:1/-1;margin:0;color:var(--muted);font-size:12px}.campus-shuttle-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.campus-shuttle-heading p{margin:5px 0 0;color:var(--muted)}.campus-shuttle-routes{display:grid;gap:12px}.campus-shuttle-route>a{font-size:12px}.campus-shuttle-directions{display:grid;gap:10px}.campus-shuttle-direction{display:grid;gap:8px;padding:12px;border-radius:var(--radius-12);background:var(--bg-tint)}.campus-shuttle-direction h4{margin:0}.campus-shuttle-direction p{margin:4px 0;color:var(--muted)}.campus-shuttle-next{display:grid;gap:3px}.campus-shuttle-next span{color:var(--primary);font-size:13px}.campus-shuttle-times{display:flex;flex-wrap:wrap;gap:7px}.campus-shuttle-time{display:grid;gap:3px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card)}.campus-shuttle-time small{color:var(--muted);font-size:11px}.campus-shuttle-exceptions{padding:10px;border-left:3px solid var(--warning);background:var(--bg-tint)}.campus-shuttle-exceptions p{margin:4px 0}.campus-shuttle-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px;padding:12px;border-radius:var(--radius-12);background:var(--bg-tint)}.campus-shuttle-form label{display:grid;gap:4px;color:var(--muted);font-size:12px}.campus-shuttle-form textarea,.campus-shuttle-form input,.campus-shuttle-form select{padding:8px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text)}.campus-shuttle-form textarea{min-height:70px;resize:vertical}@media(max-width:520px){.campus-shuttle-heading{align-items:flex-start;flex-direction:column}}
</style>
