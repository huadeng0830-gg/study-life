// @vitest-environment node
/**
 * 表格语义。
 *
 * 一、每个 `<th>` 都要有 `scope`。
 *   `<th>` 不带 scope 时，浏览器/读屏要靠「它在第几行第几列」去猜它是列表头还是行表头。
 *   简单表格猜得对，但一旦表格里有跨行/跨列或错位（本仓库的导入预览表就有 8 列 + 额外的
 *   错误行），猜错的代价就是读屏把数据念成另一列的意思。显式声明是 WCAG H63 的做法。
 *
 * 二、空的 `<th>` 必须另有名字。
 *   `CourseManagerModal` 的首列表头是「选择」列（下面每行一个复选框），视觉上就该留空。
 *   但一个空 `<th>` 会让读屏把整列念成无名的表头——内容为空可以，名称不能为空，
 *   所以要求它带 aria-label / aria-labelledby。
 *
 * 三、有数据行的表格不能没有表头。
 *   纯 `<td>` 的表格对读屏就是一堆坐标，没有任何「这一列是什么」的信息。
 *
 * 【已知边界】只看静态 `<th>`；用组件渲染出来的表格看不到。全仓 3 个 `<table>` 都是
 * 手写标签，已核实。行表头的判断（哪一列更适合做 th scope="row"）无法自动化——
 * 那是语义判断，本判据只保证「已经是 th 的都有 scope」，不负责找出「本该是 th 的 td」。
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openTags, readTemplate, tagEnd, walkVueFiles } from './helpers/vueTemplate.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

const VALID_SCOPE = /(?:^|\s)scope="(?:col|row|colgroup|rowgroup)"/
const HAS_NAME = /(?:^|\s):?aria-(?:label|labelledby)=/

/** 所有缺 scope 的 `<th>`。 */
export function findUnscopedTh(template) {
  return [...openTags(template)].filter(({ tag, attrs }) => tag === 'th' && !VALID_SCOPE.test(attrs))
}

/** 取一个开标签到它闭合标签之间的纯文本。 */
export function innerTextOf(template, openTag) {
  const end = tagEnd(template, openTag.index)
  const close = template.indexOf('</th>', end)
  if (close === -1) return ''
  return template.slice(end + 1, close).replace(/<[^>]*>/g, '').trim()
}

/** 内容为空、又没有 aria-label/labelledby 的 `<th>`。 */
export function findNamelessTh(template) {
  return [...openTags(template)].filter((t) => (
    t.tag === 'th'
    && !HAS_NAME.test(t.attrs)
    && innerTextOf(template, t) === ''
  ))
}

const countTag = (template, tag) => (template.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length

/** 有数据行、却一个 `<th>` 都没有的表格（按 `<table>` 段落粗切）。 */
export function findHeaderlessTables(template) {
  const out = []
  for (const t of openTags(template)) {
    if (t.tag !== 'table') continue
    const end = template.indexOf('</table>', tagEnd(template, t.index))
    const body = end === -1 ? template.slice(t.index) : template.slice(t.index, end)
    if (countTag(body, 'tr') >= 2 && countTag(body, 'th') === 0) out.push(t)
  }
  return out
}

describe('表格语义', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')
  const tables = scanned.filter(({ template }) => countTag(template, 'table') > 0)
  const allTh = scanned.flatMap(({ template }) => [...openTags(template)].filter((t) => t.tag === 'th'))

  it('扫描规模自证：确实找到了表格与表头单元格', () => {
    // 实测 3 个表文件、18 个 <th>（17 col + 1 row）。归零即说明判据已与仓库脱节。
    expect(tables.length, '仓库里再也找不到 <table>').toBeGreaterThanOrEqual(3)
    expect(allTh.length, '仓库里再也找不到 <th>').toBeGreaterThan(10)
    expect(scanned.length).toBeGreaterThan(45)
  })

  it('每个 <th> 都显式声明了 scope', () => {
    const offenders = scanned.flatMap(({ file, template }) => findUnscopedTh(template)
      .map(({ attrs }) => `${rel(file)} <th>${attrs.replace(/\s+/g, ' ').slice(0, 40)}`))
    expect(offenders).toEqual([])
  })

  it('空 <th> 必须另有可访问名称', () => {
    const offenders = scanned.flatMap(({ file, template }) => findNamelessTh(template)
      .map(() => `${rel(file)} 有一个空 <th> 且没有 aria-label`))
    expect(offenders).toEqual([])
  })

  it('有数据行的表格不能没有表头', () => {
    const offenders = scanned.flatMap(({ file, template }) => findHeaderlessTables(template)
      .map(() => `${rel(file)} 有多个 <tr> 却没有任何 <th>`))
    expect(offenders).toEqual([])
  })

  it('核实：行表头确实存在（否则「scope="row"」这条等于没被用上）', () => {
    // 农历对照表的年份列是行表头。这条防的是「判据只认 col、row 写法悄悄失效」。
    const festive = readTemplate(resolve(srcDir, 'components', 'FestiveSettings.vue'))
    expect(festive).toMatch(/<th class="year" scope="row">/)
  })

  // ---- 夹具 ----
  it('夹具：缺 scope、空表头、无表头三种情况都要抓出来', () => {
    expect(findUnscopedTh('<table><thead><tr><th>课程</th></tr></thead></table>')).toHaveLength(1)
    expect(findUnscopedTh('<th scope="col">课程</th>')).toEqual([])
    expect(findUnscopedTh('<th scope="row">2026</th>')).toEqual([])

    expect(findNamelessTh('<th scope="col"></th>')).toHaveLength(1)
    expect(findNamelessTh('<th scope="col" aria-label="选择"></th>')).toEqual([])
    expect(findNamelessTh('<th scope="col" :aria-labelledby="id"></th>')).toEqual([])
    // v-for 渲染出来的表头有内容，不该被当成空
    expect(findNamelessTh('<th v-for="x in xs" scope="col">{{ x.name }}</th>')).toEqual([])

    expect(findHeaderlessTables('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>')).toHaveLength(1)
    expect(findHeaderlessTables('<table><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>')).toEqual([])
    // 只有一行、又没有表头 → 不报（一行两列的键值表是常见写法，不值得为它报警）
    expect(findHeaderlessTables('<table><tr><td>a</td><td>b</td></tr></table>')).toEqual([])
  })

  it('夹具：`</th>` 缺失时不得把后面的内容误当成表头文字', () => {
    // innerTextOf 找不到闭合标签就返回空 → 会走「空表头」分支报出来，
    // 这是刻意的：标签没闭合本身就是问题，宁可报出来也不要静默放过。
    expect(findNamelessTh('<th scope="col">没闭合')).toHaveLength(1)
  })
})