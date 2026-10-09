/**
 * 齐行项目表单的错误提示接线守卫。
 *
 * 【这个缺陷是什么】
 * 新建/编辑项目的弹窗里，错误位写的是：
 *     <p class="projects-form-error" aria-live="polite">{{ pageError }}</p>
 * 但 `pageError` **只**记录项目列表 / 详情的加载失败（loadProjects 与 loadProject
 * 各写一处，开头重置一处），而表单校验失败走的是 `notify('error', …)` → 顶部 notice。
 * 于是：
 *   1. 「请填写项目名称。」「预计结束日期不能早于开始日期。」这类校验提示在这个
 *      aria-live 区域里**永远不出现**——读屏用户也听不到，因为播报跟着文本走；
 *   2. 反过来，上一次列表请求失败留下的 pageError 会在用户新开表单时**显示成表单
 *      错误**，看起来像表单坏了。
 * 仓库里其余表单（EventsView 的 formError、TasksView 的 error、BillFormModal 的
 * billError）都各有一份独立的表单错误状态，只有齐行是例外。
 *
 * 【为什么用源码解析而不是渲染断言】
 * ProjectsView 有约 80 个 ref、依赖 accountAuth / domain / supabase functions，
 * 整树挂载的成本与脆弱度都远高于这条缺陷本身；而且这条缺陷的本质是"两个状态接错了
 * 同一个显示位"，渲染出来也只是一个空文本。仓库已有多个同类守卫
 * （scopedChildReachability / overlayEscape / modalStackOrder）都是解析源码断言，
 * 这里沿用同一约定。
 *
 * 【判据】
 *   1. 项目表单的错误位必须绑 `projectFormError`，不得绑 `pageError`；
 *   2. `projectFormError` 必须在 saveProject 的**两条失败路径**上都写入
 *      （校验不通过、服务端拒绝），否则又会退化成"永远不显示"；
 *   3. 打开新建 / 编辑表单时必须清空，否则上一条错误会粘在新的空表单上；
 *   4. 任何 `.projects-form-error` 都不得绑 `pageError`（含 scheduleError 那条，
 *      它绑的是 scheduleError，属于另一处合法用法，这里只排除 pageError）。
 *
 * 另外同一文件还守住了交付检查「凭证与说明」的接线：那个输入框用 v-model 直接绑在
 * 服务端返回的检查项对象上，而本页面有 120 秒自动刷新会整体替换 deliveryChecks.value，
 * 用户正在输入的文字会被静默清空。草稿保留行为由 pendingFieldEdits.test.js 直接测
 * composable，这里只守接线没有漏掉。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../src/views/ProjectsView.vue', import.meta.url)), 'utf8')

function scriptSetup() {
  const match = /<script setup>([\s\S]*?)<\/script>/.exec(source)
  expect(match, 'ProjectsView.vue 应包含 <script setup> 块').not.toBeNull()
  return match[1]
}

function template() {
  const match = /<template>([\s\S]*)<\/template>\s*(<style|$)/.exec(source)
  expect(match, 'ProjectsView.vue 应包含 <template> 块').not.toBeNull()
  return match[1]
}

function functionBody(name, code = scriptSetup()) {
  const start = code.indexOf(`function ${name}(`)
  expect(start, `应能找到 ${name} 函数`).toBeGreaterThan(-1)
  // 从声明处开始，按花括号配平取出函数体。
  let depth = 0
  let seen = false
  for (let index = start; index < code.length; index += 1) {
    const char = code[index]
    if (char === '{') { depth += 1; seen = true }
    else if (char === '}') {
      depth -= 1
      if (seen && depth === 0) return code.slice(start, index + 1)
    }
  }
  throw new Error(`${name} 函数体括号不配平，无法判定`)
}

describe('齐行项目表单的错误提示接线', () => {
  it('表单错误位绑独立的 projectFormError，而不是列表级的 pageError', () => {
    expect(scriptSetup()).toMatch(/const projectFormError = ref\(''\)/)

    const formErrorTag = /<p class="projects-form-error"[^>]*>([\s\S]*?)<\/p>/g
    const bindings = [...template().matchAll(formErrorTag)].map((match) => match[1].trim())
    expect(bindings.length, '应至少有一处表单错误提示位').toBeGreaterThan(0)
    for (const binding of bindings) {
      expect(binding, '`.projects-form-error` 不得绑定 pageError（它只记录列表加载失败）').not.toBe('{{ pageError }}')
    }
    expect(template()).toContain('{{ projectFormError }}')
  })

  it('校验不通过与服务端拒绝两条失败路径都写入 projectFormError', () => {
    const body = functionBody('saveProject')
    // 校验失败：validateProjectForm 返回 !ok 时写入。
    expect(body).toMatch(/if \(!validated\.ok\) \{ projectFormError\.value = validated\.message/)
    // 服务端拒绝：catch 分支写入 errorMessage(error)。
    expect(body).toMatch(/catch \(error\)[\s\S]*?projectFormError\.value = message/)
    // 提交前先清空，避免上一条错误残留。
    expect(body).toMatch(/projectFormError\.value = ''\s*\n\s*projectSaveBusy\.value = true/)
  })

  it('打开新建与编辑表单时清空上一次的表单错误', () => {
    for (const name of ['openCreateProject', 'openEditProject']) {
      const body = functionBody(name)
      expect(body, `${name} 应清空 projectFormError`).toMatch(/projectFormError\.value = ''/)
      expect(body.indexOf('projectFormError.value = \'\'')).toBeLessThan(body.indexOf('showProjectForm.value = true'))
    }
  })

  it('pageError 仍只用于列表与详情加载错误', () => {
    const code = scriptSetup()
    const writers = code.split('\n').filter((line) => /pageError\.value\s*=/.test(line))
    expect(writers.length, 'pageError 应只在加载路径上写入').toBeGreaterThan(0)
    for (const line of writers) {
      expect(line, 'pageError 不应承载表单错误').not.toContain('projectFormError')
    }
    // 列表级错误位仍然渲染在页面顶部，与表单错误位分开。
    expect(template()).toContain('<p v-if="pageError" class="projects-error" role="alert">{{ pageError }}</p>')
  })
})

describe('齐行交付检查说明不会被自动刷新冲掉（接线）', () => {
  it('输入时登记草稿，替换后盖回，保存成功后清除', () => {
    // 行为由 pendingFieldEdits.test.js 直接测 composable，这里只守 ProjectsView 的接线没漏。
    expect(scriptSetup()).toMatch(/const deliveryEvidenceEdits = usePendingFieldEdits\(\)/)
    expect(template()).toMatch(/v-model="item\.evidence"[^>]*@input="deliveryEvidenceEdits\.mark\(item\.id, item\.evidence\)"/)

    // 替换数组之后必须紧跟着 reapply，否则草稿留了也不会生效。
    const load = functionBody('loadProject')
    const replace = load.indexOf('deliveryChecks.value = result.deliveryChecks || []')
    expect(replace).toBeGreaterThan(-1)
    expect(load).toContain("deliveryEvidenceEdits.reapply(deliveryChecks.value, 'evidence')")
    expect(load.indexOf("deliveryEvidenceEdits.reapply(deliveryChecks.value, 'evidence')")).toBeGreaterThan(replace)

    // clear 必须在 await 成功之后：失败时本地草稿要留着。
    const save = functionBody('saveDeliveryCheck')
    expect(save.indexOf('deliveryEvidenceEdits.clear(item.id)'))
      .toBeGreaterThan(save.indexOf("await projectRequest('delivery_check_update'"))
  })

  it('切换项目与退出登录时清空草稿', () => {
    expect(functionBody('selectProject')).toMatch(/deliveryEvidenceEdits\.clearAll\(\)/)
    const signOut = /if \(id\) void refresh\(\)\s*\n\s*else \{[\s\S]*?deliveryEvidenceEdits\.clearAll\(\)/.exec(scriptSetup())
    expect(signOut, '退出登录时应清空草稿').not.toBeNull()
  })
})