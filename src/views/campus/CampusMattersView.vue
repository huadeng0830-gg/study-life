<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Search } from '@lucide/vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import { useCampusLifeDraft } from '../../composables/campusLifeDraft.js'
import { campusContentLabel, campusContentRoute } from '../../composables/campusContentModel.js'
import { analyzeCampusMatter, matterCategoryLabels, matterIntentLabels, matterOutcomeLabels, matterStatusLabels } from '../../composables/campusMatterModel.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeSearch } from '../../services/campusLife.js'
import { campusMatterOverview, campusMatters, createCampusMatter } from '../../services/campusMatters.js'

const route = useRoute()
const router = useRouter()
const page = useCampusLifePage()
const view = ref(['mine','helped'].includes(String(route.query.view)) ? String(route.query.view) : 'all')
const searchText = ref('')
const searchItems = ref(/** @type {any[]} */ ([]))
const searchBusy = ref(false)
const searchError = ref('')
const publishBusy = ref(false)
const defaultDraft = { content: '', intent: '', options: ['', ''], isAnonymous: true, allowClarifications: true, showOutcomes: true, intakeAnswers: {}, relatedEntityType: '', relatedEntityId: '' }
const draft = useCampusLifeDraft('matters', defaultDraft)
const draftValue = draft.value
const draftSavedRevision = draft.savedRevision
const draftSaveError = draft.saveError
const analysis = computed(() => analyzeCampusMatter(draftValue.value.content))
const chosenIntent = computed(() => draftValue.value.intent || analysis.value.intent)
const categoryLabel = computed(() => matterCategoryLabels[analysis.value.category] || matterCategoryLabels.other)
const allItems = computed(() => page.data.value?.items || [])
const sections = computed(() => page.data.value?.sections || {})
const optionPartlyFilled = computed(() => chosenIntent.value === 'decision' && draftValue.value.options.some(Boolean) && !draftValue.value.options.every((value) => value.trim()))
const canPublish = computed(() => Boolean(draftValue.value.content.trim()) && !optionPartlyFilled.value && !publishBusy.value)

async function load({ forceRefresh = false } = {}) {
  return page.load(async () => {
    if (view.value !== 'all') return campusMatters({ view: view.value }, { forceRefresh })
    return campusMatterOverview({ forceRefresh })
  }, null, { cacheKey: ['matters', view.value] })
}

function displayDate(value) { return value ? String(value).slice(0, 10) : '' }
function matterRoute(item) { return `/campus/matters/${item.id}` }
function resourceRoute(item) { return item.type === 'matter' ? matterRoute(item) : campusContentRoute(item.type) }

async function findExisting() {
  const term = (searchText.value || draftValue.value.content).trim()
  if (!term) { searchError.value = '先写下想查的问题，平台才知道该找什么。'; return }
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

watch(() => analysis.value.followUp?.key, (next, previous) => {
  if (previous && previous !== next) draftValue.value.intakeAnswers = {}
})
watch(view, () => { void load() })
onMounted(() => { if (view.value !== 'all' || !page.data.value) void load() })

async function publish() {
  if (!canPublish.value) return
  publishBusy.value = true
  let created = null
  const options = draftValue.value.options.every((value) => value.trim())
    ? draftValue.value.options.map((label) => ({ label: label.trim() })) : []
  const intakeAnswers = analysis.value.followUp && draftValue.value.intakeAnswers[analysis.value.followUp.key]
    ? { [analysis.value.followUp.key]: draftValue.value.intakeAnswers[analysis.value.followUp.key] } : {}
  const ok = await page.act(async () => {
    const result = await createCampusMatter({
      content: draftValue.value.content, intent: chosenIntent.value, category: analysis.value.category,
      options, intakeAnswers, relatedEntityType: draftValue.value.relatedEntityType || undefined,
      relatedEntityId: draftValue.value.relatedEntityId || undefined, isAnonymous: draftValue.value.isAnonymous,
      allowClarifications: draftValue.value.allowClarifications, showOutcomes: draftValue.value.showOutcomes,
    })
    created = result?.matter
  }, '这件事已提交，审核通过后会进入同校问题池。')
  publishBusy.value = false
  if (!ok || !created?.id) return
  draft.clear()
  await router.push(matterRoute(created))
}

function viewLabel(value) { return value === 'mine' ? '我遇到的事' : value === 'helped' ? '我帮助过的事' : '所有事情' }
</script>

<template>
  <CampusLifeLayout title="怎么办" description="不知道怎么办，就来看看别人怎么做。把真实情况说清楚，找到可执行的办法，再回来告诉大家后来怎么样。">
    <section class="matter-hero campus-life-panel">
      <div><span class="matter-eyebrow">校园真实问题解决入口</span><h2>遇到一件事，先把它理清楚。</h2><p>这里记录真实情况、亲身经历和实际办法。没有“热度榜”，只有还在找办法、正在尝试和已经确认的结果。</p></div>
      <form class="matter-search" role="search" aria-label="搜索问题、经历和校园信息" @submit.prevent="findExisting"><label class="sr-only" for="matter-search">搜问题、经历、校园信息</label><Search aria-hidden="true" /><input id="matter-search" v-model="searchText" maxlength="100" type="search" placeholder="搜问题、经历或校园信息" /><button class="btn btn-primary" type="submit" :disabled="searchBusy">{{ searchBusy ? '正在找…' : '先找办法' }}</button></form>
      <p class="matter-search-privacy">只在你点击“先找办法”时搜索已公开的同校资料；输入中的草稿不会自动发送。</p>
    </section>

    <section class="campus-life-panel matter-composer" aria-labelledby="matter-composer-title">
      <div class="matter-section-heading"><div><h2 id="matter-composer-title">＋ 遇到一件事？</h2><p>先写发生了什么。标题、分类和补充问题都可以由系统提示，也都可以跳过。</p></div><span v-if="draftSavedRevision" class="matter-local-save" role="status">草稿已保存在这台设备</span></div>
      <label class="matter-text-label" for="matter-content">发生了什么？</label>
      <textarea id="matter-content" v-model="draftValue.content" maxlength="2400" rows="4" placeholder="例如：室友晚上打游戏太吵，我不知道该不该直接说。" />
      <p class="matter-form-hint">可以直接写你的情况，不需要先想标题。{{ draftValue.content.length }}/2400</p>

      <div v-if="draftValue.content.trim().length >= 8" class="matter-understanding" aria-live="polite">
        <div><span class="matter-form-hint">根据关键词的一个提示，你更像是：</span><b>{{ matterIntentLabels[chosenIntent] }}</b><small>可改，也可发布时跳过。</small></div>
        <div class="matter-intent-list"><button v-for="[key,label] in Object.entries(matterIntentLabels)" :key="key" type="button" :class="{ selected: chosenIntent === key }" @click="draftValue.intent = key">{{ label }}</button><button type="button" :class="{ selected: !draftValue.intent }" @click="draftValue.intent = ''">按情况提示</button></div>
        <p class="matter-category-hint">系统暂时把它归到「{{ categoryLabel }}」，这只用于寻找相关资料，不影响发布。</p>
      </div>

      <div v-if="analysis.followUp" class="matter-follow-up">
        <p class="matter-follow-question">{{ analysis.followUp.question }} <small>可跳过，不影响发布</small></p>
        <div class="matter-choice-list"><button v-for="option in analysis.followUp.options" :key="option" type="button" :class="{ selected: draftValue.intakeAnswers[analysis.followUp.key] === option }" @click="draftValue.intakeAnswers[analysis.followUp.key] = option">{{ option }}</button></div>
        <button v-if="draftValue.intakeAnswers[analysis.followUp.key]" class="text-button" type="button" @click="delete draftValue.intakeAnswers[analysis.followUp.key]">清除回答</button>
      </div>

      <details v-if="chosenIntent === 'decision'" class="matter-optional-fields">
        <summary>添加 A / B 两个选择（可选）</summary>
        <div class="matter-option-fields"><label>A<input v-model="draftValue.options[0]" maxlength="80" placeholder="第一个选择" /></label><label>B<input v-model="draftValue.options[1]" maxlength="80" placeholder="第二个选择" /></label></div>
        <p v-if="optionPartlyFilled" class="campus-life-inline-state error" role="alert">如果添加选择，请把 A 和 B 都写完整；也可以清空两项后发布。</p>
      </details>

      <div class="matter-privacy-controls">
        <label><input v-model="draftValue.isAnonymous" type="checkbox" /> 匿名显示</label>
        <label><input v-model="draftValue.allowClarifications" type="checkbox" /> 允许同学提出关键澄清问题</label>
        <label><input v-model="draftValue.showOutcomes" type="checkbox" /> 允许大家查看我之后的结果</label>
      </div>
      <p v-if="analysis.highRisk" class="campus-life-inline-state matter-safety" role="status">如果你或身边的人现在有立即的人身危险，请先联系可信任的人，并联系学校正式的安全或医疗支持渠道；紧急情况下联系当地急救或警方。本页面的同学经验不能替代专业帮助。</p>
      <p v-if="draftSaveError" class="campus-life-inline-state error" role="alert">{{ draftSaveError }}</p>
      <p v-if="page.actionError.value" class="campus-life-inline-state error" role="alert">{{ page.actionError.value }}</p>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
      <div class="matter-compose-actions"><span v-if="draftValue.relatedEntityType" class="matter-related-selected">已关联：{{ campusContentLabel(draftValue.relatedEntityType) }}<button type="button" aria-label="移除关联资料" @click="draftValue.relatedEntityType = ''; draftValue.relatedEntityId = ''">×</button></span><button class="btn btn-outline" type="button" :disabled="searchBusy || !draftValue.content.trim()" @click="searchText = draftValue.content; findExisting()">先找相似事情 / 资料</button><button class="btn btn-primary" type="button" :disabled="!canPublish" @click="publish">{{ publishBusy ? '正在提交…' : '提交这件事' }}</button></div>
    </section>

    <section v-if="searchError || searchItems.length || searchBusy" class="campus-life-panel matter-search-results" aria-live="polite">
      <h2>先看看已经有的信息</h2><p v-if="searchError" class="campus-life-inline-state error" role="alert">{{ searchError }}</p><p v-else-if="searchBusy" class="campus-life-state">正在查找同校公开资料…</p><p v-else-if="!searchItems.length" class="campus-life-state">没有找到可直接使用的资料，可以改短关键词或继续描述这件事。</p>
      <article v-for="item in searchItems" :key="`${item.type}:${item.id}`" class="matter-search-result"><div><span class="campus-life-tag">{{ item.type === 'matter' ? '相似事情' : campusContentLabel(item.type) }}</span><h3>{{ item.title }}</h3><p>{{ item.detail || '暂无补充说明。' }}</p><small v-if="item.type === 'matter'">{{ matterStatusLabels[item.status] || '正在处理' }}<template v-if="item.status === 'resolved'"> · {{ matterOutcomeLabels.solved }}</template></small><small v-else-if="item.campus">{{ item.campus }}</small></div><div class="matter-result-actions"><button v-if="item.type !== 'matter'" type="button" class="btn btn-outline" @click="useRelatedItem(item)">{{ draftValue.relatedEntityId === item.id ? '已关联' : '关联这份资料' }}</button><RouterLink class="btn btn-ghost" :to="resourceRoute(item)">{{ item.type === 'matter' ? '看看怎么处理' : `查看${campusContentLabel(item.type)}` }}<ArrowRight aria-hidden="true" /></RouterLink></div></article>
    </section>

    <section class="campus-life-panel matter-list-panel">
      <div class="matter-section-heading"><div><h2>看看同校正在处理的事情</h2><p>根据真实状态查看，不按点赞或热度排列。</p></div><button class="btn btn-outline" type="button" :disabled="page.loading.value" @click="load({ forceRefresh: true })">刷新</button></div>
      <div class="matter-view-tabs" role="group" aria-label="事项范围"><button v-for="value in ['all','mine','helped']" :key="value" type="button" :aria-pressed="view === value" @click="view = value">{{ viewLabel(value) }}</button></div>
      <CampusStateBlock :loading="page.loading.value" :loaded="Boolean(page.data.value)" :error="page.error.value" :empty="!allItems.length" loading-text="正在读取同校事项…" :empty-title="view === 'mine' ? '你还没有记录事项' : view === 'helped' ? '你还没有帮助过其他同学' : '当前还没有公开的事项'" :empty-description="view === 'mine' ? '遇到事情时可以先写下来，草稿会保存在本机。' : view === 'helped' ? '你提交过并审核通过的解决方案会出现在这里。' : '这里不会用虚构内容填充。提交的事项审核通过后才会出现。'" @retry="load">
        <div v-if="view === 'all'" class="matter-sections">
          <section v-for="[key,title] in [['finding','现在有人正在找办法'],['decisions','大家最近正在纠结'],['solved','已经有人主动确认解决'],['experiences','有人分享了类似经历'],['recent','最近出现的新问题']]" :key="key" class="matter-mini-section"><div class="matter-mini-heading"><h3>{{ title }}</h3><span>{{ (key === 'recent' ? allItems : sections[key])?.length || 0 }}</span></div><p v-if="!(key === 'recent' ? allItems : sections[key])?.length" class="matter-empty-inline">目前没有已审核的真实事项。</p><RouterLink v-for="item in (key === 'recent' ? allItems : sections[key] || []).slice(0,3)" :key="item.id" class="matter-mini-card" :to="matterRoute(item)"><span class="campus-life-tag">{{ matterStatusLabels[item.status] || matterIntentLabels[item.intent] || '正在处理' }}</span><b>{{ item.title }}</b><small>{{ item.authorLabel }} · {{ displayDate(item.created_at) }}<template v-if="item.experienceCount"> · {{ item.experienceCount }} 人也经历过</template></small><ArrowRight aria-hidden="true" /></RouterLink></section>
        </div>
        <div v-else class="matter-record-list"><RouterLink v-for="item in allItems" :key="item.id" class="matter-mini-card" :to="matterRoute(item)"><span class="campus-life-tag">{{ matterStatusLabels[item.status] || matterIntentLabels[item.intent] || '正在处理' }}</span><b>{{ item.title }}</b><small>{{ item.authorLabel }} · {{ displayDate(item.updated_at || item.created_at) }}<template v-if="item.latestOutcome"> · 后来：{{ matterOutcomeLabels[item.latestOutcome.outcome] }}</template></small><ArrowRight aria-hidden="true" /></RouterLink></div>
      </CampusStateBlock>
      <nav v-if="page.data.value && view !== 'all' && (page.data.value.page || page.data.value.hasMore)" class="campus-life-actions" aria-label="事项列表分页"><button class="btn btn-outline" type="button" :disabled="page.loading.value || !page.data.value.page" @click="page.load(() => campusMatters({ view, page: page.data.value.page - 1 }))">上一页</button><span>第 {{ (page.data.value.page || 0) + 1 }} 页</span><button class="btn btn-outline" type="button" :disabled="page.loading.value || !page.data.value.hasMore" @click="page.load(() => campusMatters({ view, page: page.data.value.page + 1 }))">下一页</button></nav>
    </section>
  </CampusLifeLayout>
</template>

<style scoped>
.matter-hero{gap:18px;background:linear-gradient(135deg,var(--card),color-mix(in srgb,var(--primary-soft) 42%,var(--card)))}.matter-hero>div:first-child{display:grid;gap:8px}.matter-eyebrow{color:var(--primary);font-size:var(--fs-11);font-weight:var(--fw-700);letter-spacing:.06em}.matter-hero h2{font-size:clamp(22px,3vw,30px)}.matter-hero p,.matter-search-privacy{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.matter-search{display:flex;align-items:center;gap:10px}.matter-search>svg{width:18px;height:18px;flex:none;color:var(--primary)}.matter-search input{flex:1;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-13)}.matter-search-privacy{font-size:var(--fs-10)}.matter-composer{scroll-margin-top:20px}.matter-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.matter-section-heading h2{font-size:var(--fs-18)}.matter-section-heading p{margin:5px 0 0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}.matter-local-save{color:var(--success);font-size:var(--fs-11);white-space:nowrap}.matter-text-label{font-size:var(--fs-14);font-weight:var(--fw-650)}.matter-composer textarea{width:100%;box-sizing:border-box;min-height:126px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg);color:var(--text);font:inherit;font-size:16px;line-height:1.8;resize:vertical}.matter-form-hint,.matter-category-hint{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.matter-understanding{display:grid;gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}.matter-understanding>div:first-child{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.matter-understanding b{color:var(--primary);font-size:var(--fs-12)}.matter-understanding small{color:var(--muted);font-size:var(--fs-10)}.matter-intent-list,.matter-choice-list{display:flex;flex-wrap:wrap;gap:8px}.matter-intent-list button,.matter-choice-list button{min-height:40px;padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-11)}.matter-intent-list button.selected,.matter-choice-list button.selected{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.matter-category-hint{grid-column:1/-1}.matter-follow-up{display:grid;gap:10px;padding:14px;border-left:3px solid var(--primary);background:var(--bg-tint)}.matter-follow-up>label{font-size:var(--fs-13);font-weight:var(--fw-600)}.matter-follow-up>label small{margin-left:8px;color:var(--muted);font-size:var(--fs-10);font-weight:var(--fw-400)}.matter-optional-fields{padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.matter-optional-fields summary{min-height:38px;padding-top:7px;color:var(--primary);font-size:var(--fs-12);cursor:pointer}.matter-option-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.matter-option-fields label{display:grid;gap:5px;color:var(--muted);font-size:var(--fs-11)}.matter-option-fields input{min-height:42px;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text);font:inherit;font-size:16px}.matter-privacy-controls{display:flex;flex-wrap:wrap;gap:12px 18px;padding:13px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.matter-privacy-controls label{display:flex;align-items:center;gap:8px;min-height:38px;color:var(--muted);font-size:var(--fs-11)}.matter-privacy-controls input{width:17px;height:17px;accent-color:var(--primary)}.matter-safety{background:color-mix(in srgb,var(--danger) 8%,var(--card));color:var(--text)}.matter-compose-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:9px}.matter-related-selected{display:inline-flex;align-items:center;gap:6px;margin-right:auto;padding:7px 10px;border-radius:999px;background:var(--primary-soft);color:var(--primary);font-size:var(--fs-11)}.matter-related-selected button{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:19px}.matter-search-results{gap:13px}.matter-search-results>h2{font-size:var(--fs-17)}.matter-search-result{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-10)}.matter-search-result h3{margin:6px 0;font-size:var(--fs-13);line-height:1.6}.matter-search-result p{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7;white-space:pre-wrap}.matter-search-result small{display:block;margin-top:5px;color:var(--muted);font-size:var(--fs-10)}.matter-result-actions{display:flex;align-items:center;flex:none;flex-wrap:wrap;gap:8px}.matter-result-actions a{display:flex;align-items:center;gap:5px;text-decoration:none}.matter-result-actions svg{width:15px;height:15px}.matter-list-panel{gap:18px}.matter-view-tabs{display:flex;flex-wrap:wrap;gap:8px}.matter-view-tabs button{min-height:40px;padding:8px 13px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--muted);font:inherit;font-size:var(--fs-11)}.matter-view-tabs button[aria-pressed=true]{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:var(--fw-650)}.matter-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.matter-mini-section{display:grid;align-content:start;gap:9px}.matter-mini-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.matter-mini-heading h3{font-size:var(--fs-13)}.matter-mini-heading span{color:var(--muted);font-size:var(--fs-10);font-variant-numeric:tabular-nums}.matter-empty-inline{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.matter-mini-card{position:relative;display:grid;gap:6px;min-width:0;padding:13px 38px 13px 13px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg);color:var(--text);text-decoration:none}.matter-mini-card:hover{border-color:var(--primary)}.matter-mini-card b{font-size:var(--fs-12);line-height:1.7;overflow-wrap:anywhere}.matter-mini-card small{color:var(--muted);font-size:var(--fs-10);line-height:1.6}.matter-mini-card>svg{position:absolute;right:12px;top:50%;width:16px;height:16px;transform:translateY(-50%);color:var(--muted)}.matter-record-list{display:grid;gap:10px}
@media(max-width:760px){.matter-sections{grid-template-columns:1fr}.matter-search-result{align-items:flex-start;flex-direction:column}.matter-result-actions{width:100%}.matter-result-actions>*{flex:1;justify-content:center}.matter-compose-actions>*{flex:1}.matter-related-selected{flex:1}.matter-hero .matter-search{flex-wrap:wrap}.matter-search input{flex-basis:calc(100% - 34px)}}
@media(max-width:520px){.matter-hero{padding:17px}.matter-composer textarea{min-height:145px}.matter-privacy-controls{display:grid;gap:4px}.matter-compose-actions{display:grid;grid-template-columns:1fr}.matter-compose-actions .btn{width:100%}.matter-local-save{white-space:normal;text-align:right}.matter-section-heading{align-items:flex-start}.matter-intent-list button,.matter-choice-list button{min-height:44px}.matter-option-fields{grid-template-columns:1fr}}
.matter-follow-question{margin:0;font-size:var(--fs-13);font-weight:var(--fw-600)}.matter-follow-question small{margin-left:8px;color:var(--muted);font-size:var(--fs-10);font-weight:var(--fw-400)}
</style>
