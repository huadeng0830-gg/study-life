<script setup>
/**
 * 通用输入对话框：应用内替代原生 `window.prompt` 的唯一入口。
 *
 * 【为什么需要它】原生 `prompt` 是**浏览器级**对话框：不受主题控制、不参与 `Modal` 的
 * 浮层栈（没有焦点陷阱、没有 Escape 出口、遮罩点不掉）、读屏用户完全脱离文档；
 * 在测试环境（happy-dom）里它根本不存在，调用会直接抛 `TypeError`——于是
 * 「改分类名」这条路径此前**无法被任何用例验证**。`ConfirmDialog` 已经把 confirm 收口，
 * 这里是它的输入版：同样基于 `Modal` 组合，继承浮层栈、滚动锁、Escape、Teleport、
 * `role="dialog" aria-modal` 与标题 id，而不是另写一套遮罩。
 *
 * 【调用方请写成 `v-if="target" :open="Boolean(target)"`】
 * 理由与 `ConfirmDialog` 完全相同：body 里每个 `.overlay` 的 z-index 都是 100，
 * 谁盖在谁上面完全由 DOM 顺序决定，而 Teleport 的锚点在组件挂载时创建。
 * 加 `v-if` 让锚点在"打开这一刻"才建，就永远排在已打开的浮层（分类管理、账单表单……）之后。
 *
 * 【组件不重置状态】关闭/确认只 emit，清 `target` 是调用方的责任（仓库既有惯例）。
 *
 * 【空值口径：空输入 = 无变化】确认时把值 `trim()` 后回传；trim 后是空串就**不发 confirm**，
 * 只发 `close`（对话框照常收起来）。也就是"什么也没改"，由组件自己兜住——调用方即使忘了
 * 判断，也写不进一个空名字。取消与 Escape 同样只走 `close`，一条写入路径都不碰。
 *
 * 【Enter 确认、Escape 取消】Enter 由输入框处理；输入法正在组词时只确认候选词；
 * Escape **不再自己写一遍**：`Modal` 已经在 document 上按浮层栈处理 Escape（只关最上面
 * 一层），这里再接一手会和它抢、并产生两次 close。这也是 `ConfirmDialog` 的既有做法。
 *
 * 【默认按钮文案刻意保持「取消 / 确定」】与原生 prompt 的按钮逐字一致，迁移不顺手改观感。
 */
import { ref, useId, watch } from 'vue'
import Modal from './Modal.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '请输入内容' },
  // 可见标签。有它就用 `<label for>` 与输入框做程序化关联；没有就退回 title 当
  // aria-label —— 两条路都保证控件有可访问名称（tests/formControlNames.test.js 在查）。
  label: { type: String, default: '' },
  initialValue: { type: String, default: '' },
  confirmLabel: { type: String, default: '确定' },
  cancelLabel: { type: String, default: '取消' },
  inputType: { type: String, default: 'text' },
  // 不传就不设长度上限：原生 prompt 本来没有上限，别替调用方猜一个。
  maxlength: { type: [Number, String], default: null },
  // 调用方校验失败时保留对话框并把错误就近关联到输入框。
  error: { type: String, default: '' },
})

const emit = defineEmits(['confirm', 'close', 'input'])

const inputId = `prompt-dialog-input-${useId()}`
const errorId = `${inputId}-error`
const draft = ref('')

/** 每次打开都重新播种初值（`v-if` 挂载的实例本来就是新的，这条兜住"常驻实例"的用法）。 */
function seed() {
  draft.value = String(props.initialValue ?? '')
}
// ⚠ ref 必须先声明、watcher 后注册：immediate watcher 排在 ref 声明之前会撞暂时性死区
// （tests/modalSections.test.js 里 TimeSettingsModal 踩过这个真实的坑，组件连挂载都完不成）。
watch(() => props.open, (open) => { if (open) seed() }, { immediate: true })
// 打开状态下调用方换了目标（换了一条数据要改名）：初值跟着走，别让用户改错对象。
watch(() => props.initialValue, () => { if (props.open) seed() })

/** 确认：trim 后回传；空串按"无变化"处理，只关不发（见文件头「空值口径」）。 */
function submit() {
  const value = draft.value.trim()
  if (!value) {
    emit('close')
    return
  }
  emit('confirm', value)
}

function onEnter(event) {
  if (event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <Modal :open="open" :title="title" @close="$emit('close')">
    <FieldGroup>
      <Field class="prompt-field" :data-invalid="Boolean(error)">
        <FieldLabel v-if="label" class="prompt-label" :for="inputId">{{ label }}</FieldLabel>
        <Input
          :id="inputId"
          class="prompt-input"
          :type="inputType"
          :model-value="draft"
          :maxlength="maxlength ?? undefined"
          :aria-label="label ? undefined : title"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? errorId : undefined"
          autocomplete="off"
          autofocus
          @update:model-value="draft = String($event); emit('input', draft)"
          @keydown.enter="onEnter"
        />
        <FieldError v-if="error" :id="errorId">{{ error }}</FieldError>
      </Field>
    </FieldGroup>
    <template #foot>
      <div class="actions">
        <Button type="button" variant="outline" @click="$emit('close')">{{ cancelLabel }}</Button>
        <Button type="button" @click="submit">{{ confirmLabel }}</Button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
/* Appearance belongs to the primitives; this compatibility hook is layout only. */
.prompt-input {
  width: 100%;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
