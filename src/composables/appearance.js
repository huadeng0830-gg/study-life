import { useStoredRef } from './store'
import { HOME_MODULES, normalizeHomeModuleOrder } from './homeModules.js'
import { deepClone } from '../utils/clone.js'

export { HOME_MODULES } from './homeModules.js'

export const WALLPAPER_TARGETS = {
  global: { label: '全站默认', path: '' },
  home: { label: '首页', path: '/' },
  schedule: { label: '课程表', path: '/schedule' },
  tasks: { label: '待办', path: '/tasks' },
  exams: { label: '重要日期', path: '/exams' },
  lists: { label: '清单', path: '/lists' },
  bills: { label: '账本', path: '/bills' },
}

const DEFAULT_EFFECTS = {
  blur: 0,
  brightness: 100,
  overlay: 24,
  opacity: 100,
  position: 'center center',
  fit: 'auto',
}
const QUOTE_MODES = new Set(['daily', 'random', 'fixed'])
const SCHEDULE_SKINS = new Set(['classic', 'notebook', 'timeline'])
const SWIPE_ACTIONS = new Set(['none', 'complete', 'edit', 'delete'])
const WALLPAPER_MODES = new Set(['inherit', 'own', 'none'])
const WALLPAPER_POSITIONS = new Set(['center center', 'center top', 'center bottom', 'left center', 'right center'])
const WALLPAPER_FITS = new Set(['auto', 'cover', 'contain'])

function enumOr(value, allowed, fallback) { return allowed.has(value) ? value : fallback }
function rangeOr(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : fallback
}

export const defaultTargets = Object.fromEntries(
  Object.keys(WALLPAPER_TARGETS).map((key) => [key, {
    ...(key === 'global' ? { enabled: false } : { mode: 'inherit' }),
    ...DEFAULT_EFFECTS,
  }])
)

export function defaultAppearanceValue() {
  return {
    quotes: ['今天也要漂亮通关。'],
    quoteMode: 'daily',
    fixedQuoteIndex: 0,
    signature: '',
    showQuote: true,
    compactHome: true,
    showMood: false,
    startPage: '/',
    homeModules: HOME_MODULES.map((item) => ({ id: item.id, visible: true })),
    scheduleSkin: 'classic',
    swipeActions: {
      tasks: { left: 'complete', right: 'edit' },
      lists: { left: 'complete', right: 'edit' },
    },
  }
}

export const wallpaperConfig = useStoredRef('sl_wallpaper_config', {
  targets: defaultTargets,
})

export const appearance = useStoredRef('sl_appearance', defaultAppearanceValue())

export function normalizeWallpaperConfig(value) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const savedTargets = config.targets && typeof config.targets === 'object' && !Array.isArray(config.targets)
    ? config.targets : {}
  const targets = {}
  for (const key of Object.keys(WALLPAPER_TARGETS)) {
    const saved = savedTargets[key] && typeof savedTargets[key] === 'object' && !Array.isArray(savedTargets[key])
      ? savedTargets[key] : {}
    targets[key] = {
      ...DEFAULT_EFFECTS,
      blur: rangeOr(saved.blur, 0, 20, DEFAULT_EFFECTS.blur),
      brightness: rangeOr(saved.brightness, 50, 130, DEFAULT_EFFECTS.brightness),
      overlay: rangeOr(saved.overlay, 0, 70, DEFAULT_EFFECTS.overlay),
      opacity: rangeOr(saved.opacity, 20, 100, DEFAULT_EFFECTS.opacity),
      position: enumOr(saved.position, WALLPAPER_POSITIONS, DEFAULT_EFFECTS.position),
      fit: enumOr(saved.fit, WALLPAPER_FITS, DEFAULT_EFFECTS.fit),
      ...(key === 'global'
        ? { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : false }
        : { mode: enumOr(saved.mode, WALLPAPER_MODES, 'inherit') }),
    }
  }
  return { ...config, targets }
}

export function normalizeAppearanceValue(value) {
  const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const defaults = defaultAppearanceValue()
  const homeModules = normalizeHomeModuleOrder(current.homeModules)
  const quotes = Array.isArray(current.quotes)
    ? current.quotes.filter((quote) => typeof quote === 'string').map((quote) => quote.slice(0, 2000))
    : []
  const safeQuotes = quotes.length ? quotes : defaults.quotes
  const fixedQuoteIndex = rangeOr(current.fixedQuoteIndex, 0, safeQuotes.length - 1, 0)
  const swipeActions = {
    tasks: {
      left: enumOr(current.swipeActions?.tasks?.left, SWIPE_ACTIONS, defaults.swipeActions.tasks.left),
      right: enumOr(current.swipeActions?.tasks?.right, SWIPE_ACTIONS, defaults.swipeActions.tasks.right),
    },
    lists: {
      left: enumOr(current.swipeActions?.lists?.left, SWIPE_ACTIONS, defaults.swipeActions.lists.left),
      right: enumOr(current.swipeActions?.lists?.right, SWIPE_ACTIONS, defaults.swipeActions.lists.right),
    },
  }
  const normalizedAppearance = {
    ...current,
    quotes: safeQuotes,
    quoteMode: enumOr(current.quoteMode, QUOTE_MODES, defaults.quoteMode),
    fixedQuoteIndex,
    signature: typeof current.signature === 'string' ? current.signature.slice(0, 40) : defaults.signature,
    showQuote: typeof current.showQuote === 'boolean' ? current.showQuote : defaults.showQuote,
    compactHome: current.compactHome !== false,
    showMood: current.showMood === true,
    startPage: current.startPage === '/schedule' ? '/schedule' : '/',
    homeModules,
    scheduleSkin: enumOr(current.scheduleSkin, SCHEDULE_SKINS, defaults.scheduleSkin),
    swipeActions,
  }
  delete normalizedAppearance.foodPickerMode
  return normalizedAppearance
}

function normalize() {
  const config = wallpaperConfig.value ?? {}
  const normalizedConfig = normalizeWallpaperConfig(config)
  if (JSON.stringify(normalizedConfig) !== JSON.stringify(config)) wallpaperConfig.value = normalizedConfig

  const current = appearance.value ?? {}
  const normalizedAppearance = normalizeAppearanceValue(current)
  if (JSON.stringify(normalizedAppearance) !== JSON.stringify(current)) appearance.value = normalizedAppearance
}

normalize()

// 【为什么不挂 watch 再归一化】
// 曾经以为「恢复备份/导入后缺字段要整页刷新」是个缺陷，于是加了一条
// `watch([appearance, wallpaperConfig], normalize, { deep: true, flush: 'sync' })`。
// 实测结论相反，两点都成立：
//   1. 那条路径本来就会整页重载（dataManagerBackup.js 的 `window.location.reload()`），
//      模块加载时这一次 normalize() 已经覆盖，监听换不来任何新能力；
//   2. 它会在**账号同步安装默认值**时立刻回写一个完整的 appearance 对象，凭空造出
//      一条本机修改，触发同步引擎的基线校验 —— accountSyncEngine 用例从 25/25 变红。
// 所以这里刻意保持「只在加载时归一化一次」。真要再动，先跑 accountSyncEngine 全文件。

export function targetForPath(path) {
  return Object.entries(WALLPAPER_TARGETS).find(([, item]) => item.path === path)?.[0] ?? 'global'
}

export function activeWallpaperSpec(path) {
  const pageTarget = targetForPath(path)
  const page = wallpaperConfig.value.targets[pageTarget]
  const global = wallpaperConfig.value.targets.global
  if (pageTarget !== 'global' && page?.mode === 'none') return null
  if (pageTarget !== 'global' && page?.mode === 'own') return { target: pageTarget, settings: page }
  if (!global?.enabled) return null
  return { target: 'global', settings: global }
}

export function resetAppearanceState() {
  wallpaperConfig.value = {
    targets: deepClone(defaultTargets),
  }
  appearance.value = defaultAppearanceValue()
}

export function resetWallpapersOnly() {
  wallpaperConfig.value = {
    targets: deepClone(defaultTargets),
  }
}
