// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 注释里出现「button」这个词（例如解释某个元素为什么不该是按钮）会让标签扫描器
// 把注释当成真实标签，从而误判「找不到按钮」或「找到两个」。所以先剥掉 HTML 注释：
// 注释不是 DOM，任何基于源码的结构性断言都必须先做这一步。
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

// 用 `/<button[^>]*>/` 扫源码会在属性值里的 `>` 处提前结束（本仓库就有
// :disabled="viewWeek <= 0"、:disabled="viewWeek >= MAX_WEEK" 这种写法），
// 于是标签被截断、反方向的按钮整个漏掉。这里按引号状态机找标签真正的结束位置。
function buttonTags(rawHtml) {
  const html = stripComments(rawHtml)
  const tags = []
  let index = 0
  for (;;) {
    const open = html.indexOf('<button', index)
    if (open === -1) break
    let cursor = open + '<button'.length
    let quote = ''
    while (cursor < html.length) {
      const char = html[cursor]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
      cursor += 1
    }
    const openEnd = cursor + 1
    const close = html.indexOf('</button>', openEnd)
    const innerEnd = close === -1 ? openEnd : close
    tags.push({ open: html.slice(open, openEnd), inner: html.slice(openEnd, innerEnd) })
    index = innerEnd
  }
  return tags
}

// 名称里有汉字才说明这是给人读的标签；只写 "×"、">" 之类等于没写。
const CHINESE_NAME = /aria-label="[^"]*[\u3400-\u9fff][^"]*"/
const HAS_NAME = /(?:^|\s)(?::)?aria-label=|(?:^|\s)(?::)?title=/

// 触屏上的命中区靠 src/style.css 的 @media (pointer: coarse) 放大，
// 前提是按钮自己带上 tap-target 这个钩子。
const TAP_TARGET = /class="[^"]*\btap-target\b[^"]*"/

const symbolOnlyButtons = [
  {
    file: 'src/components/FocusPanel.vue',
    call: 'openCustomTime',
    why: '自定义专注时长（内容只有全角＋）',
  },
  { file: 'src/views/LedgerView.vue', call: 'shiftMonth(-1)', why: '上一个月（内容只有‹）' },
  { file: 'src/views/LedgerView.vue', call: 'shiftMonth(1)', why: '下一个月（内容只有›）' },
  { file: 'src/views/ScheduleView.vue', call: 'goWeek(-1)', why: '上一周（内容只有‹）' },
  { file: 'src/views/ScheduleView.vue', call: 'goWeek(1)', why: '下一周（内容只有›）' },
]

describe('只有符号的按钮必须自带可访问名称', () => {
  for (const { file, call, why } of symbolOnlyButtons) {
    it(`${file} 的 ${why} 带中文 aria-label 和触控目标`, () => {
      const html = source(file)
      const matched = buttonTags(html).filter(({ open }) => open.includes(call))
      expect(matched.length, `${file} 里应当恰好有一个按钮调用 ${call}`).toBe(1)
      expect(matched[0].open).toMatch(CHINESE_NAME)
      expect(matched[0].open).toMatch(TAP_TARGET)
    })
  }

  // 上面五个是点名清单；这条兜底防止这 3 个文件里再出现同类漏网之鱼：
  // 内容既没有汉字、也没有字母数字（纯符号/emoji），又没有 aria-label/title 的按钮。
  // 含 {{ }} 的按钮不在此列——文字来自运行时数据，源码级无法判定它是不是符号。
  for (const file of [
    'src/components/FocusPanel.vue',
    'src/views/LedgerView.vue',
    'src/views/ScheduleView.vue',
  ]) {
    it(`${file} 不再有「只有符号且没有名称」的按钮`, () => {
      const html = source(file)
      const offenders = buttonTags(html)
        .filter(({ inner }) => !inner.includes('{{'))
        .filter(({ inner }) => !/[\u3400-\u9fffA-Za-z0-9]/.test(inner))
        .filter(({ open }) => !HAS_NAME.test(open))
        .map(({ open }) => open.replace(/\s+/g, ' '))
      expect(offenders).toEqual([])
    })
  }
})

// 「只有符号」修完之后剩下的同类问题：内容是数字，可访问名称就是裸数字，
// 读屏不知道单位也不知道上下文。这组断言锁住「数字必须带单位/日期」。
describe('只念得出数字的控件要补上单位或日期', () => {
  it('专注时长快捷芯片带上「分钟」', () => {
    const html = stripComments(source('src/components/FocusPanel.vue'))
    expect(html).toMatch(/:aria-label="`\$\{mins\} 分钟`"/)
    // aria-label 加在普通 div 上会被忽略，必须有角色才生效。
    expect(html).toMatch(/class="time-chips"\s+role="group"\s+aria-label="专注时间"/)
  })

  it('月历格子带上月份、日期与账目摘要，并暴露选中态', () => {
    const html = stripComments(source('src/views/LedgerView.vue'))
    expect(html).toMatch(/:aria-label="cellLabel\(cell\)"/)
    expect(html).toMatch(/:aria-pressed="selectedDay === cell\.day"/)
    // 标签本身要说清「几月几日」，否则和裸数字没区别。
    expect(html).toMatch(/月\$\{cell\.day\}日/)
  })

  it('周次标签不是按钮（没有动作的元素不该占 Tab 停靠点）', () => {
    const html = stripComments(source('src/views/ScheduleView.vue'))
    expect(html).toMatch(/<span class="wn"/)
    expect(html).not.toMatch(/<button[^>]*class="wn"/)
  })
})