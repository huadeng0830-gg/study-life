// @vitest-environment node
/**
 * iOS Safari 缺失的 Web API 守卫。
 *
 * 【它守的是哪次故障】2026-09-20：iPhone/iPad 打开应用就是「页面没有完整加载」，
 * 点「重新加载」也没用，而电脑上一切正常。根因是 `src/main.js` 的「按时段预测预加载」
 * **裸调了 `requestIdleCallback`**：iOS Safari 长期没有这个 API（iOS 17.4 以前完全没有），
 * 于是它在 `bootstrap()` 里抛 `ReferenceError` → 被 `.catch()` 判成启动失败 →
 * 注销 Service Worker、清缓存、整页重载 → 重载仍然抛（时段没变）→ 自动恢复预算用尽 →
 * 弹出致命错误页。桌面 Chrome 有这个 API，所以同一份代码在电脑上一直正常，
 * 而且只要不在 06:00–10:00 / 18:00–22:00 两个时段，问题也不会出现——
 * 这种「只在某些浏览器 + 某些钟点」的缺陷，靠人工点很难兜住，必须由检查装置守。
 *
 * 【这一层和 scripts/audit/iphone-boot.mjs 的分工】
 *   这里做**静态**守卫：源码里出现未守卫的调用就直接红，秒级、零依赖。
 *   那边做**行为**守卫：真 Chrome 里删掉该 API、把钟点钉在晚上，断言首屏能打开。
 * 静态的能覆盖「任何文件」，行为的能覆盖「真的打不开」。
 *
 * 【为什么必须有「判别力前提」那条用例】一个只会说「没找到问题」的检查装置毫无价值。
 * 所以先拿历史故障里那两行**原文**喂给同一个检测函数，证明它抓得住，再去扫全仓。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// iPhone/iPad 上的 Safari 缺失或长期不稳的 API（按需扩充）。
// 这里只列「一旦在启动路径裸调就会让整个应用打不开」的那些。
const GUARDED_APIS = ['requestIdleCallback', 'cancelIdleCallback']

/** 去掉注释：注释里提到这些名字是正常的（本文档自己就在提），不能算命中。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ' '))
    .join('\n')
}

/**
 * 找出源码里**未守卫**的调用，返回 `{ line, text }` 列表。
 *
 * 受认可的写法有四种，都能在 iPhone Safari 上安全落地：
 *   - `window.requestIdleCallback(...)` / `globalThis.requestIdleCallback(...)`：显式挂到全局对象上；
 *   - `typeof requestIdleCallback`（含 `typeof window.requestIdleCallback`）：只是探测，不会抛；
 *   - `'requestIdleCallback' in window`：探测存在性；
 *   - 同一行里先探测、再用 `window.` 调用（本仓 whenIdle() 的写法）。
 * 其余一切「直接按全局标识符调用」的写法都算未守卫——那正是会抛 ReferenceError 的形态。
 */
export function findUnguardedCalls(source) {
  const hits = []
  stripComments(source).split('\n').forEach((line, index) => {
    for (const api of GUARDED_APIS) {
      const re = new RegExp(`(?<![\\w.$])${api}\\b`, 'g')
      let match
      let flagged = false
      while (!flagged && (match = re.exec(line)) !== null) {
        const before = line.slice(0, match.index)
        const after = line.slice(match.index)
        const allowed =
          /window\s*\.\s*$/.test(before) // window.requestIdleCallback
          || /globalThis\s*\.\s*$/.test(before) // globalThis.requestIdleCallback
          || /typeof\s*$/.test(before) // typeof requestIdleCallback
          || new RegExp(`^${api}['"]\\s+in\\s+window`).test(after) // 'requestIdleCallback' in window
          || new RegExp(`typeof\\s+(window\\s*\\.\\s*)?${api}\\b`).test(before) // 先探测、再调用
          || new RegExp(`['"]${api}['"]\\s+in\\s+window`).test(before)
        if (allowed) continue
        hits.push({ line: index + 1, text: line.trim() })
        flagged = true
      }
    }
  })
  return hits
}

/** 递归收集 src 下的 .js / .vue 文件。 */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(js|vue|ts)$/.test(entry)) out.push(full)
  }
  return out
}

describe('iOS Safari 缺失 API 的守卫', () => {
  it('判别力前提：历史故障里那两行必须被抓住', () => {
    // 这就是 2026-09-20 线上故障的原文（src/main.js 的按时段预加载）。
    const historical = [
      '  const hour = new Date().getHours()',
      '  if (hour >= 6 && hour <= 10) {',
      "    requestIdleCallback(() => {",
      "      preloadRoute('ScheduleView')",
      '    }, { timeout: 5000 })',
      '  }',
    ].join('\n')
    const hits = findUnguardedCalls(historical)
    expect(hits, '裸调必须被判定为未守卫').toHaveLength(1)
    expect(hits[0].line, '应精确指到那一行').toBe(3)

    // 修复后的三种合法写法都不能被误报。
    expect(findUnguardedCalls("if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout: 5000 })")).toEqual([])
    expect(findUnguardedCalls("if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 3000 })")).toEqual([])
    expect(findUnguardedCalls('window.setTimeout(task, 1200)')).toEqual([])
    // 注释里提到名字不算命中（否则这份文档自己就会让测试变红）。
    expect(findUnguardedCalls('// 不能裸调 requestIdleCallback，Safari 没有它')).toEqual([])
  })

  it('src/ 里不存在未守卫的调用', () => {
    const offenders = []
    for (const file of sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
      for (const hit of findUnguardedCalls(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(fileURLToPath(new URL('..', import.meta.url)), file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(offenders, '这些调用在 iPhone Safari 上会抛 ReferenceError，请改成 whenIdle()/window. 前缀/typeof 探测').toEqual([])
  })
})