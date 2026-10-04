// @vitest-environment happy-dom
//
// store/core.js 的 EXPLICIT_COMMIT_KEY_LIST 自己写着两条前提：
//   1. 该键的每一条修改路径都要显式调用 touchStoredRef；
//   2. 视图只依赖 touchStoredRef 那一次通知。
// 漏掉第 1 条的后果是「改了不存盘」，而且**当代码全部走整体替换引用时完全看不出来** ——
// `sl_mood_log` 就这样在清单里躺了很久：所有写入都是 `ref.value = 新对象`，
// shallowRef 换引用会触发 watcher，于是一直是绿的。真正的地雷是有人改成
// `ref.value[day] = x` 的那一天。
//
// 这条守卫按"清单里每个键都必须至少有一处 touchStoredRef 调用"来卡，
// 并解析 `const XXX_KEY = 'sl_...'` 这类常量间接（ledger 三个键就是走常量的）。
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, extname, join } from 'node:path'

const SRC = resolve(process.cwd(), 'src')

function collectSourceFiles(dir = SRC) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (['.js', '.vue'].includes(extname(entry.name))) out.push(full)
  }
  return out
}

const ALL_SOURCE = collectSourceFiles().map((file) => readFileSync(file, 'utf8')).join('\n')

// 常量间接：const NAME = 'sl_xxx'  /  export const NAME = 'sl_xxx'
const CONSTANT_VALUES = new Map()
for (const matched of ALL_SOURCE.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"](sl_[a-z0-9_]+)['"]/gi)) {
  CONSTANT_VALUES.set(matched[1], matched[2])
}

function touchCallSites(key) {
  const sites = []
  // 直接写字面量
  for (const matched of ALL_SOURCE.matchAll(/touchStoredRef\(\s*['"](sl_[a-z0-9_]+)['"]/gi)) {
    if (matched[1] === key) sites.push(matched[0])
  }
  // 通过常量
  for (const matched of ALL_SOURCE.matchAll(/touchStoredRef\(\s*([A-Z][A-Z0-9_]*)\s*\)/g)) {
    if (CONSTANT_VALUES.get(matched[1]) === key) sites.push(matched[0])
  }
  return sites
}

describe('显式提交清单的契约', () => {
  it('清单里每个键都至少有一处 touchStoredRef 调用（含常量间接）', async () => {
    const { EXPLICIT_COMMIT_KEY_LIST } = await import('../src/composables/store/core.js')
    const orphans = EXPLICIT_COMMIT_KEY_LIST.filter((key) => touchCallSites(key).length === 0)
    expect(
      orphans,
      `这些键在 EXPLICIT_COMMIT_KEY_LIST 里，却没有任何 touchStoredRef 调用 —— `
      + '违反 core.js 里自己写的第 1 条前提，改成就地修改字段就会静默丢数据：'
      + orphans.join(', '),
    ).toEqual([])
  })

  it('sl_mood_log 不在清单里（它的写入是整体替换，走 deep watch 更安全）', async () => {
    const { EXPLICIT_COMMIT_KEY_LIST } = await import('../src/composables/store/core.js')
    expect(EXPLICIT_COMMIT_KEY_LIST).not.toContain('sl_mood_log')
  })

  it('常量间接解析本身是有效的（否则 ledger 三个键会被误判为孤儿）', () => {
    // 防止守卫自己因为解析器写错而恒绿：这三个键确实只通过常量 touch。
    expect(CONSTANT_VALUES.get('LEDGER_FX_KEY')).toBe('sl_ledger_fx')
    expect(CONSTANT_VALUES.get('LEDGER_BUDGET_KEY')).toBe('sl_ledger_budget')
    expect(CONSTANT_VALUES.get('LEDGER_TEMPLATES_KEY')).toBe('sl_ledger_templates')
    expect(touchCallSites('sl_ledger_fx').length).toBeGreaterThan(0)
    expect(touchCallSites('sl_ledger_budget').length).toBeGreaterThan(0)
    expect(touchCallSites('sl_ledger_templates').length).toBeGreaterThan(0)
  })

  it('就地修改一个清单内键确实不会自动持久化 —— 这正是需要 touch 的原因', async () => {
    // 守卫存在意义的行为侧证据：shallowRef + 非 deep watch 就地改字段不触发写入。
    vi.resetModules()
    localStorage.clear()
    const { useStoredRef, touchStoredRef, flushStoredWrites } = await import('../src/composables/store/core.js')
    const list = useStoredRef('sl_checklists', [])
    // 两个坑叠在一起，缺一个都会让断言变成假绿：
    //  1. watcher 的安装是**延迟**的（requestIdleCallback / 120ms 兜底），
    //     happy-dom 不会及时触发 requestIdleCallback → 要先 flush 装上 watcher；
    //  2. Vue 的 watch 回调是异步的（pre-flush 队列），赋值后同一 tick 里
    //     pendingWrites 还是空的 → 必须先 await nextTick 再 flush。
    const settle = async () => { await nextTick(); flushStoredWrites() }
    await settle()
    list.value = [{ id: 'a' }]
    await settle()
    expect(localStorage.getItem('sl_checklists'), '整体替换引用会落盘').toBe('[{"id":"a"}]')
    // 就地改字段（没有 touch）：shallowRef + deep:false 不通知
    list.value[0].title = '就地改的标题'
    await settle()
    expect(localStorage.getItem('sl_checklists'), '就地改字段没有被持久化，说明 touch 不可省').toBe('[{"id":"a"}]')
    // 显式 touch 之后才落盘
    touchStoredRef('sl_checklists')
    await settle()
    expect(localStorage.getItem('sl_checklists')).toContain('就地改的标题')
  })
})