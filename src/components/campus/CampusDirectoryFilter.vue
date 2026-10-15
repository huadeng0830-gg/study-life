<script setup>
import { Search, X } from '@lucide/vue'
import { Button } from '../ui/button'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { Input } from '../ui/input'
import { NativeSelect, NativeSelectOption } from '../ui/native-select'

defineProps({
  query: { type: String, default: '' }, category: { type: String, default: '' },
  options: { type: Array, default: () => [] }, count: { type: Number, default: 0 },
  placeholder: { type: String, default: '搜索标题或内容' }, label: { type: String, default: '搜索当前列表' },
  countText: { type: String, default: '' },
  extraFiltered: { type: Boolean, default: false },
})
const emit = defineEmits(['update:query', 'update:category', 'reset'])
function reset() { emit('update:query', ''); emit('update:category', ''); emit('reset') }
</script>

<template>
  <div class="campus-directory-filter">
    <FieldGroup class="campus-directory-controls flex-row items-center gap-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
      <Field class="campus-directory-query"><FieldLabel class="sr-only"><Search aria-hidden="true" />{{ label }}</FieldLabel><Input :model-value="query" type="search" :aria-label="label" :placeholder="placeholder" @update:model-value="emit('update:query', String($event))" /></Field>
      <Field v-if="options.length" class="campus-directory-category"><FieldLabel class="sr-only">筛选分类</FieldLabel><NativeSelect :model-value="category" class="w-full" aria-label="筛选分类" @update:model-value="emit('update:category', String($event))"><NativeSelectOption value="">全部分类</NativeSelectOption><NativeSelectOption v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</NativeSelectOption></NativeSelect></Field>
    </FieldGroup>
    <div class="campus-life-filter-row"><span class="campus-life-result-count" role="status">{{ countText || `${count} 条结果` }}</span><Button v-if="query || category || extraFiltered" type="button" variant="ghost" size="sm" @click="reset"><X data-icon="inline-start" />清除筛选</Button><slot /></div>
  </div>
</template>
