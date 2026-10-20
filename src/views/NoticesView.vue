<script setup>
import PageHeader from '../components/PageHeader.vue'
import VirtualList from '../components/VirtualList.vue'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { policyDateKey } from '../composables/settingsPolicy.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { clock } from '../composables/store/core.js'
import { createNoticeRecord, noticeSources, notices, addNoticeLink, setNoticeSourceMuted, setNoticeStatus } from '../composables/noticeArchive.js'
import { summarizeNoticeSources, visibleNoticeRecords } from '../composables/noticeArchiveModel.js'
import { createPlaceOffer, deletePlaceOffer, places } from '../composables/placeBook.js'
import { parsePlaceOfferCandidate } from '../composables/noticeParser.js'
import { handOffNoticeToTasks } from '../composables/noticeHandoff.js'

const router = useRouter()
const statusFilter = ref('active')
const sourceFilter = ref('')
const topicFilter = ref('')
const rawInput = ref('')
const sourceInput = ref('')
const message = ref('')
const offerNoticeId = ref('')
const offerDraft = reactive({ placeId: '', title: '', price: '', originalPrice: '', expiresAt: '', note: '' })
const monthKey = computed(() => policyDateKey(clock.value).slice(0, 7))
const sources = computed(() => summarizeNoticeSources(notices.value, noticeSources.value, monthKey.value))
const topics = computed(() => [...new Set(notices.value.map((item) => String(item.topic || '').trim()).filter(Boolean))].sort())
const activePlaces = computed(() => places.value.filter((item) => !item.archivedAt))
// 改一次筛选就要重算一次 visible，并且 offerCandidates 会对每一条都跑一遍
// parsePlaceOfferCandidate。去抖让连续操作只触发最后一次重算。
const debouncedStatusFilter = useDebouncedRef(statusFilter, 120)
const debouncedSourceFilter = useDebouncedRef(sourceFilter, 120)
const debouncedTopicFilter = useDebouncedRef(topicFilter, 120)
const visible = computed(() => visibleNoticeRecords(notices.value, {
  status: debouncedStatusFilter.value,
  source: debouncedSourceFilter.value,
  topic: debouncedTopicFilter.value,
}))
const offerCandidates = computed(() => new Map(visible.value.map((item) => [
  item.id, parsePlaceOfferCandidate(item.raw, clock.value instanceof Date ? clock.value : new Date()),
])))

function saveNewNotice() {
  const raw = rawInput.value.trim()
  if (!raw) { message.value = '请先粘贴通知原文。'; return }
  try {
    createNoticeRecord({ raw, source: sourceInput.value, title: raw.split(/\r?\n/).find(Boolean), topic: '通知', status: 'new' })
    rawInput.value = ''
    message.value = '已存入待处理通知。'
  } catch {
    message.value = '通知没有保存成功，请检查本机存储状态后重试。'
  }
}

function changeStatus(item, status) {
  if (!setNoticeStatus(item.id, status)) message.value = '状态更新失败，请刷新后重试。'
}

/**
 * 档案页自己的存档动作：待办/日程页面无法读取本机的通知档案，
 * 而通知理解本来就接受一段原文——直接带过去，比让用户复制粘贴再粘一遍可靠。
 */
function actOnNotice(item) {
  handOffNoticeToTasks(item.raw)
  router.push('/tasks')
}

function toggleSource(source) {
  if (!setNoticeSourceMuted(source.source, !source.muted)) message.value = '来源设置没有保存成功。'
}

function offerCandidate(item) {
  return offerCandidates.value.get(item.id) || null
}

function hasOfferLink(item) {
  return item.linkedEntities?.some((link) => link.type === 'place-offer') || false
}

function openOfferLink(item) {
  if (!activePlaces.value.length) {
    router.push('/places')
    message.value = '先在地点页保存一个地点，再回来关联这条优惠通知。'
    return
  }
  const candidate = offerCandidate(item)
  if (!candidate) return
  offerNoticeId.value = item.id
  Object.assign(offerDraft, {
    placeId: activePlaces.value[0]?.id || '',
    title: candidate.title,
    price: candidate.price ?? '',
    originalPrice: candidate.originalPrice ?? '',
    expiresAt: candidate.expiresAt,
    note: '',
  })
}

function cancelOfferLink() {
  offerNoticeId.value = ''
}

function saveOfferLink(item) {
  const price = Number(offerDraft.price)
  if (!offerDraft.placeId || !offerDraft.title.trim() || !Number.isFinite(price) || price <= 0) {
    message.value = '请选择地点，并确认优惠名称和核销金额。'
    return
  }
  let offer
  try {
    offer = createPlaceOffer({
      placeId: offerDraft.placeId,
      title: offerDraft.title,
      price,
      originalPrice: offerDraft.originalPrice === '' ? null : Number(offerDraft.originalPrice),
      expiresAt: offerDraft.expiresAt,
      note: offerDraft.note,
      noticeId: item.id,
    })
    if (!addNoticeLink(item.id, 'place-offer', offer.id)) throw new Error('通知关联未能保存。')
    offerNoticeId.value = ''
    message.value = `已将优惠关联到地点“${activePlaces.value.find((place) => place.id === offer.placeId)?.name || '所选地点'}”。核销前可在地点页确认。`
  } catch (error) {
    if (offer) deletePlaceOffer(offer.id)
    message.value = error?.message || '优惠没有保存成功，请检查本机存储状态后重试。'
  }
}

function linkLabel(link) {
  return ({ task: '待办', schedule: '日程', 'place-offer': '地点优惠' })[link.type] || '记录'
}
</script>

<template>
  <div class="page notice-archive-page">
    <PageHeader class="page-head" title="通知档案" description="原文留在本机，按来源和主题查找。这里只记录自己的通知，不提供点赞或评论。">
      <template #actions><button class="btn btn-ghost" type="button" @click="router.push('/tasks')">返回待办</button></template>
    </PageHeader>

    <section class="archive-add card">
      <h2>收下一条通知</h2>
      <label>来源（可选）<input v-model="sourceInput" maxlength="60" placeholder="例如：虚构课程群" /></label>
      <label>通知原文<textarea v-model="rawInput" rows="3" placeholder="粘贴原文；保存后会进入待处理列表。" /></label>
      <div class="archive-add-actions"><p v-if="message" role="status">{{ message }}</p><button class="btn btn-primary" type="button" @click="saveNewNotice">保存原文</button></div>
    </section>

    <section class="archive-sources card">
      <div class="archive-section-title"><div><h2>通知来源</h2><p>屏蔽只会停止提醒，原文仍保留在档案里。</p></div></div>
      <p v-if="!sources.length" class="archive-empty">保存通知后，这里会显示来源和本月数量。</p>
      <div v-for="item in sources" :key="item.source" class="archive-source-row">
        <span><b>{{ item.source }}</b><small>本月 {{ item.monthCount }} 条 · 其中 {{ item.actionCount }} 条需要行动</small></span>
        <button type="button" class="btn btn-ghost" @click="toggleSource(item)">{{ item.muted ? '已屏蔽提醒' : '屏蔽提醒' }}</button>
      </div>
    </section>

    <section class="archive-list card">
      <div class="archive-section-title"><div><h2>原文检索</h2><p>按保存时间倒序排列。</p></div></div>
      <div class="archive-filters">
        <label>状态<select v-model="statusFilter"><option value="active">默认记录</option><option value="new">待处理</option><option value="handled">已处理</option><option value="archived">已归档</option><option value="all">全部</option></select></label>
        <label>来源<select v-model="sourceFilter"><option value="">全部来源</option><option v-for="item in sources" :key="item.source" :value="item.source">{{ item.source }}</option></select></label>
        <label>主题<select v-model="topicFilter"><option value="">全部主题</option><option v-for="topic in topics" :key="topic" :value="topic">{{ topic }}</option></select></label>
      </div>
      <p v-if="!visible.length" class="archive-empty">{{ statusFilter === 'archived' ? '还没有已归档的通知。' : '这里还没有通知。保存原文后，它会按来源、主题和时间出现在这里。' }}</p>
      <!--
        档案里每条都带着整段原文，而过去原文是**永远展开**的：列表越长，
        页面上的 DOM 就越多，改一个筛选条件就整份重建一次。
        现在默认折叠（点开仍能看全文），并交给 VirtualList 只渲染视口附近的部分。
      -->
      <VirtualList v-if="visible.length" :items="visible" :item-key="(item) => item.id" :estimated-height="150" :gap="10" :threshold="24" :overscan="4">
        <template #default="{ item }">
        <article class="notice-record">
          <header><div><h3>{{ item.title || '未命名通知' }}</h3><p>{{ item.source || '未注明来源' }} · {{ item.topic || '通知' }} · {{ item.createdAt ? item.createdAt.slice(0, 16).replace('T', ' ') : '时间未知' }}</p></div><span class="notice-status" :class="`status-${item.status}`">{{ { new: '待处理', handled: '已处理', archived: '已归档' }[item.status] }}</span></header>
        <details class="notice-raw"><summary>查看原文</summary><pre>{{ item.raw }}</pre></details>
        <form v-if="offerNoticeId === item.id" class="notice-offer-form" @submit.prevent="saveOfferLink(item)">
          <p>解析结果仅作预填；请确认地点和核销金额后再保存。通知原文仍只保存在本机。</p>
          <label>关联地点<select v-model="offerDraft.placeId" required><option value="">请选择</option><option v-for="place in activePlaces" :key="place.id" :value="place.id">{{ place.name }}</option></select></label>
          <label>优惠名称<input v-model.trim="offerDraft.title" maxlength="60" required /></label>
          <div class="notice-offer-grid"><label>核销实付（元）<input v-model.number="offerDraft.price" type="number" min="0.01" step="0.01" required /></label><label>原价（可选）<input v-model.number="offerDraft.originalPrice" type="number" min="0.01" step="0.01" /></label><label>有效期（可选）<input v-model="offerDraft.expiresAt" type="date" /></label></div>
          <label>说明（最多 50 字）<input v-model.trim="offerDraft.note" maxlength="50" /></label>
          <footer><button class="btn btn-primary" type="submit">确认并关联</button><button class="btn btn-ghost" type="button" @click="cancelOfferLink">取消</button></footer>
        </form>
        <footer>
          <span v-if="item.linkedEntities?.length">已关联{{ item.linkedEntities.map(linkLabel).join('、') }}</span>
          <button type="button" @click="actOnNotice(item)">按这条建待办 / 日程</button>
          <button v-if="offerCandidate(item) && !hasOfferLink(item)" type="button" @click="openOfferLink(item)">{{ activePlaces.length ? '解析并关联地点优惠' : '先添加地点再关联优惠' }}</button>
          <button v-if="hasOfferLink(item)" type="button" @click="router.push('/places')">查看地点优惠</button>
          <button v-if="item.status === 'new'" type="button" @click="changeStatus(item, 'handled')">标记已处理</button>
          <button v-if="item.status !== 'archived'" type="button" @click="changeStatus(item, 'archived')">归档</button>
          <button v-else type="button" @click="changeStatus(item, 'handled')">恢复到已处理</button>
          <button v-if="item.status === 'handled'" type="button" @click="changeStatus(item, 'new')">重新放入待处理</button>
        </footer>
      </article>
        </template>
      </VirtualList>
    </section>
  </div>
</template>

<style scoped>
.notice-archive-page{display:grid;gap:14px}.card{padding:16px;border:1px solid var(--border);border-radius:var(--radius-14);background-color:var(--glass-surface);backdrop-filter:var(--glass-filter);-webkit-backdrop-filter:var(--glass-filter);box-shadow:var(--glass-shadow)}.archive-add h2,.archive-section-title h2{margin:0;font-size:var(--fs-16)}.archive-add label,.archive-filters label{display:flex;flex-direction:column;gap:5px;margin-top:10px;color:var(--muted);font-size:var(--fs-11)}.archive-add input,.archive-add textarea,.archive-filters select{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit}.archive-add textarea{resize:vertical}.archive-add-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}.archive-add-actions p{margin:0;color:var(--muted);font-size:var(--fs-11)}.archive-section-title{display:flex;justify-content:space-between;gap:10px}.archive-section-title p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-11)}.archive-source-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--border)}.archive-source-row:first-of-type{margin-top:10px}.archive-source-row span{display:flex;flex-direction:column;gap:3px}.archive-source-row small{color:var(--muted);font-size:var(--fs-10)}.archive-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}.archive-empty{margin:12px 0 0;padding:16px;border-radius:var(--radius-9);background:var(--bg);color:var(--muted);font-size:var(--fs-12);line-height:1.6}.notice-record{margin-top:10px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-11);background:var(--bg)}.notice-record header{display:flex;justify-content:space-between;gap:12px}.notice-raw{margin:0}.notice-raw summary{cursor:pointer;color:var(--muted);font-size:var(--fs-11)}.notice-raw pre{max-height:240px;overflow:auto;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}.notice-record h3{margin:0;font-size:var(--fs-14)}.notice-record header p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-10)}.notice-status{flex:none;height:max-content;padding:4px 7px;border-radius:var(--radius-pill);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-10)}.status-archived{background:var(--bg-tint);color:var(--muted)}.notice-record pre{margin:10px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:var(--fs-12);line-height:1.6}.notice-record footer{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;margin-top:10px}.notice-record footer span{margin-right:auto;color:var(--muted);font-size:var(--fs-10)}.notice-record footer button{min-height:40px;padding:5px 0;border:0;background:none;color:var(--primary);font:inherit;font-size:var(--fs-11)}.notice-offer-form{display:grid;gap:8px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card)}.notice-offer-form p{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.5}.notice-offer-form label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:var(--fs-11)}.notice-offer-form input,.notice-offer-form select{width:100%;min-height:44px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit}.notice-offer-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.notice-offer-form footer{display:flex;gap:8px;flex-wrap:wrap}.btn{min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-12)}.btn-primary{border-color:var(--primary);background:var(--primary);color:var(--on-primary,#fff)}.btn-ghost{background:transparent}
@media(max-width:520px){.card{padding:13px}.archive-filters{grid-template-columns:1fr}.archive-source-row{align-items:flex-start}.notice-record footer{justify-content:flex-start}.notice-record footer span{flex-basis:100%}}
</style>
