<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { Button } from '../../components/ui/button'
import CampusConfirmDialog from '../../components/campus/CampusConfirmDialog.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { CAMPUS_RESUBMITTABLE_STATUSES, campusStatusLabel, flattenCampusSubmissions } from '../../composables/campusContentModel.js'
import { useCampusConfirm } from '../../composables/campusConfirm.js'
import { campusDateLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeMine, withdrawCampusContent } from '../../services/campusLife.js'

const page = useCampusLifePage()
const confirm = useCampusConfirm()
const confirmRequest = confirm.pending
const withdrawing = ref(false)

watch(() => accountUser.value?.id, () => { confirm.close(); withdrawing.value = false }, { flush: 'sync' })

const items = computed(() => flattenCampusSubmissions(page.data.value))
const canResubmit = (item) => CAMPUS_RESUBMITTABLE_STATUSES.includes(item.status) && Boolean(item.resubmitType || item.domainKey === 'courseReviews')

async function refresh() { return page.load(campusLifeMine) }

function askWithdraw(item) {
  confirm.ask({
    title: '撤回这条校园内容？',
    message: `撤回「${item.title}」后，同学们将无法在公开列表查看，审核员也不再处理此版本。之后仍可修改并重新提交审核。`,
    confirmLabel: '确认撤回',
    tone: 'danger',
    onConfirm: () => withdraw(item),
  })
}

async function withdraw(item) {
  if (withdrawing.value) return
  withdrawing.value = true
  const ok = await page.act(() => withdrawCampusContent(item.targetType, item.id, item.revision), '内容已撤回，已退出公开展示或待审队列。')
  withdrawing.value = false
  if (ok) await refresh()
}

onMounted(() => { void refresh() })
</script>

<template>
  <CampusLifeLayout title="我的校园投稿" description="集中查看自己提交的校园内容与审核结果。公开审核不代表学校或商户身份认证。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-mine-heading"><div><h2>投稿记录</h2><p>发布 → 等待审核 → 公开展示。退回后可修改重提；每类显示最近 100 条记录。</p></div><button class="btn btn-ghost" type="button" :disabled="page.loading.value" @click="refresh()">{{ page.loading.value ? '读取中…' : '刷新' }}</button></div>
        <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!items.length"
          loading-text="正在读取你的校园投稿…"
          empty-title="你的校园分享，从这里开始"
          empty-description="发布后的内容和审核进度会集中显示在这里。"
          empty-action="去发布"
          empty-to="/campus/publish"
          @retry="refresh()"
        >
          <div class="campus-mine-list">
            <article v-for="item in items" :key="item.key" class="campus-mine-row">
              <div><span class="campus-life-tag">{{ item.label }}</span><h3>{{ item.title }}</h3><p v-if="item.reason" class="campus-mine-reason">处理说明：{{ item.reason }}</p><small v-if="campusDateLabel(item.date)">更新于 {{ campusDateLabel(item.date) }}</small></div>
              <div class="campus-life-actions"><b>{{ campusStatusLabel(item.status) }}</b><Button v-if="item.canWithdraw" variant="ghost" :disabled="withdrawing" @click="askWithdraw(item)">撤回</Button><RouterLink class="text-button" :to="item.route">查看模块</RouterLink><RouterLink v-if="canResubmit(item) && item.resubmitType" class="text-button" :to="{ path: '/campus/publish', query: { editType: item.resubmitType, id: item.id } }">修改并重新提交</RouterLink><RouterLink v-else-if="canResubmit(item)" class="text-button" :to="item.route">修改课程评价</RouterLink></div>
            </article>
          </div>
        </CampusStateBlock>
      </section>
      <CampusConfirmDialog :request="confirmRequest" @confirm="confirm.confirm()" @close="confirm.close()" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-mine-heading,.campus-mine-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-mine-heading p{margin:5px 0 0;color:var(--muted)}.campus-mine-list{display:grid;gap:8px}.campus-mine-row{padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-mine-row h3{margin:6px 0}.campus-mine-row small{color:var(--muted)}.campus-mine-reason{color:var(--danger);overflow-wrap:anywhere}@media(max-width:520px){.campus-mine-heading,.campus-mine-row{align-items:flex-start;flex-direction:column}}
</style>