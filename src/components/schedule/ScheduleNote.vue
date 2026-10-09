<script setup>
import { onMounted, ref } from 'vue'
import { useStoredRef } from '../../composables/store/index.js'

const note = useStoredRef('sl_schedule_note', '')
const input = ref(null)
function resize() {
  if (!input.value) return
  input.value.style.height = 'auto'
  input.value.style.height = `${Math.min(Math.max(input.value.scrollHeight, 38), 180)}px`
}
onMounted(resize)
</script>

<template>
  <div class="schedule-note">
    <textarea ref="input" v-model="note" rows="1" aria-label="课程表备注" placeholder="📝 课程表备注..." class="schedule-note-input" @input="resize"></textarea>
  </div>
</template>

<style scoped>
.schedule-note { margin-top: 8px; }
.schedule-note-input {
  border: 1px solid var(--border);
  background: var(--card);
  width: 100%;
  min-height: 38px;
  max-height: 180px;
  color: var(--text);
  resize: vertical;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  transition: border-color var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard);
  border-radius: var(--radius-10);
  padding: 10px 14px;
  font-size: var(--fs-14);
  line-height: 1.55;
  overflow-y: auto;
}
.schedule-note-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.schedule-note-input::placeholder { color: var(--muted); }
</style>
