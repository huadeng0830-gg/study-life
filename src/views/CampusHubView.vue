<script setup>
import { computed } from 'vue'
import { ArrowRight, ClipboardList, Compass, Flag, NotebookPen, Search } from '@lucide/vue'
import CampusLifeLayout from '../components/campus/CampusLifeLayout.vue'
import { CAMPUS_FEATURED_PATHS, CAMPUS_NON_SERVICE_PATHS, campusNavigationGrouped } from '../components/campus/navigation.js'
import { openAccountSection } from '../composables/accountAuth.js'
import { useCampusBeanWallet } from '../composables/campusBeanWallet.js'
import { CAMPUS_BEAN_RULES } from '../composables/campusContentModel.js'

const featuredLinks = [
  { path: '/campus/matters', label: '校园交流', detail: '提问、分享经历，也可以只发布一条内容', icon: Compass },
  { path: '/campus/publish', label: '统一发布', detail: '发布校园指南、活动、互助、失物等信息', icon: NotebookPen },
  { path: '/campus/mine', label: '我的投稿', detail: '跟进审核意见和发布状态', icon: ClipboardList },
  { path: '/campus/reports', label: '我的举报', detail: '查看举报受理与处理结果', icon: Flag },
]
// 常用入口和服务分类来自同一张导航表：每条导航只在页面上出现一次。
const serviceGroups = computed(() => campusNavigationGrouped({ exclude: [...CAMPUS_FEATURED_PATHS, ...CAMPUS_NON_SERVICE_PATHS] }))
const { wallet, loading: beanLoading, error: beanError, signedIn } = useCampusBeanWallet()
function openBeanAccount() { openAccountSection('beans') }
</script>

<template>
  <CampusLifeLayout title="校园生活" description="查找同校信息、参与互助、发布内容，也可以直接告诉我们校园服务哪里需要改进。" :show-quick-links="false">
    <div class="campus-hub">
      <section class="campus-hub-hero" aria-labelledby="campus-hub-title">
        <div>
          <span class="campus-hub-kicker">同校信息 · 一起共建</span>
          <h2 id="campus-hub-title">校园里要找的、想说的，都从这里开始。</h2>
          <p>查看校园指南、课程出行、活动和同校互助；发布前会经过审核。</p>
        </div>
        <RouterLink class="campus-hub-search" to="/campus/search"><Search aria-hidden="true" /><span>搜索校园内容</span><ArrowRight aria-hidden="true" /></RouterLink>
      </section>



      <section class="campus-hub-featured" aria-labelledby="campus-hub-featured-title">
        <div class="campus-hub-section-heading section-heading"><div><h2 id="campus-hub-featured-title">常用入口</h2><p>分享或提问，再发布校园信息，跟进自己的内容和举报。</p></div></div>
        <div class="campus-hub-feature-grid">
          <RouterLink v-for="item in featuredLinks" :key="item.path" :to="item.path" class="campus-hub-feature">
            <span class="campus-hub-icon"><component :is="item.icon" aria-hidden="true" /></span>
            <span class="campus-hub-feature-copy"><b>{{ item.label }}</b><small>{{ item.detail }}</small></span>
            <ArrowRight class="campus-hub-arrow" aria-hidden="true" />
          </RouterLink>
        </div>
      </section>

      <section class="campus-hub-services" aria-labelledby="campus-hub-services-title">
        <div class="campus-hub-section-heading section-heading"><div><h2 id="campus-hub-services-title">浏览校园服务</h2><p>按学习出行和校园日常分类，快速找到对应功能。</p></div></div>
        <section v-for="group in serviceGroups" :key="group.label" class="campus-hub-service-group" :aria-label="group.label">
          <h3>{{ group.label }}</h3>
          <div class="campus-hub-service-grid content-grid">
            <RouterLink v-for="item in group.items" :key="item.path" :to="item.path" class="campus-hub-service">
              <span class="campus-hub-icon"><component :is="item.icon" aria-hidden="true" /></span>
              <span class="campus-hub-feature-copy"><b>{{ item.label }}</b><small>{{ item.detail || '查看同校信息与相关服务' }}</small></span>
              <ArrowRight class="campus-hub-arrow" aria-hidden="true" />
            </RouterLink>
          </div>
        </section>
      </section>
      <details class="campus-hub-beans" aria-labelledby="campus-hub-beans-title">
        <summary>校园贡献与三两豆 <span>查看余额、奖励与参与规则</span><span aria-hidden="true">⌄</span></summary>
        <div class="campus-hub-beans-head"><div><span class="campus-hub-beans-mark" aria-hidden="true">豆</span><div><h2 id="campus-hub-beans-title">三两豆</h2><p>校园贡献奖励，余额与获取方式一眼可见。</p></div></div><button type="button" class="campus-hub-beans-account" @click="openBeanAccount">{{ signedIn ? '我的三两豆账本' : '登录查看余额' }}<ArrowRight aria-hidden="true" /></button></div>
        <div class="campus-hub-beans-body">
          <div class="campus-hub-beans-balance" aria-live="polite">
            <span>当前可用贡献豆</span>
            <strong v-if="beanLoading">读取中…</strong>
            <strong v-else-if="beanError">暂不可用</strong>
            <strong v-else-if="signedIn">{{ wallet?.contribution ?? 0 }}<small>豆</small></strong>
            <strong v-else>登录后查看</strong>
            <small v-if="wallet?.contributionDebt">待抵扣 {{ wallet.contributionDebt }} 豆；仅从后续贡献奖励中抵扣。</small>
            <small v-else-if="!signedIn">登录后可查看自己的贡献余额。</small>
            <small v-else-if="beanError">{{ beanError }}</small>
          </div>
          <div class="campus-hub-beans-ways">
            <div><b>参与校园审核</b><p>{{ CAMPUS_BEAN_RULES.summary }}</p></div>
            <div><b>提交反馈与建议</b><p>{{ CAMPUS_BEAN_RULES.feedback }}</p></div>
          </div>
        </div>
        <div class="campus-hub-beans-foot"><p>审核员每月随机复核约 10%。贡献豆与充值豆分账，不提现、不转赠；充值暂未开放，贡献豆已可兑换应用内数字权益。</p><div><RouterLink class="text-button" to="/campus/beans">三两豆与兑换</RouterLink><RouterLink class="text-button" to="/campus/reviewer-application">查看规则与申请审核员</RouterLink></div></div>
      </details>
    </div>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-hub-beans{display:grid;gap:15px;padding:20px 22px;border:1px solid color-mix(in srgb,var(--success) 35%,var(--border));border-radius:var(--radius-14);background:color-mix(in srgb,var(--success) 4%,var(--card))}.campus-hub-beans-head,.campus-hub-beans-head>div,.campus-hub-beans-foot,.campus-hub-beans-foot>div{display:flex;align-items:center;justify-content:space-between;gap:14px}.campus-hub-beans-head>div:first-child{justify-content:flex-start}.campus-hub-beans-mark{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:50%;background:color-mix(in srgb,var(--success) 13%,var(--card));color:var(--success);font-size:var(--fs-17);font-weight:var(--fw-700)}.campus-hub-beans h2{margin:0;font-size:var(--fs-18)}.campus-hub-beans-head p,.campus-hub-beans-foot p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-11);line-height:1.6}.campus-hub-beans-account{display:flex;align-items:center;gap:6px;min-height:40px;padding:0 11px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-11);white-space:nowrap}.campus-hub-beans-account svg{width:15px;height:15px;color:var(--primary)}.campus-hub-beans-body{display:grid;grid-template-columns:minmax(145px,.45fr) minmax(0,1.55fr);gap:18px;padding:15px 0;border-top:1px solid var(--border)}.campus-hub-beans-balance{display:grid;align-content:start;gap:4px}.campus-hub-beans-balance>span{color:var(--muted);font-size:var(--fs-11)}.campus-hub-beans-balance>strong{font-size:clamp(23px,3vw,32px);font-weight:var(--fw-700);font-variant-numeric:tabular-nums}.campus-hub-beans-balance>strong small{margin-left:5px;font-size:var(--fs-12);font-weight:var(--fw-500)}.campus-hub-beans-balance>small{color:var(--muted);font-size:var(--fs-10);line-height:1.6}.campus-hub-beans-ways{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.campus-hub-beans-ways>div{display:grid;align-content:start;gap:5px}.campus-hub-beans-ways b{font-size:var(--fs-12)}.campus-hub-beans-ways p{margin:0;color:var(--muted);font-size:var(--fs-11);line-height:1.7}.campus-hub-beans-foot{align-items:flex-start;padding-top:11px;border-top:1px solid var(--border)}.campus-hub-beans-foot p{max-width:68ch;margin:0}.campus-hub-beans-foot>div{justify-content:flex-end;flex-wrap:wrap}.campus-hub-beans-foot a{color:var(--primary);font-size:var(--fs-11);text-decoration:none;white-space:nowrap}
.campus-hub{display:grid;gap:26px;min-width:0}.campus-hub-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:clamp(20px,4vw,32px);border:1px solid var(--border);border-radius:var(--radius-16);background:var(--card)}.campus-hub-hero>div{max-width:64ch}.campus-hub-kicker{color:var(--primary);font-size:var(--fs-11);font-weight:var(--fw-700);letter-spacing:.08em}.campus-hub-hero h2{margin:10px 0;font-size:clamp(23px,3.4vw,32px);line-height:1.45;letter-spacing:-.03em}.campus-hub-hero p{margin:0;color:var(--muted);font-size:var(--fs-13);line-height:1.8}.campus-hub-search{display:flex;align-items:center;gap:9px;flex:none;min-height:46px;padding:0 14px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--card);color:var(--text);font-size:var(--fs-12);text-decoration:none}.campus-hub-search svg{width:17px;height:17px;color:var(--primary)}.campus-hub-search svg:last-child{color:var(--muted)}.campus-hub-featured,.campus-hub-services{display:grid;gap:14px}.campus-hub-section-heading h2{margin:0;font-size:var(--fs-18)}.campus-hub-section-heading p{margin:5px 0 0;color:var(--muted);font-size:var(--fs-12)}.campus-hub-feature-grid,.campus-hub-service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.campus-hub-feature,.campus-hub-service{display:flex;align-items:center;gap:12px;min-width:0;min-height:84px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);color:var(--text);text-decoration:none;transition:border-color var(--dur-fast) var(--ease-standard),background var(--dur-fast) var(--ease-standard)}.campus-hub-feature:hover,.campus-hub-service:hover{border-color:var(--primary)}.campus-hub-icon{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:var(--radius-10);background:var(--primary-soft);color:var(--primary)}.campus-hub-icon svg{width:19px;height:19px;stroke-width:1.8}.campus-hub-feature-copy{display:grid;gap:5px;min-width:0}.campus-hub-feature-copy b{font-size:var(--fs-13);font-weight:var(--fw-650)}.campus-hub-feature-copy small{color:var(--muted);font-size:var(--fs-11);line-height:1.6}.campus-hub-arrow{width:16px;height:16px;flex:none;margin-left:auto;color:var(--muted)}.campus-hub-service-group{display:grid;gap:10px}.campus-hub-service-group h3{margin:4px 0 0;color:var(--muted);font-size:var(--fs-12);font-weight:var(--fw-600)}.campus-hub :is(a,button):focus-visible{outline:2px solid var(--primary);outline-offset:3px}
@media(max-width:760px){.campus-hub-hero{align-items:stretch;flex-direction:column}.campus-hub-search{justify-content:center}.campus-hub-feature-grid,.campus-hub-service-grid{grid-template-columns:minmax(0,1fr)}.campus-hub-beans-body{grid-template-columns:1fr}.campus-hub-beans-ways{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.campus-hub{gap:22px}.campus-hub-hero{padding:18px}.campus-hub-feature,.campus-hub-service{min-height:78px;padding:13px}.campus-hub-feature-copy small{font-size:var(--fs-12)}.campus-hub-beans{padding:16px}.campus-hub-beans-head,.campus-hub-beans-foot{align-items:flex-start;flex-direction:column}.campus-hub-beans-account{width:100%;justify-content:center}.campus-hub-beans-ways{grid-template-columns:1fr}.campus-hub-beans-foot>div{justify-content:flex-start}}

/* Campus services lead; contribution rules remain available on demand. */
.campus-hub-hero { padding: var(--space-5) 0; border: 0; background: transparent; border-radius: 0; }
.campus-hub-kicker { display: none; }
.campus-hub-hero h2 { font-size: var(--fs-22); font-weight: var(--fw-650); }
.campus-hub-feature, .campus-hub-service { min-height: 72px; padding: var(--space-4); box-shadow: none; }
.campus-hub-service { border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; }
.campus-hub-service:hover { border-color: var(--border); background: var(--bg-tint); }
.campus-hub-service .campus-hub-icon { background: transparent; color: var(--muted); }
.campus-hub-beans { display: block; padding: var(--space-4) 0 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: transparent; }
.campus-hub-beans > summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--control-large); color: var(--ink-soft); font-size: var(--type-callout); font-weight: var(--fw-600); cursor: pointer; list-style: none; }
.campus-hub-beans > summary::-webkit-details-marker { display: none; }
.campus-hub-beans > summary span { color: var(--muted); font-size: var(--type-footnote); font-weight: var(--fw-400); }
.campus-hub-beans > summary span:last-child { margin-left: auto; }
.campus-hub-beans[open] > summary { margin-bottom: var(--space-4); }
@media(max-width:520px) { .campus-hub-hero { padding: 0; } .campus-hub-feature-grid { gap: var(--space-2); } .campus-hub-beans > summary span:nth-child(1) { display: none; } }
</style>
