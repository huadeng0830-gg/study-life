<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { buildNoticeUnderstanding, findNoticeChanges, NOTICE_TYPE_OPTIONS, parseNotice } from '../composables/noticeParser.js'
import { buildNoticeCandidates, MAX_NOTICE_SEGMENTS, SEGMENT_PROCESS_OPTIONS } from '../composables/noticeSegments.js'
import { findUniqueCourseByName } from '../composables/courseLinks.js'
import { isSupported as voiceSupportedByEnv, transcribe, voiceErrorMessage, VOICE_STATES } from '../composables/voiceInput.js'

const props = defineProps({ open: Boolean, tasks: { type: Array, default: () => [] }, courses: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'commit'])
const source = ref('')
const parsed = ref(null)
const matches = ref([])
const selectedId = ref('')
const useExisting = ref(false)
const processKey = ref('task')
const selectedItemIds = ref([])
const editingField = ref('')
const editingAction = ref(false)
const editingSource = ref(false)
const showMore = ref(false)
const showProcessOptions = ref(false)
const error = ref('')
const clipboardMessage = ref('')
const copied = ref(false)
// 多段粘贴：整段文本切出来的候选，逐段勾选、各自决定处理方式。
const segments = ref([])
const segmentOverflow = ref(0)
const selectedSegmentIds = ref([])
const segmentProcess = ref({})
const voiceState = ref(VOICE_STATES.idle)
const listening = ref(false)
const voiceMessage = ref('')
const voiceSupported = voiceSupportedByEnv()
const ocrKind = ref('homework')
const ocrBusy = ref(false)
const ocrProgress = ref(0)
const ocrMessage = ref('')
let recognizer = null
let voiceBase = ''
let voiceRun = 0
let ocrRun = 0
let ocrController = null

const understanding = computed(() => buildNoticeUnderstanding(parsed.value))
const selectedTask = computed(() => props.tasks.find((task) => task.id === selectedId.value) ?? null)
const itemList = computed(() => parsed.value?.items?.length ? parsed.value.items : parsed.value ? [parsed.value] : [])
const selectedItems = computed(() => itemList.value.filter((item) => selectedItemIds.value.includes(item.id || 'single')))
const updatePreview = computed(() => selectedTask.value
  ? taskUpdateProposal(selectedTask.value, selectedItems.value[0] || parsed.value)
  : { patch: {}, rows: [], courseUnmatched: false })
// 段数 ≥ 2 时走多段确认页；只有 1 段时保持原单条流程不动（避免单条通知也多一层界面）
const multiMode = computed(() => segments.value.length > 1)
const selectedSegments = computed(() => segments.value.filter((row) => selectedSegmentIds.value.includes(row.id)))
const segmentProcessLabel = (row) => SEGMENT_PROCESS_OPTIONS.find((option) => option.key === (segmentProcess.value[row.id] ?? row.recommendation.key))?.label ?? '创建待办'
const processLabel = computed(() => ({ task: '创建待办', homework: '添加作业', event: '加入日程', note: '保存通知' }[processKey.value] || '保存通知'))
const actionLabel = computed(() => {
  if (multiMode.value) return selectedSegments.value.length > 1 ? `添加 ${selectedSegments.value.length} 项` : '按确认内容保存'
  return selectedItems.value.length > 1 ? `添加 ${selectedItems.value.length} 项` : processLabel.value
})
const extraFields = computed(() => {
  if (!parsed.value) return []
  return [
    { key: 'dueDate', label: '截止日期', type: 'date' },
    { key: 'dueTime', label: '时间', type: 'time' },
    { key: 'location', label: '地点', type: 'text' },
    { key: 'course', label: '所属课程', type: 'text' },
    { key: 'reminder', label: '提醒', type: 'text' },
    { key: 'note', label: '补充备注', type: 'textarea' },
  ].filter((item) => !parsed.value[item.key])
})

watch(() => props.open, (open) => {
  if (!open) {
    stopVoice(true)
    cancelOcr()
    return
  }
  source.value = ''; parsed.value = null; matches.value = []; selectedId.value = ''; selectedItemIds.value = []
  segments.value = []; segmentOverflow.value = 0; selectedSegmentIds.value = []; segmentProcess.value = {}
  voiceState.value = VOICE_STATES.idle; listening.value = false; voiceMessage.value = ''
  ocrKind.value = 'homework'; ocrProgress.value = 0; ocrMessage.value = ''
  useExisting.value = false; processKey.value = 'task'; editingField.value = ''; editingAction.value = false; editingSource.value = false
  showMore.value = false; showProcessOptions.value = false; error.value = ''; clipboardMessage.value = ''
  void readClipboard()
})
onBeforeUnmount(() => {
  stopVoice(true)
  cancelOcr()
})

async function readClipboard() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) { clipboardMessage.value = '无法自动读取剪贴板，请按 Ctrl + V 粘贴通知。'; return }
  try {
    const value = await navigator.clipboard.readText()
    if (!props.open) return
    if (value.trim()) { source.value = value; analyze() } else clipboardMessage.value = '剪贴板为空，请按 Ctrl + V 粘贴通知。'
  } catch { clipboardMessage.value = '浏览器未授权读取剪贴板，请按 Ctrl + V 粘贴通知。' }
}

/** 段 → 界面行。切段与理解已在 noticeSegments 里分离，这里只做展示与默认值。 */
function rowsFromCandidates(result) {
  return result.candidates.map((candidate) => {
    const one = buildNoticeUnderstanding(candidate.parsed)
    return {
      id: candidate.id,
      index: candidate.index,
      text: candidate.rawText,
      parsed: candidate.parsed,
      title: candidate.parsed.title || '待处理通知',
      type: candidate.parsed.type,
      summary: one.summary,
      facts: one.facts,
      recommendation: one.recommendation,
      recommendationKey: one.recommendation.key,
    }
  })
}

function analyze() {
  error.value = ''
  if (!source.value.trim()) { error.value = '请先粘贴老师或班群通知'; return }
  try {
    const next = parseNotice(source.value, props.courses)
    parsed.value = next; matches.value = findNoticeChanges(next, props.tasks); selectedId.value = matches.value[0]?.task.id ?? ''; useExisting.value = false
    processKey.value = next.type === '会议' || next.type === '考试' ? 'event' : next.type === '作业' ? 'homework' : next.type === '通知' ? 'note' : 'task'
    selectedItemIds.value = (next.items?.length ? next.items : [{ id: 'single' }]).map((item) => item.id || 'single')
    editingField.value = ''; editingAction.value = false; editingSource.value = false; showMore.value = false; showProcessOptions.value = false
    // 多段粘贴：一次粘进来的东西多于一条通知时，逐段列出让用户勾选。
    // 切段纯函数在这里是**唯一**入口，语音侧也走它（不写第二份）。
    const result = buildNoticeCandidates(source.value, { courses: props.courses, mode: 'paste' })
    segments.value = rowsFromCandidates(result)
    segmentOverflow.value = result.overflowCount
    // 默认全选：多粘进来的通知多半都是想要的，不默认全选等于要用户重做一遍选择。
    // 但**写入仍然只发生在 save()**，勾选只是候选状态。
    selectedSegmentIds.value = segments.value.map((row) => row.id)
    segmentProcess.value = Object.fromEntries(segments.value.map((row) => [row.id, row.recommendation.key]))
  } catch { parsed.value = null; matches.value = []; segments.value = []; selectedSegmentIds.value = []; error.value = '解析失败，原始通知仍已保留，请修改后重试。' }
}

/** 只对最终结果切段：interim 是半句话，切了等于凭空造一条（"周五" / "周五交报告"）。 */
function analyzeVoice(finalText) {
  const text = String(finalText || '').trim()
  if (!text) { error.value = '没有听到内容，请手动输入。'; return }
  source.value = text
  error.value = ''
  try {
    const next = parseNotice(text, props.courses)
    parsed.value = next; matches.value = findNoticeChanges(next, props.tasks); selectedId.value = matches.value[0]?.task.id ?? ''; useExisting.value = false
    processKey.value = next.type === '会议' || next.type === '考试' ? 'event' : next.type === '作业' ? 'homework' : next.type === '通知' ? 'note' : 'task'
    selectedItemIds.value = (next.items?.length ? next.items : [{ id: 'single' }]).map((item) => item.id || 'single')
    editingField.value = ''; editingAction.value = false; showMore.value = false; showProcessOptions.value = false
    // mode='voice'：连续说话没有换行，只能靠分句标点断；粘贴模式按句断是危险的。
    const result = buildNoticeCandidates(text, { courses: props.courses, mode: 'voice' })
    segments.value = rowsFromCandidates(result)
    segmentOverflow.value = result.overflowCount
    selectedSegmentIds.value = segments.value.map((row) => row.id)
    segmentProcess.value = Object.fromEntries(segments.value.map((row) => [row.id, row.recommendation.key]))
    voiceMessage.value = segments.value.length > 1 ? `识别到 ${segments.value.length} 件事，请逐条确认。` : '识别完成。'
  } catch { parsed.value = null; matches.value = []; segments.value = []; selectedSegmentIds.value = []; error.value = '解析失败，请手动输入。' }
}

function stopVoice(discard = false) {
  if (discard) voiceRun += 1
  const current = recognizer
  recognizer = null
  listening.value = false
  current?.stop()
}

function toggleVoice() {
  // 降级路径必须原样保留：浏览器没有 Web Speech API 或没有麦克风权限时，
  // 只提示一句，粘贴框与键盘输入照常可用（不能因为加了语音就把手动输入挤掉）。
  if (!voiceSupported) { voiceMessage.value = '当前浏览器不支持语音识别，请手动输入'; return }
  if (listening.value) { stopVoice(); return }
  voiceMessage.value = ''
  error.value = ''
  voiceBase = source.value.trim()
  const run = ++voiceRun
  recognizer = transcribe({
    continuous: true,
    maxSeconds: 60,
    // 两段 final 结果之间放逗号：连续说话时浏览器可能不给任何标点，
    // 首尾相接会读成一句连写的话。joinWith 默认是空串，这里显式要分隔。
    joinWith: '，',
    onStateChange: (state) => { if (run === voiceRun) voiceState.value = state },
    onResult: (finalText, interimText) => {
      if (run !== voiceRun) return
      // 中间态只更新输入框，**不触发解析**（半句话不该被当成一条通知）
      const joined = (voiceBase ? `${voiceBase} ` : '') + finalText + interimText
      if (joined.trim()) source.value = joined.trim()
    },
    onError: (code) => {
      if (run !== voiceRun) return
      voiceState.value = VOICE_STATES.error
      listening.value = false
      recognizer = null
      voiceMessage.value = voiceErrorMessage(code)
    },
    onEnd: (finalText) => {
      if (run !== voiceRun) return
      voiceState.value = VOICE_STATES.done
      listening.value = false
      recognizer = null
      // Web Speech 的 finalText 只包含本轮语音，不包含开始前已有的粘贴/输入内容。
      // UI 中间态早已显示两者拼接，所以最终解析也必须保留 voiceBase。
      const finalValue = String(finalText || '').trim()
      const base = voiceBase.trim()
      const current = source.value.trim()
      const currentHasTranscript = Boolean(current && (!base || (current.startsWith(base) && current.length > base.length)))
      const combined = currentHasTranscript
        ? current
        : [base, finalValue].filter(Boolean).join(' ') || current
      analyzeVoice(combined)
    },
  })
  if (!recognizer) { voiceMessage.value = '语音识别暂不可用，请手动输入'; return }
  listening.value = true
  voiceState.value = VOICE_STATES.listening
  recognizer.start()
}

function cancelOcr() {
  ocrRun += 1
  ocrController?.abort()
  ocrController = null
  ocrBusy.value = false
}

async function readOcrImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type?.startsWith('image/')) { error.value = '请选择图片文件'; return }
  cancelOcr()
  const run = ++ocrRun
  const controller = new AbortController()
  ocrController = controller
  ocrBusy.value = true
  ocrProgress.value = 0
  ocrMessage.value = '正在准备本机 OCR…'
  error.value = ''
  try {
    const { performOCR } = await import('../composables/ocrPipeline.js')
    const result = await performOCR(file, (progress) => {
      if (run !== ocrRun) return
      ocrProgress.value = Number(progress?.progress) || 0
      ocrMessage.value = progress?.stage || '正在识别截图…'
    }, { kind: ocrKind.value, signal: controller.signal })
    if (run !== ocrRun || !props.open) return
    const rowText = (result.regions || []).map((row) => row.text).filter(Boolean).join('\n')
    const extractedText = (rowText || result.text || '').trim()
    if (!extractedText) throw new Error('没有识别到文字，请换张更清晰的图片。')
    source.value = extractedText
    parsed.value = null
    segments.value = []
    analyze()
    if (!error.value) ocrMessage.value = `截图文字已读取（${Math.round(result.confidence || 0)}%），请核对候选后再保存。`
  } catch (reason) {
    if (run !== ocrRun || reason?.name === 'AbortError') return
    error.value = reason instanceof Error ? reason.message : '截图识别失败，请重试。'
    ocrMessage.value = ''
  } finally {
    if (run === ocrRun) {
      ocrBusy.value = false
      ocrController = null
    }
  }
}

function toggleSegment(id) {
  selectedSegmentIds.value = selectedSegmentIds.value.includes(id) ? selectedSegmentIds.value.filter((value) => value !== id) : [...selectedSegmentIds.value, id]
}
function toggleAllSegments() {
  selectedSegmentIds.value = selectedSegmentIds.value.length === segments.value.length ? [] : segments.value.map((row) => row.id)
}

function setType(type) {
  if (!parsed.value) return
  parsed.value.type = type; parsed.value.actionText = ''; processKey.value = buildNoticeUnderstanding(parsed.value).recommendation.key
}
function editField(key) { editingField.value = editingField.value === key ? '' : key; error.value = '' }
function beginActionEdit() { if (!parsed.value) return; parsed.value.actionText = understanding.value.actionText; editingAction.value = true }
function finishActionEdit() { if (!parsed.value?.actionText?.trim()) parsed.value.actionText = understanding.value.actionText; editingAction.value = false }
function typeFor(key) { return key === 'dueDate' ? 'date' : key === 'dueTime' ? 'time' : 'text' }
function dateText(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || ''
  const [, month, day] = value.split('-'); return `${Number(month)}月${Number(day)}日`
}
function factText(fact) { return fact.kind === 'date' ? dateText(fact.value) : fact.value }
function toggleItem(id) { selectedItemIds.value = selectedItemIds.value.includes(id) ? selectedItemIds.value.filter((value) => value !== id) : [...selectedItemIds.value, id] }
function taskUpdateProposal(task, item) {
  if (!parsed.value || !task) return { patch: {}, rows: [], courseUnmatched: false }
  const patch = {}
  const rows = []
  const displayValue = (key, value) => {
    if (key === 'dueDate') return dateText(value) || '未设置'
    if (key === 'priority') return value === 'high' ? '高' : '普通'
    if (key === 'title') return value || '未填写'
    return value || (key === 'note' ? '未填写' : '未设置')
  }
  const add = (key, label, value, before = task[key]) => {
    if (value === undefined || value === null || value === '') return
    if (String(before ?? '') === String(value)) return
    patch[key] = value
    rows.push([label, displayValue(key, before), displayValue(key, value)])
  }

  const incomingTitle = item?.id && item.id !== 'single'
    ? String(item.title || '').trim()
    : String(parsed.value.actionText || '').trim()
  if (incomingTitle && incomingTitle !== '无需操作') add('title', '标题', incomingTitle)

  const dueDate = item?.dueDate || parsed.value.dueDate
  const dueTime = item?.dueTime || parsed.value.dueTime
  add('dueDate', '截止日期', dueDate)
  add('dueTime', '截止时间', dueTime)

  const courseName = String(item?.course || parsed.value.course || '').trim()
  const matchedCourse = findUniqueCourseByName(props.courses, courseName)
  const courseUnmatched = Boolean(courseName && !matchedCourse && courseName !== String(task.course || '').trim())
  if (matchedCourse) {
    const oldCourse = task.course || props.courses.find((course) => course.id === task.courseId)?.name || ''
    add('course', '课程', matchedCourse.name, oldCourse)
    if (task.courseId !== matchedCourse.id) {
      patch.courseId = matchedCourse.id
      if (oldCourse === matchedCourse.name) {
        const linkedCourse = props.courses.find((course) => course.id === task.courseId)
        rows.push(['课程关联', linkedCourse?.name || '未关联', matchedCourse.name])
      }
    }
  }

  if (parsed.value.priority === 'high') add('priority', '优先级', 'high', task.priority === 'high' ? 'high' : 'normal')

  const noteParts = [parsed.value.note?.trim() || '']
  if (item?.location?.trim() && !noteParts[0].includes(item.location.trim())) noteParts.push(`地点：${item.location.trim()}`)
  if (parsed.value.reminder?.trim() && !noteParts.join('').includes(parsed.value.reminder.trim())) noteParts.push(`提醒：${parsed.value.reminder.trim()}`)
  const existingNote = String(task.note || '').trim()
  const addedNotes = noteParts.filter((part) => part && !existingNote.includes(part))
  if (addedNotes.length) {
    const nextNote = [existingNote, ...addedNotes].filter(Boolean).join('；')
    patch.note = nextNote
    rows.push(['备注', existingNote || '未填写', nextNote])
  }

  const rawText = String(parsed.value.rawText || source.value || '').trim()
  if (rawText) {
    const previousSource = String(task.sourceText || '')
    patch.sourceText = previousSource && !previousSource.includes(rawText)
      ? `${previousSource}\n\n${rawText}`
      : previousSource || rawText
    patch.rawText = rawText
    patch.normalizedText = parsed.value.normalizedText
    patch.updatedFromNoticeAt = new Date().toISOString()
    patch.noticeType = parsed.value.type
  }

  return { patch, rows, courseUnmatched }
}
async function copyRaw() {
  try { await navigator.clipboard.writeText(parsed.value?.rawText || source.value); copied.value = true; window.setTimeout(() => { copied.value = false }, 1600) } catch { copied.value = false }
}
function payloadFor(item) {
  const fallbackTitle = item.id && item.id !== 'single' ? item.title : parsed.value.actionText || item.title || parsed.value.title
  const title = String(processKey.value === 'event' ? (item.title || parsed.value.title) : fallbackTitle || '待处理通知').trim(); const noteParts = [parsed.value.note?.trim() || '']
  if (item.location?.trim() && !noteParts[0].includes(item.location.trim())) noteParts.push(`地点：${item.location.trim()}`)
  if (parsed.value.reminder?.trim() && !noteParts.join('').includes(parsed.value.reminder.trim())) noteParts.push(`提醒：${parsed.value.reminder.trim()}`)
  return { title, course: item.course || parsed.value.course || '', dueDate: item.dueDate ?? parsed.value.dueDate ?? '', dueTime: item.dueTime ?? parsed.value.dueTime ?? '', date: item.dueDate ?? parsed.value.dueDate ?? '', time: item.dueTime ?? parsed.value.dueTime ?? '', endTime: item.endTime ?? parsed.value.endTime ?? '', location: item.location || parsed.value.location || '', priority: parsed.value.priority || 'normal', note: noteParts.filter(Boolean).join('；'), content: parsed.value.rawText, rawText: parsed.value.rawText, sourceText: parsed.value.rawText, normalizedText: parsed.value.normalizedText, amount: parsed.value.amount || '', paymentPlatform: parsed.value.paymentPlatform || '', updatedFromNoticeAt: new Date().toISOString(), noticeType: parsed.value.type }
}
/**
 * 一段 → 一条待办/日程数据。
 *
 * **必须用段自己的 parsed**，不能用整段的 parsed：整段里含另外几条通知的日期，
 * 拿它当回退值会让每一条都带上别人的截止时间（实测过：5 条里 4 条日期相同）。
 * 缺字段时宁可留空，由用户在确认页补，也不要拿别段的值凑。
 */
function segmentPayload(row) {
  const one = row.parsed
  const key = segmentProcess.value[row.id] || row.recommendation.key
  const title = String(key === 'event' ? (one.title || row.title) : (one.actionText || one.title || row.title) || '待处理通知').trim()
  const noteParts = [one.note?.trim() || '']
  if (one.location?.trim() && !noteParts[0].includes(one.location.trim())) noteParts.push(`地点：${one.location.trim()}`)
  if (one.reminder?.trim() && !noteParts.join('').includes(one.reminder.trim())) noteParts.push(`提醒：${one.reminder.trim()}`)
  return {
    title,
    course: one.course || '',
    dueDate: one.dueDate ?? '',
    dueTime: one.dueTime ?? '',
    date: one.dueDate ?? '',
    time: one.dueTime ?? '',
    endTime: one.endTime ?? '',
    location: one.location || '',
    priority: one.priority || 'normal',
    note: noteParts.filter(Boolean).join('；'),
    content: row.text,
    rawText: row.text,
    sourceText: row.text,
    normalizedText: one.normalizedText,
    amount: one.amount || '',
    paymentPlatform: one.paymentPlatform || '',
    updatedFromNoticeAt: new Date().toISOString(),
    noticeType: one.type,
  }
}

/**
 * 多段保存：**按处理方式分组**后逐组 emit。
 * TasksView 的 onNoticeCommit 一次只认一种 type（'create' / 'event' / 'note'），
 * 而一段通知各自选的处理方式可能不同 —— 不分组就得改动那个非自有文件。
 */
function saveSegments() {
  const rows = selectedSegments.value
  if (!rows.length) { error.value = '至少保留一条需要处理的通知。'; return }
  const groups = new Map()
  for (const row of rows) {
    const key = segmentProcess.value[row.id] || row.recommendation.key
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  for (const [key, group] of groups) {
    const data = group.map((row) => segmentPayload(row))
    if (key === 'note') { for (const item of data) emit('commit', { type: 'note', data: item, title: item.title }); continue }
    if (key === 'event') { emit('commit', { type: 'event', items: data, title: data[0].title }); continue }
    emit('commit', { type: 'create', kind: key === 'homework' ? 'homework' : 'todo', items: data, title: data[0].title, data: data[0] })
  }
  emit('close')
}

function save() {
  error.value = ''
  if (multiMode.value) { saveSegments(); return }
  if (!parsed.value || !selectedItems.value.length) { error.value = '至少保留一项需要处理的事项。'; return }
  if (useExisting.value && (!selectedTask.value || selectedItems.value.length !== 1 || processKey.value !== 'task')) { error.value = '更新已有待办时只能选择一个待办事项。'; return }
  const items = selectedItems.value
  if (useExisting.value) {
    const proposal = taskUpdateProposal(selectedTask.value, items[0])
    emit('commit', { type: 'update', id: selectedTask.value.id, title: selectedTask.value.title, data: proposal.patch, courseUnmatched: proposal.courseUnmatched })
  }
  else if (processKey.value === 'event') emit('commit', { type: 'event', items: items.map((item) => payloadFor(item)), title: parsed.value.title })
  else if (processKey.value === 'note') emit('commit', { type: 'note', data: payloadFor(parsed.value), title: parsed.value.title })
  else emit('commit', { type: 'create', kind: processKey.value === 'homework' ? 'homework' : 'todo', items: items.map((item) => payloadFor(item)), title: parsed.value.title, data: payloadFor(items[0]) })
  emit('close')
}
</script>

<template>
  <Modal :open="open" title="📋 通知理解" wide :title-level="2" @close="emit('close')">
    <div class="notice-shell">
      <!-- 粘贴框与「事实」编辑框附近都没有 <label> 元素（前者是 section-kicker 的 div，后者是 span，
           样式挂在 .fact-editor span 上），改成 label 会动 DOM 与样式，所以这两处只能用 aria-label 给名称。 -->
      <section v-if="!parsed || editingSource" class="paste-card">
        <div class="section-kicker">粘贴原通知</div>
        <textarea v-model="source" aria-label="粘贴原通知" rows="7" placeholder="例如：下周三晚上八点前提交实验报告，文件名为学号姓名。"></textarea>
        <p v-if="clipboardMessage" class="clipboard-message" role="status">{{ clipboardMessage }}</p>
        <div class="privacy-note"><span>⌁</span><p><b>仅在本机解析</b><br />文字不会发送到网络，分析后也不会自动保存。</p></div>
        <div class="ocr-row">
          <label>截图类型<select v-model="ocrKind" :disabled="ocrBusy"><option value="exam">考试安排</option><option value="homework">作业 / 实验分组表</option></select></label>
          <label class="ocr-file-button"><input type="file" accept="image/*" :disabled="ocrBusy" @change="readOcrImage" />{{ ocrBusy ? `识别中 ${ocrProgress}%` : '识别截图文字' }}</label>
        </div>
        <p v-if="ocrMessage" class="ocr-message" role="status">{{ ocrMessage }}</p>
        <p class="ocr-hint">选课 / 课表截图请在课程表的「导入课程表」里识别。此处支持考试安排与作业、实验分组表。</p>
        <div class="voice-row">
          <!-- 不支持语音时按钮只给提示、不进 Tab 序之外的假控件：aria-disabled + 真实 disabled 都保留，
               但键盘用户仍可直接用上面的 textarea（降级路径不能被语音改动挤掉）。 -->
          <button class="btn btn-ghost" type="button" :aria-pressed="listening" :aria-disabled="!voiceSupported" @click="toggleVoice">{{ listening ? '停止聆听' : '语音输入' }}</button>
          <span class="voice-status" role="status">{{ voiceMessage || (listening ? '正在聆听…' : '') || (voiceSupported ? '也可以直接说「周五交报告」这样的多条事项' : '当前浏览器不支持语音识别，请手动输入') }}</span>
        </div>
        <div class="paste-actions"><button v-if="parsed" class="btn btn-ghost" type="button" @click="editingSource = false">返回理解结果</button><button class="btn btn-primary" type="button" @click="analyze">{{ parsed ? '重新解析' : '分析通知' }}</button></div>
      </section>

      <!-- 多段粘贴：一次粘进来不止一条通知。默认全选，逐条可取消，各自选处理方式。
           v-if="multiMode" —— 只有一段时完全不渲染，避免单条通知也多一层界面。
           用户确认前这里只改本地状态，一个字节都不会写进存储。 -->
      <section v-if="multiMode" class="segments-card">
        <div class="subhead">
          <div><span class="section-kicker">多条通知</span><h3>识别到 {{ segments.length }} 条</h3></div>
          <button type="button" class="link-btn" @click="toggleAllSegments">{{ selectedSegments.length === segments.length ? '取消全选' : '全选' }}</button>
        </div>
        <p v-if="segmentOverflow" class="clipboard-message" role="alert">只切出前 {{ MAX_NOTICE_SEGMENTS }} 段，还有 {{ segmentOverflow }} 段没显示，请分批粘贴。原文仍完整保留在下方「查看原通知」。</p>
        <div v-for="row in segments" :key="row.id" class="segment-row" :class="{ selected: selectedSegmentIds.includes(row.id) }">
          <button type="button" class="segment-pick" :aria-pressed="selectedSegmentIds.includes(row.id)" @click="toggleSegment(row.id)">
            <span class="item-check" aria-hidden="true">{{ selectedSegmentIds.includes(row.id) ? '✓' : '' }}</span>
            <span class="segment-text"><b>{{ row.title }}</b><small>{{ row.parsed.dateText || row.parsed.dueDate || '时间未识别' }}{{ row.parsed.dueTime ? ` ${row.parsed.dueTime}` : '' }}{{ row.parsed.location ? ` · ${row.parsed.location}` : '' }} · {{ row.type }}</small></span>
          </button>
          <!-- 每段各自选处理方式，所以这里必须给读屏一个能区分的 label（光有 option 文本在长列表里没上下文）。 -->
          <label class="segment-kind">转为<select :aria-label="`第 ${row.index + 1} 条通知的处理方式`" v-model="segmentProcess[row.id]"><option v-for="option in SEGMENT_PROCESS_OPTIONS" :key="option.key" :value="option.key">{{ option.label }}</option></select></label>
        </div>
        <p class="more-tip">每条都按各自的处理方式保存；不需要的取消勾选。</p>
        <details class="raw-card"><summary>查看完整原文 <span>▾</span></summary><div class="raw-content"><pre>{{ source }}</pre><div class="raw-actions"><button type="button" class="link-btn" @click="editingSource = true">编辑原文并重新识别</button></div></div></details>
      </section>
      <p v-if="ocrMessage && parsed" class="ocr-message" role="status">{{ ocrMessage }}</p>

      <template v-if="parsed && understanding && !multiMode">
        <section class="understanding-card">
          <div class="type-line"><span class="section-kicker">识别为</span><div class="type-chips" role="list" aria-label="通知类型"><button v-for="option in NOTICE_TYPE_OPTIONS" :key="option.value" type="button" class="type-chip" :class="{ active: parsed.type === option.value }" @click="setType(option.value)">{{ option.icon }} {{ option.label }}</button></div></div>
          <div class="confidence" :class="parsed.confidenceLevel">{{ parsed.confidenceLevel === 'high' ? '理解度较高' : parsed.confidenceLevel === 'medium' ? '建议快速确认' : '需要你确认' }}</div>
          <h2>{{ parsed.title }}</h2><p class="summary">{{ understanding.summary }}</p>
          <div class="action-card" :class="{ passive: !understanding.hasAction }"><div class="action-heading"><span class="action-label">你需要做什么</span><button type="button" class="action-edit" @click="beginActionEdit">修改</button></div><input v-if="editingAction" v-model="parsed.actionText" class="action-input" aria-label="你需要做什么" @blur="finishActionEdit" @keydown.enter="finishActionEdit" /><strong v-else>{{ understanding.actionText }}</strong><small v-if="!understanding.hasAction">这是一条信息型通知，不会自动生成没有意义的待办。</small></div>
          <div v-if="understanding.facts.length" class="facts" aria-label="关键事实"><div v-for="fact in understanding.facts" :key="fact.key" class="fact-wrap"><button v-if="editingField !== fact.key" class="fact-row" type="button" @click="editField(fact.key)"><span>{{ fact.label }}</span><b>{{ factText(fact) }}</b><i>✎</i></button><div v-else class="fact-editor"><span>{{ fact.label }}</span><input :aria-label="fact.label" v-model="parsed[fact.key]" :type="typeFor(fact.key)" @blur="editingField = ''" @keydown.enter="editingField = ''" /></div></div></div>
          <div v-if="understanding.warnings.length" class="warnings"><p v-for="warning in understanding.warnings" :key="warning">⚠ {{ warning }}</p><p v-if="parsed.dateCandidates?.filter((item) => !item.isPublication).length > 1" class="candidate-dates">原文日期：{{ parsed.dateCandidates.filter((item) => !item.isPublication).map((item) => item.raw).join('、') }}</p></div>
        </section>

        <section v-if="parsed.items?.length" class="items-card"><div class="subhead"><div><span class="section-kicker">多事项</span><h3>识别到 {{ parsed.items.length }} 个事项</h3></div><button type="button" class="link-btn" @click="selectedItemIds = selectedItemIds.length === parsed.items.length ? [] : parsed.items.map((item) => item.id)">{{ selectedItemIds.length === parsed.items.length ? '取消全选' : '全选' }}</button></div><button v-for="item in parsed.items" :key="item.id" type="button" class="item-row" :class="{ selected: selectedItemIds.includes(item.id) }" @click="toggleItem(item.id)"><span class="item-check">{{ selectedItemIds.includes(item.id) ? '✓' : '' }}</span><span><b>{{ item.title }}</b><small>{{ item.dateRange || dateText(item.dueDate) || '时间未识别' }}{{ item.dueTime ? ` ${item.dueTime}` : '' }}{{ item.location ? ` · ${item.location}` : '' }}</small></span></button></section>

        <section class="process-card"><div class="subhead"><div><span class="section-kicker">推荐处理</span><h3>{{ processLabel }}</h3></div><span class="recommend-mark">✓</span></div><p>{{ understanding.recommendation.reason }}</p><button type="button" class="change-process" :aria-expanded="showProcessOptions" @click="showProcessOptions = !showProcessOptions">{{ showProcessOptions ? '收起其他方式' : '更改处理方式' }}⌄</button><div v-if="showProcessOptions" class="process-options"><label v-for="option in [{ key: 'task', label: '创建待办' }, { key: 'event', label: '加入日程' }, { key: 'homework', label: '添加作业' }, { key: 'note', label: '仅保存通知' }]" :key="option.key"><input v-model="processKey" type="radio" :value="option.key" />{{ option.label }}</label></div></section>

        <section v-if="matches.length" class="match-box"><div class="subhead"><div><span class="section-kicker">发现相似待办</span><h3>可能是已有待办的更新</h3></div></div><label v-for="item in matches" :key="item.task.id" class="match-row"><input v-model="selectedId" type="radio" :value="item.task.id" /> <span><b>{{ item.task.title }}</b><small>相似度 {{ Math.round(item.score * 100) }}%</small></span></label><label class="update-choice"><input v-model="useExisting" type="checkbox" :disabled="processKey !== 'task'" /> 更新选中的原待办</label><div v-if="useExisting && selectedTask" class="diff-list"><p class="update-hint">只更新通知明确识别出的新字段；其他内容保留。通知原文会保存在来源记录中。</p><div v-for="row in updatePreview.rows" :key="row[0]"><b>{{ row[0] }}</b><span>{{ row[1] }}</span><i>→</i><strong>{{ row[2] }}</strong></div><p v-if="!updatePreview.rows.length" class="update-hint">没有识别到可更新字段；保存时只记录这条通知，待办内容会保留。</p><p v-if="updatePreview.courseUnmatched" class="update-warning">课程名称未能唯一匹配，现有课程关联会保留。</p></div></section>

        <details class="more-card" :open="showMore" @toggle="showMore = $event.target.open"><summary>更多信息 <span>{{ showMore ? '收起' : '展开' }}</span></summary><div class="more-content"><div v-if="parsed.reminder || parsed.priority !== 'normal' || parsed.note" class="existing-more"><button v-if="parsed.reminder" type="button" @click="editField('reminder')">🔔 提醒：{{ parsed.reminder }}</button><button v-if="parsed.priority !== 'normal'" type="button" @click="editField('priority')">优先级：{{ parsed.priority === 'high' ? '高' : '低' }}</button><button v-if="parsed.note" type="button" @click="editField('note')">备注：{{ parsed.note }}</button></div><div class="add-fields"><span>需要补充？</span><button v-for="item in extraFields" :key="item.key" type="button" @click="editField(item.key)">＋ {{ item.label }}</button></div><div v-if="editingField && extraFields.some((item) => item.key === editingField)" class="extra-editor"><label>{{ extraFields.find((item) => item.key === editingField)?.label }}<textarea v-if="editingField === 'note'" v-model="parsed[editingField]" rows="3" @blur="editingField = ''"></textarea><input v-else v-model="parsed[editingField]" :type="extraFields.find((item) => item.key === editingField)?.type || 'text'" @blur="editingField = ''" /></label></div><p class="more-tip">优先级、提醒和备注是低频信息，已收在这里，不影响第一眼确认。</p></div></details>
        <details class="raw-card"><summary>查看原通知 <span>▾</span></summary><div class="raw-content"><pre>{{ parsed.rawText }}</pre><div class="raw-actions"><button type="button" class="link-btn" @click="copyRaw">{{ copied ? '已复制' : '复制' }}</button><button type="button" class="link-btn" @click="editingSource = true">编辑原通知</button><button type="button" class="link-btn" @click="editingSource = true">重新解析</button></div></div></details>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <template #foot><div v-if="parsed || multiMode" class="notice-footer"><button type="button" class="btn btn-ghost" @click="emit('close')">取消</button><button type="button" class="btn btn-primary" @click="save">{{ actionLabel }}</button></div></template>
  </Modal>
</template>

<style scoped>
.notice-shell{display:flex;flex-direction:column;gap:12px;max-width:680px;margin:0 auto}.paste-card,.understanding-card,.items-card,.segments-card,.process-card,.match-box,.more-card,.raw-card{border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}
.ocr-row{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin-top:10px}.ocr-row>label:first-child{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:var(--fs-10)}.ocr-row select{min-height:36px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-11)}.ocr-file-button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 11px;border-radius:var(--radius-8);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-11);font-weight:var(--fw-700);cursor:pointer}.ocr-file-button input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.ocr-file-button:focus-within{outline:2px solid var(--primary);outline-offset:2px}.ocr-message,.ocr-hint{margin:0;color:var(--muted);font-size:var(--fs-10);line-height:1.5}.ocr-hint{margin-top:5px}
.voice-row{display:flex;align-items:center;gap:9px;margin-top:10px;flex-wrap:wrap}.voice-status{flex:1 1 180px;color:var(--muted);font-size:var(--fs-11);line-height:1.5}
.segments-card{padding:14px}.segment-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:7px;padding:6px 6px 6px 9px;border:1px solid transparent;border-radius:var(--radius-9);background:var(--bg)}.segment-row.selected{border-color:var(--primary);background:var(--primary-soft)}
.segment-pick{display:flex;align-items:center;gap:9px;flex:1 1 200px;min-width:0;padding:0;border:0;background:none;text-align:left}.segment-text{min-width:0}.segment-text b,.segment-text small{display:block}.segment-text b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-12)}.segment-text small{margin-top:2px;color:var(--muted);font-size:var(--fs-10)}
.segment-kind{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:var(--fs-11)}.segment-kind select{max-width:130px;padding:5px 6px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font-size:var(--fs-11)}.paste-card{padding:16px}.section-kicker{color:var(--primary);font-size:var(--fs-10);font-weight:var(--fw-900);letter-spacing:.1em}.paste-card textarea{width:100%;min-height:150px;margin-top:8px;line-height:1.65;resize:vertical}.privacy-note{display:flex;gap:9px;margin-top:10px;padding:10px;border-radius:var(--radius-9);background:#effaf6;color:#25725a}.privacy-note span{font-size:var(--fs-20)}.privacy-note p{font-size:var(--fs-11);line-height:1.5}.paste-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.clipboard-message{margin-top:7px;color:var(--warning);font-size:var(--fs-11)}.understanding-card{position:relative;padding:17px}.type-line{display:flex;align-items:flex-start;gap:8px}.type-chips{display:flex;flex-wrap:wrap;gap:5px}.type-chip{padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--bg);color:var(--muted);font-size:var(--fs-11)}.type-chip.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:var(--fw-800)}.confidence{position:absolute;top:16px;right:17px;font-size:var(--fs-10)}.confidence.high{color:var(--success)}.confidence.medium{color:var(--warning)}.confidence.low{color:var(--danger)}h2{margin:17px 0 4px;font-size:var(--fs-22);line-height:1.25}.summary{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.55}.action-card{display:flex;flex-direction:column;gap:4px;margin-top:16px;padding:13px;border-radius:var(--radius-11);background:var(--primary-soft)}.action-card.passive{background:var(--bg)}.action-label{color:var(--primary);font-size:var(--fs-10);font-weight:var(--fw-900);letter-spacing:.08em}.action-card strong{font-size:var(--fs-16);line-height:1.4}.action-card small{color:var(--muted);font-size:var(--fs-11)}.facts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.fact-wrap{flex:1 1 200px;min-width:0}.fact-row,.fact-editor{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:8px 10px;border-radius:var(--radius-9);background:var(--bg);text-align:left}.fact-row{border:1px solid transparent}.fact-row:hover{border-color:var(--primary)}.fact-row span,.fact-editor span{flex:0 0 auto;color:var(--muted);font-size:var(--fs-11)}.fact-row b{overflow:hidden;color:var(--text);font-size:var(--fs-13);text-overflow:ellipsis;white-space:nowrap}.fact-row i{margin-left:auto;color:var(--muted);font-size:var(--fs-11);font-style:normal}.fact-editor input{min-width:0;flex:1;padding:5px;background:var(--card)}.warnings{margin-top:10px;padding:8px 10px;border-radius:var(--radius-8);background:#fff8e8;color:#9a651d;font-size:var(--fs-11);line-height:1.5}.warnings p{margin:0}.candidate-dates{color:var(--muted)}.items-card,.process-card,.match-box{padding:14px}.subhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.subhead h3{margin-top:3px;font-size:var(--fs-14)}.item-row{display:flex;align-items:center;gap:9px;width:100%;padding:9px;margin-top:7px;border:1px solid transparent;border-radius:var(--radius-9);background:var(--bg);text-align:left}.item-row.selected{border-color:var(--primary);background:var(--primary-soft)}.item-check{display:grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border:1px solid var(--border);border-radius:var(--radius-6);background:var(--card);color:var(--primary);font-weight:var(--fw-900)}.item-row b,.item-row small{display:block}.item-row b{font-size:var(--fs-12)}.item-row small{margin-top:2px;color:var(--muted);font-size:var(--fs-10)}.recommend-mark{color:var(--primary);font-weight:var(--fw-900)}.process-card>p{margin:4px 0 8px;color:var(--muted);font-size:var(--fs-11)}.change-process{padding:0;border:0;background:none;color:var(--primary);font-size:var(--fs-11)}.process-options{display:flex;flex-wrap:wrap;gap:10px;margin-top:11px;padding-top:10px;border-top:1px solid var(--border)}.process-options label,.update-choice{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:var(--fs-11)}.match-box{border-color:#f2d08c;background:#fffaf0}.match-row{display:flex;gap:7px;align-items:center;margin-top:7px;padding:8px;border-radius:var(--radius-8);background:var(--card)}.match-row span{display:flex;flex-direction:column;gap:2px}.match-row b{font-size:var(--fs-11)}.match-row small{color:var(--muted);font-size:var(--fs-10)}.update-choice{margin-top:9px;color:var(--text)}.diff-list{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:8px;border-radius:var(--radius-7);background:var(--card);font-size:var(--fs-10)}.diff-list div{display:grid;grid-template-columns:54px minmax(0,1fr) 15px minmax(0,1fr);gap:5px}.diff-list span,.diff-list strong{min-width:0;overflow-wrap:anywhere}.diff-list span{color:var(--muted);text-decoration:line-through}.diff-list i{font-style:normal;color:var(--muted)}.diff-list strong{color:var(--primary)}.update-hint,.update-warning{margin:0;line-height:1.5}.update-hint{color:var(--muted)}.update-warning{color:var(--warning)}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.more-card,.raw-card{padding:12px 14px}.more-card summary,.raw-card summary{display:flex;justify-content:space-between;color:var(--text);font-size:var(--fs-12);font-weight:var(--fw-800)}.more-card summary span,.raw-card summary span{color:var(--muted);font-size:var(--fs-10);font-weight:var(--fw-400)}.more-content,.raw-content{padding-top:10px}.existing-more{display:flex;flex-direction:column;gap:5px}.existing-more button{border:0;background:none;color:var(--muted);font-size:var(--fs-11);text-align:left}.add-fields{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px;color:var(--muted);font-size:var(--fs-11)}.add-fields button{padding:4px 7px;border:1px solid var(--border);border-radius:var(--radius-6);background:var(--card);color:var(--primary);font-size:var(--fs-10)}.extra-editor{margin-top:8px}.extra-editor label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:var(--fs-11)}.extra-editor input,.extra-editor textarea{width:100%;background:var(--card)}.more-tip{margin:10px 0 0;color:var(--muted);font-size:var(--fs-10)}.raw-content pre{max-height:180px;margin:0;overflow:auto;white-space:pre-wrap;color:var(--muted);font-family:inherit;font-size:var(--fs-11);line-height:1.6}.raw-actions{display:flex;gap:12px;margin-top:8px}.link-btn{padding:0;border:0;background:none;color:var(--primary);font-size:var(--fs-11)}.error{margin:0;color:var(--danger);font-size:var(--fs-12)}.notice-footer{display:flex;justify-content:flex-end;gap:8px}.btn{min-height:36px}
@media(max-width:520px){.notice-shell{gap:9px}.segment-row{padding:7px}.segment-pick{flex-basis:100%}.segment-kind select{flex:1;max-width:none}.understanding-card{padding:14px}.confidence{position:static;margin-top:8px}.type-line{display:block}.type-chips{margin-top:7px}h2{font-size:var(--fs-20);margin-top:13px}.action-card{margin-top:13px}.facts{display:block}.fact-wrap{margin-top:6px}.notice-footer{justify-content:stretch}.notice-footer .btn{flex:1}.paste-card textarea{min-height:120px}.diff-list div{grid-template-columns:48px minmax(0,1fr) 12px minmax(0,1fr);gap:4px}}
.action-heading{display:flex;justify-content:space-between;align-items:center}.action-edit{padding:0;border:0;background:none;color:var(--primary);font-size:var(--fs-11)}.action-input{width:100%;font-size:var(--fs-15);font-weight:var(--fw-800);background:var(--card)}
</style>
