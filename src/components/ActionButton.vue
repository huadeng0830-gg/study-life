<script setup>
import { computed, nextTick, onDeactivated, ref, useAttrs, useId, watch } from 'vue'
import ActionFeedback from './ActionFeedback.vue'
import { useActionFeedback } from '../composables/actionFeedback.js'
import { announce, announceAlert } from '../composables/liveRegion.js'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  action: Function,
  kind: { type: String, default: 'frequent', validator: (value) => ['important', 'frequent', 'instant', 'danger', 'task'].includes(String(value)) },
  tone: { type: String, default: 'primary' },
  feedback: { type: String, default: 'local' }, // external: caller owns results (dialogs, tasks, undo toasts).
  busy: Boolean,
  disabled: Boolean,
  showError: { type: Boolean, default: true },
  successLabel: { type: String, default: '已完成' },
  loadingLabel: { type: String, default: '正在处理…' },
})
const emit = defineEmits(['click', 'done', 'failed'])
const attrs = useAttrs()
const button = ref(/** @type {HTMLButtonElement | null} */ (null))
const dimensions = ref(/** @type {{width: number, height: number} | null} */ (null))
const name = ref('')
const buttonType = computed(() => attrs.type === 'submit' ? 'submit' : attrs.type === 'reset' ? 'reset' : 'button')
const ariaLabel = computed(() => typeof attrs['aria-label'] === 'string' ? attrs['aria-label'] : undefined)
let activation = 0
const statusId = `action-status-${useId()}`
const { phase, pending, locked, error, failure, result, morph, run, cancel } = useActionFeedback({ kind: () => props.kind, feedback: () => props.feedback === 'local' })
const busy = computed(() => props.busy || pending.value)
const showSymbol = computed(() => props.kind !== 'instant' && (morph.value
  ? ['loading', 'success', 'error'].includes(phase.value)
  : busy.value || ['loading', 'success', 'error'].includes(phase.value)))
const morphing = computed(() => morph.value && ['collapsing', 'loading', 'success', 'error', 'restoring'].includes(phase.value))
const statusText = computed(() => busy.value ? props.loadingLabel : result.value === 'error' ? error.value
  : phase.value === 'success' ? props.successLabel : result.value === 'cancelled' ? '操作已取消' : '')
const lockedStyle = computed(() => dimensions.value && (busy.value || phase.value !== 'idle') ? {
  '--action-size': `${dimensions.value.height}px`,
  width: `${dimensions.value.width}px`,
  height: `${dimensions.value.height}px`,
} : undefined)

function measure() {
  const element = button.value
  const bounds = element?.getBoundingClientRect()
  if (element && bounds) dimensions.value = { width: element.offsetWidth || bounds.width, height: element.offsetHeight || bounds.height }
  name.value = ariaLabel.value || element?.querySelector('.action-label')?.textContent?.trim() || '操作'
}
watch(() => props.busy, (value) => { if (value) measure() })
// Reuse the shell's permanent live regions. A button inside a hidden settings
// tab must not create a hidden live region or announce background updates.
watch(statusText, (message) => {
  if (!message || !button.value?.getClientRects().length) return
  if (result.value === 'error') { if (props.showError) announceAlert(message) }
  else if (props.feedback === 'local') announce(message)
})
async function activate(event) {
  if (props.disabled || props.busy || locked.value) { event?.preventDefault(); return }
  if (!props.action) { emit('click', event); return }
  event?.preventDefault() // An action prop also works on a submit button without a second form submit.
  measure()
  const id = ++activation
  const value = await run(props.action, event)
  if (id !== activation) return
  if (result.value === 'error') {
    emit('failed', error.value)
    // External handlers retain their own expected error channel; uncaught
    // failures must still reach the application's existing error handler.
    if (props.feedback !== 'local' && !props.showError) throw failure.value
  }
  else if (result.value === 'success') emit('done', value)
}
async function retry(event) {
  cancel()
  await nextTick()
  button.value?.focus()
  await activate(event)
}
onDeactivated(cancel)
defineExpose({ activate, cancel, phase, pending, error })
</script>

<template>
  <button
    ref="button"
    v-bind="attrs"
    :type="buttonType"
    class="btn action-button"
    :class="[`btn-${tone}`, `action-${kind}`, { 'action-morph': morphing, 'action-external': feedback !== 'local' }]"
    :style="[attrs.style, lockedStyle]"
    :data-action-phase="phase"
    :aria-busy="kind === 'instant' ? undefined : busy || undefined"
    :aria-label="(busy || phase !== 'idle') && name ? name : ariaLabel"
    :aria-describedby="[attrs['aria-describedby'], feedback === 'local' ? statusId : ''].filter(Boolean).join(' ') || undefined"
    :aria-disabled="disabled || busy || locked || undefined"
    :disabled="disabled && !busy && !locked"
    @click="activate"
  >
    <span class="action-surface" aria-hidden="true"></span>
    <span class="action-label" :class="{ 'action-label-hidden': morphing || (morph && phase === 'pressed') || (feedback === 'local' && ['success', 'error'].includes(phase)) }"><slot /></span>
    <span v-if="showSymbol" class="action-symbol" aria-hidden="true">
      <svg v-if="feedback === 'local' && phase === 'success'" viewBox="0 0 24 24" class="action-check"><path d="M5 12.5 10 17.5 19 7" pathLength="1" /></svg>
      <svg v-else-if="feedback === 'local' && phase === 'error'" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>
      <span v-else-if="phase !== 'collapsing'" class="action-spinner"></span>
      <span v-if="!morph && feedback === 'local' && phase === 'success'" class="action-success-label">{{ successLabel }}</span>
    </span>
    <span v-if="feedback === 'local'" :id="statusId" class="sr-only">{{ statusText }}</span>
  </button>
  <ActionFeedback v-if="error && showError" :message="error" tone="error" :announce="false" :retryable="true" :busy="pending" @retry="retry" />
</template>

<style scoped>
.action-button{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%;vertical-align:middle;background:transparent;box-shadow:none;min-height:42px}
.action-button:hover{transform:none;background:transparent}
.action-button:active:not(:disabled):not([aria-disabled='true']),.action-button[data-action-phase='pressed']{transform:scale(.98)}
.action-button[aria-busy='true'],.action-button[aria-disabled='true']:not(:disabled){opacity:1;filter:none;pointer-events:auto;cursor:progress}
.action-button[aria-busy='true']::after{display:none}
.action-surface{position:absolute;z-index:0;inset-block:0;left:50%;width:100%;transform:translateX(-50%);border-radius:inherit;background:var(--primary);transition:width var(--action-collapse) var(--action-ease),border-radius var(--action-collapse) var(--action-ease),background var(--dur-fast) var(--action-ease)}
.btn-primary:hover:not([aria-disabled='true']) .action-surface{background:var(--primary-hover)}
.btn-ghost .action-surface{background:var(--primary-soft)}
.btn-neutral .action-surface{background:var(--bg-tint)}
.btn-neutral{color:var(--text)}
.btn-danger .action-surface{background:color-mix(in srgb,var(--danger) 14%,var(--card))}
.action-label{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:opacity var(--action-fade) var(--action-ease)}
.action-label-hidden{opacity:0}
.action-morph:not([data-action-phase='restoring']) .action-surface{width:var(--action-size,42px);border-radius:var(--radius-pill)}
.action-symbol{position:absolute;z-index:1;inset:0;display:flex;align-items:center;justify-content:center;gap:5px;pointer-events:none}
.action-symbol svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.action-morph:not([data-action-phase='restoring']) .action-symbol{color:var(--on-primary,#fff)}
.action-morph[data-action-phase='success'] .action-surface{background:var(--action-success)}
.action-morph[data-action-phase='error'] .action-surface{background:var(--danger)}
.action-morph[data-action-phase='success'] .action-symbol,.action-morph[data-action-phase='error'] .action-symbol{color:#fff}
.action-check path{stroke-dasharray:1;stroke-dashoffset:1;animation:action-check var(--action-collapse) var(--action-ease) forwards}
.action-spinner{width:18px;height:18px;border:2px solid currentColor;border-top-color:transparent;border-radius:var(--radius-circle);animation:btn-spin 720ms linear infinite}
.action-button:not(.action-morph)[aria-busy='true'] .action-symbol{inset-inline-start:auto;inset-inline-end:3px;width:14px}
.action-button:not(.action-morph)[aria-busy='true'] .action-spinner{width:12px;height:12px}
.action-button:not(.action-morph)[data-action-phase='success'] .action-surface{background:color-mix(in srgb,var(--success) 10%,var(--card))}
.action-button:not(.action-morph)[data-action-phase='success'] .action-symbol{color:var(--success)}
.action-button:not(.action-morph)[data-action-phase='error'] .action-symbol{color:var(--danger)}
.action-button:not(.action-morph)[data-action-phase='error'] .action-surface{background:color-mix(in srgb,var(--danger) 10%,var(--card))}
.action-button:not(.action-morph):is([data-action-phase='success'],[data-action-phase='error']) .action-label{visibility:hidden}
.action-button:not(.action-morph):is([data-action-phase='success'],[data-action-phase='error']) .action-surface{transition:none}
.action-success-label{font-size:var(--fs-12);font-weight:var(--fw-600)}
@keyframes action-check{to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.action-morph .action-surface{width:100%!important;border-radius:inherit!important}.action-check path{stroke-dashoffset:0}.action-spinner{border-top-color:currentColor;border-style:dotted}.action-button:active,.action-button[data-action-phase='pressed']{transform:none}}
:global(:root[data-performance='reduced']) .action-check path{stroke-dashoffset:0}
:global(:root[data-performance='reduced']) .action-morph .action-surface{width:100%;border-radius:inherit}
:global(:root[data-performance='reduced']) .action-button[data-action-phase='pressed']{transform:none}
</style>
