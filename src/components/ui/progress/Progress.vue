<script setup lang="ts">
import type { ProgressRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import {
  ProgressIndicator,
  ProgressRoot,
} from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<ProgressRootProps & { class?: HTMLAttributes['class'] }>(),
  {
    modelValue: 0,
  },
)

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :class="
      cn(
        'bg-muted h-1 rounded-full relative flex w-full items-center overflow-x-hidden',
        props.class,
      )
    "
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="bg-primary size-full flex-1 transition-all motion-reduce:transition-none in-data-[performance=reduced]:transition-none"
      :data-indeterminate="props.modelValue === null ? '' : undefined"
      :style="props.modelValue === null ? undefined : `transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
  </ProgressRoot>
</template>

<style scoped>
[data-indeterminate] { flex:none; width:35%; animation:progress-indeterminate 1.4s ease-in-out infinite; }
@keyframes progress-indeterminate { from { transform:translateX(-100%); } to { transform:translateX(300%); } }
:global(html[data-performance="reduced"] [data-indeterminate]) { animation:none; transform:translateX(90%); }
:global(html[data-performance="reduced"] [data-slot="progress-indicator"]) { transition:none; }
@media (prefers-reduced-motion:reduce) {
  [data-indeterminate] { animation:none; transform:translateX(90%); }
  [data-slot="progress-indicator"] { transition:none; }
}
</style>
