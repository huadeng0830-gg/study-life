// @vitest-environment node
/**
 * 组件内死 CSS 的守卫（第三十七轮新增）。
 *
 * 【为什么需要】`tests/styleHooks.test.js` 只扫 `style.css` 与 `theme.js`；
 * 组件 `<style scoped>` 里的死类此前**没有任何守卫**，只能靠人看（§4 第 13/17 条）。
 * 子代理曾用探测器跑出 171 个候选，但因为假阳性太多而没法做成断言 ——
 * 所以这条守卫的关键不在"扫描"，而在**例外机制**。
 *
 * 【判据：一个类算"有人在用"，只要满足其中之一】
 *   1. 出现在本文件的模板/脚本里，或全仓任何其它文件里（含子组件模板、父组件 `:class`）；
 *   2. 命中**过渡类名**：`<Transition name="x">` 会让 Vue 运行时生成 `x-enter-*` 等；
 *   3. 命中**动态拼接前缀**：`` `step-${status}` ``、`'skin-' + skin` 这类，前缀全仓聚合。
 *
 * 【两个踩过的坑，都写进了实现】
 *   - App.vue 的模板注释里写了字面量 `<style>`（"见 <style> 里的 .skip-to-content"），
 *     用 `/<style[^>]*>[\s\S]*?<\/style>/` 定位样式块会从注释里那个开始匹配、
 *     一路吃到第一个 `</style>`，把中间整段模板当成样式剔掉 —— 里面的类名全成假阳性
 *     （`skip-to-content`、`global-safe-mode-alert` 等 5 个就是这么误报的）。所以
 *     `styleRanges()` 带 HTML 注释状态扫描。
 *   - 动态前缀只看本文件不够：`.skin-notebook` / `.skin-timeline` 是**刻意保留**的皮肤
 *     （§4 第 10 条），类名由别处 `` `skin-${skin}` `` 拼出来，前缀必须全仓聚合。
 *
 * 【为什么敢断言"零"】死类候选额外用**构建产物**交叉验证：模板里的类名会出现在编译后的
 * JS 里，构建 JS 里都找不到才算真死。第三十七轮据此删掉了 27 个类、93 条规则。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const srcDir = resolve(import.meta.dirname, '..', 'src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js)$/.test(name)) out.push(full)
  }
  return out
}

const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** 扫描 `<style …>…</style>` 区间；跳过 HTML 注释里的字面量 `<style>`（见文件头说明）。 */
function styleRanges(raw) {
  const ranges = []
  let index = 0
  let inComment = false
  while (index < raw.length) {
    if (!inComment && raw.startsWith('<!--', index)) { inComment = true; index += 4; continue }
    if (inComment && raw.startsWith('-->', index)) { inComment = false; index += 3; continue }
    if (!inComment && raw.startsWith('<style', index)) {
      const open = raw.indexOf('>', index)
      const close = raw.indexOf('</style>', open)
      if (open === -1 || close === -1) break
      ranges.push({ start: index, end: close + 8, tag: raw.slice(index, open + 1), body: raw.slice(open + 1, close) })
      index = close + 8
      continue
    }
    index += 1
  }
  return ranges
}

/** 用法语料 = 原文去掉样式块（按下标切，不靠正则撒网）。 */
function usageText(raw) {
  let out = ''
  let cursor = 0
  for (const range of styleRanges(raw)) {
    out += raw.slice(cursor, range.start)
    cursor = range.end
  }
  return stripCssComments(out + raw.slice(cursor))
}

function bodyOf(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(open + 1, i) }
  }
  return ''
}

/** 样式块里定义的类名。`:deep()`/`::v-deep`/`:slotted`/`:global` 内部作用在别处，跳过。 */
function styleClasses(css) {
  const found = new Set()
  const scan = (text) => {
    for (const match of text.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1]
        .replace(/:deep\([^)]*\)/g, ' ')
        .replace(/::v-deep[^\s{]*/g, ' ')
        .replace(/:(slotted|global)\([^)]*\)/g, ' ')
      for (const cls of selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) found.add(cls[1])
      const inner = bodyOf(text, match.index + match[0].length - 1)
      if (inner && /@(media|supports|container)/.test(match[1])) scan(inner)
    }
  }
  scan(stripCssComments(css))
  return found
}

/** 动态拼接前缀：模板字面量里 `${` 之前那段静态片段，或 `'foo-' + x`。 */
function dynamicPrefixes(raw) {
  const out = new Set()
  for (const match of raw.matchAll(/`([^`]*)`/g)) {
    const parts = match[1].split(/\$\{[^}]*\}/)
    for (let i = 0; i < parts.length - 1; i += 1) {
      const fragment = /([\w-]+-)$/.exec(parts[i])
      if (fragment) out.add(fragment[1])
    }
  }
  for (const match of raw.matchAll(/['"]([\w-]+-)['"]\s*\+/g)) out.add(match[1])
  return [...out]
}

const tokenPattern = (name) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)

/** 对一份「文件集合」跑完整判据，返回 { dead, classes, transitions, dynamic, blocks }。 */
function analyze(files) {
  const sources = files.map((file) => ({ file, raw: readFileSync(file, 'utf8') }))
  const corpus = sources.map(({ raw }) => usageText(raw)).join('\n')
  const globalPrefixes = [...new Set(sources.flatMap(({ raw }) => dynamicPrefixes(raw)))]
  const globalTransitions = [...new Set(sources.flatMap(({ raw }) => [...raw.matchAll(/<Transition[^>]*\bname="([\w-]+)"/g)].map((match) => match[1])))]
  const globalDefaultTransition = sources.some(({ raw }) => /<Transition(?![^>]*\bname=)/.test(raw))
  const dead = []
  let classes = 0
  let transitions = 0
  let dynamic = 0
  let blocks = 0
  for (const { file, raw } of sources) {
    if (!file.endsWith('.vue')) continue
    const ranges = styleRanges(raw)
    const scoped = ranges.filter((range) => /scoped/.test(range.tag))
    if (!scoped.length) continue
    blocks += scoped.length
    const declared = styleClasses(scoped.map((range) => range.body).join('\n'))
    classes += declared.size
    const own = usageText(raw)
    const others = corpus.replace(own, ' ')
    const names = [...raw.matchAll(/<Transition[^>]*\bname="([\w-]+)"/g)].map((match) => match[1])
    const defaultTransition = /<Transition(?![^>]*\bname=)/.test(raw)
    const prefixes = dynamicPrefixes(raw)
    for (const name of declared) {
      const token = tokenPattern(name)
      if (token.test(own) || token.test(others)) continue
      if (names.some((n) => name.startsWith(`${n}-`)) || (defaultTransition && name.startsWith('v-'))) { transitions += 1; continue }
      if (globalTransitions.some((n) => name.startsWith(`${n}-`)) || (globalDefaultTransition && name.startsWith('v-'))) { transitions += 1; continue }
      if (prefixes.some((p) => name.startsWith(p)) || globalPrefixes.some((p) => name.startsWith(p))) { dynamic += 1; continue }
      dead.push(`${file.replace(/\\/g, '/').replace('src/', '')}: ${name}`)
    }
  }
  return { dead, classes, transitions, dynamic, blocks, globalPrefixes }
}

const FILES = walk(srcDir)
const result = analyze(FILES)

describe('组件内死 CSS 的守卫', () => {
  it('自证扫描真的扫到了东西（正则会静默变空，断言就永远通过）', () => {
    expect(result.blocks, '没扫到任何 scoped 样式块').toBeGreaterThanOrEqual(40)
    expect(result.classes, '扫到的类名太少，判据没有意义').toBeGreaterThanOrEqual(300)
    expect(FILES.length).toBeGreaterThanOrEqual(60)
  })

  it('例外机制本身是活的（否则它会把真用在用的类也放过）', () => {
    // 过渡类名与动态前缀都要真的命中过：数量为 0 说明机制写坏了、悄悄放行一切。
    expect(result.transitions, '没有任何过渡类名被识别，机制可能失效').toBeGreaterThanOrEqual(10)
    expect(result.dynamic, '没有任何动态前缀被识别，机制可能失效').toBeGreaterThanOrEqual(5)
    expect(result.globalPrefixes.length, '全仓动态前缀太少').toBeGreaterThanOrEqual(10)
  })

  it('判定力自证：该抓的抓、不该抓的不抓', () => {
    // 合成样例：一个真死类 + 一个过渡类 + 一个动态前缀类 + 一个模板里在用的类。
    const sample = [
      '<template>',
      '  <div class="used-here">',
      '    <Transition name="fade">',
      '      <p v-if="ok" :class="`step-${status}`">x</p>',
      '    </Transition>',
      '  </div>',
      '</template>',
      '<style scoped>',
      '  .used-here { color: red; }',
      '  .really-dead { color: blue; }',
      '  .fade-enter-active { opacity: 0; }',
      '  .step-running { color: green; }',
      '</style>',
    ].join('\n')
    const dir = resolve(import.meta.dirname, '.tmp-dead-css')
    const file = resolve(dir, 'Sample.vue')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, sample)
    try {
      const { dead } = analyze([file])
      expect(dead.length, `合成样例只该报 1 条，实报 ${dead.length} 条：${dead.join('｜')}`).toBe(1)
      expect(dead[0]).toContain('really-dead')
      expect(dead.some((entry) => entry.includes('used-here')), '模板里在用的类被误报').toBe(false)
      expect(dead.some((entry) => entry.includes('fade-enter-active')), '过渡类名被误报').toBe(false)
      expect(dead.some((entry) => entry.includes('step-running')), '动态前缀类被误报').toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('组件内没有死类（例外机制之外的残余必须为零）', () => {
    expect(result.dead, `组件内死 CSS（要么删掉，要么补进例外机制并说明理由）：\n  ${result.dead.join('\n  ')}`).toEqual([])
  })
})