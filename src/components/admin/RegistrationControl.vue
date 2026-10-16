<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { platformAdminRequest } from '../../services/platformAdmin.js'
import ConfirmDialog from '../ConfirmDialog.vue'
const state = ref(/** @type {{enabled:boolean,updatedAt:string}|null} */ (null))
const loading = ref(false)
const saving = ref(false)
const confirmation = ref(false)
const error = ref('')
const notice = ref('')
let generation = 0
async function refresh() {
  const run = ++generation
  loading.value = true; error.value = ''
  try {
    const next = await platformAdminRequest('registration_get')
    if (run !== generation) return
    if (typeof next?.enabled !== 'boolean' || !next.updatedAt) throw new Error('注册状态暂时无法读取。')
    state.value = next
  } catch (cause) { if (run === generation) error.value = cause?.message || '注册状态暂时无法读取。' }
  finally { if (run === generation) loading.value = false }
}
async function save() {
  confirmation.value = false
  if (!state.value || saving.value) return
  const run = generation
  const enabled = !state.value.enabled
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const next = await platformAdminRequest('registration_set', { enabled, expectedUpdatedAt: state.value.updatedAt })
    if (run !== generation) return
    if (next?.enabled !== enabled || !next.updatedAt) throw new Error('注册状态没有确认保存，请重新读取。')
    state.value = next
    notice.value = enabled ? '新用户注册已恢复。' : '新用户注册已暂停，已有账号仍可登录。'
  } catch (cause) { if (run === generation) error.value = cause?.message || '设置未保存，请重新读取后重试。' }
  finally { if (run === generation) saving.value = false }
}
onMounted(refresh)
onBeforeUnmount(() => { generation += 1 })
</script>
<template>
  <section class="registration-control" aria-labelledby="registration-control-title">
    <div class="registration-heading"><h2 id="registration-control-title">新用户注册</h2><span v-if="state" :class="{ paused: !state.enabled }">{{ state.enabled ? '开放中' : '已暂停' }}</span></div>
    <p>暂停后，所有入口都无法创建新账号。已有用户仍可登录。</p>
    <p v-if="error" role="alert" class="registration-error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <div class="registration-actions"><button type="button" class="btn btn-ghost" :disabled="loading || saving" @click="refresh">{{ loading ? '读取中' : '刷新状态' }}</button><button v-if="state" type="button" class="btn" :class="state.enabled ? 'btn-ghost' : 'btn-primary'" :disabled="loading || saving" @click="confirmation = true">{{ saving ? '保存中…' : state.enabled ? '暂停注册' : '恢复注册' }}</button></div>
  </section>
  <ConfirmDialog :open="confirmation" :title="state?.enabled ? '暂停新用户注册？' : '恢复新用户注册？'" :message="state?.enabled ? '暂停后，任何入口都无法创建新账号。已有账号仍可登录；你可以随时在这里恢复。' : '恢复后，新用户可以继续创建账号。已有用户不受影响。'" :confirm-label="state?.enabled ? '确认暂停注册' : '恢复注册'" :tone="state?.enabled ? 'danger' : 'primary'" @close="confirmation = false" @confirm="save" />
</template>
<style scoped>
.registration-control{padding:22px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);margin-bottom:20px}.registration-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.registration-heading h2{margin:0;font-size:var(--fs-17)}.registration-heading span{color:var(--success);font-size:var(--fs-13)}.registration-heading span.paused{color:var(--warning)}.registration-control p{color:var(--muted);font-size:var(--fs-13);line-height:1.7;margin:12px 0}.registration-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:16px}.registration-control .registration-error{color:var(--danger)}@media(max-width:520px){.registration-control{padding:16px}.registration-actions button{flex:1;min-height:44px}}
</style>
