<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <header class="page-head product-page-header">
    <div class="page-head-main">
      <slot name="breadcrumb" />
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="description" class="page-desc">{{ description }}</p>
      <slot />
    </div>
    <div v-if="$slots.actions" class="page-actions cluster"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.product-page-header { align-items: flex-start; flex-wrap: wrap; gap: var(--space-4) var(--space-6); }
.page-head-main { flex: 1 1 240px; }
.page-actions { max-width: 100%; align-self: center; }
@media (max-width: 520px) {
  .page-head-main { flex-basis: 100%; }
  .page-actions { gap: var(--space-2); flex-wrap: wrap; }
}
</style>
