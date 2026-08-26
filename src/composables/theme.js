import { watchEffect } from 'vue'
import { useStoredRef } from './store.js'

export const THEMES = {
  blue: { name: '蓝色', primary: '#456fe8' },
  purple: { name: '紫色', primary: '#8b5cf6' },
  green: { name: '绿色', primary: '#0ea271' },
  pink: { name: '粉色', primary: '#ec4899' },
}

export const themeKey = useStoredRef('sl_theme', 'blue')
export const autoWallpaperColor = useStoredRef('sl_auto_wallpaper_color', false)
export const wallpaperAccent = useStoredRef('sl_wallpaper_accent', '#456fe8')

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

watchEffect(() => {
  const key = themeKey.value in THEMES ? themeKey.value : 'blue'
  document.documentElement.dataset.theme = key
  const root = document.documentElement
  const accent = hexToRgb(wallpaperAccent.value)
  if (autoWallpaperColor.value && accent) {
    root.style.setProperty('--primary', rgbToHex(accent))
    root.style.setProperty('--primary-hover', rgbToHex(mix(accent, [0, 0, 0], 0.16)))
    root.style.setProperty('--primary-soft', rgbToHex(mix(accent, [255, 255, 255], 0.88)))
    root.style.setProperty('--brand-grad-a', rgbToHex(accent))
    root.style.setProperty('--brand-grad-b', rgbToHex(mix(accent, [128, 70, 220], 0.42)))
  } else {
    for (const property of ['--primary', '--primary-hover', '--primary-soft', '--brand-grad-a', '--brand-grad-b']) {
      root.style.removeProperty(property)
    }
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', autoWallpaperColor.value && accent ? wallpaperAccent.value : THEMES[key].primary)
})
