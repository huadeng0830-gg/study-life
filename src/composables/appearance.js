import { useStoredRef } from './store'
import { HOME_MODULES, findHomeModuleState, normalizeHomeModuleOrder } from './homeModules.js'

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
  const homeModules = normalizeHomeModuleOrder(current.homeModules)
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

export function homeModuleState(id) {
  return findHomeModuleState(appearance.value.homeModules, id)
}

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
    targets: JSON.parse(JSON.stringify(defaultTargets)),
  }
  appearance.value = defaultAppearanceValue()
}

export function resetWallpapersOnly() {
  wallpaperConfig.value = {
    targets: JSON.parse(JSON.stringify(defaultTargets)),
  }
}
