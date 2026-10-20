<script setup>
import { onMounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { campusWeekdayDateTimeLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { useCampusBusyKeys } from '../../composables/campusRequest.js'
import { useDomainCommands } from '../../composables/domain/commands.js'
import { cancelCampusEventRegistration, campusEvents, registerCampusEvent } from '../../services/campusLife.js'
import { dateText, timeText } from '../../utils/formatters.js'

const page = useCampusLifePage()
const domain = useDomainCommands()
const actions = useCampusBusyKeys()
const addedIds = ref(new Set())
watch(() => accountUser.value?.id, () => { addedIds.value = new Set() }, { flush: 'sync' })
async function refresh() { return page.load(async () => (await campusEvents()).events || [], null, { cacheKey: ['events'] }) }
onMounted(() => { void refresh() })

function startLabel(value) { return campusWeekdayDateTimeLabel(value, '时间待核实') }
function timeInput(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return { date: dateText(date), time: timeText(date) }
}
async function register(event) {
  await actions.run(event.id, async () => {
    const ok = await page.act(() => registerCampusEvent(event.id), '报名已确认。')
    if (ok) await refresh()
  })
}
async function cancel(event) {
  await actions.run(event.id, async () => {
    const ok = await page.act(() => cancelCampusEventRegistration(event.id), '已取消报名。')
    if (ok) await refresh()
  })
}
async function addToCalendar(event) {
  const start = timeInput(event.starts_at)
  const end = timeInput(event.ends_at)
  // 原来这里是直接 return：活动缺时间时按钮点了没有任何反馈，
  // 用户只会以为按钮坏了。日程里要的是开始和结束两点，缺一就无法建条目。
  if (!start || !end) { page.reportFailure('这条活动缺少完整的开始或结束时间，暂时无法加入日程。'); return }
  const ok = await page.act(() => domain.createEvent({
    id: `campus-event:${event.id}`, title: event.title, date: start.date, time: start.time, endTime: end.date === start.date ? end.time : '',
    location: event.location || '', note: [event.description, event.organizer ? `组织方：${event.organizer}（未验证官方身份）` : '', event.signup_url ? `报名：${event.signup_url}` : ''].filter(Boolean).join('\n'),
    sourceText: event.source_url || '', sourceType: 'campus_event', sourceId: event.id,
  }), '已添加到本机日程。')
  if (ok) addedIds.value = new Set([...addedIds.value, event.id])
}
</script>

<template>
  <CampusLifeLayout title="校园活动与社团" description="发现同校活动，报名参加，或把感兴趣的活动加入日程。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-events-heading"><div><h2>近期活动</h2><p>组织方标识来自投稿信息，未经核验不会展示为学校官方活动。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=event">发布活动</RouterLink></div>
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!page.data.value?.length"
          loading-text="正在读取近期活动…"
          empty-title="近期还没有校园活动"
          empty-description="分享社团或校园活动，邀请同学一起参加。"
          empty-action="发布活动"
          empty-to="/campus/publish?kind=event"
          @retry="refresh()"
        >
          <div class="campus-life-grid">
            <article v-for="event in page.data.value" :key="event.id" class="campus-life-card">
              <div class="campus-life-meta"><span class="campus-life-tag">学生投稿 · 已审核</span><span v-if="event.campus">{{ event.campus }}</span><span>{{ startLabel(event.starts_at) }}</span></div>
              <h3>{{ event.title }}</h3><p>{{ event.description || '活动详情待补充。' }}</p>
              <div class="campus-life-meta"><span v-if="event.location">地点：{{ event.location }}</span><span v-if="event.organizer">组织方：{{ event.organizer }}（未验证官方身份）</span><span v-if="event.capacity">报名 {{ event.registeredCount }} / {{ event.capacity }}</span></div>
              <a v-if="event.signup_url" :href="event.signup_url" target="_blank" rel="noopener noreferrer">查看外部报名方式</a><a v-if="event.source_url" :href="event.source_url" target="_blank" rel="noopener noreferrer">查看活动来源</a>
              <CampusContentActions target-type="event" :target-id="event.id" />
              <div class="campus-life-actions"><button v-if="event.isRegistered" class="btn btn-ghost" type="button" :disabled="actions.busy(event.id)" @click="cancel(event)">取消报名</button><button v-else class="btn btn-primary" type="button" :disabled="actions.busy(event.id) || (event.capacity && event.registeredCount >= event.capacity)" @click="register(event)">{{ event.capacity && event.registeredCount >= event.capacity ? '名额已满' : '确认报名' }}</button><button class="btn btn-ghost" type="button" :disabled="addedIds.has(event.id) || domain.events.value.some((item) => item.id === `campus-event:${event.id}`)" @click="addToCalendar(event)">{{ addedIds.has(event.id) || domain.events.value.some((item) => item.id === `campus-event:${event.id}`) ? '已在本机日程' : '添加到本机日程' }}</button></div>
            </article>
          </div>
        </CampusStateBlock>
      </section>
      <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-events-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-events-heading p{margin:5px 0 0;color:var(--muted)}@media(max-width:520px){.campus-events-heading{align-items:flex-start;flex-direction:column}}
</style>
