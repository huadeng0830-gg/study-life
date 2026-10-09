<script setup>
import { computed } from 'vue'
import { formatDateTime } from '../../composables/intlFormatters.js'
import { safeTaskResourceLinks } from '../../composables/tasks/taskWorkProgress.js'

const props = defineProps({ task: { type: Object, required: true } })
const resourceLinks = computed(() => safeTaskResourceLinks(props.task.workCheckpoint?.resources))
</script>

<template>
  <div v-if="task.workCheckpoint" class="project-task-work-progress">
    <p v-if="task.workCheckpoint.nextStep"><b>下一步</b>{{ task.workCheckpoint.nextStep }}</p>
    <p v-else-if="task.workCheckpoint.lastStep"><b>上次做到</b>{{ task.workCheckpoint.lastStep }}</p>
    <p v-if="task.workCheckpoint.blocker"><b>卡点</b>{{ task.workCheckpoint.blocker }}</p>
    <div v-if="resourceLinks.length" class="project-task-work-resources"><b>关联资料</b><a v-for="url in resourceLinks" :key="url" :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a></div>
    <small v-if="task.workCheckpointUpdatedAt">最近保存 {{ formatDateTime(task.workCheckpointUpdatedAt) }}<template v-if="task.workCheckpointActorName"> · {{ task.workCheckpointActorName }}</template></small>
  </div>
</template>
