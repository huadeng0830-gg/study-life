// 反馈状态是一份**跨四层**的契约：前端下拉、公开 Worker 的白名单、Edge Function 的
// 校验与筛选、数据库 CHECK 与 RPC 白名单。
//
// 【这个文件守的是什么】
// 曾经有审计报告断言「管理员点『已计划/待补充/重复反馈』必然保存失败」——那是**误报**：
// 20261015100000 的 CHECK 只有 4 个状态，但更晚的 20261016044951 先
// `drop constraint` 再建 7 状态约束，RPC 也放行了 7 个。只看先一个迁移就会得出错误结论。
//
// 真正的问题是**这类漂移没有任何机械守卫**：谁改了其中一层，另外三层会静默不一致，
// 而症状既可能是「保存失败」，也可能是「用户看到成功但服务端拒收」。
// 所以这里不重述状态清单，而是把四层**真的读出来比对**。
//
// 刻意跑在 vitest 默认的 node 环境：happy-dom 会接管 `new URL(相对, 基础)`，
// 让读文件的用例报 "The URL must be of scheme file"（见 vite.config.js 的 test 注释）。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { feedbackActiveStatuses, feedbackStatusLabels, feedbackValidation } from '../src/composables/feedbackModel.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(resolve(ROOT, relativePath), 'utf8')

const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations')
const migrationNames = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()

/** 取 SQL 里 `in ('a','b')` / `not in ('a','b')` 的引号内容。 */
function parseSqlList(fragment) {
  return [...fragment.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
}

/**
 * 某行源码里的**数组字面量**（这些白名单都写在单行数组里）。
 * 只取方括号内容，不取整行的引号字符串 —— 同一行往往还有 `query.eq('status', …)`
 * 之类的无关字符串，按整行抓会把 'status' 也算成状态。
 */
function arraysOnLinesContaining(text, marker) {
  return text.split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => /\[([^\]]*)\]/.exec(line))
    .filter(Boolean)
    .map((match) => parseSqlList(match[1]))
    .filter((list) => list.length)
}

/** 按文件名顺序扫描全部迁移，返回最后一条匹配的定义（后来的定义覆盖先前的）。 */
function lastMatchingMigration(pattern) {
  let found = null
  for (const name of migrationNames) {
    const text = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8')
    for (const match of text.matchAll(pattern)) found = { name, match }
  }
  return found
}

const canonical = Object.keys(feedbackStatusLabels)

describe('反馈状态的跨层契约', () => {
  it('前端模型本身就是这份契约的事实来源，且非空', () => {
    expect(canonical.length).toBeGreaterThan(0)
    expect(canonical).toContain('needs_info')
    expect(canonical).toContain('duplicate')
    for (const status of canonical) expect(feedbackStatusLabels[status]).toBeTruthy()
  })

  it('数据库最后一条 status 约束与前端一致', () => {
    const found = lastMatchingMigration(/campus_feedback_suggestions_status_check check \(status in \(([^)]*)\)/g)
    expect(found, '找不到 campus_feedback_suggestions 的 status 约束定义').toBeTruthy()
    // 最后一条定义生效：前面的会被 drop constraint 掉（20261016044951 就是这么做的）。
    expect(parseSqlList(found.match[1]).sort()).toEqual([...canonical].sort())
  })

  it('数据库 RPC 的状态白名单与前端一致', () => {
    const found = lastMatchingMigration(/create function public\.campus_manage_feedback[\s\S]*?p_status not in \(([^)]*)\)/g)
    expect(found, '找不到 campus_manage_feedback 的状态白名单').toBeTruthy()
    expect(parseSqlList(found.match[1]).sort()).toEqual([...canonical].sort())
  })

  it('公开 Worker 的状态白名单与前端一致', () => {
    const lists = arraysOnLinesContaining(read('workers/public-api/index.ts'), "'duplicate'")
    expect(lists.length, 'Worker 里应当恰好有一份状态白名单').toBe(1)
    expect(lists[0].sort()).toEqual([...canonical].sort())
  })

  it('Edge Function 的状态白名单与筛选列表都与前端一致', () => {
    const lists = arraysOnLinesContaining(read('supabase/functions/campus-community/index.ts'), "'duplicate'")
    // 一处是提交校验（feedback_manage），一处是管理端筛选（status 查询参数）。
    expect(lists.length, 'Edge Function 的白名单与筛选列表都应含全部状态').toBeGreaterThanOrEqual(2)
    for (const list of lists) expect(list.sort()).toEqual([...canonical].sort())
  })

  it('Edge Function 的「未完结」快捷筛选与前端活动状态列表一致', () => {
    const activeLine = read('supabase/functions/campus-community/index.ts').split('\n')
      .find((line) => line.includes("payload.status === 'active'"))
    expect(activeLine, '找不到 Edge Function 的未完结状态快捷筛选').toBeTruthy()
    const match = /\[([^\]]*)\]/.exec(activeLine)
    expect(match).toBeTruthy()
    expect(parseSqlList(match[1]).sort()).toEqual([...feedbackActiveStatuses].sort())
    expect(feedbackActiveStatuses.every((status) => canonical.includes(status))).toBe(true)
  })

  it('「哪些状态必须写公开说明」这条规则也跨层一致', () => {
    // 前端：这些状态下即使没写回复也不算错误，其余状态必须写。
    const skipsReply = canonical.filter((status) =>
      feedbackValidation({ status, publicReason: '虚构原因', reply: '', reward: '' }) === '')
    const found = lastMatchingMigration(/p_status not in \(([^)]*)\) and char_length\(btrim\(coalesce\(p_reply,''\)\)\)=0/g)
    expect(found, '找不到 RPC 里「必须写回复」的规则').toBeTruthy()
    expect(parseSqlList(found.match[1]).sort()).toEqual([...skipsReply].sort())
  })

  it('「必须写不采纳/重复原因」这条规则也跨层一致', () => {
    const needsReason = canonical.filter((status) =>
      feedbackValidation({ status, publicReason: '', reply: '虚构回复', reward: '' }) !== '')
    const found = lastMatchingMigration(/p_status in \(([^)]*)\) and char_length\(btrim\(coalesce\(p_public_reason,''\)\)\)=0/g)
    expect(found, '找不到 RPC 里「必须写公开原因」的规则').toBeTruthy()
    expect(parseSqlList(found.match[1]).sort()).toEqual([...needsReason].sort())
  })
})
