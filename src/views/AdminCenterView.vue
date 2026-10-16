<script setup>
import { computed, defineAsyncComponent, h, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutDashboard, MessagesSquare, ClipboardCheck, MapPin, UsersRound, ContactRound, History, Activity, Database, ExternalLink, ArrowLeft } from '@lucide/vue'
import { accountUser, openAccountSection } from '../composables/accountAuth.js'
import { ADMIN_GOVERNANCE_ACCESS, useCampusGovernanceAccess } from '../composables/campusGovernanceAccess.js'
import { adminSections, adminSectionForRoute, visibleAdminSections } from '../composables/adminWorkspaceModel.js'
import AdminOverview from '../components/admin/AdminOverview.vue'
import RouteFallback from '../components/RouteFallback.vue'
const AdminDataView = defineAsyncComponent({ loader: () => import('./AdminDataView.vue'), loadingComponent: RouteFallback, errorComponent: { render: () => h(RouteFallback, { error: true }) } })
const FeedbackAdminView = defineAsyncComponent({ loader: () => import('./FeedbackAdminView.vue'), loadingComponent: RouteFallback, errorComponent: { render: () => h(RouteFallback, { error: true }) } })
const CampusGovernanceView = defineAsyncComponent({ loader: () => import('./campus/CampusGovernanceView.vue'), loadingComponent: RouteFallback, errorComponent: { render: () => h(RouteFallback, { error: true }) } })
const PlatformAdminView = defineAsyncComponent({ loader: () => import('./PlatformAdminView.vue'), loadingComponent: RouteFallback, errorComponent: { render: () => h(RouteFallback, { error: true }) } })
const icons = { LayoutDashboard, MessagesSquare, ClipboardCheck, MapPin, UsersRound, ContactRound, History, Activity, Database }
const route = useRoute()
const router = useRouter()
const governance = useCampusGovernanceAccess()
provide(ADMIN_GOVERNANCE_ACCESS, governance)
const { access, loading, error, refresh } = governance
const section = computed(() => adminSectionForRoute(route))
const current = computed(() => adminSections.find(item => item.id === section.value) || adminSections[0])
const groups = computed(() => ['工作台', '平台管理', '设备工具'].map(title => ({ title, items: visibleAdminSections(access.value).filter(item => item.group === title) })).filter(group => group.items.length))
function navigateSection(event) {
  const item = visibleAdminSections(access.value).find(item => item.id === event.target.value)
  if (item) void router.push(item.path)
}
const platformSection = computed(() => ['places', 'accounts', 'activity', 'system'].includes(section.value))
</script>
<template>
  <div class="admin-workspace">
    <aside class="admin-navigation">
      <div class="admin-brand"><LayoutDashboard :size="22" aria-hidden="true" /><strong>管理中心</strong></div>
      <nav aria-label="管理中心功能"><div v-for="group in groups" :key="group.title" class="admin-nav-group"><span class="admin-nav-group-label">{{ group.title }}</span><RouterLink v-for="item in group.items" :key="item.id" :to="item.path" :aria-current="section === item.id ? 'page' : undefined" :class="{ selected: section === item.id }"><component :is="icons[item.icon]" :size="18" aria-hidden="true" /><span>{{ item.title }}</span></RouterLink></div></nav>
      <label class="admin-mobile-switch"><span class="sr-only">切换管理功能</span><select :value="section" @change="navigateSection"><option v-if="!visibleAdminSections(access).some(item => item.id === section)" :value="section" disabled>{{ current.title }}</option><optgroup v-for="group in groups" :key="group.title" :label="group.title"><option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.title }}</option></optgroup></select></label>
      <RouterLink class="admin-return-link admin-campus-link" to="/campus"><MapPin :size="16" aria-hidden="true" />校园生活</RouterLink>
      <RouterLink class="admin-return-link" to="/"><ArrowLeft :size="16" aria-hidden="true" />返回应用</RouterLink>
      <RouterLink class="admin-public-link" to="/feedback"><ExternalLink :size="16" aria-hidden="true" />公开反馈</RouterLink>
    </aside>
    <div class="admin-workspace-main">
      <header class="admin-workspace-header"><h1>{{ current.title }}</h1><span v-if="access?.owner" class="admin-role">总管理员</span><span v-else-if="access?.reviewer" class="admin-role">校园审核员</span><button type="button" class="text-button" @click="openAccountSection('overview')">{{ accountUser ? '我的账号' : '登录账号' }}</button></header>
      <div :key="accountUser?.id || 'guest'" class="admin-workspace-content">
        <template v-if="section === 'overview'">
          <p v-if="loading" role="status">正在读取管理权限…</p>
          <div v-else-if="error" class="admin-access-error" role="alert">管理权限读取失败。<button type="button" class="text-button" @click="refresh">重试</button></div>
          <AdminOverview v-else-if="access?.reviewer || access?.owner" :owner="Boolean(access.owner)" />
          <div v-else class="admin-personal-home"><h2>设备与数据</h2><p>管理当前设备的数据、备份与同步；校园参与记录可在校园生活中继续跟进。</p><RouterLink to="/admin?section=data">备份恢复、数据体检与诊断</RouterLink><RouterLink to="/campus">进入校园生活</RouterLink><RouterLink to="/feedback">提交反馈或查看处理进展</RouterLink><button type="button" class="text-button" @click="openAccountSection('profile')">检查我的账号与校园资料</button><p v-if="accountUser">当前账号没有平台管理权限。</p></div>
        </template>
        <AdminDataView v-else-if="section === 'data'" />
        <FeedbackAdminView v-else-if="section === 'feedback'" :key="String(route.query.status || '')" />
        <CampusGovernanceView v-else-if="section === 'campus' || section === 'team'" :key="section" :team="section === 'team'" />
        <PlatformAdminView v-else-if="platformSection" :key="section" :section="section" />
      </div>
    </div>
  </div>
</template>
<style scoped>
.admin-workspace{display:grid;grid-template-columns:190px minmax(0,1fr);gap:28px;max-width:1440px;margin:0 auto;min-width:0;padding-bottom:36px;color:var(--text)}.admin-navigation{position:sticky;top:24px;max-height:calc(100dvh - 48px);overflow-y:auto;align-self:start;min-width:0;border-right:1px solid var(--border);padding-right:16px}.admin-brand{display:flex;align-items:center;gap:9px;padding:8px 10px 25px;font-size:var(--fs-17)}.admin-nav-group{display:grid;gap:4px;margin-bottom:22px}.admin-nav-group-label{padding:0 12px 6px;color:var(--muted);font-size:var(--fs-12)}.admin-nav-group a,.admin-public-link,.admin-return-link{display:flex;align-items:center;gap:10px;min-height:44px;padding:9px 12px;border-radius:var(--radius-8);color:var(--ink-soft);text-decoration:none;font-size:var(--fs-14)}.admin-nav-group a:hover,.admin-public-link:hover{background:var(--primary-soft)}.admin-nav-group a.selected{background:var(--primary-soft);color:var(--primary);font-weight:var(--fw-750)}.admin-nav-group a:focus-visible,.admin-public-link:focus-visible,.admin-return-link:focus-visible{outline:var(--focus-width) solid var(--focus-solid);outline-offset:var(--focus-offset)}.admin-public-link{border-top:1px solid var(--border);border-radius:0;margin-top:8px}.admin-workspace-main,.admin-workspace-content{min-width:0}.admin-workspace-header{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:48px;margin-bottom:24px}.admin-workspace-header h1{margin:0;font-size:var(--fs-24);font-weight:var(--fw-800)}.admin-role{margin-left:auto;color:var(--muted);font-size:var(--fs-13)}.admin-personal-home{display:grid;gap:18px;padding:24px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card)}.admin-personal-home h2,.admin-personal-home p{margin:0}.admin-personal-home a{color:var(--primary)}.admin-access-error{color:var(--danger)}
.admin-mobile-switch{display:none}
@media(max-width:900px){.admin-workspace{grid-template-columns:minmax(0,1fr);gap:20px}.admin-navigation{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));position:relative;top:auto;max-height:none;overflow:visible;border-right:0;border-bottom:1px solid var(--border);padding:0 0 12px;gap:8px}.admin-brand,.admin-mobile-switch{grid-column:1/-1}.admin-brand{padding:0 0 4px}.admin-navigation nav{display:none}.admin-mobile-switch{display:block}.admin-mobile-switch select{width:100%;min-height:44px;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:16px}.admin-nav-group{display:flex;flex-shrink:0;margin:0;gap:4px}.admin-nav-group-label{display:none}.admin-nav-group a{white-space:nowrap}.admin-public-link{display:none}.admin-return-link{position:static;justify-content:center;min-height:40px;padding:7px 8px}.admin-workspace-header{margin-bottom:18px}}
@media(max-width:520px){.admin-workspace{gap:16px}.admin-nav-group a{padding:8px 10px;font-size:var(--fs-13)}.admin-workspace-header h1{font-size:var(--fs-20)}}
</style>
