<script setup>
import { computed, ref } from 'vue'
import { accountSyncViaAccount } from '../../composables/accountSyncMode.js'
import { accountSyncStatus } from '../../composables/accountSyncState.js'
import { useLocalDataPurge } from '../../composables/localDataPurge.js'
import ConfirmDialog from '../ConfirmDialog.vue'
import { Button } from '../ui/button'

/**
 * 清空本机数据。
 *
 * 放在数据管理里，因为这是唯一一个既不需要退出账号、又确实能把这台设备
 * 清干净的地方。放在「我的账号 → 账号安全」不合适：退出账号是账号行为，
 * 清数据是本机行为，两者的后果完全不同。
 */
const emit = defineEmits(['export'])
const purge = useLocalDataPurge()
const confirming = ref(false)
// 云端还有副本时，本机清空是可逆的；否则唯一的退路就是备份文件。
const cloudCopy = computed(() => purge.signedIn.value && accountSyncViaAccount.value && accountSyncStatus.value === 'synced')

function openConfirm() {
  purge.error.value = ''
  confirming.value = true
}
</script>

<template>
  <section class="data-section purge-section" aria-labelledby="data-purge-title">
    <div class="purge-copy">
      <h4 id="data-purge-title">清空本机数据</h4>
      <p>删除这台设备上的全部本机记录：课程、待办、日程、账本、专注、清单、地点、通知档案、壁纸图片和本机恢复点。<b>不会</b>退出账号，也不会删除云端已同步的记录。</p>
      <p v-if="purge.error.value" class="purge-warning" role="alert">{{ purge.error.value }}</p>
      <p v-else-if="purge.shouldWarnBackup.value" class="purge-warning" role="alert">还没有近期备份文件。清空之后只能靠已导出的备份恢复，建议先导出。</p>
      <p v-else-if="cloudCopy" class="purge-note">云端已同步，重新登录后可以再同步回来。</p>
    </div>
    <div class="purge-actions">
      <Button variant="outline" type="button" :disabled="purge.purging.value" @click="emit('export')">先导出备份</Button>
      <Button variant="destructive" type="button" :disabled="purge.purging.value" @click="openConfirm">{{ purge.purging.value ? '正在清空…' : '清空本机数据' }}</Button>
    </div>
  </section>

  <ConfirmDialog
    v-if="confirming"
    :open="true"
    title="清空这台设备上的全部本机数据？"
    :message="purge.confirmMessage.value"
    confirm-label="确认清空本机数据"
    tone="danger"
    @close="confirming = false"
    @confirm="purge.purgeLocalData()"
  />
</template>

<style scoped>
.purge-section {
  flex-direction: column;
  align-items: stretch;
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
}
.purge-copy { display: grid; gap: 6px; }
.purge-copy h4 { margin: 0; font-size: var(--fs-14); }
.purge-copy p { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; }
.purge-copy b { color: var(--ink-soft); font-weight: var(--fw-700); }
.purge-warning { color: var(--danger); }
.purge-note { color: var(--success); }
.purge-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.purge-actions > * { flex: 1; min-height: 44px; }
</style>