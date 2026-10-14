<script setup>
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useCampusFavorites } from '../../composables/campusFavorites.js'
import { reportCampusContent } from '../../services/campusLife.js'
import { accountUser } from '../../composables/accountAuth.js'

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
let generation = 0
watch(() => [accountUser.value?.id, props.targetType, props.targetId], () => {
  generation += 1; reportOpen.value = false; reportReason.value = 'inaccurate'; reportDetail.value = ''; busy.value = false; error.value = ''; notice.value = ''
}, { flush: 'sync' })
onScopeDispose(() => { generation += 1 })
const isSaved = computed(() => favorites.favorites.value.has(`${props.targetType}:${props.targetId}`))

async function toggleFavorite() {
  if (busy.value) return
  const owner = accountUser.value?.id
  const revision = generation
  busy.value = true
  error.value = ''
  notice.value = ''
  try { const result = await favorites.toggle(props.targetType, props.targetId); if (result !== null && revision === generation && owner === accountUser.value?.id) notice.value = isSaved.value ? '已加入收藏。' : '已取消收藏。' }
  catch (cause) { if (revision === generation) error.value = cause?.message || '收藏没有更新。' }
  finally { if (revision === generation) busy.value = false }
}
async function submitReport() {
  if (busy.value) return
  const revision = generation
  busy.value = true
  error.value = ''
  try {
    await reportCampusContent(props.targetType, props.targetId, reportReason.value, reportDetail.value)
    if (revision !== generation) return
    reportOpen.value = false
    reportDetail.value = ''
    notice.value = '已提交给校园内容审核。'
  } catch (cause) { if (revision === generation) error.value = cause?.message || '举报没有提交。' }
  finally { if (revision === generation) busy.value = false }
}
</script>

<template>
  <div class="campus-life-content-actions">
    <button class="btn btn-ghost" type="button" :disabled="busy" @click="toggleFavorite">{{ isSaved ? '已收藏' : '收藏' }}</button>
    <button class="text-button" type="button" :aria-expanded="reportOpen" @click="reportOpen = !reportOpen">举报 / 纠错</button>
    <form v-if="reportOpen" class="campus-life-report" @submit.prevent="submitReport">
      <p class="campus-life-action-note">说明仅对你和审核人员可见。不要填写密码、验证码或完整证件信息。</p>
      <label>原因 <select v-model="reportReason"><option value="inaccurate">信息不准确</option><option value="privacy">隐私风险</option><option value="abuse">辱骂或骚扰</option><option value="prohibited">违规内容</option><option value="other">其他</option></select></label>
      <label>补充说明 <textarea v-model="reportDetail" maxlength="1000" /></label>
      <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '正在提交…' : '提交' }}</button>
    </form>
    <p v-if="notice" class="campus-life-action-note" role="status">{{ notice }} <RouterLink v-if="notice.includes('审核')" to="/campus/reports">查看我的举报</RouterLink></p>
    <p v-if="error" class="campus-life-action-note error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.campus-life-content-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.campus-life-report{display:grid;flex-basis:100%;gap:8px;padding:10px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-life-report label{display:grid;gap:4px;color:var(--muted);font-size:12px}.campus-life-report select,.campus-life-report textarea{padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit}.campus-life-report textarea{min-height:65px;resize:vertical}.campus-life-action-note{flex-basis:100%;margin:0;color:var(--muted);font-size:12px}.campus-life-action-note.error{color:var(--danger)}
</style>
