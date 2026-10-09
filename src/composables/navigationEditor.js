import { computed, ref, shallowRef, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { restoreStoredValues } from './store/cloudAccess.js'
import { availableNavigationItems } from '../router/navigation.js'
import {
  DEFAULT_DESKTOP_NAVIGATION, DEFAULT_MOBILE_NAVIGATION,
  DESKTOP_NAVIGATION_KEY, MOBILE_NAVIGATION_KEY,
  MAX_DESKTOP_NAV_GROUPS, MAX_MOBILE_NAV_ITEMS, MAX_NAV_GROUP_LABEL_LENGTH,
  desktopNavigation, mobileNavigation, moveNavigationItem, navigationItem,
  normalizeDesktopNavigation, normalizeMobileNavigation,
} from './navigationPreferences.js'

const MODES = ['mobile', 'desktop']
const STORAGE_KEYS = { mobile: MOBILE_NAVIGATION_KEY, desktop: DESKTOP_NAVIGATION_KEY }
const HISTORY_LIMIT = 50
const clone = (value) => JSON.parse(JSON.stringify(value))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const emptyHistory = () => ({ past: [], future: [], batch: null, batchFuture: null })

/**
 * Navigation edits are isolated until save. Commands, validation and history
 * cross the same interface in the UI and tests; persistence is one batch for
 * both devices. Saved refs can also change through restore or another window.
 */
export function useNavigationEditor({
  mobile = mobileNavigation, desktop = desktopNavigation,
  user = accountUser, persist = restoreStoredValues, initialMode = 'mobile',
} = {}) {
  const mode = ref(initialMode === 'desktop' ? 'desktop' : 'mobile')
  const drafts = shallowRef({ mobile: [], desktop: [] })
  const baseline = shallowRef({ mobile: [], desktop: [] })
  const histories = shallowRef({ mobile: emptyHistory(), desktop: emptyHistory() })
  const saving = ref(false)
  const error = ref('')
  const message = ref('')
  let session = 0
  let groupSequence = 0

  const readSaved = (device) => device === 'mobile'
    ? normalizeMobileNavigation(mobile.value)
    : normalizeDesktopNavigation(desktop.value)
  const availableItems = computed(() => availableNavigationItems(user.value))
  const availableIds = computed(() => new Set(availableItems.value.map((item) => item.id)))
  const dirty = computed(() => Object.fromEntries(MODES.map((device) => [device,
    !equal(drafts.value[device], baseline.value[device]),
  ])))
  const hasChanges = computed(() => MODES.some((device) => dirty.value[device]))
  const conflicts = computed(() => saving.value ? [] : MODES.filter((device) => dirty.value[device]
    && !equal(readSaved(device), baseline.value[device])))
  const canUndo = computed(() => !saving.value && histories.value[mode.value].past.length > 0)
  const canRedo = computed(() => !saving.value && histories.value[mode.value].future.length > 0)
  const isDefault = computed(() => equal(drafts.value[mode.value], mode.value === 'mobile'
    ? DEFAULT_MOBILE_NAVIGATION : DEFAULT_DESKTOP_NAVIGATION))

  function begin() {
    session += 1
    const next = { mobile: readSaved('mobile'), desktop: readSaved('desktop') }
    drafts.value = clone(next)
    baseline.value = clone(next)
    histories.value = { mobile: emptyHistory(), desktop: emptyHistory() }
    error.value = ''
    message.value = ''
  }

  function replace(device, value) {
    drafts.value = { ...drafts.value, [device]: clone(value) }
  }

  function adoptSaved(device, latest = readSaved(device)) {
    replace(device, latest)
    baseline.value = { ...baseline.value, [device]: clone(latest) }
    histories.value = { ...histories.value, [device]: emptyHistory() }
  }

  function rebase(device, keepDraft = false) {
    if (!MODES.includes(device) || saving.value) return
    const latest = readSaved(device)
    if (keepDraft) baseline.value = { ...baseline.value, [device]: clone(latest) }
    else adoptSaved(device, latest)
    error.value = ''
    message.value = keepDraft ? '已保留当前草稿，保存后将覆盖此端的最新布局。' : '已载入最新布局。'
  }

  // A clean device follows external changes without erasing the other draft.
  // Dirty drafts stay intact and require an explicit conflict choice.
  for (const device of MODES) {
    watch(device === 'mobile' ? mobile : desktop, () => {
      if (saving.value) return
      if (!dirty.value[device] || equal(drafts.value[device], readSaved(device))) rebase(device)
    }, { deep: true, flush: 'sync' })
  }
  watch(() => user.value?.id, begin, { flush: 'sync' })
  watch(mode, () => {
    histories.value = Object.fromEntries(MODES.map((device) => [device, { ...histories.value[device], batch: null }]))
    error.value = ''
    message.value = ''
  }, { flush: 'sync' })
  begin()

  function validateLabel(label) {
    if (typeof label !== 'string' || !label.trim()) throw new Error('分组名称不能为空。')
    if (label.trim().length > MAX_NAV_GROUP_LABEL_LENGTH) throw new Error(`分组名称最多 ${MAX_NAV_GROUP_LABEL_LENGTH} 个字符。`)
    return label.trim()
  }

  /** Apply a user intention. IDs, rather than filtered row indices, are stable. */
  function apply(command, { batch = null } = {}) {
    if (saving.value) return false
    const device = command.type === 'defaults' ? mode.value
      : command.type.startsWith('mobile:') ? 'mobile' : 'desktop'
    const before = drafts.value[device]
    let next = clone(before)
    try {
      const item = navigationItem(command.id)
      switch (command.type) {
        case 'defaults':
          next = clone(device === 'mobile' ? DEFAULT_MOBILE_NAVIGATION : DEFAULT_DESKTOP_NAVIGATION)
          break
        case 'mobile:add':
          if (!availableIds.value.has(command.id) || next.includes(command.id)) return false
          if (next.length >= MAX_MOBILE_NAV_ITEMS) throw new Error(`最多添加 ${MAX_MOBILE_NAV_ITEMS} 个页面，请先移除一个。`)
          next.push(command.id)
          break
        case 'mobile:remove':
          next = next.filter((id) => id !== command.id)
          break
        case 'mobile:move':
          next = moveNavigationItem(next, next.indexOf(command.id), command.to)
          break
        case 'desktop:pin': {
          if (!availableIds.value.has(command.id) || next.some((group) => group.items.includes(command.id))) return false
          let target = next.find((group) => group.id === command.groupId)
          if (!target && command.groupId) return false
          if (!target) target = next.find((group) => group.id === item.groupId) || next[0]
          target.items.push(command.id)
          break
        }
        case 'desktop:unpin':
          next = next.map((group) => ({ ...group, items: group.items.filter((id) => id !== command.id) }))
          break
        case 'desktop:move-item': {
          const source = next.find((group) => group.items.includes(command.id))
          const target = next.find((group) => group.id === (command.groupId || source?.id))
          if (!source || !target) return false
          if (source === target) target.items = moveNavigationItem(target.items, target.items.indexOf(command.id), command.to)
          else {
            source.items = source.items.filter((id) => id !== command.id)
            const position = Number.isInteger(command.to) ? Math.max(0, Math.min(target.items.length, command.to)) : target.items.length
            target.items.splice(position, 0, command.id)
          }
          break
        }
        case 'desktop:move-group':
          next = moveNavigationItem(next, next.findIndex((group) => group.id === command.id), command.to)
          break
        case 'desktop:add-group': {
          if (next.length >= MAX_DESKTOP_NAV_GROUPS) throw new Error(`最多创建 ${MAX_DESKTOP_NAV_GROUPS} 个分组。`)
          const label = validateLabel(command.label)
          let id
          do { id = `custom-${Date.now().toString(36)}-${(++groupSequence).toString(36)}` }
          while (next.some((group) => group.id === id))
          next.push({ id, label, items: [] })
          break
        }
        case 'desktop:rename-group': {
          const target = next.find((group) => group.id === command.id)
          if (!target || typeof command.label !== 'string') return false
          target.label = command.label.slice(0, MAX_NAV_GROUP_LABEL_LENGTH)
          break
        }
        case 'desktop:remove-group': {
          if (next.length <= 1) return false
          const source = next.find((group) => group.id === command.id)
          const target = next.find((group) => group.id !== command.id && group.id === command.groupId)
            || next.find((group) => group.id !== command.id)
          if (!source || !target) return false
          target.items.push(...source.items)
          next = next.filter((group) => group.id !== command.id)
          break
        }
        default: return false
      }
      if (equal(before, next)) return false
      const history = histories.value[device]
      histories.value = { ...histories.value, [device]: {
        past: batch && batch === history.batch ? history.past : [...history.past.slice(-(HISTORY_LIMIT - 1)), clone(before)],
        future: [], batch,
        batchFuture: batch && batch === history.batch ? history.batchFuture : batch ? history.future : null,
      } }
      replace(device, next)
      error.value = ''
      message.value = command.type === 'defaults' ? '默认布局已载入预览，保存后生效；可以撤销。' : ''
      return true
    } catch (cause) {
      error.value = cause.message
      return false
    }
  }

  function undo({ cancel = false } = {}) {
    if (!canUndo.value) return false
    const device = mode.value
    const history = histories.value[device]
    histories.value = { ...histories.value, [device]: {
      past: history.past.slice(0, -1),
      future: cancel ? history.batchFuture || history.future : [...history.future, clone(drafts.value[device])],
      batch: null, batchFuture: null,
    } }
    replace(device, history.past.at(-1))
    error.value = ''
    message.value = cancel ? '' : '已撤销上一步。'
    return true
  }

  function redo() {
    if (!canRedo.value) return false
    const device = mode.value
    const history = histories.value[device]
    histories.value = { ...histories.value, [device]: {
      past: [...history.past, clone(drafts.value[device])], future: history.future.slice(0, -1), batch: null,
    } }
    replace(device, history.future.at(-1))
    error.value = ''
    message.value = '已重做上一步。'
    return true
  }

  async function save() {
    if (saving.value) return false
    if (!hasChanges.value) return true
    error.value = ''
    message.value = ''
    const savedSession = session
    const devices = MODES.filter((device) => dirty.value[device])
    const values = {}
    try {
      if (conflicts.value.length) throw new Error('布局已在其他窗口或同步中更新，请先选择如何处理最新布局。')
      for (const device of devices) {
        if (device === 'desktop') drafts.value.desktop.forEach((group) => validateLabel(group.label))
        values[STORAGE_KEYS[device]] = device === 'mobile'
          ? normalizeMobileNavigation(drafts.value.mobile) : normalizeDesktopNavigation(drafts.value.desktop)
      }
      saving.value = true
      // Keep the drafts owned by this editor; the store receives separate values.
      await persist(clone(values))
      if (session !== savedSession) return false
      let receivedUpdate = false
      for (const device of devices) {
        const saved = readSaved(device)
        receivedUpdate ||= !equal(saved, values[STORAGE_KEYS[device]])
        adoptSaved(device, saved)
      }
      message.value = receivedUpdate ? '保存期间收到新的布局更新，已显示最新布局。'
        : devices.length === 2 ? '手机导航和电脑侧栏已保存并立即生效。'
        : devices[0] === 'mobile' ? '手机底部导航已保存并立即生效。' : '电脑侧栏布局已保存并立即生效。'
      return true
    } catch (cause) {
      if (session === savedSession) error.value = cause?.message || '保存失败，请稍后重试。'
      return false
    } finally {
      saving.value = false
      // Watchers pause during persistence; catch up untouched devices as well,
      // including updates received while a failed save was being rolled back.
      if (session === savedSession) {
        for (const device of MODES) {
          if (!dirty.value[device] && !equal(readSaved(device), baseline.value[device])) adoptSaved(device)
        }
      }
    }
  }

  return {
    mode, drafts: computed(() => drafts.value), availableItems, dirty, hasChanges,
    conflicts, saving, error, message, canUndo, canRedo, isDefault,
    begin, apply, undo, redo, save, rebase,
  }
}
