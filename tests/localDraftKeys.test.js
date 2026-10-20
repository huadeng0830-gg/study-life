// 刻意不声明 happy-dom：读源码文件的用例必须跑在 vitest 默认的 node 环境里。
// happy-dom 会接管 `new URL(相对, 基础)`，把基准从 file:// 换成文档地址，
// 于是 fileURLToPath 会报 "The URL must be of scheme file"（见 vite.config.js 的 test 注释）。
// 这里要验证的用量统计接受注入的 storage，所以也不需要真实的 localStorage。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCAL_DRAFT_KEY_PREFIXES, isLocalDraftKey, isPurgeableLocalKey } from '../src/composables/localDraftKeys.js'
import { measureLocalBusinessStorage } from '../src/composables/localStorageUsage.js'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const readSource = (relativePath) => readFileSync(resolve(TEST_DIR, '..', relativePath), 'utf8')

function storageOf(entries) {
  const map = new Map(Object.entries(entries))
  return {
    get length() { return map.size },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
  }
}

// 每个前缀对应真正使用它的源码：登记表脱离源码就是一句空话。
const PREFIX_SOURCES = {
  'study-life:campus-draft:': 'src/composables/campusLifeDraft.js',
  'study-life-project-submit:': 'src/composables/projects/useProjectDeliverableEditor.js',
}

describe('本机草稿键的登记与处置', () => {
  it('每个草稿前缀都真的在对应源码里用作存储键', () => {
    expect(LOCAL_DRAFT_KEY_PREFIXES.length).toBeGreaterThan(0)
    for (const prefix of LOCAL_DRAFT_KEY_PREFIXES) {
      const source = PREFIX_SOURCES[prefix]
      expect(source, `新增草稿前缀 ${prefix} 时必须同时指明它在哪个源码里`).toBeTruthy()
      expect(readSource(source), `${source} 里找不到 ${prefix}`).toContain(prefix)
    }
    // 反向：登记表与这份映射必须一一对应，新增前缀不能只改一边。
    expect(Object.keys(PREFIX_SOURCES).sort()).toEqual([...LOCAL_DRAFT_KEY_PREFIXES].sort())
  })

  it('登记的前缀不得写在 sessionStorage 里——那清空和用量两条路径都够不着', () => {
    // 快速记录的草稿曾经登记在这里，但 draftStorage.js 实际写的是 sessionStorage：
    // 它随标签页关闭而消失，本来就没有「清空后残留」要防，登记反而成了假保护。
    const draftStorage = readSource('src/composables/quickRecord/draftStorage.js')
    expect(draftStorage).toContain('sessionStorage')
    expect(LOCAL_DRAFT_KEY_PREFIXES.some((prefix) => prefix.includes('quick-record'))).toBe(false)
    // 凡是被登记的前缀，其源码里都不该出现 sessionStorage 作为写入目标。
    for (const [prefix, source] of Object.entries(PREFIX_SOURCES)) {
      expect(readSource(source), `${source} 用 sessionStorage 承载 ${prefix}，不应登记为 localStorage 草稿键`)
        .not.toContain('sessionStorage')
    }
  })

  it('清空本机数据会一并清掉草稿键，而不是只清 sl_ 前缀', () => {
    // 清空流程只按前缀清（clearStoredDataByPrefix）。草稿没有 sl_ 前缀，
    // 因此必须显式遍历 LOCAL_DRAFT_KEY_PREFIXES，否则清空后草稿正文仍留在设备上。
    expect(readSource('src/composables/localDataPurge.js')).toContain('LOCAL_DRAFT_KEY_PREFIXES')
  })

  it('用量统计把草稿算进去', () => {
    const usage = measureLocalBusinessStorage(storageOf({
      sl_tasks: '[{"id":"a"}]',
      'study-life:campus-draft:v1:fictional:market': '{"title":"虚构草稿正文"}',
      theme: 'dark',
    }))
    // 两个用户内容键；`theme` 既不是业务键也不是草稿，不该被算进来。
    expect(usage.keyCount).toBe(2)
    expect(usage.chars).toBeGreaterThan('{"title":"虚构草稿正文"}'.length)
  })

  it('只认用户内容键：状态标记与账号键不算在内', () => {
    expect(isPurgeableLocalKey('sl_tasks')).toBe(true)
    expect(isLocalDraftKey('study-life:campus-draft:v1:x')).toBe(true)
    expect(isPurgeableLocalKey('study-life:campus-draft:v1:x')).toBe(true)
    // 快速记录草稿在 sessionStorage 里，不属于「需要被清空与计入用量的本机内容」。
    expect(isLocalDraftKey('study-life-quick-record-draft:u1')).toBe(false)
    // 这些是状态标记而不是用户内容：清掉会让应用以为数据从未归属过某个账号。
    for (const key of ['study-life-data-owner', 'study-life-account-switch', 'study-life-account-sync-commit'])
      expect(isPurgeableLocalKey(key), key).toBe(false)
    expect(isPurgeableLocalKey(null)).toBe(false)
    expect(isLocalDraftKey(undefined)).toBe(false)
  })
})