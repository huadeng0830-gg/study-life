import { socialRequest } from './social.js'
import { accountUser } from '../composables/accountAuth.js'
import { getSupabaseClient } from './supabase.js'
import { validDate } from '../composables/zonedTime.js'

const PROJECT_FILE_BUCKET = 'qixing-deliverables'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const PROJECT_TYPES = Object.freeze([
  { value: 'course', label: '课程作业' },
  { value: 'competition', label: '竞赛' },
  { value: 'research', label: '科研' },
  { value: 'software', label: '软件开发' },
  { value: 'event', label: '活动筹备' },
  { value: 'blank', label: '空白项目' },
])

export const PROJECT_TYPE_LABELS = Object.freeze(Object.fromEntries(PROJECT_TYPES.map((item) => [item.value, item.label])))
export const PROJECT_TASK_STATUS = Object.freeze({ todo: '待开始', in_progress: '进行中', review: '待验收', completed: '已完成' })
export const PROJECT_TASK_PRIORITY = Object.freeze({ low: '较低', normal: '普通', high: '较高', urgent: '紧急' })

export function newProjectId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  // randomUUID 只在**安全上下文**可用（https / localhost）。桌面版以 file:// 打开、
  // 旧浏览器缺少该方法时都拿不到值，原来的 `|| ''` 会让调用方拿着空字符串去建项目，
  // 于是创建失败并弹出「无法生成安全项目编号」。这里手工拼一个 v4 UUID：
  // 形状必须与 randomUUID 完全一致，否则成果文件路径会被上面的 UUID_PATTERN 拒绝
  // （version 位固定 4、variant 位固定 10xx，即 pattern 里的 [1-8] 与 [89ab]）。
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function normalizeProjectForm(value = {}) {
  return {
    name: String(value.name || '').trim(),
    description: String(value.description || '').trim(),
    type: PROJECT_TYPE_LABELS[value.type] ? value.type : 'blank',
    startsOn: String(value.startsOn || ''),
    targetEndOn: String(value.targetEndOn || ''),
  }
}

export function validateProjectForm(value = {}) {
  const form = normalizeProjectForm(value)
  if (!form.name) return { ok: false, field: 'name', message: '请填写项目名称。' }
  if (form.name.length > 120) return { ok: false, field: 'name', message: '项目名称不能超过 120 个字。' }
  if (form.description.length > 2000) return { ok: false, field: 'description', message: '项目说明不能超过 2000 个字。' }
  if (form.startsOn && !validDate(form.startsOn)) return { ok: false, field: 'startsOn', message: '开始日期格式不正确。' }
  if (form.targetEndOn && !validDate(form.targetEndOn)) return { ok: false, field: 'targetEndOn', message: '预计结束日期格式不正确。' }
  if (form.startsOn && form.targetEndOn && form.targetEndOn < form.startsOn) return { ok: false, field: 'targetEndOn', message: '预计结束日期不能早于开始日期。' }
  return { ok: true, value: form }
}

export function validateProjectTaskForm(value = {}) {
  const form = { ...value, title: String(value.title || '').trim(), description: String(value.description || '').trim(), dueOn: String(value.dueOn || '').trim() }
  if (!form.title) return { ok: false, field: 'title', message: '请填写任务标题。' }
  if (form.title.length > 160) return { ok: false, field: 'title', message: '任务标题不能超过 160 个字。' }
  if (form.description.length > 3000) return { ok: false, field: 'description', message: '任务说明不能超过 3000 个字。' }
  if (form.dueOn && !validDate(form.dueOn)) return { ok: false, field: 'dueOn', message: '请填写有效的截止日期。' }
  if (form.dependsOnTaskId && form.dependsOnTaskId === form.id) return { ok: false, field: 'dependsOnTaskId', message: '任务不能以自己作为前置任务。' }
  return { ok: true, value: form }
}

export async function projectRequest(action, payload = {}) {
  return socialRequest(`project_${action}`, payload)
}

async function verifiedProjectFileClient() {
  const user = accountUser.value
  if (!user?.id || !user.email_confirmed_at) throw new Error('请先登录并完成邮箱验证，再访问项目成果文件。')
  const client = await getSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (error || data?.session?.user?.id !== user.id || accountUser.value?.id !== user.id) throw new Error('登录状态已变化，请重新打开项目。')
  return { client, userId: user.id }
}

export async function uploadProjectDeliverableFile(projectId, deliverableId, file) {
  if (!UUID_PATTERN.test(String(projectId || '')) || !UUID_PATTERN.test(String(deliverableId || '')) || !file?.name || !Number.isSafeInteger(file.size)) {
    throw new Error('文件或交付项信息无效。')
  }
  if (file.size < 1) throw new Error('成果文件不能为空。')
  if (file.size > 20 * 1024 * 1024) throw new Error('单个成果文件不能超过 20 MB。')
  const { client, userId } = await verifiedProjectFileClient()
  const safeName = String(file.name).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/\.{2,}/g, '_').slice(0, 120) || 'file'
  const objectId = newProjectId()
  if (!objectId) throw new Error('当前环境无法生成安全文件编号。')
  const path = `${projectId}/${deliverableId}/${userId}/${objectId}-${safeName}`
  const { error } = await client.storage.from(PROJECT_FILE_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600',
  })
  if (accountUser.value?.id !== userId) throw new Error('账号已切换，文件上传已取消。')
  if (error) throw new Error('文件上传失败，请检查网络与项目权限后重试。')
  return { path, name: String(file.name).slice(0, 200), size: file.size, mime: String(file.type || 'application/octet-stream').slice(0, 120) }
}

export async function getProjectDeliverableFileUrl(path) {
  const objectPath = String(path || '')
  const segments = objectPath.split('/')
  if (segments.length !== 4 || !segments.slice(0, 3).every((segment) => UUID_PATTERN.test(segment))
    || !/^[^/\\\u0000-\u001f]{1,200}$/.test(segments[3]) || ['.', '..'].includes(segments[3])) {
    throw new Error('成果文件路径无效。')
  }
  const { client, userId } = await verifiedProjectFileClient()
  const { data, error } = await client.storage.from(PROJECT_FILE_BUCKET).createSignedUrl(objectPath, 60)
  if (accountUser.value?.id !== userId || error || !data?.signedUrl) throw new Error('无法读取成果文件，请刷新项目成员权限后重试。')
  return data.signedUrl
}
