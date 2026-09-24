// 扫描 .vue 源码时反复要用的几件事。
//
// 抽成共享模块是因为「表单控件必须有可访问名称」与「可点击元素必须能被键盘触发」
// 两条守卫都要做同样三件事：遍历 src、剥掉注释与 <style> 取出模板、按引号感知切开标签。
//
// 引号感知不是洁癖，是必需：这个仓库里 `:disabled="a >= b"`、`@click="x > y"` 这类
// 属性值里就带 `>`，用 /<(\w+)([^>]*)>/ 会在那里提前截断，然后被截断的左半段看起来
// 「没有 aria-label」，于是守卫开始报假警——而假警的守卫最后一定会被人关掉。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/** 递归收集目录下所有 .vue 文件的绝对路径。 */
export function walkVueFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walkVueFiles(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 读一个开标签的结束位置（引号感知，不会在属性值里的 `>` 处停下）。 */
export function tagEnd(text, from) {
  let index = from
  let quote = ''
  while (index < text.length) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
    index += 1
  }
  return text.length
}

/**
 * 取出根 <template> 块，并剥掉 HTML 注释与 <style>。
 *
 * 剥注释还有个副作用是必须的：守卫的说明性注释里常常会举 `@click` / `aria-label`
 * 这类例子，不剥就会被当成真代码扫进去。
 * 这些 SFC 多数把 <script setup> 放在最前面，所以不能反过来取最后一段。
 *
 * 【剥掉的部分用等量换行补齐】不补的话，模板里的行号是「剥完之后的相对行号」，
 * 而报错信息是给人看的：`.tab-bar` 在文件第 1032 行、却被报成 `@5`，等于没给位置。
 * 补齐后模板内行号**等于文件行号**（`walkElements` 的 `line` 直接可用）。
 */
export function templateOf(source) {
  const keepLines = (match) => '\n'.repeat((match.match(/\n/g) || []).length)
  const whole = source
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/<style[\s\S]*?<\/style>/g, keepLines)
  const match = whole.match(/<template>([\s\S]*)<\/template>/)
  if (!match) return ''
  // 模板开始之前的换行数 + 1，使模板第一行的行号正好等于它在文件里的行号。
  const linesBefore = whole.slice(0, match.index + '<template>'.length).split('\n').length - 1
  return `${'\n'.repeat(linesBefore)}${match[1]}`
}

/**
 * 依次产出模板里的每个**开**标签：{ tag, attrs, raw, index }。
 *
 * 闭合标签（`</div>`）、注释残留、doctype 都会被跳过；`<input />` 这类自闭合标签
 * 的 attrs 会保留末尾的 `/`，对属性取值没有影响。
 */
export function* openTags(template) {
  let cursor = 0
  while (cursor < template.length) {
    const lt = template.indexOf('<', cursor)
    if (lt === -1) return
    if (!/[A-Za-z]/.test(template[lt + 1] || '')) {
      cursor = lt + 1
      continue
    }
    const end = tagEnd(template, lt)
    const raw = template.slice(lt + 1, end)
    const name = raw.match(/^([A-Za-z][\w:-]*)/)
    if (name) {
      yield { tag: name[1].toLowerCase(), attrs: raw.slice(name[1].length), raw, index: lt }
    }
    cursor = end + 1
  }
}

/** 一个 SFC 的模板里是否含有该文件之外的引用（用于守卫里的「确实扫到了东西」自证）。 */
export function readTemplate(file) {
  return templateOf(readFileSync(file, 'utf8'))
}

/**
 * 开标签的**原样**名字。
 * `openTags` 会把标签名小写（`<Sidebar` → `sidebar`），但 `raw` 保留原大小写，
 * 所以判定组件必须从 `raw` 取名字——只看 `tag` 永远分不出 `<Sidebar>` 和 `<div>`。
 */
export const componentNameOf = ({ raw, tag }) => raw.match(/^([A-Za-z][\w:-]*)/)?.[1] ?? tag

/** 首字母大写即视为组件（本仓库的 SFC 命名约定）。 */
export const isComponentTag = (openTag) => /^[A-Z]/.test(componentNameOf(openTag))

/**
 * 组件名 → 它的模板（读真实文件，带缓存）。fixture 可以注入自己的解析器。
 *
 * 递归解析组件源码在几处守卫里都是必需的：源码扫描看不见子组件渲染出来的东西。
 * 例子：`<TaskProgress />` 在父模板里只是一个自闭合标签，但它的模板里有 `role="alert"`——
 * 只看父模板的话，「实时区域落在 display:none 子树里」这类缺陷会被完全漏掉。
 */
export function makeComponentResolver(srcDir) {
  const cache = new Map()
  return (name) => {
    if (cache.has(name)) return cache.get(name)
    let template = null
    for (const sub of ['components', 'views', '']) {
      try {
        template = readTemplate(resolve(srcDir, sub, `${name}.vue`))
        break
      } catch { /* 不在这个目录，继续找 */ }
    }
    cache.set(name, template)
    return template
  }
}

/** HTML 空元素：它们没有闭合标签，不能压栈。 */
export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
])

/**
 * 带**嵌套栈**遍历模板，逐个产出开标签：
 * `{ tag, attrs, raw, line, ancestors, selfClosing }`。
 *
 * `openTags` 只给开标签，看不出谁包着谁；而「这个元素被谁藏起来了」「这个控件在不在
 * 那个折叠区里」这类判断必须先知道祖先链。上两轮的临时普查脚本各自手搓了一遍这个栈，
 * 现在收在这里共用。
 *
 * `ancestors` 是**开标签对象数组**（由外到内），所以调用方可以直接问
 * 「有没有哪个祖先带 aria-hidden / v-show」。注意标签名仍然是小写的，
 * 要判组件请用 `componentNameOf`。
 */
export function* walkElements(template) {
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  const stack = []
  let m
  while ((m = tagRe.exec(template)) !== null) {
    const [raw, slash, tag, attrs] = m
    if (slash) {
      // 逐层回退到同名开标签；模板里有未闭合标签时也不会把栈搞乱
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) { stack.length = i; break }
      }
      continue
    }
    const line = template.slice(0, m.index).split('\n').length
    const selfClosing = raw.endsWith('/>') || VOID_TAGS.has(tag)
    // 【必须 yield 和 push **同一个对象**】先前的写法是 yield 一个字面量、再 push 另一个
    // 字面量，于是 `el.ancestors.includes(某个已产出的元素)` **恒为假**——祖先对象和被产出的
    // 对象只是长得一样，不是同一个引用。后果是「后代」判定全部落空：一条判据会报告
    // 「全仓 0 处」，而那 0 是真空出来的。夹具当时把它抓了出来（主仓断言全绿、夹具却红），
    // 这正是夹具存在的意义。写法上先建 node、yield 它、再把它压栈。
    const node = { tag, attrs, raw, line, selfClosing, ancestors: [...stack] }
    yield node
    if (!selfClosing) stack.push(node)
  }
}