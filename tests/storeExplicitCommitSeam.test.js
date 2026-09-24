// @vitest-environment happy-dom
/**
 * 「显式提交」这条 seam 的不变量：`touchStoredRef` 之后，依赖该集合的 computed 必须重算。
 *
 * 【为什么单开一条】EXPLICIT_COMMIT_KEYS 里的集合是 `shallowRef`：
 * `push` / `splice` / 就地改字段都不通知依赖，只有 `touchStoredRef` 那一次
 * `triggerRef` 能让视图失效。这条不变量是「集合内每一个键」的属性，
 * 所以这里**直接遍历导出出去的清单**，而不是挑几个键写死：
 * 以后谁往清单里加键，就自动被这条守上。
 *
 * 反过来也要守：清单外的高增长集合仍走 deep watcher 兜底（老 store 兼容），
 * 这条不变量对它们是天然成立的，不是本文件要管的事。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { EXPLICIT_COMMIT_KEY_LIST, touchStoredRef, useStoredRef } from '../src/composables/store/index.js'
import { flushStoredWrites } from '../src/composables/store/index.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { expenses } from '../src/composables/ledger.js'
import { useLedgerBudget } from '../src/composables/ledgerBudget.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

// 先让这些键由**它们自己的模块**建出来，避免本文件用错的默认值抢先创建。
useDomainCommands()
void expenses
useLedgerBudget()
useLedgerFx()

/** 类型无关的「条数」：数组看 length，对象看键数。 */
const sizeOf = (value) => (Array.isArray(value) ? value.length : Object.keys(value || {}).length)

/** 类型无关地塞一条探针数据，返回撤销函数。 */
function poke(ref) {
  if (Array.isArray(ref.value)) {
    const probe = { id: 'seam-probe', updatedAt: '' }
    ref.value.push(probe)
    return () => {
      const at = ref.value.indexOf(probe)
      if (at >= 0) ref.value.splice(at, 1)
    }
  }
  ref.value.__seamProbe = 1
  return () => { delete ref.value.__seamProbe }
}

const undoStack = []

afterEach(() => {
  vi.restoreAllMocks()
  while (undoStack.length) undoStack.pop()()
  flushStoredWrites()
})

describe('touchStoredRef 会让依赖重算（EXPLICIT_COMMIT_KEYS 全键）', () => {
  it('清单本身是冻结的，且至少包含账本集合', () => {
    expect(Object.isFrozen(EXPLICIT_COMMIT_KEY_LIST)).toBe(true)
    expect(EXPLICIT_COMMIT_KEY_LIST).toContain('sl_expenses')
  })

  for (const key of EXPLICIT_COMMIT_KEY_LIST) {
    it(`${key}：就地修改 + touchStoredRef 之后，读它的 computed 必须看到新状态`, () => {
      const ref = useStoredRef(key, [])
      const size = computed(() => sizeOf(ref.value))

      const before = size.value
      undoStack.push(poke(ref))
      touchStoredRef(key)

      expect(size.value, `${key}: 提交之后依赖没有重算（视图会停在旧值，即「删了不消失」）`).toBe(before + 1)
    })
  }

  it('没有 touchStoredRef 的改动不该假装已经提交（shallow 集合本就如此）', () => {
    // 这条不是要求，而是留个记录：通知只发生在显式提交处。
    // 反过来说，任何漏调 touchStoredRef 的修改路径都会同时丢掉持久化与通知，
    // 属于「这条 seam 的调用方违约」，由各自的领域测试兜。
    const ref = useStoredRef('sl_tasks', [])
    const size = computed(() => sizeOf(ref.value))
    const before = size.value
    undoStack.push(poke(ref))
    expect(size.value === before + 1 || size.value === before).toBe(true)
    touchStoredRef('sl_tasks')
    expect(size.value).toBe(before + 1)
  })
})