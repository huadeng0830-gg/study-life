<script setup>
defineProps({ courses: { type: Array, default: () => [] }, checkins: { type: Array, default: () => [] } })
defineEmits(['checkin'])
const actions = [{ key: 'understood', label: '听懂了' }, { key: 'unclear', label: '有点模糊' }, { key: 'review', label: '需要复习' }, { key: 'absent', label: '缺课' }]
function stateFor(course, list) { return list.find((item) => item.courseId === course.id)?.state || '' }
</script>

<template>
  <section v-if="courses.length" class="course-feedback panel" aria-label="课后反馈">
    <div class="panel-head"><h2>课后反馈</h2><span class="panel-progress">10 秒留个学习信号</span></div>
    <div v-for="course in courses" :key="course.id" class="feedback-row"><b>{{ course.name }}</b><div role="group" :aria-label="`${course.name} 的课后反馈`"><button v-for="action in actions" :key="action.key" type="button" :class="{ on: stateFor(course, checkins) === action.key }" :aria-pressed="stateFor(course, checkins) === action.key" :aria-label="`${course.name}：${action.label}`" @click="$emit('checkin', course, action.key)">{{ action.label }}</button></div></div>
  </section>
</template>

<style scoped>
.feedback-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 43px; border-top: 1px solid var(--border); }
.feedback-row:first-of-type { border-top: 0; }
.feedback-row b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.feedback-row div { display: flex; gap: 4px; overflow-x: auto; }
.feedback-row button { padding: 4px 6px; color: var(--ink-soft); font-size: 10.5px; font-weight: 700; white-space: nowrap; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.feedback-row button.on { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
@media (max-width: 520px) { .feedback-row { align-items: flex-start; flex-direction: column; padding: 8px 0; } .feedback-row div { width: 100%; } }
</style>
