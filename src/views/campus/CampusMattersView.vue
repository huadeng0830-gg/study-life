<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Search } from '@lucide/vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import { useCampusLifeDraft } from '../../composables/campusLifeDraft.js'
import { campusContentLabel, campusContentRoute } from '../../composables/campusContentModel.js'
import { analyzeCampusMatter, matterCategoryLabels, matterIntentLabels, matterOutcomeLabels, matterStatusLabels } from '../../composables/campusMatterModel.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { animationsEnabled } from '../../composables/motion.js'
import { campusLifeSearch } from '../../services/campusLife.js'
import { campusMatterOverview, campusMatters, createCampusMatter } from '../../services/campusMatters.js'

const route = useRoute()
const router = useRouter()
const page = useCampusLifePage()
const view = ref(['mine', 'helped'].includes(String(route.query.view)) ? String(route.query.view) : 'all')
const topic = ref('all')
const searchText = ref('')
/** @typedef {{type: string, id: string, title?: string, detail?: string, status?: string, latestOutcome?: {outcome: string}, campus?: string}} CampusSearchItem */
const searchItems = ref(/** @type {CampusSearchItem[]} */ ([]))
const searchBusy = ref(false)
const searchPerformed = ref(false)
const searchError = ref('')
const publishBusy = ref(false)
const composerOpen = ref(false)
const composerEl = ref(/** @type {HTMLElement|null} */ (null))
const defaultDraft = { content: '', intent: '', options: ['', ''], isAnonymous: true, allowClarifications: true, showOutcomes: true, intakeAnswers: {}, relatedEntityType: '', relatedEntityId: '' }
const draft = useCampusLifeDraft('matters', defaultDraft)
const draftValue = draft.value
const draftSavedRevision = draft.savedRevision
const draftSaveError = draft.saveError
const analysis = computed(() => analyzeCampusMatter(draftValue.value.content))
const chosenIntent = computed(() => draftValue.value.intent || analysis.value.intent || 'vent')
const categoryLabel = computed(() => matterCategoryLabels[analysis.value.category] || matterCategoryLabels.other)
const allItems = computed(() => page.data.value?.items || [])
const pageIndex = computed(() => Number(page.data.value?.page) || 0)
const feedItems = computed(() => allItems.value)
const optionPartlyFilled = computed(() => chosenIntent.value === 'decision' && draftValue.value.options.some(Boolean) && !draftValue.value.options.every((value) => value.trim()))
const canPublish = computed(() => Boolean(draftValue.value.content.trim()) && !optionPartlyFilled.value && !publishBusy.value)
const hasDraft = computed(() => Boolean(draftValue.value.content.trim()))
const viewOptions = [
  { value: 'all', label: '同校交流' },
  { value: 'mine', label: '我发布的' },
  { value: 'helped', label: '我帮助过的' },
]
const topicOptions = [
  { value: 'all', label: '最近更新' },
  { value: 'finding', label: '正在找办法' },
  { value: 'decisions', label: '正在做决定' },
  { value: 'solved', label: '已确认解决' },
  { value: 'experiences', label: '经历分享' },
]
const feedEmptyTitle = computed(() => {
  if (view.value === 'mine') return '你还没有发布内容'
  if (view.value === 'helped') return '你还没有帮助过其他同学'
  if (topic.value !== 'all') return '暂时没有这类交流内容'
  return '暂时没有公开内容'
})
const feedEmptyDescription = computed(() => {
  if (view.value === 'mine') return '分享、提问或发布一条校园信息都可以。'
  if (view.value === 'helped') return '你提交并通过审核的回应会关联到这里。'
  if (topic.value !== 'all') return '换个类型看看，或发布一条你想分享的内容。'
  return '这里汇集同校同学的提问、经历、想法和校园信息。你也可以只发布一条内容。'
})

async function load({ forceRefresh = false } = {}) {
  return page.load(() => {
    if (view.value === 'all' && topic.value === 'all') return campusMatterOverview({ forceRefresh })
    const filters = { view: view.value, page: 0 }
    if (view.value === 'all') filters.topic = topic.value
    return campusMatters(filters, { forceRefresh })
  }, null, { cacheKey: ['matters', view.value, topic.value] })
}

function loadPage(nextPage) {
  if (nextPage < 0) return
  const filters = { view: view.value, page: nextPage }
  if (view.value === 'all' && topic.value !== 'all') filters.topic = topic.value
  return page.load(() => campusMatters(filters), null, {
    cacheKey: ['matters', view.value, topic.value, nextPage],
  })
}

function selectTopic(value) {
  if (topic.value === value) {
    if (pageIndex.value > 0) void load()
    return
  }
  topic.value = value
}

function displayDate(value) { return value ? String(value).slice(0, 10) : '' }
function matterRoute(item) { return `/campus/matters/${item.id}` }
function resourceRoute(item) { return item.type === 'matter' ? matterRoute(item) : campusContentRoute(item.type) }

async function openComposer() {
  composerOpen.value = true
  await nextTick()
  composerEl.value?.scrollIntoView({ behavior: animationsEnabled() ? 'smooth' : 'auto', block: 'center' })
}

function closeComposer() {
  composerOpen.value = false
}

async function findExisting() {
  searchPerformed.value = true
  const term = (searchText.value || draftValue.value.content).trim()
  if (!term) { searchError.value = '先输入想找的内容。'; return }
  searchBusy.value = true
  searchError.value = ''
  searchItems.value = []
  try {
    const inferred = analyzeCampusMatter(term)
    const terms = [...new Set([inferred.searchTerms[0], inferred.searchTerms[1], term.slice(0, 90)].filter(Boolean))].slice(0, 3)
    const requests = terms.map((query) => campusLifeSearch(query, { type: 'matter' }))
    if (inferred.relatedType) requests.push(campusLifeSearch(terms[0] || term.slice(0, 90), { type: inferred.relatedType }))
    const results = await Promise.all(requests)
    const unique = new Map()
    results.flatMap((result) => result.results || []).forEach((item) => unique.set(`${item.type}:${item.id}`, item))
    searchItems.value = [...unique.values()].sort((a, b) => Number(b.status === 'resolved') - Number(a.status === 'resolved'))
  } catch (cause) {
    searchError.value = cause?.message || '暂时无法搜索，请稍后重试。'
  } finally { searchBusy.value = false }
}

function useRelatedItem(item) {
  if (item.type === 'matter') {
    void router.push(matterRoute(item))
    return
  }
  draftValue.value.relatedEntityType = item.type
  draftValue.value.relatedEntityId = item.id
  searchError.value = ''
}

watch([searchText, () => draftValue.value.content], () => { searchPerformed.value = false })
watch(() => analysis.value.followUp?.key, (next, previous) => {
  if (previous && previous !== next) draftValue.value.intakeAnswers = {}
})
watch([view, topic], () => { void load() })
onMounted(() => {
  if (!page.data.value) {
    if (hasDraft.value) composerOpen.value = true
    void load()
  }
})

async function publish() {
  if (!canPublish.value) return
  publishBusy.value = true
  let created = null
  const options = draftValue.value.options.every((value) => value.trim())
    ? draftValue.value.options.map((label) => ({ label: label.trim() })) : []
  const intakeAnswers = chosenIntent.value !== 'vent' && analysis.value.followUp && draftValue.value.intakeAnswers[analysis.value.followUp.key]
    ? { [analysis.value.followUp.key]: draftValue.value.intakeAnswers[analysis.value.followUp.key] } : {}
  const ok = await page.act(async () => {
    const result = await createCampusMatter({
      content: draftValue.value.content, intent: chosenIntent.value, category: analysis.value.category,
      options, intakeAnswers, relatedEntityType: draftValue.value.relatedEntityType || undefined,
      relatedEntityId: draftValue.value.relatedEntityId || undefined, isAnonymous: draftValue.value.isAnonymous,
      allowClarifications: chosenIntent.value !== 'vent' && draftValue.value.allowClarifications,
      showOutcomes: chosenIntent.value !== 'vent' && draftValue.value.showOutcomes,
    })
    created = result?.matter
  }, '内容已提交审核，通过后会在同校交流中显示。')
  publishBusy.value = false
  if (!ok || !created?.id) return
  draft.clear()
  await router.push(matterRoute(created))
}

</script>

<template>
  <CampusLifeLayout title="校园交流" description="分享经历、发起讨论，或只发布一条想说的话。">
    <section class="campus-life-panel matter-hero" aria-labelledby="matter-hero-title">
      <div class="matter-hero-copy">
        <h2 id="matter-hero-title">校园里的事，拿出来聊聊。</h2>
        <p>可以问问题、分享经历、交流信息，也可以只发一条想说的话。</p>
      </div>
      <form class="matter-search" role="search" aria-label="搜索同校问题和校园资料" @submit.prevent="findExisting">
        <Search aria-hidden="true" />
        <label class="sr-only" for="matter-search">搜索同校问题和校园资料</label>
        <input id="matter-search" v-model="searchText" maxlength="100" type="search" placeholder="搜宿舍、选课、实习或类似经历" />
        <button class="btn btn-outline" type="submit" :disabled="searchBusy">{{ searchBusy ? '正在找…' : '搜索' }}</button>
      </form>
      <div class="matter-hero-actions">
        <p>只在你点击搜索时读取公开的同校资料，输入内容不会自动发送。</p>
        <button class="btn btn-primary" type="button" @click="openComposer">{{ hasDraft ? '继续写草稿' : '发布一条' }}</button>
      </div>
    </section>

    <section v-if="searchPerformed" class="campus-life-panel matter-search-results" aria-live="polite" aria-labelledby="matter-search-results-title">
      <div class="matter-section-heading">
        <div><h2 id="matter-search-results-title">{{ searchBusy ? '正在找相关内容' : searchItems.length ? '找到这些相关内容' : '没有找到相似内容' }}</h2><p v-if="!searchBusy && !searchError">搜索校园交流和相关校园资料，也可以换个短关键词再试。</p></div>
      </div>
      <p v-if="searchError" class="campus-life-inline-state error" role="alert">{{ searchError }}</p>
      <p v-else-if="searchBusy" class="campus-life-state" role="status">正在查找同校公开资料…</p>
      <p v-else-if="!searchItems.length" class="matter-empty-inline">可以继续描述自己的情况；草稿会保存在这台设备上。</p>
      <article v-for="item in searchItems" :key="`${item.type}:${item.id}`" class="matter-search-result">
        <div class="matter-search-result-copy">
          <span class="campus-life-tag">{{ item.type === 'matter' ? '相似事情' : campusContentLabel(item.type) }}</span>
          <h3>{{ item.title }}</h3>
          <p>{{ item.detail || '暂无补充说明。' }}</p>
          <small v-if="item.type === 'matter'">{{ matterStatusLabels[item.status] || '正在处理' }}<template v-if="item.status === 'resolved' && item.latestOutcome"> · {{ matterOutcomeLabels[item.latestOutcome.outcome] }}</template></small>
          <small v-else-if="item.campus">{{ item.campus }}</small>
        </div>
        <div class="matter-result-actions">
          <button v-if="item.type !== 'matter'" type="button" class="btn btn-outline" :aria-pressed="draftValue.relatedEntityId === item.id" @click="useRelatedItem(item)">{{ draftValue.relatedEntityId === item.id ? '已关联' : '关联资料' }}</button>
          <RouterLink class="btn btn-ghost" :to="resourceRoute(item)">{{ item.type === 'matter' ? '查看处理过程' : `查看${campusContentLabel(item.type)}` }}<ArrowRight aria-hidden="true" /></RouterLink>
        </div>
      </article>
    </section>

    <section class="campus-life-panel matter-list-panel" aria-labelledby="matter-feed-title">
      <div class="matter-section-heading">
        <div><h2 id="matter-feed-title">同校交流</h2><p>只展示审核通过的真实分享；发帖不要求你提出问题或寻求建议。</p></div>
        <button class="btn btn-outline" type="button" :disabled="page.loading.value" @click="load({ forceRefresh: true })">刷新</button>
      </div>
      <div class="matter-view-tabs" role="group" aria-label="选择内容范围">
        <button v-for="item in viewOptions" :key="item.value" type="button" :aria-pressed="view === item.value" @click="view = item.value">{{ item.label }}</button>
      </div>
      <div v-if="view === 'all'" class="matter-topic-tabs" role="group" aria-label="按内容主题查看">
        <button v-for="item in topicOptions" :key="item.value" type="button" :aria-pressed="topic === item.value" @click="selectTopic(item.value)">{{ item.label }}</button>
      </div>
      <CampusStateBlock
        :loading="page.loading.value"
        :loaded="Boolean(page.data.value)"
        :error="page.error.value"
        :empty="!feedItems.length"
        loading-text="正在读取校园交流…"
        :empty-title="feedEmptyTitle"
        :empty-description="feedEmptyDescription"
        @retry="load()"
      >
        <div class="matter-record-list">
          <RouterLink v-for="item in feedItems" :key="item.id" class="matter-feed-card" :to="matterRoute(item)">
            <span class="matter-feed-status">{{ matterStatusLabels[item.status] || matterIntentLabels[item.intent] || '正在处理' }}</span>
            <span class="matter-feed-copy">
              <b>{{ item.title }}</b>
              <small>{{ matterCategoryLabels[item.category] || '校园生活' }}<span aria-hidden="true"> · </span>{{ item.authorLabel }}<span aria-hidden="true"> · </span>{{ displayDate(item.updated_at || item.created_at) }}</small>
              <small v-if="item.latestOutcome">后来：{{ matterOutcomeLabels[item.latestOutcome.outcome] }}<template v-if="item.latestOutcome.note"> · {{ item.latestOutcome.note }}</template></small>
              <small v-else-if="item.experienceCount">{{ item.experienceCount }} 位同学也经历过</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </RouterLink>
        </div>
      </CampusStateBlock>
      <nav v-if="page.data.value && (page.data.value.hasMore || pageIndex > 0)" class="matter-pagination" aria-label="交流内容分页">
        <button class="btn btn-outline" type="button" :disabled="page.loading.value || pageIndex === 0" @click="loadPage(pageIndex - 1)">上一页</button>
        <span>第 {{ pageIndex + 1 }} 页<template v-if="page.data.value.total"> · 共 {{ page.data.value.total }} 件</template></span>
        <button class="btn btn-outline" type="button" :disabled="page.loading.value || !page.data.value.hasMore" @click="loadPage(pageIndex + 1)">下一页</button>
      </nav>
    </section>

    <section v-if="composerOpen" ref="composerEl" class="campus-life-panel matter-composer" aria-labelledby="matter-composer-title">
      <div class="matter-section-heading">
        <div><h2 id="matter-composer-title">发布一条校园交流</h2><p>可以提问，也可以分享经历、想法或一条信息。没有问题也能发。</p></div>
        <span v-if="draftSavedRevision" class="matter-local-save" role="status">草稿已保存在这台设备</span>
      </div>
      <div class="matter-compose-choice">
        <span>这条内容想怎么交流？</span>
        <div class="matter-intent-picker" role="group" aria-label="选择发布类型">
          <button v-for="[key, label] in Object.entries(matterIntentLabels)" :key="key" type="button" :aria-pressed="chosenIntent === key" @click="draftValue.intent = key">{{ label }}</button>
        </div>
        <p v-if="chosenIntent === 'vent'">只分享，不求建议；同学可以回应，也可以只看。</p>
      </div>
      <label class="matter-text-label" for="matter-content">你想说什么？</label>
      <textarea id="matter-content" v-model="draftValue.content" maxlength="2400" rows="4" placeholder="分享一件校园里的事、一次经历、一条信息，或你想讨论的问题。" />
      <p class="matter-form-hint">写下最想让同校同学知道的内容即可。{{ draftValue.content.length }}/2400</p>

      <p v-if="draftValue.content.trim().length >= 8" class="matter-category-hint">内容分类提示：「{{ categoryLabel }}」。由关键词暂时判断，不影响发布。</p>

      <details v-if="analysis.followUp && chosenIntent !== 'vent'" class="matter-optional-block" :open="Boolean(draftValue.intakeAnswers[analysis.followUp.key])">
        <summary>补充一个背景（可跳过）</summary>
        <p class="matter-follow-question">{{ analysis.followUp.question }}</p>
        <div class="matter-choice-list">
          <button v-for="option in analysis.followUp.options" :key="option" type="button" :aria-pressed="draftValue.intakeAnswers[analysis.followUp.key] === option" @click="draftValue.intakeAnswers[analysis.followUp.key] = option">{{ option }}</button>
        </div>
        <button v-if="draftValue.intakeAnswers[analysis.followUp.key]" class="text-button" type="button" @click="delete draftValue.intakeAnswers[analysis.followUp.key]">清除回答</button>
      </details>

      <details v-if="chosenIntent === 'decision'" class="matter-optional-block">
        <summary>添加 A / B 两个选择（可选）</summary>
        <div class="matter-option-fields"><label>A<input v-model="draftValue.options[0]" maxlength="80" placeholder="第一个选择" /></label><label>B<input v-model="draftValue.options[1]" maxlength="80" placeholder="第二个选择" /></label></div>
        <p v-if="optionPartlyFilled" class="campus-life-inline-state error" role="alert">如果添加选择，请把 A 和 B 都写完整；也可以清空两项后发布。</p>
      </details>

      <details class="matter-optional-block matter-privacy-block">
        <summary>隐私和后续设置</summary>
        <div class="matter-privacy-controls">
          <label><input v-model="draftValue.isAnonymous" type="checkbox" /> 匿名显示</label>
          <label v-if="chosenIntent !== 'vent'"><input v-model="draftValue.allowClarifications" type="checkbox" /> 允许同学提出关键问题</label>
          <label v-if="chosenIntent !== 'vent'"><input v-model="draftValue.showOutcomes" type="checkbox" /> 允许大家查看之后的结果</label>
        </div>
      </details>
      <p v-if="analysis.highRisk" class="campus-life-inline-state matter-safety" role="status">如果你或身边的人正面临人身危险，请立即联系可信任的人和学校正式安全或医疗支持；紧急情况下联系当地急救或警方。同学经验不能替代专业帮助。</p>
      <p v-if="draftSaveError" class="campus-life-inline-state error" role="alert">{{ draftSaveError }}</p>
      <p v-if="page.actionError.value" class="campus-life-inline-state error" role="alert">{{ page.actionError.value }}</p>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
      <div class="matter-compose-actions">
        <span v-if="draftValue.relatedEntityType" class="matter-related-selected">已关联：{{ campusContentLabel(draftValue.relatedEntityType) }}<button type="button" aria-label="移除关联资料" @click="draftValue.relatedEntityType = ''; draftValue.relatedEntityId = ''">×</button></span>
        <button class="btn btn-outline" type="button" :disabled="searchBusy || !draftValue.content.trim()" @click="searchText = draftValue.content; findExisting()">先找相似内容</button>
        <button class="btn btn-primary" type="button" :disabled="!canPublish" @click="publish">{{ publishBusy ? '正在提交…' : '发布内容' }}</button>
        <button class="text-button matter-close-composer" type="button" @click="closeComposer">收起</button>
      </div>
    </section>
  </CampusLifeLayout>
</template>

<style scoped>
.matter-hero { gap: 18px; padding-top: clamp(20px, 4vw, 32px); padding-bottom: clamp(20px, 4vw, 32px); }
.matter-hero-copy { display: grid; gap: 8px; max-width: 68ch; }
.matter-hero h2 { margin: 0; font-size: clamp(24px, 3vw, 32px); line-height: 1.4; letter-spacing: -.025em; }
.matter-hero-copy p, .matter-hero-actions p { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.8; }
.matter-search { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 7px 8px 7px 12px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg); }
.matter-search > svg { width: 18px; height: 18px; flex: none; color: var(--muted); }
.matter-search input { flex: 1; min-width: 0; min-height: 42px; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 16px; }
.matter-search:focus-within { outline: 2px solid var(--primary); outline-offset: 3px; }
.matter-search .btn { flex: none; }
.matter-hero-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.matter-hero-actions p { font-size: var(--fs-11); }
.matter-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.matter-section-heading h2 { font-size: var(--fs-18); }
.matter-section-heading p { margin: 5px 0 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; }
.matter-search-results { gap: 13px; }
.matter-search-result { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-top: 1px solid var(--border); }
.matter-search-result-copy { min-width: 0; }
.matter-search-result h3 { margin: 7px 0 5px; font-size: var(--fs-14); line-height: 1.6; overflow-wrap: anywhere; }
.matter-search-result p { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; white-space: pre-wrap; }
.matter-search-result small { display: block; margin-top: 6px; color: var(--muted); font-size: var(--fs-11); }
.matter-result-actions { display: flex; align-items: center; flex: none; flex-wrap: wrap; gap: 8px; }
.matter-result-actions a { display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
.matter-result-actions svg { width: 15px; height: 15px; }
.matter-list-panel { gap: 18px; }
.matter-view-tabs, .matter-topic-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.matter-view-tabs button, .matter-topic-tabs button { min-height: 42px; padding: 8px 13px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--muted); font: inherit; font-size: var(--fs-12); cursor: pointer; }
.matter-view-tabs button[aria-pressed=true] { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); font-weight: var(--fw-650); }
.matter-topic-tabs { gap: 6px; }
.matter-topic-tabs button { min-height: 36px; border-color: transparent; background: transparent; font-size: var(--fs-11); }
.matter-topic-tabs button[aria-pressed=true] { background: var(--bg-tint); color: var(--text); font-weight: var(--fw-650); }
.matter-record-list { display: grid; }
.matter-feed-card { display: grid; grid-template-columns: 112px minmax(0, 1fr) 18px; align-items: center; gap: 14px; min-width: 0; padding: 15px 2px; border-top: 1px solid var(--border); color: var(--text); text-decoration: none; }
.matter-feed-card:first-child { border-top: 0; }
.matter-feed-status { justify-self: start; padding: 5px 9px; border-radius: 999px; background: var(--bg-tint); color: var(--primary); font-size: var(--fs-11); line-height: 1.4; }
.matter-feed-copy { display: grid; gap: 6px; min-width: 0; }
.matter-feed-copy b { font-size: var(--fs-13); line-height: 1.6; overflow-wrap: anywhere; }
.matter-feed-copy small { color: var(--muted); font-size: var(--fs-11); line-height: 1.6; overflow-wrap: anywhere; }
.matter-feed-card > svg { width: 17px; height: 17px; color: var(--muted); }
.matter-feed-card:hover .matter-feed-copy b { color: var(--primary); }
.matter-feed-card:focus-visible, .matter-hero :is(button, a):focus-visible, .matter-search-results :is(button, a):focus-visible, .matter-list-panel :is(button, a):focus-visible, .matter-composer :is(button, a, input, textarea):focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.matter-pagination { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; padding-top: 5px; }
.matter-pagination span { color: var(--muted); font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.matter-composer { scroll-margin-top: 20px; }
.matter-local-save { color: var(--success); font-size: var(--fs-11); white-space: nowrap; }
.matter-text-label { font-size: var(--fs-14); font-weight: var(--fw-650); }
.matter-composer textarea { box-sizing: border-box; width: 100%; min-height: 130px; padding: 13px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--bg); color: var(--text); font: inherit; font-size: 16px; line-height: 1.8; resize: vertical; }
.matter-form-hint, .matter-category-hint { margin: 0; color: var(--muted); font-size: var(--fs-11); line-height: 1.7; }
.matter-compose-choice { display: grid; gap: 9px; }
.matter-compose-choice > span { color: var(--muted); font-size: var(--fs-12); font-weight: var(--fw-600); }
.matter-compose-choice > p { margin: 0; color: var(--muted); font-size: var(--fs-11); line-height: 1.6; }
.matter-intent-picker, .matter-choice-list { display: flex; flex-wrap: wrap; gap: 8px; }
.matter-intent-picker button, .matter-choice-list button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--text); font: inherit; font-size: var(--fs-11); cursor: pointer; }
.matter-intent-picker button[aria-pressed=true], .matter-choice-list button[aria-pressed=true] { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.matter-optional-block { padding: 11px 0; border-top: 1px solid var(--border); }
.matter-optional-block > summary { display: flex; align-items: center; min-height: 40px; color: var(--primary); font-size: var(--fs-12); cursor: pointer; list-style: none; }
.matter-optional-block > summary::-webkit-details-marker { display: none; }
.matter-optional-block > summary::after { content: '+'; margin-left: auto; color: var(--muted); font-size: 18px; }
.matter-optional-block[open] > summary::after { content: '−'; }
.matter-follow-question { margin: 5px 0 10px; font-size: var(--fs-13); font-weight: var(--fw-600); }
.matter-option-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.matter-option-fields label { display: grid; gap: 5px; color: var(--muted); font-size: var(--fs-11); }
.matter-option-fields input { min-height: 42px; padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg); color: var(--text); font: inherit; font-size: 16px; }
.matter-privacy-block[open] { padding-bottom: 0; }
.matter-privacy-controls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 4px 0 10px; }
.matter-privacy-controls label { display: flex; align-items: center; gap: 8px; min-height: 40px; color: var(--muted); font-size: var(--fs-11); }
.matter-privacy-controls input { width: 17px; height: 17px; accent-color: var(--primary); }
.matter-safety { background: color-mix(in srgb, var(--danger) 8%, var(--card)); color: var(--text); }
.matter-empty-inline { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.7; }
.matter-compose-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 9px; padding-top: 4px; }
.matter-related-selected { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; padding: 7px 10px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: var(--fs-11); }
.matter-related-selected button { width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 19px; cursor: pointer; }
.matter-close-composer { min-height: 42px; padding-inline: 9px; }
@media (max-width: 760px) {
  .matter-search-result { align-items: flex-start; flex-direction: column; }
  .matter-result-actions { width: 100%; }
  .matter-result-actions > * { flex: 1; justify-content: center; }
  .matter-feed-card { grid-template-columns: 1fr 18px; align-items: start; gap: 7px 12px; }
  .matter-feed-status { grid-column: 1; }
  .matter-feed-copy { grid-column: 1; grid-row: 2; }
  .matter-feed-card > svg { grid-column: 2; grid-row: 1 / span 2; margin-top: 4px; }
  .matter-compose-actions > * { flex: 1; }
  .matter-related-selected { flex: 1; }
}
@media (max-width: 520px) {
  .matter-hero { padding: 18px; }
  .matter-hero-actions { align-items: stretch; flex-direction: column; }
  .matter-hero-actions .btn { width: 100%; }
  .matter-search { flex-wrap: wrap; }
  .matter-search input { flex-basis: calc(100% - 32px); }
  .matter-search .btn { width: 100%; }
  .matter-section-heading { align-items: flex-start; }
  .matter-view-tabs button { flex: 1; }
  .matter-topic-tabs { flex-wrap: nowrap; overflow-x: auto; padding: 1px 0 5px; scrollbar-width: thin; }
  .matter-topic-tabs button { flex: none; }
  .matter-option-fields { grid-template-columns: 1fr; }
  .matter-privacy-controls { display: grid; gap: 2px; }
  .matter-compose-actions { display: grid; grid-template-columns: 1fr; }
  .matter-compose-actions .btn { width: 100%; }
  .matter-local-save { white-space: normal; text-align: right; }
}
@media (prefers-reduced-motion: reduce) {
  .matter-feed-card, .matter-feed-card:hover .matter-feed-copy b { transition: none; }
}
</style>
