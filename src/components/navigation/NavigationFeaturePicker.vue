<script setup>
import { computed, ref, useId } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
  pinnedIds: { type: Array, required: true },
  groups: { type: Array, default: () => [] },
  mode: { type: String, required: true },
  targetGroup: { type: String, default: '' },
  full: Boolean,
  disabled: Boolean,
})
const emit = defineEmits(['pin', 'open', 'update:targetGroup'])
const query = ref('')
const filter = ref('all')
const searchId = `nav-search-${useId()}`
const pinned = computed(() => new Set(props.pinnedIds))
const results = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return props.items.filter((item) => (filter.value !== 'unpinned' || !pinned.value.has(item.id))
    && (!needle || `${item.label} ${item.mobileLabel} ${item.groupLabel}`.toLocaleLowerCase().includes(needle)))
})
const sections = computed(() => {
  const groups = new Map()
  for (const item of results.value) {
    if (!groups.has(item.groupId)) groups.set(item.groupId, { id: item.groupId, label: item.groupLabel, items: [] })
    groups.get(item.groupId).items.push(item)
  }
  return [...groups.values()]
})
</script>

<template>
  <section class="navigation-library" aria-label="全部可用功能">
    <div class="library-heading"><h4>全部功能</h4><span>{{ results.length }} 个</span></div>
    <div class="library-search-row">
      <label class="library-search" :for="searchId"><span aria-hidden="true">⌕</span><input :id="searchId" v-model="query" type="search" placeholder="搜索页面或分组" aria-label="搜索可用功能" /></label>
      <select v-model="filter" aria-label="筛选可用功能"><option value="all">全部功能</option><option value="unpinned">{{ mode === 'mobile' ? '未添加' : '未固定' }}</option></select>
    </div>
    <label v-if="mode === 'desktop'" class="library-target"><span>添加到分组</span><select :value="targetGroup" :disabled="disabled" aria-label="添加功能的目标分组" @change="emit('update:targetGroup', $event.target.value)"><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.label.trim() || '未命名分组' }}</option></select></label>
    <p v-if="mode === 'mobile' && full" class="library-hint">自选位置已满，移除一个页面后即可添加。</p>
    <div v-for="section in sections" :key="section.id" class="library-group">
      <h5>{{ section.label }}</h5>
      <div class="nav-feature-grid">
        <div v-for="item in section.items" :key="item.id" class="nav-feature-option" :class="{ pinned: pinned.has(item.id) }">
          <span class="feature-icon" aria-hidden="true">{{ item.icon }}</span>
          <div class="feature-copy"><b>{{ item.label }}</b><small v-if="mode === 'mobile' && item.mobileLabel !== item.label">底栏显示为「{{ item.mobileLabel }}」</small></div>
          <button class="nav-open-link" type="button" :disabled="disabled" :aria-label="`打开${item.label}`" @click="emit('open', item.path)">打开</button>
          <button class="nav-pin-button" type="button" :disabled="disabled || pinned.has(item.id) || full" :aria-label="`${pinned.has(item.id) ? '已添加' : '添加'}${item.label}`" @click="emit('pin', item.id)">{{ pinned.has(item.id) ? '已添加' : mode === 'mobile' ? '添加' : '固定' }}</button>
        </div>
      </div>
    </div>
    <p v-if="!results.length" class="library-empty" role="status">{{ query.trim() ? '没有找到匹配的功能，试试其他关键词。' : '所有功能都已添加。切换到全部功能可以查看并打开页面。' }}</p>
  </section>
</template>

<style scoped>
.navigation-library { display: flex; min-width: 0; flex-direction: column; gap: 12px; padding-top: 18px; border-top: 1px solid var(--border); }
.library-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.library-heading h4 { margin: 0; font-size: var(--fs-14); }
.library-heading > span, .library-target > span { color: var(--muted); font-size: var(--fs-12); }
.library-search-row { display: flex; min-width: 0; gap: 8px; }
.library-search { display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; padding-left: 12px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg); color: var(--muted); }
.library-search input { width: 100%; min-width: 0; min-height: 40px; padding: 8px 10px 8px 0; border: 0; background: transparent; color: var(--text); font-size: var(--fs-13); }
.library-search-row > select, .library-target select { min-width: 0; min-height: 40px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--card); color: var(--text); font-size: var(--fs-12); }
.library-target { display: flex; min-width: 0; align-items: center; gap: 10px; }
.library-target select { max-width: 230px; flex: 1; }
.library-hint, .library-empty { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.6; }
.library-group h5 { margin: 0 0 7px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-600); }
.nav-feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr)); gap: 7px; }
.nav-feature-option { display: flex; min-width: 0; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--card); }
.feature-icon { display: grid; width: 30px; height: 32px; flex: 0 0 30px; place-items: center; border-radius: var(--radius-8); background: var(--bg); font-size: var(--fs-17); }
.feature-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.feature-copy b { overflow: hidden; color: var(--text); font-size: var(--fs-13); text-overflow: ellipsis; white-space: nowrap; }
.feature-copy small { color: var(--muted); font-size: var(--fs-10); line-height: 1.5; }
.nav-open-link, .nav-pin-button { min-height: 36px; flex: 0 0 auto; padding: 6px 9px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); color: var(--primary); font-size: var(--fs-12); white-space: nowrap; }
.nav-pin-button { border-color: transparent; background: var(--primary-soft); font-weight: var(--fw-600); }
.pinned .nav-pin-button { background: var(--bg); color: var(--muted); }
button:disabled { cursor: not-allowed; opacity: .55; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.library-empty { padding: 18px 10px; border-radius: var(--radius-9); background: var(--bg); text-align: center; }
@media (max-width: 360px) {
  .nav-feature-option { gap: 6px; padding-inline: 8px; }
  .nav-open-link, .nav-pin-button { padding-inline: 7px; }
  .feature-icon { width: 26px; flex-basis: 26px; }
}
</style>
