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
const canPlan = computed(() => [domain.courses.value, domain.tasks.value, domain.milestones.value, domain.events.value].some(items => items.length > 0))

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
        <div><h2 id="first-use-title">从一件事开始</h2></div>
        <button type="button" class="text-button" @click="dismissGuide">收起引导</button>
      </div>
      <p>导入课表，或记下一条待办。今天的安排会自动汇集在这里。</p>
      <div class="first-use-actions">
        <RouterLink class="btn btn-outline" to="/schedule">导入课程表</RouterLink>
        <RouterLink class="btn btn-ghost" to="/tasks?new=1">记一条待办</RouterLink>
      </div>
    </section>

    <details v-if="canPlan" class="planner-disclosure">
      <summary><span>安排学习时段</span><small>根据课表空档查看建议</small></summary>
      <StudyPlanner compact />
    </details>
  </div>
</template>

<style scoped>
.home-productivity { display:grid; gap:var(--space-3); }
.home-productivity:empty { display:none; }
.first-use { display:grid; gap:var(--space-2); padding:var(--space-4) var(--space-5); border-left:2px solid var(--primary); background:var(--card); border-radius:var(--radius-control); }
.productivity-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.productivity-heading h2 { margin:3px 0 0; font-size:var(--fs-16); }
.planner-disclosure { border-top:1px solid var(--border); padding-top:var(--space-2); }
.planner-disclosure > summary { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-2); min-height:var(--tap-min); cursor:pointer; color:var(--primary); font-size:var(--type-callout); font-weight:var(--fw-600); }
.planner-disclosure > summary::after { content:'＋'; margin-left:auto; }
.planner-disclosure[open] > summary::after { content:'−'; }
.planner-disclosure > summary small { color:var(--muted); font-size:var(--type-footnote); font-weight:var(--fw-400); }
.first-use > p { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.55; }
.first-use-actions { display:flex; flex-wrap:wrap; gap:8px; }
@media (max-width:520px) {
  .first-use { padding:var(--space-4); }
}
</style>
