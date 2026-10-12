<script setup>
import { computed, onMounted, ref } from 'vue'
import Modal from './Modal.vue'
import { APP_RELEASE, RELEASE_NOTES, RELEASE_UPDATE_GROUPS } from '../composables/releaseNotes.js'
import { isDesktopApp, loadDesktopReleaseHistory } from '../composables/desktopAppUpdate.js'
import { validateReleaseHistory } from '../composables/updateProtocol.js'
import '../styles/shadcn.css'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const expandedVersions = ref(new Set())
const releases = ref([...RELEASE_UPDATE_GROUPS])
const categories = [
  ['features', '新功能'], ['improvements', '体验优化'], ['fixes', '问题修复'],
  ['security', '安全修复'], ['breaking', '兼容性变化'],
]
const currentRelease = computed(() => releases.value.find((entry) => entry.version === APP_RELEASE) || {
  version: APP_RELEASE, legacyVersion: '', channel: 'stable', title: `版本 ${APP_RELEASE}`,
  summary: RELEASE_NOTES[0] || '', changes: { features: [], improvements: [], fixes: [], security: [], breaking: [] },
  publishedAt: null, isCurrent: true, notes: RELEASE_NOTES,
  releaseUrl: 'https://github.com/huadeng0830-gg/study-life/releases',
})
const previousReleases = computed(() => releases.value.filter((entry) => entry.version !== currentRelease.value.version))

function toggleVersion(version, event) {
  if (event.target?.open) expandedVersions.value.add(version)
  else expandedVersions.value.delete(version)
}
function hasCategorizedChanges(release) {
  return categories.some(([key]) => Array.isArray(release.changes?.[key]) && release.changes[key].length)
}
function formatPublishedAt(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : ''
}
async function loadHistory() {
  try {
    let value
    if (isDesktopApp) value = await loadDesktopReleaseHistory()
    else {
      const response = await fetch(`/release-history.json?update=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) return
      value = await response.json()
    }
    const history = validateReleaseHistory(value, { channel: 'stable' })
    if (history?.length) releases.value = history.map((entry) => ({
      ...entry, legacyVersion: entry.legacyVersion || '', isCurrent: entry.version === APP_RELEASE,
    }))
  } catch {
    // The update history is optional while offline; keep the notes packaged with this build.
  }
}
onMounted(() => { void loadHistory() })
</script>

<template>
  <Modal :open="open" title="更新说明" :title-level="2" medium sheet :sheet-detents="[0.72, 0.94]" @close="emit('close')">
    <div class="release-notes">
      <Card class="release-current" role="region" aria-labelledby="release-current-title">
        <CardHeader class="release-current-header">
          <div class="release-current-heading">
            <Badge as="span" variant="outline" class="release-version">版本 {{ currentRelease.version }}</Badge>
            <span class="release-current-label">当前版本 · 稳定版</span>
          </div>
          <CardTitle id="release-current-title">本次更新</CardTitle>
          <p v-if="currentRelease.summary" class="release-summary">{{ currentRelease.summary }}</p>
          <time v-if="currentRelease.publishedAt" class="release-date">{{ formatPublishedAt(currentRelease.publishedAt) }}</time>
        </CardHeader>
        <CardContent class="release-current-content">
          <template v-if="hasCategorizedChanges(currentRelease)">
            <section v-for="([key, label]) in categories" v-show="currentRelease.changes[key]?.length" :key="key" class="release-change-group">
              <h3>{{ label }}</h3>
              <ul><li v-for="(note, index) in currentRelease.changes[key]" :key="`${key}-${index}`">{{ note }}</li></ul>
            </section>
          </template>
          <ul v-else><li v-for="(note, index) in currentRelease.notes" :key="index">{{ note }}</li></ul>
          <p v-if="currentRelease.releaseUrl" class="release-link-row">
            <a :href="currentRelease.releaseUrl" target="_blank" rel="noopener noreferrer">查看原始发布记录</a>
          </p>
        </CardContent>
      </Card>

      <Card v-if="previousReleases.length" class="release-history" role="region" aria-labelledby="release-history-title">
        <CardHeader class="release-history-header"><CardTitle id="release-history-title" class="previous-title">之前的更新</CardTitle></CardHeader>
        <CardContent class="release-history-content">
          <details v-for="release in previousReleases" :key="release.version" class="previous-group"
                   @toggle="toggleVersion(release.version, $event)">
            <summary>
              <span class="previous-version">{{ release.version }}</span>
              <small>{{ release.summary || `${release.notes.length} 项更新` }}</small>
              <time v-if="release.publishedAt">{{ formatPublishedAt(release.publishedAt) }}</time>
            </summary>
            <div v-if="expandedVersions.has(release.version)" class="previous-content">
              <template v-if="hasCategorizedChanges(release)">
                <section v-for="([key, label]) in categories" v-show="release.changes[key]?.length" :key="key" class="release-change-group">
                  <h3>{{ label }}</h3>
                  <ul><li v-for="(note, index) in release.changes[key]" :key="`${key}-${index}`">{{ note }}</li></ul>
                </section>
              </template>
              <ul v-else><li v-for="(note, index) in release.notes" :key="index">{{ note }}</li></ul>
              <a v-if="release.releaseUrl" :href="release.releaseUrl" target="_blank" rel="noopener noreferrer">查看原始发布记录</a>
            </div>
          </details>
        </CardContent>
      </Card>
      <p v-else class="release-history-empty">当前可用的历史版本说明已全部显示。</p>
      <button type="button" class="btn btn-primary" @click="emit('close')">关闭</button>
    </div>
  </Modal>
</template>

<style scoped>
.release-notes { display:grid; gap:14px; }
.release-current, .release-history { gap:0; padding:0; border-color:var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.release-current-header { display:grid; gap:10px; padding:16px 16px 0; }
.release-current-header :deep([data-slot="card-title"]) { margin:0; color:var(--text); font-size:var(--fs-16); }
.release-current-content { display:grid; gap:12px; padding:12px 16px 16px; }
.release-current-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.release-version { align-self:flex-start; padding:4px 8px; border-color:color-mix(in srgb, var(--primary) 24%, var(--border)); color:var(--primary); font-size:var(--fs-11); font-weight:var(--fw-800); background:var(--primary-soft); font-variant-numeric:tabular-nums; }
.release-current-label,.release-date { color:var(--muted); font-size:var(--fs-11); }
.release-summary { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.release-history-header { padding:14px 16px 0; }
.release-history-header :deep([data-slot="card-title"]) { margin:0; color:var(--ink-soft); font-size:var(--fs-13); }
.release-history-content { display:grid; gap:8px; padding:10px 16px 16px; }
.release-notes ul { display:flex; flex-direction:column; gap:8px; margin:0; padding-left:20px; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.release-change-group { display:grid; gap:6px; }
.release-change-group h3 { margin:0; color:var(--muted); font-size:var(--fs-11); font-weight:var(--fw-750); }
.previous-group { padding:0 10px; border:1px solid var(--border); border-radius:var(--radius-9); background:var(--bg-tint); }
.previous-group summary { display:flex; align-items:center; min-height:44px; gap:8px; padding-block:10px; color:var(--ink-soft); cursor:pointer; }
.previous-group summary small { flex:1; min-width:0; color:var(--muted); font-size:var(--fs-10); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.previous-group summary time { color:var(--muted); font-size:var(--fs-10); white-space:nowrap; }
.previous-group summary:focus-visible { outline:2px solid var(--primary); outline-offset:2px; border-radius:var(--radius-6); }
.previous-version { font-size:var(--fs-12); font-weight:var(--fw-700); overflow-wrap:anywhere; }
.previous-content { display:grid; gap:10px; padding:3px 0 12px; }
.release-link-row { margin:0; }
.release-link-row a,.previous-content > a { color:var(--primary); font-size:var(--fs-11); }
.release-history-empty { margin:0; color:var(--muted); font-size:var(--fs-11); }
.release-notes .btn { justify-self:end; min-width:96px; margin-top:2px; }
@media (max-width:520px) {
  .release-current-header { padding:14px 14px 0; }
  .release-current-content { padding:12px 14px 14px; }
  .release-history-header { padding:14px 14px 0; }
  .release-history-content { padding:10px 14px 14px; }
  .previous-group summary { flex-wrap:wrap; }
  .previous-group summary small { flex-basis:100%; order:3; }
}
</style>
