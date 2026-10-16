<script setup>
import { computed, onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusDirectoryFilter from '../../components/campus/CampusDirectoryFilter.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { campusDateLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusGuides } from '../../services/campusLife.js'

const page = useCampusLifePage()
const query = ref('')
const category = ref('')
async function refresh() { return page.load(async () => (await campusGuides()).guides || [], null, { cacheKey: ['guides'] }) }
onMounted(() => { void refresh() })
const categoryLabels = { new_student: '新生入学', administration: '校园办事', dormitory: '宿舍生活', food: '食堂攻略', printing: '打印与学习资源', transport: '校园交通', facilities: '校园设施', exam: '考试与选课', graduation: '毕业季', safety: '校园安全', other: '其他' }
const sourceLabels = { official_public: '官方公开信息 · 已附来源', student_experience: '学生经验 · 非官方规定', merchant_submission: '商户投稿 · 非官方信息' }
const filterOptions = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))
const visible = computed(() => (page.data.value || []).filter((item) => (!category.value || item.category === category.value) && (!query.value.trim() || `${item.title} ${item.body} ${categoryLabels[item.category] || ''}`.toLocaleLowerCase('zh-CN').includes(query.value.trim().toLocaleLowerCase('zh-CN')))))
const filtered = computed(() => Boolean(query.value.trim() || category.value))
</script>

<template>
  <CampusLifeLayout title="校园指南与经验" description="重要办事信息标注来源和有效期；学生经验与商户投稿不会被包装成学校规定。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-guides-heading"><div><h2>同校指南</h2><p>过期内容会从公开列表隐藏；提交后需审核。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=guide">分享经验</RouterLink></div>
        <CampusDirectoryFilter v-if="page.data.value" v-model:query="query" v-model:category="category" :options="filterOptions" :count="visible.length" label="搜索校园指南" placeholder="搜索标题、正文或分类" />
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!visible.length"
          loading-text="正在读取校园指南…"
          :empty-title="filtered ? '没有找到匹配的指南' : '校园经验，等你来分享'"
          :empty-description="filtered ? '换一个关键词，或清除筛选看看。' : '入学、办事与日常生活，把你知道的经验留给同学。'"
          :empty-action="filtered ? '' : '分享经验'"
          :empty-to="filtered ? '' : '/campus/publish?kind=guide'"
          @retry="refresh()"
        >
          <div class="campus-life-grid"><article v-for="guide in visible" :key="guide.id" class="campus-life-card"><div class="campus-life-meta"><span class="campus-life-tag">{{ categoryLabels[guide.category] || '校园指南' }}</span><span>{{ sourceLabels[guide.source_type] || '来源待核实' }}</span><span v-if="guide.campus">{{ guide.campus }}</span></div><h3>{{ guide.title }}</h3><p v-if="guide.body.length <= 180" class="campus-guide-body">{{ guide.body }}</p><template v-else><p>{{ guide.body.slice(0, 100) }}…</p><details class="campus-guide-details"><summary>阅读全文</summary><p class="campus-guide-body">{{ guide.body }}</p></details></template><div class="campus-life-meta"><span>更新时间：{{ campusDateLabel(guide.updated_at) }}</span><span v-if="guide.expires_on">有效至：{{ campusDateLabel(guide.expires_on) }}</span><span v-else>未设置到期日期</span></div><a v-if="guide.source_url" :href="guide.source_url" target="_blank" rel="noopener noreferrer">查看原始来源</a><CampusContentActions target-type="guide" :target-id="guide.id" /></article></div>
        </CampusStateBlock>
      </section>
      <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
      <p class="campus-life-inline-state">重要办事流程请以学校公开来源为准。页面未接入学校官方数据源；来源缺失或用户经验不会显示为“官方规定”。</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-guides-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-guides-heading p{margin:5px 0 0;color:var(--muted)}.campus-guide-body{white-space:pre-wrap;overflow-wrap:anywhere}.campus-guide-details summary{padding:8px 0;color:var(--primary);font-size:var(--fs-12);cursor:pointer}.campus-guide-details[open] summary{margin-bottom:8px}@media(max-width:520px){.campus-guides-heading{align-items:flex-start;flex-direction:column}}
</style>
