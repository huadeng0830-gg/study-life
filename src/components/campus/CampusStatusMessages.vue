<script setup>
/**
 * The campus success/failure banner.
 *
 * Campus pages previously each wrote their own one-line `<p>` for the result of
 * an action, and two of them carried a scoped copy of the feedback styling.
 * That produced three competing CSS conventions for the same message.
 *
 * Read errors are **not** this component's job — they render through
 * CampusStateBlock, which replaces the list so an error can never appear above
 * content it contradicts. `error` is accepted for the few surfaces that report
 * a failure without owning a list.
 */
defineProps({
  notice: { type: String, default: '' },
  error: { type: String, default: '' },
})
</script>

<template>
  <p v-if="error" class="campus-life-inline-state error" role="alert"><slot name="error">{{ error }}</slot></p>
  <p v-else-if="notice" class="campus-life-inline-state campus-life-success" role="status">{{ notice }}<slot name="notice" /></p>
</template>