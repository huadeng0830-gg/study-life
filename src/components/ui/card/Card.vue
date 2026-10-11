<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'ui-card bg-card text-card-foreground flex flex-col',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
