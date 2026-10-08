<script setup>
import Modal from './Modal.vue'
import AppUpdateSection from './data/AppUpdateSection.vue'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])
</script>

<template>
  <Modal :open="open" title="版本与更新" sheet :sheet-detents="[0.64, 0.92]" @close="emit('close')">
    <div class="version-update-modal">
      <p>自动检查会在启动和联网时运行；你也可以随时手动检查或查看更新记录。</p>
      <AppUpdateSection />
    </div>
  </Modal>
</template>

<style scoped>
.version-update-modal {
  flex-direction:column;
  gap:12px;
  display:flex}
.version-update-modal>p {
  color:var(--ink-soft);
  margin:0;
  font-size:var(--fs-12);
  line-height:1.55}
</style>
