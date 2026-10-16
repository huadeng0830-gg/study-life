<script setup>
import PageHeader from '../../components/PageHeader.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { accountOpen, accountUser } from '../../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../../composables/accountVerification.js'
import { applyCampusReviewer, myCampusReviewerApplication, replyToCampusReviewerApplication } from '../../services/campusCommunity.js'
import { Button } from '../../components/ui/button'
import { CAMPUS_BEAN_RULES, campusErrorMessage } from '../../composables/campusContentModel.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import '../../components/campus/campus-life.css'

const application = ref(/** @type {any} */ (null))
const applicationLoading = ref(false)
const applying = ref(false)
const replyingToApplication = ref(false)
// 两条错误线：公开列表读不到时整块内容要换成错误态；
// 某个后台刷新失败不该把用户刚看到的错误顶掉，也不该盖住列表。
const error = ref('')
const notice = ref('')
const applicationOpen = ref(false)
const reviewerReason = ref('')
const applicantResponse = ref('')
const applicationRequest = useCampusRequest()
const applyRequest = useCampusRequest()
const replyRequest = useCampusRequest()
const hasVerifiedEmail = computed(() => hasVerifiedContactEmail())
async function refreshApplication() {
  if (!hasVerifiedEmail.value) { application.value = null; applicationLoading.value = false; return }
  const revision = applicationRequest.begin()
  applicationLoading.value = true
  try {
    const result = (await myCampusReviewerApplication()).application
    if (applicationRequest.live(revision)) application.value = result
  } catch (cause) {
    if (applicationRequest.live(revision)) error.value = campusErrorMessage(cause, '审核员申请状态暂时无法读取。')
  } finally {
    if (applicationRequest.live(revision)) applicationLoading.value = false
  }
}
watch(() => accountUser.value?.id, () => { application.value = null; error.value = ''; notice.value = ''; reviewerReason.value = ''; applicantResponse.value = ''; applicationOpen.value = false; applying.value = false; replyingToApplication.value = false; void refreshApplication() }, { flush: 'sync' })
onMounted(() => { void refreshApplication() })
async function applyReviewer() {
  if (!hasVerifiedEmail.value) { accountOpen.value = true; return }
  if (applying.value) return
  error.value = ''; notice.value = ''
  if (reviewerReason.value.trim().length < 10) { error.value = '请至少用 10 个字说明申请理由。'; return }
  applying.value = true
  const revision = applyRequest.begin()
  try {
    await applyCampusReviewer(reviewerReason.value.trim())
    if (!applyRequest.live(revision)) return
    reviewerReason.value = ''; applicationOpen.value = false
    notice.value = '申请已提交。总管理员审核后会在这里更新处理结果。'
    await refreshApplication()
  } catch (cause) { if (applyRequest.live(revision)) error.value = campusErrorMessage(cause, '申请没有完成，请稍后重试。') }
  finally { if (applyRequest.live(revision)) applying.value = false }
}

async function replyToApplication() {
  if (!application.value || replyingToApplication.value) return
  const response = applicantResponse.value.trim()
  if (response.length < 3) { error.value = '请至少填写 3 个字的补充内容。'; return }
  replyingToApplication.value = true; error.value = ''; notice.value = ''
  const revision = replyRequest.begin()
  try {
    await replyToCampusReviewerApplication(application.value.id, response)
    if (!replyRequest.live(revision)) return
    applicantResponse.value = ''
    notice.value = '补充材料已提交，总管理员可以继续处理申请。'
    await refreshApplication()
  } catch (cause) { if (replyRequest.live(revision)) error.value = campusErrorMessage(cause, '补充材料没有提交。') }
  finally { if (replyRequest.live(revision)) replyingToApplication.value = false }
}

</script>

<template><div class="page reviewer-application-page"><PageHeader class="page-head" title="申请校园审核员" description="参与校园内容审核，查看申请进度与管理员说明。">
      <RouterLink to="/campus">校园</RouterLink></PageHeader><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>    <section v-if="hasVerifiedEmail" id="reviewer-application" class="reviewer-invite">
      <div><span class="compose-index">贡献豆获取方式</span><h2>参与校园审核</h2><p>已验证邮箱并填写学校资料后可申请；审核范围由总管理员审批和设置。{{ CAMPUS_BEAN_RULES.summary }}</p><p>每位审核员每月随机抽查约 10%。发现实质错判时会说明理由并更正；只追回未花掉的贡献豆，不足部分从后续审核奖励中抵扣。30 天内出现 2 次实质错判会提醒总管理员评估权限。</p><p>另一种获得方式：{{ CAMPUS_BEAN_RULES.feedback }}每条只发一次。</p><p v-if="application" class="reviewer-application-status">申请状态：{{ ({pending:'等待总管理员审批',approved:'已批准',declined:'暂未通过',withdrawn:'已撤回'})[application.status] || application.status }} · {{ application.scope_school || application.school }} {{ application.scope_campus || application.campus }}</p><p v-if="application?.owner_note" class="reviewer-application-status">管理员说明：{{ application.owner_note }}</p><p v-if="application?.applicant_response" class="reviewer-application-status">我已补充：{{ application.applicant_response }}</p></div>
      <form v-if="application?.status === 'pending' && application.owner_note" class="reviewer-application-form" @submit.prevent="replyToApplication"><label>补充材料<textarea v-model="applicantResponse" maxlength="1000" rows="3" placeholder="根据管理员要求补充说明或证明信息" /></label><Button type="submit" :disabled="replyingToApplication">{{ replyingToApplication ? '正在提交…' : '提交补充材料' }}</Button></form>
      <Button v-if="!application || ['declined','withdrawn'].includes(application.status)" variant="outline" :aria-expanded="applicationOpen" @click="applicationOpen = !applicationOpen">{{ applicationOpen ? '收起申请' : application ? '重新申请' : '申请成为审核员' }}</Button>
      <form v-if="applicationOpen && (!application || ['declined','withdrawn'].includes(application.status))" class="reviewer-application-form" @submit.prevent="applyReviewer"><label>申请理由<textarea v-model="reviewerReason" maxlength="1000" rows="4" placeholder="介绍你熟悉的校园范围，以及希望参与审核的原因…" /></label><Button type="submit" :disabled="applying">{{ applying ? '正在提交…' : '提交申请' }}</Button></form>
    </section>
    <section v-else id="reviewer-application" class="reviewer-invite"><div><span class="compose-index">贡献豆获取方式</span><h2>参与校园审核</h2><p>审核员需验证邮箱并填写学校资料，由总管理员批准并设置范围。{{ CAMPUS_BEAN_RULES.summary }}每月随机抽查约 10%。</p><p>产品反馈可选择匿名或署名，通过安全检查后公开，只有总管理员标为“已解决”并设置 {{ CAMPUS_BEAN_RULES.bounds }}时才发放贡献豆。</p><p>登录、验证邮箱并完善学校资料后即可申请；审核错误按规则复核与抵扣，充值豆不会受影响。</p></div><Button variant="outline" @click="accountOpen = true">{{ accountUser ? '打开我的账号' : '登录后申请' }}</Button></section>

</div></template>
<style scoped>
.reviewer-application-page{display:grid;gap:22px;min-width:0}.reviewer-invite{display:grid;gap:18px;padding:22px;border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.reviewer-invite>*{min-width:0}.reviewer-invite h2{margin:8px 0;font-size:var(--fs-18)}.reviewer-invite p{max-width:80ch;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.reviewer-invite .reviewer-application-status{padding:10px;border-radius:var(--radius-8);background:var(--bg-tint);white-space:pre-wrap}.compose-index{font-size:var(--fs-11);color:var(--muted)}.reviewer-application-form,.reviewer-application-form label{display:grid;gap:12px}.reviewer-application-form label{font-size:var(--fs-12)}.reviewer-application-form textarea{box-sizing:border-box;width:100%;max-width:100%;min-width:0;min-height:110px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;line-height:1.7;resize:vertical}.reviewer-application-form>button,.reviewer-invite>button{justify-self:start}.reviewer-application-form textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}@media(max-width:760px){.reviewer-invite{padding:16px}.reviewer-application-form textarea{font-size:16px}.reviewer-application-form>button,.reviewer-invite>button{justify-self:stretch}}
</style>
