<script setup>
/**
 * 批量操作条：勾选待办后浮在列表上方。
 *
 * 【为什么是浮条而不是就地展开一排按钮】列表上方本来就有筛选行，再插一行常驻控件会把页面
 * 顶下去、而且大部分时候都用不上。勾选为空时不渲染，用户看不见它。
 *
 * 【危险操作为什么还要确认框】批量删除一次抹掉的可能不止一条，Toast 的撤销只有几秒窗口，
 * 而用户在批量场景下往往不会去盯提示条。所以删除走确认框，批量完成 / 归档走 Toast 撤销——
 * 和单条操作的强度保持一致，不因为「批量」就放松，也不因为「批量」就一律拦。
 */
import { ref } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue'

defineProps({
  count: { type: Number, default: 0 },
  /** 齐行任务不在选择集里，所以「全部完成」这类要按能力而不是按条数给。 */
  canComplete: { type: Boolean, default: true },
  canArchive: { type: Boolean, default: true },
  canReschedule: { type: Boolean, default: true },
})

const emit = defineEmits(['complete', 'archive', 'reschedule', 'remove', 'clear'])

const confirmRemove = ref(false)
</script>

<template>
  <Transition name="bulk-bar">
    <div v-if="count" class="bulk-bar" role="region" aria-label="批量操作">
      <span class="bulk-count" role="status">已选 {{ count }} 项</span>
      <div class="bulk-acts">
        <button v-if="canComplete" type="button" class="btn btn-ghost" @click="emit('complete')">全部完成</button>
        <button v-if="canReschedule" type="button" class="btn btn-ghost" @click="emit('reschedule')">改期</button>
        <button v-if="canArchive" type="button" class="btn btn-ghost" @click="emit('archive')">归档</button>
        <button type="button" class="btn btn-danger" @click="confirmRemove = true">删除</button>
        <button type="button" class="btn btn-ghost" @click="emit('clear')">取消选择</button>
      </div>
    </div>
  </Transition>
  <ConfirmDialog
    :open="confirmRemove"
    :title="`删除 ${count} 项待办`"
    :message="`确定删除选中的 ${count} 项待办吗？删除后可在短时间内撤销。`"
    confirm-label="删除"
    @close="confirmRemove = false"
    @confirm="confirmRemove = false; emit('remove')"
  />
</template>

<style scoped>
.bulk-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 10px 14px;
  background: var(--primary-soft);
  border: 1px solid var(--primary);
  border-radius: var(--radius-12);
}
.bulk-count {
  color: var(--primary);
  font-size: var(--fs-12-5);
  font-weight: var(--fw-750);
  font-variant-numeric: tabular-nums;
}
.bulk-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bulk-acts .btn {
  min-height: 36px;
  padding: 6px 12px;
  font-size: var(--fs-12-5);
}
.bulk-bar-enter-active,
.bulk-bar-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.bulk-bar-enter-from,
.bulk-bar-leave-to {
  opacity: 0;
}
@media (max-width: 900px), (pointer: coarse) and (max-height: 520px) {
  .bulk-bar { position: static; }
  .bulk-acts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
  .bulk-acts .btn { min-height: 44px; white-space: normal; }
}
</style>
