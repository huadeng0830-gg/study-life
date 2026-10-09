<script setup>
import ActionButton from '../ActionButton.vue'
import { computed, ref, useId, watch } from 'vue'
import { accountOpen, accountUser } from '../../composables/accountAuth.js'
import { accountSyncViaAccount, setAccountSyncMode } from '../../composables/accountSyncMode.js'
import { accountSyncPreparing, accountSyncPreparationError } from '../../composables/accountSyncIdentity.js'
import { accountConflictKey, accountSyncConflicts, accountSyncError, accountSyncLastSyncedAt, accountSyncStatus, resolveAccountConflicts, syncAccountNow } from '../../composables/accountSyncState.js'
import { announce, announceAlert } from '../../composables/liveRegion.js'
import { localSafeMode } from '../../composables/localSafeMode.js'
const props = defineProps({ sectionId: String, compact: Boolean })
/** @type {import('vue').Ref<Record<string, string>>} */
const choices = ref({})
const panelId = useId()
const headingId = 'account-sync-' + panelId
// 提交冲突选择期间的本地忙碌态。busy 之前只看 accountSyncStatus，
// 而冲突全程状态都是 'conflict' —— 于是「确认并继续同步」在提交过程中
// 始终可点：第二次点击会走到 runAccountSync 的 `if (running) return running`，
// **返回在飞的那个 promise 并丢掉新传入的 choices**，用户的选择静默消失，
// 界面毫无变化。
const submitting = ref(false)
watch(accountSyncConflicts, () => { choices.value = {} })
const busy = computed(() => submitting.value || accountSyncPreparing.value || ['preparing', 'checking', 'syncing'].includes(accountSyncStatus.value))
const statusText = computed(() => ({
  'signed-out': '登录后自动同步', paused: '本机安全模式已暂停同步', preparing: '正在准备账号数据…', checking: '正在检查其他设备更新…',
  syncing: '正在同步账号数据…', pending: '本机修改已保存，等待同步', offline: '当前离线，本机修改会在联网后同步',
  synced: '账号数据已同步', conflict: '有同步差异需要确认', error: '账号同步暂未完成',
  disabled: '未开启账号同步',
}[accountSyncStatus.value] || '登录后自动同步'))
const timeText = computed(() => accountSyncLastSyncedAt.value ? new Date(accountSyncLastSyncedAt.value).toLocaleString('zh-CN') : '')

/**
 * 把任意值安全地渲染成可读文本。
 *
 * 冲突详情来自真实数据，JSON.stringify 遇到循环引用会直接抛 —— 而这里是在
 * 渲染函数里，一个异常会把**整个面板**变成空白，而不是只少显示一个值。
 */
function displayValue(value) {
  if (value === undefined) return '此记录已删除'
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (typeof text !== 'string') text = String(text)
  return text.length > 800 ? text.slice(0, 800) + '…' : text
}

// 状态与错误都是 v-if 插入的"新节点带内容"，VoiceOver 可能一个字都不播。
// 视觉照旧保留，发声交给常驻通道：同一句话不重复播报。
let lastStatus = ''
let lastError = ''
watch([accountSyncStatus, accountSyncError], ([status, error]) => {
  if (status !== lastStatus) { lastStatus = status; if (statusText.value) announce(statusText.value) }
  if (error && error !== lastError) { lastError = error; announceAlert(error) }
  if (!error) lastError = ''
})

async function synchronize() {
  if (localSafeMode.value || busy.value) return
  if (accountSyncPreparationError.value) {
    const { retryAccountSyncPreparation } = await import('../../composables/accountSyncLifecycle.js')
    await retryAccountSyncPreparation()
  } else await syncAccountNow()
}
async function submitChoices() {
  if (busy.value || localSafeMode.value) return
  submitting.value = true
  try {
    await resolveAccountConflicts(choices.value)
  } finally {
    submitting.value = false
  }
}

// 开关只改本机的通道选择。真正的停/启由 accountSyncLifecycle 监听同一个状态完成，
// 这里**不要**自己去调引擎 —— 两个地方停同一个引擎，总有一次会把刚起来的那轮也拆掉。
function toggleAccountSync() {
  if (accountSyncViaAccount.value) setAccountSyncMode('off')
  else setAccountSyncMode('account')
}
</script>

<template>
  <section :id="props.sectionId" class="account-sync-panel" :class="{ compact: props.compact }" :aria-labelledby="headingId">
    <h4 :id="headingId">账号同步</h4>
    <p class="account-sync-intro">登录同一账号并开启同步后，课程、待办、账本等数据会在设备间同步。壁纸图片只保存在本机，可在导出备份时选择携带。</p>
    <template v-if="accountUser">
      <div class="account-sync-switch">
        <div>
          <b>通过账号自动同步</b>
          <span v-if="accountSyncViaAccount">关闭后本机记录不再上传或下载，数据只留在这台设备上；随时可以再打开。</span>
          <span v-else>已关闭。本机记录照常读写与导出，但不会发送到云端，也不会拉取其它设备的更新。</span>
        </div>
        <button type="button" class="switch" role="switch" aria-label="通过账号自动同步" :aria-checked="accountSyncViaAccount" :class="{ on: accountSyncViaAccount }" @click="toggleAccountSync">
          <span>{{ accountSyncViaAccount ? '开' : '关' }}</span>
        </button>
      </div>
      <p class="account-sync-status">{{ statusText }}</p>
      <small v-if="timeText">上次完成：{{ timeText }}</small>
      <p v-if="accountSyncError" class="account-sync-error">{{ accountSyncError }}</p>
      <p v-if="localSafeMode" class="account-sync-error">当前处于本机安全模式，同步已暂停。</p>
      <ActionButton tone="neutral" v-if="accountSyncViaAccount" type="button" class="btn" :disabled="busy || localSafeMode" :busy="busy" kind="task" feedback="external" :show-error="false" :action="() => synchronize()">{{ busy ? '正在同步…' : accountSyncPreparationError ? '重试账号同步' : '立即同步' }}</ActionButton>
      <div v-if="accountSyncConflicts.length" class="account-conflicts">
        <p>两边都修改了同一份内容，请逐项选择。本机记录会保留到确认完成。</p>
        <article v-for="(conflict, index) in accountSyncConflicts" :key="accountConflictKey(conflict)" class="account-conflict">
          <b>{{ conflict.local?.title || conflict.local?.name || conflict.remote?.title || conflict.remote?.name || '设置差异' }}</b>
          <div class="account-conflict-values"><div><small>本机</small><pre>{{ displayValue(conflict.local) }}</pre></div><div><small>云端</small><pre>{{ displayValue(conflict.remote) }}</pre></div></div>
          <fieldset><legend>选择保留的版本</legend><label><input v-model="choices[accountConflictKey(conflict)]" type="radio" :name="'account-conflict-' + panelId + '-' + index" value="local" />保留本机</label><label><input v-model="choices[accountConflictKey(conflict)]" type="radio" :name="'account-conflict-' + panelId + '-' + index" value="remote" />使用云端</label></fieldset>
        </article>
        <ActionButton tone="primary" type="button" class="btn btn-primary" :disabled="busy || localSafeMode || accountSyncConflicts.some(conflict => !choices[accountConflictKey(conflict)])" :busy="submitting" kind="important" feedback="external" :show-error="false" :action="() => submitChoices()">{{ submitting ? '正在确认…' : '确认并继续同步' }}</ActionButton>
      </div>
    </template>
    <button v-else type="button" class="btn" @click="accountOpen = true">注册 / 登录</button>
  </section>
</template>

<style scoped>
.account-sync-panel { padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-16); background: var(--card); }
.account-sync-panel.compact { padding: 0; border: 0; border-radius: 0; background: transparent; }
.account-sync-panel h4 { margin: 0 0 6px; font-size: var(--fs-14); }
.account-sync-panel p, .account-sync-panel small { margin: 0; color: var(--muted); line-height: 1.6; }
.account-sync-panel .account-sync-intro { margin: 0 0 10px; }
/* 开关行：文案左、开关右，窄屏保持一行（按钮是固定尺寸，挤不坏）。 */
.account-sync-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.account-sync-switch b { display: block; color: var(--text); font-size: var(--fs-13); }
.account-sync-switch span { display: block; margin-top: 2px; color: var(--muted); font-size: var(--fs-11); line-height: 1.45; }
.account-sync-panel .btn { margin-top: 10px; }
.account-sync-panel .account-sync-status { margin: 0 0 4px; color: var(--text); }
.account-sync-panel .account-sync-error { margin: 8px 0 0; color: var(--danger); }
.account-sync-panel .switch { min-width: 48px; min-height: 44px; }
.account-conflicts { display: grid; gap: 12px; margin-top: 16px; }
.account-conflict { padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-10); }
.account-conflict-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.account-conflict pre { font-size: var(--fs-12); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.account-conflict fieldset { display: flex; flex-wrap: wrap; gap: 14px; border: 0; padding: 0; }
.account-conflict legend { font-size: var(--fs-12); margin-bottom: 8px; }
.account-conflict label { display: flex; gap: 6px; align-items: center; }
/* 375px 的手机上并排两个 pre 只有约 150px 宽，本机/云端对照根本没法读。 */
@media (max-width:520px) {
  .account-conflict-values { grid-template-columns: 1fr; }
  .account-conflict pre { max-height: 200px; }
}
</style>
