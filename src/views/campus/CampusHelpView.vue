<script setup>
import { onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusPrivateChat from '../../components/campus/CampusPrivateChat.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import {
  applyToCampusHelpTask, campusHelpTasks, campusLifeMine, decideHelpApplication,
  listCampusHelpApplications, transitionCampusHelpTask, withdrawHelpApplication,
} from '../../services/campusLife.js'

const page = useCampusLifePage()
const applyId = ref('')
const applyNote = ref('')
const disputeId = ref('')
const disputeReason = ref('')
const chat = ref(null)
const busyId = ref('')

async function refresh() {
  return page.load(async () => {
    const [publicResult, applicationResult, mineResult] = await Promise.all([campusHelpTasks(), listCampusHelpApplications(), campusLifeMine()])
    return { tasks: publicResult.tasks || [], applications: applicationResult.applications || [], mine: mineResult.helpTasks || [], activeTasks: applicationResult.activeTasks || [] }
  })
}
onMounted(() => { void refresh() })

const typeLabels = { parcel: '快递代取', delivery: '物品递送', errand: '校内跑腿', temporary_help: '临时求助', moving: '搬运协助', daily_task: '日常代办', other: '其他' }
const taskStatuses = { pending_review: '待审核', open: '待接单', assigned: '已接单', in_progress: '进行中', awaiting_confirmation: '待发布者确认', completed: '已完成', cancelled: '已取消', disputed: '争议处理中', rejected: '未通过审核', expired: '已过期' }
const applicationStatuses = { pending: '待处理', accepted: '已接单', rejected: '未接受', withdrawn: '已撤回', closed: '已关闭' }
function timeLabel(value) { if (!value) return '未设置'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间待核实' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) }

async function apply(task) {
  busyId.value = task.id
  const result = await page.act(() => applyToCampusHelpTask(task.id, applyNote.value), '接单申请已发送。')
  busyId.value = ''
  if (result) { applyId.value = ''; applyNote.value = ''; await refresh() }
}
async function decide(application, decision) {
  busyId.value = application.id
  const result = await page.act(() => decideHelpApplication(application.task_id, application.id, decision), decision === 'accept' ? '已选择接单者。' : '已处理接单申请。')
  busyId.value = ''
  if (result) await refresh()
}
async function transition(task, next, reason = '') {
  busyId.value = task.id
  const result = await page.act(() => transitionCampusHelpTask(task.id, next, reason), `任务状态已更新为“${taskStatuses[next]}”。`)
  busyId.value = ''
  if (result) { disputeId.value = ''; disputeReason.value = ''; await refresh() }
}
async function withdraw(application) {
  busyId.value = application.id
  const result = await page.act(() => withdrawHelpApplication(application.id), '接单申请已撤回。')
  busyId.value = ''
  if (result) await refresh()
}
function openChat(application) {
  if (!application.counterpartId) return
  chat.value = { targetType: 'help_task', targetId: application.task_id, recipientId: application.counterpartId, recipientName: application.counterpart }
}
</script>

<template>
  <CampusLifeLayout title="校园互助" description="快递代取、递送、跑腿与日常协助采用申请接单和状态确认。任务默认不涉及平台资金。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-help-heading"><div><h2>可接任务</h2><p>接单前确认时间与范围；交接选择有人流的校园公共区域。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=help">发布互助</RouterLink></div>
        <p v-if="page.loading.value && !page.data.value" class="campus-life-state" role="status">正在读取互助任务…</p>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <p v-else-if="!page.data.value?.tasks?.length" class="campus-life-state">当前没有待接任务。发布的内容审核通过后才会显示在这里。</p>
        <div v-else class="campus-life-grid">
          <article v-for="task in page.data.value.tasks" :key="task.id" class="campus-life-card">
            <div class="campus-life-meta"><span class="campus-life-tag">{{ typeLabels[task.task_type] || '校园互助' }}</span><span v-if="task.campus">{{ task.campus }}</span><span>{{ timeLabel(task.deadline) }}</span></div>
            <h3>{{ task.title }}</h3><p>{{ task.description || '发布者尚未补充任务说明。' }}</p>
            <p class="campus-life-meta"><span v-if="task.pickup_area">起始：{{ task.pickup_area }}</span><span v-if="task.delivery_area">送达：{{ task.delivery_area }}</span></p>
            <CampusContentActions target-type="help_task" :target-id="task.id" />
            <button v-if="applyId !== task.id" class="btn btn-ghost" type="button" @click="applyId = task.id">申请接单</button>
            <form v-if="applyId === task.id" class="campus-help-inline-form" @submit.prevent="apply(task)"><label>申请说明（请勿写手机号或地址）<textarea v-model="applyNote" maxlength="500" /></label><div class="campus-life-actions"><button class="btn btn-primary" type="submit" :disabled="busyId === task.id">发送申请</button><button class="btn btn-ghost" type="button" @click="applyId = ''">取消</button></div></form>
          </article>
        </div>
      </section>

      <section v-if="page.data.value?.applications?.length" class="campus-life-panel">
        <h2>接单申请与私密沟通</h2>
        <div class="campus-help-list"><article v-for="application in page.data.value.applications" :key="`${application.perspective}:${application.id}`" class="campus-help-row"><div><b>{{ application.taskTitle }}</b><p>{{ application.perspective === 'owner' ? `${application.counterpart} 申请接单` : `发布者：${application.counterpart}` }} · {{ applicationStatuses[application.status] || application.status }}</p><small>{{ application.message || '没有附加说明' }}</small></div><div class="campus-life-actions"><button v-if="application.perspective === 'owner' && application.status === 'pending'" class="btn btn-primary" type="button" :disabled="busyId === application.id" @click="decide(application, 'accept')">接受</button><button v-if="application.perspective === 'owner' && application.status === 'pending'" class="btn btn-ghost" type="button" :disabled="busyId === application.id" @click="decide(application, 'reject')">拒绝</button><button v-if="application.status === 'pending' || application.status === 'accepted'" class="btn btn-ghost" type="button" @click="openChat(application)">私信</button><button v-if="application.perspective === 'applicant' && application.status === 'pending'" class="text-button" type="button" :disabled="busyId === application.id" @click="withdraw(application)">撤回申请</button></div></article></div>
      </section>

      <section v-if="page.data.value?.mine?.length" class="campus-life-panel">
        <h2>我发布的任务</h2>
        <div class="campus-help-list"><article v-for="task in page.data.value.mine" :key="task.id" class="campus-help-row"><div><b>{{ task.title }}</b><p>{{ taskStatuses[task.status] || task.status }}<span v-if="task.review_reason"> · {{ task.review_reason }}</span></p></div><div class="campus-life-actions"><button v-if="task.status === 'awaiting_confirmation'" class="btn btn-primary" type="button" :disabled="busyId === task.id" @click="transition(task, 'completed')">确认完成</button><button v-if="['open','assigned'].includes(task.status)" class="text-button" type="button" :disabled="busyId === task.id" @click="transition(task, 'cancelled')">取消任务</button><button v-if="['assigned','in_progress','awaiting_confirmation'].includes(task.status)" class="text-button danger-text" type="button" @click="disputeId = task.id">发起争议</button></div><form v-if="disputeId === task.id" class="campus-help-inline-form" @submit.prevent="transition(task, 'disputed', disputeReason)"><label>说明遇到的问题 <textarea v-model="disputeReason" maxlength="1500" required /></label><button class="btn btn-primary" type="submit" :disabled="busyId === task.id">提交争议</button></form></article></div>
      </section>
      <section v-if="page.data.value?.activeTasks?.length" class="campus-life-panel"><h2>我接下的任务</h2><div class="campus-help-list"><article v-for="task in page.data.value.activeTasks" :key="task.id" class="campus-help-row"><div><b>{{ task.title }}</b><p>{{ taskStatuses[task.status] || task.status }} · {{ [task.pickup_area, task.delivery_area].filter(Boolean).join(' → ') }}</p></div><div class="campus-life-actions"><button v-if="task.status === 'assigned'" class="btn btn-ghost" type="button" :disabled="busyId === task.id" @click="transition(task, 'in_progress')">开始任务</button><button v-if="task.status === 'in_progress'" class="btn btn-ghost" type="button" :disabled="busyId === task.id" @click="transition(task, 'awaiting_confirmation')">提交完成</button><button v-if="['assigned','in_progress','awaiting_confirmation'].includes(task.status)" class="text-button danger-text" type="button" @click="disputeId = task.id">发起争议</button></div><form v-if="disputeId === task.id" class="campus-help-inline-form" @submit.prevent="transition(task, 'disputed', disputeReason)"><label>说明遇到的问题 <textarea v-model="disputeReason" maxlength="1500" required /></label><button class="btn btn-primary" type="submit" :disabled="busyId === task.id">提交争议</button></form></article></div></section>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
      <CampusPrivateChat v-if="chat" v-bind="chat" @close="chat = null" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-help-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-help-heading p{margin:5px 0 0;color:var(--muted)}.campus-help-list{display:grid;gap:8px}.campus-help-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px 14px;align-items:center;padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-help-row p,.campus-help-row small{display:block;margin:4px 0;color:var(--muted)}.campus-help-inline-form{grid-column:1/-1;display:grid;gap:8px}.campus-help-inline-form label{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-help-inline-form textarea{min-height:65px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}@media(max-width:520px){.campus-help-heading{align-items:flex-start;flex-direction:column}.campus-help-row{grid-template-columns:1fr}}
</style>
