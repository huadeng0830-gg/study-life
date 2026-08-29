import { watchEffect, ref } from 'vue'
import { useStoredRef } from './store'

export const THEMES = {
  blue: { name: '蓝色', primary: '#456fe8' },
  purple: { name: '紫色', primary: '#8b5cf6' },
  green: { name: '绿色', primary: '#0ea271' },
  pink: { name: '粉色', primary: '#ec4899' },
  system: { name: '跟随系统', primary: null },
  custom: { name: '自定义', primary: null },
}

export const themeKey = useStoredRef('sl_theme', 'blue')
export const customThemeColor = useStoredRef('sl_custom_theme_color', '#456fe8')
export const autoWallpaperColor = useStoredRef('sl_auto_wallpaper_color', false)
export const wallpaperAccent = useStoredRef('sl_wallpaper_accent', '#456fe8')

const prefersDark = ref(false)
if (typeof window !== 'undefined' && window.matchMedia) {
  prefersDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    prefersDark.value = e.matches
  })
}

function hexToRgb(hex) {
  const value = String(hex).replace('#', '')
  if (!/^[a-f\d]{6}$/i.test(value)) return null
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16))
}

function rgbToHex(rgb) {
  return '#' + rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')
}

function mix(rgb, target, amount) {
  return rgb.map((value, index) => value + (target[index] - value) * amount)
}

function getSystemThemeColors() {
  if (prefersDark.value) {
    return {
      primary: '#5a8cff',
      primaryHover: '#4875e6',
      primarySoft: '#1e2a4a',
      brandGradA: '#5a8cff',
      brandGradB: '#7c5cff',
      bg: '#0f1420',
      card: '#181e2e',
      text: '#e8ecf4',
      muted: '#8b95a8',
      border: '#2a3248',
      danger: '#f87070',
    }
  }
  return {
    primary: '#456fe8',
    primaryHover: '#365fd2',
    primarySoft: '#edf2ff',
    brandGradA: '#456fe8',
    brandGradB: '#7855dc',
    bg: '#f5f7fb',
    card: '#ffffff',
    text: '#172033',
    muted: '#667085',
    border: '#e3e8f2',
    danger: '#ef4444',
  }
}

watchEffect(() => {
  const key = themeKey.value
  const isSystem = key === 'system'
  const isCustom = key === 'custom'
  const accent = hexToRgb(wallpaperAccent.value)
  const root = document.documentElement

  if (isSystem) {
    const sys = getSystemThemeColors()
    root.dataset.theme = prefersDark.value ? 'dark' : 'light'
    Object.entries(sys).forEach(([prop, value]) => {
      root.style.setProperty(`--${prop.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value)
    })
    if (autoWallpaperColor.value && accent) {
      root.style.setProperty('--primary', rgbToHex(accent))
      root.style.setProperty('--primary-hover', rgbToHex(mix(accent, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(accent, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', rgbToHex(accent))
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(accent, [128, 70, 220], 0.42)))
    }
  } else if (isCustom) {
    const customPrimary = customThemeColor.value
    const customRgb = hexToRgb(customPrimary)
    root.dataset.theme = 'custom'
    if (customRgb) {
      root.style.setProperty('--primary', customPrimary)
      root.style.setProperty('--primary-hover', rgbToHex(mix(customRgb, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(customRgb, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', customPrimary)
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(customRgb, [128, 70, 220], 0.42)))
    }
  } else {
    const theme = THEMES[key] || THEMES.blue
    root.dataset.theme = key
    for (const property of ['--primary', '--primary-hover', '--primary-soft', '--brand-grad-a', '--brand-grad-b', '--bg', '--card', '--text', '--muted', '--border', '--danger']) {
      root.style.removeProperty(property)
    }
    if (autoWallpaperColor.value && accent) {
      root.style.setProperty('--primary', rgbToHex(accent))
      root.style.setProperty('--primary-hover', rgbToHex(mix(accent, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(accent, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', rgbToHex(accent))
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(accent, [128, 70, 220], 0.42)))
    }
  }

  const meta = document.querySelector('meta[name="theme-color"]')
  let metaColor = '#456fe8'
  if (isSystem) metaColor = getSystemThemeColors().primary
  else if (isCustom) metaColor = customThemeColor.value
  else metaColor = (THEMES[key] || THEMES.blue).primary
  if (meta) meta.setAttribute('content', autoWallpaperColor.value && accent ? wallpaperAccent.value : metaColor)
})
