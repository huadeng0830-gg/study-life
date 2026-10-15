<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import CampusConfirmDialog from '../../components/campus/CampusConfirmDialog.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import CampusDirectoryFilter from '../../components/campus/CampusDirectoryFilter.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusPrivateChat from '../../components/campus/CampusPrivateChat.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { useCampusConfirm } from '../../composables/campusConfirm.js'
import { campusMonthDayLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import {
  campusLifeMine, campusMarketListings, createMarketInterest, decideMarketInterest,
  listMarketInterests, updateMarketListingStatus, withdrawMarketInterest,
} from '../../services/campusLife.js'

const page = useCampusLifePage()
const confirm = useCampusConfirm()
// 模板会自动解包顶层 ref，取出来一次就好过在模板里写 confirm.pending.value
const confirmRequest = confirm.pending
const busy = useCampusRequest()

const query = ref('')
const category = ref('')
const filterOptions = [{ value: 'free', label: '赠送' }, { value: 'sale', label: '出售' }, { value: 'wanted', label: '求购' }]
const visible = computed(() => (page.data.value?.listings || []).filter((item) => (!category.value || item.listing_type === category.value) && (!query.value.trim() || [item.title, item.description, item.condition, item.meetup_area].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query.value.trim().toLocaleLowerCase('zh-CN')))))
const filtered = computed(() => Boolean(query.value.trim() || category.value))

const contactId = ref('')
const contactNote = ref('')
const chat = ref(null)
const busyId = ref('')
// 切换账号时一并收起展开的表单：这里展示的是上一个账号的留言与操作目标。
watch(() => accountUser.value?.id, () => { contactId.value = ''; contactNote.value = ''; busyId.value = '' }, { flush: 'sync' })

async function refresh() {
  return page.load(async () => {
    const [publicResult, interestResult, mineResult] = await Promise.all([campusMarketListings(), listMarketInterests(), campusLifeMine()])
    return { listings: publicResult.listings || [], interests: interestResult.interests || [], mine: mineResult.listings || [] }
  })
}
onMounted(() => { void refresh() })

function typeLabel(type) { return ({ sale: '出售', wanted: '求购', free: '免费赠送' })[type] || '二手信息' }

// 「已预留 / 已成交」在求购单上的含义和出售单不同，所以按发布方式再分一次。
const STATUS_BY_TYPE = {
  sale: { reserved: '已预留', sold: '已成交', accepted: '已接受' },
  wanted: { reserved: '已匹配', sold: '已完成撮合', accepted: '已匹配' },
}
const STATUS_LABELS = {
  pending_review: '待审核', active: '公开中', withdrawn: '已下架', rejected: '审核未通过',
  pending: '待联系', rejected_interest: '已拒绝', closed: '已关闭',
}
function statusLabel(status, listingType = 'sale') { return STATUS_BY_TYPE[listingType]?.[status] || STATUS_LABELS[status] || status }

function priceLabel(row) {
  if (row.listing_type === 'free') return '免费'
  if (row.price_cents === null || row.price_cents === undefined) return row.listing_type === 'wanted' ? '求购价格可协商' : '价格待补充'
  return `¥${(Number(row.price_cents) / 100).toFixed(2)}`
}

function openContact(listingId) {
  contactId.value = contactId.value === listingId ? '' : listingId
  // One shared note field; clear it when the open form changes target.
  contactNote.value = ''
}

async function sendInterest(listing) {
  const revision = busy.begin()
  busyId.value = listing.id
  const ok = await page.act(() => createMarketInterest(listing.id, contactNote.value), '联系意向已发送。发布者接受后可在私信中沟通交接。')
  if (busy.live(revision)) busyId.value = ''
  if (ok) { contactId.value = ''; contactNote.value = ''; await refresh() }
}

function askDecideInterest(interest, decision) {
  const accepting = decision === 'accept'
  confirm.ask({
    title: accepting ? '接受这条联系意向？' : '拒绝这条联系意向？',
    message: accepting
      ? `接受后会为「${interest.listingTitle}」预留该同学，请尽快在私信中约定交接时间和地点。`
      : '拒绝后对方不会收到新的通知，这条意向会记为已处理。',
    confirmLabel: accepting ? (interest.listingType === 'wanted' ? '确认匹配' : '接受并预留') : '拒绝',
    tone: accepting ? 'primary' : 'danger',
    onConfirm: () => decide(interest, decision),
  })
}

async function decide(interest, decision) {
  busyId.value = interest.id
  const ok = await page.act(() => decideMarketInterest(interest.listing_id, interest.id, decision), decision === 'accept' ? '已预留给该同学。' : '已处理联系意向。')
  busyId.value = ''
  if (ok) await refresh()
}

// 之前买家用不了「撤回」：接口存在、页面没有入口，只能等对方处理。
function askWithdrawInterest(interest) {
  confirm.ask({
    title: '撤回这条联系意向？',
    message: `撤回后「${interest.listingTitle}」的发布者不会看到你的留言，你也可以重新发起一次。`,
    confirmLabel: '撤回意向',
    tone: 'danger',
    onConfirm: async () => {
      busyId.value = interest.id
      const ok = await page.act(() => withdrawMarketInterest(interest.id), '联系意向已撤回。')
      busyId.value = ''
      if (ok) await refresh()
    },
  })
}

function askUpdateStatus(listing, status) {
  const selling = listing.listing_type !== 'wanted'
  confirm.ask({
    title: selling ? '确认成交？' : '完成撮合？',
    message: status === 'sold'
      ? `「${listing.title}」将标记为${selling ? '已成交' : '撮合完成'}并停止接受新的联系意向。标记之后无法自行改回在售。`
      : `「${listing.title}」将下架并停止接受新的联系意向，已发出的私信不受影响。`,
    confirmLabel: status === 'sold' ? (selling ? '确认成交' : '完成撮合') : '下架',
    onConfirm: async () => {
      busyId.value = listing.id
      const ok = await page.act(() => updateMarketListingStatus(listing.id, status), status === 'sold' ? '商品已标记为成交。' : '商品已下架。')
      busyId.value = ''
      if (ok) await refresh()
    },
  })
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
        <CampusDirectoryFilter v-if="page.data.value" v-model:query="query" v-model:category="category" :options="filterOptions" :count="visible.length" placeholder="搜索物品、描述或交易地点" />
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!visible.length"
          loading-text="正在读取二手信息…"
          :empty-title="filtered ? '没有找到匹配内容' : '还没有可浏览的二手信息'"
          :empty-description="filtered ? '换个关键词，或清除筛选看看。' : '出售、求购或赠送闲置物品，审核后就会显示在这里。'"
          :empty-action="filtered ? '' : '发布二手信息'"
          :empty-to="filtered ? '' : '/campus/publish?kind=market'"
          @retry="refresh()"
        >
          <div class="campus-life-grid">
            <article v-for="listing in visible" :key="listing.id" class="campus-life-card">
              <div class="campus-life-meta"><span class="campus-life-tag">{{ typeLabel(listing.listing_type) }}</span><span>{{ listing.category }}</span><span v-if="listing.campus">{{ listing.campus }}</span></div>
              <h3>{{ listing.title }}</h3><strong class="campus-market-price">{{ priceLabel(listing) }}</strong>
              <p>{{ listing.description || '发布者尚未补充详细说明。' }}</p>
              <p class="campus-life-meta"><span v-if="listing.condition">{{ listing.condition }}</span><span v-if="listing.meetup_area">面交区域：{{ listing.meetup_area }}</span><span>{{ campusMonthDayLabel(listing.created_at) }}</span></p>
              <span v-if="listing.status === 'reserved'" class="campus-life-tag">已预留</span>
              <CampusContentActions target-type="market_listing" :target-id="listing.id" />
              <div v-if="listing.status === 'active'" class="campus-life-actions"><button class="btn btn-ghost" type="button" @click="openContact(listing.id)">{{ contactId === listing.id ? '收起' : '联系 / 表达意向' }}</button></div>
              <form v-if="contactId === listing.id" class="campus-market-interest-form" @submit.prevent="sendInterest(listing)"><label>给发布者留言（不要填写私人联系方式）<textarea v-model="contactNote" maxlength="500" placeholder="例如：我想在图书馆大厅当面交易" /></label><button class="btn btn-primary" type="submit" :disabled="busyId === listing.id">{{ busyId === listing.id ? '发送中…' : '发送联系意向' }}</button></form>
            </article>
          </div>
        </CampusStateBlock>
      </section>

      <section v-if="page.data.value?.interests?.length" class="campus-life-panel">
        <h2>联系意向</h2><p>双方的联系只对当前商品参与者开放。</p>
        <div class="campus-market-interest-list">
          <article v-for="interest in page.data.value.interests" :key="`${interest.perspective}:${interest.id}`" class="campus-market-interest-row">
            <div><b>{{ interest.listingTitle }}</b><p>{{ interest.perspective === 'seller' ? `${interest.counterpart} ${interest.listingType === 'wanted' ? '可以提供' : '想联系你'}` : `${interest.listingType === 'wanted' ? '求购者' : '发布者'}：${interest.counterpart}` }} · {{ statusLabel(interest.status, interest.listingType) }}</p><small>{{ interest.message || '没有附加说明' }}</small></div>
            <div class="campus-life-actions">
              <template v-if="interest.perspective === 'seller' && interest.status === 'pending'">
                <button class="btn btn-primary" type="button" :disabled="busyId === interest.id" @click="askDecideInterest(interest, 'accept')">{{ interest.listingType === 'wanted' ? '确认匹配' : '接受并预留' }}</button>
                <button class="btn btn-ghost" type="button" :disabled="busyId === interest.id" @click="askDecideInterest(interest, 'reject')">拒绝</button>
              </template>
              <button v-if="interest.perspective !== 'seller' && interest.status === 'pending'" class="btn btn-ghost" type="button" :disabled="busyId === interest.id" @click="askWithdrawInterest(interest)">撤回意向</button>
              <button v-if="['pending','accepted'].includes(interest.status) && interest.counterpartId" class="btn btn-ghost" type="button" @click="openChat(interest)">私信</button>
            </div>
          </article>
        </div>
      </section>

      <section v-if="page.data.value?.mine?.length" class="campus-life-panel">
        <h2>我发布的</h2>
        <div class="campus-market-interest-list"><article v-for="listing in page.data.value.mine" :key="listing.id" class="campus-market-interest-row"><div><b>{{ listing.title }}</b><p>{{ typeLabel(listing.listing_type) }} · {{ statusLabel(listing.status, listing.listing_type) }} · {{ priceLabel(listing) }}<span v-if="listing.review_reason"> · {{ listing.review_reason }}</span></p></div><div class="campus-life-actions"><button v-if="listing.status === 'reserved'" class="btn btn-primary" type="button" :disabled="busyId === listing.id" @click="askUpdateStatus(listing, 'sold')">{{ listing.listing_type === 'wanted' ? '完成撮合' : '确认成交' }}</button><button v-if="['active','reserved'].includes(listing.status)" class="btn btn-ghost" type="button" :disabled="busyId === listing.id" @click="askUpdateStatus(listing, 'withdrawn')">下架</button></div></article></div>
      </section>
      <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
      <CampusPrivateChat v-if="chat" v-bind="chat" @close="chat = null" />
      <CampusConfirmDialog :request="confirmRequest" @confirm="confirm.confirm()" @close="confirm.close()" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-market-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-market-heading p{margin:5px 0 0;color:var(--muted)}.campus-market-price{font-size:20px;color:var(--primary)}.campus-market-interest-form{display:grid;gap:8px;padding-top:10px}.campus-market-interest-form label{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-market-interest-form textarea{min-height:66px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}.campus-market-interest-list{display:grid;gap:8px}.campus-market-interest-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-market-interest-row p,.campus-market-interest-row small{display:block;margin:4px 0;color:var(--muted)}@media(max-width:520px){.campus-market-heading,.campus-market-interest-row{align-items:flex-start;flex-direction:column}}
</style>