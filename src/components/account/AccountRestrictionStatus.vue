<script setup>
import { computed, ref, useId } from 'vue'
import { accountRestrictions, accountCloudRestricted, restrictionSnapshotKnown, restrictionError, restrictionNow, restrictionStatus, refreshAccountRestrictions, acknowledgeRestriction } from '../../composables/accountRestrictions.js'
import { restrictionActive, restrictionDate, restrictionRemaining, restrictionScopes } from '../../composables/accountRestrictionModel.js'
import { openAccountSection } from '../../composables/accountAuth.js'
const props = defineProps({ compact: Boolean, embedded: Boolean })
const pending = ref('')
const headingId = `account-restriction-${useId()}`
const ackError = ref('')
const entries = computed(() => restrictionSnapshotKnown.value ? Object.values(accountRestrictions.value?.restrictions || {}) : [])
async function acknowledge(item) {
  if (pending.value) return
  pending.value = item.scope
  ackError.value = ''
  try { if (!await acknowledgeRestriction(item.scope, item.revision)) ackError.value = '通知状态未确认，请刷新后检查。' }
  catch { ackError.value = '通知状态未保存，请稍后重试。' }
  finally { pending.value = '' }
}
</script>

<template>
  <section class="restriction-status" :class="{ compact }" :aria-labelledby="headingId">
    <header><h3 :id="headingId">{{ !restrictionSnapshotKnown ? '账号状态检查' : accountCloudRestricted ? '账号封禁告知' : '账号处理通知' }}</h3><button class="btn" type="button" :disabled="restrictionStatus === 'loading'" @click="refreshAccountRestrictions({ force: true })">{{ restrictionStatus === 'loading' ? '检查中…' : '重新检查状态' }}</button></header>
    <p v-if="!restrictionSnapshotKnown && !restrictionError" class="restriction-help" role="status">正在核实账号使用权限，请稍候。本机记录仍可使用。</p>
    <p v-if="accountCloudRestricted" class="restriction-help">封禁期间仅可查看处理说明、管理登录状态及使用本机数据，云端同步、发布、私信和协作暂停。到期或管理员提前解除后可恢复。</p>
    <p v-if="restrictionError" class="restriction-failure" role="alert">{{ restrictionError }}</p>
    <div v-for="item in entries" :key="item.scope" class="restriction-item" :data-active="restrictionActive(item, restrictionNow)" :role="item.unread ? 'alert' : 'status'">
      <div class="restriction-item-title"><b>{{ restrictionScopes[item.scope] }} · {{ restrictionActive(item, restrictionNow) ? restrictionRemaining(item, restrictionNow) : item.enabled ? '已到期，自动解除' : '已提前解除' }}</b><span v-if="item.unread">新通知</span></div>
      <p class="restriction-reason">{{ item.reason }}</p>
      <dl><div><dt>处理时间</dt><dd>{{ restrictionDate(item.updatedAt) }}</dd></div><div v-if="item.enabled"><dt>{{ item.expiresAt ? '解除时间' : '限制期限' }}</dt><dd>{{ restrictionDate(item.expiresAt) }}</dd></div></dl>
      <button v-if="item.unread" class="btn" type="button" :disabled="Boolean(pending)" @click="acknowledge(item)">{{ pending === item.scope ? '保存中…' : '我已知晓' }}</button>
    </div>
    <p v-if="restrictionSnapshotKnown && accountRestrictions?.legacyBannedUntil" class="restriction-help">此账号还存在旧版登录封禁，至 {{ restrictionDate(accountRestrictions.legacyBannedUntil) }}。如需提前恢复，请联系管理方核查。</p>
    <p v-if="ackError" class="restriction-failure" role="alert">{{ ackError }}</p>
    <p v-if="!entries.length && restrictionStatus === 'ready' && !accountRestrictions?.legacyBannedUntil" class="restriction-help">当前没有账号限制或处理通知。</p>
    <button v-if="accountCloudRestricted && !props.compact && !props.embedded" type="button" class="btn" @click="openAccountSection('overview')">备份与退出账号</button>
  </section>
</template>

<style scoped>
.restriction-status { width:100%; max-width:760px; margin:18px auto; padding:20px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); }
.restriction-status.compact { margin:0; padding:0; border:0; }
header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
h3 { margin:0; font-size:var(--fs-16); }
.restriction-help { color:var(--muted); font-size:var(--fs-12); line-height:1.65; }
.restriction-item { display:grid; gap:10px; margin-top:14px; padding:14px; border:1px solid var(--border); border-radius:var(--radius-8); }
.restriction-item[data-active='true'] { border-color:color-mix(in srgb,var(--danger) 28%,var(--border)); }
.restriction-item-title { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:var(--fs-13); }
.restriction-item-title span { color:var(--primary); font-size:var(--fs-11); }
.restriction-reason { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.65; font-size:var(--fs-13); }
dl { display:grid; gap:6px; margin:0; color:var(--muted); font-size:var(--fs-12); }
dl div { display:flex; flex-wrap:wrap; gap:6px 14px; }
dd { margin:0; }
.restriction-item button { justify-self:start; }
.restriction-failure { color:var(--danger); font-size:var(--fs-12); }
</style>
