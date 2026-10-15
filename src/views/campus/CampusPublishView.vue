<script setup>
import { computed, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { useRoute } from 'vue-router'
import { Check, CheckCheck, FilePenLine, ShieldCheck, ChevronDown, ShoppingBag, HandHelping, Bus, Telescope, CalendarDays, BookOpen, GraduationCap, UserRound, Link, FileCheck, Clock } from '@lucide/vue'
import { Button } from '../../components/ui/button'
import { Field, FieldGroup, FieldLegend, FieldSet } from '../../components/ui/field'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusConfirmDialog from '../../components/campus/CampusConfirmDialog.vue'
import CampusPublishPreview from '../../components/campus/CampusPublishPreview.vue'
import { useCampusConfirm } from '../../composables/campusConfirm.js'
import { campusErrorMessage } from '../../composables/campusContentModel.js'
import { campusLocalDateTimeInput } from '../../composables/campusFormatting.js'
import { useCampusLifeDraft } from '../../composables/campusLifeDraft.js'
import { useCampusRequest } from '../../composables/campusRequest.js'
import {
  campusCourses, campusLifeMine, campusShuttles, resubmitCampusContent, submitCampusCourse, submitCampusEvent,
  submitCampusGuide, submitCampusHelpTask, submitCampusMarketListing, submitCampusShuttleCorrection,
  submitCampusShuttleException, submitCampusShuttleRoute, submitCampusTeacher, submitLostFoundItem,
  submitCampusTeachingAssignment,
} from '../../services/campusLife.js'

const options = [
  { id: 'teacher', title: '教师资料线索', note: '仅提交公开资料来源，审核后再建立档案。' },
  { id: 'course', title: '课程资料', note: '课程、院系与公开来源。' },
  { id: 'assignment', title: '授课安排', note: '把已审核的教师、课程和学期关联起来。' },
  { id: 'market', title: '二手出售 / 求购 / 赠送', note: '线下校园安全地点交易；平台不收款。' },
  { id: 'help', title: '校园互助', note: '不公开取件码、手机号、房间号或证件信息。' },
  { id: 'shuttle', title: '校车线路与班次', note: '必须提供公开来源；人工审核后展示。' },
  { id: 'shuttle_correction', title: '校车线路纠错', note: '说明错误并提供可核实来源。' },
  { id: 'shuttle_exception', title: '校车特殊日期安排', note: '只提交有公开来源的临时班次变化。' },
  { id: 'lost', title: '失物招领', note: '敏感号码与可识别信息不要写进公开描述。' },
  { id: 'event', title: '活动 / 社团活动', note: '未验证组织方不会显示学校官方标识。' },
  { id: 'guide', title: '校园指南 / 经验', note: '标明官方来源或学生经验，并设置有效期。' },
]
const primaryKinds = ['market', 'help', 'lost', 'event', 'guide', 'shuttle']
const shortTitles = { market: '二手集市', help: '校园互助', lost: '失物招领', event: '活动 / 社团', guide: '校园指南', shuttle: '校车线路' }
const optionIcons = { teacher: UserRound, course: GraduationCap, assignment: Link, market: ShoppingBag, help: HandHelping, shuttle: Bus, shuttle_correction: FileCheck, shuttle_exception: Clock, lost: Telescope, event: CalendarDays, guide: BookOpen }
const route = useRoute()
const defaults = () => ({
  teacher: { name: '', department: '', researchDirections: '', officialIntro: '', sourceUrl: '' },
  course: { name: '', department: '', description: '', sourceUrl: '' },
  assignment: { courseId: '', teacherId: '', term: '', sourceUrl: '' },
  market: { listingType: 'sale', category: 'textbook', title: '', description: '', condition: '', price: '', meetupArea: '' },
  help: { taskType: 'parcel', title: '', description: '', pickupArea: '', deliveryArea: '', deadline: '' },
  shuttle: { name: '', sourceUrl: '', effectiveFrom: '', effectiveTo: '', stopsText: '', departuresText: '' },
  shuttle_correction: { routeId: '', detail: '', sourceUrl: '' },
  shuttle_exception: { routeId: '', serviceDate: '', exceptionType: 'suspended', departureTime: '', direction: 'outbound', note: '', sourceUrl: '' },
  lost: { mode: 'lost', category: 'electronics', title: '', description: '', approximateLocation: '', occurredAt: '' },
  event: { title: '', description: '', startsAt: '', endsAt: '', location: '', organizer: '', signupUrl: '', sourceUrl: '', capacity: '' },
  guide: { title: '', category: 'new_student', body: '', sourceType: 'student_experience', sourceUrl: '', expiresOn: '' },
})
const confirm = useCampusConfirm()
const confirmRequest = confirm.pending
const formDefaults = defaults()
const { value: draft, savedRevision } = useCampusLifeDraft('unified-publisher', { kind: 'market', forms: defaults() })
if (!draft.value.forms || typeof draft.value.forms !== 'object' || Array.isArray(draft.value.forms)) draft.value.forms = formDefaults
for (const item of options) if (!draft.value.forms[item.id]) draft.value.forms[item.id] = formDefaults[item.id]
// The draft is restored from localStorage, so `kind` can name an option that no longer
// exists. Validate it instead of binding `form` to undefined, which would blank the page.
const kind = computed({
  get: () => (options.some((item) => item.id === draft.value.kind) ? draft.value.kind : 'market'),
  set: (value) => { if (options.some((item) => item.id === value)) draft.value.kind = value },
})
const form = computed(() => draft.value.forms[kind.value] || formDefaults[kind.value])
const teachersCourses = ref({ courses: [], teachers: [], assignments: [], reviews: [] })
const shuttleRoutes = ref([])
const editing = ref(null)
const optionsLoading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
// 两条独立的守卫，不能合并：读选项（切类型就会重来）和提交（用户点下去之后
// 不该因为一次后台刷新被作废）必须各走各的。useCampusRequest 已经把
// 「代际自增 + 账号变更作废 + 卸载作废」这套写法收敛到一处。
const page = useCampusRequest()
const choices = useCampusRequest()

async function loadChoices() {
  const revision = choices.begin()
  optionsLoading.value = true
  try {
    if (kind.value === 'assignment') {
      const result = await campusCourses()
      if (choices.live(revision)) teachersCourses.value = result
    }
    if (['shuttle_correction', 'shuttle_exception'].includes(kind.value)) {
      const result = await campusShuttles()
      if (choices.live(revision)) shuttleRoutes.value = result.routes || []
    }
  } catch (cause) { if (choices.live(revision)) error.value = campusErrorMessage(cause, '暂时无法读取已审核校园资料。') }
  finally { if (choices.live(revision)) optionsLoading.value = false }
}
const submissionKeys = {
  teacher: 'teachers', course: 'courses', assignment: 'assignments', market: 'listings', help: 'helpTasks',
  shuttle: 'shuttleRoutes', shuttle_correction: 'shuttleCorrections', shuttle_exception: 'shuttleExceptions',
  lost: 'lostFound', event: 'events', guide: 'guides',
}
// datetime-local 回填用的是同一套规则（campusFormatting 里那份），
// 不再在这里手写一份偏移量修正 —— 漏一次就是活动时间差几个小时。
function localDateTime(value) {
  return campusLocalDateTimeInput(value)
}
function prefillSubmission(type, item) {
  kind.value = type
  if (type === 'teacher') Object.assign(draft.value.forms[type], { name: item.name, department: item.department, researchDirections: item.research_directions, officialIntro: item.official_intro, sourceUrl: item.source_url })
  else if (type === 'course') Object.assign(draft.value.forms[type], { name: item.name, department: item.department, description: item.description, sourceUrl: item.source_url })
  else if (type === 'assignment') Object.assign(draft.value.forms[type], { courseId: item.course_id, teacherId: item.teacher_id, term: item.term, sourceUrl: item.source_url })
  else if (type === 'market') Object.assign(draft.value.forms[type], { listingType: item.listing_type, category: item.category, title: item.title, description: item.description, condition: item.condition, price: item.price_cents === null ? '' : String(item.price_cents / 100), meetupArea: item.meetup_area })
  else if (type === 'help') Object.assign(draft.value.forms[type], { taskType: item.task_type, title: item.title, description: item.description, pickupArea: item.pickup_area, deliveryArea: item.delivery_area, deadline: localDateTime(item.deadline) })
  else if (type === 'shuttle') Object.assign(draft.value.forms[type], {
    name: item.name, sourceUrl: item.source_url, effectiveFrom: item.effective_from || '', effectiveTo: item.effective_to || '',
    stopsText: (item.stops || []).map((stop) => `${stop.direction}|${stop.name}`).join('\n'),
    departuresText: (item.departures || []).map((trip) => `${trip.direction}|${trip.service_day}|${String(trip.departure_time).slice(0, 5)}|${trip.stop_name || ''}`).join('\n'),
  })
  else if (type === 'shuttle_correction') Object.assign(draft.value.forms[type], { routeId: item.route_id, detail: item.detail, sourceUrl: item.source_url })
  else if (type === 'shuttle_exception') Object.assign(draft.value.forms[type], { routeId: item.route_id, serviceDate: item.service_date, exceptionType: item.exception_type, departureTime: String(item.departure_time || '').slice(0, 5), direction: item.direction, note: item.note, sourceUrl: item.source_url })
  else if (type === 'lost') Object.assign(draft.value.forms[type], { mode: item.mode, category: item.category, title: item.title, description: item.description, approximateLocation: item.approximate_location, occurredAt: item.occurred_at || '' })
  else if (type === 'event') Object.assign(draft.value.forms[type], { title: item.title, description: item.description, startsAt: localDateTime(item.starts_at), endsAt: localDateTime(item.ends_at), location: item.location, organizer: item.organizer, signupUrl: item.signup_url, sourceUrl: item.source_url, capacity: item.capacity === null ? '' : String(item.capacity) })
  else if (type === 'guide') Object.assign(draft.value.forms[type], { title: item.title, category: item.category, body: item.body, sourceType: item.source_type, sourceUrl: item.source_url, expiresOn: item.expires_on || '' })
  editing.value = { type, id: item.id, revision: Number(item.revision) }
}
watch(() => [accountUser.value?.id || '', route.query.kind, route.query.editType, route.query.id], async () => {
  const revision = page.begin()
  choices.invalidate()
  editing.value = null
  teachersCourses.value = { courses: [], teachers: [], assignments: [], reviews: [] }
  shuttleRoutes.value = []
  saving.value = false
  error.value = ''
  message.value = ''
  const requested = String(route.query.kind || '')
  if (options.some((item) => item.id === requested)) kind.value = requested
  const editType = String(route.query.editType || '')
  const editId = String(route.query.id || '')
  if (submissionKeys[editType] && editId) {
    try {
      const mine = await campusLifeMine()
      if (!page.live(revision)) return
      const item = (mine[submissionKeys[editType]] || []).find((candidate) => candidate.id === editId)
      if (!item || (item.review_status || item.status) !== 'rejected' || !Number.isSafeInteger(Number(item.revision))) throw new Error('这条投稿已更新或不属于当前账号，请刷新投稿记录。')
      prefillSubmission(editType, item)
    } catch (cause) { if (page.live(revision)) error.value = campusErrorMessage(cause, '暂时无法读取这条待修改投稿。') }
  }
  if (page.live(revision)) await loadChoices()
}, { immediate: true, flush: 'sync' })

function splitRows(value, label) {
  return String(value || '').split('\n').map((row) => row.trim()).filter(Boolean).map((row, index) => {
    const parts = row.split('|').map((part) => part.trim())
    if (parts.length < 2) throw new Error(`${label}第 ${index + 1} 行请按“字段|字段”填写。`)
    return parts
  })
}

function shuttlePayload() {
  const stops = splitRows(form.value.stopsText, '站点').map(([direction, name]) => ({ direction, name }))
  const departures = splitRows(form.value.departuresText, '班次').map(([direction, day, time, stopName = '']) => ({ direction, serviceDay: day, time, stopName }))
  return { ...form.value, stops, departures }
}

function priceInCents(value) {
  if (value === '') return null
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new Error('价格需在 0 至 1,000,000 元之间。')
  return Math.round(price * 100)
}

function localTimestamp(value) {
  return value ? new Date(value).toISOString() : ''
}

async function publish() {
  if (saving.value) return
  const revision = page.begin()
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    const submittedKind = kind.value
    const values = { ...form.value }
    let result
    let payload
    if (kind.value === 'teacher') payload = values
    else if (kind.value === 'course') payload = values
    else if (kind.value === 'assignment') payload = values
    else if (kind.value === 'market') payload = { ...values, priceCents: priceInCents(values.price) }
    else if (kind.value === 'help') payload = { ...values, deadline: localTimestamp(values.deadline) }
    else if (kind.value === 'shuttle') payload = shuttlePayload()
    else if (kind.value === 'shuttle_correction') payload = { ...values }
    else if (kind.value === 'shuttle_exception') payload = { ...values }
    else if (kind.value === 'lost') payload = { ...values, occurredAt: values.occurredAt }
    else if (kind.value === 'event') payload = { ...values, startsAt: localTimestamp(values.startsAt), endsAt: localTimestamp(values.endsAt) }
    else if (kind.value === 'guide') payload = values
    if (editing.value) result = await resubmitCampusContent(editing.value.type, editing.value.id, editing.value.revision, payload)
    else if (kind.value === 'teacher') result = await submitCampusTeacher(payload)
    else if (kind.value === 'course') result = await submitCampusCourse(payload)
    else if (kind.value === 'assignment') result = await submitCampusTeachingAssignment(payload)
    else if (kind.value === 'market') result = await submitCampusMarketListing(payload)
    else if (kind.value === 'help') result = await submitCampusHelpTask(payload)
    else if (kind.value === 'shuttle') result = await submitCampusShuttleRoute(payload)
    else if (kind.value === 'shuttle_correction') result = await submitCampusShuttleCorrection(payload.routeId, payload.detail, payload.sourceUrl)
    else if (kind.value === 'shuttle_exception') result = await submitCampusShuttleException(payload)
    else if (kind.value === 'lost') result = await submitLostFoundItem(payload)
    else if (kind.value === 'event') result = await submitCampusEvent(payload)
    else if (kind.value === 'guide') result = await submitCampusGuide(payload)
    if (result && page.live(revision)) {
      message.value = editing.value ? '修改已重新提交审核。审核通过前不会出现在公开列表。' : '已提交审核。审核通过后才会出现在同校公开列表。'
      draft.value.forms[submittedKind] = defaults()[submittedKind]
      draft.value.kind = submittedKind
      editing.value = null
      if (kind.value === 'assignment') await loadChoices()
    }
  } catch (cause) { if (page.live(revision)) error.value = campusErrorMessage(cause, '提交没有完成，请检查填写内容后重试。') }
  finally { if (page.live(revision)) saving.value = false }
}

function kindChanged() {
  error.value = ''
  message.value = ''
  void loadChoices()
}

// 清空草稿要连本机存储一起抹掉，而且没有撤销、没有云端副本。
// 「清空当前草稿」和它旁边的「提交审核」挨得很近，误触一次就是半篇表单。
function askClearCurrentDraft() {
  confirm.ask({
    title: '清空当前这份草稿？',
    message: `「${options.find((item) => item.id === kind.value)?.title || '当前表单'}」里已填的内容会被删除，无法恢复。其它发布类型的草稿不受影响。`,
    confirmLabel: '清空这份草稿',
    tone: 'danger',
    onConfirm: clearCurrentDraft,
  })
}
function clearCurrentDraft() {
  const selectedKind = kind.value
  draft.value.forms[selectedKind] = defaults()[selectedKind]
  draft.value.kind = selectedKind
}
</script>

<template>
  <CampusLifeLayout title="统一发布" description="分享闲置、互助、失物或校园经验，让有用的信息被同学看见。">
    <template #default="{ profile }">
      <section v-if="!editing" class="campus-life-panel campus-publish-types">
        <FieldSet :disabled="saving">
          <FieldLegend>你想分享什么？</FieldLegend>
          <div class="campus-publish-options">
            <label v-for="item in options.filter((entry) => primaryKinds.includes(entry.id))" :key="item.id" class="campus-publish-choice" :class="{ 'is-selected': kind === item.id }"><input v-model="kind" type="radio" name="campus-publish-kind" :value="item.id" @change="kindChanged" /><component :is="optionIcons[item.id]" aria-hidden="true" /><span>{{ shortTitles[item.id] || item.title }}</span><Check v-if="kind === item.id" class="campus-publish-check" aria-hidden="true" /></label>
          </div><details class="campus-publish-more" :open="!primaryKinds.includes(kind)"><summary>补充课程与出行资料<ChevronDown aria-hidden="true" /></summary><div class="campus-publish-options"><label v-for="item in options.filter((entry) => !primaryKinds.includes(entry.id))" :key="item.id" class="campus-publish-choice" :class="{ 'is-selected': kind === item.id }"><input v-model="kind" type="radio" name="campus-publish-kind" :value="item.id" @change="kindChanged" /><component :is="optionIcons[item.id]" aria-hidden="true" /><span>{{ item.title }}</span><Check v-if="kind === item.id" class="campus-publish-check" aria-hidden="true" /></label></div></details>
        </FieldSet>
        <p class="campus-publish-type-note">{{ options.find((item) => item.id === kind)?.note }}</p>
      </section>
      <section class="campus-life-panel">
        <div class="campus-publish-form-heading"><div><h2>{{ editing ? '修改并重新提交' : options.find((item) => item.id === kind)?.title }}</h2><p>{{ editing ? '修改后会进入新一轮审核。' : '填写下方信息，审核通过后分享给同校同学。' }}</p></div><span class="campus-publish-save-note" role="status"><CheckCheck aria-hidden="true" />{{ !accountUser ? '登录后可保存草稿' : savedRevision ? '草稿已保存在本机' : '按账号保存本机草稿' }}</span></div>
        <p v-if="error" class="campus-life-inline-state error" role="alert">{{ error }}</p>
        <p v-if="message" class="campus-life-inline-state campus-life-success" role="status">{{ message }}</p>
        <form class="campus-publish-form" @submit.prevent="publish">
          <fieldset :disabled="saving" class="campus-publish-fieldset">
          <FieldGroup class="campus-life-form grid grid-cols-1 min-[760px]:grid-cols-2 gap-5">
          <template v-if="kind === 'teacher'">
            <Field><label>教师姓名 <input v-model="form.name" maxlength="100" required /></label></Field><Field><label>院系 <input v-model="form.department" maxlength="120" /></label></Field>
            <Field><label>研究方向（选填） <input v-model="form.researchDirections" maxlength="1000" /></label></Field><Field class="span-all"><label>官方公开简介 <textarea v-model="form.officialIntro" maxlength="3000" /></label></Field>
            <Field class="span-all"><label>官方公开资料 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label></Field>
            <p class="span-all campus-life-inline-state">不接受私人手机号、家庭地址、私人社交账号、行程、照片或头像。</p>
          </template>
          <template v-else-if="kind === 'course'">
            <Field><label>课程名称 <input v-model="form.name" maxlength="120" required /></label></Field><Field><label>院系 <input v-model="form.department" maxlength="120" /></label></Field>
            <Field class="span-all"><label>课程公开说明 <textarea v-model="form.description" maxlength="3000" /></label></Field><Field class="span-all"><label>资料来源 HTTPS 链接（可选） <input v-model="form.sourceUrl" type="url" maxlength="500" /></label></Field>
          </template>
          <template v-else-if="kind === 'assignment'">
            <p v-if="optionsLoading" class="span-all campus-life-state" role="status">正在读取已审核资料…</p>
            <Field><label>课程 <select v-model="form.courseId" required><option value="">选择已审核课程</option><option v-for="item in teachersCourses.courses" :key="item.id" :value="item.id">{{ item.name }}{{ item.department ? ` · ${item.department}` : '' }}</option></select></label></Field>
            <Field><label>教师 <select v-model="form.teacherId" required><option value="">选择已审核教师</option><option v-for="item in teachersCourses.teachers" :key="item.id" :value="item.id">{{ item.name }}{{ item.department ? ` · ${item.department}` : '' }}</option></select></label></Field>
            <Field><label>学期 <input v-model="form.term" maxlength="40" placeholder="例如：2026 秋" required /></label></Field><Field><label>授课安排来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" /></label></Field>
          </template>
          <template v-else-if="kind === 'market'">
            <Field><label>发布方式 <select v-model="form.listingType"><option value="sale">出售</option><option value="wanted">求购</option><option value="free">免费赠送</option></select></label></Field>
            <Field><label>分类 <select v-model="form.category"><option value="textbook">教材</option><option value="electronics">数码电子</option><option value="living">生活用品</option><option value="sports">运动装备</option><option value="dorm">宿舍用品</option><option value="clothing">服饰</option><option value="instrument">乐器</option><option value="other">其他</option></select></label></Field>
            <Field><label>标题 <input v-model="form.title" maxlength="100" required /></label></Field><Field v-if="form.listingType !== 'free'"><label>价格（元，可留空求购） <input v-model="form.price" type="number" min="0" max="1000000" step="0.01" /></label></Field>
            <Field><label>新旧程度 <input v-model="form.condition" maxlength="80" placeholder="如：九成新；求购可留空" /></label></Field><Field><label>安全交易区域 <input v-model="form.meetupArea" maxlength="120" placeholder="只写公共区域，如图书馆大厅" /></label></Field>
            <Field class="span-all"><label>物品说明与瑕疵 <textarea v-model="form.description" maxlength="3000" /></label></Field>
            <p class="span-all campus-life-inline-state">仅线下校园公共地点交易；平台不提供支付、资金托管或赔付服务。此版本暂不开放图片上传。</p>
          </template>
          <template v-else-if="kind === 'help'">
            <Field><label>互助类型 <select v-model="form.taskType"><option value="parcel">快递代取</option><option value="delivery">物品递送</option><option value="errand">校内跑腿</option><option value="temporary_help">临时求助</option><option value="moving">搬运协助</option><option value="daily_task">日常代办</option><option value="other">其他</option></select></label></Field>
            <Field><label>任务标题 <input v-model="form.title" maxlength="100" required /></label></Field><Field><label>取件 / 起始区域 <input v-model="form.pickupArea" maxlength="100" /></label></Field><Field><label>送达区域 <input v-model="form.deliveryArea" maxlength="100" /></label></Field>
            <Field><label>最晚完成时间 <input v-model="form.deadline" type="datetime-local" /></label></Field><Field class="span-all"><label>任务说明 <textarea v-model="form.description" maxlength="2000" /></label></Field>
            <p class="span-all campus-life-inline-state">禁止代考、代签到、代做作业、验证码代收和违规交易。不要填写手机、取件码、完整物流单号、宿舍房间号或证件信息。平台不处理资金。</p>
          </template>
          <template v-else-if="kind === 'shuttle'">
            <Field><label>线路名称 <input v-model="form.name" maxlength="100" required /></label></Field><Field><label>公开时刻表来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label></Field>
            <Field><label>生效日期 <input v-model="form.effectiveFrom" type="date" /></label></Field><Field><label>失效日期 <input v-model="form.effectiveTo" type="date" /></label></Field>
            <Field class="span-all"><label>经停站（每行：outbound 或 inbound | 站点名） <textarea v-model="form.stopsText" placeholder="outbound|东门\ninbound|西门" required /></label></Field>
            <Field class="span-all"><label>计划班次（每行：方向 | weekday / weekend / holiday | HH:mm | 上车站点） <textarea v-model="form.departuresText" placeholder="outbound|weekday|08:00|东门\ninbound|weekday|17:30|教学区" required /></label></Field>
            <p class="span-all campus-life-inline-state">页面只展示审核后的计划班次，不代表车辆实时位置。缺少来源的线路不会开放提交。</p>
          </template>
          <template v-else-if="kind === 'shuttle_correction'">
            <Field><label>线路 <select v-model="form.routeId" required><option value="">选择已审核线路</option><option v-for="item in shuttleRoutes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></Field>
            <Field class="span-all"><label>纠错内容 <textarea v-model="form.detail" maxlength="1500" required /></label></Field>
            <Field class="span-all"><label>来源 HTTPS 链接（选填） <input v-model="form.sourceUrl" type="url" maxlength="500" /></label></Field>
          </template>
          <template v-else-if="kind === 'shuttle_exception'">
            <Field><label>线路 <select v-model="form.routeId" required><option value="">选择已审核线路</option><option v-for="item in shuttleRoutes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></Field>
            <Field><label>适用日期 <input v-model="form.serviceDate" type="date" required /></label></Field>
            <Field><label>类型 <select v-model="form.exceptionType"><option value="suspended">临时停运</option><option value="additional">加班车</option><option value="changed">调整班次</option></select></label></Field>
            <Field><label>方向 <select v-model="form.direction"><option value="outbound">去程</option><option value="inbound">返程</option></select></label></Field>
            <Field v-if="form.exceptionType !== 'suspended'"><label>发车时间 <input v-model="form.departureTime" type="time" required /></label></Field>
            <Field><label>说明 <input v-model="form.note" maxlength="300" /></label></Field>
            <Field class="span-all"><label>官方来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label></Field>
          </template>
          <template v-else-if="kind === 'lost'">
            <Field><label>类型 <select v-model="form.mode"><option value="lost">我丢了</option><option value="found">我捡到了</option></select></label></Field><Field><label>物品分类 <select v-model="form.category"><option value="electronics">电子设备</option><option value="card">校园卡</option><option value="keys">钥匙</option><option value="documents">证件 / 文件</option><option value="clothing">衣物</option><option value="bag">包袋</option><option value="other">其他</option></select></label></Field>
            <Field><label>物品名称（不要写完整卡号） <input v-model="form.title" maxlength="100" required /></label></Field><Field><label>大致地点 <input v-model="form.approximateLocation" maxlength="120" /></label></Field><Field><label>发生日期 <input v-model="form.occurredAt" type="date" /></label></Field>
            <Field class="span-all"><label>公开描述（隐藏可用于认领核验的特征） <textarea v-model="form.description" maxlength="1500" /></label></Field>
            <p class="span-all campus-life-inline-state">暂不支持上传照片。认领核验特征会通过私密流程提交，不显示在公开页面。</p>
          </template>
          <template v-else-if="kind === 'event'">
            <Field><label>活动名称 <input v-model="form.title" maxlength="120" required /></label></Field><Field><label>组织方（不代表官方认证） <input v-model="form.organizer" maxlength="120" /></label></Field><Field><label>开始时间 <input v-model="form.startsAt" type="datetime-local" required /></label></Field><Field><label>结束时间 <input v-model="form.endsAt" type="datetime-local" required /></label></Field>
            <Field><label>活动地点 <input v-model="form.location" maxlength="160" /></label></Field><Field><label>名额（可留空） <input v-model="form.capacity" type="number" min="1" max="100000" /></label></Field><Field><label>报名链接 HTTPS <input v-model="form.signupUrl" type="url" maxlength="500" /></label></Field><Field><label>活动来源 HTTPS <input v-model="form.sourceUrl" type="url" maxlength="500" /></label></Field>
            <Field class="span-all"><label>活动说明 <textarea v-model="form.description" maxlength="3000" /></label></Field>
          </template>
          <template v-else-if="kind === 'guide'">
            <Field><label>指南标题 <input v-model="form.title" maxlength="120" required /></label></Field><Field><label>分类 <select v-model="form.category"><option value="new_student">新生入学</option><option value="administration">校园办事</option><option value="dormitory">宿舍生活</option><option value="food">食堂攻略</option><option value="printing">打印与学习资源</option><option value="transport">校园交通</option><option value="facilities">设施使用</option><option value="exam">考试与选课</option><option value="graduation">毕业季</option><option value="safety">校园安全</option><option value="other">其他</option></select></label></Field>
            <Field><label>信息类型 <select v-model="form.sourceType"><option value="student_experience">学生经验</option><option value="official_public">官方公开信息</option><option value="merchant_submission">商户投稿</option></select></label></Field><Field><label>有效期 <input v-model="form.expiresOn" type="date" /></label></Field><Field class="span-all"><label>正文 <textarea v-model="form.body" maxlength="10000" required /></label></Field>
            <Field class="span-all"><label>来源链接 HTTPS <input v-model="form.sourceUrl" type="url" maxlength="500" :required="form.sourceType === 'official_public'" /></label></Field>
            <p v-if="form.sourceType === 'student_experience'" class="span-all campus-life-inline-state">学生经验会明确标注为经验信息，不会包装成学校规定。</p>
          </template>
          <CampusPublishPreview :form="form" :title="options.find(item => item.id === kind)?.title" :school="profile?.school" :campus="profile?.campus" />
          <div class="span-all campus-life-actions campus-publish-footer"><span><ShieldCheck aria-hidden="true" />审核通过后公开</span><Button variant="ghost" type="button" :disabled="saving" @click="askClearCurrentDraft">清空当前草稿</Button><Button type="submit" :disabled="saving || (kind === 'assignment' && optionsLoading)"><FilePenLine data-icon="inline-start" />{{ saving ? '正在提交…' : '提交审核' }}</Button></div>
          </FieldGroup>
          </fieldset>
        </form>
      </section>
      <CampusConfirmDialog :request="confirmRequest" @confirm="confirm.confirm()" @close="confirm.close()" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-publish-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.campus-publish-choice{position:relative;display:flex;align-items:center;gap:9px;min-height:54px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-9);color:var(--text);font-size:var(--fs-12);line-height:1.5;cursor:pointer}.campus-publish-choice>svg{width:18px;height:18px;flex-shrink:0;color:var(--muted)}.campus-publish-choice input{position:absolute;opacity:0;width:1px;height:1px}.campus-publish-choice:has(:focus-visible){outline:2px solid var(--primary);outline-offset:3px}.campus-publish-choice.is-selected{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.campus-publish-choice.is-selected>svg{color:var(--primary)}.campus-publish-choice .campus-publish-check{width:15px;height:15px;margin-left:auto}.campus-publish-type-note{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-publish-form-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.campus-publish-form-heading p{margin:7px 0 0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-publish-save-note{display:flex;align-items:center;gap:5px;flex-shrink:0;color:var(--muted);font-size:var(--fs-11)}.campus-publish-save-note svg{width:16px;height:16px;color:var(--success)}.campus-publish-footer>span{display:flex;align-items:center;gap:6px;margin-right:auto;color:var(--muted);font-size:var(--fs-12)}.campus-publish-footer>span svg{width:16px;height:16px}.campus-publish-form :deep([data-slot=field]){gap:0;min-width:0}.campus-publish-types :deep([data-slot=field-legend]){margin-bottom:14px}.campus-publish-types :deep(fieldset){gap:0}
@media(max-width:520px){.campus-publish-options{grid-template-columns:repeat(2,minmax(0,1fr))}.campus-publish-choice{padding:10px;min-height:58px}.campus-publish-form-heading{flex-direction:column;gap:10px}.campus-publish-footer>span{flex-basis:100%;margin-bottom:4px}.campus-publish-footer>button{flex:1}}
</style>
