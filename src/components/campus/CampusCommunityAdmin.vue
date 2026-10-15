<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import {
  campusReviewerApplications, decideCampusReviewerApplication,
  sampleCampusReviewerAudits, campusReviewerAudits, resolveCampusReviewerAudit,
  campusFeedbackAdminList, manageCampusFeedback, campusFeedbackMessages,
} from '../../services/campusCommunity.js'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import CampusStatusMessages from './CampusStatusMessages.vue'
import { campusErrorMessage } from '../../composables/campusContentModel.js'
import { campusDateLabel, campusDateTimeLabel } from '../../composables/campusFormatting.js'
import { useCampusBusyKeys, useCampusRequest } from '../../composables/campusRequest.js'

const props = defineProps({ mode: { type: String, required: true } })
const loading = ref(false)
const error = ref('')
const notice = ref('')
const rows = ref(/** @type {any[]} */ ([]))
const forms = reactive(/** @type {Record<string, any>} */ ({}))
const currentMonth = ref(new Date().toISOString().slice(0, 7))
const auditCounts = ref(/** @type {any} */ (null))
const threads = reactive(/** @type {Record<string, any[]>} */ ({}))
const request = useCampusRequest()
const pending = useCampusBusyKeys()

/**
 * 每行一个忙碌标记。
 *
 * 之前只有一个 `busy`，而每个动作开头都是 `if (busy.value) return`：
 * 审批第 1 条申请时，第 2、3 条的按钮全部失效，直到它处理完。对一个总管理员
 * 要逐条过的工作台来说，这等于逼着管理员串行操作。
 */
const busy = (action, id) => pending.busy(`${action}:${id}`)
const anyBusy = () => pending.busy('sample')

watch(() => props.mode, () => { request.invalidate(); rows.value = []; error.value = ''; notice.value = ''; void load() })
watch(currentMonth, () => { if (props.mode === 'audits') void load() })
onMounted(() => { void load() })

function formFor(id, defaults = {}) {
  if (!forms[id]) forms[id] = { reason: '', school: '', campus: '', decision: '', correct: null, reopen: false, status: 'pending', visibility: 'pending_safety', reply: '', publicReason: '', reward: '', message: '', ...defaults }
  return forms[id]
}

async function load() {
  const revision = request.begin()
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    let next = []
    if (props.mode === 'applications') {
      next = (await campusReviewerApplications()).applications || []
      if (request.live(revision)) for (const row of next) formFor(row.id, { reason: row.owner_note || '', school: row.scope_school || row.school, campus: row.scope_campus ?? row.campus })
    } else if (props.mode === 'audits') {
      next = (await campusReviewerAudits({ month: currentMonth.value, outcome: 'pending' })).items || []
    } else {
      next = (await campusFeedbackAdminList()).items || []
      if (request.live(revision)) for (const row of next) formFor(row.id, { status: row.status, visibility: row.visibility, reply: row.public_reply, publicReason: row.public_reason, reward: '' })
    }
    // 迟到响应：切换模式或翻月之后回来的这一页，不能盖掉新范围的数据。
    if (request.live(revision)) rows.value = next
  } catch (cause) {
    if (request.live(revision)) error.value = campusErrorMessage(cause, '读取管理数据失败。')
  } finally {
    if (request.live(revision)) loading.value = false
  }
}

async function submitApplication(row, decision) {
  const form = formFor(row.id)
  if (busy('decide', row.id)) return
  if (!form.reason.trim()) { error.value = '请先写明审批依据。'; return }
  error.value = ''; notice.value = ''
  await pending.run(`decide:${row.id}`, async () => {
    try {
      await decideCampusReviewerApplication(row.id, decision, form.reason.trim(), form.school, form.campus)
      notice.value = decision === 'approve' ? '已审批并按此范围授权审核员。' : decision === 'request_proof' ? '已要求申请人补充材料，申请仍保持待审批。' : '已记录不通过决定。'
      await load()
    } catch (cause) { error.value = campusErrorMessage(cause, '审批没有保存。') }
  })
}

async function sample() {
  if (anyBusy()) return
  error.value = ''; notice.value = ''
  await pending.run('sample', async () => {
    try {
      auditCounts.value = await sampleCampusReviewerAudits(currentMonth.value)
      notice.value = `本次新增 ${auditCounts.value.audits_created} 条抽查记录，涉及 ${auditCounts.value.reviewers_sampled} 位审核员。`
      await load()
    } catch (cause) { error.value = campusErrorMessage(cause, '随机抽查没有完成。') }
  })
}

async function resolveAudit(row, correct) {
  const form = formFor(row.id)
  if (busy('audit', row.id)) return
  if (!form.reason.trim()) { error.value = '请填写复核依据后再保存。'; return }
  error.value = ''; notice.value = ''
  await pending.run(`audit:${row.id}`, async () => {
    try {
      const result = await resolveCampusReviewerAudit(row.id, correct, form.reason.trim(), !correct && form.reopen)
      notice.value = correct ? '已记录为审核正确。' : `已记录错判；回收 ${result.recovered || 0} 个未花贡献豆，${result.debt_added || 0} 个将抵扣后续奖励。${result.reviewer_alert ? `提醒：该审核员近 30 天已出现 ${result.recent_errors} 次错判，请评估是否暂停权限。` : ''}`
      await load()
    } catch (cause) { error.value = campusErrorMessage(cause, '抽查结论没有保存。') }
  })
}

async function saveFeedback(row) {
  const form = formFor(row.id)
  if (busy('feedback', row.id)) return
  if (form.status === 'not_adopted' && !form.publicReason.trim()) { error.value = '不采纳时需要填写公开说明。'; return }
  const reward = form.reward === '' ? null : Number(form.reward)
  if (reward !== null && (!Number.isInteger(reward) || reward < 0 || reward > 20)) { error.value = '奖励只能是 0 到 20 个贡献豆。'; return }
  error.value = ''; notice.value = ''
  await pending.run(`feedback:${row.id}`, async () => {
    try {
      await manageCampusFeedback({ feedbackId: row.id, status: form.status, visibility: form.visibility, reply: form.reply, publicReason: form.publicReason, reward })
      notice.value = reward === null ? '建议状态与公开信息已更新。' : `建议已更新，已按设置发放 ${reward} 个贡献豆。`
      form.reward = ''
      await load()
    } catch (cause) { error.value = campusErrorMessage(cause, '建议更新没有保存。') }
  })
}

async function openThread(row) {
  const revision = request.begin()
  error.value = ''
  try {
    const result = (await campusFeedbackMessages(row.id)).messages || []
    if (request.live(revision)) threads[row.id] = result
  } catch (cause) {
    if (request.live(revision)) error.value = campusErrorMessage(cause, '站内私信读取失败。')
  }
}

async function sendMessage(row) {
  const form = formFor(row.id)
  if (!form.message.trim() || busy('message', row.id)) return
  error.value = ''
  await pending.run(`message:${row.id}`, async () => {
    try {
      const result = (await campusFeedbackMessages(row.id, form.message.trim())).messages || []
      threads[row.id] = result
      form.message = ''
    } catch (cause) { error.value = campusErrorMessage(cause, '站内私信发送失败。') }
  })
}
function handleThreadToggle(event, row) {
  const details = /** @type {HTMLDetailsElement|null} */ (event.currentTarget)
  if (details?.open) void openThread(row)
}
</script>

<template>
  <section class="community-admin">
    <CampusStatusMessages :notice="notice" :error="error" />
    <div class="admin-toolbar">
      <div>
        <h2>{{ mode === 'applications' ? '审核员申请' : mode === 'audits' ? '随机复核' : '公开建议处理' }}</h2>
        <p v-if="mode === 'applications'">核对申请理由，决定是否授权，并明确学校与校区范围。</p>
        <p v-else-if="mode === 'audits'">按月对每位审核员的最终处理记录随机抽查 10%，向上取整；本月有记录时至少抽 1 条，不重复抽查。</p>
        <p v-else>新建议先做内容安全检查，再公开状态和回复。不采纳要说明原因；解决奖励由你决定，0–20 个贡献豆且仅发一次。</p>
      </div>
      <div class="toolbar-actions"><label v-if="mode === 'audits'">月份<input v-model="currentMonth" type="month" /></label><Button v-if="mode === 'audits'" :disabled="loading || anyBusy()" @click="sample">{{ anyBusy() ? '正在抽取…' : '随机抽查本月' }}</Button><Button variant="outline" :disabled="loading" @click="load">刷新</Button></div>
    </div>
    <p v-if="loading" class="admin-empty">正在读取记录…</p>
    <p v-else-if="!rows.length" class="admin-empty">{{ mode === 'applications' ? '目前没有待审批的审核员申请。' : mode === 'audits' ? '当前筛选没有待复核记录。' : '目前没有提交的公开建议。' }}</p>

    <template v-if="mode === 'applications'">
      <article v-for="row in rows" :key="row.id" class="admin-record">
        <div class="record-heading"><div><Badge variant="outline">{{ row.status === 'pending' ? '待审批' : row.status === 'approved' ? '已批准' : '未批准' }}</Badge><b>{{ row.email || '邮箱不可用' }}</b></div><time>{{ campusDateLabel(row.created_at) }}</time></div>
        <p class="record-scope">申请范围：{{ row.school }} · {{ row.campus || '全部校区' }}</p><p class="record-body">{{ row.reason }}</p>
        <div v-if="row.status === 'pending'" class="record-form"><label>授权学校<input v-model="formFor(row.id).school" maxlength="100" /></label><label>授权校区<input v-model="formFor(row.id).campus" maxlength="100" placeholder="留空表示该学校全部校区" /></label><label class="wide-field">审批依据或补充材料要求<textarea v-model="formFor(row.id).reason" maxlength="1000" rows="3" placeholder="写明授权、拒绝，或需要申请人补充的材料" /></label><div class="record-actions"><Button variant="outline" :disabled="busy('decide', row.id)" @click="submitApplication(row,'request_proof')">要求补充材料</Button><Button variant="outline" :disabled="busy('decide', row.id)" @click="submitApplication(row,'decline')">不通过</Button><Button :disabled="busy('decide', row.id)" @click="submitApplication(row,'approve')">{{ busy('decide', row.id) ? '正在保存…' : '批准并授权' }}</Button></div></div>
        <div v-else class="record-note"><p>{{ row.owner_note }}</p><p v-if="row.applicant_response"><b>申请人补充：</b>{{ row.applicant_response }}</p></div>
      </article>
    </template>

    <template v-else-if="mode === 'audits'">
      <article v-for="row in rows" :key="row.id" class="admin-record">
        <div class="record-heading"><div><Badge variant="outline">待复核</Badge><b>{{ row.reviewerEmail || '审核员账号' }}</b></div><time>{{ campusDateTimeLabel(row.event?.created_at) }}</time></div>
        <p class="record-scope">{{ row.event?.school }} · {{ row.event?.campus || '全校区' }} · {{ row.event?.target_type }} · {{ row.event?.from_status }} → {{ row.event?.to_status }}</p>
        <p class="record-body">原处理依据：{{ row.event?.reason || '未填写' }}</p>
        <label>复核依据<textarea v-model="formFor(row.id).reason" maxlength="1000" rows="3" placeholder="说明复核发现与判断依据" /></label>
        <label v-if="!['report','help_dispute'].includes(row.event?.target_type)" class="check-line"><input v-model="formFor(row.id).reopen" type="checkbox" /> 错判时重新放回待审核队列</label>
        <p v-else class="record-scope">举报和互助争议有独立流程；错判依据会归档，由总管理员通过原处理流程更正。</p>
        <div class="record-actions"><Button variant="outline" :disabled="busy('audit', row.id)" @click="resolveAudit(row,false)">记录为错判</Button><Button :disabled="busy('audit', row.id)" @click="resolveAudit(row,true)">{{ busy('audit', row.id) ? '正在保存…' : '审核正确' }}</Button></div>
      </article>
    </template>

    <template v-else>
      <article v-for="row in rows" :key="row.id" class="admin-record">
        <div class="record-heading"><div><Badge variant="outline">{{ row.visibility === 'pending_safety' ? '待安全检查' : row.visibility === 'hidden' ? '仅管理员可见' : '已公开' }}</Badge><Badge variant="outline">{{ ({pending:'待回应',processing:'处理中',resolved:'已解决',not_adopted:'暂不采纳'})[row.status] }}</Badge><b>{{ row.title }}</b></div><time>{{ campusDateLabel(row.created_at) }}</time></div>
        <p class="record-scope">{{ row.category }} · 提交人 {{ row.author_id }}</p><p class="record-body">{{ row.body }}</p>
        <div class="record-form"><label>公开状态<select v-model="formFor(row.id).status"><option value="pending">待回应</option><option value="processing">处理中</option><option value="resolved">已解决</option><option value="not_adopted">暂不采纳</option></select></label><label>公开方式<select v-model="formFor(row.id).visibility"><option value="pending_safety">待安全检查</option><option value="public">公开展示</option><option value="hidden">隐藏</option></select></label><label class="wide-field">管理员公开回复<textarea v-model="formFor(row.id).reply" maxlength="2000" rows="3" placeholder="这段内容所有人都能看到" /></label><label class="wide-field">暂不采纳说明<textarea v-model="formFor(row.id).publicReason" maxlength="1000" rows="2" placeholder="选择“暂不采纳”时必填，对所有访问者公开" /></label><label>解决奖励（0–20）<input v-model="formFor(row.id).reward" type="number" min="0" max="20" step="1" :disabled="row.reward_issued || formFor(row.id).status !== 'resolved'" placeholder="仅在标记解决时设置；留空不发放" /><small v-if="row.reward_issued">本条已发放 {{ row.reward_beans || 0 }} 个贡献豆，不会重复发放。</small><small v-else>奖励只在状态为“已解决”时发放一次。</small></label><div class="record-actions"><Button :disabled="busy('feedback', row.id)" @click="saveFeedback(row)">{{ busy('feedback', row.id) ? '正在保存…' : row.reward_issued ? '更新公开信息' : '保存处理结果' }}</Button></div></div>
        <details class="admin-private-thread" @toggle="handleThreadToggle($event,row)"><summary>与提交人站内联系</summary><div class="thread-content"><p v-for="message in threads[row.id] || []" :key="message.id" :class="{ owner: message.sender_id !== row.author_id }">{{ message.body }}</p><form @submit.prevent="sendMessage(row)"><input v-model="formFor(row.id).message" maxlength="2000" aria-label="站内私信内容" placeholder="仅你与提交人可见" /><Button size="sm" type="submit" :disabled="busy('message', row.id)">{{ busy('message', row.id) ? '发送中…' : '发送' }}</Button></form></div></details>
      </article>
    </template>
  </section>
</template>

<style scoped>
.community-admin{display:grid;gap:13px}.admin-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:18px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card)}.admin-toolbar h2{margin:0 0 5px;font-size:var(--fs-17)}.admin-toolbar p{max-width:72ch;margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.toolbar-actions,.toolbar-actions label{display:flex;align-items:center;gap:8px}.toolbar-actions label{font-size:var(--fs-11);color:var(--muted)}.toolbar-actions input,.record-form input,.record-form select,.record-form textarea,.admin-record>label textarea,.thread-content input{width:100%;min-width:0;min-height:38px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-12)}.toolbar-actions input{width:auto}.admin-empty{padding:25px;border:1px dashed var(--border);border-radius:var(--radius-10);color:var(--muted);font-size:var(--fs-12);text-align:center}.admin-record{display:grid;gap:12px;padding:17px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card)}.record-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.record-heading>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}.record-heading b{overflow-wrap:anywhere}.record-heading time,.record-scope,.record-note{color:var(--muted);font-size:var(--fs-10)}.record-scope{margin:0}.record-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-12);line-height:1.8}.record-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.record-form label,.admin-record>label{display:grid;gap:5px;font-size:var(--fs-11);font-weight:var(--fw-600)}.record-form textarea,.admin-record>label textarea{resize:vertical;min-height:82px;line-height:1.7}.wide-field{grid-column:1/-1}.record-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}.record-actions button{min-height:40px}.check-line{display:flex!important;align-items:center;gap:8px;color:var(--muted);font-size:var(--fs-11)}.check-line input{width:auto;min-height:0}.admin-private-thread summary{color:var(--primary);font-size:var(--fs-11);cursor:pointer}.thread-content{display:grid;gap:8px;padding-top:10px}.thread-content>p{justify-self:start;max-width:80%;margin:0;padding:8px 10px;border-radius:var(--radius-8);background:var(--bg-tint);font-size:var(--fs-11);white-space:pre-wrap;overflow-wrap:anywhere}.thread-content>p.owner{justify-self:end;background:var(--primary-soft)}.thread-content form{display:flex;gap:7px}
@media(max-width:760px){.admin-toolbar{align-items:flex-start;flex-direction:column}.toolbar-actions{width:100%;flex-wrap:wrap}.toolbar-actions>button{flex:1}.record-heading{align-items:flex-start}.record-form{grid-template-columns:1fr}.wide-field{grid-column:auto}.record-actions{justify-content:stretch}.record-actions button{flex:1}}
</style>
