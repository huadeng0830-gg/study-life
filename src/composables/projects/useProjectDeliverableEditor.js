import { computed, ref } from 'vue'
import { newProjectId, uploadProjectDeliverableFile } from '../../services/projects.js'

function copyContent(content = {}) {
  return {
    summary: content.summary || '',
    links: (content.links || []).map((item) => ({ ...item })),
    files: (content.files || []).map((item) => ({ ...item })),
  }
}

function validateContent(content, required) {
  if (content.summary.length > 5000) return '成果说明不能超过 5000 个字。'
  if (content.links.length > 10 || content.files.length > 10) return '每个版本最多包含 10 个链接和 10 个文件。'
  for (const [index, link] of content.links.entries()) {
    let url
    try { url = new URL(String(link.url || '').trim()) } catch { /* Show the same field error for invalid URLs. */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password) return '第 ' + (index + 1) + ' 个链接需要填写有效的 HTTPS 地址。'
    if (String(link.title || '').length > 160) return '链接名称不能超过 160 个字。'
  }
  if (required && !content.summary.trim() && !content.links.length && !content.files.length) return '请添加成果说明、在线链接或文件后再提交。'
  return ''
}

/** Owns draft editing, upload limits, save-before-submit and retry identity. */
export function useProjectDeliverableEditor({ project, accountUser, projectRequest, loadProject, loadInbox, captureRequest, notify, describeError }) {
  const showDeliverableEditor = ref(false)
  const activeDeliverable = ref(null)
  const draftContent = ref(copyContent())
  const draftRevision = ref(0)
  const changeNote = ref('')
  const fileUploadBusy = ref(false)
  const busy = ref(false)
  const error = ref('')
  const conflict = ref(false)
  const latestDraft = ref(null)
  const savedContent = ref('')
  const drafts = new Map()
  const submissionKeys = new Map()
  let generation = 0
  const dirty = computed(() => JSON.stringify(draftContent.value) !== savedContent.value)

  function remember() {
    if (!activeDeliverable.value) return
    drafts.set(activeDeliverable.value.id, {
      content: copyContent(draftContent.value), revision: draftRevision.value,
      savedContent: savedContent.value, changeNote: changeNote.value,
    })
  }

  function close() {
    remember()
    generation++
    showDeliverableEditor.value = false
    activeDeliverable.value = null
    busy.value = false
    fileUploadBusy.value = false
    error.value = ''
    conflict.value = false
    latestDraft.value = null
  }

  function reset() {
    close()
    drafts.clear()
    submissionKeys.clear()
    draftContent.value = copyContent()
    draftRevision.value = 0
    changeNote.value = ''
  }

  function open(item) {
    close()
    activeDeliverable.value = item
    const cached = drafts.get(item.id)
    const content = copyContent(item.draft?.content)
    const resume = cached && (cached.revision > (item.draft?.revision || 0) || JSON.stringify(cached.content) !== cached.savedContent || cached.changeNote)
    draftContent.value = resume ? copyContent(cached.content) : content
    draftRevision.value = resume ? cached.revision : item.draft?.revision || 0
    savedContent.value = resume ? cached.savedContent : JSON.stringify(content)
    changeNote.value = resume ? cached.changeNote : ''
    showDeliverableEditor.value = true
  }

  function capture() {
    const token = generation
    const id = activeDeliverable.value?.id
    const isCurrentProject = captureRequest()
    return () => token === generation && id === activeDeliverable.value?.id && isCurrentProject()
  }

  function addLink() {
    if (!busy.value && draftContent.value.links.length < 10) draftContent.value.links.push({ type: 'document', title: '', url: '' })
  }

  function reportError(cause) {
    error.value = describeError(cause)
    conflict.value = cause?.code === 'conflict' || cause?.code === '40001' || /版本冲突/.test(cause?.message || '')
  }

  async function loadLatestDraft() {
    if (!activeDeliverable.value || busy.value || fileUploadBusy.value) return
    const isCurrent = capture(), id = activeDeliverable.value.id
    busy.value = true
    try {
      const result = await projectRequest('deliverables', { projectId: project.value.id })
      if (!isCurrent()) return
      const item = result.deliverables?.find((entry) => entry.id === id)
      if (!item) { error.value = '这个交付项已被移除，你的本次修改仍保留在编辑器中。'; return }
      latestDraft.value = { revision: item.draft?.revision || 0, content: copyContent(item.draft?.content) }
    } catch (cause) { if (isCurrent()) error.value = describeError(cause) }
    finally { if (isCurrent()) busy.value = false }
  }

  function resolveConflict(keepLocal) {
    if (!latestDraft.value || busy.value || fileUploadBusy.value) return
    draftRevision.value = latestDraft.value.revision
    savedContent.value = JSON.stringify(latestDraft.value.content)
    if (!keepLocal) { draftContent.value = copyContent(latestDraft.value.content); changeNote.value = '' }
    conflict.value = false; latestDraft.value = null; error.value = ''
    remember()
  }

  async function upload(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length || fileUploadBusy.value || busy.value || !activeDeliverable.value) return
    error.value = ''
    if (files.length + draftContent.value.files.length > 10) {
      error.value = '每个版本最多 10 个文件，请减少本次选择的文件数量。'
      return
    }
    if (files.some((file) => file.size < 1 || file.size > 20 * 1024 * 1024)) {
      error.value = '文件不能为空，单个文件不能超过 20 MB。'
      return
    }
    const isCurrent = capture()
    const projectId = project.value.id
    const deliverableId = activeDeliverable.value.id
    fileUploadBusy.value = true
    let uploadedCount = 0
    try {
      for (const file of files) {
        const uploaded = await uploadProjectDeliverableFile(projectId, deliverableId, file)
        if (!isCurrent()) return
        draftContent.value.files.push(uploaded)
        uploadedCount++
        remember()
      }
      notify('success', '已添加 ' + uploadedCount + ' 个成果文件。正式提交时会一并保存。')
    } catch (cause) {
      if (isCurrent()) error.value = (uploadedCount ? '已保留前 ' + uploadedCount + ' 个文件。' : '') + describeError(cause, '文件上传失败。')
    } finally { if (isCurrent()) fileUploadBusy.value = false }
  }

  async function persist(isCurrent) {
    const content = copyContent(draftContent.value)
    const deliverableId = activeDeliverable.value.id
    const expectedRevision = draftRevision.value
    const previousBaseline = savedContent.value
    const isCurrentProject = captureRequest()
    const result = await projectRequest('deliverable_draft_save', {
      projectId: project.value.id, deliverableId,
      expectedRevision, content,
    })
    if (!isCurrentProject()) return false
    const baseline = JSON.stringify(content)
    const cached = drafts.get(deliverableId)
    if (cached?.revision === expectedRevision && cached.savedContent === previousBaseline) {
      cached.revision = result.revision
      cached.savedContent = baseline
    }
    // A completed save also advances a reopened editor's base without replacing its edits.
    if (activeDeliverable.value?.id === deliverableId && draftRevision.value === expectedRevision && savedContent.value === previousBaseline) {
      draftRevision.value = result.revision
      savedContent.value = baseline
    }
    if (!isCurrent()) return false
    draftRevision.value = result.revision
    savedContent.value = baseline
    remember()
    return true
  }

  async function save() {
    if (!activeDeliverable.value || busy.value || fileUploadBusy.value) return
    error.value = validateContent(draftContent.value, false)
    if (error.value) return
    const isCurrent = capture()
    const projectId = project.value.id
    busy.value = true
    try {
      if (!await persist(isCurrent)) return
      notify('success', '草稿已保存。')
      await loadProject(projectId)
    } catch (cause) { if (isCurrent()) reportError(cause) }
    finally { if (isCurrent()) busy.value = false }
  }

  function submissionKey(deliverableId, ownerId, revision, note, create = true) {
    const storageKey = 'study-life-project-submit:' + ownerId + ':' + deliverableId + ':' + revision
    let attempt = submissionKeys.get(storageKey)
    try { attempt ||= JSON.parse(localStorage.getItem(storageKey) || 'null') } catch { /* Memory keeps retries stable when storage is unavailable. */ }
    if (attempt?.note !== note) attempt = null
    if (!attempt && !create) return null
    attempt ||= { key: newProjectId(), note }
    submissionKeys.set(storageKey, attempt)
    try { localStorage.setItem(storageKey, JSON.stringify(attempt)) } catch { /* Submission does not require local storage. */ }
    return { key: attempt.key, storageKey }
  }

  async function submit() {
    if (!activeDeliverable.value || busy.value || fileUploadBusy.value) return
    error.value = validateContent(draftContent.value, true)
    if (error.value) return
    const isCurrent = capture()
    const projectId = project.value.id
    const deliverableId = activeDeliverable.value.id
    const ownerId = accountUser.value?.id
    const note = changeNote.value.trim()
    busy.value = true
    try {
      let attempt = !dirty.value && draftRevision.value ? submissionKey(deliverableId, ownerId, draftRevision.value, note, false) : null
      if (!attempt && !await persist(isCurrent)) return
      if (!isCurrent()) return
      // Do not freeze an earlier snapshot if the user edited during the save request.
      if (dirty.value) { error.value = '保存期间成果内容有变化，请再次提交。'; return }
      attempt ||= submissionKey(deliverableId, ownerId, draftRevision.value, note)
      const { key, storageKey } = attempt
      const result = await projectRequest('deliverable_submit', {
        projectId, deliverableId, expectedRevision: draftRevision.value, versionId: newProjectId(), submissionKey: key, changeNote: note,
      })
      if (!isCurrent()) return
      submissionKeys.delete(storageKey)
      try { localStorage.removeItem(storageKey) } catch { /* The version is already saved. */ }
      close()
      drafts.delete(deliverableId)
      notify('success', '成果 V' + result.version + ' 已正式提交。')
      await loadProject(projectId)
      await loadInbox()
    } catch (cause) { if (isCurrent()) reportError(cause) }
    finally { if (isCurrent()) busy.value = false }
  }

  return {
    showDeliverableEditor, activeDeliverable, draftContent, draftRevision, changeNote, fileUploadBusy,
    busy, error, dirty, conflict, latestDraft, open, close, reset, addLink, upload, save, submit, loadLatestDraft, resolveConflict,
  }
}
