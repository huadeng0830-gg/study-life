<script setup>
import { computed } from 'vue'
import { remainingTimeStages, stageLabel, taskTimeSummary } from '../../composables/tasks/taskTimePlan'
const props = defineProps({ task: { type: Object, required: true }, nowMs: { type: Number, required: true } })
const emit = defineEmits(['complete', 'open'])
const plan = computed(() => taskTimeSummary(props.task, props.nowMs))
const stage = computed(() => plan.value.next?.stage)
const canComplete = computed(() => stage.value && stage.value.completionRequired !== false && !props.task.done && !['completed', 'cancelled', 'archived'].includes(props.task.status || '') && !props.task.archivedAt)
const lastAction = computed(() => remainingTimeStages(props.task, props.nowMs).length === 1)
</script>

<template>
  <div class="stage-action" @click.stop>
    <span v-if="plan.following && !task.done" class="stage-following">之后：{{ plan.following.label }}</span>
    <div class="stage-buttons"><button v-if="canComplete && stage" type="button" class="link-btn" @click="emit('complete', stage.id)">{{ lastAction ? '完成事项' : `完成「${stageLabel(stage)}」` }}</button><button type="button" class="link-btn stage-view" @click="emit('open')">查看 {{ task.timeStages?.length }} 段安排</button></div>
  </div>
</template>

<style scoped>
.stage-action { display: grid; gap: 4px; margin-top: 7px; font-size: 12px; }
.stage-following { color: var(--ink-faint); font-size: 11px; overflow-wrap: anywhere; }
.stage-buttons { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.stage-buttons button { font-size: 12px; text-align: left; min-height: 30px; }
.stage-view { color: var(--ink-faint); }
</style>
