<script setup>
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { buildNoticeUnderstanding, findNoticeChanges, NOTICE_TYPE_OPTIONS, parseNotice } from '../composables/noticeParser.js'

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

const understanding = computed(() => buildNoticeUnderstanding(parsed.value))
const selectedTask = computed(() => props.tasks.find((task) => task.id === selectedId.value) ?? null)
const itemList = computed(() => parsed.value?.items?.length ? parsed.value.items : parsed.value ? [parsed.value] : [])
const selectedItems = computed(() => itemList.value.filter((item) => selectedItemIds.value.includes(item.id || 'single')))
const processLabel = computed(() => ({ task: '创建待办', homework: '添加作业', event: '加入日程', note: '保存通知' }[processKey.value] || '保存通知'))
const actionLabel = computed(() => selectedItems.value.length > 1 ? `添加 ${selectedItems.value.length} 项` : processLabel.value)
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
  if (!open) return
  source.value = ''; parsed.value = null; matches.value = []; selectedId.value = ''; selectedItemIds.value = []
  useExisting.value = false; processKey.value = 'task'; editingField.value = ''; editingAction.value = false; editingSource.value = false
  showMore.value = false; showProcessOptions.value = false; error.value = ''; clipboardMessage.value = ''
  void readClipboard()
})

async function readClipboard() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) { clipboardMessage.value = '无法自动读取剪贴板，请按 Ctrl + V 粘贴通知。'; return }
  try {
    const value = await navigator.clipboard.readText()
    if (!props.open) return
    if (value.trim()) { source.value = value; analyze() } else clipboardMessage.value = '剪贴板为空，请按 Ctrl + V 粘贴通知。'
  } catch { clipboardMessage.value = '浏览器未授权读取剪贴板，请按 Ctrl + V 粘贴通知。' }
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
  } catch { parsed.value = null; matches.value = []; error.value = '解析失败，原始通知仍已保留，请修改后重试。' }
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
function changeRows(task) {
  if (!parsed.value || !task) return []
  return [['标题', task.title || '未填写', parsed.value.title || '未填写'], ['截止日期', task.dueDate || '未设置', parsed.value.dueDate || '未识别'], ['截止时间', task.dueTime || '未设置', parsed.value.dueTime || '未识别'], ['课程', task.course || '未设置', parsed.value.course || task.course || '未识别']].filter(([, before, after]) => before !== after)
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
function save() {
  error.value = ''
  if (!parsed.value || !selectedItems.value.length) { error.value = '至少保留一项需要处理的事项。'; return }
  if (useExisting.value && (!selectedTask.value || selectedItems.value.length !== 1 || processKey.value !== 'task')) { error.value = '更新已有待办时只能选择一个待办事项。'; return }
  const items = selectedItems.value
  if (useExisting.value) emit('commit', { type: 'update', id: selectedTask.value.id, title: selectedTask.value.title, data: payloadFor(items[0]) })
  else if (processKey.value === 'event') emit('commit', { type: 'event', items: items.map((item) => payloadFor(item)), title: parsed.value.title })
  else if (processKey.value === 'note') emit('commit', { type: 'note', data: payloadFor(parsed.value), title: parsed.value.title })
  else emit('commit', { type: 'create', kind: processKey.value === 'homework' ? 'homework' : 'todo', items: items.map((item) => payloadFor(item)), title: parsed.value.title, data: payloadFor(items[0]) })
  emit('close')
}
</script>

<template>
  <Modal :open="open" title="📋 通知理解" wide @close="emit('close')">
    <div class="notice-shell">
      <section v-if="!parsed || editingSource" class="paste-card">
        <div class="section-kicker">粘贴原通知</div>
        <textarea v-model="source" rows="7" placeholder="例如：下周三晚上八点前提交实验报告，文件名为学号姓名。"></textarea>
        <p v-if="clipboardMessage" class="clipboard-message" role="status">{{ clipboardMessage }}</p>
        <div class="privacy-note"><span>⌁</span><p><b>仅在本机解析</b><br />文字不会发送到网络，分析后也不会自动保存。</p></div>
        <div class="paste-actions"><button v-if="parsed" class="btn btn-ghost" type="button" @click="editingSource = false">返回理解结果</button><button class="btn btn-primary" type="button" @click="analyze">{{ parsed ? '重新解析' : '分析通知' }}</button></div>
      </section>

      <template v-if="parsed && understanding">
        <section class="understanding-card">
          <div class="type-line"><span class="section-kicker">识别为</span><div class="type-chips" role="list" aria-label="通知类型"><button v-for="option in NOTICE_TYPE_OPTIONS" :key="option.value" type="button" class="type-chip" :class="{ active: parsed.type === option.value }" @click="setType(option.value)">{{ option.icon }} {{ option.label }}</button></div></div>
          <div class="confidence" :class="parsed.confidenceLevel">{{ parsed.confidenceLevel === 'high' ? '理解度较高' : parsed.confidenceLevel === 'medium' ? '建议快速确认' : '需要你确认' }}</div>
          <h2>{{ parsed.title }}</h2><p class="summary">{{ understanding.summary }}</p>
          <div class="action-card" :class="{ passive: !understanding.hasAction }"><div class="action-heading"><span class="action-label">你需要做什么</span><button type="button" class="action-edit" @click="beginActionEdit">修改</button></div><input v-if="editingAction" v-model="parsed.actionText" class="action-input" aria-label="你需要做什么" @blur="finishActionEdit" @keydown.enter="finishActionEdit" /><strong v-else>{{ understanding.actionText }}</strong><small v-if="!understanding.hasAction">这是一条信息型通知，不会自动生成没有意义的待办。</small></div>
          <div v-if="understanding.facts.length" class="facts" aria-label="关键事实"><div v-for="fact in understanding.facts" :key="fact.key" class="fact-wrap"><button v-if="editingField !== fact.key" class="fact-row" type="button" @click="editField(fact.key)"><span>{{ fact.label }}</span><b>{{ factText(fact) }}</b><i>✎</i></button><div v-else class="fact-editor"><span>{{ fact.label }}</span><input v-model="parsed[fact.key]" :type="typeFor(fact.key)" @blur="editingField = ''" @keydown.enter="editingField = ''" /></div></div></div>
          <div v-if="understanding.warnings.length" class="warnings"><p v-for="warning in understanding.warnings" :key="warning">⚠ {{ warning }}</p><p v-if="parsed.dateCandidates?.filter((item) => !item.isPublication).length > 1" class="candidate-dates">原文日期：{{ parsed.dateCandidates.filter((item) => !item.isPublication).map((item) => item.raw).join('、') }}</p></div>
        </section>

        <section v-if="parsed.items?.length" class="items-card"><div class="subhead"><div><span class="section-kicker">多事项</span><h3>识别到 {{ parsed.items.length }} 个事项</h3></div><button type="button" class="link-btn" @click="selectedItemIds = selectedItemIds.length === parsed.items.length ? [] : parsed.items.map((item) => item.id)">{{ selectedItemIds.length === parsed.items.length ? '取消全选' : '全选' }}</button></div><button v-for="item in parsed.items" :key="item.id" type="button" class="item-row" :class="{ selected: selectedItemIds.includes(item.id) }" @click="toggleItem(item.id)"><span class="item-check">{{ selectedItemIds.includes(item.id) ? '✓' : '' }}</span><span><b>{{ item.title }}</b><small>{{ item.dateRange || dateText(item.dueDate) || '时间未识别' }}{{ item.dueTime ? ` ${item.dueTime}` : '' }}{{ item.location ? ` · ${item.location}` : '' }}</small></span></button></section>

        <section class="process-card"><div class="subhead"><div><span class="section-kicker">推荐处理</span><h3>{{ processLabel }}</h3></div><span class="recommend-mark">✓</span></div><p>{{ understanding.recommendation.reason }}</p><button type="button" class="change-process" @click="showProcessOptions = !showProcessOptions">{{ showProcessOptions ? '收起其他方式' : '更改处理方式' }}⌄</button><div v-if="showProcessOptions" class="process-options"><label v-for="option in [{ key: 'task', label: '创建待办' }, { key: 'event', label: '加入日程' }, { key: 'homework', label: '添加作业' }, { key: 'note', label: '仅保存通知' }]" :key="option.key"><input v-model="processKey" type="radio" :value="option.key" />{{ option.label }}</label></div></section>

        <section v-if="matches.length" class="match-box"><div class="subhead"><div><span class="section-kicker">发现相似待办</span><h3>可能是已有待办的更新</h3></div></div><label v-for="item in matches" :key="item.task.id" class="match-row"><input v-model="selectedId" type="radio" :value="item.task.id" /> <span><b>{{ item.task.title }}</b><small>相似度 {{ Math.round(item.score * 100) }}%</small></span></label><label class="update-choice"><input v-model="useExisting" type="checkbox" :disabled="processKey !== 'task'" /> 更新选中的原待办</label><div v-if="useExisting && selectedTask" class="diff-list"><div v-for="row in changeRows(selectedTask)" :key="row[0]"><b>{{ row[0] }}</b><span>{{ row[1] }}</span><i>→</i><strong>{{ row[2] }}</strong></div></div></section>

        <details class="more-card" :open="showMore" @toggle="showMore = $event.target.open"><summary>更多信息 <span>{{ showMore ? '收起' : '展开' }}</span></summary><div class="more-content"><div v-if="parsed.reminder || parsed.priority !== 'normal' || parsed.note" class="existing-more"><button v-if="parsed.reminder" type="button" @click="editField('reminder')">🔔 提醒：{{ parsed.reminder }}</button><button v-if="parsed.priority !== 'normal'" type="button" @click="editField('priority')">优先级：{{ parsed.priority === 'high' ? '高' : '低' }}</button><button v-if="parsed.note" type="button" @click="editField('note')">备注：{{ parsed.note }}</button></div><div class="add-fields"><span>需要补充？</span><button v-for="item in extraFields" :key="item.key" type="button" @click="editField(item.key)">＋ {{ item.label }}</button></div><div v-if="editingField && extraFields.some((item) => item.key === editingField)" class="extra-editor"><label>{{ extraFields.find((item) => item.key === editingField)?.label }}<textarea v-if="editingField === 'note'" v-model="parsed[editingField]" rows="3" @blur="editingField = ''"></textarea><input v-else v-model="parsed[editingField]" :type="extraFields.find((item) => item.key === editingField)?.type || 'text'" @blur="editingField = ''" /></label></div><p class="more-tip">优先级、提醒和备注是低频信息，已收在这里，不影响第一眼确认。</p></div></details>
        <details class="raw-card"><summary>查看原通知 <span>▾</span></summary><div class="raw-content"><pre>{{ parsed.rawText }}</pre><div class="raw-actions"><button type="button" class="link-btn" @click="copyRaw">{{ copied ? '已复制' : '复制' }}</button><button type="button" class="link-btn" @click="editingSource = true">编辑原通知</button><button type="button" class="link-btn" @click="editingSource = true">重新解析</button></div></div></details>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <template #foot><div v-if="parsed" class="notice-footer"><button type="button" class="btn btn-ghost" @click="emit('close')">取消</button><button type="button" class="btn btn-primary" @click="save">{{ actionLabel }}</button></div></template>
  </Modal>
</template>

<style scoped>
.notice-shell{display:flex;flex-direction:column;gap:12px;max-width:680px;margin:0 auto}.paste-card,.understanding-card,.items-card,.process-card,.match-box,.more-card,.raw-card{border:1px solid var(--border);border-radius:14px;background:#fff}.paste-card{padding:16px}.section-kicker{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.1em}.paste-card textarea{width:100%;min-height:150px;margin-top:8px;line-height:1.65;resize:vertical}.privacy-note{display:flex;gap:9px;margin-top:10px;padding:10px;border-radius:9px;background:#effaf6;color:#25725a}.privacy-note span{font-size:20px}.privacy-note p{font-size:11px;line-height:1.5}.paste-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.clipboard-message{margin-top:7px;color:#9a651d;font-size:11px}.understanding-card{position:relative;padding:17px}.type-line{display:flex;align-items:flex-start;gap:8px}.type-chips{display:flex;flex-wrap:wrap;gap:5px}.type-chip{padding:5px 8px;border:1px solid var(--border);border-radius:99px;background:var(--bg);color:var(--muted);font-size:11px}.type-chip.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:800}.confidence{position:absolute;top:16px;right:17px;font-size:10px}.confidence.high{color:#258365}.confidence.medium{color:#a96712}.confidence.low{color:var(--danger)}h2{margin:17px 0 4px;font-size:22px;line-height:1.25}.summary{margin:0;color:var(--muted);font-size:12px;line-height:1.55}.action-card{display:flex;flex-direction:column;gap:4px;margin-top:16px;padding:13px;border-radius:11px;background:var(--primary-soft)}.action-card.passive{background:var(--bg)}.action-label{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.08em}.action-card strong{font-size:16px;line-height:1.4}.action-card small{color:var(--muted);font-size:11px}.facts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.fact-wrap{flex:1 1 200px;min-width:0}.fact-row,.fact-editor{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:8px 10px;border-radius:9px;background:var(--bg);text-align:left}.fact-row{border:1px solid transparent}.fact-row:hover{border-color:var(--primary)}.fact-row span,.fact-editor span{flex:0 0 auto;color:var(--muted);font-size:11px}.fact-row b{overflow:hidden;color:var(--ink);font-size:13px;text-overflow:ellipsis;white-space:nowrap}.fact-row i{margin-left:auto;color:var(--muted);font-size:11px;font-style:normal}.fact-editor input{min-width:0;flex:1;padding:5px;background:#fff}.warnings{margin-top:10px;padding:8px 10px;border-radius:8px;background:#fff8e8;color:#9a651d;font-size:11px;line-height:1.5}.warnings p{margin:0}.candidate-dates{color:var(--muted)}.items-card,.process-card,.match-box{padding:14px}.subhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.subhead h3{margin-top:3px;font-size:14px}.item-row{display:flex;align-items:center;gap:9px;width:100%;padding:9px;margin-top:7px;border:1px solid transparent;border-radius:9px;background:var(--bg);text-align:left}.item-row.selected{border-color:var(--primary);background:var(--primary-soft)}.item-check{display:grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--primary);font-weight:900}.item-row b,.item-row small{display:block}.item-row b{font-size:12px}.item-row small{margin-top:2px;color:var(--muted);font-size:10px}.recommend-mark{color:var(--primary);font-weight:900}.process-card>p{margin:4px 0 8px;color:var(--muted);font-size:11px}.change-process{padding:0;border:0;background:none;color:var(--primary);font-size:11px}.process-options{display:flex;flex-wrap:wrap;gap:10px;margin-top:11px;padding-top:10px;border-top:1px solid var(--border)}.process-options label,.update-choice{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}.match-box{border-color:#f2d08c;background:#fffaf0}.match-row{display:flex;gap:7px;align-items:center;margin-top:7px;padding:8px;border-radius:8px;background:#fff}.match-row span{display:flex;flex-direction:column;gap:2px}.match-row b{font-size:11px}.match-row small{color:var(--muted);font-size:10px}.update-choice{margin-top:9px;color:var(--ink)}.diff-list{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:8px;border-radius:7px;background:#fff;font-size:10px}.diff-list div{display:grid;grid-template-columns:54px 1fr 15px 1fr;gap:5px}.diff-list span{color:var(--muted);text-decoration:line-through}.diff-list i{font-style:normal;color:var(--muted)}.diff-list strong{color:var(--primary)}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.more-card,.raw-card{padding:12px 14px}.more-card summary,.raw-card summary{display:flex;justify-content:space-between;color:var(--ink);font-size:12px;font-weight:800}.more-card summary span,.raw-card summary span{color:var(--muted);font-size:10px;font-weight:400}.more-content,.raw-content{padding-top:10px}.existing-more{display:flex;flex-direction:column;gap:5px}.existing-more button{border:0;background:none;color:var(--muted);font-size:11px;text-align:left}.add-fields{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px;color:var(--muted);font-size:11px}.add-fields button{padding:4px 7px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--primary);font-size:10px}.extra-editor{margin-top:8px}.extra-editor label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:11px}.extra-editor input,.extra-editor textarea{width:100%;background:#fff}.more-tip{margin:10px 0 0;color:var(--muted);font-size:10px}.raw-content pre{max-height:180px;margin:0;overflow:auto;white-space:pre-wrap;color:var(--muted);font-family:inherit;font-size:11px;line-height:1.6}.raw-actions{display:flex;gap:12px;margin-top:8px}.link-btn{padding:0;border:0;background:none;color:var(--primary);font-size:11px}.error{margin:0;color:var(--danger);font-size:12px}.notice-footer{display:flex;justify-content:flex-end;gap:8px}.btn{min-height:36px}
@media(max-width:520px){.notice-shell{gap:9px}.understanding-card{padding:14px}.confidence{position:static;margin-top:8px}.type-line{display:block}.type-chips{margin-top:7px}h2{font-size:20px;margin-top:13px}.action-card{margin-top:13px}.facts{display:block}.fact-wrap{margin-top:6px}.notice-footer{justify-content:stretch}.notice-footer .btn{flex:1}.paste-card textarea{min-height:120px}}
.action-heading{display:flex;justify-content:space-between;align-items:center}.action-edit{padding:0;border:0;background:none;color:var(--primary);font-size:11px}.action-input{width:100%;font-size:15px;font-weight:800;background:#fff}
</style>
