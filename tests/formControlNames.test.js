// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tagEnd, templateOf, walkVueFiles } from './helpers/vueTemplate.js'

/**
 * 表单控件必须有可访问名称。
 *
 * 这个项目里大量出现这种写法：
 *
 *   <div>
 *     <label>目标日期 *</label>
 *     <input v-model="form.date" type="date" />
 *   </div>
 *
 * `<label>` 既没有 `for`、也没包住控件，于是**标签和控件没有任何程序化关联**。
 * 两个后果都是真实可感知的：读屏用户聚焦控件时只听到「编辑框」，不知道这是
 * 「目标日期」还是「具体时间」（`<select>` 最严重，选项读出来也没有上下文）；
 * 手机上点「目标日期」这四个字不会聚焦控件，必须精准点到输入框本身。
 *
 * 判定「有名称」的条件（任一）：
 *   - 自身有 aria-label / :aria-label
 *   - 自身的 id 被同文件某个 <label for="..."> 引用
 *   - 位于某个 <label>…</label> 区间内部
 *   - type 是 hidden / submit / button / reset / file / image（不是数据输入）
 * 只有 placeholder 不算名称：它是提示，输入之后即消失，读屏也不保证读它。
 *
 * 两个刻意的设计，都是为了不让这条守卫退化成空断言：
 *   1. 判定逻辑抽成纯函数 `findUnnamedControls`，用夹具逐条验证它对
 *      「有 for / 被 label 包裹 / 有 aria-label / hidden」放行、对
 *      「只有 placeholder / 被故意拆掉 label 包裹」报警。
 *   2. 全仓计数除了断言上限，还断言真的扫到了 200 个以上控件 —— 正则写坏时
 *      结果是 0 个命中，那种「假绿」比漏报更危险。
 *
 * 早期版本的教训：第一版用「控件前面 600 字符内出现过 <label>」来近似包裹关系，
 * 把一个故意去掉 label 包裹的控件也判成了合规（漏报）。现在是真正的区间包含判断。
 */

const root = resolve(import.meta.dirname, '..')
const srcDir = resolve(root, 'src')

// templateOf / tagEnd / walkVueFiles 现在住在 tests/helpers/vueTemplate.js，
// 与「键盘可达性」那条守卫共用同一份解析实现（引号感知切标签的理由见该文件头注释）。

/** 返回 [{ index, tag, attrs, hasPlaceholder }]，只含缺少可访问名称的数据输入控件。 */
export function findUnnamedControls(template) {
  const labelSpans = []
  for (const match of template.matchAll(/<label\b[^>]*>/g)) {
    const end = template.indexOf('</label>', match.index)
    if (end !== -1) labelSpans.push([match.index, end])
  }
  const forIds = new Set([...template.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]))

  const found = []
  const control = /<(input|select|textarea)\b/g
  let match
  while ((match = control.exec(template)) !== null) {
    const tag = match[1]
    const attrs = template.slice(control.lastIndex, tagEnd(template, control.lastIndex))
    const type = (attrs.match(/(?:^|\s):?type="([^"]*)"/) || [])[1] || 'text'
    if (/hidden|submit|button|reset|file|image/.test(type)) continue
    if (/(?:^|\s):?aria-label=/.test(attrs)) continue
    const id = (attrs.match(/(?:^|\s):?id="([^"]*)"/) || [])[1]
    if (id && forIds.has(id)) continue
    if (labelSpans.some(([from, to]) => from <= match.index && match.index <= to)) continue
    found.push({
      index: match.index,
      tag,
      attrs,
      hasPlaceholder: /placeholder=/.test(attrs),
      line: template.slice(0, match.index).split('\n').length,
    })
  }
  return found
}

/* ---------- 夹具：先证明这条守卫真的有判定力 ---------- */

describe('findUnnamedControls 的判定力（先证明它抓得住，再拿它扫全仓）', () => {
  const named = {
    'label 用 for 关联': '<div><label for="d">日期</label><input id="d" type="date" /></div>',
    '控件被 label 包裹': '<label>日期<input type="date" /></label>',
    '自身有 aria-label': '<input type="date" aria-label="日期" />',
    '动态 :aria-label': '<input type="date" :aria-label="label" />',
    'hidden 不算数据输入': '<input type="hidden" v-model="id" />',
    'submit / button 不算数据输入': '<button type="submit">保存</button><input type="submit" value="存" />',
    'select 有 for 关联': '<label for="s">类型</label><select id="s"><option>甲</option></select>',
  }
  for (const [name, html] of Object.entries(named)) {
    it(`放行：${name}`, () => {
      expect(findUnnamedControls(html)).toEqual([])
    })
  }

  const unnamed = {
    '只有 placeholder': '<input v-model="q" placeholder="金额≥" />',
    'label 是裸的（没有 for、也没包住）': '<div><label>目标日期 *</label><input v-model="form.date" type="date" /></div>',
    'select 没有名称': '<select v-model="cat"><option>甲</option></select>',
    'textarea 只有 placeholder': '<textarea v-model="note" placeholder="随手写点什么" />',
    'for 指向了别的 id（悬空关联等于没有）': '<label for="other">日期</label><input id="d" type="date" />',
    'label 区间在控件之后（不算包裹）': '<label>日期</label><div></div><input type="date" />',
  }
  for (const [name, html] of Object.entries(unnamed)) {
    it(`报警：${name}`, () => {
      const found = findUnnamedControls(html)
      expect(found.length, `应当报警但没报：${html}`).toBe(1)
    })
  }

  it('引号里的 > 不会把开标签截断（否则属性判读会串位）', () => {
    const html = '<input :placeholder="a > b ? \'x\' : \'y\'" type="date" />'
    expect(findUnnamedControls(html).length).toBe(1)
  })
})

/* ---------- 全仓扫描 ---------- */

const files = walkVueFiles(srcDir)
const scanned = files.map((file) => ({ file, template: templateOf(readFileSync(file, 'utf8')) }))
const all = scanned.flatMap(({ file, template }) =>
  findUnnamedControls(template).map((row) => ({ file: file.replace(srcDir, ''), row })),
)
const total = scanned.reduce((sum, item) => sum + (item.template.match(/<(input|select|textarea)\b/g) || []).length, 0)

/**
 * 棘轮：只许下降，不许上升。
 *
 * 第七轮从 78 降到 35；最后一轮把剩下这 35 处（7 个文件）全部修完，
 * 现在钉在 0：任何一处新的无名控件都会直接让测试变红，RESIDUAL_FILES 也空了。
 * 之所以不写死一份清单：那会在下一次修复时逼着人维护一张很快就会过期的表，
 * 而「上限」能把「不许新增」这件事钉死。
 */
const BASELINE = 0
const RESIDUAL_FILES = new Set([])

describe('表单控件必须有关联的可见标签或 aria-label', () => {
  it('守卫真的扫到了控件（正则写坏时会是 0，那是假绿）', () => {
    expect(total).toBeGreaterThan(200)
  })

  it(`没有新增「无名控件」：当前命中数不得高于存量上限 ${BASELINE}`, () => {
    const list = all.map(({ file, row }) => `${file}:${row.line}  <${row.tag}${row.hasPlaceholder ? ' …placeholder…' : ''}>`)
    expect(list.length, `无名控件清单：\n${list.join('\n')}`).toBeLessThanOrEqual(BASELINE)
  })

  it('存量只出现在已知的 7 个文件里（不许扩散到新文件）', () => {
    const unexpected = [...new Set(all.map((item) => item.file))].filter((file) => !RESIDUAL_FILES.has(file))
    expect(unexpected, `这些文件出现了新的无名控件：${unexpected.join(', ')}`).toEqual([])
  })
})