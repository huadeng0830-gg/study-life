<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusContentActions from '../../components/campus/CampusContentActions.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusCourses, campusLifeMine, submitCampusCourseReview } from '../../services/campusLife.js'

const page = useCampusLifePage()
const reviewDrafts = reactive({})
const savingReviewId = ref('')
watch(() => accountUser.value?.id, () => {
  for (const id of Object.keys(reviewDrafts)) delete reviewDrafts[id]
  savingReviewId.value = ''
}, { flush: 'sync' })
async function refresh() {
  return page.load(async () => {
    const [directory, mine] = await Promise.all([campusCourses(), campusLifeMine()])
    return { ...directory, mine: mine.courseReviews || [] }
  })
}
onMounted(() => { void refresh() })

const teacherById = computed(() => new Map((page.data.value?.teachers || []).map((item) => [item.id, item])))
const courseById = computed(() => new Map((page.data.value?.courses || []).map((item) => [item.id, item])))
const reviewByAssignment = computed(() => {
  const map = new Map()
  for (const review of page.data.value?.reviews || []) map.set(review.assignment_id, [...(map.get(review.assignment_id) || []), review])
  return map
})
const ownReviewByAssignment = computed(() => new Map((page.data.value?.mine || []).map((review) => [review.assignment_id, review])))
// `term` lives on the teaching assignment, not on the review row, so resolve it here
// instead of reading a field the review payload never carried.
const termByAssignment = computed(() => new Map((page.data.value?.assignments || []).map((item) => [item.id, item.term])))
function formFor(assignmentId) {
  if (!reviewDrafts[assignmentId]) {
    const review = ownReviewByAssignment.value.get(assignmentId)
    reviewDrafts[assignmentId] = review
      ? { clarity: review.clarity ?? '', organization: review.organization ?? '', learning: review.learning ?? '', workload: review.workload ?? '', assessment: review.assessment ?? '', note: review.note ?? '' }
      : { clarity: '', organization: '', learning: '', workload: '', assessment: '', note: '' }
  }
  return reviewDrafts[assignmentId]
}
function ratingsSummary(assignmentId) {
  const rows = reviewByAssignment.value.get(assignmentId) || []
  const scores = rows.flatMap((review) => ['clarity', 'organization', 'learning', 'workload', 'assessment'].map((key) => review[key]).filter((value) => Number.isInteger(value)))
  if (!scores.length) return `${rows.length} 条匿名体验`
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length
  return rows.length < 10 ? `${average.toFixed(1)} / 5 · ${rows.length} 条评价（样本较少）` : `${average.toFixed(1)} / 5 · ${rows.length} 条匿名评价`
}
async function submitReview(assignment) {
  if (savingReviewId.value) return
  const draft = formFor(assignment.id)
  savingReviewId.value = assignment.id
  const result = await page.act(() => submitCampusCourseReview({ assignmentId: assignment.id, ...draft }), '课程体验已匿名提交审核；每位用户每个授课安排只能保留一条评价。')
  savingReviewId.value = ''
  if (result) { await refresh(); delete reviewDrafts[assignment.id] }
}
</script>

<template>
  <CampusLifeLayout title="老师与课程" description="查找公开的教师与课程资料，按学期分享你的课程体验。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-course-heading"><div><h2>已审核资料</h2><p>教师档案只接受有来源的公开资料，不展示私人联系方式和未授权照片。</p></div><RouterLink class="btn btn-primary" to="/campus/publish?kind=teacher">提交资料</RouterLink></div>
        <div class="campus-life-actions"><RouterLink class="btn btn-ghost" to="/campus/publish?kind=course">提交课程</RouterLink><RouterLink class="btn btn-ghost" to="/campus/publish?kind=assignment">关联授课安排</RouterLink></div>
        <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取老师和课程资料…</CampusLoadingState>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <CampusEmptyState v-else-if="!page.data.value?.courses?.length && !page.data.value?.teachers?.length" title="课程资料，等待一起补充" description="提交有公开来源的教师或课程资料，审核后就能在这里查阅。" action="提交课程资料" to="/campus/publish?kind=course" />
        <div v-else class="campus-life-grid">
          <article v-for="teacher in page.data.value.teachers" :key="`teacher:${teacher.id}`" class="campus-life-card"><span class="campus-life-tag">教师公开资料</span><h3>{{ teacher.name }}</h3><p>{{ teacher.department || '院系未填写' }}</p><p v-if="teacher.research_directions">研究方向：{{ teacher.research_directions }}</p><p v-if="teacher.official_intro">{{ teacher.official_intro }}</p><a :href="teacher.source_url" target="_blank" rel="noopener noreferrer">公开资料来源</a><CampusContentActions target-type="teacher" :target-id="teacher.id" /></article>
          <article v-for="course in page.data.value.courses" :key="`course:${course.id}`" class="campus-life-card"><span class="campus-life-tag">课程资料</span><h3>{{ course.name }}</h3><p>{{ course.department || '院系未填写' }}</p><p>{{ course.description || '暂无课程说明。' }}</p><a v-if="course.source_url" :href="course.source_url" target="_blank" rel="noopener noreferrer">课程资料来源</a><CampusContentActions target-type="course" :target-id="course.id" /></article>
        </div>
      </section>

      <section v-if="page.data.value?.assignments?.length" class="campus-life-panel"><h2>按学期查看授课体验</h2><p>体验是学生反馈，不是学校或教师的官方承诺；公开评价不会展示姓名。</p><div class="campus-life-grid"><article v-for="assignment in page.data.value.assignments" :key="assignment.id" class="campus-life-card"><span class="campus-life-tag">{{ assignment.term }}</span><h3>{{ courseById.get(assignment.course_id)?.name || '课程' }}</h3><p>授课教师：{{ teacherById.get(assignment.teacher_id)?.name || '教师资料' }}</p><a v-if="assignment.source_url" :href="assignment.source_url" target="_blank" rel="noopener noreferrer">授课来源</a><strong>{{ ratingsSummary(assignment.id) }}</strong><div v-for="review in reviewByAssignment.get(assignment.id) || []" :key="review.id" class="campus-course-review"><p v-if="review.note">“{{ review.note }}”</p><small>{{ ['讲授清晰度','教学组织','学习收获','作业负担','考核透明度'].map((label,index) => { const key=['clarity','organization','learning','workload','assessment'][index]; return review[key] ? `${label} ${review[key]}/5` : '' }).filter(Boolean).join(' · ') || '文字体验' }}</small></div><CampusContentActions target-type="course" :target-id="assignment.course_id" /><form class="campus-course-review-form" @submit.prevent="submitReview(assignment)"><h4>匿名提交课程体验</h4><label v-for="field in [{key:'clarity',label:'讲授清晰度'},{key:'organization',label:'教学组织'},{key:'learning',label:'学习收获'},{key:'workload',label:'作业负担感受'},{key:'assessment',label:'考核信息透明度'}]" :key="field.key">{{ field.label }} <select v-model="formFor(assignment.id)[field.key]"><option value="">跳过该项</option><option v-for="score in [1,2,3,4,5]" :key="score" :value="score">{{ score }} 星</option></select></label><label class="span-all">客观课程体验 <textarea v-model="formFor(assignment.id).note" maxlength="1500" placeholder="请评价课程体验，不涉及教师私生活、成绩或学籍" /></label><button class="btn btn-primary" type="submit" :disabled="savingReviewId === assignment.id">{{ savingReviewId === assignment.id ? '正在提交…' : '提交课程评价' }}</button></form></article></div></section>

      <section v-if="page.data.value?.mine?.length" class="campus-life-panel"><h2>我的课程评价</h2><div class="campus-course-mine"><p v-for="review in page.data.value.mine" :key="review.id"><b>{{ termByAssignment.get(review.assignment_id) || '授课安排' }}</b> · {{ review.review_status === 'approved' ? '已公开' : review.review_status === 'rejected' ? `未通过：${review.review_reason}` : '待审核' }}</p></div></section>
      <p v-if="page.notice.value" class="campus-life-inline-state campus-life-success" role="status">{{ page.notice.value }}</p>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-course-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-course-heading p{margin:5px 0 0;color:var(--muted)}.campus-course-review{padding:8px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-course-review p{margin:0 0 5px}.campus-course-review small{color:var(--muted)}.campus-course-review-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding-top:8px;border-top:1px solid var(--border)}.campus-course-review-form h4,.campus-course-review-form label,.campus-course-review-form button{grid-column:1/-1}.campus-course-review-form h4{margin:0}.campus-course-review-form label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:5px;color:var(--muted);font-size:12px}.campus-course-review-form select{padding:7px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text)}.campus-course-review-form textarea{min-height:70px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit}.campus-course-mine{display:grid;gap:3px}.campus-course-mine p{margin:0;padding:7px;border-bottom:1px solid var(--border)}@media(max-width:520px){.campus-course-heading{align-items:flex-start;flex-direction:column}}
</style>
