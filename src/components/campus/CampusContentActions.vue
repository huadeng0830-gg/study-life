<script setup>
import { computed, ref, watch } from 'vue'
import CampusStatusMessages from './CampusStatusMessages.vue'
import { accountUser } from '../../composables/accountAuth.js'
import { campusErrorMessage, campusReportReasons } from '../../composables/campusContentModel.js'
import { useCampusFavorites } from '../../composables/campusFavorites.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import { reportCampusContent } from '../../services/campusLife.js'

const props = defineProps({
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
})
const favorites = useCampusFavorites()
const request = useCampusRequest()
const reportOpen = ref(false)
const reportReason = ref('inaccurate')
const reportDetail = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
// 举报提交之后要把「查看我的举报」放在提示旁边。之前是靠
// `notice.includes('审核')` 判断要不要显示这个链接 —— 改一次文案，
// 链接就会莫名其妙消失，没人发现。
const reported = ref(false)

watch(() => [accountUser.value?.id, props.targetType, props.targetId], () => {
  request.invalidate()
  reportOpen.value = false
  reportReason.value = 'inaccurate'
  reportDetail.value = ''
  busy.value = false
  error.value = ''
  notice.value = ''
  reported.value = false
}, { flush: 'sync' })

const isSaved = computed(() => favorites.favorites.value.has(`${props.targetType}:${props.targetId}`))
// 举报原因只有这一份。这张 <select> 曾经把同样的五个值硬编码了一遍，
// 服务端新增一个原因类型时它会静默少一项。
const reportReasons = computed(() => Object.entries(campusReportReasons).map(([value, label]) => ({ value, label })))

async function toggleFavorite() {
  if (busy.value) return
  const revision = request.begin()
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await favorites.toggle(props.targetType, props.targetId)
    if (request.live(revision)) notice.value = isSaved.value ? '已加入收藏。' : '已取消收藏。'
  } catch (cause) {
    if (request.live(revision)) error.value = campusErrorMessage(cause, '收藏没有更新。')
  } finally {
    if (request.live(revision)) busy.value = false
  }
}

async function submitReport() {
  if (busy.value) return
  const revision = request.begin()
  busy.value = true
  error.value = ''
  notice.value = ''
  reported.value = false
  try {
    await reportCampusContent(props.targetType, props.targetId, reportReason.value, reportDetail.value)
    if (!request.live(revision)) return
    reportOpen.value = false
    reportDetail.value = ''
    notice.value = '已提交给校园内容审核。'
    reported.value = true
  } catch (cause) {
    if (request.live(revision)) error.value = campusErrorMessage(cause, '举报没有提交。')
  } finally {
    if (request.live(revision)) busy.value = false
  }
}
</script>

<template>
  <div class="campus-life-content-actions">
    <button class="btn btn-ghost" type="button" :disabled="busy" @click="toggleFavorite">{{ isSaved ? '已收藏' : '收藏' }}</button>
    <button class="text-button" type="button" :aria-expanded="reportOpen" @click="reportOpen = !reportOpen">举报 / 纠错</button>
    <form v-if="reportOpen" class="campus-life-report" @submit.prevent="submitReport">
      <p class="campus-life-action-note">说明仅对你和审核人员可见。不要填写密码、验证码或完整证件信息。</p>
      <label>原因 <select v-model="reportReason"><option v-for="option in reportReasons" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <label>补充说明 <textarea v-model="reportDetail" maxlength="1000" /></label>
      <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '正在提交…' : '提交' }}</button>
    </form>
    <CampusStatusMessages :notice="notice" :error="error">
      <template #notice><RouterLink v-if="reported" to="/campus/reports">查看我的举报</RouterLink></template>
    </CampusStatusMessages>
  </div>
</template>

<style scoped>
.campus-life-content-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
/* 提示独占一行：父级是 flex 容器，不换行的话会和按钮挤在同一排。 */
.campus-life-content-actions>p{flex-basis:100%}
.campus-life-report{display:grid;flex-basis:100%;gap:8px;padding:10px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-life-report label{display:grid;gap:4px;color:var(--muted);font-size:12px}.campus-life-report select,.campus-life-report textarea{padding:8px 9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit}.campus-life-report textarea{min-height:65px;resize:vertical}
</style>