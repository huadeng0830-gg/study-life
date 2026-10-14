<script setup>
import { computed, ref } from 'vue'
import { useCampusFavorites } from '../../composables/campusFavorites.js'
import { reportCampusContent } from '../../services/campusLife.js'

const props = defineProps({
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
})
const favorites = useCampusFavorites()
const reportOpen = ref(false)
const reportReason = ref('inaccurate')
const reportDetail = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const isSaved = computed(() => favorites.favorites.value.has(`${props.targetType}:${props.targetId}`))

async function toggleFavorite() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await favorites.toggle(props.targetType, props.targetId); notice.value = isSaved.value ? '已加入收藏。' : '已取消收藏。' }
  catch (cause) { error.value = cause?.message || '收藏没有更新。' }
  finally { busy.value = false }
}
async function submitReport() {
  busy.value = true
  error.value = ''
  try {
    await reportCampusContent(props.targetType, props.targetId, reportReason.value, reportDetail.value)
    reportOpen.value = false
    reportDetail.value = ''
    notice.value = '已提交给校园内容审核。'
  } catch (cause) { error.value = cause?.message || '举报没有提交。' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="campus-life-content-actions">
    <button class="btn btn-ghost" type="button" :disabled="busy" @click="toggleFavorite">{{ isSaved ? '已收藏' : '收藏' }}</button>
    <button class="text-button" type="button" :aria-expanded="reportOpen" @click="reportOpen = !reportOpen">举报 / 纠错</button>
    <form v-if="reportOpen" class="campus-life-report" @submit.prevent="submitReport">
      <label>原因 <select v-model="reportReason"><option value="inaccurate">信息不准确</option><option value="privacy">隐私风险</option><option value="abuse">辱骂或骚扰</option><option value="prohibited">违规内容</option><option value="other">其他</option></select></label>
      <label>补充说明 <textarea v-model="reportDetail" maxlength="1000" /></label>
      <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '正在提交…' : '提交' }}</button>
    </form>
    <p v-if="notice" class="campus-life-action-note" role="status">{{ notice }}</p>
    <p v-if="error" class="campus-life-action-note error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.campus-life-content-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.campus-life-report{display:grid;flex-basis:100%;gap:8px;padding:10px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-life-report label{display:grid;gap:4px;color:var(--muted);font-size:12px}.campus-life-report select,.campus-life-report textarea{padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit}.campus-life-report textarea{min-height:65px;resize:vertical}.campus-life-action-note{flex-basis:100%;margin:0;color:var(--muted);font-size:12px}.campus-life-action-note.error{color:var(--danger)}
</style>
