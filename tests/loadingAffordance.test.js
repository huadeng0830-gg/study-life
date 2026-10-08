import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * 加载中的按钮必须真的显示加载态。
 *
 * style.css 里 `.btn[aria-busy='true']` 提供 spinner 与"吞掉重复点击"，
 * 但在一轮 UI 审计里发现：整个 src 目录**从来没有**给任何按钮设置过
 * aria-busy —— 这条 CSS 规则自始至终没有生效过，加载中的按钮看起来和
 * 普通禁用按钮完全一样。
 *
 * 这里用源码断言锁住接线：凡是异步提交期间置 :disabled 的按钮，
 * 同一标签上必须有 :aria-busy。断言的是字符串，改模板样式不会误伤。
 */

const root = new URL('../src/', import.meta.url)

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), 'utf8')
}

// 提交期间会 disabled 的按钮所在的文件，以及各自期望的绑定数量。
const BUTTONS = [
  ['components/QuickRecordPanel.vue', 2],
  ['components/AppearanceSettings.vue', 2],
  ['components/schedule/ImportConflictModal.vue', 2],
]

describe('按钮加载态接线', () => {
  it('style.css 仍然提供 aria-busy 的视觉与交互反馈', () => {
    const css = source('style.css')
    expect(css).toContain(".btn[aria-busy='true']")
    expect(css).toContain('pointer-events: none')
  })

  for (const [path, expected] of BUTTONS) {
    it(`${path} 的异步按钮带上了 aria-busy`, () => {
      const text = source(path)
      const bound = text.match(/:aria-busy="/g) || []
      expect(bound).toHaveLength(expected)
      // 每个 aria-busy 都必须和 :disabled 绑在同一个状态上，
      // 否则会出现"按钮转圈但还能再点一次"。disabled 可以额外带上别的条件
      // （比如 `busy || cameraStarting`），这里只要求它提到 aria-busy 的那个状态。
      expect(text).toMatch(/:disabled="[^"]*(\w+)[^"]*"\s+:aria-busy="\1 \|\| undefined"/)
      expect(text).not.toMatch(/:aria-busy="undefined"/)
    })
  }

  it('aria-busy 只在忙碌时出现，避免静态 aria-busy="false" 被读屏忽略', () => {
    for (const [path] of BUTTONS) {
      const text = source(path)
      // `busy || undefined` 在空闲时会让 Vue 移除该属性；
      // 直接绑 `:aria-busy="busy"` 会渲染成 aria-busy="false"（合法但无意义）。
      const direct = text.match(/:aria-busy="(?!\w+ \|\| undefined)[^"]*"/g) || []
      expect(direct).toEqual([])
    }
  })

  it('不再引用并不存在的 buttonGuard 模块', () => {
    expect(source('style.css')).not.toContain('buttonGuard')
  })
})
