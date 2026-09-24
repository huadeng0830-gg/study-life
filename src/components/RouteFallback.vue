<script setup>
import SkeletonBlock from './SkeletonBlock.vue'

const props = defineProps({ error: Boolean })

function retry() {
  window.location.reload()
}
</script>

<template>
  <section class="route-fallback" :class="{ error: props.error }" :aria-live="props.error ? 'assertive' : 'polite'">
    <template v-if="props.error">
      <p>页面加载失败，本机数据仍然保留。</p>
      <button type="button" class="btn" @click="retry">重新加载</button>
    </template>

    <template v-else>
      <!-- 按真实页面结构占位：标题、指标卡、列表行。
           内容回来之后直接在原位替换，而不是整块跳出来。 -->
      <div class="rf-head">
        <SkeletonBlock :widths="[34, 58]" />
      </div>
      <div class="rf-grid">
        <SkeletonBlock variant="card" :lines="2" :card-height="72" />
        <SkeletonBlock variant="card" :lines="1" :card-height="72" />
      </div>
      <div class="rf-list">
        <SkeletonBlock :lines="4" :widths="[86, 68, 92, 54]" />
      </div>
      <p class="sr-only">页面加载中…</p>
    </template>
  </section>
</template>

<style scoped>
.route-fallback {
  display: grid;
  gap: 14px;
  width: min(760px, 100%);
  margin: 0 auto;
  padding: 22px;
}
.route-fallback.error {
  justify-items: center;
  align-content: center;
  min-height: 40vh;
  min-height: 40dvh;
  text-align: center;
  color: var(--ink-soft);
}
.rf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.rf-list {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius, 14px);
  background: var(--card);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>