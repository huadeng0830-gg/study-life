<script setup>
/**
 * 通用确认框：应用内替代原生 confirm 的唯一入口。
 *
 * 【调用方请写成 `v-if="target" :open="Boolean(target)"`】
 * ConfirmDialog 自己 Teleport 到 body，而 body 里所有 `.overlay` 的 z-index 都是 100
 * （见 Modal.vue 的样式），所以**谁盖在谁上面完全由 body 里的 DOM 顺序决定**。
 * Teleport 的锚点在组件挂载时创建：若确认框在页面挂载时就把锚点建好，之后才打开的
 * Modal（表单、课程管理器、作息设置……它们的浮层是 `v-if` 的，锚点更晚）会排到它后面，
 * 于是**确认框被下面那层盖住**——读屏与 Escape 都认为它在最上层，眼睛看到的却是别的窗体。
 * 加 `v-if` 让锚点在"打开这一刻"才创建，就永远排在已打开的浮层之后。
 * 永不与其它浮层同时出现的位置（例如页面卡片上的删除键）可以只用 `:open`，
 * 但统一带上 `v-if` 更省心，也是 DataManager 里那几个嵌套确认框的既有写法。
 *
 * 【组件不重置状态】关闭/确认只 emit，清 `target` 是调用方的责任（仓库既有惯例）。
 */
import { computed } from 'vue'
import Modal from './Modal.vue'
const props = defineProps({
  open: Boolean,
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  // 取消键文案。默认「取消」与改造前完全一致；「继续保存 / 取消」这类
  // 语义下调用方会换成更贴合的说法，让两个按键读起来是一对选择而不是
  // 「确认 / 取消」那种一边倒的措辞。
  cancelLabel: { type: String, default: '取消' },
  // 确认键语气，默认 danger。删除、覆盖这类破坏性操作必须是红色危险键；
  // 但「检测到时间冲突，是否继续保存」不是破坏性操作——用危险键等于在暗示
  // 用户"这是在删东西"，会劝退本该继续的保存。这类调用方传 primary，
  // 复用既有的 btn-primary / btn-danger，不新增 CSS 类。
  tone: { type: String, default: 'danger' },
})
// 宽屏上默认的 420px 弹窗会把长确认文案压成很多行。文案偏长时自动升到 medium 档，
// 短文案（“确定删除吗？”）保持原来的紧凑宽度，不改变既有观感。
const useMediumWidth = computed(() => String(props.message ?? '').length > 56)
const confirmClass = computed(() => (props.tone === 'primary' ? 'btn btn-primary' : 'btn btn-danger'))
defineEmits(['confirm', 'close'])
</script>
<template>
  <Modal :open="open" :title="title" :medium="useMediumWidth" @close="$emit('close')">
    <p class="message">{{ message }}</p>
    <template #foot>
      <div class="actions">
        <button class="btn btn-ghost" @click="$emit('close')">{{ cancelLabel }}</button>
        <button :class="confirmClass" @click="$emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </template>
  </Modal>
</template>
<style scoped>.message{margin:0;color:var(--ink-soft);line-height:1.6;max-width:62ch}.actions{display:flex;justify-content:flex-end;gap:9px}</style>
