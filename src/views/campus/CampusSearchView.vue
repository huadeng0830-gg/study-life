<script setup>
import { ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeSearch } from '../../services/campusLife.js'

const page = useCampusLifePage()
const query = ref('')
const searched = ref(false)
const labels = { place: '校园地点', teacher: '教师资料', course: '课程', market_listing: '二手集市', help_task: '校园互助', shuttle_route: '校车线路', lost_found: '失物招领', event: '活动', guide: '校园指南' }
const routeFor = { place: '/campus', teacher: '/campus/courses', course: '/campus/courses', market_listing: '/campus/market', help_task: '/campus/help', shuttle_route: '/campus/shuttle', lost_found: '/campus/lost-found', event: '/campus/events', guide: '/campus/guides' }
async function search() {
  if (!query.value.trim()) { page.error.value = '请输入要查找的内容。'; return }
  searched.value = true
  await page.load(() => campusLifeSearch(query.value.trim()))
}
</script>

<template>
  <CampusLifeLayout title="校园全站搜索" description="在已审核公开的地点、课程、集市、互助、校车、失物、活动和指南中查找。">
    <template #default>
      <section class="campus-life-panel">
        <form class="campus-life-search" role="search" aria-label="校园全站搜索" @submit.prevent="search"><label class="sr-only" for="campus-global-search">搜索校园内容</label><input id="campus-global-search" v-model="query" type="search" maxlength="100" placeholder="搜课程、活动、地点或校园服务" /><button class="btn btn-primary" type="submit" :disabled="page.loading.value">{{ page.loading.value ? '搜索中…' : '搜索' }}</button></form>
        <p v-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }}</p>
        <CampusLoadingState v-else-if="page.loading.value">正在搜索当前学校和校区…</CampusLoadingState>
        <CampusEmptyState v-else-if="searched && !page.data.value?.results?.length" title="没有找到相关内容" description="试试更短的关键词。审核中的投稿暂时不会出现在结果中。" />
        <div v-else-if="page.data.value?.results?.length" class="campus-search-results" aria-label="搜索结果"><p class="campus-life-result-count" role="status">找到 {{ page.data.value.results.length }} 条相关内容</p><article v-for="item in page.data.value.results" :key="`${item.type}:${item.id}`" class="campus-search-result"><div><span class="campus-life-tag">{{ labels[item.type] || '校园内容' }}</span><h2>{{ item.title }}</h2><p>{{ item.detail || '暂无补充说明。' }}</p><small v-if="item.campus">{{ item.campus }}</small></div><RouterLink class="btn btn-ghost" :to="routeFor[item.type] || '/campus'">查看{{ labels[item.type] || '内容' }}</RouterLink></article></div>
        <CampusEmptyState v-else title="校园里，有什么想找的？" description="输入课程、物品、活动或地点名称，搜索同校已审核的公开信息。" />
      </section>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-search-results{display:grid;gap:9px;margin-top:15px}.campus-search-result{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-search-result h2{margin:6px 0;font-size:17px}.campus-search-result p{display:-webkit-box;max-width:700px;margin:0 0 4px;color:var(--muted);overflow:hidden;-webkit-line-clamp:3;-webkit-box-orient:vertical}.campus-search-result small{color:var(--muted)}@media(max-width:520px){.campus-search-result{align-items:flex-start;flex-direction:column}}
</style>
