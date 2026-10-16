<script setup>
import ActionButton from './ActionButton.vue'
import { readRegistrationStatus } from '../services/platformRegistration.js'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import AccountSyncPanel from './data/AccountSyncPanel.vue'
import AccountPasswordForm from './account/AccountPasswordForm.vue'
import AccountSessionActions from './account/AccountSessionActions.vue'
import AccountCommunitySettings from './account/AccountCommunitySettings.vue'
import { getAccountAuthOptions } from '../services/cloudConfig.js'
import {
  accountAuthError, accountAvailable, accountBusy, accountCallbackError, accountInitialSection, accountUser,
  accountPasswordRecovery, finishAccountPasswordRecovery,
  initializeAccountAuth, loginAccount, loginAccountWithOAuth, logoutAccount, normalizeAccountEmail,
  registerAccount, requestAccountPasswordReset, resendAccountConfirmation, validateAccountForm,
} from '../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../composables/accountVerification.js'
import { announce, announceAlert } from '../composables/liveRegion.js'
import { useAccountEmailCooldown } from '../composables/accountEmailCooldown.js'
import '../styles/shadcn.css'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const DataManager = defineAsyncComponent(() => import('./DataManager.vue'))

const props = defineProps({ open: Boolean })
const authOptions = getAccountAuthOptions()
const oauthProviders = window.studyLifeDesktop?.isDesktop ? [] : authOptions.providers
const registrationOpen = ref(null)
const emailSignupEnabled = computed(() => authOptions.emailSignup && authOptions.emailDelivery && registrationOpen.value !== false)
watch(() => props.open, async open => { if (open && !accountUser.value && accountAvailable.value) { try { registrationOpen.value = await readRegistrationStatus() } catch { registrationOpen.value = null } } }, { immediate: true })
const passwordAccount = computed(() => !accountUser.value?.app_metadata?.providers?.length || accountUser.value.app_metadata.providers.includes('email'))
const emit = defineEmits(['close'])
// 账号面板的常见场景是已有账号登录；新用户仍可在同一屏切到注册。
const mode = ref('login')
const email = ref('')
const password = ref('')
const confirmation = ref('')
const passwordVisible = ref(false)
const errors = ref(/** @type {Record<string, string>} */ ({}))
const feedback = ref('')
const feedbackError = ref('')
const confirmationEmail = ref('')
const emailInput = ref(/** @type {HTMLInputElement | null} */ (null))
const passwordInput = ref(/** @type {HTMLInputElement | null} */ (null))
const confirmationInput = ref(/** @type {HTMLInputElement | null} */ (null))
const activeSection = ref('overview')
const backupOpen = ref(false)
const recoveryEmail = ref('')
const capsLock = ref(false)
const { seconds: resendSeconds, start: startCooldown } = useAccountEmailCooldown()
// 「提交中」要独立于 accountBusy：accountBusy 只覆盖网络往返，
// 而成功之后还有清密码、聚焦新标题等收尾动画，点两次会重复走一遍。
const submitting = ref(false)
const summaryHeading = ref(/** @type {HTMLHeadingElement | null} */ (null))
const formError = computed(() => feedbackError.value || accountCallbackError.value || accountAuthError.value)
const busy = computed(() => accountBusy.value || submitting.value)
const isWechatInternalAccount = computed(() => String(accountUser.value?.email || '').trim().toLowerCase().endsWith('@wechat.study-life.invalid'))
const displayedAccountEmail = computed(() => isWechatInternalAccount.value ? '微信小程序账号' : accountUser.value?.email || '')
const accountName = computed(() => isWechatInternalAccount.value ? '三两事微信用户' : accountUser.value?.email?.split('@')[0] || '三两事用户')
const avatarText = computed(() => Array.from(accountName.value)[0]?.toUpperCase() || '我')
const isEmailFlow = computed(() => mode.value === 'recovery' || mode.value === 'register')
const recoveryHelp = window.studyLifeDesktop?.isDesktop
  ? '请在默认浏览器中打开邮件链接并设置新密码，再返回桌面版登录。'
  : '请检查垃圾邮件，并在发送邮件的同一浏览器中打开链接完成验证。'

watch(() => props.open, (open) => {
  if (!open) return
  activeSection.value = accountInitialSection.value
  accountInitialSection.value = 'overview'
}, { immediate: true })

// Keep the password form mounted until its success event is delivered, even
// when the auth layer clears the recovery flag during the request's response.
watch(accountPasswordRecovery, recovering => {
  if (recovering) activeSection.value = 'security'
}, { immediate: true })

function formatDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '暂无记录'
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

watch(formError, (message) => { if (message && props.open) announceAlert(message) }, { immediate: true })
watch(feedback, (message) => { if (message && props.open) announce(message) }, { immediate: true })
// 面板刚打开时若已经带着一条错误（比如邮箱验证链接失败），上面的 immediate
// watcher 负责播报；这里再把焦点交给它，避免读屏用户只听到"三两事账号"。
watch(() => props.open, (open) => { if (open && formError.value) void nextTick(() => summaryHeading.value?.focus()) })

function clearPasswords() {
  password.value = ''
  confirmation.value = ''
  passwordVisible.value = false
  capsLock.value = false
}

function changeMode(nextMode) {
  if (busy.value) return
  mode.value = nextMode
  clearPasswords()
  errors.value = {}
  feedback.value = ''
  feedbackError.value = ''
  confirmationEmail.value = ''
  recoveryEmail.value = ''
  accountAuthError.value = ''
  accountCallbackError.value = ''
  nextTick(() => emailInput.value?.focus())
}

function close() {
  clearPasswords()
  // 回调错误与启动期错误是模块级全局量：不清掉的话，关掉再打开还会挂着
  // 上一次的红色提示，而且界面上没有任何"关掉它"的按钮。
  accountCallbackError.value = ''
  accountAuthError.value = ''
  // 同理，「去验证邮箱」和「检查密码重设邮件」这两个中间页由模块级 ref 驱动。
  // 之前不清，于是注册失败后关掉面板再打开，会直接落回验证页，而且重发按钮
  // 还在冷却里 —— 用户看到的是一个他没退出的流程。
  confirmationEmail.value = ''
  recoveryEmail.value = ''
  emit('close')
}

/** 用户开始修改某个字段时清掉它的行内红字，别让旧错误一直挂在正在输入的框上。 */
function clearFieldError(field) {
  if (errors.value[field]) errors.value = { ...errors.value, [field]: '' }
  feedbackError.value = ''
  // 成功提示也要一起清。登录成功后顺手改一个字符，
  // 「登录成功。」还挂在表单顶上，和正在输入的新内容对不上。
  feedback.value = ''
}

async function focusInvalidField() {
  await nextTick()
  const target = errors.value.email ? emailInput : errors.value.password ? passwordInput : confirmationInput
  target.value?.focus()
  announceAlert(Object.values(errors.value)[0])
}

async function submit() {
  if (busy.value || !accountAvailable.value) return
  if (isEmailFlow.value && resendSeconds.value > 0) return
  feedback.value = ''
  feedbackError.value = ''
  // 【必须在表单校验之前清】原来这行在校验 return 之后：上一次回调失败留下的
  // 横幅会和这一轮新产生的行内错误同时出现，两条互相矛盾的提示并排显示。
  accountCallbackError.value = ''
  accountAuthError.value = ''
  errors.value = validateAccountForm({
    email: email.value, password: password.value, confirmation: confirmation.value, mode: mode.value,
  })
  if (Object.keys(errors.value).length) {
    await focusInvalidField()
    return
  }
  submitting.value = true
  try {
    const result = mode.value === 'recovery'
      ? await requestAccountPasswordReset(email.value)
      : mode.value === 'register'
      ? await registerAccount({ email: email.value, password: password.value, confirmation: confirmation.value })
      : await loginAccount({ email: email.value, password: password.value })
    if (!result.ok) {
      feedbackError.value = result.message || '请检查表单后重试。'
      if (result.code === 'email_not_confirmed') confirmationEmail.value = normalizeAccountEmail(email.value)
      return
    }
    clearPasswords()
    if (mode.value === 'recovery') {
      recoveryEmail.value = normalizeAccountEmail(email.value)
      feedback.value = '如果此邮箱已注册，将收到密码重设邮件。请检查收件箱和垃圾邮件。'
      startCooldown()
    } else if (result.needsConfirmation) {
      confirmationEmail.value = normalizeAccountEmail(email.value)
      feedback.value = '请检查邮箱中的验证邮件，完成验证后即可登录。已注册的邮箱可以直接登录。'
      startCooldown()
    } else {
      feedback.value = mode.value === 'register' ? '注册成功，已登录。' : '登录成功。'
    }
    // 表单节点被"已登录"摘要整个换掉了，焦点原本会掉回 body，
    // 键盘与读屏用户被丢回文档开头。这里把焦点交给新出现的标题。
    await nextTick()
    summaryHeading.value?.focus()
  } finally {
    submitting.value = false
  }
}

async function resend() {
  if (busy.value || resendSeconds.value > 0 || !accountAvailable.value) return
  const target = confirmationEmail.value || normalizeAccountEmail(email.value)
  const emailError = validateAccountForm({ email: target }).email
  if (emailError) {
    errors.value = { email: emailError }
    await focusInvalidField()
    return
  }
  feedbackError.value = ''
  feedback.value = ''
  const result = await resendAccountConfirmation(target)
  if (!result.ok) {
    feedbackError.value = result.message
    return
  }
  accountCallbackError.value = ''
  confirmationEmail.value = target
  feedback.value = '已请求重新发送验证邮件，请检查收件箱和垃圾邮件。'
  startCooldown()
}

async function signOut(scope = 'local') {
  if (busy.value) return
  submitting.value = true
  feedbackError.value = ''
  feedback.value = ''
  try {
    const result = await logoutAccount({ scope })
    if (!result.ok) {
      feedbackError.value = result.message
      return
    }
    mode.value = 'login'
    activeSection.value = 'overview'
    confirmationEmail.value = ''
    recoveryEmail.value = ''
    clearPasswords()
    // 退出本身成功了，但清本机数据可能失败（常见于另一标签页还开着）。
    // 那是**没有清干净**：上一账号的课程、待办、账本还留在本机上，
    // 下一个人打开这台设备就能看到。必须走错误样式，不能挂在绿色 ✓ 上。
    if (result.warning) {
      feedbackError.value = result.warning
    } else {
      feedback.value = scope === 'global'
        ? '账号已退出所有设备，并清除了当前设备上的本机业务数据。'
        : '账号已退出当前设备，并清除了本机业务数据。'
    }
    await nextTick()
    emailInput.value?.focus()
  } finally { submitting.value = false }
}

async function signInWithProvider(provider) {
  if (busy.value || !accountAvailable.value) return
  clearPasswords()
  feedback.value = ''
  feedbackError.value = ''
  accountCallbackError.value = ''
  accountAuthError.value = ''
  submitting.value = true
  try {
    const result = await loginAccountWithOAuth(provider)
    if (!result.ok) feedbackError.value = result.message
  } finally { submitting.value = false }
}

function passwordUpdated() {
  activeSection.value = 'overview'
  recoveryEmail.value = ''
  feedbackError.value = ''
  feedback.value = '密码已更新，下次登录请使用新密码。'
  nextTick(() => summaryHeading.value?.focus())
}

async function sendRecoveryForUser() {
  if (busy.value || resendSeconds.value > 0) return
  feedbackError.value = ''
  feedback.value = ''
  const result = await requestAccountPasswordReset(accountUser.value?.email)
  if (!result.ok) { feedbackError.value = result.message; return }
  feedback.value = '已请求发送密码重设邮件。' + recoveryHelp
  startCooldown()
}

function leaveRecovery() {
  if (busy.value) return
  finishAccountPasswordRecovery()
  activeSection.value = 'overview'
  nextTick(() => summaryHeading.value?.focus())
}

onMounted(() => { if (accountAvailable.value) void initializeAccountAuth() })
onBeforeUnmount(() => {
  clearPasswords()
})
</script>

<template>
  <Modal :open="props.open" title="我的账号" :title-level="2" medium @close="close">
    <div class="account-panel">
      <p v-if="registrationOpen === false && !accountUser" class="account-service-note" role="status">当前已暂停新用户注册，已有账号仍可登录。</p>
      <p v-if="!accountAvailable" class="account-service-note">此版本未包含账号服务，无法注册或登录。本机功能仍可使用。</p>
      <Alert v-if="formError" variant="destructive" class="account-error-alert"><AlertDescription id="account-form-error">{{ formError }}</AlertDescription></Alert>
      <p v-if="feedback" class="account-feedback account-success"><span class="account-feedback-icon" aria-hidden="true">✓</span><span>{{ feedback }}</span></p>

      <template v-if="accountUser">
        <section class="account-summary" aria-labelledby="account-summary-title">
          <span class="account-avatar" aria-hidden="true">{{ avatarText }}</span>
          <div class="account-identity"><h3 id="account-summary-title" ref="summaryHeading" tabindex="-1">{{ accountName }}</h3><p class="account-email">{{ displayedAccountEmail }}</p></div>
          <Badge as="span" variant="outline" class="account-badge">已登录</Badge>
        </section>
          <div v-if="!accountPasswordRecovery" class="account-mode" role="group" aria-label="账号设置分区">
            <button type="button" class="btn" :class="{ 'btn-primary': activeSection === 'overview' }" :aria-pressed="activeSection === 'overview'" :disabled="busy" @click="activeSection = 'overview'">账号概览</button>
            <button type="button" class="btn" :class="{ 'btn-primary': activeSection === 'profile' }" :aria-pressed="activeSection === 'profile'" :disabled="busy" @click="activeSection = 'profile'">个人资料</button>
            <button type="button" class="btn" :class="{ 'btn-primary': activeSection === 'beans' }" :aria-pressed="activeSection === 'beans'" :disabled="busy" @click="activeSection = 'beans'">三两豆</button>
            <button type="button" class="btn" :class="{ 'btn-primary': activeSection === 'security' }" :aria-pressed="activeSection === 'security'" :disabled="busy" @click="activeSection = 'security'">账号安全</button>
          </div>
          <template v-if="activeSection === 'overview' && !accountPasswordRecovery">
            <section class="account-card" aria-labelledby="account-details-title">
              <h3 id="account-details-title">账号信息</h3>
              <dl class="account-details">
                <div><dt>登录邮箱</dt><dd class="account-email">{{ displayedAccountEmail }}</dd></div>
                <div><dt>邮箱验证</dt><dd><Badge as="span" variant="outline" :class="hasVerifiedContactEmail() ? 'account-verified' : 'account-pending'">{{ hasVerifiedContactEmail() ? '已验证' : isWechatInternalAccount ? '未绑定联系邮箱' : '尚未验证' }}</Badge></dd></div>
                <div><dt>注册时间</dt><dd>{{ formatDate(accountUser.created_at) }}</dd></div>
                <div><dt>最近登录</dt><dd>{{ formatDate(accountUser.last_sign_in_at) }}</dd></div>
              </dl>
              <p class="account-help">{{ passwordAccount ? '请妥善保管账号密码和登录邮箱。' : '通过第三方账号登录，请在对应平台管理登录安全。' }}</p>
            </section>
            <section class="account-card" aria-labelledby="account-data-title">
              <h3 id="account-data-title">数据与同步</h3>
              <AccountSyncPanel compact />
            </section>
          </template>
          <section v-else-if="activeSection === 'profile' && !accountPasswordRecovery" class="account-card"><AccountCommunitySettings section="profile" /></section>
          <section v-else-if="activeSection === 'beans' && !accountPasswordRecovery" class="account-card"><AccountCommunitySettings section="beans" /></section>
          <template v-else>
            <div v-if="passwordAccount || accountPasswordRecovery" class="account-card"><AccountPasswordForm :recovery="accountPasswordRecovery" :reset-seconds="resendSeconds" :reset-enabled="authOptions.emailDelivery" @updated="passwordUpdated" @reset-request="sendRecoveryForUser" /></div>
            <p v-else class="account-help">请前往你的第三方登录平台管理密码与账号安全。</p>
            <button v-if="accountPasswordRecovery" type="button" class="btn btn-ghost" :disabled="busy" @click="leaveRecovery">稍后设置，返回账号</button>
            <template v-else>
              <p v-if="resendSeconds > 0" class="account-help">邮件发送冷却中，{{ resendSeconds }} 秒后可再次请求。</p>
              <div class="account-card"><AccountSessionActions :busy="busy" @sign-out="signOut" @backup="backupOpen = true" /></div>
            </template>
          </template>
      </template>

      <section v-else-if="confirmationEmail" class="account-confirmation" aria-labelledby="account-confirmation-title">
        <h3 id="account-confirmation-title" ref="summaryHeading" tabindex="-1">验证邮箱</h3>
        <p>请在 <strong class="account-email">{{ confirmationEmail }}</strong> 中打开验证链接。</p>
        <p class="account-help">{{ authOptions.emailDelivery ? '没有收到邮件时，请检查垃圾邮件或稍后重新发送。' : '验证邮件暂时无法发送，请返回登录或联系管理员。' }}</p>
        <ActionButton v-if="authOptions.emailDelivery" tone="neutral" type="button" class="btn" :disabled="busy || resendSeconds > 0" :busy="busy" kind="important" feedback="external" :show-error="false" :action="() => resend()">
          {{ resendSeconds > 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }}
        </ActionButton>
        <div class="account-links">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="changeMode('login')">已验证，去登录</button>
          <button v-if="emailSignupEnabled" type="button" class="btn" :disabled="busy" @click="changeMode('register')">更换邮箱</button>
        </div>
      </section>

      <section v-else-if="recoveryEmail" class="account-confirmation" aria-labelledby="account-recovery-title">
        <h3 id="account-recovery-title" ref="summaryHeading" tabindex="-1">检查密码重设邮件</h3>
        <p>如果 <strong class="account-email">{{ recoveryEmail }}</strong> 已注册，你会收到一封包含重设链接的邮件。</p>
        <p class="account-help">{{ recoveryHelp }}</p>
        <ActionButton tone="neutral" type="button" class="btn" :disabled="busy || resendSeconds > 0" :busy="busy" kind="important" feedback="external" :show-error="false" :action="() => submit()">{{ resendSeconds > 0 ? resendSeconds + ' 秒后可重发' : '重新发送重设邮件' }}</ActionButton>
        <div class="account-links"><button type="button" class="btn btn-primary" :disabled="busy" @click="changeMode('login')">返回登录</button><button type="button" class="btn" :disabled="busy" @click="changeMode('recovery')">更换邮箱</button></div>
      </section>

      <template v-else>
        <Card class="account-auth-card">
          <CardHeader class="account-auth-header">
            <CardTitle>{{ mode === 'recovery' ? '重设密码' : mode === 'register' ? '创建账号' : '登录账号' }}</CardTitle>
            <CardDescription>{{ mode === 'recovery' ? '输入注册邮箱，我们会发送密码重设链接。' : mode === 'register' ? '注册后可在不同设备间同步课程、待办和日常记录。' : '登录后继续同步你的课程、待办与日常记录。' }}</CardDescription>
          </CardHeader>
          <CardContent class="account-auth-content">
          <div v-if="mode !== 'recovery' && oauthProviders.length" class="account-oauth" aria-label="其他登录方式">
            <Button v-for="provider in oauthProviders" :key="provider.id" type="button" variant="outline" :disabled="busy || !accountAvailable" @click="signInWithProvider(provider.id)">使用 {{ provider.label }} 登录</Button>
            <p class="account-help">首次使用会创建账号；已有记录会按账号同步规则合并。</p>
          </div>
          <p v-if="!emailSignupEnabled && mode === 'login'" class="account-help">{{ oauthProviders.length ? '已有邮箱账号仍可在下方登录。' : '目前支持已有邮箱账号登录；不登录也可继续在本机使用。' }}</p>
          <div v-if="mode !== 'recovery' && emailSignupEnabled" class="account-mode" role="group" aria-label="账号操作">
            <button type="button" class="btn" :class="{ 'btn-primary': mode === 'login' }" :aria-pressed="mode === 'login'" :disabled="busy" @click="changeMode('login')">登录</button>
            <button v-if="emailSignupEnabled" type="button" class="btn" :class="{ 'btn-primary': mode === 'register' }" :aria-pressed="mode === 'register'" :disabled="busy" @click="changeMode('register')">注册</button>
          </div>
          <form class="account-form" novalidate :aria-busy="busy" @submit.prevent="submit">
            <div class="account-field">
              <label for="account-email">邮箱</label>
              <!-- 登录态用 autocomplete="username"：密码管理器靠这一对绑定，
                   "email" 在部分管理器里绑定不到密码框。 -->
              <input id="account-email" ref="emailInput" v-model="email" name="email" type="email" :autocomplete="mode === 'login' ? 'username' : 'email'" inputmode="email" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="输入邮箱地址" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.email)" :aria-describedby="errors.email ? 'account-email-error account-form-error' : 'account-form-error'" @input="clearFieldError('email')" />
              <p v-if="errors.email" id="account-email-error" class="account-error">{{ errors.email }}</p>
            </div>
            <div v-if="mode !== 'recovery'" class="account-field">
              <div class="account-field-heading"><label for="account-password">密码</label><button v-if="mode === 'login' && authOptions.emailDelivery" type="button" class="account-text-button" :disabled="busy || !accountAvailable" @click="changeMode('recovery')">忘记密码？</button></div>
              <!-- 【iOS 必须关掉自动大写与自动纠错】只给邮箱设了 autocapitalize="none"，
                   密码框用的是默认值。iOS Safari 会把首字母大写、还会跑拼写纠错，
                   于是用户照着原样输入却一直得到"邮箱或密码不正确"，极难自查。 -->
              <input id="account-password" ref="passwordInput" v-model="password" name="password" :type="passwordVisible ? 'text' : 'password'" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="输入密码" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.password)" :aria-describedby="errors.password ? 'account-password-error account-password-help' : 'account-password-help'" @input="clearFieldError('password')" @keydown="capsLock = Boolean($event.getModifierState?.('CapsLock'))" @keyup="capsLock = Boolean($event.getModifierState?.('CapsLock'))" @blur="capsLock = false" />
              <p id="account-password-help" class="account-help">{{ mode === 'register' ? '至少 8 位，建议混合字母、数字和符号。' : '请输入注册时设置的密码。' }}</p>
              <p v-if="errors.password" id="account-password-error" class="account-error">{{ errors.password }}</p>
              <p v-if="capsLock" class="account-service-note">大写锁定已开启，请注意密码大小写。</p>
            </div>
            <div v-if="mode === 'register'" class="account-field">
              <label for="account-confirmation">再次输入密码</label>
              <input id="account-confirmation" ref="confirmationInput" v-model="confirmation" name="confirmation" :type="passwordVisible ? 'text' : 'password'" autocomplete="new-password" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.confirmation)" :aria-describedby="errors.confirmation ? 'account-confirmation-error' : undefined" @input="clearFieldError('confirmation')" />
              <p v-if="errors.confirmation" id="account-confirmation-error" class="account-error">{{ errors.confirmation }}</p>
            </div>
            <label v-if="mode !== 'recovery'" class="account-password-toggle"><input v-model="passwordVisible" type="checkbox" :disabled="busy || !accountAvailable" />显示密码</label>
            <ActionButton tone="primary" kind="important" feedback="external" :show-error="false" type="submit" class="btn btn-primary account-submit" :disabled="busy || !accountAvailable || (isEmailFlow && resendSeconds > 0)" :busy="busy">{{ busy ? '正在处理…' : isEmailFlow && resendSeconds > 0 ? resendSeconds + ' 秒后可发送' : mode === 'register' ? '创建账号' : mode === 'recovery' ? '发送重设邮件' : '登录' }}</ActionButton>
            <button v-if="mode === 'recovery'" type="button" class="btn btn-ghost" :disabled="busy" @click="changeMode('login')">返回登录</button>
            <ActionButton tone="neutral" v-if="accountCallbackError && accountAvailable && authOptions.emailDelivery" type="button" class="btn" :disabled="busy || resendSeconds > 0" kind="important" feedback="external" :show-error="false" :action="() => resend()">{{ resendSeconds > 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }}</ActionButton>
          </form>
          </CardContent>
        </Card>
      </template>
      <p class="account-privacy">{{ accountUser ? '账号同步通过加密连接传输；壁纸图片保存在本机，导出备份时可选择携带。' : '账号为可选功能，不登录也可以在本机记录。密码只用于账号验证，不进入业务备份或数据同步。' }}</p>
    </div>
  </Modal>
  <DataManager v-if="backupOpen" :open="backupOpen" @close="backupOpen = false" />
</template>

<style scoped>
.account-panel { display: grid; gap: 16px; }
.account-panel p { margin: 0; line-height: 1.6; }
.account-help, .account-privacy { color: var(--muted); }
.account-help, .account-privacy { font-size: var(--fs-13); }
.account-service-note { padding:10px 12px; border:1px solid color-mix(in srgb, var(--warning) 26%, var(--border)); border-radius:var(--radius-8); color:var(--warning); background:color-mix(in srgb, var(--warning) 7%, var(--card)); }
.account-avatar { display: grid; place-items: center; width: 52px; height: 52px; flex-shrink: 0; border-radius: var(--radius-16); background: var(--primary-soft); color: var(--primary); font-size: var(--fs-23); font-weight: var(--fw-700); }
.account-mode { display: flex; gap: 6px; padding: 4px; border-radius: var(--radius-12); background: var(--bg); }
.account-mode .btn { flex: 1; }
.account-mode .btn:not(.btn-primary) { border-color: transparent; background: transparent; }
.account-auth-card { display:grid; gap:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
.account-auth-header { display:grid; gap:var(--space-2); padding:0; }
.account-auth-header :deep([data-slot="card-title"]) { margin:0; color:var(--text); font-size:var(--fs-17); font-weight:var(--fw-750); }
.account-auth-header :deep([data-slot="card-description"]) { color:var(--muted); font-size:var(--fs-13); line-height:1.55; }
.account-auth-content { display:grid; gap:var(--space-4); padding:var(--space-5) 0 0; }
.account-oauth { display: flex; flex-direction: column; gap: 8px; }
.account-form, .account-field, .account-confirmation { display: grid; gap: 8px; }
.account-form { gap: 16px; }
.account-field label { font-weight: var(--fw-600); }
.account-field-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.account-text-button { padding: 6px 0; min-height: 44px; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: var(--fs-13); cursor: pointer; }
.account-text-button:disabled { opacity: .5; cursor: default; }
.account-field input { width: 100%; min-width: 0; box-sizing: border-box; }
.account-error { color: var(--danger); font-size: var(--fs-13); }
.account-error-alert { margin:0; border-color:color-mix(in srgb, var(--danger) 26%, var(--border)); background:color-mix(in srgb, var(--danger) 7%, var(--card)); }
.account-error-alert :deep([data-slot="alert-description"]) { color:var(--danger); font-size:var(--fs-13); line-height:1.55; }
.account-success { color: var(--success); }
.account-feedback { display:flex; align-items:flex-start; gap:9px; padding:12px; border:1px solid var(--border); background:var(--bg-tint); border-radius:var(--radius-8); font-size:var(--fs-13); }
.account-feedback-icon { display:grid; width:20px; height:20px; flex:0 0 20px; place-items:center; border-radius:var(--radius-circle); font-size:var(--fs-12); font-weight:var(--fw-800); }
.account-feedback.account-success { border-color:color-mix(in srgb, var(--success) 24%, var(--border)); background:color-mix(in srgb, var(--success) 7%, var(--card)); }
.account-feedback.account-success .account-feedback-icon { color:var(--success); background:color-mix(in srgb, var(--success) 12%, var(--card)); }
.account-summary, .account-confirmation { padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg-tint); }
.account-summary { display: flex; align-items: center; gap: 12px; }
.account-identity { min-width: 0; flex: 1; }
.account-summary h3, .account-confirmation h3 { margin: 0; font-size: var(--fs-16); }
.account-summary h3 { overflow-wrap: anywhere; }
.account-summary .account-email { margin-top: 4px; color: var(--muted); font-size: var(--fs-13); }
.account-badge { flex-shrink:0; border-color:color-mix(in srgb, var(--success) 24%, var(--border)); background:color-mix(in srgb, var(--success) 8%, var(--card)); color:var(--success); font-size:var(--fs-12); font-weight:var(--fw-650); }
.account-card { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--card); }
.account-card > h3 { margin: 0 0 14px; font-size: var(--fs-16); }
.account-details { display: grid; gap: 0; margin: 0 0 14px; }
.account-details > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding:9px 0; border-bottom:1px solid var(--border); }
.account-details > div:last-child { border-bottom:0; }
.account-details dt { color: var(--muted); font-size: var(--fs-13); }
.account-details dd { margin: 0; font-size: var(--fs-13); }
.account-verified, .account-pending { width:fit-content; font-size:var(--fs-11); font-weight:var(--fw-650); }
.account-verified { border-color:color-mix(in srgb, var(--success) 24%, var(--border)); color:var(--success); background:color-mix(in srgb, var(--success) 8%, var(--card)); }
.account-pending { border-color:color-mix(in srgb, var(--warning) 26%, var(--border)); color:var(--warning); background:color-mix(in srgb, var(--warning) 8%, var(--card)); }
.account-email { overflow-wrap: anywhere; }
.account-password-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; justify-self: start; cursor: pointer; }
.account-submit { width: 100%; }
.account-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.account-privacy { padding-top: 16px; border-top: 1px solid var(--border); }
.account-panel .btn { min-height: 44px; }
@media (max-width: 520px) {
  .account-summary { flex-wrap: wrap; }
  .account-avatar { width: 44px; height: 44px; }
  .account-card { padding: 14px; }
  .account-auth-header { padding:14px 14px 0; }
  .account-auth-content { padding:14px; }
  .account-details > div { grid-template-columns:84px minmax(0,1fr); gap:8px; }
}
</style>
