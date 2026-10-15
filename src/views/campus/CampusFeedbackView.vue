<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { accountOpen, accountUser } from '../../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../../composables/accountVerification.js'
import { campusFeedbackPublicList, myCampusFeedback, submitCampusFeedback, applyCampusReviewer, myCampusReviewerApplication, replyToCampusReviewerApplication, campusFeedbackMessages } from '../../services/campusCommunity.js'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { CAMPUS_BEAN_RULES, campusErrorMessage } from '../../composables/campusContentModel.js'
import { campusDateLabel } from '../../composables/campusFormatting.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import '../../components/campus/campus-life.css'

const statusLabels = { pending: '待回应', processing: '处理中', resolved: '已解决', not_adopted: '暂不采纳' }
const categoryLabels = { product: '产品体验', campus: '校园功能', accessibility: '无障碍', other: '其他' }
const filters = [{ value: '', label: '全部建议' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]
const selectedStatus = ref('')
const items = ref(/** @type {any[]} */ ([]))
const mine = ref(/** @type {any[]} */ ([]))
const application = ref(/** @type {any} */ (null))
const loading = ref(false)
const mineLoading = ref(false)
const applicationLoading = ref(false)
const submitting = ref(false)
const applying = ref(false)
const replyingToApplication = ref(false)
// 两条错误线：公开列表读不到时整块内容要换成错误态；
// 某个后台刷新失败不该把用户刚看到的错误顶掉，也不该盖住列表。
const loadError = ref('')
const error = ref('')
const notice = ref('')
const mineOpen = ref(false)
const applicationOpen = ref(false)
const draft = reactive({ category: 'product', title: '', body: '' })
const reviewerReason = ref('')
const applicantResponse = ref('')
const privateThreads = reactive(/** @type {Record<string, any[]>} */ ({}))
const privateDrafts = reactive(/** @type {Record<string, string>} */ ({}))
const privateBusy = ref('')
const request = useCampusRequest()
const mineRequest = useCampusRequest()
const applicationRequest = useCampusRequest()
const privateRequest = useCampusRequest()
const submitRequest = useCampusRequest()
const applyRequest = useCampusRequest()
const replyRequest = useCampusRequest()
const offset = ref(0)
const total = ref(0)
const pageSize = 20
const hasVerifiedEmail = computed(() => hasVerifiedContactEmail())
const signedIn = computed(() => Boolean(accountUser.value?.id))
const emptyMessage = computed(() => selectedStatus.value ? `当前没有“${statusLabels[selectedStatus.value]}”的公开建议。` : '建议经安全检查后会匿名出现在这里。')

async function refresh() {
  const revision = request.begin()
  loading.value = true
  loadError.value = ''
  try {
    const result = await campusFeedbackPublicList({ status: selectedStatus.value, limit: pageSize, offset: offset.value })
    if (request.live(revision)) { items.value = result.items || []; total.value = Number.isInteger(result.total) ? result.total : items.value.length }
  } catch (cause) {
    if (request.live(revision)) loadError.value = campusErrorMessage(cause, '公开建议暂时无法读取。')
  } finally {
    if (request.live(revision)) loading.value = false
  }
}
async function refreshMine() {
  if (!signedIn.value) { mine.value = []; return }
  const revision = mineRequest.begin()
  mineLoading.value = true
  try {
    const result = (await myCampusFeedback()).items || []
    if (mineRequest.live(revision)) mine.value = result
  } catch (cause) {
    // 后台刷新失败不该抢占前台动作的错误提示，只提示在这块区域里。
    if (mineRequest.live(revision)) error.value = campusErrorMessage(cause, '暂时无法读取你的建议。')
  } finally {
    if (mineRequest.live(revision)) mineLoading.value = false
  }
}
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
watch(selectedStatus, () => { offset.value = 0; void refresh() })
async function changePage(next) { offset.value = next; await refresh() }
watch(() => accountUser.value?.id, () => {
  request.invalidate()
  mine.value = []
  application.value = null
  error.value = ''
  notice.value = ''
  submitting.value = false; applying.value = false; replyingToApplication.value = false
  mineLoading.value = false; applicationLoading.value = false; privateBusy.value = ''
  draft.title = ''; draft.body = ''; reviewerReason.value = ''; applicantResponse.value = ''
  applicationOpen.value = false
  Object.keys(privateDrafts).forEach((key) => delete privateDrafts[key])
  void refresh()
  Object.keys(privateThreads).forEach((key) => delete privateThreads[key])
  if (mineOpen.value) void refreshMine()
  void refreshApplication()
}, { flush: 'sync' })
watch(mineOpen, (open) => { if (open) void refreshMine() })
onMounted(() => { void refresh(); void refreshApplication() })

async function submit() {
  if (!signedIn.value) { accountOpen.value = true; return }
  if (submitting.value) return
  error.value = ''; notice.value = ''
  if (draft.title.trim().length < 4 || draft.body.trim().length < 10) { error.value = '标题至少 4 个字，建议内容至少 10 个字。'; return }
  submitting.value = true
  const revision = submitRequest.begin()
  try {
    await submitCampusFeedback({ ...draft })
    if (!submitRequest.live(revision)) return
    draft.title = ''; draft.body = ''; draft.category = 'product'
    notice.value = '已收到你的建议。内容完成安全检查后会匿名公开。'
    mineOpen.value = true
    await refreshMine()
  } catch (cause) { if (submitRequest.live(revision)) error.value = campusErrorMessage(cause, '提交没有完成，请稍后重试。') }
  finally { if (submitRequest.live(revision)) submitting.value = false }
}

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

async function openPrivateThread(item) {
  const revision = privateRequest.begin()
  privateBusy.value = item.id
  try {
    const result = (await campusFeedbackMessages(item.id)).messages || []
    if (privateRequest.live(revision)) privateThreads[item.id] = result
  } catch (cause) {
    if (privateRequest.live(revision)) error.value = campusErrorMessage(cause, '私信暂时无法读取。')
  } finally {
    if (privateRequest.live(revision)) privateBusy.value = ''
  }
}
async function sendPrivateMessage(item) {
  const body = (privateDrafts[item.id] || '').trim()
  if (!body || privateBusy.value) return
  const revision = privateRequest.begin()
  privateBusy.value = item.id
  try {
    const result = (await campusFeedbackMessages(item.id, body)).messages || []
    if (!privateRequest.live(revision)) return
    privateThreads[item.id] = result
    privateDrafts[item.id] = ''
  } catch (cause) {
    if (privateRequest.live(revision)) error.value = campusErrorMessage(cause, '私信没有发送。')
  } finally {
    if (privateRequest.live(revision)) privateBusy.value = ''
  }
}
function handlePrivateThreadToggle(event, item) {
  const details = /** @type {HTMLDetailsElement|null} */ (event.currentTarget)
  if (details?.open) void openPrivateThread(item)
}
</script>

<template>
  <div class="page campus-feedback-page">
    <header class="page-head">
      <div class="page-head-main"><RouterLink to="/campus" class="text-button">校园</RouterLink><p class="campus-feedback-kicker">把校园一起变得更好</p><h1 class="page-title">反馈与建议</h1><p class="page-desc">公开查看处理进度与管理员回复。提交内容经安全检查后匿名展示，不开放评论和投票。</p></div>
      <Button as-child variant="outline"><RouterLink to="/campus">返回校园</RouterLink></Button>
    </header>

    <div v-if="error" class="campus-feedback-notice error" role="alert">{{ error }}</div>
    <div v-if="notice" class="campus-feedback-notice success" role="status">{{ notice }}</div>

    <section class="campus-feedback-compose" aria-labelledby="feedback-compose-title">
      <div class="compose-copy"><span class="compose-index">01 / 留下一条建议</span><h2 id="feedback-compose-title">你希望哪里变得更好？</h2><p>建议会先进入管理员安全检查队列，公开页面不会展示你的账号、学校、校区或联系方式。</p></div>
      <form class="compose-form" @submit.prevent="submit">
        <label>建议分类<select v-model="draft.category"><option v-for="(label,value) in categoryLabels" :key="value" :value="value">{{ label }}</option></select></label>
        <label>标题<input v-model="draft.title" maxlength="100" placeholder="用一句话概括你的想法" :disabled="submitting" required /></label>
        <label>具体建议<textarea v-model="draft.body" maxlength="3000" rows="5" placeholder="描述当前遇到的情况，以及你希望看到的改进…" :disabled="submitting" required /></label>
        <div class="compose-footer"><span>{{ signedIn ? '公开展示为“匿名同学”；管理员可通过站内私信联系你。' : '登录后即可提交；公开展示不会出现账号身份。' }}</span><Button type="submit" :disabled="submitting">{{ submitting ? '正在提交…' : signedIn ? '提交建议' : '登录后提交' }}</Button></div>
      </form>
    </section>

    <section v-if="hasVerifiedEmail" id="reviewer-application" class="reviewer-invite">
      <div><span class="compose-index">贡献豆获取方式</span><h2>参与校园审核</h2><p>已验证邮箱并填写学校资料后可申请；审核范围由总管理员审批和设置。{{ CAMPUS_BEAN_RULES.summary }}</p><p>每位审核员每月随机抽查约 10%。发现实质错判时会说明理由并更正；只追回未花掉的贡献豆，不足部分从后续审核奖励中抵扣。30 天内出现 2 次实质错判会提醒总管理员评估权限。</p><p>另一种获得方式：{{ CAMPUS_BEAN_RULES.feedback }}每条只发一次。</p><p v-if="application" class="reviewer-application-status">申请状态：{{ ({pending:'等待总管理员审批',approved:'已批准',declined:'暂未通过',withdrawn:'已撤回'})[application.status] || application.status }} · {{ application.scope_school || application.school }} {{ application.scope_campus || application.campus }}</p><p v-if="application?.owner_note" class="reviewer-application-status">管理员说明：{{ application.owner_note }}</p><p v-if="application?.applicant_response" class="reviewer-application-status">我已补充：{{ application.applicant_response }}</p></div>
      <form v-if="application?.status === 'pending' && application.owner_note" class="reviewer-application-form" @submit.prevent="replyToApplication"><label>补充材料<textarea v-model="applicantResponse" maxlength="1000" rows="3" placeholder="根据管理员要求补充说明或证明信息" /></label><Button type="submit" :disabled="replyingToApplication">{{ replyingToApplication ? '正在提交…' : '提交补充材料' }}</Button></form>
      <Button v-if="!application || ['declined','withdrawn'].includes(application.status)" variant="outline" :aria-expanded="applicationOpen" @click="applicationOpen = !applicationOpen">{{ applicationOpen ? '收起申请' : application ? '重新申请' : '申请成为审核员' }}</Button>
      <form v-if="applicationOpen && (!application || ['declined','withdrawn'].includes(application.status))" class="reviewer-application-form" @submit.prevent="applyReviewer"><label>申请理由<textarea v-model="reviewerReason" maxlength="1000" rows="4" placeholder="介绍你熟悉的校园范围，以及希望参与审核的原因…" /></label><Button type="submit" :disabled="applying">{{ applying ? '正在提交…' : '提交申请' }}</Button></form>
    </section>
    <section v-else id="reviewer-application" class="reviewer-invite"><div><span class="compose-index">贡献豆获取方式</span><h2>参与校园审核</h2><p>审核员需验证邮箱并填写学校资料，由总管理员批准并设置范围。{{ CAMPUS_BEAN_RULES.summary }}每月随机抽查约 10%。</p><p>建议通过安全检查后匿名公开，只有总管理员标为“已解决”并设置 {{ CAMPUS_BEAN_RULES.bounds }}时才发放贡献豆。</p><p>登录、验证邮箱并完善学校资料后即可申请；审核错误按规则复核与抵扣，充值豆不会受影响。</p></div><Button variant="outline" @click="accountOpen = true">{{ accountUser ? '打开我的账号' : '登录后申请' }}</Button></section>

    <section class="campus-feedback-public" aria-labelledby="feedback-public-title">
      <div class="feedback-section-heading"><div><span class="compose-index">02 / 公开进度</span><h2 id="feedback-public-title">大家的建议</h2><p>公开内容由管理员检查后发布；不采纳的建议会说明原因。</p></div><div class="feedback-filters" role="group" aria-label="建议状态筛选"><button v-for="filter in filters" :key="filter.value" type="button" :aria-pressed="selectedStatus === filter.value" :class="{ active: selectedStatus === filter.value }" @click="selectedStatus = filter.value">{{ filter.label }}</button></div></div>
      <div v-if="loadError" class="campus-feedback-notice error" role="alert">{{ loadError }}</div>
      <div v-else-if="loading" class="feedback-state" role="status">正在读取公开建议…</div>
      <div v-else-if="!items.length" class="feedback-state"><b>{{ emptyMessage }}</b><span>如果你遇到问题，也可以提交一条新的建议。</span><button type="button" class="btn btn-ghost" :disabled="loading" @click="refresh">重新读取</button></div>
      <div v-else class="feedback-list">
        <article v-for="item in items" :key="item.id" class="feedback-row">
          <div class="feedback-row-rail"><span class="feedback-dot" :class="`is-${item.status}`"></span><time>{{ campusDateLabel(item.created_at) }}</time></div>
          <div class="feedback-row-body"><div class="feedback-row-meta"><Badge variant="outline">{{ categoryLabels[item.category] || '建议' }}</Badge><Badge :variant="item.status === 'resolved' ? 'secondary' : 'outline'">{{ statusLabels[item.status] || item.status }}</Badge><span>匿名同学</span></div><h3>{{ item.title }}</h3><p class="feedback-text">{{ item.body }}</p><p v-if="item.reward_issued" class="feedback-reward">已解决 · 管理员设置奖励 {{ item.reward_beans || 0 }} 个贡献豆</p><div v-if="item.public_reply" class="admin-reply"><b>管理员回复</b><p>{{ item.public_reply }}</p></div><p v-if="item.status === 'not_adopted' && item.public_reason" class="not-adopted-note"><b>暂不采纳说明</b>{{ item.public_reason }}</p></div>
        </article>
      </div>
      <nav v-if="total > pageSize" class="feedback-pagination" aria-label="公开建议分页"><Button variant="outline" size="sm" :disabled="loading || offset === 0" @click="changePage(offset - pageSize)">上一页</Button><span>第 {{ Math.floor(offset / pageSize) + 1 }} / {{ Math.ceil(total / pageSize) }} 页 · {{ total }} 条</span><Button variant="outline" size="sm" :disabled="loading || offset + pageSize >= total" @click="changePage(offset + pageSize)">下一页</Button></nav>
    </section>

    <section v-if="accountUser" class="campus-feedback-account">
      <button class="account-section-toggle" type="button" :aria-expanded="mineOpen" @click="mineOpen = !mineOpen"><span><b>我的建议</b><small>查看安全检查、处理状态与私信</small></span><span>{{ mineOpen ? '收起 −' : '展开 +' }}</span></button>
      <div v-if="mineOpen" class="my-feedback-list">
        <p v-if="!signedIn" class="feedback-state">登录后可查看自己的建议和管理员站内回复。</p>
        <p v-else-if="mineLoading" class="feedback-state">正在读取你的提交…</p>
        <p v-else-if="!mine.length" class="feedback-state">你还没有提交建议。</p>
        <article v-for="item in mine" :key="item.id" class="my-feedback-row"><div><div class="feedback-row-meta"><Badge variant="outline">{{ item.visibility === 'pending_safety' ? '安全检查中' : item.visibility === 'hidden' ? '仅自己可见' : '已公开' }}</Badge><Badge variant="outline">{{ statusLabels[item.status] }}</Badge></div><h3>{{ item.title }}</h3><p>{{ item.public_reply || item.public_reason || '等待管理员更新。' }}</p><small v-if="item.reward_issued">本条建议贡献奖励：{{ item.reward_beans || 0 }} 三两豆</small></div><details class="private-thread" @toggle="handlePrivateThreadToggle($event,item)"><summary>站内联系</summary><div class="private-messages"><p v-for="message in privateThreads[item.id] || []" :key="message.id" :class="{ mine: message.sender_id === accountUser.id }">{{ message.body }}</p><form @submit.prevent="sendPrivateMessage(item)"><input v-model="privateDrafts[item.id]" maxlength="2000" aria-label="站内私信内容" placeholder="仅你与管理员可见" /><Button size="sm" type="submit" :disabled="privateBusy === item.id">发送</Button></form></div></details></article>
      </div>
    </section>

  </div>
</template>

<style scoped>
.campus-feedback-page{display:grid;gap:28px;max-width:1040px;margin:0 auto;padding-bottom:72px}.campus-feedback-page .page-head{align-items:flex-end}.campus-feedback-kicker,.compose-index{display:block;margin:0 0 8px;color:var(--success,#067654);font-size:var(--fs-11);font-weight:var(--fw-650);letter-spacing:.08em;text-transform:uppercase}.campus-feedback-compose{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:28px;padding:clamp(20px,4vw,36px);border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.compose-copy h2,.reviewer-invite h2{margin:0 0 10px;font-size:clamp(20px,3vw,27px);line-height:1.4}.compose-copy p,.reviewer-invite p,.feedback-section-heading p{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.compose-form,.reviewer-application-form{display:grid;gap:13px}.compose-form label,.reviewer-application-form label{display:grid;gap:6px;font-size:var(--fs-12);font-weight:var(--fw-600)}.compose-form input,.compose-form textarea,.compose-form select,.reviewer-application-form textarea,.private-messages input{width:100%;min-width:0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-13)}.compose-form textarea,.reviewer-application-form textarea{resize:vertical;line-height:1.7}.compose-form input:focus-visible,.compose-form textarea:focus-visible,.compose-form select:focus-visible,.reviewer-application-form textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.compose-footer{display:flex;align-items:center;justify-content:space-between;gap:14px}.compose-footer span{max-width:50ch;color:var(--muted);font-size:var(--fs-10);line-height:1.7}.campus-feedback-notice{padding:12px 15px;border-radius:var(--radius-9);font-size:var(--fs-12)}.campus-feedback-notice.error{background:var(--danger-soft);color:var(--danger)}.campus-feedback-notice.success{background:var(--bg-tint);color:var(--success)}.campus-feedback-public{display:grid;gap:17px}.feedback-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.feedback-section-heading h2{margin:0 0 5px;font-size:var(--fs-22)}.feedback-filters{display:flex;gap:5px;flex-wrap:wrap}.feedback-filters button{min-height:34px;padding:0 10px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:var(--fs-11)}.feedback-filters button.active{border-color:var(--border);background:var(--card);color:var(--text)}.feedback-list{border-top:1px solid var(--border)}.feedback-row{display:grid;grid-template-columns:112px minmax(0,1fr);gap:20px;padding:22px 4px;border-bottom:1px solid var(--border)}.feedback-row-rail{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:var(--fs-10)}.feedback-dot{width:8px;height:8px;border-radius:50%;background:var(--warning,#8a5a12)}.feedback-dot.is-resolved{background:var(--success,#067654)}.feedback-dot.is-not_adopted{background:var(--muted)}.feedback-row-body{min-width:0}.feedback-row-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:var(--muted);font-size:var(--fs-10)}.feedback-row h3,.my-feedback-row h3{margin:9px 0 7px;font-size:var(--fs-16);overflow-wrap:anywhere}.feedback-text,.my-feedback-row>div>p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.admin-reply,.not-adopted-note{margin-top:14px;padding:12px 14px;border-left:3px solid var(--success,#067654);background:var(--bg-tint);font-size:var(--fs-12)}.admin-reply b,.not-adopted-note b{display:block;margin-bottom:4px;color:var(--text)}.admin-reply p{margin:0;color:var(--muted);line-height:1.8;white-space:pre-wrap}.not-adopted-note{border-left-color:var(--warning,#8a5a12)}.feedback-state{display:grid;gap:6px;padding:30px 16px;border:1px dashed var(--border);border-radius:var(--radius-12);color:var(--muted);font-size:var(--fs-12);text-align:center}.feedback-state b{color:var(--text);font-weight:var(--fw-600)}.campus-feedback-account,.reviewer-invite{border-top:1px solid var(--border);padding-top:18px}.account-section-toggle{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border:0;background:transparent;color:var(--text);text-align:left;font:inherit}.account-section-toggle>span:first-child{display:grid;gap:4px}.account-section-toggle small{color:var(--muted);font-size:var(--fs-11)}.account-section-toggle>span:last-child{color:var(--primary);font-size:var(--fs-11)}.my-feedback-list{display:grid;gap:10px;margin-top:10px}.my-feedback-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.55fr);gap:16px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--card)}.my-feedback-row small{display:block;margin-top:8px;color:var(--success,#067654);font-size:var(--fs-10)}.private-thread summary{padding:8px;color:var(--primary);font-size:var(--fs-11);cursor:pointer}.private-messages{display:grid;gap:8px}.private-messages>p{justify-self:start;max-width:100%;margin:0;padding:8px 10px;border-radius:var(--radius-8);background:var(--bg-tint);font-size:var(--fs-11);white-space:pre-wrap;overflow-wrap:anywhere}.private-messages>p.mine{justify-self:end;background:var(--primary-soft)}.private-messages form{display:flex;gap:6px}.reviewer-invite{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:18px}.reviewer-invite>div{max-width:68ch}.reviewer-invite .reviewer-application-status{margin-top:8px;padding:8px 10px;border-radius:var(--radius-8);background:var(--bg-tint);font-size:var(--fs-11)}.reviewer-application-form{grid-column:1/-1;min-width:0;margin:0;align-content:start}.reviewer-application-form>button{justify-self:start;align-self:start}.reviewer-application-form p{font-size:var(--fs-11)}
.feedback-reward{margin:11px 0 0;color:var(--success,#067654);font-size:var(--fs-11);font-weight:var(--fw-650)}
@media(max-width:760px){.campus-feedback-compose{grid-template-columns:1fr;gap:18px}.feedback-section-heading{align-items:flex-start;flex-direction:column}.feedback-row{grid-template-columns:1fr;gap:8px}.my-feedback-row{grid-template-columns:1fr}.reviewer-invite{grid-template-columns:minmax(0,1fr)}.reviewer-invite>button{width:100%}.compose-footer{align-items:flex-start;flex-direction:column}.compose-footer :deep(button){width:100%;min-height:44px}.feedback-filters{overflow:auto;max-width:100%;flex-wrap:nowrap;padding-bottom:4px}.feedback-filters button{white-space:nowrap}}
.reviewer-invite>*{min-width:0}.reviewer-application-form :is(input,textarea),.compose-form :is(input,textarea,select){box-sizing:border-box;max-width:100%;min-width:0}.reviewer-application-form textarea{min-height:110px}.reviewer-application-form>button{min-height:44px}.feedback-pagination{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;color:var(--muted);font-size:var(--fs-11)}
@media(pointer:coarse){.campus-feedback-page :is(input,textarea,select){font-size:16px}.reviewer-application-form>button{justify-self:stretch;width:100%}}
</style>
