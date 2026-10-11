<script setup>
/**
 * 一条待办右侧的操作区：**一个主动作 + 一个「⋯」菜单**。
 *
 * 【为什么要收进菜单】这一行原来平铺着「专注 / 开始 / 改期 / 归档 / 编辑 / 删除」最多六个
 * 按钮，全部只有 `title` 提示、全部靠 ✎ ▱ 🗑 ↶ 这类字形辨认。窄屏换行后它们挤在右下角，
 * 互相贴到几乎点不准；而且字形在不同系统字体下粗细不一，「危险」和「次要」看起来一样重。
 * 收进菜单之后，行上只剩「开始 / 继续」这一个真正高频的动作和「⋯」，
 * 次要项在菜单里可以带 `hint` 说明、可以标 `danger`。
 *
 * 【为什么不自己实现弹层】直接复用 `ActionSheet`：它已经和 Modal 共用浮层栈、滚动锁、
 * Escape 与焦点陷阱，也过了对比度和键盘可达性审计（见 `overlayStack.js`）。
 *
 * 【类名前缀】内部类一律带 `tra-` 前缀，免得和宿主页面的 `.check` / `.due` / `.link-btn`
 * 撞名——撞名会让 `tests/scopedChildReachability.test.js` 判成「父组件在引用子组件的
 * 内部类」而报一条并不存在的死规则。
 */
import { ref } from 'vue'
import ActionSheet from '../ActionSheet.vue'

defineProps({
  /** 主动作；没有就不渲染按钮，只留菜单。 */
  primary: { type: Object, default: null },
  /** 菜单项：`[{ key, label, hint?, tone?, disabled? }]`（`ActionSheet` 的形状）。 */
  actions: { type: Array, default: () => [] },
  /** 无障碍名称里的对象名，例如「待办『交高数作业』」。 */
  subject: { type: String, default: '' },
})

const emit = defineEmits(['primary', 'select'])

const open = ref(false)

function choose(action) {
  if (action?.disabled) return
  open.value = false
  emit('select', action.key)
}
</script>

<template>
  <div class="tra">
    <button
      v-if="primary && !primary.disabled"
      type="button"
      class="tra-primary link-btn tap-target"
      :aria-label="`${primary.label}：${subject}`"
      @click.stop="emit('primary')"
    >{{ primary.label }}</button>
    <button
      v-if="actions.length"
      type="button"
      class="tra-trigger tap-target"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="`更多操作：${subject || '待办'}`"
      title="更多操作"
      @click.stop="open = true"
    >⋯</button>
    <ActionSheet :open="open" :title="subject ? `更多操作：${subject}` : '更多操作'" :actions="actions" @select="choose" @close="open = false" />
  </div>
</template>

<style scoped>
.tra {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}
.tra-primary {
  padding: 6px 10px;
  min-height: 34px;
  color: var(--primary);
  font-weight: var(--fw-700);
  white-space: nowrap;
  background: var(--primary-soft);
  border: 1px solid var(--primary-soft);
  border-radius: var(--radius-8);
}
.tra-primary:hover {
  border-color: var(--primary);
}
/* 触发器是次要操作，不该和主动作抢视觉重量；但命中区仍按 tap-target 撑到 44px。 */
.tra-trigger {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--ink-soft);
  font-size: var(--fs-16);
  line-height: 1;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-8);
}
.tra-trigger:hover {
  color: var(--primary);
  border-color: var(--border);
  background: var(--bg-tint);
}
</style>
