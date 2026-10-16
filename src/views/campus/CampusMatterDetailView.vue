<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Flag, MapPin } from '@lucide/vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import { useDomainCommands } from '../../composables/domain/commands.js'
import { campusContentLabel, campusContentRoute, campusReportReasons } from '../../composables/campusContentModel.js'
import { analyzeCampusMatter, matterCategoryLabels, matterIntentLabels, matterOutcomeLabels, matterSafetyText, matterStatusLabels } from '../../composables/campusMatterModel.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { reportCampusContent } from '../../services/campusLife.js'
import {
  adoptCampusMatterResponse, campusMatter, deleteCampusMatter, deleteCampusMatterClarification, deleteCampusMatterResponse,
  feedbackCampusMatterResponse, linkCampusMatterTask, markCampusMatter, recordCampusMatterOutcome, replyCampusMatterClarification,
  setCampusMatterChoice, setCampusMatterState, startCampusMatterAction, submitCampusMatterClarification, submitCampusMatterResponse,
  setCampusMatterResponsePrivacy, updateCampusMatterPreferences,
} from '../../services/campusMatters.js'

const route = useRoute()
const router = useRouter()
const page = useCampusLifePage()
const { createTask } = useDomainCommands()
const responseTypes = { advice: '一个建议', experience: '我的亲身经历', information: '一条信息', risk: '一个风险提醒', perspective: '换个角度', decision: '我会这样选', judgment: '我的判断' }
const judgmentOptions = [
  ['not_overthinking', '我觉得你没想多'], ['need_more_info', '信息还不够'],
  ['new_angle', '可以换个角度'], ['serious_concern', '我认为问题比较明显'],
]
const responseDraft = reactive({ responseType: 'advice', content: '', why: '', steps: '', risk: '', firsthand: false, isAnonymous: true, selectedOption: '' })
const clarificationQuestion = ref('')
const clarificationAnswers = reactive({})
const responseComposerOpen = ref(false)
const responseBusy = ref(false)
const clarificationBusy = ref(false)
const preferencesDraft = reactive({ isAnonymous: true, allowClarifications: true, showOutcomes: true })
const stateDraft = ref('finding_help')
const choiceDraft = ref('')
const choiceNote = ref('')
const actionResponseId = ref('')
const actionText = ref('')
const actionDueChoice = ref('')
const actionBusy = ref(false)
const localTaskError = ref('')
const outcomeDraft = reactive({ actionId: '', outcome: 'solved', note: '' })
const outcomeBusy = ref(false)
const reportTarget = ref(/** @type {{ targetType: string, targetId: string } | null} */ (null))
const reportDraft = reactive({ reason: 'inaccurate', detail: '' })
const reportBusy = ref(false)
const deleteConfirm = ref('')
const notice = ref('')

const matter = computed(() => page.data.value?.matter || null)
const responses = computed(() => page.data.value?.responses || [])
const clarifications = computed(() => page.data.value?.clarifications || [])
const actions = computed(() => page.data.value?.actions || [])
const outcomes = computed(() => page.data.value?.outcomes || [])
const isMine = computed(() => Boolean(matter.value?.isMine))
const safetyText = computed(() => matterSafetyText(analyzeCampusMatter(matter.value?.content || '').highRisk))
const availableResponseTypes = computed(() => Object.entries(responseTypes).filter(([key]) => key === 'decision'
  ? matter.value?.intent === 'decision' && matter.value?.options?.length === 2
  : key !== 'judgment' || matter.value?.intent === 'judgment'))
const approvedResponses = computed(() => responses.value.filter((item) => item.review_status === 'approved'))
const decisionCounts = computed(() => ['A', 'B'].map((key, index) => ({
  key, label: matter.value?.options?.[index]?.label || key, count: approvedResponses.value.filter((item) => item.selected_option === key).length,
})))
const judgmentCounts = computed(() => judgmentOptions.map(([key, label]) => ({ key, label, count: approvedResponses.value.filter((item) => item.selected_option === key).length })))
const judgmentReasons = computed(() => approvedResponses.value.filter((item) => item.selected_option && item.why).slice(0, 5)
  .map((item) => `${judgmentOptions.find(([key]) => key === item.selected_option)?.[1] || '一个角度'}：${item.why}`).join(' · '))
const canAskClarification = computed(() => Boolean(matter.value?.allow_clarifications && !isMine.value && !clarifications.value.some((item) => item.isMine)))
const linkedRoute = computed(() => matter.value?.related_entity_type ? campusContentRoute(matter.value.related_entity_type) : '')
const hasOptionIssue = computed(() => responseDraft.responseType === 'decision' && (!responseDraft.selectedOption || !responseDraft.why.trim()))
const hasJudgmentIssue = computed(() => responseDraft.responseType === 'judgment' && (!responseDraft.selectedOption || !responseDraft.why.trim()))

async function refresh({ forceRefresh = false } = {}) {
  return page.load(() => campusMatter(String(route.params.matterId || ''), { forceRefresh }))
}
onMounted(refresh)
watch(() => route.params.matterId, () => { if (route.params.matterId) void refresh() })
watch(matter, (item) => {
  if (!item) return
  preferencesDraft.isAnonymous = item.is_anonymous
  preferencesDraft.allowClarifications = item.allow_clarifications
  preferencesDraft.showOutcomes = item.show_outcomes
  stateDraft.value = item.status === 'resolved' ? 'finding_help' : item.status
  choiceDraft.value = item.author_choice || ''
  choiceNote.value = item.choice_note || ''
}, { immediate: true })

function dateLabel(value) { return value ? String(value).slice(0, 10) : '' }
function relatedLabel(value) { return campusContentLabel(value) }
function responseFeedbackType(response) {
  if (response.response_type === 'experience' || response.firsthand) return 'experienced'
  if (response.response_type === 'information') return 'confirmed'
  return 'helpful'
}
function responseFeedbackLabel(response) {
  return ({ helpful: '有帮助', experienced: '我也经历过', confirmed: '确认有用' })[responseFeedbackType(response)]
}
function toggleFeedback(response) {
  return response.feedbackCounts?.[responseFeedbackType(response)] || 0
}
function responseTypeLabel(response) { return responseTypes[response.response_type] || '解决方案' }
function dueDateFromChoice(choice) {
  if (!choice) return null
  const date = new Date()
  if (choice === 'tomorrow') date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function runAction(task, successText = '已保存。') {
  const ok = await page.act(task, successText)
  if (ok) await refresh()
  return ok
}

async function submitResponse() {
  if (!responseDraft.content.trim() || responseBusy.value || hasOptionIssue.value || hasJudgmentIssue.value) return
  if (responseDraft.responseType === 'decision' && !responseDraft.why.trim()) return
  responseBusy.value = true
  const ok = await page.act(() => submitCampusMatterResponse({
    matterId: matter.value.id, responseType: responseDraft.responseType, content: responseDraft.content,
    why: responseDraft.why, steps: responseDraft.steps, risk: responseDraft.risk, firsthand: responseDraft.firsthand,
    isAnonymous: responseDraft.isAnonymous, selectedOption: responseDraft.selectedOption || undefined,
  }), '解决方案已提交，审核通过后会显示给这件事的发起者。')
  responseBusy.value = false
  if (ok) {
    Object.assign(responseDraft, { responseType: 'advice', content: '', why: '', steps: '', risk: '', firsthand: false, isAnonymous: true, selectedOption: '' })
    responseComposerOpen.value = false
    await refresh()
  }
}

async function submitClarification() {
  if (!clarificationQuestion.value.trim() || clarificationBusy.value) return
  clarificationBusy.value = true
  const ok = await page.act(() => submitCampusMatterClarification(matter.value.id, clarificationQuestion.value), '关键澄清已提交，审核通过后会通知这件事的发起者。')
  clarificationBusy.value = false
  if (ok) { clarificationQuestion.value = ''; await refresh() }
}

async function replyClarification(item, skip = false) {
  const answer = String(clarificationAnswers[item.id] || '').trim()
  if (!skip && !answer) return
  const ok = await runAction(() => replyCampusMatterClarification(item.id, answer, skip), skip ? '已跳过这条追问。' : '补充回答已提交审核。')
  if (ok) delete clarificationAnswers[item.id]
}

async function savePreferences() {
  return runAction(() => updateCampusMatterPreferences(matter.value.id, preferencesDraft), '隐私设置已更新。')
}
async function saveState() {
  return runAction(() => setCampusMatterState(matter.value.id, stateDraft.value), '事项状态已更新。')
}
async function saveChoice() {
  if (!choiceDraft.value) return
  return runAction(() => setCampusMatterChoice(matter.value.id, choiceDraft.value, choiceNote.value), '已记录你的最后选择。')
}

function openAction(response) {
  actionResponseId.value = response.id
  actionText.value = response.steps || response.content
  actionDueChoice.value = ''
  localTaskError.value = ''
}
async function startAction() {
  if (!actionText.value.trim() || actionBusy.value) return
  actionBusy.value = true
  localTaskError.value = ''
  page.reportFailure('')
  try {
    const result = await startCampusMatterAction({
      matterId: matter.value.id, responseId: actionResponseId.value,
      actionText: actionText.value.trim(), dueOn: dueDateFromChoice(actionDueChoice.value),
    })
    const action = result?.action
    if (!action?.id) throw new Error('下一步保存结果暂时无法读取，请刷新后确认。')
    actionResponseId.value = ''
    try {
      const localTask = createTask({
        title: actionText.value.trim().slice(0, 120), kind: 'todo', dueDate: dueDateFromChoice(actionDueChoice.value) || '',
        note: `来自「怎么办」：/campus/matters/${matter.value.id}`,
        createdFrom: 'campus-matter', sourceType: 'campus-matter-action', sourceId: action.id, relationId: matter.value.id,
      })
      await linkCampusMatterTask(action.id, localTask.id)
      notice.value = '已经把下一步同时加入你的待办。'
    } catch (cause) {
      localTaskError.value = cause?.message || '下一步已保存在这件事里，但暂时没能加入本地待办。'
      notice.value = '下一步已保存在这件事里。'
    }
    await refresh()
  } catch (cause) {
    page.reportFailure(cause?.message || '下一步没有保存，请重试。')
  } finally { actionBusy.value = false }
}

async function submitOutcome() {
  if (!outcomeDraft.outcome || outcomeBusy.value) return
  outcomeBusy.value = true
  const ok = await page.act(() => recordCampusMatterOutcome({
    matterId: matter.value.id, actionId: outcomeDraft.actionId || undefined,
    outcome: outcomeDraft.outcome, note: outcomeDraft.note,
  }), '后来怎么样已记录。只有你选择“解决了”后，这件事才会进入已解决。')
  outcomeBusy.value = false
  if (ok) { outcomeDraft.note = ''; await refresh() }
}

async function sendFeedback(response) {
  const type = responseFeedbackType(response)
  return runAction(() => feedbackCampusMatterResponse(response.id, type, response.myFeedback !== type), response.myFeedback === type ? '已撤回这条反馈。' : '反馈已记录。')
}
async function setResponsePrivacy(response) {
  const next = !response.is_anonymous
  return runAction(() => setCampusMatterResponsePrivacy(response.id, next), next ? '你的回应现在以匿名方式显示。' : '你的回应现在显示校园昵称。')
}
async function adopt(response) { return runAction(() => adoptCampusMatterResponse(response.id), '已采纳这个解决办法。') }
async function markMatter(type) {
  const enabled = !(matter.value.myMarks || []).includes(type)
  return runAction(() => markCampusMatter(matter.value.id, type, enabled), enabled ? '已记录。' : '已撤回。')
}

function openReport(targetType, targetId) {
  reportTarget.value = { targetType, targetId }
  reportDraft.reason = 'inaccurate'
  reportDraft.detail = ''
}
async function submitReport() {
  if (!reportTarget.value || reportBusy.value) return
  const target = reportTarget.value
  reportBusy.value = true
  const ok = await runAction(() => reportCampusContent(target.targetType, target.targetId, reportDraft.reason, reportDraft.detail), '举报已提交，审核结果可以在“我的举报”查看。')
  reportBusy.value = false
  if (ok) reportTarget.value = null
}

async function removeMatter() {
  if (deleteConfirm.value !== 'matter') { deleteConfirm.value = 'matter'; return }
  const ok = await page.act(() => deleteCampusMatter(matter.value.id), '这件事已从公开列表移除。')
  if (ok) await router.push('/campus/matters?view=mine')
}
async function removeResponse(response) {
  if (deleteConfirm.value !== response.id) { deleteConfirm.value = response.id; return }
  const ok = await runAction(() => deleteCampusMatterResponse(response.id), '你的解决方案已删除。')
  if (ok) deleteConfirm.value = ''
}
async function removeClarification(item) {
  if (deleteConfirm.value !== item.id) { deleteConfirm.value = item.id; return }
  const ok = await runAction(() => deleteCampusMatterClarification(item.id), '这条补充已删除。')
  if (ok) deleteConfirm.value = ''
}

function verifiedText(response) {
  return response.verifiedHelpful ? '✅ 这个建议后来帮助楼主解决了问题' : response.adopted ? '楼主采纳了这个办法' : ''
}
</script>

<template>
  <CampusLifeLayout title="这件事" description="把情况说清楚，找到能尝试的办法，再回来告诉大家结果。">
    <div class="matter-detail-toolbar"><RouterLink class="matter-back-link" to="/campus/matters"><ArrowLeft aria-hidden="true" />返回怎么办</RouterLink><button class="btn btn-outline" type="button" :disabled="page.loading.value" @click="refresh({ forceRefresh: true })">刷新</button></div>
    <CampusStateBlock :loading="page.loading.value" :loaded="Boolean(page.data.value)" :error="page.error.value" :empty="!matter" loading-text="正在读取这件事…" empty-title="这件事暂时不可用" empty-description="它可能已被删除、退回或不在你的校园范围内。" @retry="refresh">
      <template v-if="matter">
        <article class="campus-life-panel matter-story">
          <div class="matter-story-meta"><span class="campus-life-tag">{{ matterStatusLabels[matter.status] || '正在处理' }}</span><span>{{ matter.authorLabel }}</span><span>{{ dateLabel(matter.created_at) }}</span><span>{{ matterCategoryLabels[matter.category] || '其他' }}</span></div>
          <h2>{{ matter.title }}</h2>
          <section><h3>情况</h3><p class="matter-original-content">{{ matter.content }}</p></section>
          <div v-if="matter.intake_answers && Object.keys(matter.intake_answers).length" class="matter-intake-context"><h3>补充情况</h3><p v-for="[key,value] in Object.entries(matter.intake_answers)" :key="key">{{ value }}</p></div>
          <section class="matter-intent-block"><h3>这件事主要想要</h3><span class="campus-life-tag">{{ matterIntentLabels[matter.intent] || '帮我想办法' }}</span></section>
          <section v-if="matter.related_entity_type" class="matter-intent-block"><h3>关联的校园资料</h3><RouterLink class="matter-related-link" :to="linkedRoute"><MapPin aria-hidden="true" />查看{{ relatedLabel(matter.related_entity_type) }}<ArrowRight aria-hidden="true" /></RouterLink></section>
          <p v-if="matter.review_status === 'pending_review' && isMine" class="campus-life-inline-state">这件事正在审核；审核通过后会公开给同校同学。</p>
          <p v-else-if="matter.review_status === 'rejected' && isMine" class="campus-life-inline-state error" role="alert">审核意见：{{ matter.review_reason || '请修改后重新描述。' }}</p>
          <p v-if="safetyText" class="campus-life-inline-state matter-safety" role="status">{{ safetyText }}</p>
          <div v-if="!isMine && matter.review_status === 'approved'" class="matter-human-signals"><button type="button" :aria-pressed="matter.myMarks?.includes('experienced')" @click="markMatter('experienced')">🤝 我也经历过 <b>{{ matter.experienceCount || 0 }}</b></button><button type="button" :aria-pressed="matter.myMarks?.includes('understand')" @click="markMatter('understand')">❤️ 我懂 <b>{{ matter.understandCount || 0 }}</b></button></div>
          <section v-if="matter.intent === 'decision' && matter.options?.length === 2" class="matter-decision-summary"><div class="matter-decision-head"><h3>大家怎么考虑</h3><span>{{ approvedResponses.filter((item) => item.selected_option === 'A' || item.selected_option === 'B').length }} 条已审核的带理由选择</span></div><div class="matter-vote-columns"><div v-for="item in decisionCounts" :key="item.key" class="matter-vote-column"><div><b>{{ item.key }} · {{ item.label }}</b><strong>{{ item.count }}</strong></div><div class="matter-vote-track"><span :style="{ width: `${decisionCounts.reduce((sum, row) => sum + row.count, 0) ? item.count / decisionCounts.reduce((sum, row) => sum + row.count, 0) * 100 : 0}%` }" /></div></div></div><p v-if="matter.author_choice">楼主最后选择了 {{ matter.author_choice }}<template v-if="matter.choice_note">：{{ matter.choice_note }}</template></p><div v-if="isMine" class="matter-owner-choice"><label>最后我选择了<select v-model="choiceDraft"><option value="">暂不记录</option><option value="A">A · {{ matter.options[0].label }}</option><option value="B">B · {{ matter.options[1].label }}</option></select></label><input v-model="choiceNote" aria-label="选择原因（可选）" maxlength="500" placeholder="我为什么这样选（可选）" /><button class="btn btn-outline" type="button" :disabled="!choiceDraft" @click="saveChoice">记录我的选择</button></div><p v-else-if="judgmentReasons" class="matter-decision-reasons">{{ approvedResponses.filter((item) => item.selected_option && item.why).map((item) => `${item.selected_option}：${item.why}`).slice(0,5).join(' · ') }}</p></section>
          <section v-if="matter.intent === 'judgment'" class="matter-decision-summary"><div class="matter-decision-head"><h3>大家怎么看？</h3><span>{{ approvedResponses.filter((item) => item.selected_option).length }} 条已审核的带理由判断</span></div><p>这些角度来自同学的回应，不替你下结论。可以先看理由和亲身经历。</p><div class="matter-vote-columns"><div v-for="item in judgmentCounts" :key="item.key" class="matter-vote-column"><div><b>{{ item.label }}</b><strong>{{ item.count }}</strong></div><div class="matter-vote-track"><span :style="{ width: `${judgmentCounts.reduce((sum, row) => sum + row.count, 0) ? item.count / judgmentCounts.reduce((sum, row) => sum + row.count, 0) * 100 : 0}%` }" /></div></div></div><p v-if="judgmentReasons" class="matter-decision-reasons">{{ judgmentReasons }}</p></section>
          <div v-if="isMine" class="matter-owner-controls">
            <label>事项状态<select v-model="stateDraft"><option value="finding_help">寻找办法</option><option value="considering">正在考虑</option><option value="trying">正在尝试</option><option value="paused">暂时搁置</option><option value="venting">只是想说说</option></select></label><button class="btn btn-outline" type="button" @click="saveState">保存状态</button>
          </div>
        </article>

        <section class="campus-life-panel matter-clarifications">
          <div class="matter-section-heading"><div><h2>关键澄清</h2><p>每位同学在这件事下只能提出一个与解决直接相关的问题，楼主可以回答或跳过。</p></div></div>
          <p v-if="!clarifications.length" class="matter-empty-inline">目前没有关键澄清。</p>
          <article v-for="item in clarifications" :key="item.id" class="matter-clarification-card"><div class="matter-clarification-head"><span>{{ item.isMine ? '你提出的关键问题' : isMine ? '同学提出的关键问题' : '补充情况' }}</span><span v-if="item.review_status === 'pending_review'">审核中</span></div><p>{{ item.question }}</p><p v-if="item.status === 'answered' && item.review_status === 'approved'" class="matter-clarification-answer">楼主补充：{{ item.answer }}</p><p v-else-if="item.status === 'answered' && item.review_status === 'pending_review' && isMine" class="matter-clarification-answer">你的回答正在审核，审核通过后提问者会收到通知。</p><p v-else-if="item.status === 'skipped'" class="matter-clarification-answer">楼主选择跳过。</p><template v-if="isMine && item.status === 'pending' && item.review_status === 'approved'"><textarea v-model="clarificationAnswers[item.id]" :aria-label="'回答关键澄清：' + item.question" maxlength="500" rows="2" placeholder="简单补充这一点（可以跳过）" /><div class="matter-inline-actions"><button class="btn btn-primary" type="button" :disabled="!clarificationAnswers[item.id]?.trim()" @click="replyClarification(item)">回答</button><button class="btn btn-outline" type="button" @click="replyClarification(item, true)">跳过</button></div></template><p v-else-if="isMine && item.status === 'pending' && item.review_status === 'pending_review'" class="matter-empty-inline">问题审核通过后，你可以回答或跳过。</p><div class="matter-inline-actions"><button v-if="item.isMine || isMine" class="text-button danger" type="button" @click="removeClarification(item)">{{ deleteConfirm === item.id ? '确认删除' : '删除' }}</button><button v-if="item.review_status === 'approved' && !item.isMine && !isMine" class="text-button" type="button" @click="openReport('matter_clarification',item.id)">举报这条补充</button></div></article>
          <form v-if="canAskClarification" class="matter-clarification-form" @submit.prevent="submitClarification"><label for="matter-clarification-question">你可以提出一个关键澄清问题</label><textarea id="matter-clarification-question" v-model="clarificationQuestion" maxlength="180" rows="2" placeholder="只问一个会影响解决办法的问题" /><div class="matter-inline-actions"><button class="btn btn-outline" type="submit" :disabled="!clarificationQuestion.trim() || clarificationBusy">{{ clarificationBusy ? '正在提交…' : '提出关键问题' }}</button></div></form>
          <p v-else-if="!matter.allow_clarifications && !isMine" class="matter-empty-inline">这件事的发起者已关闭后续追问。</p><p v-else-if="!isMine && clarifications.some((item) => item.isMine)" class="matter-empty-inline">你已经在这件事下提过一个关键问题；如果还有新想法，可以直接写进解决方案。</p>
        </section>

        <section class="campus-life-panel matter-responses">
          <div class="matter-section-heading"><div><h2>大家怎么处理</h2><p>优先展示亲身经历、有理由、有步骤，以及后来实际有帮助的办法。</p></div><button v-if="!isMine && matter.review_status === 'approved'" class="btn btn-primary" type="button" :aria-expanded="responseComposerOpen" aria-controls="matter-response-form" @click="responseComposerOpen = !responseComposerOpen">{{ responseComposerOpen ? '收起' : '提供一个解决办法' }}</button></div>
          <p v-if="isMine && matter.intent === 'vent'" class="matter-empty-inline">这件事标记为“只是想说说”；回应是自愿的，你可以关闭追问或删除这件事。</p>
          <form v-if="responseComposerOpen" id="matter-response-form" class="matter-response-form" @submit.prevent="submitResponse"><label>我提供的是<select v-model="responseDraft.responseType"><option v-for="[key,label] in availableResponseTypes" :key="key" :value="key">{{ label }}</option></select></label><div v-if="responseDraft.responseType === 'decision'" class="matter-choice-list"><button v-for="item in decisionCounts" :key="item.key" type="button" :class="{ selected: responseDraft.selectedOption === item.key }" @click="responseDraft.selectedOption = item.key">{{ item.key }} · {{ item.label }}</button></div><div v-if="responseDraft.responseType === 'judgment'" class="matter-choice-list"><button v-for="[key,label] in judgmentOptions" :key="key" type="button" :class="{ selected: responseDraft.selectedOption === key }" @click="responseDraft.selectedOption = key">{{ label }}</button></div><label for="matter-response-content">你建议怎么做？<textarea id="matter-response-content" v-model="responseDraft.content" maxlength="2400" rows="3" placeholder="说说建议、信息或你的亲身经历" /></label><details class="matter-optional-fields"><summary>补充为什么、下一步和可能困难（可选）</summary><label>为什么这样建议<textarea v-model="responseDraft.why" maxlength="1000" rows="2" placeholder="决定或判断类型必须说明理由" /></label><label>可以怎么做<textarea v-model="responseDraft.steps" maxlength="1500" rows="3" placeholder="写出一两步可执行的做法" /></label><label>可能遇到什么困难<textarea v-model="responseDraft.risk" maxlength="800" rows="2" placeholder="提醒适用范围或可能风险" /></label></details><div class="matter-privacy-controls"><label><input v-model="responseDraft.firsthand" type="checkbox" /> 这是我的亲身经历</label><label><input v-model="responseDraft.isAnonymous" type="checkbox" /> 匿名显示</label></div><p v-if="hasOptionIssue || hasJudgmentIssue" class="campus-life-inline-state error" role="alert">选择方案或判断时，请同时选择一个选项并说明原因。</p><div class="matter-inline-actions"><button class="btn btn-primary" type="submit" :disabled="!responseDraft.content.trim() || responseBusy || hasOptionIssue || hasJudgmentIssue">{{ responseBusy ? '正在提交…' : '提交解决方案' }}</button><button class="btn btn-outline" type="button" @click="responseComposerOpen = false">取消</button></div></form>
          <CampusStateBlock :loading="page.loading.value" :loaded="Boolean(page.data.value)" :error="''" :empty="!responses.length" empty-title="目前还没有已审核的回应" empty-description="这里不会用示例回答填充。可以分享亲身经历、信息或一步具体做法。">
            <article v-for="response in responses" :key="response.id" class="matter-response-card"><header class="matter-response-head"><div><span class="campus-life-tag">{{ responseTypeLabel(response) }}</span><span>{{ response.authorLabel }} · {{ dateLabel(response.created_at) }}</span></div><span v-if="response.verifiedHelpful" class="matter-verified-badge">已验证有帮助</span><span v-else-if="response.adopted" class="matter-adopted-badge">楼主采纳</span><span v-else-if="response.review_status === 'pending_review' && response.isMine" class="matter-pending-badge">审核中</span></header><p class="matter-response-content">{{ response.content }}</p><p v-if="response.why" class="matter-response-field"><b>为什么：</b>{{ response.why }}</p><p v-if="response.steps" class="matter-response-field"><b>可以怎么做：</b>{{ response.steps }}</p><p v-if="response.risk" class="matter-response-field"><b>可能的困难：</b>{{ response.risk }}</p><p v-if="response.selected_option && matter.intent === 'decision'" class="matter-response-field"><b>我会选 {{ response.selected_option }}：</b>{{ response.why }}</p><p v-if="verifiedText(response)" class="matter-verified-text">{{ verifiedText(response) }}</p><div v-if="response.review_status === 'rejected' && response.isMine" class="matter-empty-inline">审核意见：{{ response.review_reason || '请修改后再分享。' }}</div><div class="matter-response-actions"><button v-if="response.isMine" type="button" @click="setResponsePrivacy(response)">{{ response.is_anonymous ? '改为显示昵称' : '改为匿名' }}</button><button v-if="!isMine && response.review_status === 'approved'" type="button" :aria-pressed="response.myFeedback === responseFeedbackType(response)" @click="sendFeedback(response)">{{ responseFeedbackLabel(response) }} · {{ toggleFeedback(response) }}</button><button v-if="isMine && response.review_status === 'approved'" type="button" @click="adopt(response)">{{ response.adopted ? '已采纳' : '采纳这个办法' }}</button><button v-if="isMine && response.review_status === 'approved'" type="button" @click="openAction(response)">我去试试</button><button v-if="!response.isMine && response.review_status === 'approved'" type="button" @click="openReport('matter_response',response.id)">举报</button><button v-if="response.isMine" type="button" @click="removeResponse(response)">删除</button><button v-if="deleteConfirm === response.id && response.isMine" class="danger" type="button" @click="removeResponse(response)">确认删除</button></div><form v-if="actionResponseId === response.id" class="matter-action-form" @submit.prevent="startAction"><label for="matter-action-text">我的下一步<textarea id="matter-action-text" v-model="actionText" maxlength="500" rows="2" placeholder="把建议改成你准备实际做的一步" /></label><label>什么时候做<select v-model="actionDueChoice"><option value="">自己决定时间</option><option value="today">今天</option><option value="tomorrow">明天</option></select></label><div class="matter-inline-actions"><button class="btn btn-primary" type="submit" :disabled="!actionText.trim() || actionBusy">{{ actionBusy ? '正在保存…' : '保存下一步并加入待办' }}</button><button class="btn btn-outline" type="button" @click="actionResponseId = ''">取消</button></div></form></article>
          </CampusStateBlock>
          <p v-if="localTaskError" class="campus-life-inline-state error" role="alert">{{ localTaskError }} <RouterLink to="/tasks">打开待办</RouterLink></p>
          <div v-if="isMine && actions.length" class="matter-next-steps"><h3>我的下一步</h3><article v-for="item in actions" :key="item.id" class="matter-next-step"><div><b>{{ item.action_text }}</b><small>{{ item.due_on ? `计划：${dateLabel(item.due_on)}` : '时间由你决定' }}<template v-if="item.local_task_id"> · 已加入本机待办</template></small></div><RouterLink to="/tasks">查看待办<ArrowRight aria-hidden="true" /></RouterLink></article></div>
        </section>

        <section v-if="isMine" class="campus-life-panel matter-outcome-panel">
          <div class="matter-section-heading"><div><h2>后来怎么样？</h2><p>你来确认结果。只有选择“解决了”后，平台才会把它标记为已解决。</p></div></div>
          <article v-for="item in outcomes" :key="item.id" class="matter-outcome-record"><span class="campus-life-tag">{{ matterOutcomeLabels[item.outcome] }}</span><p v-if="item.note">{{ item.note }}</p><small>{{ dateLabel(item.created_at) }}</small></article>
          <form class="matter-outcome-form" @submit.prevent="submitOutcome"><label>对应的下一步<select v-model="outcomeDraft.actionId"><option value="">这次没有对应的下一步</option><option v-for="item in actions" :key="item.id" :value="item.id">{{ item.action_text }}</option></select></label><label>后来发生了什么？<select v-model="outcomeDraft.outcome"><option v-for="[key,label] in Object.entries(matterOutcomeLabels)" :key="key" :value="key">{{ label }}</option></select></label><label>补充一句（可选）<textarea v-model="outcomeDraft.note" maxlength="1000" rows="2" placeholder="后来我……" /></label><button class="btn btn-primary" type="submit" :disabled="outcomeBusy">{{ outcomeBusy ? '正在保存…' : '记录后来结果' }}</button></form>
        </section>

        <section v-if="isMine" class="campus-life-panel matter-owner-settings">
          <h2>隐私和后续设置</h2><div class="matter-privacy-controls"><label><input v-model="preferencesDraft.isAnonymous" type="checkbox" /> 匿名显示</label><label><input v-model="preferencesDraft.allowClarifications" type="checkbox" /> 允许关键澄清</label><label><input v-model="preferencesDraft.showOutcomes" type="checkbox" /> 允许同校同学查看后续结果</label></div><div class="matter-inline-actions"><button class="btn btn-outline" type="button" @click="savePreferences">保存设置</button><button v-if="matter.review_status !== 'pending_review'" type="button" class="matter-delete-button" @click="removeMatter">{{ deleteConfirm === 'matter' ? '再次点击确认删除这件事' : '删除这件事' }}</button></div>
        </section>
        <p v-if="page.actionError.value" class="campus-life-inline-state error" role="alert">{{ page.actionError.value }}</p><p v-if="notice || page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ notice || page.notice.value }}</p>
        <details v-if="reportTarget" class="campus-life-panel matter-report-panel" open><summary>举报内容</summary><form @submit.prevent="submitReport"><label>举报原因<select v-model="reportDraft.reason"><option v-for="[key,label] in Object.entries(campusReportReasons)" :key="key" :value="key">{{ label }}</option></select></label><label>补充说明（可选）<textarea v-model="reportDraft.detail" maxlength="1000" rows="3" placeholder="说明需要核实的具体内容" /></label><div class="matter-inline-actions"><button class="btn btn-primary" type="submit" :disabled="reportBusy">{{ reportBusy ? '正在提交…' : '提交举报' }}</button><button class="btn btn-outline" type="button" @click="reportTarget = null">取消</button></div></form></details>
        <details v-if="!isMine && matter.review_status === 'approved'" class="matter-report-entry"><summary><Flag aria-hidden="true" />举报这件事</summary><button type="button" @click="openReport('matter',matter.id)">填写举报说明</button></details>
      </template>
    </CampusStateBlock>
  </CampusLifeLayout>
</template>

<style scoped>
.matter-detail-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.matter-back-link{display:inline-flex;align-items:center;gap:7px;color:var(--primary);font-size:var(--fs-12);text-decoration:none}.matter-back-link svg{width:17px;height:17px}.matter-story{gap:18px}.matter-story-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;color:var(--muted);font-size:var(--fs-11)}.matter-story h2{font-size:clamp(21px,3vw,28px);line-height:1.45;overflow-wrap:anywhere}.matter-story section{display:grid;gap:8px}.matter-story h3,.matter-decision-summary h3,.matter-next-steps h3{margin:0;font-size:var(--fs-13)}.matter-original-content,.matter-intake-context p{margin:0;color:var(--text);font-size:var(--fs-13);line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.matter-intent-block{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.matter-intent-block h3{margin-right:4px}.matter-related-link{display:inline-flex;align-items:center;gap:7px;color:var(--primary);font-size:var(--fs-12);text-decoration:none}.matter-related-link svg{width:17px;height:17px}.matter-human-signals{display:flex;flex-wrap:wrap;gap:9px;padding-top:13px;border-top:1px solid var(--border)}.matter-human-signals button,.matter-response-actions button{min-height:40px;padding:8px 11px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-11)}.matter-human-signals button[aria-pressed=true],.matter-response-actions button[aria-pressed=true]{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.matter-human-signals b{margin-left:4px;font-variant-numeric:tabular-nums}.matter-decision-summary{display:grid;gap:12px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}.matter-decision-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.matter-decision-head span,.matter-decision-summary>p,.matter-decision-reasons{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.8}.matter-vote-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.matter-vote-column{display:grid;gap:6px}.matter-vote-column>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--fs-11)}.matter-vote-column strong{font-variant-numeric:tabular-nums}.matter-vote-track{height:7px;overflow:hidden;border-radius:999px;background:var(--border)}.matter-vote-track span{display:block;height:100%;border-radius:inherit;background:var(--primary)}.matter-owner-choice,.matter-owner-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.matter-owner-choice label,.matter-owner-controls label{display:flex;align-items:center;gap:7px;font-size:var(--fs-11)}.matter-owner-choice input,.matter-owner-choice select,.matter-owner-controls select,.matter-response-form select,.matter-outcome-form select,.matter-report-panel select{min-height:42px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:16px}.matter-owner-choice input{flex:1;min-width:140px}.matter-owner-controls{padding-top:14px;border-top:1px solid var(--border)}.matter-owner-controls label{margin-right:auto}.matter-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.matter-section-heading h2{font-size:var(--fs-18)}.matter-section-heading p{margin:5px 0 0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}.matter-empty-inline{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.matter-clarifications,.matter-responses,.matter-outcome-panel,.matter-owner-settings{gap:16px}.matter-clarification-card{display:grid;gap:9px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg)}.matter-clarification-head,.matter-response-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:var(--fs-10)}.matter-clarification-head span:first-child{font-weight:var(--fw-650)}.matter-clarification-card>p{margin:0;font-size:var(--fs-12);line-height:1.8;white-space:pre-wrap}.matter-clarification-answer{padding:10px;border-radius:var(--radius-8);background:var(--card);color:var(--primary)}.matter-clarification-card textarea,.matter-clarification-form textarea,.matter-response-form textarea,.matter-action-form textarea,.matter-outcome-form textarea,.matter-report-panel textarea{width:100%;box-sizing:border-box;min-height:76px;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;font-size:16px;line-height:1.7;resize:vertical}.matter-clarification-form,.matter-response-form,.matter-action-form,.matter-outcome-form,.matter-report-panel form{display:grid;gap:12px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}.matter-clarification-form label,.matter-response-form label,.matter-action-form label,.matter-outcome-form label,.matter-report-panel label{display:grid;gap:6px;font-size:var(--fs-11);font-weight:var(--fw-600)}.matter-inline-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.matter-pending-badge,.matter-verified-badge,.matter-adopted-badge{padding:4px 8px;border-radius:999px;font-size:var(--fs-10)}.matter-pending-badge{background:var(--bg-tint);color:var(--muted)}.matter-verified-badge{background:color-mix(in srgb,var(--success) 13%,var(--card));color:var(--success);font-weight:var(--fw-650)}.matter-adopted-badge{background:var(--primary-soft);color:var(--primary)}.matter-response-card{display:grid;gap:11px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card)}.matter-response-head>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.matter-response-content,.matter-response-field{margin:0;color:var(--text);font-size:var(--fs-12);line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.matter-response-field{color:var(--muted)}.matter-response-field b{color:var(--text);font-weight:var(--fw-600)}.matter-verified-text{margin:0;padding:10px 12px;border-radius:var(--radius-9);background:color-mix(in srgb,var(--success) 10%,var(--card));color:var(--success);font-size:var(--fs-11);line-height:1.7}.matter-response-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding-top:9px;border-top:1px solid var(--border)}.matter-response-actions .danger,.matter-delete-button{color:var(--danger)}.matter-action-form{margin-top:4px}.matter-action-form label:nth-child(2){display:flex;align-items:center;gap:9px}.matter-action-form select{min-height:40px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit}.matter-next-steps{display:grid;gap:10px;padding-top:14px;border-top:1px solid var(--border)}.matter-next-step{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-9)}.matter-next-step>div{display:grid;gap:5px;min-width:0}.matter-next-step b{font-size:var(--fs-12);overflow-wrap:anywhere}.matter-next-step small{color:var(--muted);font-size:var(--fs-10)}.matter-next-step a{display:inline-flex;align-items:center;flex:none;gap:5px;color:var(--primary);font-size:var(--fs-11);text-decoration:none}.matter-next-step svg{width:14px;height:14px}.matter-outcome-record{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-9)}.matter-outcome-record p{flex:1;min-width:130px;margin:0;font-size:var(--fs-11);line-height:1.7}.matter-outcome-record small{color:var(--muted);font-size:var(--fs-10)}.matter-outcome-form{grid-template-columns:repeat(2,minmax(0,1fr))}.matter-outcome-form label:nth-child(3){grid-column:1/-1}.matter-outcome-form button{justify-self:start}.matter-owner-settings>h2{font-size:var(--fs-17)}.matter-owner-settings .matter-privacy-controls{display:flex;flex-wrap:wrap;gap:10px 16px}.matter-privacy-controls label{display:flex;align-items:center;gap:7px;min-height:38px;color:var(--muted);font-size:var(--fs-11)}.matter-privacy-controls input{width:17px;height:17px;accent-color:var(--primary)}.matter-delete-button{min-height:40px;padding:8px 11px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);font:inherit;font-size:var(--fs-11)}.matter-report-panel summary,.matter-report-entry summary{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:var(--fs-11);cursor:pointer;list-style:none}.matter-report-panel summary::-webkit-details-marker,.matter-report-entry summary::-webkit-details-marker{display:none}.matter-report-panel form{margin-top:14px}.matter-report-entry{padding:12px 0}.matter-report-entry summary svg{width:15px;height:15px}.matter-report-entry button{margin-top:10px;color:var(--primary);font:inherit;font-size:var(--fs-11)}.matter-safety{background:color-mix(in srgb,var(--danger) 8%,var(--card));color:var(--text)}
@media(max-width:760px){.matter-vote-columns,.matter-outcome-form{grid-template-columns:1fr}.matter-outcome-form label:nth-child(3){grid-column:auto}.matter-owner-choice,.matter-owner-controls{align-items:stretch;flex-direction:column}.matter-owner-choice label,.matter-owner-controls label{width:100%;justify-content:space-between}.matter-owner-choice input,.matter-owner-choice select,.matter-owner-controls select{width:100%}.matter-response-actions button{flex:1}.matter-inline-actions>*{flex:1;justify-content:center}.matter-section-heading{align-items:flex-start}.matter-response-head{align-items:flex-start}.matter-next-step{align-items:flex-start;flex-direction:column}.matter-next-step a{min-height:38px}.matter-detail-toolbar .btn{min-height:44px}}
</style>
