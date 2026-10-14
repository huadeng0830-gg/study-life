<script setup>
import { onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { useDomainCommands } from '../../composables/domain/commands.js'
import { cancelCampusEventRegistration, campusEvents, registerCampusEvent } from '../../services/campusLife.js'

const page = useCampusLifePage()
const domain = useDomainCommands()
const busyId = ref('')
const addedIds = ref(new Set())
async function refresh() { return page.load(async () => (await campusEvents()).events || []) }
onMounted(() => { void refresh() })

function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间待核实' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}
function timeInput(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
}
async function register(event) {
  busyId.value = event.id
  const result = await page.act(() => registerCampusEvent(event.id), '报名已确认。')
  busyId.value = ''
  if (result) await refresh()
}
async function cancel(event) {
  busyId.value = event.id
  const result = await page.act(() => cancelCampusEventRegistration(event.id), '已取消报名。')
  busyId.value = ''
  if (result) await refresh()
}
async function addToCalendar(event) {
  const start = timeInput(event.starts_at), end = timeInput(event.ends_at)
  if (!start || !end) return
  try {
    domain.createEvent({
      id: `campus-event:${event.id}`, title: event.title, date: start.date, time: start.time, endTime: end.date === start.date ? end.time : '',
      location: event.location || '', note: [event.description, event.organizer ? `组织方：${event.organizer}（未验证官方身份）` : '', event.signup_url ? `报名：${event.signup_url}` : ''].filter(Boolean).join('\n'),
      sourceText: event.source_url || '', sourceType: 'campus_event', sourceId: event.id,
    })
    addedIds.value = new Set([...addedIds.value, event.id])
    page.notice.value = '已添加到本机日程。'
  } catch (cause) { page.error.value = cause?.message || '未能添加到本机日程。' }
}
</script>

<template>
  <CampusLifeLayout title="校园活动与社团" description="活动投稿经审核后展示；报名状态与名额由服务端一致性控制。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-events-heading"><div><h2>近期活动</h2><p>组织方标识来自投稿信息，未经核验不会展示为学校官方活动。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=event">发布活动</RouterLink></div>
        <p v-if="page.loading.value && !page.data.value" class="campus-life-state" role="status">正在读取近期活动…</p>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <p v-else-if="!page.data.value?.length" class="campus-life-state">当前没有已审核且仍在报名时间内的活动。</p>
        <div v-else class="campus-life-grid">
          <article v-for="event in page.data.value" :key="event.id" class="campus-life-card">
            <div class="campus-life-meta"><span class="campus-life-tag">学生投稿 · 已审核</span><span v-if="event.campus">{{ event.campus }}</span><span>{{ dateLabel(event.starts_at) }}</span></div>
            <h3>{{ event.title }}</h3><p>{{ event.description || '活动详情待补充。' }}</p>
            <div class="campus-life-meta"><span v-if="event.location">地点：{{ event.location }}</span><span v-if="event.organizer">组织方：{{ event.organizer }}（未验证官方身份）</span><span v-if="event.capacity">报名 {{ event.registeredCount }} / {{ event.capacity }}</span></div>
            <a v-if="event.signup_url" :href="event.signup_url" target="_blank" rel="noopener noreferrer">查看外部报名方式</a><a v-if="event.source_url" :href="event.source_url" target="_blank" rel="noopener noreferrer">查看活动来源</a>
            <CampusContentActions target-type="event" :target-id="event.id" />
            <div class="campus-life-actions"><button v-if="event.isRegistered" class="btn btn-ghost" type="button" :disabled="busyId === event.id" @click="cancel(event)">取消报名</button><button v-else class="btn btn-primary" type="button" :disabled="busyId === event.id || (event.capacity && event.registeredCount >= event.capacity)" @click="register(event)">{{ event.capacity && event.registeredCount >= event.capacity ? '名额已满' : '确认报名' }}</button><button class="btn btn-ghost" type="button" :disabled="addedIds.has(event.id) || domain.events.value.some((item) => item.id === `campus-event:${event.id}`)" @click="addToCalendar(event)">{{ addedIds.has(event.id) || domain.events.value.some((item) => item.id === `campus-event:${event.id}`) ? '已在本机日程' : '添加到本机日程' }}</button></div>
          </article>
        </div>
      </section>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-events-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-events-heading p{margin:5px 0 0;color:var(--muted)}@media(max-width:520px){.campus-events-heading{align-items:flex-start;flex-direction:column}}
</style>
