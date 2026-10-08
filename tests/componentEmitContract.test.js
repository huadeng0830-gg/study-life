// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 组件事件契约：**组件 emit 出去的每个事件名，都必须在同一个文件里登记过**。
 *
 * 【这个文件来自一个真缺陷】
 * `views/ledger-panels/QuickEntryModal.vue` 的模板里写着
 *   `@close="$emit('update:showQuickRecord', false)"`
 * 但它的 `defineEmits([...])` 里没有这个名字，页面（LedgerView）也没有监听
 * `@update:show-quick-record`。于是账本里「⚡ 用一句话记」那一层的
 * ✕ / 点遮罩 / 按 Esc **三条关闭路径全部发出去了却没人接** —— 用户只能靠保存一笔才能离开。
 *
 * 这类缺陷抓不到的原因很具体：未登记的 emit 既不报错也不告警（Vue 只在开发构建下
 * 对"声明了但没监听"和"未知事件"给提示，而 `$emit('x')` 传一个没声明的名字完全合法），
 * 静态检查与 2183 条既有用例也都不覆盖它。
 *
 * 【判据】`$emit('x')` / `emit('x')` 里出现的每个 x，必须能在同一文件里找到登记：
 *   - `<script setup>` 的 `defineEmits(['x', ...])`，或
 *   - options 组件里的 `emits: ['x', ...]`（本仓库 AppearanceSettings.vue 内部那个
 *     局部 `defineComponent` 用的就是这种写法，不能只认 defineEmits 而误报它）。
 *
 * 【边界】只认**字符串字面量**：动态拼接的事件名（`` emit(`update:${key}`) ``）无法静态判定，
 * 本判据直接跳过，不假装覆盖到。
 */

const SRC = join(import.meta.dirname, '..', 'src')

function walkVueFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkVueFiles(full, out)
    else if (full.endsWith('.vue')) out.push(full)
  }
  return out
}

/**
 * 剥注释：块注释、HTML 注释、行注释、以及**正则字面量**。
 *
 * 【为什么不能再用一条正则糊过去】上一版是一条"斜杠斜杠吃到行尾"的行注释正则。
 * 对抗性复核给出两个可复现反例：
 *   - 假红：`const a = 1// emit('ghost:event')` —— 斜杠紧贴词字符时不被当注释，注释里的字面量被算成真调用；
 *   - **漏判（更危险）**：`const re = /\/\//g; emit('ghost:event')` 与
 *     `` `${b}//x`; emit('ghost:event') `` —— 正则/模板串里的两个斜杠把**同一行后面的真代码涂白**，
 *     于是一个真的"emit 了却没登记"会被静默放过。
 * （这一版注释本身还踩过一次同类坑：正文里直接写出那段正则，其中的"星号斜杠"提前结束了块注释，
 *   整个测试文件直接无法解析。写注释时也要按"这就是解析器输入"来对待。）
 * 取舍与仓库既有口径一致（§1.88）：误判的伤害必须被锁死，宁可保守也不能让"从这里往后整份文件失守"。
 * 所以改成逐字符扫描 + 三态（普通 / 引号内 / 正则内）：
 *   - 引号里的 `//` 天然不是注释（`https://…` 因此安全，无需再靠排除 `:`）；
 *   - 正则只在"该位置能起一个正则"时才识别，且**明确排除 `<` 与 `>`**
 *     —— 把 `<` 当正则起点会把模板里的 `</div>` 当成正则开始，吞掉成片真实模板代码；
 *   - 引号找不到配对就按普通字符处理。
 */
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', 'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case'])

/** 该位置能否起一个正则字面量（看前面最近的一个"有意义"的东西）。 */
function canStartRegex(source, index) {
  let i = index - 1
  while (i >= 0 && /\s/.test(source[i])) i -= 1
  if (i < 0) return true
  const ch = source[i]
  if (REGEX_PRECEDERS.has(ch)) return true
  if (/[\w$]/.test(ch)) {
    const end = i + 1
    let start = i
    while (start >= 0 && /[\w$]/.test(source[start])) start -= 1
    return REGEX_PRECEDERS.has(source.slice(start + 1, end))
  }
  return false
}

export function stripComments(source) {
  let out = ''
  let i = 0
  let quote = null
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue }
      if (ch === quote) { quote = null; out += ch; i += 1; continue }
      // 单/双引号在 JS 里不能跨行；找不到配对就当普通字符，别让状态机卡死。
      if (ch === '\n' && quote !== '`') { quote = null; out += ch; i += 1; continue }
      out += ch; i += 1; continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue }
    // HTML 注释（.vue 模板里合法，且里面常出现示例代码）
    if (ch === '<' && source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const stop = end === -1 ? source.length : end + 3
      while (i < stop) { out += source[i] === '\n' ? '\n' : ' '; i += 1 }
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i += 1 }
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i += 1
      }
      if (i < source.length) { out += '  '; i += 2 }
      continue
    }
    if (ch === '/' && canStartRegex(source, i)) {
      out += ch; i += 1
      let inClass = false
      while (i < source.length && source[i] !== '\n') {
        const c = source[i]
        if (c === '\\') { out += c + (source[i + 1] ?? ''); i += 2; continue }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) { out += c; i += 1; break }
        out += c; i += 1
      }
      continue
    }
    out += ch; i += 1
  }
  return out
}

function collectQuoted(list) {
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** 该文件里登记过的事件名（defineEmits 数组 + options 的 emits 数组）。 */
export function declaredEvents(source) {
  const code = stripComments(source)
  const declared = new Set()
  for (const m of code.matchAll(/defineEmits\(\s*\[([\s\S]*?)\]/g)) {
    for (const name of collectQuoted(m[1])) declared.add(name)
  }
  for (const m of code.matchAll(/\bemits\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const name of collectQuoted(m[1])) declared.add(name)
  }
  return declared
}

/** 该文件里实际 emit 出去的事件名（只认字符串字面量）。 */
export function usedEvents(source) {
  const code = stripComments(source)
  const used = new Set()
  for (const m of code.matchAll(/\$emit\(\s*'([^']+)'/g)) used.add(m[1])
  for (const m of code.matchAll(/(?<![\w.$])emit\(\s*'([^']+)'/g)) used.add(m[1])
  return used
}

describe('组件事件契约：emit 出去的名字必须登记过', () => {
  const files = walkVueFiles(SRC)

  it('扫描面足够大（防止判据因为找不到文件而假绿）', () => {
    // 旧设备码与空间同步界面移除后，当前实际扫描 79 个组件/视图；保留余量，
    // 但不把已下线功能的文件数继续当作覆盖率要求。
    expect(files.length).toBeGreaterThan(75)
  })

  it('每个组件 emit 的事件都在同文件登记过', () => {
    const violations = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const used = usedEvents(source)
      if (!used.size) continue
      const declared = declaredEvents(source)
      const missing = [...used].filter((name) => !declared.has(name))
      if (missing.length) violations.push(`${relative(SRC, file)} → ${missing.join(', ')}`)
    }
    expect(violations, `以下组件 emit 了未登记的事件：\n${violations.join('\n')}`).toEqual([])
  })

  it('判据自身有判别力：漏登记的名字会被抓出来（变异夹具）', () => {
    const mutated = `
      <script setup>
      const emit = defineEmits(['close'])
      </script>
      <template><button @click="$emit('update:showQuickRecord', false)">x</button></template>
    `
    expect([...usedEvents(mutated)]).toEqual(['update:showQuickRecord'])
    expect(declaredEvents(mutated).has('update:showQuickRecord')).toBe(false)
  })

  it('注释里的 emit 不算数（假的调用不能把判据带红）', () => {
    const commented = `
      <script setup>
      // \$emit('ghost:event', 1)
      /* emit('ghost:event') */
      <!-- $emit('ghost:event') -->
      const a = 1// emit('ghost:event')
      const emit = defineEmits(['close'])
      </script>
    `
    expect([...usedEvents(commented)]).toEqual([])
  })

  it('正则字面量/模板串里的 // 不能把同一行后面的真代码涂白（漏判比假红更危险）', () => {
    // 这两个是**对抗性复核给出的可复现反例**：上一版正则剥注释会让它们漏报。
    const withRegex = `const re = /\\/\\//g; emit('ghost:event')`
    expect([...usedEvents(withRegex)]).toEqual(['ghost:event'])

    const withTemplate = 'const t = `${b}//x`; emit(\'ghost:event\')'
    expect([...usedEvents(withTemplate)]).toEqual(['ghost:event'])

    // 字符串里的 `//`（`https://` 这类）同样不能吃掉后面的代码
    const withUrl = `const u = 'https://x//y'; emit('ghost:event')`
    expect([...usedEvents(withUrl)]).toEqual(['ghost:event'])
  })

  it('把 `<` 当正则起点会吞掉模板代码：这条边界必须守住', () => {
    // §1.88 的教训：真按"斜杠前是 `<` 就起正则"实现，模板里的 </div> 会被当成正则开始，
    // 成片的真实模板代码被涂白（假阴性）。
    const template = `<div class="a"></div>\n<span @click="$emit('close')">x</span>`
    expect([...usedEvents(template)]).toEqual(['close'])
  })
})
