<script setup>
defineProps({ pulse: { type: Object, required: true } })
</script>

<template>
  <section class="weekly-pulse panel secondary-panel" aria-label="本周脉搏">
    <div class="panel-head"><h2>本周脉搏</h2><span class="panel-progress">真实记录，不做评分</span></div>
    <div class="pulse-stats"><div><b>{{ pulse.done }}</b><span>完成待办</span></div><div><b>{{ pulse.minutes ? `${pulse.minutes}m` : '—' }}</b><span>实际专注</span></div><div><b>{{ pulse.moodDays }}</b><span>心情记录</span></div></div>
    <p>{{ pulse.suggestion }}</p>
  </section>
</template>

<style scoped>
.pulse-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pulse-stats div { display: flex; flex-direction: column; gap: 3px; padding: 9px; text-align: center; border-radius: 9px; background: var(--bg-tint); }
.pulse-stats b { font-size: 17px; font-variant-numeric: tabular-nums; }
.pulse-stats span, .weekly-pulse p { color: var(--ink-soft); font-size: 11px; }
.weekly-pulse p { margin-top: 10px; line-height: 1.55; }
</style>
