<script setup>
import Modal from './Modal.vue'
import AppUpdateSection from './data/AppUpdateSection.vue'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])
</script>

<template>
  <Modal :open="open" title="版本与更新" medium sheet :sheet-detents="[0.6, 0.92]" @close="emit('close')">
    <div class="version-update-modal">
      <AppUpdateSection />
    </div>
  </Modal>
</template>

<style scoped>
.version-update-modal {
  flex-direction:column;
  gap:12px;
  display:flex}
</style>
