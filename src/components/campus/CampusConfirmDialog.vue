<script setup>
import ConfirmDialog from '../ConfirmDialog.vue'

/**
 * Renders the one confirmation a campus view currently has pending.
 *
 * See `useCampusConfirm` for why these exist. The `v-if="request"` follows the
 * repo convention documented on ConfirmDialog: the Teleport anchor must be
 * created at the moment the dialog opens, so that a dialog opened *after* a
 * Modal still stacks above it.
 */
defineProps({ request: { type: Object, default: null } })
defineEmits(['confirm', 'close'])
</script>

<template>
  <ConfirmDialog
    v-if="request"
    :open="true"
    :title="request.title"
    :message="request.message"
    :confirm-label="request.confirmLabel"
    :cancel-label="request.cancelLabel"
    :tone="request.tone"
    @close="$emit('close')"
    @confirm="$emit('confirm')"
  />
</template>