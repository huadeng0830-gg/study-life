<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import AccountSyncPanel from './data/AccountSyncPanel.vue'
import {
  accountAuthError, accountAvailable, accountBusy, accountCallbackError, accountUser,
  initializeAccountAuth, loginAccount, logoutAccount, normalizeAccountEmail,
  registerAccount, resendAccountConfirmation, validateAccountForm,
} from '../composables/accountAuth.js'
import { announce, announceAlert } from '../composables/liveRegion.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
// 账号面板的常见场景是已有账号登录；新用户仍可在同一屏切到注册。
const mode = ref('login')
const email = ref('')
const password = ref('')
const confirmation = ref('')
const passwordVisible = ref(false)
const errors = ref({})
const feedback = ref('')
const feedbackError = ref('')
const confirmationEmail = ref('')
const emailInput = ref(null)
const passwordInput = ref(null)
const confirmationInput = ref(null)
// 「提交中」要独立于 accountBusy：accountBusy 只覆盖网络往返，
// 而成功之后还有清密码、聚焦新标题等收尾动画，点两次会重复走一遍。
const submitting = ref(false)
const summaryHeading = ref(null)
const formError = computed(() => feedbackError.value || accountCallbackError.value || accountAuthError.value)
const busy = computed(() => accountBusy.value || submitting.value)

/**
 * 重发验证邮件的冷却。
 *
 * 原来放在组件 ref 里，而 Sidebar 是 `v-if="accountOpen"` 挂载的：关掉面板就
 * 连组件一起销毁，冷却随之归零。再打开时按钮又是可点的，用户可以反复点，
 * 直接撞上 Supabase 的 over_email_send_rate_limit（accountAuth.js 有映射，
 * 但那时已经晚了）。冷却必须是"这个会话里发过一次邮件"的事实，不能活在
 * 会随手销毁的组件里，所以放进 sessionStorage。
 */
const RESEND_COOLDOWN_KEY = 'study-life-resend-cooldown'
const resendUntil = ref(readResendCooldown())
const now = ref(Date.now())
let cooldownTimer = 0
const resendSeconds = computed(() => Math.max(0, Math.ceil((resendUntil.value - now.value) / 1000)))

function readResendCooldown() {
  try {
    const saved = Number(sessionStorage.getItem(RESEND_COOLDOWN_KEY))
    return Number.isFinite(saved) && saved > Date.now() ? saved : 0
  } catch { return 0 }
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
}

function changeMode(nextMode) {
  if (busy.value) return
  mode.value = nextMode
  clearPasswords()
  errors.value = {}
  feedback.value = ''
  feedbackError.value = ''
  confirmationEmail.value = ''
  accountCallbackError.value = ''
  nextTick(() => emailInput.value?.focus())
}

function close() {
  clearPasswords()
  // 回调错误与启动期错误是模块级全局量：不清掉的话，关掉再打开还会挂着
  // 上一次的红色提示，而且界面上没有任何"关掉它"的按钮。
  accountCallbackError.value = ''
  accountAuthError.value = ''
  emit('close')
}

function startCooldown() {
  window.clearInterval(cooldownTimer)
  now.value = Date.now()
  resendUntil.value = now.value + 60000
  try { sessionStorage.setItem(RESEND_COOLDOWN_KEY, String(resendUntil.value)) } catch { /* 隐私模式下退化为内存冷却 */ }
  cooldownTimer = window.setInterval(() => {
    now.value = Date.now()
    if (now.value >= resendUntil.value) {
      window.clearInterval(cooldownTimer)
      cooldownTimer = 0
      try { sessionStorage.removeItem(RESEND_COOLDOWN_KEY) } catch { /* 忽略 */ }
    }
  }, 1000)
}

/** 用户开始修改某个字段时清掉它的行内红字，别让旧错误一直挂在正在输入的框上。 */
function clearFieldError(field) {
  if (errors.value[field]) errors.value = { ...errors.value, [field]: '' }
}

async function focusInvalidField() {
  await nextTick()
  const target = errors.value.email ? emailInput : errors.value.password ? passwordInput : confirmationInput
  target.value?.focus()
  announceAlert(Object.values(errors.value)[0])
}

async function submit() {
  if (busy.value || !accountAvailable.value) return
  feedback.value = ''
  feedbackError.value = ''
  // 【必须在表单校验之前清】原来这行在校验 return 之后：上一次回调失败留下的
  // 横幅会和这一轮新产生的行内错误同时出现，两条互相矛盾的提示并排显示。
  accountCallbackError.value = ''
  errors.value = validateAccountForm({
    email: email.value, password: password.value, confirmation: confirmation.value, mode: mode.value,
  })
  if (Object.keys(errors.value).length) {
    await focusInvalidField()
    return
  }
  submitting.value = true
  try {
    const result = mode.value === 'register'
      ? await registerAccount({ email: email.value, password: password.value, confirmation: confirmation.value })
      : await loginAccount({ email: email.value, password: password.value })
    if (!result.ok) {
      feedbackError.value = result.message || '请检查表单后重试。'
      if (result.code === 'email_not_confirmed') confirmationEmail.value = normalizeAccountEmail(email.value)
      return
    }
    clearPasswords()
    if (result.needsConfirmation) {
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
  if (accountBusy.value || resendSeconds.value > 0 || !accountAvailable.value) return
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
  if (accountBusy.value) return
  feedbackError.value = ''
  feedback.value = ''
  const result = await logoutAccount({ scope })
  if (!result.ok) {
    feedbackError.value = result.message
    return
  }
  mode.value = 'login'
  clearPasswords()
  feedback.value = result.warning || (scope === 'global'
    ? '已退出所有设备，并清除了当前设备上的本机业务数据。'
    : '已退出当前设备，并清除了本机业务数据。')
  await nextTick()
  emailInput.value?.focus()
}

onMounted(() => { if (accountAvailable.value) void initializeAccountAuth() })
onBeforeUnmount(() => {
  clearPasswords()
  window.clearInterval(cooldownTimer)
})
</script>

<template>
  <Modal :open="props.open" title="我的账号" :title-level="2" @close="close">
    <div class="account-panel">
      <p class="account-description">登录后可在设备间同步学习与生活记录；已有的本机记录会保留。</p>
      <!-- 「稍后再试」在这里是假话：缺的是构建期配置，不是服务端状态。
           说清楚是"这个版本没有账号服务"，用户才不会一次次回来试。 -->
      <p v-if="!accountAvailable" class="account-service-note">此版本未包含账号服务，无法注册或登录。本机功能仍可使用。</p>
      <p v-if="formError" id="account-form-error" class="account-feedback account-error">{{ formError }}</p>
      <p v-if="feedback" class="account-feedback account-success">{{ feedback }}</p>

      <section v-if="accountUser" class="account-summary" aria-labelledby="account-summary-title">
        <h3 id="account-summary-title" ref="summaryHeading" tabindex="-1">已登录</h3>
        <p class="account-email">{{ accountUser.email }}</p>
        <small>同步状态与设备间同步开关见下方。</small>
        <button type="button" class="btn" :disabled="busy" :aria-busy="busy" @click="signOut">退出并清除本机数据</button>
        <button type="button" class="btn btn-ghost" :disabled="busy" :aria-busy="busy" @click="signOut('global')">退出所有设备并清除本机数据</button>
      </section>

      <section v-else-if="confirmationEmail" class="account-confirmation" aria-labelledby="account-confirmation-title">
        <h3 id="account-confirmation-title" ref="summaryHeading" tabindex="-1">验证邮箱</h3>
        <p>请在 <strong class="account-email">{{ confirmationEmail }}</strong> 中打开验证链接。</p>
        <p class="account-help">没有收到邮件时，请检查垃圾邮件或稍后重新发送。</p>
        <button type="button" class="btn" :disabled="busy || resendSeconds > 0" :aria-busy="busy" @click="resend">
          {{ resendSeconds > 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }}
        </button>
        <div class="account-links">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="changeMode('login')">已验证，去登录</button>
          <button type="button" class="btn" :disabled="busy" @click="changeMode('register')">更换邮箱</button>
        </div>
      </section>

      <template v-else>
        <div class="account-mode" role="group" aria-label="账号操作">
          <button type="button" class="btn" :class="{ 'btn-primary': mode === 'register' }" :aria-pressed="mode === 'register'" :disabled="busy" @click="changeMode('register')">注册</button>
          <button type="button" class="btn" :class="{ 'btn-primary': mode === 'login' }" :aria-pressed="mode === 'login'" :disabled="busy" @click="changeMode('login')">登录</button>
        </div>
        <form class="account-form" novalidate :aria-busy="busy" @submit.prevent="submit">
          <div class="account-field">
            <label for="account-email">邮箱</label>
            <!-- 登录态用 autocomplete="username"：密码管理器靠这一对绑定，
                 "email" 在部分管理器里绑定不到密码框。 -->
            <input id="account-email" ref="emailInput" v-model="email" name="email" type="email" :autocomplete="mode === 'register' ? 'email' : 'username'" inputmode="email" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.email)" :aria-describedby="errors.email ? 'account-email-error account-form-error' : 'account-form-error'" @input="clearFieldError('email')" />
            <p v-if="errors.email" id="account-email-error" class="account-error">{{ errors.email }}</p>
          </div>
          <div class="account-field">
            <label for="account-password">密码</label>
            <!-- 【iOS 必须关掉自动大写与自动纠错】只给邮箱设了 autocapitalize="none"，
                 密码框用的是默认值。iOS Safari 会把首字母大写、还会跑拼写纠错，
                 于是用户照着原样输入却一直得到"邮箱或密码不正确"，极难自查。 -->
            <input id="account-password" ref="passwordInput" v-model="password" name="password" :type="passwordVisible ? 'text' : 'password'" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.password)" :aria-describedby="errors.password ? 'account-password-error account-password-help' : 'account-password-help'" @input="clearFieldError('password')" />
            <p id="account-password-help" class="account-help">{{ mode === 'register' ? '至少 8 位，建议混合字母、数字和符号。' : '请输入注册时设置的密码。' }}</p>
            <p v-if="errors.password" id="account-password-error" class="account-error">{{ errors.password }}</p>
          </div>
          <div v-if="mode === 'register'" class="account-field">
            <label for="account-confirmation">再次输入密码</label>
            <input id="account-confirmation" ref="confirmationInput" v-model="confirmation" name="confirmation" :type="passwordVisible ? 'text' : 'password'" autocomplete="new-password" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy || !accountAvailable" :aria-invalid="Boolean(errors.confirmation)" :aria-describedby="errors.confirmation ? 'account-confirmation-error' : undefined" @input="clearFieldError('confirmation')" />
            <p v-if="errors.confirmation" id="account-confirmation-error" class="account-error">{{ errors.confirmation }}</p>
          </div>
          <label class="account-password-toggle"><input v-model="passwordVisible" type="checkbox" :disabled="busy || !accountAvailable" />显示密码</label>
          <button type="submit" class="btn btn-primary account-submit" :disabled="busy || !accountAvailable" :aria-busy="busy">{{ busy ? '正在处理…' : mode === 'register' ? '创建账号' : '登录' }}</button>
          <button v-if="accountCallbackError && accountAvailable" type="button" class="btn" :disabled="busy || resendSeconds > 0" @click="resend">{{ resendSeconds > 0 ? resendSeconds + ' 秒后可重发' : '重新发送验证邮件' }}</button>
        </form>
      </template>
      <AccountSyncPanel v-if="accountUser" compact />
    <p class="account-privacy">退出账号会清除当前设备上的业务数据与本机副本；需要保留时，请先导出备份。</p>
    </div>
  </Modal>
</template>

<style scoped>
.account-panel { display: grid; gap: 16px; }
.account-panel p { margin: 0; line-height: 1.6; }
.account-description, .account-help, .account-privacy { color: var(--muted); }
.account-help, .account-privacy { font-size: var(--fs-13); }
.account-service-note { color: var(--warning); }
.account-mode { display: flex; gap: 8px; }
.account-mode .btn { flex: 1; }
.account-form, .account-field, .account-summary, .account-confirmation { display: grid; gap: 8px; }
.account-form { gap: 16px; }
.account-field label { font-weight: var(--fw-600); }
.account-field input { width: 100%; min-width: 0; box-sizing: border-box; }
.account-error { color: var(--danger); font-size: var(--fs-13); }
.account-success { color: var(--success); }
.account-feedback { padding: 12px; background: var(--bg); border-radius: var(--radius-8); }
.account-summary, .account-confirmation { padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg-tint); }
.account-summary h3, .account-confirmation h3 { margin: 0; font-size: var(--fs-16); }
.account-summary .account-email { color: var(--text); font-size: var(--fs-15); font-weight: var(--fw-700); }
.account-summary small { color: var(--muted); }
.account-summary .btn { justify-self: start; }
.account-email { overflow-wrap: anywhere; }
.account-password-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; justify-self: start; cursor: pointer; }
.account-submit { width: 100%; }
.account-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.account-privacy { padding-top: 16px; border-top: 1px solid var(--border); }
</style>
