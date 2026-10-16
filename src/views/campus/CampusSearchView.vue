<script setup>
import { computed, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import { campusContentLabel, campusContentRoute } from '../../composables/campusContentModel.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeSearch } from '../../services/campusLife.js'

const page = useCampusLifePage({ reloadOnAccountChange: false })
const query = ref('')
const searched = ref(false)
const category = ref('')
const searchTypes = ['matter', 'place', 'course', 'teacher', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide']
const submitted = ref({ term: '', type: '' })
const currentPage = computed(() => page.data.value?.page || 0)
watch(() => accountUser.value?.id, () => { query.value = ''; category.value = ''; searched.value = false; submitted.value = { term: '', type: '' } }, { flush: 'sync' })
const results = computed(() => page.data.value?.results || [])
function resultRoute(item) { return item.type === 'matter' ? `/campus/matters/${item.id}` : campusContentRoute(item.type) }

async function search() {
  const term = query.value.trim()
  // 空查询是本地判断，没必要发一次请求。但它也不是读取失败，
  // 所以走 actionError —— 不该把结果区整个换成错误态。
  if (!term) { page.reportFailure('请输入要查找的内容。'); return }
  page.reportFailure('')
  searched.value = true
  await runSearch(term, category.value, 0)
}
async function runSearch(term, type, index) {
  const result = await page.load(() => campusLifeSearch(term, { type, page: index }))
  if (result) submitted.value = { term, type }
}
function changePage(index) { return runSearch(submitted.value.term, submitted.value.type, index) }
</script>

<template>
  <CampusLifeLayout title="校园全站搜索" description="在同校已审核的事项、地点、课程、集市、互助、校车、失物、活动和指南中查找。">
    <template #default>
      <section class="campus-life-panel">
        <form class="campus-life-search" role="search" aria-label="校园全站搜索" @submit.prevent="search"><label class="sr-only" for="campus-global-search">搜索校园内容</label><input id="campus-global-search" v-model="query" type="search" maxlength="100" placeholder="搜课程、活动、地点或校园服务" /><button class="btn btn-primary" type="submit" :disabled="page.loading.value">{{ page.loading.value ? '搜索中…' : '搜索' }}</button></form>
        <label class="campus-search-category">搜索范围 <select v-model="category"><option value="">全部分类</option><option v-for="type in searchTypes" :key="type" :value="type">{{ campusContentLabel(type) }}</option></select></label>
        <!-- `loaded` 让重新搜索时保留上一次的结果：旧模板只看 page.loading，
             每敲一次搜索就闪一下空白，用户以为功能坏了。 -->
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!results.length"
          loading-text="正在搜索当前学校和校区…"
          :empty-title="searched ? '没有找到相关内容' : '校园里，有什么想找的？'"
          :empty-description="searched ? '试试更短的关键词。审核中的投稿暂时不会出现在结果中。' : '输入课程、物品、活动或地点名称，搜索同校已审核的公开信息。'"
          @retry="search()"
        >
          <div class="campus-search-results" aria-label="搜索结果">
            <p class="campus-life-result-count" role="status">“{{ submitted.term }}” · 本页 {{ results.length }} 条相关内容<span v-if="page.data.value?.hasMore"> · 还有更多结果</span></p>
            <article v-for="item in results" :key="`${item.type}:${item.id}`" class="campus-search-result">
              <div><span class="campus-life-tag">{{ campusContentLabel(item.type) }}</span><h2>{{ item.title }}</h2><p>{{ item.detail || '暂无补充说明。' }}</p><small v-if="item.campus">{{ item.campus }}</small></div>
              <RouterLink class="btn btn-ghost" :to="resultRoute(item)">{{ item.type === 'matter' ? '看看这件事怎么处理' : `查看${campusContentLabel(item.type)}` }}</RouterLink>
            </article>
          </div>
        </CampusStateBlock>
        <nav v-if="page.data.value && (currentPage || page.data.value.hasMore)" class="campus-life-actions" aria-label="搜索结果分页"><button class="btn btn-ghost" type="button" :disabled="page.loading.value || !currentPage" @click="changePage(currentPage - 1)">上一页</button><span>第 {{ currentPage + 1 }} 页</span><button class="btn btn-ghost" type="button" :disabled="page.loading.value || !page.data.value.hasMore" @click="changePage(currentPage + 1)">下一页</button></nav>
        <p v-if="page.actionError.value" class="campus-life-inline-state error" role="alert">{{ page.actionError.value }}</p>
      </section>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-search-results{display:grid;gap:9px;margin-top:15px}.campus-search-result{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-search-result h2{margin:6px 0;font-size:17px}.campus-search-result p{display:-webkit-box;max-width:700px;margin:0 0 4px;color:var(--muted);overflow:hidden;-webkit-line-clamp:3;-webkit-box-orient:vertical}.campus-search-result small{color:var(--muted)}@media(max-width:520px){.campus-search-result{align-items:flex-start;flex-direction:column}}
</style>
