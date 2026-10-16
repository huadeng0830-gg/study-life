<script setup>
import AppIcon from './AppIcon.vue'
import { Button } from './ui/button'
defineProps({
  icon: { type: String, default: '✦' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  hint: { type: String, default: '' },
  primaryLabel: { type: String, default: '' },
  secondaryLabel: { type: String, default: '' },
  // 标题层级。空态通常挂在页面 h1 之下，用 h2 才不跳级；
  // 但在弹窗或卡片里作为次级块时 h3 更合适，所以做成可配置。
  level: { type: Number, default: 3 },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['primary', 'secondary'])
</script>

<template>
  <div class="empty-state" :class="{ 'is-compact': compact }">
    <span class="es-icon" aria-hidden="true"><AppIcon :name="icon" /></span>
    <div class="es-copy">
      <h3 v-if="level === 3">{{ title }}</h3>
      <h2 v-else-if="level === 2">{{ title }}</h2>
      <h4 v-else>{{ title }}</h4>
      <p v-if="description">{{ description }}</p>
      <small v-if="hint">{{ hint }}</small>
    </div>
    <div v-if="primaryLabel || secondaryLabel || $slots.default" class="es-actions">
      <Button v-if="secondaryLabel" type="button" variant="outline" @click="emit('secondary')">{{ secondaryLabel }}</Button>
      <Button v-if="primaryLabel" type="button" @click="emit('primary')">{{ primaryLabel }}</Button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-5);
  text-align: center;
}
.es-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--primary);
  font-size: var(--fs-21);
  border: 0;
  border-radius: var(--radius-control);
  background: var(--bg-tint);
}

/* Empty content stays still: only a user's action should draw attention.
   This replaces the old repeating scale/shadow animation. */

@media (prefers-reduced-motion: reduce) {
  .es-icon {
    animation: none;
  }
}

/* 应用内的「流畅优先」开关同样要能停掉它。 */
:global(:root[data-performance='reduced']) .es-icon {
  animation: none;
}
.es-copy {
  max-width: 42ch;
  overflow-wrap: anywhere;
}
.es-copy h2 {
  font-size: var(--type-headline);
  font-weight: var(--fw-700);
}
.es-copy h3,
.es-copy h4 {
  font-size: var(--type-callout);
  font-weight: var(--fw-700);
}
.es-copy p {
  margin-top: var(--space-1);
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  line-height: 1.55;
}
.es-copy small {
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: var(--fs-11);
}
.es-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.empty-state.is-compact { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: start; padding: var(--space-4) 0; text-align: left; }
.is-compact .es-icon { width: 32px; height: 32px; grid-row: 1 / span 2; }
.is-compact .es-actions { grid-column: 2; justify-content: flex-start; }
</style>
