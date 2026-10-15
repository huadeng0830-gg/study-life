<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../../composables/accountVerification.js'
import { socialRequest } from '../../services/social.js'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { useCampusBeanWallet } from '../../composables/campusBeanWallet.js'
import { campusErrorMessage } from '../../composables/campusContentModel.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import { INVITATION_WEEKDAYS, normalizeAvailabilityPreferences } from '../../composables/availabilityPreferences.js'

const props = defineProps({ section: { type: String, required: true } })
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
const timeZones = [...new Set([browserTimeZone, 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/Los_Angeles', 'America/New_York'])]
// 区块序号集中在这里；以前是每个分支各写一个 "01 /"，再加一个分区要改两处。
const SECTION_INDEX = { profile: '01 / 我的资料', beans: '02 / 三两豆' }

const profileLoading = ref(false)
const profileSaving = ref(false)
const walletLoading = ref(false)
// 读取失败与保存失败分开：表单还在、用户刚填的内容没丢，
// 这时候该给的是「重新读取」而不是一句含糊的红色提示。
const loadError = ref('')
const saveError = ref('')
const notice = ref('')
const profile = ref(/** @type {any} */ (null))
const request = useCampusRequest()
const savingRequest = useCampusRequest()
const beans = useCampusBeanWallet()
const hasVerifiedEmail = computed(() => hasVerifiedContactEmail())
const signedIn = computed(() => Boolean(accountUser.value?.id))
const draft = reactive(blankProfile())
const wallet = beans.wallet
const ledger = beans.ledger

function blankProfile() {
  return { nickname: '', school: '', campus: '', emailDiscoverable: false, timezone: browserTimeZone,
    availabilityPreferences: normalizeAvailabilityPreferences() }
}
function applyProfile(value) {
  profile.value = value || null
  const empty = blankProfile()
  Object.assign(draft, empty, value || {})
  draft.availabilityPreferences = normalizeAvailabilityPreferences(value?.availabilityPreferences) || empty.availabilityPreferences
}
function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}
function ledgerType(item) {
  return ({ review_award: '校园审核奖励', audit_reversal: '复核调整', feedback_award: '建议处理奖励', purchase: '充值入账', redemption: '数字权益兑换', manual_adjustment: '管理员调整' })[item.entry_type] || '豆豆变动'
}

async function loadProfile() {
  if (!accountUser.value) return
  const revision = request.begin()
  profileLoading.value = true
  loadError.value = ''
  try {
    const result = (await socialRequest('profile_get')).profile
    // 之前没有代际判断：切到「三两豆」时，资料请求才回来，
    // applyProfile 会把草稿连同三两豆界面一起改掉。
    if (request.live(revision)) applyProfile(result)
  } catch (cause) {
    if (request.live(revision)) loadError.value = campusErrorMessage(cause, '账号资料暂时无法读取。')
  } finally {
    if (request.live(revision)) profileLoading.value = false
  }
}

async function saveProfile() {
  if (profileSaving.value || !accountUser.value) return
  saveError.value = ''
  notice.value = ''
  if (!draft.nickname.trim()) { saveError.value = '请填写昵称。'; return }
  const revision = savingRequest.begin()
  profileSaving.value = true
  try {
    const result = await socialRequest('profile_save', {
      nickname: draft.nickname, school: draft.school, campus: draft.campus,
      emailDiscoverable: hasVerifiedEmail.value ? draft.emailDiscoverable : false,
      timezone: draft.timezone, availabilityPreferences: { ...draft.availabilityPreferences },
    })
    if (savingRequest.live(revision)) { applyProfile(result.profile); notice.value = '个人资料与可约偏好已保存。' }
  } catch (cause) { if (savingRequest.live(revision)) saveError.value = campusErrorMessage(cause, '保存没有完成，请重试。') }
  finally { if (savingRequest.live(revision)) profileSaving.value = false }
}

// 切换分区时把上一分区的错误清掉：否则在「个人资料」保存失败后切到「三两豆」，
// 那里会挂着一句和它无关的红字。
watch(() => [accountUser.value?.id, props.section], (next, previous) => {
  request.invalidate()
  if (next[0] !== previous?.[0]) { applyProfile(null); profileSaving.value = false }
  loadError.value = ''
  saveError.value = ''
  notice.value = ''
  if (props.section === 'profile') void loadProfile()
  // beans 钱包由 useCampusBeanWallet 自己按账号监听，这里只需要反映加载态。
  if (props.section === 'beans') walletLoading.value = beans.loading.value
}, { immediate: true, flush: 'sync' })
watch(() => beans.loading.value, (value) => { walletLoading.value = value })
</script>

<template>
  <section v-if="section === 'profile'" class="account-community-settings">
    <div class="settings-heading"><span class="account-settings-index">{{ SECTION_INDEX.profile }}</span><h3>个人资料与校园范围</h3><p>学校和校区由你自行填写，用于校园内容筛选及审核员申请，不代表学校官方认证。</p></div>
    <p v-if="loadError" class="settings-message error" role="alert">{{ loadError }} <button type="button" class="text-button" :disabled="profileLoading" @click="loadProfile">重新读取</button></p>
    <p v-else-if="saveError" class="settings-message error" role="alert">{{ saveError }}</p>
    <p v-if="notice" class="settings-message success" role="status">{{ notice }}</p>
    <!-- 读不到资料时表单是空的，照着空表单保存只会覆盖掉云端已有的昵称和学校。
         先让人重新读取，再谈编辑。 -->
    <p v-if="profileLoading" class="settings-empty" role="status">正在读取资料…</p>
    <p v-else-if="loadError" class="settings-empty">资料暂时读不到，暂时不能编辑。请稍后重新读取。</p>
    <form v-else class="account-profile-form" @submit.prevent="saveProfile">
      <label>昵称<input v-model="draft.nickname" maxlength="32" autocomplete="nickname" required placeholder="同学们看到的称呼" /></label>
      <label>学校<input v-model="draft.school" maxlength="100" placeholder="例如：所在学校" /></label>
      <label>当前校区<input v-model="draft.campus" maxlength="100" placeholder="选填，用于缩小校园范围" /></label>
      <label>时区<select v-model="draft.timezone"><option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option></select></label>
      <p class="availability-explanation">已同步的课表、日程中没有安排的时间，默认可邀请；对方确认后才会成立。无需填写课表覆盖日期。</p>
      <details class="availability-options"><summary>可约偏好（选填）</summary><p>默认每天 09:00–22:00 可邀请。可限定星期和时间；全部取消星期可暂停接收邀约。</p><fieldset><legend>哪些天可以邀请</legend><div class="invitation-weekdays"><label v-for="(label, day) in INVITATION_WEEKDAYS" :key="day" class="check-setting"><input v-model="draft.availabilityPreferences.weekdays" type="checkbox" :value="day" />{{ label }}</label></div></fieldset><div class="account-profile-form"><label>每天开始<input v-model="draft.availabilityPreferences.startTime" type="time" /></label><label>每天结束<input v-model="draft.availabilityPreferences.endTime" type="time" /></label><label>最短时长<select v-model.number="draft.availabilityPreferences.minimumMinutes"><option :value="30">30 分钟</option><option :value="60">1 小时</option><option :value="90">90 分钟</option><option :value="120">2 小时</option><option :value="180">3 小时</option></select></label><label>课程前后缓冲<select v-model.number="draft.availabilityPreferences.classBufferMinutes"><option :value="0">不额外留空</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="45">45 分钟</option><option :value="60">60 分钟</option></select></label></div></details>
      <label class="check-setting discover-setting"><input v-model="draft.emailDiscoverable" type="checkbox" :disabled="!hasVerifiedEmail" /><span>允许好友使用完整邮箱精确搜索我<small>默认关闭，邮箱不会公开展示；关闭搜索时也不会泄露账号是否存在。{{ !hasVerifiedEmail ? '完成邮箱验证后可开启。' : '' }}</small></span></label>
      <div class="settings-actions"><Button type="submit" :disabled="profileSaving">{{ profileSaving ? '正在保存…' : '保存个人资料' }}</Button><span v-if="profile?.school">当前筛选范围：{{ profile.school }} · {{ profile.campus || '全部校区' }}</span></div>
    </form>
  </section>

  <section v-else class="account-community-settings">
    <div class="settings-heading"><span class="account-settings-index">{{ SECTION_INDEX.beans }}</span><h3>余额与变动记录</h3><p>充值豆和贡献豆分别记账。充值暂未开放；贡献豆不提现、不转赠，可用于后续配置的应用内数字权益。</p></div>
    <p v-if="beans.error.value" class="settings-message error" role="alert">{{ beans.error.value }} <button type="button" class="text-button" :disabled="beans.loading.value" @click="beans.load">重新读取</button></p>
    <p v-if="!signedIn" class="settings-empty">登录后可查看个人贡献记录。</p>
    <p v-else-if="walletLoading || beans.loading.value" class="settings-empty" role="status">正在读取三两豆账本…</p>
    <p v-else-if="!wallet" class="settings-empty">三两豆账本暂时无法读取。</p>
    <template v-else>
      <div class="bean-balances"><article><span>充值豆</span><b>{{ wallet.purchased ?? 0 }}</b><small>尚未开放充值</small></article><article><span>贡献豆</span><b>{{ wallet.contribution ?? 0 }}</b><small>可用贡献余额</small></article><p v-if="wallet.contributionDebt">待抵扣 {{ wallet.contributionDebt }} 豆：后续贡献奖励将优先抵扣，不影响充值豆。</p></div>
      <section class="bean-earning-rules" aria-labelledby="bean-earning-title"><h4 id="bean-earning-title">怎么获得贡献豆</h4><article><b>参与校园审核</b><p>邮箱已验证、填写学校资料后可申请；由总管理员批准并设置审核范围。每完成 1 条审核并写明依据，可得 3 个贡献豆，每日最多计入 20 条。每位审核员每月随机抽查约 10%；实质错判会追回未花掉的贡献豆，并从后续贡献奖励中抵扣。</p></article><article><b>提交校园建议</b><p>登录后提交，内容通过安全检查后匿名公开。只有总管理员确认“已解决”并设置奖励时才发放 0–20 个贡献豆，每条建议只发一次；提交建议本身不保证获得奖励。</p></article><RouterLink to="/campus/feedback">查看公开建议或申请成为审核员</RouterLink></section>
      <div class="bean-gate"><Badge variant="outline">充值关闭</Badge><p>应用主体、微信小程序与支付资质准备完成前，不会收取费用。应用内数字权益目录与价格将在资质确认后配置。</p></div>
      <div class="bean-ledger-heading"><h4>最近变动</h4><Button variant="outline" size="sm" :disabled="beans.loading.value" @click="beans.load">刷新</Button></div>
      <p v-if="!ledger.length" class="settings-empty">还没有三两豆记录。</p>
      <div v-else class="bean-ledger"><article v-for="item in ledger" :key="item.id"><div><b>{{ ledgerType(item) }}</b><small>{{ item.reason }} · {{ formatDate(item.created_at) }}</small></div><span :class="{ positive: item.amount > 0, negative: item.amount < 0 }">{{ item.bean_type === 'purchased' ? '充值豆' : '贡献豆' }} {{ item.amount > 0 ? '+' : '' }}{{ item.amount }}<small v-if="item.debt_delta"> · 抵扣变化 {{ item.debt_delta > 0 ? '+' : '' }}{{ item.debt_delta }}</small></span></article></div>
    </template>
  </section>
</template>

<style scoped>
.account-community-settings{display:grid;gap:14px}.settings-heading h3{margin:0 0 5px;font-size:var(--fs-17)}.settings-heading p{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.account-settings-index{display:block;margin-bottom:6px;color:var(--success,#067654);font-size:var(--fs-10);font-weight:var(--fw-650);letter-spacing:.08em}.account-profile-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.account-profile-form label{display:grid;gap:5px;font-size:var(--fs-11);font-weight:var(--fw-600)}.account-profile-form input:not([type=checkbox]),.account-profile-form select{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-12)}.account-profile-form fieldset{grid-column:1/-1;padding:12px;border:1px solid var(--border);border-radius:var(--radius-9)}.account-profile-form legend{padding:0 5px;color:var(--muted);font-size:var(--fs-11)}.check-setting{display:flex!important;align-items:flex-start;gap:8px;font-weight:var(--fw-500)!important}.check-setting input{margin-top:3px}.discover-setting{grid-column:1/-1}.discover-setting span{display:grid;gap:4px}.discover-setting small{color:var(--muted);font-size:var(--fs-10);line-height:1.7}.settings-actions{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}.settings-actions span{color:var(--muted);font-size:var(--fs-10)}.settings-message,.settings-empty{padding:11px 13px;border-radius:var(--radius-8);background:var(--bg-tint);color:var(--muted);font-size:var(--fs-11);line-height:1.7}.settings-message.error{background:var(--danger-soft);color:var(--danger)}.settings-message.success{background:var(--bg-tint);color:var(--success)}.bean-balances{display:grid;grid-template-columns:1fr 1fr;gap:9px}.bean-balances article{display:grid;gap:5px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}.bean-balances article span{color:var(--muted);font-size:var(--fs-11)}.bean-balances article b{font-size:var(--fs-24);font-variant-numeric:tabular-nums}.bean-balances article small{color:var(--muted);font-size:var(--fs-10)}.bean-balances>p{grid-column:1/-1;margin:0;color:var(--warning);font-size:var(--fs-11)}.bean-earning-rules{display:grid;gap:10px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--card)}.bean-earning-rules h4{margin:0;font-size:var(--fs-13)}.bean-earning-rules article{display:grid;gap:4px}.bean-earning-rules article b{font-size:var(--fs-11)}.bean-earning-rules article p{margin:0;color:var(--muted);font-size:var(--fs-10);line-height:1.7}.bean-earning-rules>a{width:fit-content;color:var(--primary);font-size:var(--fs-11);text-decoration:none}.bean-gate{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-9)}.bean-gate p{margin:0;color:var(--muted);font-size:var(--fs-10);line-height:1.7}.bean-ledger-heading{display:flex;align-items:center;justify-content:space-between}.bean-ledger-heading h4{margin:0;font-size:var(--fs-13)}.bean-ledger{display:grid;max-height:300px;overflow:auto}.bean-ledger article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 2px;border-bottom:1px solid var(--border)}.bean-ledger article>div{display:grid;gap:3px;min-width:0}.bean-ledger b{font-size:var(--fs-11)}.bean-ledger small{color:var(--muted);font-size:var(--fs-9);line-height:1.5}.bean-ledger article>span{flex:none;font-size:var(--fs-11);font-variant-numeric:tabular-nums}.bean-ledger article>span.positive{color:var(--success,#067654)}.bean-ledger article>span.negative{color:var(--warning,#8a5a12)}
@media(max-width:520px){.account-profile-form{grid-template-columns:1fr}.account-profile-form fieldset,.discover-setting,.settings-actions{grid-column:auto}.settings-actions{align-items:flex-start;flex-direction:column}.settings-actions button{width:100%}.bean-balances{grid-template-columns:1fr}.bean-balances>p{grid-column:auto}}
.account-profile-form>*{min-width:0}.account-profile-form :is(input,select){box-sizing:border-box;max-width:100%;min-width:0}.availability-explanation,.availability-options{grid-column:1/-1}.availability-explanation,.availability-options>p{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.8}.availability-options{border:1px solid var(--border);border-radius:var(--radius-9);padding:12px}.availability-options summary{min-height:32px;cursor:pointer;font-size:var(--fs-12);font-weight:var(--fw-600)}.availability-options>p{margin:8px 0 14px}.availability-options fieldset{margin:0 0 14px;min-width:0}.invitation-weekdays{display:flex;flex-wrap:wrap;gap:8px 14px}.invitation-weekdays label{min-height:32px;align-items:center}.invitation-weekdays input{margin:0}.account-profile-form input[type=time]{min-inline-size:0}
</style>
