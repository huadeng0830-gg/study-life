<script setup>
import { TabsContent } from '@/components/ui/tabs'
import SwipeActionSelector from './SwipeActionSelector.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const options = [
  { id: 'none', label: '无操作' },
  { id: 'complete', label: '完成' },
  { id: 'edit', label: '编辑' },
  { id: 'delete', label: '删除' },
]

function updateAction(group, direction, value) {
  emit('update:modelValue', {
    ...props.modelValue,
    [group]: { ...props.modelValue[group], [direction]: value },
  })
}
</script>

<template>
  <TabsContent
    value="swipe"
    class="swipe-editor appearance-panel"
    tabindex="0"
    :aria-busy="busy || undefined"
    :inert="busy"
  >
    <div class="swipe-intro">
      <h4>手机左右滑动</h4>
      <p>滑过约三分之一张卡片才会执行，删除还会再次确认；电脑端原有点击操作不变。</p>
    </div>

    <div class="swipe-category">
      <div class="swipe-category-header">
        <span class="swipe-category-icon" aria-hidden="true">✅</span>
        <div><b>待办</b><span>对单条待办生效</span></div>
      </div>
      <div class="swipe-direction-row">
        <SwipeActionSelector title="向左滑" :model-value="modelValue.tasks.left" :options="options" @update:model-value="updateAction('tasks', 'left', $event)" />
        <SwipeActionSelector title="向右滑" :model-value="modelValue.tasks.right" :options="options" @update:model-value="updateAction('tasks', 'right', $event)" />
      </div>
    </div>

    <div class="swipe-category">
      <div class="swipe-category-header">
        <span class="swipe-category-icon" aria-hidden="true">☑️</span>
        <div><b>清单</b><span>对清单中的单个项目生效</span></div>
      </div>
      <div class="swipe-direction-row">
        <SwipeActionSelector title="向左滑" :model-value="modelValue.lists.left" :options="options" @update:model-value="updateAction('lists', 'left', $event)" />
        <SwipeActionSelector title="向右滑" :model-value="modelValue.lists.right" :options="options" @update:model-value="updateAction('lists', 'right', $event)" />
      </div>
    </div>

    <p class="swipe-privacy-note">默认设置：向左滑完成，向右滑编辑。选择“无操作”可以关闭某个方向。</p>
  </TabsContent>
</template>

<style scoped>
.swipe-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.swipe-intro h4 { margin: 0 0 4px; }
.swipe-intro p {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-12);
}
.swipe-category {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--bg);
}
.swipe-category-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.swipe-category-icon { font-size: var(--fs-20); }
.swipe-category-header b { display: block; }
.swipe-category-header span {
  display: block;
  color: var(--muted);
  font-size: var(--fs-12);
}
.swipe-direction-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.swipe-privacy-note {
  margin: 8px 0 0;
  color: var(--muted);
  text-align: center;
  font-size: var(--fs-11);
}
@media (max-width: 760px) {
  .swipe-direction-row { grid-template-columns: 1fr; }
}
</style>
