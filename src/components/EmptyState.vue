<script setup>
defineProps({
  icon: { type: String, default: '✦' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  hint: { type: String, default: '' },
  primaryLabel: { type: String, default: '' },
  secondaryLabel: { type: String, default: '' },
})

const emit = defineEmits(['primary', 'secondary'])
</script>

<template>
  <div class="empty-state">
    <span class="es-icon" aria-hidden="true">{{ icon }}</span>
    <div class="es-copy">
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
      <small v-if="hint">{{ hint }}</small>
    </div>
    <div v-if="primaryLabel || secondaryLabel || $slots.default" class="es-actions">
      <button v-if="secondaryLabel" class="btn btn-ghost" @click="emit('secondary')">{{ secondaryLabel }}</button>
      <button v-if="primaryLabel" class="btn btn-primary" @click="emit('primary')">{{ primaryLabel }}</button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 26px 20px;
  text-align: center;
}
.es-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--primary);
  font-size: 21px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--bg-tint);
}
.es-copy {
  max-width: 420px;
}
.es-copy h3 {
  font-size: 14.5px;
  font-weight: 700;
}
.es-copy p {
  margin-top: 3px;
  color: var(--ink-soft);
  font-size: 12.5px;
  line-height: 1.55;
}
.es-copy small {
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: 11px;
}
.es-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
