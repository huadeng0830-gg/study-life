<script setup>
import { computed, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { campusContentLabels, campusContentTitle, campusReportReasons } from '../../composables/campusContentModel.js'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Field, FieldLabel } from '../ui/field'
import Modal from '../Modal.vue'
const props = defineProps({ entry: { type: Object, required: true }, busy: Boolean })
const emit = defineEmits(['decide'])
const reason = ref('')
const error = ref('')
const confirmRemove = ref(false)
const isReport = computed(() => props.entry.type === 'report')
const content = computed(() => isReport.value ? props.entry.item.target : props.entry.item)
const title = computed(() => campusContentTitle(content.value || {}))
const source = computed(() => {
  const value = content.value?.source_url || content.value?.source_info || ''
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '' } catch { return '' }
})
const details = computed(() => {
  const item = content.value || {}
  return [item.description, item.body, item.official_intro, item.note, item.detail, item.reason, item.research_directions,
    item.task && `争议任务：${item.task.title} · ${item.task.description || ''} · 当前状态：${item.task.status}`,
    ['clarity','organization','learning','workload','assessment'].some(key => item[key] != null) && `评价维度：${[['clarity','讲解'],['organization','组织'],['learning','收获'],['workload','任务量'],['assessment','考核']].filter(([key]) => item[key] != null).map(([key,label]) => `${label} ${item[key]} / 5`).join(' · ')}`,
    item.course_name && `课程：${item.course_name} · ${item.teacher_name || '教师待核对'} · ${item.term || ''}`,
    item.department && `院系：${item.department}`, item.opening_hours && `开放时间：${item.opening_hours}`,
    item.service_info, item.public_contact && `公开业务联系：${item.public_contact}`,
    item.listing_type && `发布类型：${({ sale:'出售',free:'赠送',wanted:'求购' })[item.listing_type] || item.listing_type} · ${item.price_cents == null ? '价格未填写' : `¥${(item.price_cents / 100).toFixed(2)}`} · ${item.condition || ''} · ${item.meetup_area || ''}`,
    item.task_type && `取件：${item.pickup_area || '未填写'} · 送达：${item.delivery_area || '未填写'} · 截止：${item.deadline || '未设置'}`,
    item.starts_at && `活动时间：${item.starts_at} — ${item.ends_at} · ${item.location || ''} · 组织方：${item.organizer || ''} · 名额：${item.capacity ?? '不限'}`,
    item.approximate_location && `大致位置：${item.approximate_location} · ${item.occurred_at || ''}`,
    item.stops?.length && `站点：${item.stops.map(stop => `${stop.direction === 'inbound' ? '返程' : '去程'} ${stop.position}. ${stop.name}`).join('；')}`,
    item.departures?.length && `班次：${item.departures.map(trip => `${trip.direction === 'inbound' ? '返程' : '去程'} ${trip.service_day} ${trip.departure_time}`).join('；')}`,
    item.service_date && `特殊日期：${item.service_date} · ${item.exception_type || ''} · ${item.departure_time || ''}`,
    item.source_info && `来源说明：${item.source_info}`,
  ].filter(Boolean).join('\n') || '没有补充说明。'
})
watch(() => [accountUser.value?.id, props.entry.item.id, props.entry.item.revision, props.entry.item.review_revision], () => { reason.value = ''; error.value = ''; confirmRemove.value = false }, { flush: 'sync' })
function decide(decision) {
  if (props.busy) return
  error.value = ''
  if (!reason.value.trim()) { error.value = '请填写审核依据；写明结论理由后，审核贡献豆才会计入。'; return }
  if (decision === 'remove' && !confirmRemove.value) { confirmRemove.value = true; return }
  emit('decide', { entry: props.entry, decision, reason: reason.value.trim() })
}
</script>

<template>
  <article class="campus-review-item">
    <div class="campus-life-meta"><Badge variant="secondary">{{ campusContentLabels[entry.type] }}</Badge><span>{{ entry.item.school }}<template v-if="entry.item.campus"> · {{ entry.item.campus }}</template></span><span>{{ String(entry.item.created_at || '').slice(0,10) }}</span></div>
    <template v-if="isReport"><h3>{{ campusReportReasons[entry.item.reason] || '用户举报' }} · {{ campusContentLabels[entry.item.target_type] }}</h3><p class="campus-review-report">举报说明：{{ entry.item.detail || '无补充说明' }}</p><h4>被举报内容：{{ content ? title : '原内容已不可用' }}</h4></template>
    <h3 v-else>{{ title }}</h3>
    <pre class="campus-review-detail">{{ details }}</pre>
    <a v-if="source" :href="source" target="_blank" rel="noopener noreferrer">核对公开来源</a>
    <p v-if="entry.item.review_reason" class="campus-life-inline-state">此前审核意见：{{ entry.item.review_reason }}</p>
    <Field><FieldLabel :for="'review-reason-' + entry.item.id">{{ entry.type === 'help_dispute' ? '裁定依据' : '处理依据' }}</FieldLabel><textarea :id="'review-reason-' + entry.item.id" v-model="reason" maxlength="500" :disabled="busy" :aria-invalid="Boolean(error)" placeholder="说明核查事实、来源和处理依据；审核结论需要留档" /></Field>
    <p v-if="error" role="alert" class="campus-life-inline-state error">{{ error }}</p>
    <div class="campus-life-actions">
      <template v-if="isReport"><Button :disabled="busy || !content" variant="destructive" @click="decide('remove')">下架原内容</Button><Button :disabled="busy" variant="outline" @click="decide('resolve')">已核实处理</Button><Button :disabled="busy" variant="ghost" @click="decide('dismiss')">举报不成立</Button></template>
      <template v-else-if="entry.type === 'help_dispute'"><Button :disabled="busy" @click="decide('completed')">裁定任务完成</Button><Button :disabled="busy" variant="outline" @click="decide('cancelled')">裁定取消任务</Button></template>
      <template v-else><Button :disabled="busy" @click="decide('approve')">{{ busy ? '保存中…' : '通过并发布' }}</Button><Button :disabled="busy" variant="outline" @click="decide('reject')">退回修改</Button></template>
    </div>
    <Modal v-if="confirmRemove" :open="true" title="下架被举报内容" @close="!busy && (confirmRemove = false)"><p>下架「{{ title }}」后，原内容会退出公开列表。作者可查看原因、修改后重新提交。举报处理结果也会通知举报者。</p><p>{{ reason }}</p><template #foot><div class="campus-life-actions"><Button variant="outline" :disabled="busy" @click="confirmRemove = false">取消</Button><Button variant="destructive" :disabled="busy" @click="decide('remove')">{{ busy ? '正在保存…' : '确认下架' }}</Button></div></template></Modal>
  </article>
</template>

<style scoped>
.campus-review-item{display:grid;gap:16px;padding:22px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);min-width:0}.campus-review-item h3,.campus-review-item h4{margin:0;overflow-wrap:anywhere}.campus-review-item h3{font-size:var(--fs-17)}.campus-review-item h4{font-size:var(--fs-14)}.campus-review-detail{max-height:300px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:var(--fs-13);line-height:1.8;color:var(--muted);padding:16px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-review-report{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-13);line-height:1.8}.campus-review-item>a{color:var(--primary);font-size:var(--fs-12)}@media(max-width:520px){.campus-review-item{padding:16px}}
.campus-review-item textarea{min-height:96px;width:100%;padding:12px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-13);resize:vertical}.campus-review-item textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
