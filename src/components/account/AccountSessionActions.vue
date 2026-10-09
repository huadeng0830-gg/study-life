<script setup>
import { computed, ref } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import { accountSyncViaAccount } from '../../composables/accountSyncMode.js'
import { accountSyncStatus } from '../../composables/accountSyncState.js'

defineProps({ busy: Boolean })
const emit = defineEmits(['sign-out', 'backup'])
const scope = ref('')
const warning = computed(() => !accountSyncViaAccount.value
  ? '账号同步已关闭，本机记录可能尚未备份。'
  : accountSyncStatus.value !== 'synced'
    ? '当前同步尚未确认完成，未同步的修改可能丢失。'
    : '')
const message = computed(() => `${warning.value}${scope.value === 'global' ? '将退出所有设备的登录状态，' : '将退出当前设备，'}并清除当前设备上的课程、待办、账本等业务记录和本机副本。云端已同步的记录不会删除，其他设备的本机数据不会清除。需要保留本机记录时，请先导出备份。`)

function confirmSignOut() {
  const target = scope.value
  scope.value = ''
  emit('sign-out', target)
}
</script>

<template>
  <section class="account-session" aria-labelledby="account-session-title">
    <div class="account-session-heading">
      <div><h3 id="account-session-title">退出账号</h3><p>退出会清除当前设备上的业务数据，请先确认同步或备份已完成。</p></div>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('backup')">导出备份</button>
    </div>
    <p v-if="warning" class="account-session-warning">{{ warning }}</p>
    <div class="account-session-buttons">
      <button type="button" class="btn" :disabled="busy" @click="scope = 'local'">退出当前设备</button>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="scope = 'global'">退出所有设备</button>
    </div>
    <ConfirmDialog v-if="scope" :open="Boolean(scope)" :title="scope === 'global' ? '退出所有设备？' : '退出当前设备？'" :message="message" confirm-label="退出并清除本机数据" @close="scope = ''" @confirm="confirmSignOut" />
  </section>
</template>

<style scoped>
.account-session { display: grid; gap: 12px; }
.account-session-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.account-session-heading > div { min-width: 0; }
.account-session h3 { margin: 0 0 6px; font-size: var(--fs-16); }
.account-session p { margin: 0; color: var(--muted); font-size: var(--fs-13); line-height: 1.6; }
.account-session .account-session-warning { padding: 10px 12px; border-radius: var(--radius-8); background: var(--bg); color: var(--warning); }
.account-session-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.account-session .btn { min-height: 44px; }
.account-session-heading .btn { flex-shrink: 0; }
@media (max-width: 520px) {
  .account-session-heading { flex-direction: column; gap: 8px; }
  .account-session-buttons .btn { flex: 1; }
}
</style>
