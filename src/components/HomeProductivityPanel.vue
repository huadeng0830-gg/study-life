<script setup>
import { computed, onMounted, ref } from 'vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import StudyPlanner from './learning/StudyPlanner.vue'
import { useStoredRef } from '../composables/store/core.js'

const FIRST_USE_KEY = 'study-life:first-use-guide-dismissed'
const domain = useDomainCommands()
const checklists = useStoredRef('sl_checklists', [])
const guideReady = ref(false)
const guideDismissed = ref(false)

const hasData = computed(() => [
  domain.courses.value,
  domain.tasks.value,
  domain.events.value,
  domain.milestones.value,
  domain.bills.value,
  domain.transactions.value,
  domain.focusSessions.value,
  checklists.value,
].some((items) => Array.isArray(items) && items.length > 0))

const showFirstUseGuide = computed(() => guideReady.value && !guideDismissed.value && !hasData.value)

onMounted(() => {
  try {
    guideDismissed.value = localStorage.getItem(FIRST_USE_KEY) === '1'
  } catch {
    guideDismissed.value = false
  }
  guideReady.value = true
})

function dismissGuide() {
  guideDismissed.value = true
  try {
    localStorage.setItem(FIRST_USE_KEY, '1')
  } catch {
    // The guide remains dismissible for this visit when storage is unavailable.
  }
}

</script>

<template>
  <div class="home-productivity">
    <section v-if="showFirstUseGuide" class="first-use panel" aria-labelledby="first-use-title">
      <div class="productivity-heading">
        <div><span class="eyebrow">GET STARTED</span><h2 id="first-use-title">先搭好你的学习工作台</h2></div>
        <button type="button" class="text-button" @click="dismissGuide">收起引导</button>
      </div>
      <p>从课程表和待办开始，之后再按需要添加日程和生活记录。</p>
      <div class="first-use-actions">
        <RouterLink class="btn btn-primary" to="/schedule">添加课程</RouterLink>
        <RouterLink class="btn" to="/tasks">添加第一条待办</RouterLink>
      </div>
    </section>

    <StudyPlanner compact />
  </div>
</template>

<style scoped>
.home-productivity { display:grid; gap:12px; margin:0 0 14px; }
.first-use { display:grid; gap:10px; padding:16px 18px; }
.productivity-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.productivity-heading h2 { margin:3px 0 0; font-size:var(--fs-16); }
.productivity-heading .eyebrow { color:var(--ink-soft); font-size:var(--fs-10); font-weight:var(--fw-750); letter-spacing:.08em; }
.first-use > p { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.55; }
.first-use-actions { display:flex; flex-wrap:wrap; gap:8px; }
@media (max-width:520px) {
  .first-use { padding:13px; }
}
</style>
