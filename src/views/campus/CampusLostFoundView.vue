<script setup>
import { computed, onMounted, ref } from 'vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import CampusDirectoryFilter from '../../components/campus/CampusDirectoryFilter.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import CampusPrivateChat from '../../components/campus/CampusPrivateChat.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeMine, campusLostFound, decideLostFoundClaim, listLostFoundClaims, submitLostFoundClaim } from '../../services/campusLife.js'

const page = useCampusLifePage()
const query = ref('')
const category = ref('')
const filterOptions = [{ value: 'found', label: '我捡到了' }, { value: 'lost', label: '我丢了' }]
const visible = computed(() => (page.data.value?.items || []).filter((item) => (!category.value || item.mode === category.value) && (!query.value.trim() || [item.title, item.description, item.approximate_location].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(query.value.trim().toLocaleLowerCase('zh-CN')))))

const claimTarget = ref('')
const privateEvidence = ref('')
const busyId = ref('')
const chat = ref(null)

async function refresh() {
  return page.load(async () => {
    const [publicResult, claimResult, mineResult] = await Promise.all([campusLostFound(), listLostFoundClaims(), campusLifeMine()])
    return { items: publicResult.items || [], claims: claimResult.claims || [], ownClaims: claimResult.ownClaims || [], mine: mineResult.lostFound || [] }
  })
}
onMounted(() => { void refresh() })

const statusLabels = { pending_review: '待审核', open: '等待认领', claim_pending: '认领待确认', returned: '已归还', closed: '已归档', rejected: '审核未通过', pending: '待核验', approved: '已确认', withdrawn: '已撤回' }
const typeLabels = { lost: '我丢了', found: '我捡到了' }
const categoryLabels = { electronics: '电子设备', card: '校园卡', keys: '钥匙', documents: '证件 / 文件', clothing: '衣物', bag: '包袋', other: '其他' }
function dateLabel(value) { return value ? String(value).slice(0, 10) : '日期未填写' }
function openClaim(item) {
  const same = claimTarget.value === item.id
  claimTarget.value = same ? '' : item.id
  // Private evidence must never carry over from a different item.
  privateEvidence.value = ''
}
async function submitClaim(item) {
  busyId.value = item.id
  const result = await page.act(() => submitLostFoundClaim(item.id, privateEvidence.value), '认领申请已私密送达发布者。')
  busyId.value = ''
  if (result) { claimTarget.value = ''; privateEvidence.value = ''; await refresh() }
}
async function decide(claim, decision) {
  busyId.value = claim.id
  const result = await page.act(() => decideLostFoundClaim(claim.id, decision), decision === 'approve' ? '已确认认领并归档物品。' : '已拒绝该认领申请。')
  busyId.value = ''
  if (result) await refresh()
}
function openChat(targetType, targetId, recipientId, recipientName) {
  chat.value = { targetType, targetId, recipientId, recipientName }
}
</script>

<template>
  <CampusLifeLayout title="失物招领" description="公开页面只展示大致地点与非敏感描述；认领核验特征只对物品发布者开放。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-lost-heading"><div><h2>同校失物信息</h2><p>提交后由平台审核；认领时请提供没有公开展示的特征。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=lost">发布失物信息</RouterLink></div>
        <CampusDirectoryFilter v-if="page.data.value" v-model:query="query" v-model:category="category" :options="filterOptions" :count="visible.length" placeholder="搜索物品名称、特征或地点" />
        <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取失物信息…</CampusLoadingState>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <CampusEmptyState v-else-if="!visible.length" :title="query || category ? '没有找到匹配内容' : '还没有公开的失物信息'" :description="query || category ? '换个关键词，或清除筛选看看。' : '丢了东西或捡到物品，都可以在这里留下线索。'" :action="query || category ? '' : '发布失物信息'" to="/campus/publish?kind=lost" />
        <div v-else class="campus-life-grid">
          <article v-for="item in visible" :key="item.id" class="campus-life-card">
            <div class="campus-life-meta"><span class="campus-life-tag">{{ typeLabels[item.mode] }}</span><span>{{ categoryLabels[item.category] }}</span><span>{{ statusLabels[item.status] }}</span></div>
            <h3>{{ item.title }}</h3><p>{{ item.description || '暂未补充公开描述。' }}</p><p class="campus-life-meta"><span>{{ item.approximate_location || '大致地点未填写' }}</span><span>{{ dateLabel(item.occurred_at) }}</span><span v-if="item.campus">{{ item.campus }}</span></p>
            <p v-if="item.category === 'card' || item.category === 'documents'" class="campus-life-inline-state">请不要在公开页面或私信中发送完整证件号码。</p>
            <CampusContentActions target-type="lost_found" :target-id="item.id" />
            <button v-if="claimTarget !== item.id" class="btn btn-ghost" type="button" @click="openClaim(item)">申请认领</button>
            <form v-if="claimTarget === item.id" class="campus-lost-claim-form" @submit.prevent="submitClaim(item)"><label>填写未公开的核验特征（至少 10 个字，仅发布者可见）<textarea v-model="privateEvidence" minlength="10" maxlength="1000" required placeholder="请描述物品上没有公开的标记、内容或其他特征。" /></label><div class="campus-life-actions"><button class="btn btn-primary" type="submit" :disabled="busyId === item.id">提交认领</button><button class="btn btn-ghost" type="button" @click="claimTarget = ''">取消</button></div></form>
          </article>
        </div>
      </section>

      <section v-if="page.data.value?.claims?.length" class="campus-life-panel"><h2>收到的认领申请</h2><div class="campus-lost-list"><article v-for="claim in page.data.value.claims" :key="claim.id" class="campus-lost-row"><div><b>{{ claim.claimant }} · {{ statusLabels[claim.status] }}</b><p>私密核验信息：{{ claim.private_evidence }}</p><small>仅展示给该物品发布者</small></div><div class="campus-life-actions"><button v-if="claim.status === 'pending'" class="btn btn-primary" type="button" :disabled="busyId === claim.id" @click="decide(claim, 'approve')">确认归还</button><button v-if="claim.status === 'pending'" class="btn btn-ghost" type="button" :disabled="busyId === claim.id" @click="decide(claim, 'reject')">信息不符</button><button v-if="['pending','approved'].includes(claim.status)" class="btn btn-ghost" type="button" @click="openChat('lost_found', claim.item_id, claim.claimant_id, claim.claimant)">私密联系</button></div></article></div></section>

      <section v-if="page.data.value?.ownClaims?.length" class="campus-life-panel"><h2>我提交的认领</h2><div class="campus-lost-list"><article v-for="claim in page.data.value.ownClaims" :key="claim.id" class="campus-lost-row"><div><b>{{ claim.itemTitle }}</b><p>{{ statusLabels[claim.status] || claim.status }}</p></div><button v-if="['pending','approved'].includes(claim.status) && claim.ownerId" class="btn btn-ghost" type="button" @click="openChat('lost_found', claim.item_id, claim.ownerId, claim.ownerName)">私密联系发布者</button></article></div></section>

      <section v-if="page.data.value?.mine?.length" class="campus-life-panel"><h2>我发布的失物信息</h2><div class="campus-lost-list"><article v-for="item in page.data.value.mine" :key="item.id" class="campus-lost-row"><b>{{ item.title }}</b><span>{{ statusLabels[item.status] || item.status }}<template v-if="item.review_reason"> · {{ item.review_reason }}</template></span></article></div><p class="campus-life-inline-state">完成认领后会自动归档，敏感历史不再显示在公开列表。</p></section>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
      <CampusPrivateChat v-if="chat" v-bind="chat" @close="chat = null" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-lost-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-lost-heading p{margin:5px 0 0;color:var(--muted)}.campus-lost-claim-form{display:grid;gap:8px}.campus-lost-claim-form label{display:grid;gap:5px;color:var(--muted);font-size:12px}.campus-lost-claim-form textarea{min-height:85px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}.campus-lost-list{display:grid;gap:8px}.campus-lost-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-lost-row p,.campus-lost-row small{display:block;margin:4px 0;color:var(--muted)}@media(max-width:520px){.campus-lost-heading,.campus-lost-row{align-items:flex-start;flex-direction:column}}
</style>
