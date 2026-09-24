import { watchEffect, ref } from 'vue'
import { useStoredRef } from './store'
import { highContrast } from './contrast'

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

/** WCAG 相对亮度。 */
function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * 实底上的文字色：亮度够低就用白字，否则用近黑。
 * 浅色主题的所有主色都满足白色（≥4.66:1），只有自定义色和壁纸取色需要动态判断。
 */
function readableOn(rgb) {
  return luminance(rgb) > 0.22 ? '#111827' : '#ffffff'
}

/**
 * 壁纸取来的强调色会直接当按钮实底用，而取色结果可能非常浅
 * （浅黄、米白），白字在上面几乎读不出来。这里按需把它压暗到
 * 白字能到 4.5:1 的亮度，保证按钮文字始终达标；色相保持不变。
 */
function ensureReadableFill(rgb) {
  let candidate = rgb
  for (let step = 0; step < 10 && luminance(candidate) > 0.1833; step += 1) {
    candidate = mix(candidate, [0, 0, 0], 0.12)
  }
  return candidate
}

/**
 * 切换主题时需要清掉的内联变量。
 *
 * 「跟随系统」分支会写入整张调色板（bg/card/text/border/danger…），
 * 其余分支必须清掉同一集合，否则从「跟随系统（暗色）」切到「自定义」或
 * 某个具名主题时，会残留暗色底 #0f1420 与暗色的 --danger，形成串色。
 * 之前 custom 分支只清了 5 个变量，这是真实可见的 bug。
 */
const THEME_VARIABLES = [
  '--primary', '--primary-hover', '--primary-soft', '--brand-grad-a', '--brand-grad-b',
  '--bg', '--card', '--text', '--muted', '--border', '--border-strong',
  '--ink-soft', '--ink-faint', '--bg-tint', '--focus-ring', '--danger',
  '--on-primary', '--on-danger',
]

/**
 * 高对比度下要替换掉的令牌（浅色与深色各一份）。
 *
 * 【为什么这里也要有一份】高对比的色值一直只写在 `style.css` 的
 * `:root[data-contrast='high']` / `:root[data-theme='dark']:not([data-contrast='normal'])` 里
 * （以及 `@media (prefers-contrast: more)` 那一份）。那对**具名主题**有效——
 * 它们走 `else` 分支，只 `clearThemeVariables()`、不写内联变量，所以样式表说了算。
 *
 * 但「跟随系统」主题走的是另一个分支：它把**整张调色板写成内联变量**。
 * 内联样式优先于任何选择器（除非对面写 `!important`），于是：
 * **在跟随系统主题下，高对比设置完全不生效**——深色下 `--border` 停在
 * `#2a3248`（本该是 `#64749a`）、`--muted` 停在 `#8b95a8`（本该是 `#bcc7db`）。
 * 而深色只能由「跟随系统 + 系统偏好深色」产生，所以受影响面并不小。
 *
 * 这两份值必须逐字一致：`tests/highContrastPalette.test.js` 会解析 style.css
 * 里那几个块并逐一比对，避免两处漂移。
 */
const CONTRAST_DELTAS = {
  light: {
    border: '#8b97ae',
    borderStrong: '#55617c',
    inkSoft: '#333d54',
    inkFaint: '#3f4a62',
    muted: '#3d4759',
    bgTint: '#eef1f7',
  },
  dark: {
    border: '#64749a',
    borderStrong: '#93a5c8',
    inkSoft: '#e4eaf5',
    inkFaint: '#ccd6e8',
    muted: '#bcc7db',
    // 曾经是 #1b2333，与深色 --card(#1b2233) 只差一个绿通道值 → 卡片与内嵌区
    // 的分界肉眼不可见（§4 第 12 条记的"层次消失"是真的，只是它写的原因不对）。
    bgTint: '#0d1320',
  },
}

// 系统级高对比（Windows 高对比度主题、macOS 增强对比度）。与 prefersDark 同一套写法。
const prefersContrast = ref(false)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const contrastQuery = window.matchMedia('(prefers-contrast: more)')
  prefersContrast.value = Boolean(contrastQuery.matches)
  contrastQuery.addEventListener?.('change', (event) => {
    prefersContrast.value = Boolean(event.matches)
  })
}

/**
 * 是否需要强对比。
 *
 * 与 `style.css` 的分工保持一致：应用内开关打开就生效，没打开时跟随系统设置。
 * （注：`contrast.js` 目前只写 `'high'` 与 `'auto'` 两种值，所以 CSS 里
 * 「显式关闭 → `data-contrast='normal'` 压制系统设置」那条路当前走不到；
 * 那是三态语义，改动它会动到既有的 `sl_high_contrast` 键语义，故不在此处理。）
 */
function needsStrongContrast() {
  return Boolean(highContrast.value) || prefersContrast.value
}

function clearThemeVariables(root) {
  for (const property of THEME_VARIABLES) root.style.removeProperty(property)
}

function getSystemThemeColors() {
  if (prefersDark.value) {
    return {
      primary: '#5a8cff',
      primaryHover: '#4875e6',
      primarySoft: '#1a2440',
      brandGradA: '#5a8cff',
      brandGradB: '#7c5cff',
      bg: '#121826',
      card: '#1b2233',
      text: '#e8ecf4',
      muted: '#8b95a8',
      border: '#2a3248',
      borderStrong: '#3b4660',
      inkSoft: '#b2bdd0',
      inkFaint: '#8290a8',
      // 第四十二轮：原来 #131a29 与 --bg(#121826) 的最大通道差只有 3，落在页面底色上的
      // 内嵌区几乎看不出边界。改成 #161d2c：与 --bg 差 6（两倍），与 --card(#1b2233) 仍差 7，
      // 且是各通道均匀提亮（读起来是「更亮的表面」而不是「更蓝的表面」）。
      // 深色下压在 tint 上的最弱文字令牌 --ink-faint 仍有 5.22:1（≥4.5）。
      bgTint: '#161d2c',
      focusRing: 'rgba(90, 140, 255, 0.3)',
      danger: '#f87070',
      // 深色主题的 --primary/--danger 本身是亮色，白字只有 3.17:1 / 2.78:1，
      // 实底按钮必须改用深色文字（≥6.7:1）。
      onPrimary: '#0b1020',
      onDanger: '#0b1020',
    }
  }
  return {
    primary: '#3d63d8',
    primaryHover: '#3151b8',
    primarySoft: '#edf2ff',
    brandGradA: '#3d63d8',
    brandGradB: '#7855dc',
    bg: '#f5f7fb',
    card: '#ffffff',
    text: '#172033',
    muted: '#667085',
    border: '#e3e8f2',
    borderStrong: '#d3dbea',
    inkSoft: '#55607a',
    inkFaint: '#626d84',
    bgTint: '#f9fafd',
    focusRing: 'rgba(61, 99, 216, 0.28)',
    danger: '#c62828',
    onPrimary: '#ffffff',
    onDanger: '#ffffff',
  }
}

/**
 * 「跟随系统」主题**最终**写入的调色板：在基础调色板上叠加高对比增量。
 *
 * ⚠ 别把增量直接并进上面那两个 `return { … }` 字面量里：
 * `scripts/audit-contrast.mjs` 是用正则
 * `if (prefersDark.value) { return {…}` 直接解析这两个字面量来取调色板的，
 * 改了它们的形状，审计就抽不到深色调色板（第三十五轮真踩过这条，连红三条）。
 * 增量留在这里，由 `tests/highContrastPalette.test.js` 单独守。
 */
function systemPalette() {
  const base = getSystemThemeColors()
  if (!needsStrongContrast()) return base
  return { ...base, ...CONTRAST_DELTAS[prefersDark.value ? 'dark' : 'light'] }
}

watchEffect(() => {
  const key = themeKey.value
  const isSystem = key === 'system'
  const isCustom = key === 'custom'
  const accent = hexToRgb(wallpaperAccent.value)
  const root = document.documentElement

  if (isSystem) {
    const sys = systemPalette()
    root.dataset.theme = prefersDark.value ? 'dark' : 'light'
    Object.entries(sys).forEach(([prop, value]) => {
      root.style.setProperty(`--${prop.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value)
    })
    if (autoWallpaperColor.value && accent) {
      // 壁纸取色可能非常浅，实底按需压暗、文字色按可读性反推，
      // 否则会出现「浅黄底 + 白字」这种几乎读不出来的按钮。
      const fill = ensureReadableFill(accent)
      root.style.setProperty('--primary', rgbToHex(fill))
      root.style.setProperty('--primary-hover', rgbToHex(mix(fill, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(accent, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', rgbToHex(fill))
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(fill, [128, 70, 220], 0.42)))
      root.style.setProperty('--on-primary', readableOn(fill))
    }
  } else if (isCustom) {
    clearThemeVariables(root)
    const customPrimary = customThemeColor.value
    const customRgb = hexToRgb(customPrimary)
    root.dataset.theme = 'custom'
    if (customRgb) {
      root.style.setProperty('--primary', customPrimary)
      root.style.setProperty('--primary-hover', rgbToHex(mix(customRgb, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(customRgb, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', customPrimary)
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(customRgb, [128, 70, 220], 0.42)))
      // 自定义色可能是浅色（浅黄、薄荷绿），白字会糊在浅底上；
      // 按相对亮度切换成深色文字。
      root.style.setProperty('--on-primary', readableOn(customRgb))
    }
  } else {
    root.dataset.theme = key
    clearThemeVariables(root)
    if (autoWallpaperColor.value && accent) {
      // 壁纸取色可能非常浅，实底按需压暗、文字色按可读性反推，
      // 否则会出现「浅黄底 + 白字」这种几乎读不出来的按钮。
      const fill = ensureReadableFill(accent)
      root.style.setProperty('--primary', rgbToHex(fill))
      root.style.setProperty('--primary-hover', rgbToHex(mix(fill, [0, 0, 0], 0.16)))
      root.style.setProperty('--primary-soft', rgbToHex(mix(accent, [255, 255, 255], 0.88)))
      root.style.setProperty('--brand-grad-a', rgbToHex(fill))
      root.style.setProperty('--brand-grad-b', rgbToHex(mix(fill, [128, 70, 220], 0.42)))
      root.style.setProperty('--on-primary', readableOn(fill))
    }
  }

  // 主题色 meta：自定义主题色是用户从取色器里选的，也可能是恢复备份时来的
  // 非法值或空值；壁纸取色同理。这里统一校验，只写合法 hex，否则回退默认蓝，
  // 避免把一个非法颜色交给浏览器去猜（状态栏会退回默认色，且控制台报错）。
  // meta 标签若不存在（老 index.html / 注入失败）也补一个，保证 PWA 状态栏跟随主题。
  let metaColor = '#456fe8'
  if (isSystem) metaColor = getSystemThemeColors().primary
  else if (isCustom) metaColor = customThemeColor.value
  else metaColor = (THEMES[key] || THEMES.blue).primary
  const preferredColor = autoWallpaperColor.value && accent ? wallpaperAccent.value : metaColor
  const safeColor = hexToRgb(preferredColor) ? preferredColor : '#456fe8'

  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head?.appendChild(meta)
  }
  meta.setAttribute('content', safeColor)
})
