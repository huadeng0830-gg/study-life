import { useStoredRef } from './store'

export const WALLPAPER_TARGETS = {
  global: { label: '全站默认', path: '' },
  home: { label: '首页', path: '/' },
  schedule: { label: '课程表', path: '/schedule' },
  tasks: { label: '待办', path: '/tasks' },
  exams: { label: '重要日期', path: '/exams' },
  lists: { label: '清单', path: '/lists' },
  bills: { label: '账本', path: '/bills' },
}

export const HOME_MODULES = [
  { id: 'next', label: '接下来' },
  { id: 'tasks', label: '现在该做' },
  { id: 'countdowns', label: '需要注意' },
  { id: 'focus', label: '专注' },
  { id: 'week', label: '本周进展' },
]

const DEFAULT_EFFECTS = {
  blur: 0,
  brightness: 100,
  overlay: 24,
  opacity: 100,
  position: 'center center',
  fit: 'auto',
}

const defaultTargets = Object.fromEntries(
  Object.keys(WALLPAPER_TARGETS).map((key) => [key, {
    ...(key === 'global' ? { enabled: false } : { mode: 'inherit' }),
    ...DEFAULT_EFFECTS,
  }])
)

function defaultAppearanceValue() {
  return {
    quotes: ['今天也要漂亮通关。'],
    quoteMode: 'daily',
    fixedQuoteIndex: 0,
    signature: '',
    showQuote: true,
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

function normalize() {
  const config = wallpaperConfig.value ?? {}
  const targets = {}
  for (const key of Object.keys(WALLPAPER_TARGETS)) {
    targets[key] = {
      ...(key === 'global' ? { enabled: false } : { mode: 'inherit' }),
      ...DEFAULT_EFFECTS,
      ...(config.targets?.[key] ?? {}),
    }
  }
  const normalizedConfig = { ...config, targets }
  if (JSON.stringify(normalizedConfig) !== JSON.stringify(config)) wallpaperConfig.value = normalizedConfig

  const current = appearance.value ?? {}
  const existing = Array.isArray(current.homeModules) ? current.homeModules : []
  // 保留用户拖拽后的顺序：先按已存顺序保留合法模块，再补齐新增模块（追加到末尾），并丢弃过时 id。
  // 这样未来新增首页模块时，老用户的旧顺序数组不会丢掉新模块入口。
  const knownIds = new Set(HOME_MODULES.map((item) => item.id))
  const ordered = existing.filter((entry) => entry && knownIds.has(entry.id))
  const seen = new Set(ordered.map((entry) => entry.id))
  for (const item of HOME_MODULES) {
    if (!seen.has(item.id)) ordered.push({ id: item.id, visible: true })
  }
  const homeModules = ordered
  const swipeActions = {
    tasks: {
      left: current.swipeActions?.tasks?.left ?? 'complete',
      right: current.swipeActions?.tasks?.right ?? 'edit',
    },
    lists: {
      left: current.swipeActions?.lists?.left ?? 'complete',
      right: current.swipeActions?.lists?.right ?? 'edit',
    },
  }
  const normalizedAppearance = {
    quoteMode: 'daily',
    fixedQuoteIndex: 0,
    signature: '',
    showQuote: true,
    scheduleSkin: 'classic',
    ...current,
    quotes: Array.isArray(current.quotes) && current.quotes.length ? current.quotes : ['今天也要漂亮通关。'],
    homeModules,
    swipeActions,
  }
  delete normalizedAppearance.foodPickerMode
  if (JSON.stringify(normalizedAppearance) !== JSON.stringify(current)) appearance.value = normalizedAppearance
}

normalize()

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

export function homeModuleState(id) {
  return appearance.value.homeModules.find((item) => item.id === id) ?? { id, visible: true }
}

export function resetAppearanceState() {
  wallpaperConfig.value = {
    targets: JSON.parse(JSON.stringify(defaultTargets)),
  }
  appearance.value = defaultAppearanceValue()
}

export function resetWallpapersOnly() {
  wallpaperConfig.value = {
    targets: JSON.parse(JSON.stringify(defaultTargets)),
  }
}
