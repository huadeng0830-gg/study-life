<script setup>
import { onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import CampusPrivateChat from '../../components/campus/CampusPrivateChat.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import {
  campusLifeMine, campusMarketListings, createMarketInterest, decideMarketInterest,
  listMarketInterests, updateMarketListingStatus,
} from '../../services/campusLife.js'

const page = useCampusLifePage()
const contactId = ref('')
const contactNote = ref('')
const chat = ref(null)
const busyId = ref('')

async function refresh() {
  return page.load(async () => {
    const [publicResult, interestResult, mineResult] = await Promise.all([campusMarketListings(), listMarketInterests(), campusLifeMine()])
    return { listings: publicResult.listings || [], interests: interestResult.interests || [], mine: mineResult.listings || [] }
  })
}
onMounted(() => { void refresh() })

function typeLabel(type) { return ({ sale: '出售', wanted: '求购', free: '免费赠送' })[type] || '二手信息' }
function statusLabel(status, listingType = 'sale') { return ({ pending_review: '待审核', active: '公开中', reserved: listingType === 'wanted' ? '已匹配' : '已预留', sold: listingType === 'wanted' ? '已完成撮合' : '已成交', withdrawn: '已下架', rejected: '审核未通过', pending: '待联系', accepted: listingType === 'wanted' ? '已匹配' : '已接受', rejected_interest: '已拒绝', closed: '已关闭' })[status] || status }
function priceLabel(row) {
  if (row.listing_type === 'free') return '免费'
  if (row.price_cents === null || row.price_cents === undefined) return row.listing_type === 'wanted' ? '求购价格可协商' : '价格待补充'
  return `¥${(Number(row.price_cents) / 100).toFixed(2)}`
}
function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}
async function openContact(listingId) {
  contactId.value = contactId.value === listingId ? '' : listingId
  contactNote.value = ''
}
async function sendInterest(listing) {
  busyId.value = listing.id
  await page.act(() => createMarketInterest(listing.id, contactNote.value), '联系意向已发送。发布者接受后可在私信中沟通交接。')
  contactId.value = ''
  contactNote.value = ''
  busyId.value = ''
  await refresh()
}
async function decide(interest, decision) {
  busyId.value = interest.id
  const result = await page.act(() => decideMarketInterest(interest.listing_id, interest.id, decision), decision === 'accept' ? '已预留给该同学。' : '已处理联系意向。')
  busyId.value = ''
  if (result) await refresh()
}
async function updateStatus(listing, status) {
  busyId.value = listing.id
  const result = await page.act(() => updateMarketListingStatus(listing.id, status), status === 'sold' ? '商品已标记为成交。' : '商品已下架。')
  busyId.value = ''
  if (result) await refresh()
}
function openChat(interest) {
  if (!interest.counterpartId) return
  chat.value = { targetType: 'market_listing', targetId: interest.listing_id, recipientId: interest.counterpartId, recipientName: interest.counterpart }
}
</script>

<template>
  <CampusLifeLayout title="校园二手集市" description="出售、求购和免费赠送都在这里完成意向撮合。线下公共区域见面，不经平台收款。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-market-heading"><div><h2>同校集市</h2><p>仅展示审核通过且仍在售或已预留的信息；不支持平台支付。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=market">发布商品</RouterLink></div>
        <p v-if="page.loading.value && !page.data.value" class="campus-life-state" role="status">正在读取二手信息…</p>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <p v-else-if="!page.data.value?.listings?.length" class="campus-life-state">当前学校没有可浏览的在售商品。提交后会先进入审核队列。</p>
        <div v-else class="campus-life-grid">
          <article v-for="listing in page.data.value.listings" :key="listing.id" class="campus-life-card">
            <div class="campus-life-meta"><span class="campus-life-tag">{{ typeLabel(listing.listing_type) }}</span><span>{{ listing.category }}</span><span v-if="listing.campus">{{ listing.campus }}</span></div>
            <h3>{{ listing.title }}</h3><strong class="campus-market-price">{{ priceLabel(listing) }}</strong>
            <p>{{ listing.description || '发布者尚未补充详细说明。' }}</p>
            <p class="campus-life-meta"><span v-if="listing.condition">{{ listing.condition }}</span><span v-if="listing.meetup_area">面交区域：{{ listing.meetup_area }}</span><span>{{ dateLabel(listing.created_at) }}</span></p>
            <span v-if="listing.status === 'reserved'" class="campus-life-tag">已预留</span>
            <CampusContentActions target-type="market_listing" :target-id="listing.id" />
            <div v-if="listing.status === 'active'" class="campus-life-actions"><button class="btn btn-ghost" type="button" @click="openContact(listing.id)">{{ contactId === listing.id ? '收起' : '联系 / 表达意向' }}</button></div>
            <form v-if="contactId === listing.id" class="campus-market-interest-form" @submit.prevent="sendInterest(listing)"><label>给发布者留言（不要填写私人联系方式）<textarea v-model="contactNote" maxlength="500" placeholder="例如：我想在图书馆大厅当面交易" /></label><button class="btn btn-primary" type="submit" :disabled="busyId === listing.id">{{ busyId === listing.id ? '发送中…' : '发送联系意向' }}</button></form>
          </article>
        </div>
      </section>

      <section v-if="page.data.value?.interests?.length" class="campus-life-panel">
        <h2>联系意向</h2><p>双方的联系只对当前商品参与者开放。</p>
        <div class="campus-market-interest-list">
          <article v-for="interest in page.data.value.interests" :key="`${interest.perspective}:${interest.id}`" class="campus-market-interest-row">
            <div><b>{{ interest.listingTitle }}</b><p>{{ interest.perspective === 'seller' ? `${interest.counterpart} ${interest.listingType === 'wanted' ? '可以提供' : '想联系你'}` : `${interest.listingType === 'wanted' ? '求购者' : '发布者'}：${interest.counterpart}` }} · {{ statusLabel(interest.status, interest.listingType) }}</p><small>{{ interest.message || '没有附加说明' }}</small></div>
            <div class="campus-life-actions">
              <button v-if="interest.perspective === 'seller' && interest.status === 'pending'" class="btn btn-primary" type="button" :disabled="busyId === interest.id" @click="decide(interest, 'accept')">{{ interest.listingType === 'wanted' ? '确认匹配' : '接受并预留' }}</button>
              <button v-if="interest.perspective === 'seller' && interest.status === 'pending'" class="btn btn-ghost" type="button" :disabled="busyId === interest.id" @click="decide(interest, 'reject')">拒绝</button>
              <button v-if="['pending','accepted'].includes(interest.status) && interest.counterpartId" class="btn btn-ghost" type="button" @click="openChat(interest)">私信</button>
            </div>
          </article>
        </div>
      </section>

      <section v-if="page.data.value?.mine?.length" class="campus-life-panel">
        <h2>我发布的</h2>
        <div class="campus-market-interest-list"><article v-for="listing in page.data.value.mine" :key="listing.id" class="campus-market-interest-row"><div><b>{{ listing.title }}</b><p>{{ typeLabel(listing.listing_type) }} · {{ statusLabel(listing.status, listing.listing_type) }} · {{ priceLabel(listing) }}<span v-if="listing.review_reason"> · {{ listing.review_reason }}</span></p></div><div class="campus-life-actions"><button v-if="listing.status === 'reserved'" class="btn btn-primary" type="button" :disabled="busyId === listing.id" @click="updateStatus(listing, 'sold')">{{ listing.listing_type === 'wanted' ? '完成撮合' : '确认成交' }}</button><button v-if="['active','reserved'].includes(listing.status)" class="btn btn-ghost" type="button" :disabled="busyId === listing.id" @click="updateStatus(listing, 'withdrawn')">下架</button></div></article></div>
      </section>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
      <CampusPrivateChat v-if="chat" v-bind="chat" @close="chat = null" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-market-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-market-heading p{margin:5px 0 0;color:var(--muted)}.campus-market-price{font-size:20px;color:var(--primary)}.campus-market-interest-form{display:grid;gap:8px;padding-top:10px}.campus-market-interest-form label{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-market-interest-form textarea{min-height:66px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}.campus-market-interest-list{display:grid;gap:8px}.campus-market-interest-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-market-interest-row p,.campus-market-interest-row small{display:block;margin:4px 0;color:var(--muted)}@media(max-width:520px){.campus-market-heading,.campus-market-interest-row{align-items:flex-start;flex-direction:column}}
</style>
