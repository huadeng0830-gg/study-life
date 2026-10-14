<script setup>
import { onMounted, reactive, ref } from 'vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusModerationQueue, decideCampusModeration, resolveCampusHelpDispute } from '../../services/campusLife.js'

const page = useCampusLifePage()
const reasons = reactive({})
const busyId = reactive({})
const pageIndex = ref(0)
const labels = { teacher: '教师资料', course: '课程资料', assignment: '授课安排', course_review: '课程评价', market_listing: '二手商品', help_task: '互助任务', help_dispute: '互助争议', shuttle_route: '校车线路', shuttle_exception: '特殊班次', shuttle_correction: '校车纠错', lost_found: '失物信息', event: '校园活动', guide: '校园指南', report: '用户举报' }
async function refresh(index = pageIndex.value) {
  pageIndex.value = Math.max(0, index)
  const result = await page.load(() => campusModerationQueue(pageIndex.value))
  if (result && !result.items?.length && pageIndex.value > 0) return refresh(pageIndex.value - 1)
  return result
}
onMounted(() => { void refresh() })

function titleOf(entry) {
  const item = entry.item || {}
  return item.title || item.name || item.detail || item.reason || (entry.type === 'course_review' ? '匿名课程评价' : '内容审核')
}
function detailOf(entry) {
  const item = entry.item || {}
  const details = [item.description, item.official_intro, item.body, item.note, item.reason, item.detail]
  if (item.course_name || item.teacher_name) details.push(`课程：${item.course_name || '未关联'} · 教师：${item.teacher_name || '未关联'}${item.term ? ` · 学期：${item.term}` : ''}`)
  if (item.department) details.push(`院系：${item.department}`)
  if (item.category) details.push(`分类：${item.category}`)
  if (item.listing_type) details.push(`类型：${item.listing_type} · 成色：${item.condition || '未填写'} · 价格：${item.price_cents === null ? '未填写' : item.price_cents === 0 ? '免费' : `¥${(item.price_cents / 100).toFixed(2)}`} · 交接区域：${item.meetup_area || '未填写'}`)
  if (item.task_type) details.push(`互助类型：${item.task_type} · 取件：${item.pickup_area || '未填写'} · 送达：${item.delivery_area || '未填写'} · 截止：${item.deadline || '未填写'}`)
  if (item.starts_at) details.push(`时间：${item.starts_at} – ${item.ends_at} · 地点：${item.location || '未填写'} · 组织方：${item.organizer || '未填写'} · 名额：${item.capacity ?? '不限'}`)
  if (item.route_id) details.push(`关联线路：${item.route_id} · 日期：${item.service_date || '未填写'} · 特殊安排：${item.exception_type || '纠错'}${item.departure_time ? ` · ${item.departure_time}` : ''}`)
  if (item.stops?.length) details.push(`站点：${item.stops.map((stop) => `${stop.direction === 'inbound' ? '返程' : '去程'} ${stop.position}. ${stop.name}`).join('；')}`)
  if (item.departures?.length) details.push(`常规班次：${item.departures.map((trip) => `${trip.direction === 'inbound' ? '返程' : '去程'} ${({ weekday: '工作日', weekend: '周末', holiday: '节假日' })[trip.service_day] || trip.service_day} ${trip.departure_time.slice(0,5)}${trip.stop_name ? `（${trip.stop_name}）` : ''}`).join('；')}`)
  if (item.approximate_location || item.occurred_at) details.push(`大致地点：${item.approximate_location || '未填写'} · 发生日期：${item.occurred_at || '未填写'}`)
  return details.filter(Boolean).join('\n') || '没有补充说明。'
}
function sourceOf(entry) { return entry.item?.source_url || entry.item?.source_info || '' }
function itemKey(entry) { return `${entry.type}:${entry.item?.id}` }
async function decide(entry, decision) {
  const key = itemKey(entry)
  const reason = String(reasons[key] || '').trim()
  if (['reject','dismiss'].includes(decision) && !reason) { page.error.value = '拒绝或标记举报不成立时请填写处理说明。'; return }
  busyId[key] = true
  const result = await page.act(() => decideCampusModeration(entry.type, entry.item.id, decision, reason, entry.item.revision), decision === 'approve' ? '审核已通过。' : '审核处理已保存。')
  busyId[key] = false
  if (result && !result.notificationSent) page.notice.value = '审核结果和审计记录已保存，但通知暂未发送。'
  if (result) { delete reasons[key]; await refresh() }
}
async function resolveDispute(entry, taskStatus) {
  const key = itemKey(entry)
  const reason = String(reasons[key] || '').trim()
  if (!reason) { page.error.value = '请填写争议裁定说明。'; return }
  busyId[key] = true
  const result = await page.act(() => resolveCampusHelpDispute(entry.item.id, taskStatus, reason), taskStatus === 'completed' ? '争议已裁定为完成。' : '争议已裁定为取消。')
  busyId[key] = false
  if (result) { delete reasons[key]; await refresh() }
}
</script>

<template>
  <CampusLifeLayout title="校园内容审核" description="只有平台管理员可以查看和处理队列。审核动作记录操作者、状态变化、理由与时间。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-moderation-heading"><div><h2>待审核内容与举报</h2><p>审核通过后内容才进入公开列表。学生提交的校车纠错不会直接覆盖线路数据。</p></div><button class="btn btn-ghost" type="button" :disabled="page.loading.value" @click="refresh">{{ page.loading.value ? '读取中…' : '刷新' }}</button></div>
        <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取审核队列…</CampusLoadingState>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <CampusEmptyState v-else-if="!page.data.value?.items?.length" title="待审核内容已处理完" description="新的投稿和举报会出现在这里。" action="" to="" />
        <div v-else class="campus-moderation-list"><article v-for="entry in page.data.value.items" :key="itemKey(entry)" class="campus-moderation-item">
          <div class="campus-life-meta"><span class="campus-life-tag">{{ labels[entry.type] || '校园内容' }}</span><span>{{ entry.item.school || '学校未填写' }}<template v-if="entry.item.campus"> · {{ entry.item.campus }}</template></span><span>{{ String(entry.item.created_at || '').slice(0,10) }}</span></div>
          <h3>{{ titleOf(entry) }}</h3><p class="campus-moderation-detail">{{ detailOf(entry) }}</p>
          <p v-if="entry.type === 'report'" class="campus-life-inline-state">举报对象：{{ entry.item.target_type }} · {{ entry.item.reason }}<br />举报说明：{{ entry.item.detail || '无补充说明' }}</p>
          <a v-if="sourceOf(entry)" :href="sourceOf(entry)" target="_blank" rel="noopener noreferrer">核对来源链接</a>
          <p v-if="entry.item.review_reason" class="campus-life-inline-state">此前审核说明：{{ entry.item.review_reason }}</p>
          <label class="campus-moderation-reason">{{ entry.type === 'help_dispute' ? '裁定说明' : '处理说明' }} <textarea v-model="reasons[itemKey(entry)]" maxlength="500" :placeholder="entry.type === 'report' ? '已处理 / 不成立的依据' : entry.type === 'help_dispute' ? '说明裁定依据；必须填写' : '拒绝时需要说明原因；通过时可以留空'" /></label>
          <div class="campus-life-actions"><template v-if="entry.type === 'report'"><button class="btn btn-primary" type="button" :disabled="busyId[itemKey(entry)]" @click="decide(entry, 'approve')">标记已处理</button><button class="btn btn-ghost" type="button" :disabled="busyId[itemKey(entry)]" @click="decide(entry, 'dismiss')">标记不成立</button></template><template v-else-if="entry.type === 'help_dispute'"><button class="btn btn-primary" type="button" :disabled="busyId[itemKey(entry)]" @click="resolveDispute(entry, 'completed')">裁定任务完成</button><button class="btn btn-ghost" type="button" :disabled="busyId[itemKey(entry)]" @click="resolveDispute(entry, 'cancelled')">裁定取消任务</button></template><template v-else><button class="btn btn-primary" type="button" :disabled="busyId[itemKey(entry)]" @click="decide(entry, 'approve')">通过</button><button class="btn btn-ghost" type="button" :disabled="busyId[itemKey(entry)]" @click="decide(entry, 'reject')">拒绝并说明</button></template></div>
        </article></div>
        <div class="campus-life-actions"><button class="btn btn-ghost" type="button" :disabled="page.loading.value || pageIndex === 0" @click="refresh(pageIndex - 1)">上一页</button><span>第 {{ pageIndex + 1 }} 页</span><button class="btn btn-ghost" type="button" :disabled="page.loading.value || !page.data.value?.hasMore" @click="refresh(pageIndex + 1)">下一页</button></div>
      </section>
      <p class="campus-life-inline-state">课程评价按课程体验审核，不因真实批评而删除。教师资料要求公开来源；账号邮箱验证不等同于学校官方身份认证。</p>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-moderation-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.campus-moderation-heading p{margin:5px 0 0;color:var(--muted)}.campus-moderation-list{display:grid;gap:12px}.campus-moderation-item{display:grid;gap:9px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-moderation-item h3{margin:0}.campus-moderation-detail{max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.campus-moderation-reason{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-moderation-reason textarea{min-height:58px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}@media(max-width:520px){.campus-moderation-heading{align-items:flex-start;flex-direction:column}}
</style>
