// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CROSS_RULE_ALLOWLIST,
  FOCUS_SURFACES,
  auditContrast,
  blendColor,
  contrastRatio,
  crossRuleContrastOffenders,
  focusIndicatorOffenders,
  fontSizeLowerBoundPx,
  gradientSurfaceOffenders,
  inlineSurfaceOffenders,
  largeTextThreshold,
  stripPrintStyles,
  themePalettes,
} from '../scripts/audit-contrast.mjs'

const srcDir = resolve(import.meta.dirname, '..', 'src')

function collectStyles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) collectStyles(full, out)
    // 打印样式不是主题色：纸上是纯黑纯白，由 tests/printStyles.test.js 单独守。
    // 这里的块正则看不懂嵌套，不剥掉就会把打印块里的 #ffffff 当成"近白底字面量"。
    else if (name.endsWith('.css')) out.push({ file: full, css: stripPrintStyles(readFileSync(full, 'utf8')) })
    else if (name.endsWith('.vue')) {
      for (const match of readFileSync(full, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        out.push({ file: full, css: stripPrintStyles(match[1]) })
      }
    }
  }
  return out
}

describe('stripPrintStyles', () => {
  it('剥掉 @media print 与 @page，其它规则一字不动', () => {
    const css = ':root { --bg: #fff; }\n@media print {\n  body { background: #ffffff; }\n  .a, .b { color: #000000; }\n}\n@page { margin: 12mm; }\n.card { color: red; }'
    const stripped = stripPrintStyles(css)
    expect(stripped).toContain(':root { --bg: #fff; }')
    expect(stripped).toContain('.card { color: red; }')
    expect(stripped).not.toContain('#ffffff')
    expect(stripped).not.toContain('#000000')
    expect(stripped).not.toContain('margin: 12mm')
    expect(stripped).not.toContain('@media print')
  })

  it('嵌套花括号也能配平（打印块里还有 :root 与伪元素规则）', () => {
    const css = '.a { color: red; }\n@media print {\n  :root { --x: #000; }\n  *::before { box-shadow: none; }\n}\n.b { color: blue; }'
    const stripped = stripPrintStyles(css)
    expect(stripped).toContain('.a { color: red; }')
    expect(stripped).toContain('.b { color: blue; }')
    expect(stripped).not.toContain('--x')
  })

  it('没有打印样式时原样返回', () => {
    const css = '.a { color: red; }'
    expect(stripPrintStyles(css)).toBe(css)
    expect(stripPrintStyles('')).toBe('')
  })
})

/** RGB 三元组转回 #rrggbb，交给 contrastRatio 用。 */
function toHex(rgb) {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`
}

/**
 * 解析「写死的颜色」为 [r, g, b, alpha]。
 * 只认 hex（3/4/6/8 位）、rgb()/rgba() 和白/黑关键字；
 * var(...)、color-mix(...)、currentColor 这类返回 null（由别的守卫负责）。
 */
function parseColor(value) {
  const text = String(value).trim()
  const named = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] }[text.toLowerCase()]
  if (named) return named
  const functional = text.match(/^rgba?\(([^)]*)\)$/i)
  if (functional) {
    const parts = functional[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
    return [...parts.slice(0, 3), alpha]
  }
  const hex = text.match(/^#([0-9a-fA-F]+)$/)
  if (!hex) return null
  let digits = hex[1]
  let alpha = 1
  if (digits.length === 3 || digits.length === 4) {
    const chars = digits.split('')
    if (chars.length === 4) alpha = parseInt(chars[3] + chars[3], 16) / 255
    digits = chars.slice(0, 3).map((char) => char + char).join('')
  } else if (digits.length === 6 || digits.length === 8) {
    if (digits.length === 8) alpha = parseInt(digits.slice(6, 8), 16) / 255
    digits = digits.slice(0, 6)
  } else {
    return null
  }
  return [...[0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16)), alpha]
}

/**
 * 剥掉 var(...)（含括号配对，兜底值里还可能嵌套 color-mix(...)）。
 * `background: var(--bg, #f6f7fb)` 里的 #f6f7fb 只是「--bg 没定义时」的兜底，
 * 不是实际会渲染的颜色，留着会把每个带 hex 兜底的令牌都误报成白块。
 */
function stripVarFunctions(text) {
  let out = ''
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('var(', index)
    if (start === -1) {
      out += text.slice(index)
      break
    }
    out += text.slice(index, start)
    let depth = 0
    let cursor = start + 3
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '(') depth += 1
      else if (text[cursor] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    index = cursor + 1
  }
  return out
}

/**
 * 声明里是否出现了「几乎无彩且很亮」的写死颜色。
 * 看整个声明值而不只是开头，所以 `background: #fff url(...)`、
 * `background: linear-gradient(...), #ffffff` 这种也能抓到。
 * alpha 为 0 的算不透明……不，算完全透明：`rgba(255,255,255,0)` 常用来做
 * 渐变的透明端（.draft-bar.sticky 就是），它不是白块。
 * alpha 在 0~1 之间的半透明白仍然算——它在深色主题下确实是一层浅色遮罩。
 */
function isNearNeutralWhite(value) {
  const text = stripVarFunctions(String(value))
  const candidates = [
    ...text.matchAll(/#[0-9a-fA-F]+\b/g),
    ...text.matchAll(/rgba?\([^)]*\)/gi),
    ...text.matchAll(/(?:^|[\s,])white(?:[\s,;]|$)/gi),
  ]
  for (const match of candidates) {
    const color = parseColor(match[0].replace(/^[\s,]+/, '').replace(/[\s,;]+$/, ''))
    if (!color) continue
    const [r, g, b, alpha] = color
    if (alpha === 0) continue
    if (Math.max(r, g, b) - Math.min(r, g, b) > 6) continue
    const ratio = contrastRatio(toHex([r, g, b]), '#000000')
    if (ratio === null) continue
    if (0.05 * (ratio - 1) > 0.85) return true
  }
  return false
}

/**
 * 抽出「底是主题令牌、字色却写死」的规则。
 *
 * 这是前两条测试结构上都看不见的一类：`isNearNeutralWhite` 只盯背景，
 * 「主题相关文字色不配写死的浅色底」只盯 `color: var(--danger|primary|success)`
 * 配写死浅底——两者都要求「写死的那一半」出现在**背景**上。反过来
 * `color: #9a651d; background: var(--card)` 这种「底跟着主题、字写死」的写法
 * 一条都抓不到，而它在深色主题下就是不可读的：`#9a651d` 配 `#1b2233` 只有 3.21:1。
 *
 * 底写死的规则不归这里管：文字与底都写死是自洽的（`.warnings` 的
 * `#9a651d` 配 `#fff8e8` 是 4.67:1，达标），由「近白底」那条与人工复核负责。
 */
function tokenSurfaceOffenders(css, palettes) {
  const offenders = []
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].replace(/<style[^>]*>/, '').trim()
    const body = block[2]
    const mixed = body.match(
      /background(?:-color)?\s*:\s*color-mix\([^)]*var\((--[\w-]+)\)[^)]*var\((--[\w-]+)\)/,
    )
    const token = mixed ? mixed[2] : (body.match(/background(?:-color)?\s*:\s*var\((--[\w-]+)\)/) || [])[1]
    if (!token) continue
    const color = (body.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})\b/) || [])[1]
    if (!color) continue
    for (const [name, tokens] of palettes) {
      const bg = tokens[token]
      if (!bg) continue
      const ratio = contrastRatio(color, bg)
      if (ratio !== null && ratio < 4.5) {
        offenders.push(`${selector} → ${color} on ${token}（${name} ${bg}）= ${ratio}:1`)
      }
    }
  }
  return offenders
}

/**
 * 暗色主题下 --primary / --danger 本身是亮色，白字只有 2.8~3.2:1。
 * --on-primary / --on-danger 就是为此存在的，但一开始只有 .btn-primary 用了它们，
 * 另外 6 处（今日标签、筛选标签、文件按钮、合并选项、复盘按钮 hover、导入保存）
 * 仍然写死白字，暗色主题下几乎读不出来。这条测试盯住这类「同一条规则里
 * 实色底 + 写死白字」的写法。
 */
describe('实色底上的文字必须用 on-* 令牌', () => {
  it('没有组件把写死的白色文字放在主题实色底上', () => {
    const offenders = []
    for (const { file, css } of collectStyles(srcDir)) {
      for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1].trim()
        const body = block[2]
        if (!/background(?:-color)?\s*:\s*var\(--(?:primary|danger)\)/.test(body)) continue
        const hardcoded = /(?:^|;)\s*color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(body)
        if (hardcoded) offenders.push(`${file.replace(srcDir, '')} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('on-primary / on-danger 真的被消费了（不是只定义不用的死令牌）', () => {
    const css = collectStyles(srcDir).map((entry) => entry.css).join('\n')
    expect(css).toMatch(/var\(--on-primary/)
    expect(css).toMatch(/var\(--on-danger/)
  })

  /**
   * 同一个坑的另一半：写死的浅色底 + 主题相关文字色。
   * `.danger:hover { color: var(--danger); background: #feecec }` 在浅色主题下没问题，
   * 但深色主题的 --danger 是亮红 #f87070，落在 #feecec 上只有 2.44:1。
   * 这类底色必须用 color-mix(… var(--card)) 让它跟着主题走。
   * 注意：如果文字色也是写死的深红（如 #b13f3f），两套主题下都读得清，
   * 那是自洽的，不属于本规则。
   */
  it('主题相关文字色不配写死的浅色底', () => {
    const luminance = (hex) => {
      const ratio = contrastRatio(hex, '#000000')
      return ratio === null ? null : 0.05 * (ratio - 1)
    }
    const offenders = []
    for (const { file, css } of collectStyles(srcDir)) {
      for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1].trim()
        const body = block[2]
        if (!/(?:^|;)\s*color\s*:\s*var\(--(?:danger|primary|success)\)/i.test(body)) continue
        for (const fill of body.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
          const light = luminance(fill[1])
          if (light !== null && light > 0.6) offenders.push(`${file.replace(srcDir, '')} → ${selector} (${fill[1]})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * 深色主题下 --card 是 #1b2233。写死纯白/近白底的面板、输入框、弹层在深色主题里
   * 会变成白块，配上浅色文字几乎读不出来。
   *
   * 判定方式经过一次收紧：原来是一张十六进制清单
   * （`#fff|#ffffff|#fafbfd|#f9fafd|#fafafa|#fbfbfb|#f8f9fa`），结果
   * `#fffafa`（Toast 错误底、TimeSettingsModal 的 .plan-item.blocked）和
   * `#fdfdff`（ListsView 的 .list-tab:hover）这两类近白根本不在清单里，
   * 深色下同样是白块却一路放行；`rgb(255,255,255)`、`white`、`#ffffffff`
   * 这些等价写法也完全看不见。清单式判据是漏报的根源，所以改成解析色值后按
   * 「几乎无彩（最大与最小通道差 ≤ 6）且很亮（相对亮度 > 0.85）」判定——
   * 任何写法都能还原成 RGB，绕不过去；而 #feecec(0.87)、#fef3c7(0.89)、
   * #effaf6(0.93，通道差 11) 这类真的有色的浅色贴纸不会被误伤。
   *
   * 浅色主题下 --card 就是 #ffffff、--bg-tint 是 #f9fafd（默认/紫/绿/粉四套调色板都
   * 一样），所以换成令牌在浅色下几乎无变化。注意高对比度浅色是例外：
   * 那里 --bg-tint 被刻意改成 #eef1f7，用令牌会让这些面在「高对比度」下真的变灰——
   * 那正是高对比度模式想要的效果，而不是等价替换。
   *
   * 允许清单里的 4 处是「刻意保持浅色」的控件，各有理由，不再新增：
   * 开关滑块必须靠白/深对比才看得见，勾选框的勾是写死白色。
   */
  it('纯近白底必须用 --card / --bg-tint 令牌', () => {
    const ALLOWED = new Set([
      'DataManager.vue|.switch span',
      'LedgerView.vue|.switch-track i',
      'ListsView.vue|.item-check',
      'TasksView.vue|.check',
      // 壁纸预览上的白色毛玻璃面：底下是用户自选的任意壁纸，只有浅底才能配
      // 写死的深色文字（#1f2937）读得清，跟着主题走反而会糊在壁纸上。
      'AppearanceSettings.vue|.preview-card',
      // 「时间轴」皮肤本来就是纸面色，和刻意保留的 .skin-notebook 纸质渐变同一族。
      'ScheduleGrid.vue|.skin-timeline',
    ])
    const offenders = []
    for (const { file, css } of collectStyles(srcDir)) {
      const base = file.split(/[\\/]/).pop()
      for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1].replace(/<style[^>]*>/, '').trim()
        const fill = block[2].match(/background(?:-color)?\s*:\s*([^;]*)/)
        if (!fill) continue
        if (!isNearNeutralWhite(fill[1])) continue
        if (ALLOWED.has(`${base}|${selector}`)) continue
        offenders.push(`${file.replace(srcDir, '')} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('底是主题令牌时，写死的字色必须在两套主题下都达 AA', () => {
    const palettes = [
      ['浅色', themePalettes()['默认（蓝）']],
      ['深色', themePalettes()['深色（跟随系统）']],
    ]
    const offenders = []
    for (const { file, css } of collectStyles(srcDir)) {
      for (const entry of tokenSurfaceOffenders(css, palettes)) {
        offenders.push(`${file.replace(srcDir, '')} → ${entry}`)
      }
    }
    // 扫描器读不到字号，所以门槛统一按正文 4.5 从严；放宽只会漏报。
    // QuickRecordPanel 的 .unknown-tip/.uncertain-tip/.category-tip 原来就是
    // 唯一命中项（#9a651d 配 var(--card) 在深色下 3.21:1），已改为 var(--warning)。
    expect(offenders).toEqual([])
  })

  it('上一条的判定力自证：该抓的抓、不该抓的不抓', () => {
    const palettes = [
      ['浅色', themePalettes()['默认（蓝）']],
      ['深色', themePalettes()['深色（跟随系统）']],
    ]
    // 该抓：写死字色 + 主题令牌底（正是 QuickRecordPanel 修前的写法）
    expect(tokenSurfaceOffenders('.x{color:#9a651d;background:var(--card)}', palettes)).toHaveLength(1)
    // 该抓：color-mix 浅底同样要认得出底色是 --card
    expect(
      tokenSurfaceOffenders('.x{color:#087a58;background:color-mix(in srgb, var(--success) 10%, var(--card))}', palettes),
    ).toHaveLength(1)
    // 不该抓：字色本身就是令牌
    expect(tokenSurfaceOffenders('.x{color:var(--warning);background:var(--card)}', palettes)).toEqual([])
    // 不该抓：文字与底都写死，自洽（属另一族，由「近白底」那条管）
    expect(tokenSurfaceOffenders('.x{color:#9a651d;background:#fff8e8}', palettes)).toEqual([])
    // 不该抓：底色令牌不认识时不猜（宁可漏报，不要拿错底算了报假警）
    expect(tokenSurfaceOffenders('.x{color:#836a44;background:var(--unknown-surface)}', palettes)).toEqual([])
    // 该抓：把「族内加深」的值跨族用到主题卡片上。
    // #836a44 是 App.vue 里配写死暖底 #fffaf0 的（4.91:1 达标），一旦挪到
    // var(--card) 上，深色主题就只有 3.11:1 —— 顺带说明为什么「写死字色 + 主题底」
    // 结构上就不可能同时满足两套主题：要配 #ffffff 达 4.5 需要亮度 ≤0.175，
    // 要配 #1b2233 达 4.5 又需要亮度 ≥0.2515，两者不可能同时成立，
    // 所以这类底色只有换令牌一条路。
    expect(tokenSurfaceOffenders('.x{color:#836a44;background:var(--card)}', palettes)).toHaveLength(1)
  })
})

/**
 * 对比度回归：这些色值以前不达标，改动后必须保持。
 * 任何一次调色板调整都会在这里立刻暴露，而不是等用户看不清了才发现。
 */
describe('颜色对比度 AA 级审计', () => {
  it('全部主题的全部真实配色组合都达 AA', () => {
    const failures = auditContrast().filter((entry) => !entry.pass)
    expect(failures.map((entry) => `${entry.theme} / ${entry.label} = ${entry.ratio}:1`)).toEqual([])
  })

  it('覆盖了浅色、深色与高对比度三套调色板', () => {
    const palettes = themePalettes()
    expect(Object.keys(palettes)).toEqual(
      expect.arrayContaining(['默认（蓝）', '紫色', '绿色', '粉色', '高对比度', '深色（跟随系统）']),
    )
  })

  it('最弱文字在页面底色上不低于 4.5:1（原来是 3.36:1）', () => {
    const tokens = themePalettes()['默认（蓝）']
    const ratio = contrastRatio(tokens['--ink-faint'], tokens['--bg'])
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('主色实底上的文字色按主题切换：浅色主题白字、深色主题深字', () => {
    const palettes = themePalettes()
    expect(palettes['默认（蓝）']['--on-primary']).toBe('#ffffff')
    expect(palettes['深色（跟随系统）']['--on-primary']).not.toBe('#ffffff')
    for (const [name, tokens] of Object.entries(palettes)) {
      const ratio = contrastRatio(tokens['--on-primary'], tokens['--primary'])
      expect(ratio, `${name} 的实底按钮文字`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('危险色既能当文字也能当实底，两个方向都达标', () => {
    const tokens = themePalettes()['默认（蓝）']
    expect(contrastRatio(tokens['--danger'], tokens['--card'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(tokens['--on-danger'], tokens['--danger'])).toBeGreaterThanOrEqual(4.5)
  })

  it('对比度计算本身正确（黑白 21:1、同色 1:1）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#3d63d8', '#3d63d8')).toBeCloseTo(1, 5)
    expect(contrastRatio('not-a-color', '#fff')).toBeNull()
  })

  /**
   * 这个断言是给一个真实事故上的锁：`blockFor()` 原来用
   * `selector\\s*\\{([\\s\\S]*?)\\n\\}` 取规则块，要求块尾是「换行 + }」。
   * 而 style.css 顶部有一组单行规则
   *
   *     :root[data-theme='purple'] { --focus-solid: #6d28d9; }
   *     :root[data-theme='green']  { --focus-solid: #0a7a56; }
   *     :root[data-theme='pink']   { --focus-solid: #be185d; }
   *
   * 查 green 时正则从 L106 的 `{` 起算，非贪婪地一路找到第一个「换行+}」才收尾，
   * 而那个 `}` 属于下面的紫色主题块。结果 `themePalettes()` 里绿色和粉色拿到的都是
   * **紫色**的值（三个具名主题 --primary 一模一样），真实绿 #0a7a54 / 粉 #c02070
   * 从来没进过审计 —— 一个把 A 主题当 B 主题审的守卫会一直报绿。
   * 所以这里不只断言「达标」，还要断言**三个具名主题确实各不相同、且等于 style.css
   * 里各自那块的写定值**。只断言达标是抓不到这个 bug 的。
   */
  it('三个具名主题的调色板必须真的不同（防止解析器把 A 主题当 B 主题审）', () => {
    const palettes = themePalettes()
    const named = ['紫色', '绿色', '粉色']
    const primaries = named.map((name) => palettes[name]['--primary'])
    // style.css L110/L117/L124 三块里写定的值
    expect(palettes['紫色']['--primary']).toBe('#7a37e8')
    expect(palettes['绿色']['--primary']).toBe('#0a7a54')
    expect(palettes['粉色']['--primary']).toBe('#c02070')
    expect(new Set(primaries).size).toBe(named.length)
    // 浅底也必须各自是自己的，否则「主色文字 / 主色浅底」这组就是在拿别人的底算
    const softs = named.map((name) => palettes[name]['--primary-soft'])
    expect(palettes['绿色']['--primary-soft']).toBe('#e6f7f0')
    expect(palettes['粉色']['--primary-soft']).toBe('#fdeaf3')
    expect(new Set(softs).size).toBe(named.length)
    // 运行时的真相：具名主题只设 dataset.theme，颜色全部来自 style.css；
    // theme.js 的 THEMES[*].primary 只用于状态栏 meta 色，不是 CSS 令牌。
    // 两者的值本来就不一样，别把 meta 色当成令牌去审计。
    expect(palettes['绿色']['--primary']).not.toBe('#0ea271')
    expect(palettes['粉色']['--primary']).not.toBe('#ec4899')
  })

  it('幽灵按钮基础态在所有主题下都达 AA（--primary / --primary-soft）', () => {
    for (const [name, tokens] of Object.entries(themePalettes())) {
      const ratio = contrastRatio(tokens['--primary'], tokens['--primary-soft'])
      expect(ratio, `${name} 的幽灵按钮文字 / 主色浅底`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/**
 * §4 第 15 条点名的那一类：**底由一条规则给、字由另一条规则给**。
 * 逐条规则判定的审计结构上看不见它（第七轮是靠手工全仓扫描兜住的，见 §1.16），
 * 这里把手工用的「底跟主题令牌、文字却写死」这条口径做成守卫。
 */
describe('跨规则对比度：底跟主题令牌、文字却写死', () => {
  const styles = () => collectStyles(srcDir)

  it('全仓没有"令牌底上压写死字色且不达 AA"的组合', () => {
    const { offenders } = crossRuleContrastOffenders(styles())
    expect(offenders).toEqual([])
  })

  it('判据真的跑到了东西（族数 / 令牌底 / 写死字色都要够）', () => {
    const { stats } = crossRuleContrastOffenders(styles())
    expect(stats.families, '族数为 0 说明判据与实现脱节了').toBeGreaterThanOrEqual(400)
    expect(stats.tokenBackgrounds, '没有识别出任何令牌背景').toBeGreaterThanOrEqual(300)
    expect(stats.hardCodedColors, '没有识别出任何写死的字色').toBeGreaterThanOrEqual(8)
    // 低不是因为没跑，而是判据**刻意保守**：族里出现多个不同的令牌底时，
    // 祖先链就不确定（`.multi` 与 `.multi .a` 都可能坐在同一个元素上面），
    // 此时宁可漏报也不猜——猜错会把一个可读的界面判成缺陷。
    expect(stats.pairsChecked, '一组配对都没算，守卫在守空气').toBeGreaterThanOrEqual(6)
  })

  it('允许清单不许腐烂：登记过的每一条都必须仍然命中', () => {
    const { allowlisted } = crossRuleContrastOffenders(styles())
    for (const entry of CROSS_RULE_ALLOWLIST) {
      const hit = allowlisted.some((item) => item.file.endsWith(entry.file) && item.selector === entry.selector)
      expect(hit, `允许清单里的 ${entry.file} ${entry.selector} 已经不再命中，应当删掉这一条`).toBe(true)
      expect(entry.reason.trim().length, `${entry.selector} 没有写明理由`).toBeGreaterThan(10)
    }
  })

  it('判定力自证：该抓的抓、不该抓的不抓', () => {
    const fixture = [{
      file: 'src/Fixture.vue',
      css: [
        // 该抓：底是令牌（族内唯一），字写死且几乎和底同色
        '.probe li { background: var(--card); }',
        '.probe i { color: #f2f2f2; }',
        // 不该抓：字色写死，但那个元素自己有底（白色旋钮），实测达标
        '.knob { background: var(--card); }',
        '.knob span { background: #ffffff; }',
        '.knob.on span { color: #07805d; }',
        // 不该抓：族内有多个不同的令牌底，无从判断，宁可漏报也不猜
        '.multi { background: var(--card); }',
        '.multi .a { background: var(--bg-tint); }',
        '.multi em { color: #f4f4f4; }',
      ].join('\n'),
    }]
    const { offenders } = crossRuleContrastOffenders(fixture)
    // offenders 是按主题展开的：浅色各主题都会命中，深色主题因为底变暗而达标。
    expect([...new Set(offenders.map((entry) => entry.selector))]).toEqual(['.probe i'])
    expect(offenders.every((entry) => entry.bgRule === '.probe li')).toBe(true)
    expect(offenders.length, '浅色主题下应当每一套都命中').toBeGreaterThanOrEqual(4)
    expect(Math.min(...offenders.map((entry) => entry.ratio))).toBeLessThan(1.2)
  })

  it('同元素判定要分得清"同一个元素的更宽规则"与"另一个元素"', () => {
    const fixture = [{
      file: 'src/Fixture.vue',
      css: [
        '.knob span { background: #ffffff; }',
        '.knob.on span { color: #07805d; }',
      ].join('\n'),
    }]
    const { offenders } = crossRuleContrastOffenders(fixture)
    expect(offenders).toEqual([])
  })
})

/**
 * §4 第 15 条剩下两类「逐条规则看不见」的假阴性：
 * `background-image` 渐变底，以及模板里写死的内联 `style="background:…"`。
 */
describe('渐变底与模板内联底', () => {
  const styles = () => collectStyles(srcDir)

  /** 读每个 SFC 的**原文**（内联 style 在模板里，不在 style 块里）。 */
  function readSfcSources() {
    const out = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.vue')) out.push({ file: full, text: readFileSync(full, 'utf8') })
      }
    }
    walk(srcDir)
    return out
  }

  it('全仓没有"渐变里最浅的色停压不住字色"的规则', () => {
    const { offenders } = gradientSurfaceOffenders(styles())
    expect(offenders).toEqual([])
  })

  it('渐变判据真的跑到了东西', () => {
    const { stats } = gradientSurfaceOffenders(styles())
    expect(stats.gradientRules, '一条渐变规则都没扫到').toBeGreaterThanOrEqual(10)
    // 【第三十九轮：这条下限从 3 下调到 2，是被证明后的结果，不是为了让改动通过】
    // 原来那个 3 里混着一条**永远匹配不到任何节点**的规则：App.vue 的
    //   `.brand-mark { color:#fff; background:linear-gradient(145deg, var(--brand-grad-a), var(--brand-grad-b)) }`
    // 两条独立依据：
    //   1. 归属：Sidebar.vue:409 的 `<span class="brand-mark">UP</span>` 位于 `.brand`（408）内部，
    //      而 Sidebar.vue 的模板根节点是 `<aside class="sidebar">`（407）⇒ `.brand-mark` 是**内部节点**类；
    //   2. 宿主模板零出现：App.vue 的模板区里 `brand-mark` 出现 **0** 次 ⇒ 删除前那条规则编译出来是
    //      `.brand-mark[data-v-<app>]`，而 Vue 的 scoped CSS 只把父作用域属性加在**子组件根节点**上，
    //      所以它匹配不到任何元素（同批 40 条规则一并按 tests/scopedChildReachability.test.js 的判据清除）。
    // 实测（把删除前的样式块替回 App.vue 复现）：gradientRules / gradientWithColor / stopsChecked
    // = 13 / 3 / 12 → 12 / 2 / 12；只把 `.brand-mark` 这一条注回去，统计立刻回到 13 / 3 / 12，
    // 说明差的就是它一条 ⇒ **2 就是真实生效的条数**，下限压到 3 是把死规则当成"守到了东西"。
    // 判据本身的判别力不受影响：下面的夹具自证（该报的仍会报）照旧。
    expect(stats.gradientWithColor, '没有一条渐变规则同时给字色，判据在守空气').toBeGreaterThanOrEqual(2)
    expect(stats.stopsChecked, '一个色停都没核').toBeGreaterThanOrEqual(10)
  })

  it('渐变判定力自证：最浅色停压不住就报，压得住或没字色就不报', () => {
    const fixture = [{
      file: 'src/Fixture.vue',
      css: [
        // 该抓：白字压在几乎全白的渐变上
        '.bad { color: #ffffff; background-image: linear-gradient(135deg, #ffffff, #f0f0f0); }',
        // 不该抓：白字压在深蓝渐变上
        '.good { color: #ffffff; background-image: linear-gradient(135deg, #1b3a8f, #0e2a6b); }',
        // 不该抓：渐变但这条规则没给字色（字色在别处，交给跨规则判据）
        '.no-color { background-image: linear-gradient(135deg, #ffffff, #f0f0f0); }',
        // 不该抓：深色渐变上的写死浅字（两套主题下都读得出来）
        '.dark { color: #f2f6ff; background: linear-gradient(135deg, #10203f, #0a1730); }',
        // 该抓：令牌字色会随主题翻转，压在**写死**的深色渐变上，浅色主题下就是深字压深底
        '.flip { color: var(--text); background: linear-gradient(135deg, #10203f, #0a1730); }',
      ].join('\n'),
    }]
    const { offenders } = gradientSurfaceOffenders(fixture)
    expect([...new Set(offenders.map((entry) => entry.selector))]).toEqual(['.bad', '.flip'])
    expect(Math.min(...offenders.filter((entry) => entry.selector === '.bad').map((entry) => entry.ratio))).toBeLessThan(1.1)
  })

  it('全仓静态内联背景都是令牌（写死的会被挡下）', () => {
    const { offenders, stats } = inlineSurfaceOffenders(readSfcSources())
    expect(offenders).toEqual([])
    expect(stats.scanned, '一个 SFC 都没扫到').toBeGreaterThanOrEqual(50)
  })

  it('内联判定力自证：只认静态 style，令牌放行、写死要报、:style 不猜', () => {
    const fixture = [{
      file: 'src/Fixture.vue',
      text: [
        '<template>',
        '  <div class="a" style="background: var(--card)">令牌放行</div>',
        '  <div class="b" style="background:#fdfdfd">写死的近白底要报</div>',
        '  <div class="c" style="background: linear-gradient(#fff, #eee)">写死的渐变也要报</div>',
        '  <div class="d" :style="{ background: dynamicValue }">运行时算的，静态判据不猜</div>',
        '  <div class="e" style="color:#fff">没有背景属性，不归这条管</div>',
        '</template>',
        '<style scoped>.x { background: #fdfdfd; }</style>',
      ].join('\n'),
    }]
    const { offenders, stats } = inlineSurfaceOffenders(fixture)
    expect(offenders.map((entry) => entry.selector.startsWith('<div class="b"'))).toContain(true)
    expect(offenders).toHaveLength(2)
    expect(stats.inlineBackgrounds).toBe(3)
  })
})
describe('聚焦指示器的非文本对比度（第四十五轮，WCAG 1.4.11）', () => {
  /**
   * 【为什么判据是"outline 与 halo 取优"】两圈互为补位是**设计意图**：
   * 实色 outline 在浅底上很稳，压到主色按钮上只剩 1.11:1，那时 halo 顶上（5.00:1）。
   * 要求"两圈都达标"会把一个做对了的设计判成缺陷；WCAG 1.4.11 要的是**可感知性**。
   */
  it('全仓零命中，且规模对得上（主题数 × 相邻背景数）', () => {
    const { offenders, stats } = focusIndicatorOffenders()
    expect(offenders, `这些组合下 outline 与 halo 都看不出焦点：\n${offenders.map((o) => `${o.theme} / ${o.surface}：outline ${(o.solidRatio ?? 0).toFixed(2)}，halo ${(o.haloRatio ?? 0).toFixed(2)}`).join('\n')}`).toEqual([])
    // 规模自证：判据和实现脱节（比如主题表读空了）时这里会红
    expect(stats.themes, '主题数少于 6，主题表可能没读全').toBeGreaterThanOrEqual(6)
    expect(stats.surfaces).toBeGreaterThanOrEqual(7)
    expect(stats.combosChecked).toBeGreaterThanOrEqual(42)
  })

  it('相邻背景里必须包含 --primary —— 那是 halo 存在的理由', () => {
    // outline 压在主色按钮上几乎不可见（绿色主题实测 1.00:1），
    // 如果哪天有人把 --primary 从判据里"精简"掉，这个洞就没人守了
    expect(FOCUS_SURFACES).toContain('--primary')
    // 反向：确认这个理由仍然成立（outline 对 --primary 确实很弱），否则这条注释在说谎
    const palettes = themePalettes()
    const weak = Object.entries(palettes)
      .map(([theme, tokens]) => ({ theme, ratio: contrastRatio(tokens['--focus-solid'], tokens['--primary']) }))
      .filter((entry) => entry.ratio !== null && entry.ratio < 3)
    expect(weak.length, 'outline 对 --primary 已经全部达标了？那 halo 的必要性需要重新论证').toBeGreaterThan(0)
  })

  it('两圈都弱才报（outline 弱但 halo 强，是正确形态）', () => {
    const bad = { '主题': { '--focus-solid': '#2b5bd7', '--focus-halo': 'rgba(255, 255, 255, 0)', '--card': '#2b5bd7' } }
    const { offenders } = focusIndicatorOffenders(bad, ['--card'])
    expect(offenders).toHaveLength(1)
    expect(offenders[0].best).toBeLessThan(3)
  })

  it('outline 弱、halo 强 → 放行（主色按钮上的真实形态）', () => {
    const ok = { '主题': { '--focus-solid': '#2b5bd7', '--focus-halo': 'rgba(255, 255, 255, 0.92)', '--primary': '#3d63d8' } }
    expect(contrastRatio('#2b5bd7', '#3d63d8')).toBeLessThan(3)
    expect(focusIndicatorOffenders(ok, ['--primary']).offenders).toEqual([])
  })

  it('outline 强、halo 弱 → 也放行', () => {
    const ok = { '主题': { '--focus-solid': '#172033', '--focus-halo': 'rgba(255, 255, 255, 0)', '--card': '#ffffff' } }
    expect(focusIndicatorOffenders(ok, ['--card']).offenders).toEqual([])
  })

  it('blendColor 把半透明 halo 混到底色上', () => {
    expect(blendColor('rgba(255, 255, 255, 0.92)', '#000000')).toBe('#ebebeb')
    expect(blendColor('rgba(0, 0, 0, 0)', '#123456')).toBe('#123456')
    expect(blendColor('#abcdef', '#000000'), '不透明色原样返回').toBe('#abcdef')
  })

  it('主题表里确实有 --focus-solid 与 --focus-halo（判据不是在扫空气）', () => {
    const palettes = themePalettes()
    for (const [theme, tokens] of Object.entries(palettes)) {
      expect(tokens['--focus-solid'], `${theme} 没有 --focus-solid`).toBeTruthy()
      expect(tokens['--focus-halo'], `${theme} 没有 --focus-halo`).toBeTruthy()
    }
  })

  /**
   * WCAG 1.4.3：大字只要 3:1，正文要 4.5:1。跨规则判定器只看颜色、读不到字号
   * （第四十九轮补上），所以以前对大字也按正文从严——会把"大字 3.5:1 达标"误报成缺陷。
   * 另一边更危险：如果为了少报而把门槛读宽（比如把读不准的 `rem`/`var()` 也当大字），
   * 就会漏掉真缺陷。所以判据是"只有同一条规则里明确写了绝对 px 的大字才降门槛"。
   */
  describe('大字门槛（第四十九轮）', () => {
    const minOf = (fontSize, fontWeight) => largeTextThreshold({ fontSize, fontWeight })

    it('≥24px 是大字；≥18.66px 要加粗才算', () => {
      expect(minOf('24px')).toBe(3)
      expect(minOf('32px')).toBe(3)
      expect(minOf('18.66px', 'bold')).toBe(3)
      expect(minOf('20px', '700')).toBe(3)
      expect(minOf('20px', '600')).toBe(3)
    })

    it('差一点点就还是正文：23.9px、18.66px 不加粗、500 字重', () => {
      expect(minOf('23.9px')).toBe(4.5)
      expect(minOf('18.66px')).toBe(4.5)
      expect(minOf('18.66px', 'normal')).toBe(4.5)
      expect(minOf('20px', '500')).toBe(4.5)
      expect(minOf('14px')).toBe(4.5)
    })

    it('读不准就从严：rem / em / % / var() / 没写，一律按正文', () => {
      expect(minOf('1.5rem')).toBe(4.5)
      expect(minOf('2em')).toBe(4.5)
      expect(minOf('150%')).toBe(4.5)
      expect(minOf('var(--fs-xl)')).toBe(4.5)
      expect(minOf(undefined)).toBe(4.5)
      expect(largeTextThreshold(undefined)).toBe(4.5)
    })

    it('只认"数学上保证"的下界：clamp / max / calc 加速算大字，减法与 min 不算', () => {
      // 可证的下界 → 判大字
      expect(minOf('clamp(30px, 3vw, 38px)'), '§4 第 15 条点名的就是这个写法').toBe(3)
      expect(minOf('max(30px, 3vw)')).toBe(3)
      expect(minOf('calc(30px + 1vw)')).toBe(3)
      expect(fontSizeLowerBoundPx('clamp(30px,3vw,38px)')).toBe(30)
      // 不可证 → 从严
      expect(minOf('min(30px, 3vw)'), 'min 的值只会更小，不是下界').toBe(4.5)
      expect(minOf('calc(30px - 1vw)'), '减去的视口单位可能更大，不是下界').toBe(4.5)
      expect(minOf('max(3vw, 30px)'), '第一项不是 px 就不猜').toBe(4.5)
      expect(fontSizeLowerBoundPx('min(30px,3vw)')).toBe(null)
      expect(fontSizeLowerBoundPx('150%')).toBe(null)
      expect(fontSizeLowerBoundPx('30')).toBe(null)
      // 函数内部的每一项也必须带 px：`clamp(150%, …)` 的第一项是百分比，
      // 不是 150px；读成 150 就会把 150% 判成大字而放宽门槛（方向反了）
      expect(minOf('clamp(150%, 3vw, 38px)')).toBe(4.5)
      expect(minOf('clamp(1.5rem, 3vw, 38px)')).toBe(4.5)
      expect(minOf('max(2em, 30px)')).toBe(4.5)
      expect(minOf('calc(1.5rem + 1vw)')).toBe(4.5)
      expect(fontSizeLowerBoundPx('clamp(150%,3vw,38px)')).toBe(null)
      expect(fontSizeLowerBoundPx('max(2em,30px)')).toBe(null)
    })

    /** 自校准：不写死色号，而是在调色板里找一个恰好落在 [3, 4.5) 的前景色，
     *  这样调色板改了这条判据依然有判别力（找不到就说明判据失效，直接红）。 */
    const probePair = () => {
      const tokens = themePalettes()['默认（蓝）']
      const fg = ['#7a7a7a', '#808080', '#888888', '#909090', '#767676', '#8a8a8a']
        .find((color) => {
          const ratio = contrastRatio(color, tokens['--card'])
          return ratio !== null && ratio >= 3 && ratio < 4.5
        })
      expect(fg, '找不到落在 3:1~4.5:1 之间的颜色，这条判据失去判别力').toBeTruthy()
      return fg
    }
    const probe = (fg, extra) => [{
      file: 'fixture.vue',
      css: `.probe { background: var(--card); }\n.probe .label { color: ${fg}; ${extra} }`,
    }]
    /** 只数本夹具的规则，别把全仓的算进来 */
    const countIn = (result) => result.offenders.filter((entry) => entry.selector.startsWith('.probe')).length
    const themesWith = (fg, min) => Object.values(themePalettes())
      .filter((tokens) => {
        const ratio = contrastRatio(fg, tokens['--card'])
        return ratio !== null && ratio < min
      }).length

    it('同一对颜色：14px 报、24px 不报（逐主题精确计数）', () => {
      const fg = probePair()
      const small = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: 14px;')))
      const large = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: 24px;')))
      expect(small, '正文 14px 达不到 4.5:1，每个主题都该报').toBe(themesWith(fg, 4.5))
      expect(small).toBeGreaterThan(0)
      expect(large, '24px 大字只要 3:1，只该在真正低于 3:1 的主题里报').toBe(themesWith(fg, 3))
      expect(large).toBeLessThan(small)
    })

    it('加粗 19px 也按大字判（同一个颜色，加粗前后结论相反）', () => {
      const fg = probePair()
      const normal = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: 19px; font-weight: 400;')))
      const bold = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: 19px; font-weight: 700;')))
      expect(normal).toBe(themesWith(fg, 4.5))
      expect(bold).toBe(themesWith(fg, 3))
    })

    it('字号写成 var() 读不准时不放宽，仍然按正文报', () => {
      const fg = probePair()
      const result = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: var(--fs-xl);')))
      expect(result, '读不准就从严——放宽会比误报更糟（漏掉真缺陷）').toBe(themesWith(fg, 4.5))
    })

    it('clamp 大字在整条判定链上生效（§4 第 15 条那个真实写法）', () => {
      const fg = probePair()
      const result = countIn(crossRuleContrastOffenders(probe(fg, 'font-size: clamp(30px, 3vw, 38px);')))
      expect(result, 'clamp 的最小值是 30px，是可靠下界，应按大字 3:1 判').toBe(themesWith(fg, 3))
      const { stats } = crossRuleContrastOffenders(probe(fg, 'font-size: clamp(30px, 3vw, 38px);'))
      expect(stats.largeTextRules, '统计里要能看到这条被判成了大字').toBe(1)
    })

    it('统计里报告了按大字判的规则数（判定口径要看得见）', () => {
      // 这个 describe 在聚焦指示器一组里，拿不到跨规则那组的 styles()，就地收集
      const files = []
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = resolve(dir, name)
          if (statSync(full).isDirectory()) walk(full)
          else if (/\.(vue|css)$/.test(full)) files.push(full)
        }
      }
      walk(resolve('src'))
      const repoStyles = files.map((file) => ({ file, css: stripPrintStyles(readFileSync(file, 'utf8')) }))
      const { stats } = crossRuleContrastOffenders(repoStyles)
      expect(stats.families, '族数为 0 说明判据没跑到东西').toBeGreaterThan(0)
      expect(typeof stats.largeTextRules).toBe('number')
      expect(stats.largeTextRules).toBeLessThanOrEqual(stats.hardCodedColors)
    })
  })
})
