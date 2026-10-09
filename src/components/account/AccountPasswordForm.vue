<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { accountBusy, accountUser, updateAccountPassword, validateAccountPassword } from '../../composables/accountAuth.js'
import { announceAlert } from '../../composables/liveRegion.js'

const props = defineProps({ recovery: Boolean, resetSeconds: { type: Number, default: 0 } })
const emit = defineEmits(['updated', 'reset-request'])
const currentPassword = ref('')
const password = ref('')
const confirmation = ref('')
const visible = ref(false)
const errors = ref(/** @type {Record<string, string>} */ ({}))
const error = ref('')
const submitting = ref(false)
const currentInput = ref(/** @type {HTMLInputElement | null} */ (null))
const passwordInput = ref(/** @type {HTMLInputElement | null} */ (null))
const confirmationInput = ref(/** @type {HTMLInputElement | null} */ (null))
const busy = computed(() => submitting.value || accountBusy.value)

function clear() {
  currentPassword.value = ''
  password.value = ''
  confirmation.value = ''
  visible.value = false
  errors.value = {}
  error.value = ''
}

watch(() => accountUser.value?.id, clear)
onBeforeUnmount(clear)

function edit(field) {
  errors.value = { ...errors.value, [field]: '' }
  error.value = ''
}

async function focusError() {
  await nextTick()
  const input = errors.value.currentPassword ? currentInput : errors.value.password ? passwordInput : confirmationInput
  input.value?.focus()
  announceAlert(Object.values(errors.value).find(Boolean) || '')
}

async function submit() {
  if (busy.value) return
  error.value = ''
  const values = { currentPassword: currentPassword.value, password: password.value, confirmation: confirmation.value }
  errors.value = validateAccountPassword({ ...values, recovery: props.recovery })
  if (Object.keys(errors.value).length) return focusError()
  submitting.value = true
  try {
    const result = await updateAccountPassword(values)
    if (!result.ok) {
      if (result.errors) {
        errors.value = result.errors
        await focusError()
      } else {
        error.value = result.message
        announceAlert(result.message)
      }
      return
    }
    clear()
    emit('updated')
  } finally { submitting.value = false }
}
</script>

<template>
  <section class="account-security" aria-labelledby="account-security-title">
    <h3 id="account-security-title">{{ recovery ? '设置新密码' : '修改密码' }}</h3>
    <p class="account-help">{{ recovery ? '邮箱身份已验证。设置新密码后，下次登录使用新密码。' : '使用独立且不易猜到的密码保护学习与生活记录。' }}</p>
    <form class="account-password-form" novalidate :aria-busy="busy" @submit.prevent="submit">
      <div v-if="!recovery" class="account-field">
        <label for="account-current-password">当前密码</label>
        <input id="account-current-password" ref="currentInput" v-model="currentPassword" name="current-password" :type="visible ? 'text' : 'password'" autocomplete="current-password" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy" :aria-invalid="Boolean(errors.currentPassword)" :aria-describedby="errors.currentPassword ? 'account-current-password-error' : undefined" @input="edit('currentPassword')" />
        <p v-if="errors.currentPassword" id="account-current-password-error" class="account-error">{{ errors.currentPassword }}</p>
      </div>
      <div class="account-field">
        <label for="account-new-password">新密码</label>
        <input id="account-new-password" ref="passwordInput" v-model="password" name="new-password" :type="visible ? 'text' : 'password'" autocomplete="new-password" autocapitalize="none" autocorrect="off" :spellcheck="false" required minlength="8" :disabled="busy" :aria-invalid="Boolean(errors.password)" :aria-describedby="errors.password ? 'account-new-password-error account-new-password-help' : 'account-new-password-help'" @input="edit('password')" />
        <p id="account-new-password-help" class="account-help">至少 8 位，建议使用较长的密码并混合字母、数字和符号。</p>
        <p v-if="errors.password" id="account-new-password-error" class="account-error">{{ errors.password }}</p>
      </div>
      <div class="account-field">
        <label for="account-new-confirmation">再次输入新密码</label>
        <input id="account-new-confirmation" ref="confirmationInput" v-model="confirmation" name="new-password-confirmation" :type="visible ? 'text' : 'password'" autocomplete="new-password" autocapitalize="none" autocorrect="off" :spellcheck="false" required :disabled="busy" :aria-invalid="Boolean(errors.confirmation)" :aria-describedby="errors.confirmation ? 'account-new-confirmation-error' : undefined" @input="edit('confirmation')" />
        <p v-if="errors.confirmation" id="account-new-confirmation-error" class="account-error">{{ errors.confirmation }}</p>
      </div>
      <label class="account-password-toggle"><input v-model="visible" type="checkbox" :disabled="busy" />显示密码</label>
      <p v-if="error" class="account-error">{{ error }}</p>
      <button type="submit" class="btn btn-primary" :disabled="busy" :aria-busy="busy">{{ submitting ? '正在保存…' : '保存新密码' }}</button>
      <button v-if="!recovery" type="button" class="btn btn-ghost" :disabled="busy || resetSeconds > 0" @click="emit('reset-request')">{{ resetSeconds > 0 ? resetSeconds + ' 秒后可重发邮件' : '忘记当前密码？通过邮箱重设' }}</button>
    </form>
  </section>
</template>

<style scoped>
.account-security, .account-password-form, .account-field { display: grid; gap: 8px; }
.account-security h3 { margin: 0; font-size: var(--fs-16); }
.account-password-form { margin-top: 8px; gap: 16px; }
.account-field label { font-weight: var(--fw-600); }
.account-field input { width: 100%; min-width: 0; box-sizing: border-box; }
.account-help { color: var(--muted); font-size: var(--fs-13); }
.account-error { color: var(--danger); font-size: var(--fs-13); }
.account-help, .account-error { margin: 0; line-height: 1.6; }
.account-password-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; justify-self: start; cursor: pointer; }
.account-password-form .btn { min-height: 44px; }
</style>
