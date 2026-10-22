<script setup lang="ts">
import type { PropType } from 'vue'

/**
 * 用量与限流面板。
 *
 * 【只显示聚合数字】快照体积、账号数、限流命中次数。**不显示任何记录内容**——
 * 运维台是最容易被截图或转发的地方，所以这里刻意只留"多少"，不留"是什么"。
 */
defineProps({
  usage: { type: Object as PropType<{
    snapshotUsers: number, snapshotBytes: number, rateLimitHits: Record<string, number>,
  } | null>, default: null },
  error: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['refresh'])

/** 显式标注键类型，否则用 string 索引会因"没有索引签名"报错。 */
const ACTION_LABELS: Record<string, string> = Object.freeze({
  email_search: '邮箱搜索',
  availability_query: '空档查询',
  friend_request: '好友请求',
  invitation: '活动邀约',
})

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <section class="ops-panel ops-usage" aria-labelledby="ops-usage-heading">
    <div class="ops-panel-heading">
      <div><h2 id="ops-usage-heading">用量与限流</h2><p>只统计字节数与命中次数，不读取任何记录内容。</p></div>
      <button class="ops-button ops-button-quiet" type="button" :disabled="loading" @click="emit('refresh')">{{ loading ? '读取中' : '刷新' }}</button>
    </div>
    <p v-if="error" class="ops-inline-error" role="alert">{{ error }}</p>
    <template v-else-if="usage">
      <dl class="ops-usage-list">
        <div><dt>有云端快照的账号</dt><dd>{{ usage.snapshotUsers }} 个</dd></div>
        <div><dt>快照合计体积</dt><dd>{{ formatBytes(usage.snapshotBytes) }}</dd></div>
        <div v-for="(hits, action) in usage.rateLimitHits" :key="action"><dt>限流命中 · {{ ACTION_LABELS[action] || action }}</dt><dd>{{ hits }} 次</dd></div>
      </dl>
      <p v-if="!Object.keys(usage.rateLimitHits || {}).length" class="ops-empty">近期没有触发限流的记录。</p>
    </template>
    <p v-else class="ops-empty" role="status">正在读取用量…</p>
  </section>
</template>

<style scoped>
.ops-panel { min-width:0; padding:17px 18px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.ops-panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
.ops-panel-heading h2 { margin:0; font-size:var(--fs-15); font-weight:var(--fw-750); }
.ops-panel-heading p { margin:4px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.55; }
.ops-usage-list { display:grid; margin:0; }
.ops-usage-list > div { display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--border); }
.ops-usage-list dt { color:var(--ink-soft); font-size:var(--fs-11); }
.ops-usage-list dd { margin:0; font-size:var(--fs-11); font-weight:var(--fw-650); font-variant-numeric:tabular-nums; }
.ops-empty { padding:19px 10px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-12); text-align:center; }
.ops-inline-error { padding:10px 12px; border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border)); border-radius:var(--radius-8); color:var(--danger); background:var(--danger-soft); font-size:var(--fs-12); line-height:1.55; }
.ops-button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:7px 12px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--text); background:var(--card); font:inherit; font-size:var(--fs-12); font-weight:var(--fw-650); cursor:pointer; }
.ops-button-quiet { color:var(--ink-soft); background:var(--bg-tint); }
.ops-button:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
.ops-button:disabled { cursor:wait; opacity:.58; }
@media (max-width:520px) {
  .ops-panel { padding:14px; }
}
</style>