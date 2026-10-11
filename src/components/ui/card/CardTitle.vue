<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  as?: "h2" | "h3" | "h4"
}>()
</script>

<template>
  <component
    :is="props.as || 'h3'"
    data-slot="card-title"
    :class="cn('ui-card-title font-semibold', props.class)"
  >
    <slot />
  </component>
</template>
