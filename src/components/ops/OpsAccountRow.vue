<script setup lang="ts">
import type { PropType } from 'vue'

/**
 * 运维台账号行。
 *
 * 【为什么抽出来】账号行是本页面最复杂的一块（状态标签、主操作、次级操作抽屉、
 * 展开后的同步详情），此前整块堆在 PlatformAdminView 里，把那个文件推到棘轮上限之上。
 * 它的数据边界很清楚——只渲染脱敏后的字段与同步**元数据**，不接触任何用户正文。
 */
defineProps({
  account: { type: Object as PropType<{
    id: string, email: string, status: string, platformOwner: boolean,
    createdAt: string | null, lastSignInAt: string | null,
  }>, required: true },
  expanded: { type: Boolean, default: false },
  /** 只有展开的那一行才有同步详情；其余传 null。 */
  sync: { type: Object as PropType<{
    snapshot: { revision: number, updatedAt: string | null, deviceName: string, payloadBytes: number | null } | null,
    health: { state: string, label: string, tone: string },
  } | null>, default: null },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle', 'change-status', 'account-action', 'load-sync'])

/** 显式标注键类型，否则用 string 索引会因"没有索引签名"报错。 */
const STATUS_LABELS: Record<string, string> = Object.freeze({
  active: '正常', suspended: '已暂停', unverified: '待验证',
})

function dateLabel(value?: string | null): string {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间无法识别'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function bytesLabel(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '未记录'
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <li class="ops-account-row" :data-open="expanded">
    <div class="account-primary">
      <b>{{ account.email || '未设置邮箱' }}</b>
      <span class="account-status" :data-status="account.status">{{ STATUS_LABELS[account.status] || '未知' }}</span>
      <small>注册 {{ dateLabel(account.createdAt) }}<span class="account-last-seen">最近登录 {{ dateLabel(account.lastSignInAt) }}</span></small>
    </div>
    <div class="account-actions">
      <button v-if="!account.platformOwner && account.status === 'active'" class="ops-button ops-button-danger" type="button" :disabled="busy" @click="emit('change-status', account, true)">暂停</button>
      <button v-else-if="!account.platformOwner && account.status === 'suspended'" class="ops-button ops-button-quiet" type="button" :disabled="busy" @click="emit('change-status', account, false)">恢复</button>
      <span v-else-if="account.platformOwner" class="account-owner-tag">平台所有者</span>
      <span v-else class="account-no-action">无需处理</span>
      <button class="ops-button ops-button-quiet account-more" type="button" :aria-expanded="expanded" @click="emit('toggle', account.id)">更多</button>
    </div>
    <div v-if="expanded" class="account-drawer">
      <button class="ops-button ops-button-quiet" type="button" @click="emit('account-action', account, 'user_sessions_revoke')">吊销全部会话</button>
      <button class="ops-button ops-button-quiet" type="button" @click="emit('account-action', account, 'user_password_reset')">发送密码重置</button>
      <button class="ops-button ops-button-quiet" type="button" @click="emit('load-sync', account.id)">
        {{ sync ? '收起同步状态' : '查看同步状态' }}
      </button>
      <dl v-if="sync" class="sync-detail">
        <div><dt>同步状态</dt><dd :data-tone="sync.health.tone">{{ sync.health.label }}</dd></div>
        <div><dt>云端版本</dt><dd>{{ sync.snapshot ? `r${sync.snapshot.revision}` : '—' }}</dd></div>
        <div><dt>最后同步</dt><dd>{{ dateLabel(sync.snapshot?.updatedAt) }}</dd></div>
        <div><dt>同步设备</dt><dd>{{ sync.snapshot?.deviceName || '未记录' }}</dd></div>
        <div><dt>数据体积</dt><dd>{{ bytesLabel(sync.snapshot?.payloadBytes) }}</dd></div>
      </dl>
    </div>
  </li>
</template>

<style scoped>
.ops-account-row { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:75px; padding:10px 0; border-top:1px solid var(--border); }
.ops-account-row[data-open='true'] { flex-wrap:wrap; }
.account-primary { display:flex; align-items:center; flex-wrap:wrap; gap:7px 10px; min-width:0; }
.account-primary > b { overflow:hidden; max-width:100%; font-size:var(--fs-13); font-weight:var(--fw-650); text-overflow:ellipsis; white-space:nowrap; }
.account-primary small { display:flex; flex-basis:100%; flex-wrap:wrap; gap:3px 12px; color:var(--muted); font-size:var(--fs-10); line-height:1.5; }
.account-status,.account-owner-tag { display:inline-flex; align-items:center; min-height:23px; padding:2px 8px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--bg-tint); font-size:var(--fs-10); white-space:nowrap; }
.account-status[data-status='active'] { border-color:color-mix(in srgb,var(--success) 28%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 7%,var(--card)); }
.account-status[data-status='suspended'] { border-color:color-mix(in srgb,var(--danger) 30%,var(--border)); color:var(--danger); background:var(--danger-soft); }
.account-owner-tag { border-color:color-mix(in srgb,var(--primary) 27%,var(--border)); color:var(--primary); background:var(--primary-soft); }
.account-no-action { color:var(--muted); font-size:var(--fs-11); white-space:nowrap; }
.account-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.account-drawer { display:grid; justify-items:start; gap:7px; flex-basis:100%; padding:4px 0 10px; }
.sync-detail { display:grid; gap:5px; width:100%; margin:6px 0 0; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg-tint); }
.sync-detail > div { display:flex; justify-content:space-between; gap:12px; }
.sync-detail dt { color:var(--muted); font-size:var(--fs-11); }
.sync-detail dd { margin:0; color:var(--ink-soft); font-size:var(--fs-11); font-variant-numeric:tabular-nums; }
.sync-detail dd[data-tone='success'] { color:var(--success); }
.sync-detail dd[data-tone='warning'] { color:var(--warning); }
.sync-detail dd[data-tone='danger'] { color:var(--danger); }
@media (max-width:520px) {
  .ops-account-row { align-items:flex-start; }
  .account-actions > .ops-button { min-width:56px; min-height:44px; }
  .account-primary { gap:5px 7px; }
  .account-primary > b { font-size:var(--fs-12); }
  .account-primary small { gap:2px; }
  .account-last-seen { flex-basis:100%; }
}
</style>