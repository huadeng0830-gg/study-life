<script setup>
import { computed } from 'vue'

/**
 * 结构骨架屏。
 *
 * 用在「结构已经确定、数据还没回来」的短等待场景：
 * 先按真实布局占好位置，内容到位后原位替换，避免整块突然跳出。
 *
 * 动效降级不用在这里判断：全局的 data-performance='reduced' 规则和
 * prefers-reduced-motion 已经会把 shimmer 动画压掉，只剩静态灰块。
 */

const props = defineProps({
  // line：文本行；card：卡片轮廓
  variant: { type: String, default: 'line' },
  // line 时是行数，card 时是卡片数
  lines: { type: Number, default: 1 },
  // 每行宽度；数字按百分比，字符串原样使用
  widths: { type: Array, default: () => [] },
  // card 变体的单卡高度
  cardHeight: { type: Number, default: 76 },
})

const rows = computed(() => {
  const count = Math.max(1, Math.trunc(Number(props.lines) || 1))
  return Array.from({ length: count }, (_, index) => props.widths[index] ?? null)
})

function styleFor(width) {
  if (width === null || width === undefined) return null
  return { width: typeof width === 'number' ? `${width}%` : String(width) }
}
</script>

<template>
  <div class="skeleton-block" :class="`is-${variant}`" aria-hidden="true">
    <span
      v-for="(width, index) in rows"
      :key="index"
      class="skeleton-bar"
      :style="variant === 'card' ? { height: `${cardHeight}px` } : styleFor(width)"
    />
  </div>
</template>

<style scoped>
.skeleton-block {
  display: grid;
  gap: 9px;
  width: 100%;
}
.skeleton-bar {
  display: block;
  width: 100%;
  height: 11px;
  border-radius: var(--radius-7);
  background: linear-gradient(90deg, var(--border) 25%, var(--bg-tint) 37%, var(--border) 63%);
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}
.skeleton-block.is-card .skeleton-bar {
  border-radius: var(--card-radius, 14px);
  border: 1px solid var(--border);
}
@keyframes skeleton-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
</style>