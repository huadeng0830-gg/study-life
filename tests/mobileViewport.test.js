// @vitest-environment happy-dom
/**
 * 移动端视口与输入的守卫（第四十六轮）。
 *
 * 【一】尺寸类的 `Nvh` 必须有 `Ndvh` 孪生。
 * 移动浏览器地址栏收放时，`100vh` 会**大于**真正的可见高度（它按"地址栏收起"算），
 * 于是 `max-height: 85vh` 的弹窗会比可见区还高，底部按钮落到浏览器栏下面。
 * `dvh` 跟着动态视口走。写法用**级联回退**：先 `vh`（老浏览器看得懂），
 * 紧跟一行 `dvh`（新浏览器覆盖）。这样不需要 `@supports`，老浏览器也不会拿到无效值。
 *
 * 【只守尺寸，不守别的】`transform: translate3d(0, 108vh, 0)` 里的 `vh` 只是个长度
 * （彩带从屏幕外飞进来），地址栏收放不影响它该有多长，所以判据只看
 * `height / min-height / max-height`。
 *
 * 【二】触屏设备上表单控件的字号不小于 16px。
 * 这条**早就修好了**（`style.css` 里 `@media (pointer: coarse)` + `font-size: 16px
 * !important`），但一直没人守——它恰好是最容易被"清理"掉的那种规则：
 * 看着像硬编码、又带 `!important`，不知情的人很容易删掉或改成设计令牌。
 * 于是这里把它锁住，并连**为什么必须是 `pointer: coarse` 而不是 `any-pointer`**
 * 一起写进判据：带触摸屏的笔记本主指针仍是 `fine`，用 `any-pointer` 会把
 * 桌面的紧凑排版（11–14px）一起改掉。
 *
 * 【本仓血泪规矩】凡是要 parse 的东西，先剥注释。这段文件自己的注释里就写着
 * `max-height: 85vh` 和 `font-size: 16px`，不剥注释就会扫出幽灵声明。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 去掉 CSS 注释（连 HTML 注释一起，避免 `<style>` 被注释吞掉的同类事故）。 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** 尺寸类 `vh` 声明：`height / min-height / max-height`，值里含 Nvh。 */
const SIZE_VH = /((?:min-|max-)?height)\s*:\s*([^;{}]*?\d(?:\.\d+)?vh)\s*([;}])/g

/**
 * 找出缺 `dvh` 孪生的尺寸类 `vh` 声明。
 * 孪生判定：紧跟其后（允许分号与空白、含换行）出现**同一属性**且值含 `dvh`。
 */
export function missingDvhTwins(rawText) {
  const text = stripComments(rawText)
  const missing = []
  SIZE_VH.lastIndex = 0
  let match
  while ((match = SIZE_VH.exec(text)) !== null) {
    const [, property, value] = match
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 200)
    const twin = new RegExp(`^[\\s;]*${property}\\s*:[^;{}]*dvh`).test(after)
    if (!twin) missing.push({ property, value: value.trim(), line: text.slice(0, match.index).split('\n').length })
  }
  return missing
}

/** 统计尺寸类 `dvh` 声明数量（棘轮用：实现与判据脱节时下限会红）。 */
export function countDvhDeclarations(rawText) {
  return (stripComments(rawText).match(/(?:min-|max-)?height\s*:\s*[^;{}]*dvh/g) ?? []).length
}

/**
 * 找出所有 `@media (pointer: coarse)` 块（大括号配平）。
 * 不能用 `\{([\s\S]*?)\}`——它会抓到**第一个**块，而第一个 coarse 块往往是
 * 触控目标那一块，不是要查的那一块（第四十三轮踩过这个坑）。
 */
export function coarseBlocks(css) {
  const blocks = []
  const marker = /@media\s*\(([^)]*pointer\s*:\s*coarse[^)]*)\)\s*\{/g
  let match
  while ((match = marker.exec(css)) !== null) {
    const open = match.index + match[0].length - 1
    let depth = 1
    let i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    blocks.push({ condition: match[1].trim(), body: css.slice(open + 1, i - 1) })
  }
  return blocks
}

/** 触屏块里是否有一条把表单控件字号抬到 ≥16px 的规则。 */
export function hasCoarseControlFontRule(css, min = 16) {
  for (const block of coarseBlocks(css)) {
    for (const rule of block.body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].replace(/\s+/g, ' ').trim()
      const size = /font-size\s*:\s*([\d.]+)px/.exec(rule[2])
      if (!size || Number(size[1]) < min) continue
      // 选择器要覆盖 input / select / textarea 三类控件
      if (!/(^|[\s,>+~(])input(?![\w-])/.test(selector)) continue
      if (!/(^|[\s,>+~(])select(?![\w-])/.test(selector)) continue
      if (!/(^|[\s,>+~(])textarea(?![\w-])/.test(selector)) continue
      return { selector, size: Number(size[1]), important: /!important/.test(rule[2]) }
    }
  }
  return null
}

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|css)$/.test(full)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

/* ---------- 夹具：判据的判别力 ---------- */

describe('missingDvhTwins 的判别力', () => {
  it('有孪生 → 放行；没孪生 → 报出来', () => {
    expect(missingDvhTwins('.a { max-height: 85vh; max-height: 85dvh; }')).toEqual([])
    expect(missingDvhTwins('.a {\n  max-height: 85vh;\n  max-height: 85dvh;\n}')).toEqual([])
    expect(missingDvhTwins('.a { max-height: 85vh; }')).toHaveLength(1)
  })

  it('属性不同不算孪生（height 的 dvh 救不了 max-height）', () => {
    expect(missingDvhTwins('.a { max-height: 85vh; height: 85dvh; }')).toHaveLength(1)
  })

  it('transform / animation 里的 vh 不算尺寸，不该被要求孪生', () => {
    expect(missingDvhTwins('.a { transform: translate3d(0, 108vh, 0) }')).toEqual([])
    expect(missingDvhTwins('.a { top: -8vh }')).toEqual([])
  })

  it('普通数值没有 vh 就不管', () => {
    expect(missingDvhTwins('.a { max-height: 480px }')).toEqual([])
    expect(missingDvhTwins('.a { height: 100% }')).toEqual([])
  })

  it('注释里的 vh 造不出幽灵声明（本仓规矩：先剥注释）', () => {
    expect(missingDvhTwins('/* 以前是 max-height: 85vh; */\n.a { max-height: 60vh; max-height: 60dvh; }')).toEqual([])
  })

  it('以 } 结尾（无分号）的声明同样要孪生', () => {
    expect(missingDvhTwins('.a{min-height:150px;max-height:40vh}')).toHaveLength(1)
    expect(missingDvhTwins('.a{max-height:40vh;max-height:40dvh}')).toEqual([])
  })
})

describe('coarseBlocks / hasCoarseControlFontRule 的判别力', () => {
  it('取的是触屏块，不是第一个块', () => {
    const css = '@media (pointer: coarse) { button { min-height: 44px } }\n@media (pointer: coarse) { input, select, textarea { font-size: 16px !important } }'
    expect(coarseBlocks(css)).toHaveLength(2)
    expect(hasCoarseControlFontRule(css)).toBeTruthy()
  })

  it('first-of-two 陷阱：字号规则在第二个块里也要能找到', () => {
    // 第四十三轮的坑：非贪婪块正则会永远只看第一个 coarse 块，于是永远报"找不到"
    const css = '@media (pointer: coarse) { .btn { min-height: 44px } }\n@media (pointer: coarse) { input, select, textarea { font-size: 16px !important } }'
    expect(hasCoarseControlFontRule(css)?.important).toBe(true)
  })

  it('字号仍小于 16px → 不认', () => {
    expect(hasCoarseControlFontRule('@media (pointer: coarse) { input, select, textarea { font-size: 14px } }')).toBeNull()
  })

  it('少了 textarea 一类控件 → 不认', () => {
    expect(hasCoarseControlFontRule('@media (pointer: coarse) { input, select { font-size: 16px !important } }')).toBeNull()
  })

  it('块外写了字号 → 不认（必须在触屏块里）', () => {
    expect(hasCoarseControlFontRule('input, select, textarea { font-size: 16px !important }')).toBeNull()
  })
})

/* ---------- 全仓 ---------- */

describe('尺寸类 vh 必须有 dvh 孪生', () => {
  it('全仓零缺漏', () => {
    const missing = []
    for (const file of walk()) {
      for (const entry of missingDvhTwins(readFileSync(file, 'utf8'))) {
        missing.push(`${relOf(file)}:${entry.line}  ${entry.property}: ${entry.value}`)
      }
    }
    expect(
      missing,
      '这些尺寸用了 vh 而没有 dvh 孪生：手机上地址栏可见时它们会比真正可见区更高/更矮，底部内容会被推出屏幕',
    ).toEqual([])
  })

  it('规模自证：dvh 声明数不能太少（判据和实现脱节时这里会红）', () => {
    const total = walk().reduce((sum, file) => sum + countDvhDeclarations(readFileSync(file, 'utf8')), 0)
    expect(total, 'dvh 声明数低于实测值，可能是扫描器读空了').toBeGreaterThanOrEqual(16)
  })
})

describe('触屏设备上表单控件字号不小于 16px', () => {
  const styleCss = readFileSync(join(srcDir, 'style.css'), 'utf8')

  it('规则必须在，且抬到 ≥16px 并带 !important', () => {
    const rule = hasCoarseControlFontRule(styleCss)
    expect(rule, '找不到"触屏设备上把表单控件字号抬到 16px"的规则——iOS Safari 会在聚焦时自动放大整个页面').toBeTruthy()
    expect(rule.size).toBeGreaterThanOrEqual(16)
    // !important 不是随手加的：本仓大量控件的字号写在组件 <style scoped> 里，
    // 编译后选择器会多一个 [data-v-xxxxxxx] 属性，全局规则按特异性永远赢不了。
    expect(rule.important, '去掉 !important 后，组件 scoped 规则会重新压过它，修复失效').toBe(true)
  })

  it('必须用 pointer: coarse，不能用 any-pointer', () => {
    const blocks = coarseBlocks(styleCss)
    expect(blocks.length, '触屏块不见了').toBeGreaterThan(0)
    expect(blocks.some((block) => /^pointer\s*:\s*coarse$/.test(block.condition)), '必须用 pointer: coarse').toBe(true)
    // 反向：带触摸屏的笔记本主指针仍是 fine，用 any-pointer 会把桌面的紧凑排版一起改掉
    expect(
      blocks.map((block) => block.condition).filter((condition) => /any-pointer/.test(condition)),
      'any-pointer: coarse 会在带触摸屏的笔记本上也生效，改变桌面排版',
    ).toEqual([])
  })

  it('范围限定在表单控件，不要连带按钮一起改', () => {
    const rule = hasCoarseControlFontRule(styleCss)
    expect(rule.selector, '不该把 button 也拖进这条字号规则').not.toMatch(/(^|[\s,>+~(])button(?![\w-])/)
  })
})