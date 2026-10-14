<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import { useCampusLifeDraft } from '../../composables/campusLifeDraft.js'
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
const draft = useCampusLifeDraft('unified-publisher', { kind: 'market', forms: defaults() })
const formDefaults = defaults()
if (!draft.value.forms || typeof draft.value.forms !== 'object') draft.value.forms = formDefaults
for (const item of options) if (!draft.value.forms[item.id]) draft.value.forms[item.id] = formDefaults[item.id]
const kind = computed({ get: () => draft.value.kind, set: (value) => { draft.value.kind = value } })
const form = computed(() => draft.value.forms[kind.value])
const teachersCourses = ref({ courses: [], teachers: [], assignments: [], reviews: [] })
const shuttleRoutes = ref([])
const editing = ref(null)
const optionsLoading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')

async function loadChoices() {
  optionsLoading.value = true
  try {
    if (kind.value === 'assignment') teachersCourses.value = await campusCourses()
    if (['shuttle_correction', 'shuttle_exception'].includes(kind.value)) shuttleRoutes.value = (await campusShuttles()).routes || []
  } catch (cause) { error.value = cause?.message || '暂时无法读取已审核校园资料。' }
  finally { optionsLoading.value = false }
}
const submissionKeys = {
  teacher: 'teachers', course: 'courses', assignment: 'assignments', market: 'listings', help: 'helpTasks',
  shuttle: 'shuttleRoutes', shuttle_correction: 'shuttleCorrections', shuttle_exception: 'shuttleExceptions',
  lost: 'lostFound', event: 'events', guide: 'guides',
}
function localDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
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
onMounted(async () => {
  const requested = String(route.query.kind || '')
  if (options.some((item) => item.id === requested)) kind.value = requested
  const editType = String(route.query.editType || '')
  const editId = String(route.query.id || '')
  if (submissionKeys[editType] && editId) {
    try {
      const mine = await campusLifeMine()
      const item = (mine[submissionKeys[editType]] || []).find((candidate) => candidate.id === editId)
      if (!item || (item.review_status || item.status) !== 'rejected' || !Number.isSafeInteger(Number(item.revision))) throw new Error('这条投稿已更新或不属于当前账号，请刷新投稿记录。')
      prefillSubmission(editType, item)
    } catch (cause) { error.value = cause?.message || '暂时无法读取这条待修改投稿。' }
  }
  await loadChoices()
})

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
    if (result) {
      message.value = editing.value ? '修改已重新提交审核。审核通过前不会出现在公开列表。' : '已提交审核。审核通过后才会出现在同校公开列表。'
      draft.clear()
      draft.value.kind = submittedKind
      editing.value = null
      if (kind.value === 'assignment') await loadChoices()
    }
  } catch (cause) { error.value = cause?.message || '提交没有完成，请检查填写内容后重试。' }
  finally { saving.value = false }
}

function kindChanged() {
  error.value = ''
  message.value = ''
  void loadChoices()
}
function clearCurrentDraft() {
  const selectedKind = kind.value
  draft.clear()
  draft.value.kind = selectedKind
}
</script>

<template>
  <CampusLifeLayout title="统一发布" description="所有校园内容从同一入口提交；每类内容使用独立表单，审核通过后才会公开。">
    <template #default>
      <section v-if="!editing" class="campus-life-panel">
        <h2>选择发布内容</h2>
        <div class="campus-life-grid">
          <button v-for="item in options" :key="item.id" class="campus-life-card campus-publish-choice" :aria-pressed="kind === item.id" type="button" @click="kind = item.id; kindChanged()">
            <h3>{{ item.title }}</h3><p>{{ item.note }}</p>
          </button>
        </div>
      </section>
      <section class="campus-life-panel">
        <div><span class="campus-life-tag">{{ options.find((item) => item.id === kind)?.title }}</span><h2>{{ editing ? '修改并重新提交' : '分步填写并提交' }}</h2><p v-if="editing">修改会覆盖这条被驳回的投稿并进入新一轮审核。</p><p v-else>草稿只保存在当前登录账号的本机浏览器中。请勿在公开内容中填写私人联系方式。</p></div>
        <p v-if="error" class="campus-life-inline-state error" role="alert">{{ error }}</p>
        <p v-if="message" class="campus-life-inline-state campus-life-success" role="status">{{ message }}</p>
        <form class="campus-life-form" @submit.prevent="publish">
          <template v-if="kind === 'teacher'">
            <label>教师姓名 <input v-model="form.name" maxlength="100" required /></label><label>院系 <input v-model="form.department" maxlength="120" /></label>
            <label>研究方向（选填） <input v-model="form.researchDirections" maxlength="1000" /></label><label class="span-all">官方公开简介 <textarea v-model="form.officialIntro" maxlength="3000" /></label>
            <label class="span-all">官方公开资料 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label>
            <p class="span-all campus-life-inline-state">不接受私人手机号、家庭地址、私人社交账号、行程、照片或头像。</p>
          </template>
          <template v-else-if="kind === 'course'">
            <label>课程名称 <input v-model="form.name" maxlength="120" required /></label><label>院系 <input v-model="form.department" maxlength="120" /></label>
            <label class="span-all">课程公开说明 <textarea v-model="form.description" maxlength="3000" /></label><label class="span-all">资料来源 HTTPS 链接（可选） <input v-model="form.sourceUrl" type="url" maxlength="500" /></label>
          </template>
          <template v-else-if="kind === 'assignment'">
            <p v-if="optionsLoading" class="span-all campus-life-state" role="status">正在读取已审核资料…</p>
            <label>课程 <select v-model="form.courseId" required><option value="">选择已审核课程</option><option v-for="item in teachersCourses.courses" :key="item.id" :value="item.id">{{ item.name }}{{ item.department ? ` · ${item.department}` : '' }}</option></select></label>
            <label>教师 <select v-model="form.teacherId" required><option value="">选择已审核教师</option><option v-for="item in teachersCourses.teachers" :key="item.id" :value="item.id">{{ item.name }}{{ item.department ? ` · ${item.department}` : '' }}</option></select></label>
            <label>学期 <input v-model="form.term" maxlength="40" placeholder="例如：2026 秋" required /></label><label>授课安排来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" /></label>
          </template>
          <template v-else-if="kind === 'market'">
            <label>发布方式 <select v-model="form.listingType"><option value="sale">出售</option><option value="wanted">求购</option><option value="free">免费赠送</option></select></label>
            <label>分类 <select v-model="form.category"><option value="textbook">教材</option><option value="electronics">数码电子</option><option value="living">生活用品</option><option value="sports">运动装备</option><option value="dorm">宿舍用品</option><option value="clothing">服饰</option><option value="instrument">乐器</option><option value="other">其他</option></select></label>
            <label>标题 <input v-model="form.title" maxlength="100" required /></label><label v-if="form.listingType !== 'free'">价格（元，可留空求购） <input v-model="form.price" type="number" min="0" max="1000000" step="0.01" /></label>
            <label>新旧程度 <input v-model="form.condition" maxlength="80" placeholder="如：九成新；求购可留空" /></label><label>安全交易区域 <input v-model="form.meetupArea" maxlength="120" placeholder="只写公共区域，如图书馆大厅" /></label>
            <label class="span-all">物品说明与瑕疵 <textarea v-model="form.description" maxlength="3000" /></label>
            <p class="span-all campus-life-inline-state">仅线下校园公共地点交易；平台不提供支付、资金托管或赔付服务。此版本暂不开放图片上传。</p>
          </template>
          <template v-else-if="kind === 'help'">
            <label>互助类型 <select v-model="form.taskType"><option value="parcel">快递代取</option><option value="delivery">物品递送</option><option value="errand">校内跑腿</option><option value="temporary_help">临时求助</option><option value="moving">搬运协助</option><option value="daily_task">日常代办</option><option value="other">其他</option></select></label>
            <label>任务标题 <input v-model="form.title" maxlength="100" required /></label><label>取件 / 起始区域 <input v-model="form.pickupArea" maxlength="100" /></label><label>送达区域 <input v-model="form.deliveryArea" maxlength="100" /></label>
            <label>最晚完成时间 <input v-model="form.deadline" type="datetime-local" /></label><label class="span-all">任务说明 <textarea v-model="form.description" maxlength="2000" /></label>
            <p class="span-all campus-life-inline-state">禁止代考、代签到、代做作业、验证码代收和违规交易。不要填写手机、取件码、完整物流单号、宿舍房间号或证件信息。平台不处理资金。</p>
          </template>
          <template v-else-if="kind === 'shuttle'">
            <label>线路名称 <input v-model="form.name" maxlength="100" required /></label><label>公开时刻表来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label>
            <label>生效日期 <input v-model="form.effectiveFrom" type="date" /></label><label>失效日期 <input v-model="form.effectiveTo" type="date" /></label>
            <label class="span-all">经停站（每行：outbound 或 inbound | 站点名） <textarea v-model="form.stopsText" placeholder="outbound|东门\ninbound|西门" required /></label>
            <label class="span-all">计划班次（每行：方向 | weekday / weekend / holiday | HH:mm | 上车站点） <textarea v-model="form.departuresText" placeholder="outbound|weekday|08:00|东门\ninbound|weekday|17:30|教学区" required /></label>
            <p class="span-all campus-life-inline-state">页面只展示审核后的计划班次，不代表车辆实时位置。缺少来源的线路不会开放提交。</p>
          </template>
          <template v-else-if="kind === 'shuttle_correction'">
            <label>线路 <select v-model="form.routeId" required><option value="">选择已审核线路</option><option v-for="item in shuttleRoutes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label class="span-all">纠错内容 <textarea v-model="form.detail" maxlength="1500" required /></label>
            <label class="span-all">来源 HTTPS 链接（选填） <input v-model="form.sourceUrl" type="url" maxlength="500" /></label>
          </template>
          <template v-else-if="kind === 'shuttle_exception'">
            <label>线路 <select v-model="form.routeId" required><option value="">选择已审核线路</option><option v-for="item in shuttleRoutes" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label>适用日期 <input v-model="form.serviceDate" type="date" required /></label>
            <label>类型 <select v-model="form.exceptionType"><option value="suspended">临时停运</option><option value="additional">加班车</option><option value="changed">调整班次</option></select></label>
            <label>方向 <select v-model="form.direction"><option value="outbound">去程</option><option value="inbound">返程</option></select></label>
            <label v-if="form.exceptionType !== 'suspended'">发车时间 <input v-model="form.departureTime" type="time" required /></label>
            <label>说明 <input v-model="form.note" maxlength="300" /></label>
            <label class="span-all">官方来源 HTTPS 链接 <input v-model="form.sourceUrl" type="url" maxlength="500" required /></label>
          </template>
          <template v-else-if="kind === 'lost'">
            <label>类型 <select v-model="form.mode"><option value="lost">我丢了</option><option value="found">我捡到了</option></select></label><label>物品分类 <select v-model="form.category"><option value="electronics">电子设备</option><option value="card">校园卡</option><option value="keys">钥匙</option><option value="documents">证件 / 文件</option><option value="clothing">衣物</option><option value="bag">包袋</option><option value="other">其他</option></select></label>
            <label>物品名称（不要写完整卡号） <input v-model="form.title" maxlength="100" required /></label><label>大致地点 <input v-model="form.approximateLocation" maxlength="120" /></label><label>发生日期 <input v-model="form.occurredAt" type="date" /></label>
            <label class="span-all">公开描述（隐藏可用于认领核验的特征） <textarea v-model="form.description" maxlength="1500" /></label>
            <p class="span-all campus-life-inline-state">暂不支持上传照片。认领核验特征会通过私密流程提交，不显示在公开页面。</p>
          </template>
          <template v-else-if="kind === 'event'">
            <label>活动名称 <input v-model="form.title" maxlength="120" required /></label><label>组织方（不代表官方认证） <input v-model="form.organizer" maxlength="120" /></label><label>开始时间 <input v-model="form.startsAt" type="datetime-local" required /></label><label>结束时间 <input v-model="form.endsAt" type="datetime-local" required /></label>
            <label>活动地点 <input v-model="form.location" maxlength="160" /></label><label>名额（可留空） <input v-model="form.capacity" type="number" min="1" max="100000" /></label><label>报名链接 HTTPS <input v-model="form.signupUrl" type="url" maxlength="500" /></label><label>活动来源 HTTPS <input v-model="form.sourceUrl" type="url" maxlength="500" /></label>
            <label class="span-all">活动说明 <textarea v-model="form.description" maxlength="3000" /></label>
          </template>
          <template v-else-if="kind === 'guide'">
            <label>指南标题 <input v-model="form.title" maxlength="120" required /></label><label>分类 <select v-model="form.category"><option value="new_student">新生入学</option><option value="administration">校园办事</option><option value="dormitory">宿舍生活</option><option value="food">食堂攻略</option><option value="printing">打印与学习资源</option><option value="transport">校园交通</option><option value="facilities">设施使用</option><option value="exam">考试与选课</option><option value="graduation">毕业季</option><option value="safety">校园安全</option><option value="other">其他</option></select></label>
            <label>信息类型 <select v-model="form.sourceType"><option value="student_experience">学生经验</option><option value="official_public">官方公开信息</option><option value="merchant_submission">商户投稿</option></select></label><label>有效期 <input v-model="form.expiresOn" type="date" /></label><label class="span-all">正文 <textarea v-model="form.body" maxlength="10000" required /></label>
            <label class="span-all">来源链接 HTTPS <input v-model="form.sourceUrl" type="url" maxlength="500" :required="form.sourceType === 'official_public'" /></label>
            <p v-if="form.sourceType === 'student_experience'" class="span-all campus-life-inline-state">学生经验会明确标注为经验信息，不会包装成学校规定。</p>
          </template>
          <div class="span-all campus-life-actions"><button class="btn btn-primary" type="submit" :disabled="saving || (kind === 'assignment' && optionsLoading)">{{ saving ? '正在提交…' : '提交审核' }}</button><button class="btn btn-ghost" type="button" @click="clearCurrentDraft">清空当前草稿</button></div>
        </form>
      </section>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-publish-choice{text-align:left;color:inherit;cursor:pointer}.campus-publish-choice[aria-pressed="true"]{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}
</style>
