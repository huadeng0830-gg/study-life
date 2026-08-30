<script setup>
defineProps({
  items: { type: Array, default: () => [] },
})
defineEmits(['complete-task', 'rescue-task'])

const sourceLabel = {
  course: '课程', task: '待办', event: '日程', milestone: '节点', bill: '账单',
}
</script>

<template>
  <section v-if="items.length" class="agenda panel" aria-label="今日行动清单">
    <div class="panel-head">
      <h2>今日行动清单</h2>
      <span class="panel-progress">课程、待办与日程</span>
    </div>
    <div class="agenda-list">
      <div v-for="item in items" :key="item.key" class="agenda-row" :class="{ overdue: item.kind === 'overdue' }">
        <span class="agenda-source">{{ sourceLabel[item.sourceType] }}</span>
        <span class="agenda-time">{{ item.kind === 'overdue' ? '逾期' : item.time || '全天' }}</span>
        <b>{{ item.title }}</b>
        <span v-if="item.meta" class="agenda-meta">{{ item.meta }}</span>
        <span v-if="item.sourceType === 'task'" class="agenda-actions"><button type="button" class="agenda-action" @click="$emit('complete-task', item.sourceId)">完成</button><button type="button" class="agenda-action subtle" @click="$emit('rescue-task', item.sourceId, item.kind === 'overdue' ? 'tonight' : 'tomorrow')">{{ item.kind === 'overdue' ? '今晚' : '明天' }}</button></span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agenda { padding-block: 15px; }
.agenda-list { display: flex; flex-direction: column; }
.agenda-row { display: grid; grid-template-columns: auto 46px minmax(0, 1fr) auto auto; align-items: center; gap: 9px; min-height: 42px; border-top: 1px solid var(--border); }
.agenda-row:first-child { border-top: 0; }
.agenda-source { padding: 3px 6px; color: var(--ink-soft); font-size: 10.5px; font-weight: 750; border-radius: 5px; background: var(--bg-tint); }
.agenda-time { color: var(--ink-soft); font-size: 12px; font-variant-numeric: tabular-nums; }
.agenda-row b { min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.agenda-meta { max-width: 160px; overflow: hidden; color: var(--ink-soft); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.agenda-row.overdue .agenda-time { color: var(--danger); font-weight: 750; }
.agenda-action { padding: 4px 7px; color: var(--primary); font-size: 11px; font-weight: 750; border: 0; border-radius: 6px; background: var(--primary-soft); }
.agenda-actions { display: flex; gap: 4px; }
.agenda-action.subtle { color: var(--ink-soft); background: var(--bg-tint); }
@media (max-width: 520px) {
  .agenda-row { grid-template-columns: auto 42px minmax(0, 1fr) auto; gap: 7px; }
  .agenda-meta { display: none; }
}
</style>
