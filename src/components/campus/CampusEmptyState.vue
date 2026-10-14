<script setup>
import { Compass } from '@lucide/vue'
import { Button } from '../ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

defineProps({ title: { type: String, required: true }, description: { type: String, default: '' }, action: { type: String, default: '' }, to: { type: String, default: '' } })
</script>

<template>
  <Empty class="campus-empty-state">
    <EmptyHeader><EmptyMedia variant="icon"><Compass aria-hidden="true" /></EmptyMedia><EmptyTitle>{{ title }}</EmptyTitle><EmptyDescription v-if="description">{{ description }}</EmptyDescription></EmptyHeader>
    <EmptyContent v-if="action && to"><Button as-child variant="outline"><RouterLink :to="to">{{ action }}</RouterLink></Button></EmptyContent>
    <slot />
  </Empty>
</template>
