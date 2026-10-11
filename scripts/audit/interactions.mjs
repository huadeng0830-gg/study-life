import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const files = []
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.vue')) files.push(path)
  }
}
walk(resolve(root, 'src'))

// Static import reachability separates retired components from possible live
// entry points. Re-exports and lazy imports are included; visibility/roles and
// dynamically generated references still need runtime/manual verification.
const reachable = new Set()
function follow(file) {
  if (reachable.has(file)) return
  reachable.add(file)
  const source = readFileSync(file, 'utf8')
  const references = source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)
  for (const [, specifier] of references) {
    const path = specifier.startsWith('@/') ? resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') ? resolve(dirname(file), specifier) : null
    if (!path) continue
    const candidate = [path, ...['.js', '.ts', '.vue', '/index.js', '/index.ts'].map(suffix => path + suffix)]
      .find(value => /\.(js|ts|vue)$/.test(value) && existsSync(value))
    if (candidate) follow(candidate)
  }
}
follow(resolve(root, 'src/main.js'))

function attr(node, name) {
  const item = node.props.find((prop) => prop.name === name || (prop.name === 'bind' && prop.arg?.content === name))
  return item?.value?.content || item?.exp?.content || ''
}
function textOf(node) {
  return (node.children || []).map((child) => child.type === 2 ? child.content
    : child.type === 5 ? `{{ ${child.content.content} }}` : textOf(child)).join(' ').replace(/\s+/g, ' ').trim()
}
function classify(tag, label, handler, props) {
  const value = `${label} ${handler}`
  if (props.kind) return { important: 'A', frequent: 'B', instant: 'C', danger: 'D', task: 'E' }[props.kind] || 'B'
  if (['a', 'RouterLink', 'router-link', 'summary'].includes(tag)) return 'C'
  if (!/\b(?:save\w*|submit\w*|commit\w*|delete\w*|remove\w*|confirm\w*)\s*\(/i.test(handler) && (/\$emit\('update[:\-]/.test(handler) || /click:\s*\w+(?:\.value)?\s*=/.test(handler))) return 'C'
  if (['input', 'select', 'textarea'].includes(tag)) return /readFile|uploadImage|onUpload|selectFile|importFile|onFileChange|loadImage/.test(handler) ? 'E' : 'C'
  if (!/action:|(?:click|submit|confirm|save|commit|import|retry|start|primary|secondary):\s*\S/.test(handler) && !['button', 'ActionButton', 'form'].includes(tag)) return 'C'
  if (/open|show|request|select|changeMode|setType|pick|choose|close|dismiss|cancel|navigate|router\.|resetAllAppearance|resetAllWallpapers/i.test(handler) && !/\b(?:confirm\w*|save\w*|commit\w*|submit\w*|upload\w*|refresh\w*|synchronize|importCsv\w*|importIcs\w*)\s*\(/i.test(handler) && !/^(?:submit|confirm|save|commit|import):/.test(handler)) return 'C'
  if (/fileInput\??\.click\(\)/.test(handler)) return 'C'
  if (props.kind === 'danger' || props.kind === 'task') return props.kind === 'danger' ? 'D' : 'E'
  if (/删除|清空|注销|退出账号|覆盖|放弃|移除|delete|remove|clearEntry|resetAll|signOut|discard/i.test(value)) return 'D'
  if (/upload|recogniz|ocr|synchronize|SyncNow|export.*Data|exportBackup|restoreBackup|selectFile|readFile|retry.*Progress|import.*File|runImport|startImport|checkUpdate|applyUpdate|runParsePaste|queryAvailability/.test(handler)) return 'E'
  if (/refresh|copy|onCopy|searchByEmail|mark.*Read|update|saveDraft|saveProfile|saveProgress|saveNavigation|quoteSaves/.test(handler)) return /saveNavigation/.test(handler) ? 'A' : 'B'
  if (props.kind) return { important: 'A', frequent: 'B', instant: 'C' }[props.kind] || 'B'
  if (/save|保存|更新|commit|submit|确认|创建|添加|导入|import|apply|confirm|发送/i.test(value)) return /确认|创建|提交|添加|导入|register|submit|confirm/i.test(value) || props.type === 'submit' ? 'A' : 'B'
  if (tag === 'form') return 'A'
  return 'C'
}

const inventory = []
for (const file of files.sort()) {
  const source = readFileSync(file, 'utf8')
  const { descriptor } = parseSfc(source)
  if (!descriptor.template) continue
  const tree = parseTemplate(descriptor.template.content)
  const visit = (node) => {
    if (node.type === 1) {
      const handlers = node.props.filter((prop) => prop.name === 'on').map((prop) => `${prop.arg?.content || '*'}: ${prop.exp?.content || ''}`)
      const controlled = ['button', 'a', 'RouterLink', 'router-link', 'input', 'select', 'textarea', 'summary', 'form', 'ActionButton', 'Button', 'Input', 'Textarea', 'Select', 'SelectTrigger', 'Checkbox', 'Switch', 'Toggle', 'ToggleGroup', 'ToggleGroupItem', 'TabsTrigger', 'RadioGroup', 'RadioGroupItem', 'Slider', 'DropdownMenuTrigger', 'DropdownMenuItem', 'DialogTrigger', 'DialogClose', 'SheetTrigger', 'SheetClose'].includes(node.tag)
      const model = node.props.some(prop => prop.name === 'model')
      const role = attr(node, 'role')
      if (controlled || model || /^(button|link|tab|switch|checkbox|radio|menuitem)$/.test(role) || handlers.some((handler) => /^(click|submit|change|keydown|pointerdown|confirm|save|commit|import|start|cancel|retry|primary|secondary|action|select):\s*\S/.test(handler))) {
        const action = attr(node, 'action')
        const handler = [action && `action: ${action}`, ...handlers].filter(Boolean).join('; ') || (node.tag === 'input' || node.tag === 'select' || node.tag === 'textarea' ? '原生输入 / v-model' : '原生展开 / 链接')
        const label = attr(node, 'aria-label') || attr(node, 'title') || attr(node, 'placeholder') || textOf(node).slice(0, 140) || `${node.tag} ${attr(node, 'type')}`.trim()
        const props = { kind: attr(node, 'kind'), type: attr(node, 'type') }
        const line = descriptor.template.loc.start.line + node.loc.start.line - 1
        inventory.push({ file: relative(root, file).replace(/\\/g, '/'), line, tag: node.tag, label, handler, category: classify(node.tag, label, handler, props), reachable: reachable.has(file), repeated: node.props.some((prop) => prop.name === 'for'), feedback: node.tag === 'ActionButton' ? `共享按钮 ${attr(node, 'feedback') || '本地反馈'}` : attr(node, 'aria-busy') ? '声明忙碌态（需验证真源）' : ['input', 'select', 'textarea', 'Input'].includes(node.tag) ? '就地编辑 / 校验' : '现有状态（待逐项验证）' })
      }
      node.children.forEach(visit)
    } else (node.children || []).forEach(visit)
  }
  visit(tree)
}

const totals = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((kind) => [kind, inventory.filter((item) => item.category === kind).length]))
const argument = process.argv[2]
if (argument) writeFileSync(resolve(root, argument), JSON.stringify({ files: files.length, totals, inventory }, null, 2) + '\n')
console.log(JSON.stringify({ files: files.length, controls: inventory.length, totals }))

const ledgerIndex = process.argv.indexOf('--ledger')
if (ledgerIndex !== -1) {
  const escape = value => String(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const active = inventory.filter(item => item.reachable)
  let markdown = '# 全局交互专项逐入口待办台账\n\n扫描日期：2026-10-11（Asia/Shanghai）。由 `node scripts/audit/interactions.mjs ../.tmp/interaction-20261011.json --ledger docs/optimization/INTERACTION_LEDGER.md` 生成。\n\n'
  markdown += `扫描 ${files.length} 个 Vue 文件、${inventory.length} 个控件/事件定义，其中静态依赖可达 ${active.length} 个。循环按定义计数；包装器内部与调用者各列，数量不等于去重后的功能数。分类 A 重要提交 / B 高频 / C 即时 / D 危险 / E 长任务仅用于安排审查，自动分类须人工复核。\n\n`
  markdown += 'S/U = 已列入源码审计，行为仍待逐项验收。即使现有共享按钮或旧测试通过，也不自动标为完成。本批 GLO02 导航保存与离开、草稿/确认/撤销，以及共享 ActionButton 的具体验证见 STATUS.md 第 0D 节；下表仍保留完整入口供下一轮复核。静态可达包括懒加载和重导出，不证明角色/权限/平台实际显示；未可达文件列为无静态入口，不当作活动消费者。模板动态组件、全局注册、原生平台/权限菜单需结合 INVENTORY.md GLO/API 条目人工审查。\n\n'
  for (const activeOnly of [true, false]) {
    markdown += activeOnly ? '## 活动依赖中的交互（逐项待办）\n\n' : '## 未发现静态活动入口（保留核对）\n\n'
    const rows = inventory.filter(item => item.reachable === activeOnly)
    for (const file of [...new Set(rows.map(item => item.file))]) {
      markdown += `### ${file}\n\n| 行 | 控件 | 名称 | 行为 | 分类 | 现有反馈 | 验收状态 |\n| --- | --- | --- | --- | --- | --- | --- |\n`
      for (const item of rows.filter(item => item.file === file)) markdown += `| ${item.line} | ${item.tag} | ${escape(item.label)} | ${escape(item.handler)} | ${item.category} | ${escape(item.feedback)} | ${activeOnly ? 'S/U；见批次范围' : '无静态入口；待核对'} |\n`
      markdown += '\n'
    }
  }
  writeFileSync(resolve(root, process.argv[ledgerIndex + 1]), markdown)
}
if (process.argv.includes('--actions')) {
  for (const item of inventory.filter((item) => ['A', 'B', 'D', 'E'].includes(item.category))) console.log(`${item.category} ${item.file}:${item.line} ${item.label.slice(0, 54)} | ${item.handler}`)
}
// Refresh only the generated inventory; preserve the reviewed findings above it.
const markdownIndex = process.argv.indexOf('--markdown')
if (markdownIndex !== -1) {
  const markdownPath = resolve(root, process.argv[markdownIndex + 1])
  const existing = readFileSync(markdownPath, 'utf8')
  const escape = (value) => String(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const reason = { A: '明确提交；结果以真实写入为准', B: '频繁操作；短反馈或既有保存状态', C: '即时状态；无加载/成功动画', D: '沿用确认、撤销或原有危险状态', E: '真实任务阶段/预览/取消/重试' }
  let generated = `扫描 ${files.length} 个 Vue 文件，列出 ${inventory.length} 个控件/事件定义。分类：${Object.entries(totals).map(([key, count]) => `${key} ${count}`).join('，')}。共享 ActionButton 使用点 ${inventory.filter(item => item.tag === 'ActionButton').length} 个。\n\n`
  for (const file of [...new Set(inventory.map(item => item.file))]) {
    generated += `### ${file}\n\n| 行 | 元素 | 文案 / 名称 | 业务事件 | 分类与设计理由 | 反馈设施 |\n| --- | --- | --- | --- | --- | --- |\n`
    for (const item of inventory.filter(item => item.file === file)) generated += `| ${item.line} | ${item.tag}${item.repeated ? '（循环定义）' : ''} | ${escape(item.label)} | ${escape(item.handler)} | ${item.category}：${reason[item.category]} | ${escape(item.feedback)} |\n`
    generated += '\n'
  }
  const start = '<!-- INTERACTION_INVENTORY:START -->'
  const end = '<!-- INTERACTION_INVENTORY:END -->'
  if (!existing.includes(start) || !existing.includes(end)) throw new Error('Missing inventory markers in the audit document')
  writeFileSync(markdownPath, existing.slice(0, existing.indexOf(start) + start.length) + '\n\n' + generated + existing.slice(existing.indexOf(end)))
}
