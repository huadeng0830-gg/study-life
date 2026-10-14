<script setup>
import { computed, onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusGuides } from '../../services/campusLife.js'

const page = useCampusLifePage()
const query = ref('')
async function refresh() { return page.load(async () => (await campusGuides()).guides || []) }
onMounted(() => { void refresh() })
const categoryLabels = { new_student: '新生入学', administration: '校园办事', dormitory: '宿舍生活', food: '食堂攻略', printing: '打印与学习资源', transport: '校园交通', facilities: '校园设施', exam: '考试与选课', graduation: '毕业季', safety: '校园安全', other: '其他' }
const sourceLabels = { official_public: '官方公开信息 · 已附来源', student_experience: '学生经验 · 非官方规定', merchant_submission: '商户投稿 · 非官方信息' }
const visible = computed(() => (page.data.value || []).filter((item) => !query.value.trim() || `${item.title} ${item.body} ${item.category}`.toLocaleLowerCase('zh-CN').includes(query.value.trim().toLocaleLowerCase('zh-CN'))))
</script>

<template>
  <CampusLifeLayout title="校园指南与经验" description="重要办事信息标注来源和有效期；学生经验与商户投稿不会被包装成学校规定。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-guides-heading"><div><h2>同校指南</h2><p>过期内容会从公开列表隐藏；提交后需审核。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=guide">分享经验</RouterLink></div>
        <form class="campus-life-search" role="search" aria-label="搜索校园指南" @submit.prevent><label class="sr-only" for="campus-guides-search">搜索校园指南</label><input id="campus-guides-search" v-model="query" type="search" placeholder="按标题、正文或分类搜索" /><button class="btn btn-ghost" type="button" @click="query = ''">清除</button></form>
        <p v-if="page.loading.value && !page.data.value" class="campus-life-state" role="status">正在读取校园指南…</p>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <p v-else-if="!visible.length" class="campus-life-state">{{ query ? '没有找到匹配的校园指南。' : '当前学校还没有已审核的指南内容。' }}</p>
        <div v-else class="campus-life-grid"><article v-for="guide in visible" :key="guide.id" class="campus-life-card"><div class="campus-life-meta"><span class="campus-life-tag">{{ categoryLabels[guide.category] || '校园指南' }}</span><span>{{ sourceLabels[guide.source_type] || '来源待核实' }}</span><span v-if="guide.campus">{{ guide.campus }}</span></div><h3>{{ guide.title }}</h3><p class="campus-guide-body">{{ guide.body }}</p><div class="campus-life-meta"><span>更新时间：{{ guide.updated_at.slice(0,10) }}</span><span v-if="guide.expires_on">有效至：{{ guide.expires_on }}</span><span v-else>未设置到期日期</span></div><a v-if="guide.source_url" :href="guide.source_url" target="_blank" rel="noopener noreferrer">查看原始来源</a><CampusContentActions target-type="guide" :target-id="guide.id" /></article></div>
      </section>
      <p class="campus-life-inline-state">重要办事流程请以学校公开来源为准。页面未接入学校官方数据源；来源缺失或用户经验不会显示为“官方规定”。</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-guides-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-guides-heading p{margin:5px 0 0;color:var(--muted)}.campus-guide-body{max-height:420px;overflow:auto;white-space:pre-wrap}@media(max-width:520px){.campus-guides-heading{align-items:flex-start;flex-direction:column}}
</style>
