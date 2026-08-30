<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ notes: { type: Array, default: () => [] } })
defineEmits(['convert', 'archive'])
const expanded = ref(false)
const selectedTag = ref('')
const tags = computed(() => [...new Set(props.notes.flatMap((note) => Array.isArray(note.tags) ? note.tags : []).filter(Boolean))].slice(0, 12))
const filteredNotes = computed(() => selectedTag.value ? props.notes.filter((note) => note.tags?.includes(selectedTag.value)) : props.notes)
const visibleNotes = computed(() => expanded.value ? filteredNotes.value : filteredNotes.value.slice(0, 3))
</script>

<template>
  <section v-if="notes.length" class="inbox panel secondary-panel" aria-label="学习生活收件箱">
    <div class="panel-head"><h2>收件箱</h2><span class="panel-progress">快速记下，稍后整理</span></div>
    <div v-if="tags.length" class="inbox-tags"><button type="button" :class="{ on: !selectedTag }" @click="selectedTag = ''">全部</button><button v-for="tag in tags" :key="tag" type="button" :class="{ on: selectedTag === tag }" @click="selectedTag = tag">#{{ tag }}</button></div>
    <div v-for="note in visibleNotes" :key="note.id" class="inbox-row"><div><b>{{ note.title }}</b><span>{{ note.content }}</span><small v-if="note.tags?.length">{{ note.tags.map(tag => `#${tag}`).join(' ') }}</small></div><div class="inbox-actions"><button type="button" @click="$emit('convert', note, 'todo')">转待办</button><button type="button" @click="$emit('convert', note, 'event')">转日程</button><button type="button" class="quiet" @click="$emit('archive', note)">归档</button></div></div>
    <p v-if="!visibleNotes.length" class="inbox-empty">这个标签下暂时没有记录。</p>
    <button v-if="filteredNotes.length > 3" type="button" class="inbox-toggle" @click="expanded = !expanded">{{ expanded ? '收起已整理记录' : `查看其余 ${filteredNotes.length - 3} 条` }}</button>
  </section>
</template>

<style scoped>
.inbox-row { display: flex; align-items: center; gap: 12px; min-height: 51px; border-top: 1px solid var(--border); }
.inbox-row:first-of-type { border-top: 0; }
.inbox-row > div:first-child { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.inbox-row b, .inbox-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inbox-row b { font-size: 13px; }
.inbox-row span { color: var(--ink-soft); font-size: 11.5px; }
.inbox-row small { color: var(--primary); font-size: 10.5px; }
.inbox-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: -2px 0 5px; }
.inbox-tags button { padding: 4px 7px; color: var(--ink-soft); font-size: 10.5px; font-weight: 700; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); }
.inbox-tags button.on { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
.inbox-empty { margin: 10px 0 0; color: var(--ink-soft); font-size: 12px; }
.inbox-actions { display: flex; gap: 4px; }
.inbox-actions button { padding: 4px 6px; color: var(--primary); font-size: 10.5px; font-weight: 750; white-space: nowrap; border: 0; border-radius: 6px; background: var(--primary-soft); }
.inbox-actions button.quiet { color: var(--ink-soft); background: var(--bg-tint); }
.inbox-toggle { align-self: flex-start; margin-top: 8px; padding: 5px 7px; color: var(--primary); font-size: 11px; font-weight: 750; border: 0; border-radius: 6px; background: var(--primary-soft); }
@media (max-width: 520px) { .inbox-row { align-items: flex-start; flex-direction: column; padding: 9px 0; } .inbox-actions { width: 100%; } .inbox-actions button { flex: 1; } }
</style>
