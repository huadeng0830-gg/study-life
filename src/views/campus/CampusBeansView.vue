<script setup>
import { Button } from '../../components/ui/button'
import CampusConfirmDialog from '../../components/campus/CampusConfirmDialog.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { openAccountSection } from '../../composables/accountAuth.js'
import { useCampusBeans } from '../../composables/campusBeans.js'
import { CAMPUS_BEAN_RULES } from '../../composables/campusContentModel.js'
import { useCampusConfirm } from '../../composables/campusConfirm.js'
import { campusDateLabel } from '../../composables/campusFormatting.js'

/**
 * 三两豆页：余额、权益目录、我的权益、兑换与流水。
 *
 * 【为什么单独成页】此前豆只有「收入」侧，界面只有校园总览里一个折叠详情和
 * 账号面板里一段只读余额 —— 用户拿不到任何东西，也没有地方看「兑换到了什么」。
 * 这里把「赚 → 兑换 → 我的权益」三段放在同一页，这是闭环里最缺的那一环。
 */
const { wallet, catalog, owned, ledger, loading, error, notice, redeeming, signedIn,
  contribution, affordable, load, redeem } = useCampusBeans()
const confirm = useCampusConfirm()
const confirmRequest = confirm.pending

const LEDGER_LABELS = { review_award: '校园审核奖励', audit_reversal: '复核调整',
  feedback_award: '建议处理奖励', purchase: '充值入账', redemption: '权益兑换', manual_adjustment: '管理员调整' }
const ledgerType = (item) => LEDGER_LABELS[item.entry_type] || '豆豆变动'
const durationLabel = (item) => (item.durationDays ? `兑换后 ${item.durationDays} 天内有效` : '长期有效')

function askRedeem(item) {
  confirm.ask({
    title: `兑换「${item.title}」？`,
    message: `将扣除 ${item.price} 个贡献豆，现有 ${contribution} 个。${durationLabel(item)}。贡献豆不提现、不转赠，兑换后不能退回。`,
    confirmLabel: '确认兑换',
    onConfirm: () => redeem(item),
  })
}

// 首屏读取由 useCampusBeans 内部对账号的立即监听负责（与 useCampusBeanWallet 同例）；
// 这里再挂一个 onMounted 只会把同一份数据请求两遍。
</script>

<template>
  <CampusLifeLayout title="三两豆" description="参与校园审核与提交建议获得的贡献豆，可以兑换徽章一类的应用内数字权益。不提现、不转赠。">
    <template #default>
      <section class="campus-life-panel beans-panel">
        <div class="beans-heading">
          <div>
            <h2>我的三两豆</h2>
            <p>{{ CAMPUS_BEAN_RULES.summary }}{{ CAMPUS_BEAN_RULES.feedback }}</p>
          </div>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="load()">{{ loading ? '读取中…' : '刷新' }}</button>
        </div>
        <CampusStatusMessages :notice="notice" error="" />
        <CampusStateBlock
          :loading="loading"
          :loaded="Boolean(wallet)"
          :error="error"
          :empty="!signedIn"
          loading-text="正在读取三两豆账本…"
          empty-title="登录后才能查看三两豆"
          empty-description="贡献豆记在账号上；未登录时看不到余额、兑换目录与我的权益。"
          @retry="load()"
        >
          <template #empty>
            <Button v-if="!signedIn" @click="openAccountSection('beans')">登录账号</Button>
            <p v-else class="beans-note">当前还没有上架的权益，等维护者配置后这里会出现可兑换的内容。</p>
          </template>

          <div class="beans-summary">
            <article><span>贡献豆</span><b>{{ contribution }}</b><small>来自校园审核与建议奖励</small></article>
            <article><span>充值豆</span><b>{{ wallet?.purchased ?? 0 }}</b><small>尚未开放充值</small></article>
            <p v-if="wallet?.contributionDebt" class="beans-debt">待抵扣 {{ wallet.contributionDebt }} 豆：复核追回时不足的部分会从后续贡献奖励里抵扣，不影响充值豆。</p>
          </div>

          <h3>权益目录</h3>
          <p v-if="!catalog.length" class="beans-note">当前没有上架权益；你仍可查看已兑换的权益和历史流水。</p>
          <div class="beans-catalog">
            <article v-for="item in catalog" :key="item.code" class="beans-card">
              <div>
                <h4>{{ item.title }}</h4>
                <p v-if="item.description">{{ item.description }}</p>
                <small>{{ durationLabel(item) }}<template v-if="item.stock !== null && item.stock !== undefined"> · 剩余 {{ item.stock }}</template></small>
              </div>
              <div class="beans-card-actions">
                <b>{{ item.price }} 豆</b>
                <Button :disabled="Boolean(redeeming) || !affordable(item)" @click="askRedeem(item)">{{ redeeming === item.code ? '兑换中…' : '兑换' }}</Button>
              </div>
            </article>
          </div>

          <h3>我的权益</h3>
          <p v-if="!owned.length" class="beans-note">还没有兑换记录。用贡献豆换一条试试。</p>
          <div v-else class="beans-owned">
            <article v-for="item in owned" :key="item.id">
              <b>{{ item.title }}</b>
              <small>{{ campusDateLabel(item.createdAt) }} 兑换 · {{ item.expiresAt ? `${campusDateLabel(item.expiresAt)} 到期` : '长期有效' }}</small>
            </article>
          </div>

          <h3>最近变动</h3>
          <p v-if="!ledger.length" class="beans-note">还没有豆豆记录。</p>
          <div v-else class="beans-ledger">
            <article v-for="item in ledger" :key="item.id">
              <div><b>{{ ledgerType(item) }}</b><small>{{ item.reason }} · {{ campusDateLabel(item.created_at) }}</small></div>
              <span :class="{ positive: item.amount > 0, negative: item.amount < 0 }">{{ item.bean_type === 'purchased' ? '充值豆' : '贡献豆' }} {{ item.amount > 0 ? '+' : '' }}{{ item.amount }}</span>
            </article>
          </div>

          <p class="beans-foot">贡献豆不提现、不转赠；充值与支付资质确认前不会收取任何费用。</p>
        </CampusStateBlock>
      </section>
      <CampusConfirmDialog :request="confirmRequest" @confirm="confirm.confirm()" @close="confirm.close()" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.beans-panel{display:grid;gap:16px}
.beans-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.beans-heading h2{margin:0 0 5px}
.beans-heading p{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}
.beans-panel h3{margin:8px 0 0;font-size:var(--fs-14)}
.beans-note,.beans-debt,.beans-foot{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}
.beans-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.beans-summary article{display:grid;gap:4px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}
.beans-summary span{color:var(--muted);font-size:var(--fs-11)}
.beans-summary b{font-size:var(--fs-24);font-variant-numeric:tabular-nums}
.beans-summary small{color:var(--muted);font-size:var(--fs-10)}
.beans-debt{grid-column:1/-1;color:var(--warning)}
.beans-catalog{display:grid;gap:8px}
.beans-card{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-12)}
.beans-card h4{margin:0 0 4px;font-size:var(--fs-14)}
.beans-card p{margin:0 0 4px;color:var(--ink-soft);font-size:var(--fs-12);line-height:1.6}
.beans-card small{color:var(--muted);font-size:var(--fs-10)}
.beans-card-actions{display:flex;align-items:center;gap:10px;flex:none}
.beans-card-actions b{color:var(--primary);font-size:var(--fs-14);font-variant-numeric:tabular-nums;white-space:nowrap}
.beans-owned{display:grid;gap:6px}
.beans-owned article{display:grid;gap:3px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--success) 30%,var(--border));border-radius:var(--radius-10);background:color-mix(in srgb,var(--success) 4%,var(--card))}
.beans-owned b{font-size:var(--fs-13)}
.beans-owned small,.beans-ledger small{color:var(--muted);font-size:var(--fs-10)}
.beans-ledger{display:grid;gap:6px}
.beans-ledger article{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-10)}
.beans-ledger article>div{display:grid;gap:3px;min-width:0}
.beans-ledger b{font-size:var(--fs-12)}
.beans-ledger span{font-size:var(--fs-12);font-variant-numeric:tabular-nums;white-space:nowrap}
.beans-ledger span.positive{color:var(--success)}
.beans-ledger span.negative{color:var(--danger)}
@media(max-width:520px){
  .beans-heading,.beans-card{align-items:flex-start;flex-direction:column}
  .beans-card-actions{width:100%;justify-content:space-between}
}
</style>
