<script setup lang="ts">
import type { PropType } from 'vue'
/**
 * 筛选芯片组：把一组互斥的选项渲染成一排可切换按钮。
 *
 * 【为什么抽出来】运维页有五处几乎一模一样的筛选条（账号状态、项目状态、
 * 审计动作、审计结果、暂停时长）。它们此前各自复制一遍 `aria-pressed` +
 * `data-active` + `v-for`，改一次可访问性语义要改五处——这正是"重复模板"的典型代价。
 *
 * 【可访问性】整组是一个 `role="group"`，并带可见的 aria-label；
 * 每个芯片用 `aria-pressed` 表达选中态，读屏听到的是"已按下／未按下"，
 * 比只靠颜色区分可靠得多。
 */
defineProps({
  /** `[{ id, label }]`。显式标注元素类型；用 readonly 接纳宿主 `Object.freeze` 的常量数组。 */
  options: { type: Array as PropType<readonly { id: string, label: string }[]>, required: true },
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="ops-filters" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="ops-chip"
      :aria-pressed="modelValue === option.id"
      :data-active="modelValue === option.id"
      @click="emit('update:modelValue', option.id)"
    >{{ option.label }}</button>
  </div>
</template>

<style scoped>
.ops-filters { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 11px; }
.ops-chip { min-height:34px; padding:5px 11px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--card); font:inherit; font-size:var(--fs-11); font-weight:var(--fw-650); cursor:pointer; }
.ops-chip:hover { border-color:var(--primary); color:var(--primary); background:var(--primary-soft); }
.ops-chip[data-active='true'] { border-color:var(--primary); color:var(--on-primary); background:var(--primary); }
.ops-chip:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
</style>