<script setup>
defineProps({ conflict: Boolean, latest: { type: Object, default: null }, busy: Boolean })
const emit = defineEmits(['load', 'resolve'])
</script>

<template>
  <section v-if="conflict" class="draft-recovery" aria-label="处理草稿版本冲突">
    <p>其他页面已更新草稿。你的本次修改仍在这里，可以先查看最新内容，再选择如何继续。</p>
    <button v-if="!latest" class="btn btn-secondary" type="button" :disabled="busy" @click="emit('load')">{{ busy ? '读取中…' : '查看最新草稿' }}</button>
    <template v-else>
      <details open>
        <summary>最新已保存草稿 · 第 {{ latest.revision }} 版</summary>
        <p>{{ latest.content.summary || '没有成果说明' }}</p>
        <ul v-if="latest.content.links.length"><li v-for="(link, index) in latest.content.links" :key="index">{{ link.title || link.url }}</li></ul>
        <ul v-if="latest.content.files.length"><li v-for="file in latest.content.files" :key="file.path">{{ file.name }}</li></ul>
      </details>
      <div class="draft-recovery-actions">
        <button class="btn btn-ghost" type="button" :disabled="busy" @click="emit('resolve', false)">使用最新草稿，丢弃本次修改</button>
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('resolve', true)">保留本次修改，继续编辑</button>
      </div>
      <small>保留本次修改后，可以继续对照编辑；下一次保存会更新这份最新草稿。</small>
    </template>
  </section>
</template>

<style scoped>
.draft-recovery { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg-tint); }
.draft-recovery p,.draft-recovery ul { margin: 0; color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-recovery details { display: grid; gap: 8px; }
.draft-recovery details > p { margin-top: 8px; }
.draft-recovery summary { cursor: pointer; font-size: var(--fs-12); font-weight: var(--fw-700); }
.draft-recovery small { color: var(--muted); font-size: var(--fs-11); }
.draft-recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
