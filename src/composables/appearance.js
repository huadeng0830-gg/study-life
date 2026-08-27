import { useStoredRef } from './store.js'

export const WALLPAPER_TARGETS = {
  global: { label: '全站默认', path: '' },
  home: { label: '今日总览', path: '/' },
  schedule: { label: '课程表', path: '/schedule' },
  tasks: { label: '作业与待办', path: '/tasks' },
  exams: { label: '倒计时', path: '/exams' },
  lists: { label: '我的清单', path: '/lists' },
  bills: { label: '固定账单', path: '/bills' },
  food: { label: '今天吃什么', path: '/food' },
}

export const HOME_MODULES = [
  { id: 'hero', label: '欢迎语与成长等级' },
  { id: 'stats', label: '本周数据统计' },
  { id: 'focus', label: '下一节课与最近待办' },
  { id: 'courses', label: '今日课程' },
  { id: 'countdowns', label: '近期倒计时' },
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
    foodPickerMode: 'cards',
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
  config.targets = config.targets ?? {}
  for (const key of Object.keys(WALLPAPER_TARGETS)) {
    config.targets[key] = {
      ...(key === 'global' ? { enabled: false } : { mode: 'inherit' }),
      ...DEFAULT_EFFECTS,
      ...(config.targets[key] ?? {}),
    }
  }
  wallpaperConfig.value = config

  const current = appearance.value ?? {}
  const existing = Array.isArray(current.homeModules) ? current.homeModules : []
  const homeModules = HOME_MODULES.map((item) => existing.find((entry) => entry.id === item.id) ?? { id: item.id, visible: true })
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
  appearance.value = {
    quoteMode: 'daily',
    fixedQuoteIndex: 0,
    signature: '',
    showQuote: true,
    scheduleSkin: 'classic',
    foodPickerMode: 'cards',
    ...current,
    quotes: Array.isArray(current.quotes) && current.quotes.length ? current.quotes : ['今天也要漂亮通关。'],
    homeModules,
    swipeActions,
  }
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
