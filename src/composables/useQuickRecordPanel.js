import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { isSupported, transcribe, voiceErrorMessage, VOICE_STATES } from './voiceInput.js'
import { useQuickRecordAdapters } from './quickRecord/adapters.js'
import { parseQuickRecord } from './quickRecord/parser.js'
import { QUICK_ACTIONS, QUICK_RECORD_EXAMPLES, recordTypeMeta } from './quickRecord/types.js'
import { FINANCIAL_RECORD_TYPES, quickRecordDraftText, reconcileQuickRecordDrafts, validateQuickRecord } from './quickRecord/workflow.js'
import { quickRecordDraftKey, readQuickRecordDraft, writeQuickRecordDraft } from './quickRecord/draftStorage.js'
import { accountDataOwner } from './accountSyncIdentity.js'
import { amountToCents, catInfo, categoriesForScope, classifyTransaction, rememberCategoryOverride } from './ledger.js'
import { settings as quickRecordSettings } from './settingsPolicy.js'
import { useDomainCommands } from './domain/commands.js'
import { announce as announceLive, announceAlert } from './liveRegion.js'

// Owns parsing, draft recovery, validation and save state for every quick-record entry.
/**
 * @param {{open: boolean, initialText: string, context: import('./quickRecord/contracts').QuickRecordContext}} props
 * @param {(event: 'close' | 'saved', payload?: object) => void} emit
 */
export function useQuickRecordPanel(props, emit) {
  const { courses, save } = useQuickRecordAdapters()
  const domain = useDomainCommands()
  // The shared store predates typed collections; specify the read contracts at
  // this boundary instead of allowing its empty-array inference to spread.
  const tasks = /** @type {import('vue').Ref<Array<import('../types/domain').Task & {archivedAt?: string, deletedAt?: string, sourceText?: string}>>} */ (domain.tasks)
  const transactions = /** @type {import('vue').Ref<import('../types/domain').Transaction[]>} */ (domain.transactions)
  const events = /** @type {import('vue').Ref<Array<import('../types/domain').QuickEvent & {archivedAt?: string, deletedAt?: string, sourceText?: string}>>} */ (domain.events)
  const milestones = /** @type {import('vue').Ref<Array<{id: string, name: string, date?: string, sourceText?: string, archivedAt?: string, deletedAt?: string, createdAt?: string, updatedAt?: string}>>} */ (domain.milestones)

  const input = ref('')
  const inputEl = ref(/** @type {HTMLTextAreaElement | null} */ (null))
  const forcedType = ref('')
  const drafts = ref(/** @type {import('./quickRecord/contracts').QuickRecordDraft[]} */ ([]))
  const expandedId = ref('')
  const feedback = ref('')
  const error = ref('')
  const saving = ref(false)
  const clipboardHint = ref('')
  const voiceState = ref(/** @type {string} */ (VOICE_STATES.idle))
  const voiceSeconds = ref(0)
  const listening = ref(false)
  const settings = quickRecordSettings
  const voiceSupported = isSupported()
  const voiceHintShown = ref(false)
  const previewTypes = QUICK_ACTIONS
  const panelId = useId()
  const courseListId = `quick-course-options-${panelId}`
  const draftStatus = ref('')
  const validationAttempted = ref(false)
  const lastSaved = ref(/** @type {import('./quickRecord/contracts').QuickRecordSaveResult[]} */ ([]))
  const clipboardLoading = ref(false)
  const sessionKey = computed(() => quickRecordDraftKey(accountDataOwner.value, props.context))
  let activeDraftKey = ''
  let initialized = false
  let recognizer = null
  let feedbackTimer = 0
  let resultAnnounceTimer = 0
  let voiceTimer = 0
  let smartBeforeVoice = ''
  let voiceRunId = 0
  let clipboardRunId = 0
  let draftTimer = 0

  const actions = computed(() => QUICK_ACTIONS.map((type) => ({ type, ...recordTypeMeta(type) })))
  const hasDrafts = computed(() => drafts.value.length > 0)
  const selectedDrafts = computed(() => drafts.value.filter((draft) => draft.selected !== false))
  const examples = computed(() => QUICK_RECORD_EXAMPLES[forcedType.value || props.context.preferredType] || QUICK_RECORD_EXAMPLES.auto)
  const placeholder = computed(() => `例如：${examples.value[0]}\n也可以一行一项，批量记录`)
  const draftIssues = computed(() => Object.fromEntries(selectedDrafts.value.map((draft) => [draft.id, validateQuickRecord(draft)])))
  const invalidCount = computed(() => selectedDrafts.value.filter((draft) => Object.keys(draftIssues.value[draft.id]).length).length)
  const saveLabel = computed(() => {
    if (saving.value) return '保存中…'
    if (drafts.value.length === 1) return '保存'
    return selectedDrafts.value.length === drafts.value.length ? '全部保存' : `保存选中 ${selectedDrafts.value.length} 项`
  })
  const categoryEditorId = ref('')
  const categoryPickerOffset = ref(0)
  const recentRecords = computed(() => {
    const items = [
      ...transactions.value.filter((item) => item && !item.archivedAt && !item.deletedAt && !item.tombstone).map((item) => ({
        // 退款是**冲抵项**，不能显示成支出；此前一律映射成 'expense'，
        // 于是下面「支出合计」会把退款**加进去**（¥200 支出 + ¥50 退款 → 显示 ¥250）。
        id: item.id,
        type: item.direction === 'income' ? 'income' : item.direction === 'refund' ? 'refund' : 'expense',
        title: item.name || '日常支出', raw: item.name || '',
        amount: item.amount,
        detail: `${item.direction === 'income' || item.direction === 'refund' ? '+' : '-'}¥${Number(item.amount || 0).toFixed(2)}`,
        at: item.updatedAt || item.createdAt,
      })),
      ...tasks.value.filter((item) => item && !item.archivedAt && !item.deletedAt).map((item) => ({
        id: item.id, type: item.kind === 'homework' ? 'homework' : 'todo', title: item.title || '待办', raw: item.sourceText || item.title || '',
        detail: item.dueDate ? (item.dueTime || item.dueDate) : '待安排', at: item.updatedAt || item.createdAt,
      })),
      ...events.value.filter((item) => item && !item.archivedAt && !item.deletedAt).map((item) => ({
        id: item.id, type: 'event', title: item.title || '日程', raw: item.sourceText || item.title || '',
        detail: item.date ? (item.time || item.date) : '待安排', at: item.updatedAt || item.createdAt,
      })),
      ...milestones.value.filter((item) => item && !item.archivedAt && !item.deletedAt).map((item) => ({
        id: item.id, type: 'countdown', title: item.name || '重要日期', raw: item.sourceText || item.name || '',
        detail: item.date || '待安排', at: item.updatedAt || item.createdAt,
      })),
    ]
    return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 5)
  })
  const totalExpense = computed(() => selectedDrafts.value
    .filter((item) => item.type === 'expense')
    .reduce((cents, item) => cents + (amountToCents(item.amount) ?? 0), 0) / 100)
  const totalIncome = computed(() => selectedDrafts.value
    .filter((item) => item.type === 'income')
    .reduce((cents, item) => cents + (amountToCents(item.amount) ?? 0), 0) / 100)
  const voiceStatusText = computed(() => {
    if (voiceState.value === VOICE_STATES.listening) return `🔴 正在聆听…… ${voiceSeconds.value}s`
    if (voiceState.value === VOICE_STATES.transcribing) return '正在转写……'
    if (voiceState.value === VOICE_STATES.done) return '识别完成'
    if (voiceState.value === VOICE_STATES.error) return '语音识别未完成'
    return ''
  })

  watch(error, (message) => {
    if (message && props.open) announceAlert(message, { clearAfter: 7000 })
  })
  watch(feedback, (message) => {
    if (message && props.open) announceLive(message, { clearAfter: 5000 })
  })
  watch(voiceState, (state) => {
    if (!props.open) return
    const message = {
      [VOICE_STATES.listening]: '正在聆听',
      [VOICE_STATES.transcribing]: '正在转写',
      [VOICE_STATES.done]: '语音识别完成',
    }[state]
    if (message) announceLive(message, { clearAfter: 5000 })
  })

  function isSmallViewport() {
    return typeof window !== 'undefined' && (
      window.matchMedia?.('(max-width: 520px)')?.matches || window.innerWidth <= 520
    )
  }
  function focusInput(force = false) {
    if (!force && isSmallViewport()) return
    nextTick(() => inputEl.value?.focus())
  }
  function autosize(el, maxHeight = 220) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  function onSmartInput(event) {
    if (saving.value || event?.isComposing || event?.target?.composing) return
    autosize(inputEl.value)
    parse()
  }

  function onSmartKeydown(event) {
    if (event.isComposing || event.keyCode === 229 || saving.value) return
    if (event.shiftKey) return
    // 手机上 Enter 只负责换行，避免拇指误触直接保存；桌面仍保留快速回车保存，
    // Ctrl/Cmd + Enter 在两端都明确表示保存。
    if (isSmallViewport() && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    saveAll()
  }

  function parse({ preserve = true } = {}) {
    if (saving.value) return
    error.value = ''
    categoryEditorId.value = ''
    const parsed = parseQuickRecord(input.value, {
      courses: courses.value,
      forcedType: forcedType.value,
      context: props.context,
    })
    drafts.value = reconcileQuickRecordDrafts(parsed, preserve ? drafts.value : [])
    if (!drafts.value.some((draft) => draft.id === expandedId.value)) expandedId.value = ''
    window.clearTimeout(resultAnnounceTimer)
    if (drafts.value.length) {
      resultAnnounceTimer = window.setTimeout(() => {
        if (props.open && drafts.value.length) {
          announceLive(`识别到 ${drafts.value.length} 项，请确认内容`, { clearAfter: 5000 })
        }
      }, 600)
    }
  }

  function chooseAction(type) {
    if (saving.value) return
    stopActiveVoice()
    forcedType.value = type
    parse({ preserve: false })
    focusInput(true)
  }

  function chooseAuto() {
    if (saving.value) return
    stopActiveVoice()
    forcedType.value = ''
    parse({ preserve: false })
    focusInput(true)
  }

  function recentIcon(type) { return recordTypeMeta(type).icon }
  function recentTitle(item) { return item.title || recordTypeMeta(item.type).label }
  function reuseRecent(item) {
    if (saving.value) return
    forcedType.value = ['expense', 'income'].includes(item.type) ? item.type : ''
    input.value = ['expense', 'income'].includes(item.type) && item.amount
      ? `${item.title} ${item.amount}元`
      : item.raw || item.title || ''
    parse({ preserve: false })
    focusInput(true)
  }

  function changeDraftType(draft, type) {
    if (saving.value || !draft || !previewTypes.includes(type) || draft.type === type) return
    const [nextDraft] = parseQuickRecord(draft.raw, { courses: courses.value, forcedType: type, context: props.context })
    if (nextDraft) {
      // Switching type should not erase the user's corrected title or date.
      const shared = Object.fromEntries(['title', 'date', 'time', 'endTime', 'note', 'course', 'courseId', 'location', 'priority'].map((key) => [key, draft[key]]))
      if (!draft.title) shared.title = nextDraft.title
      if (!draft.date) shared.date = nextDraft.date
      if (!draft.time) shared.time = nextDraft.time
      Object.assign(draft, nextDraft, shared, { id: draft.id, selected: draft.selected, type })
      if (isFinancial(draft)) refreshCategorySuggestion(draft)
      if (Object.keys(validateQuickRecord(draft)).length) expandedId.value = draft.id
    }
    categoryEditorId.value = ''
  }

  function chooseCategory(draft, category) {
    if (saving.value || !draft || !category) return
    draft.category = category.key
    confirmCategory(draft)
    categoryEditorId.value = ''
  }

  function toggleCategoryEditor(draft, event) {
    if (categoryEditorId.value === draft.id) {
      categoryEditorId.value = ''
      return
    }
    const trigger = event?.currentTarget?.getBoundingClientRect?.()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const popupWidth = Math.min(300, Math.max(0, viewportWidth - 40))
    const minLeft = 20 - (trigger?.left || 0)
    const maxLeft = viewportWidth - 20 - popupWidth - (trigger?.left || 0)
    categoryPickerOffset.value = Math.max(minLeft, Math.min(0, maxLeft))
    categoryEditorId.value = draft.id
  }

  function chooseQuestion(draft, field, value) {
    if (saving.value) return
    draft[field] = field === 'amount' ? Number(value) : value
    draft.questions = draft.questions.filter((item) => item.field !== field)
  }

  function updateRecent(types) {
    Object.assign(settings.value, { recentTypes: [...new Set([...types, ...(settings.value.recentTypes || [])])].slice(0, 4) })
  }

  function categoryLabel(key) { return catInfo(key).name }
  function categoryOptions(draft) { return categoriesForScope(draft?.type === 'income' ? 'income' : 'expense') }
  function refreshCategorySuggestion(draft) {
    if (!draft || !['expense', 'income', 'bill'].includes(draft.type)) return
    const direction = draft.type === 'income' ? 'income' : 'expense'
    const classification = classifyTransaction(draft.title || draft.raw, { direction })
    Object.assign(draft, {
      category: classification.categoryId,
      categoryConfidence: classification.confidence,
      categoryUncertain: classification.uncertain,
      categorySuggested: classification.categoryId,
      categoryMatchedBy: classification.matchedBy,
      categoryMatchedTerms: classification.matchedTerms,
      categoryCandidates: classification.candidates,
      categoryAmbiguous: classification.ambiguous,
      categoryConfirmed: false,
      categoryEdited: false,
    })
  }
  function onDraftTitleChange(draft) {
    if (isFinancial(draft) && !draft.categoryConfirmed) refreshCategorySuggestion(draft)
  }
  function syncDraftCourse(draft) {
    draft.courseId = courses.value.find((course) => course.name === draft.course)?.id || ''
  }
  function confirmCategory(draft) {
    if (!draft || !['expense', 'income', 'bill'].includes(draft.type)) return
    draft.categoryConfirmed = true
    draft.categoryUncertain = false
    draft.categoryEdited = true
  }

  function resetForNextSmartEntry({ focus = true } = {}) {
    input.value = ''
    drafts.value = []
    forcedType.value = ''
    expandedId.value = ''
    categoryEditorId.value = ''
    clipboardHint.value = ''
    error.value = ''
    feedback.value = ''
    validationAttempted.value = false
    smartBeforeVoice = ''
    stopActiveVoice()
    if (focus) focusInput(true)
  }

  function savedMessage(results) {
    return results.length === 1 ? results[0].message : `已添加 ${results.length} 项记录`
  }

  function requestClose() {
    if (saving.value) return
    stopActiveVoice()
    flushDraft()
    emit('close')
  }

  function finishSave(results, keepOpen) {
    updateRecent(results.map((result) => result.type).filter(Boolean))
    const message = savedMessage(results)
    const undo = () => results.forEach((result) => result.undo?.())
    if (keepOpen) {
      resetForNextSmartEntry()
      lastSaved.value = results
      showFeedback(`✓ ${message}`)
      return
    }
    // The panel stays mounted after its first opening so closing it never drops
    // an unfinished draft. A successful save explicitly clears it before close.
    resetForNextSmartEntry({ focus: false })
    lastSaved.value = []
    flushDraft()
    emit('saved', {
      message,
      undo,
      entityType: results.length === 1 ? results[0].entityType : '',
      entityId: results.length === 1 ? results[0].entityId : '',
      entities: results.map((result) => ({ type: result.entityType, id: result.entityId })).filter((item) => item.type && item.id),
    })
    emit('close')
  }

  async function saveAll(keepOpen = false) {
    if (saving.value || clipboardLoading.value) return
    if (!selectedDrafts.value.length) {
      error.value = '请至少选择一项记录'
      return
    }
    if (listening.value) {
      error.value = '请先停止语音输入，确认转写内容后再保存'
      return
    }
    validationAttempted.value = true
    const invalidDraft = selectedDrafts.value.find((draft) => Object.keys(draftIssues.value[draft.id]).length)
    if (invalidDraft) {
      expandedId.value = invalidDraft.id
      error.value = `有 ${invalidCount.value} 项需要补充或确认，请检查标出的字段`
      nextTick(() => {
        const field = Object.keys(draftIssues.value[invalidDraft.id])[0]
        const control = field === 'type'
          ? document.getElementById(fieldId(invalidDraft, 'type-choices'))?.querySelector('button')
          : document.getElementById(fieldId(invalidDraft, field))
        control?.focus()
      })
      return
    }
    saving.value = true
    error.value = ''
    const pending = selectedDrafts.value.map((draft) => ({
      ...draft,
      questions: Array.isArray(draft.questions)
        ? draft.questions.map((question) => ({ ...question, choices: [...(question.choices || [])] }))
        : [],
    }))
    const results = []
    const savedIds = []
    try {
      for (const draft of pending) {
        try {
          results.push({ ...(await save(draft)), type: draft.type })
          savedIds.push(draft.id)
          if (draft.categoryEdited) rememberCategoryOverride(draft.title || draft.raw, draft.category, draft.type === 'income' ? 'income' : 'expense')
        } catch (cause) {
          drafts.value = drafts.value.filter((item) => !savedIds.includes(item.id))
          if (savedIds.length) {
            input.value = quickRecordDraftText(drafts.value)
            lastSaved.value = results
            flushDraft()
          }
        const reason = cause instanceof Error ? cause.message : '请补充必要信息'
          error.value = savedIds.length
            ? `前 ${savedIds.length} 项已保存；剩余内容未保存：${reason}`
            : `保存失败：${reason}`
          if (savedIds.length) updateRecent(pending.slice(0, savedIds.length).map((draft) => draft.type))
          return
        }
      }
      drafts.value = drafts.value.filter((draft) => !savedIds.includes(draft.id))
      if (drafts.value.length) {
        input.value = quickRecordDraftText(drafts.value)
        lastSaved.value = results
        validationAttempted.value = false
        updateRecent(results.map((result) => result.type))
        showFeedback(`✓ ${savedMessage(results)}，其余 ${drafts.value.length} 项已暂存`)
        flushDraft()
        return
      }
      finishSave(results, keepOpen)
    } finally {
      saving.value = false
    }
  }

  function showFeedback(value) {
    feedback.value = value
    window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 5000)
  }

  function retryAs(draft, type) {
    changeDraftType(draft, type)
  }
  /** @param {import('./quickRecord/contracts').QuickRecordDraft} draft @param {Event} event */
  function onDraftTypeSelect(draft, event) {
    const target = /** @type {HTMLSelectElement | null} */ (event.target)
    if (target) changeDraftType(draft, target.value)
  }

  function fieldId(draft, field) { return `qr-${panelId}-${draft.id}-${field}` }
  function issueFor(draft, field) { return validationAttempted.value ? draftIssues.value[draft.id]?.[field] || '' : '' }
  function fieldDescription(draft, field) { return issueFor(draft, field) ? fieldId(draft, `${field}-error`) : undefined }
  function detailsControlId(draft) { return expandedId.value === draft.id ? fieldId(draft, 'details') : undefined }
  function isFinancial(draft) { return FINANCIAL_RECORD_TYPES.includes(draft.type) }

  function setAllSelected(selected) {
    if (saving.value) return
    drafts.value.forEach((draft) => { draft.selected = selected })
  }

  function removeDraft(draft) {
    if (saving.value) return
    drafts.value = drafts.value.filter((item) => item.id !== draft.id)
    input.value = quickRecordDraftText(drafts.value)
    error.value = ''
    categoryEditorId.value = ''
    showFeedback('已移除这项草稿')
    nextTick(() => autosize(inputEl.value))
  }

  function clearEntry() {
    if (saving.value) return
    resetForNextSmartEntry()
    flushDraft()
  }

  function useExample(text) {
    if (saving.value) return
    input.value = text
    parse({ preserve: false })
    focusInput(true)
    nextTick(() => autosize(inputEl.value))
  }

  function undoLastSaved() {
    const results = lastSaved.value
    lastSaved.value = []
    results.slice().reverse().forEach((result) => result.undo?.())
    showFeedback(`已撤销刚才保存的 ${results.length} 项记录`)
  }

  function flushDraft() {
    window.clearTimeout(draftTimer)
    if (!initialized || !activeDraftKey) return
    const stored = writeQuickRecordDraft(activeDraftKey, { input: input.value, forcedType: forcedType.value, drafts: drafts.value })
    draftStatus.value = input.value.trim() || drafts.value.length
      ? stored ? '草稿已暂存' : '暂存不可用，请及时保存'
      : ''
  }

  function loadDraft(key, initialText = '') {
    activeDraftKey = key
    const stored = initialText ? null : readQuickRecordDraft(key)
    input.value = initialText || stored?.input || ''
    forcedType.value = stored?.forcedType || ''
    drafts.value = stored?.drafts || reconcileQuickRecordDrafts(parseQuickRecord(input.value, { courses: courses.value, context: props.context }), [])
    draftStatus.value = stored ? '已恢复暂存草稿' : ''
    expandedId.value = ''
    categoryEditorId.value = ''
    validationAttempted.value = false
    lastSaved.value = []
  }

  watch([input, drafts, forcedType], () => {
    if (!initialized) return
    window.clearTimeout(draftTimer)
    draftTimer = window.setTimeout(flushDraft, 180)
  }, { deep: true })

  watch(sessionKey, (key) => {
    if (!initialized || key === activeDraftKey) return
    flushDraft()
    stopActiveVoice()
    loadDraft(key)
    error.value = ''
    feedback.value = ''
  })

  function stopVoiceTimer() {
    window.clearInterval(voiceTimer)
    voiceTimer = 0
    voiceSeconds.value = 0
  }

  function stopActiveVoice() {
    const hadVoice = listening.value
    voiceRunId += 1
    const activeRecognizer = recognizer
    recognizer = null
    listening.value = false
    activeRecognizer?.abort?.()
    stopVoiceTimer()
    voiceState.value = VOICE_STATES.idle
    if (hadVoice && !saving.value) parse()
  }

  function onVoiceState(state) {
    voiceState.value = state
    if (state === VOICE_STATES.listening) {
      voiceSeconds.value = 0
      stopVoiceTimer()
      voiceTimer = window.setInterval(() => { voiceSeconds.value += 1 }, 1000)
    } else if (state !== VOICE_STATES.transcribing) {
      stopVoiceTimer()
    }
  }

  function toggleVoice() {
    if (saving.value) return
    if (!voiceSupported) {
      if (!voiceHintShown.value) {
        voiceHintShown.value = true
        error.value = '当前浏览器不支持语音识别，请手动输入'
      }
      return
    }
    if (listening.value) { recognizer?.stop(); return }

    const runId = ++voiceRunId
    const isCurrentRun = () => runId === voiceRunId
    const onError = (code) => {
      if (!isCurrentRun()) return
      listening.value = false
      voiceState.value = VOICE_STATES.error
      stopVoiceTimer()
      parse()
      error.value = voiceErrorMessage(code)
    }

    smartBeforeVoice = input.value
    recognizer = transcribe({
      continuous: true,
      maxSeconds: 60,
      onStateChange: (state) => { if (isCurrentRun()) onVoiceState(state) },
      onResult: (finalText, interimText) => {
        if (!isCurrentRun()) return
        input.value = (smartBeforeVoice + (smartBeforeVoice ? ' ' : '') + finalText + interimText).trim()
        nextTick(() => autosize(inputEl.value))
      },
      onError,
      onEnd: (finalText) => {
        if (!isCurrentRun()) return
        listening.value = false
        if (finalText) {
          input.value = (smartBeforeVoice + (smartBeforeVoice ? ' ' : '') + finalText).trim()
          parse()
        }
        onVoiceState(finalText ? VOICE_STATES.done : VOICE_STATES.idle)
        stopVoiceTimer()
      },
    })

    if (!recognizer) { error.value = '语音识别暂不可用'; return }
    listening.value = true
    voiceState.value = VOICE_STATES.listening
    recognizer.start()
  }

  function useClipboard() {
    if (saving.value) return
    input.value = clipboardHint.value
    clipboardHint.value = ''
    chooseAuto()
  }

  async function checkClipboard() {
    const runId = ++clipboardRunId
    clipboardHint.value = ''
    if (!settings.value.clipboardHint || !navigator.clipboard?.readText) return
    try {
      const value = (await navigator.clipboard.readText()).trim()
      if (runId === clipboardRunId && props.open && !input.value && value && value.length <= 500) clipboardHint.value = value
    } catch { /* clipboard permission is optional */ }
  }

  async function pasteClipboard() {
    if (saving.value || clipboardLoading.value) return
    stopActiveVoice()
    const runId = ++clipboardRunId
    clipboardLoading.value = true
    try {
      if (!navigator.clipboard?.readText) throw new Error('当前浏览器无法读取剪贴板，请直接粘贴到输入框')
      const text = (await navigator.clipboard.readText()).trim()
      if (runId !== clipboardRunId || !props.open || saving.value) return
      if (!text) { showFeedback('剪贴板没有文字'); return }
      input.value = [input.value.trim(), text].filter(Boolean).join('\n')
      clipboardHint.value = ''
      parse()
      focusInput(true)
      nextTick(() => autosize(inputEl.value))
    } catch {
      if (runId === clipboardRunId && props.open) error.value = '无法读取剪贴板，请直接粘贴到输入框'
    } finally {
      clipboardLoading.value = false
    }
  }

  watch(() => props.open, (open) => {
    if (!open) {
      clipboardRunId += 1
      flushDraft()
      stopActiveVoice()
      return
    }
    if (!initialized) {
      initialized = true
      loadDraft(sessionKey.value, props.initialText)
    }
    feedback.value = ''
    error.value = ''
    voiceState.value = VOICE_STATES.idle
    voiceSeconds.value = 0
    listening.value = false
    voiceHintShown.value = false
    stopVoiceTimer()
    focusInput()
    nextTick(() => autosize(inputEl.value))
    void checkClipboard()
  }, { immediate: true })

  onMounted(() => window.addEventListener('pagehide', flushDraft))

  onBeforeUnmount(() => {
    window.removeEventListener('pagehide', flushDraft)
    clipboardRunId += 1
    flushDraft()
    stopActiveVoice()
    window.clearTimeout(feedbackTimer)
    window.clearTimeout(resultAnnounceTimer)
  })

  return {
    input,
    inputEl,
    forcedType,
    drafts,
    expandedId,
    feedback,
    error,
    saving,
    clipboardHint,
    listening,
    voiceSupported,
    panelId,
    courseListId,
    draftStatus,
    validationAttempted,
    lastSaved,
    clipboardLoading,
    actions,
    hasDrafts,
    selectedDrafts,
    examples,
    placeholder,
    draftIssues,
    saveLabel,
    categoryEditorId,
    categoryPickerOffset,
    recentRecords,
    totalExpense,
    totalIncome,
    voiceStatusText,
    courses,
    recordTypeMeta,
    previewTypes,
    catInfo,
    onSmartInput,
    onSmartKeydown,
    chooseAction,
    chooseAuto,
    recentIcon,
    recentTitle,
    reuseRecent,
    changeDraftType,
    onDraftTypeSelect,
    chooseCategory,
    toggleCategoryEditor,
    chooseQuestion,
    categoryLabel,
    categoryOptions,
    confirmCategory,
    onDraftTitleChange,
    syncDraftCourse,
    requestClose,
    saveAll,
    retryAs,
    fieldId,
    issueFor,
    fieldDescription,
    detailsControlId,
    isFinancial,
    setAllSelected,
    removeDraft,
    clearEntry,
    useExample,
    undoLastSaved,
    toggleVoice,
    useClipboard,
    pasteClipboard,
  }
}
