import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
      const controlled = ['button', 'a', 'RouterLink', 'router-link', 'input', 'select', 'textarea', 'summary', 'form', 'ActionButton'].includes(node.tag)
      if (controlled || handlers.some((handler) => /^(click|submit|change|keydown|pointerdown|confirm|save|commit|import|start|cancel|retry|primary|secondary|action|select):\s*\S/.test(handler))) {
        const action = attr(node, 'action')
        const handler = [action && `action: ${action}`, ...handlers].filter(Boolean).join('; ') || (node.tag === 'input' || node.tag === 'select' || node.tag === 'textarea' ? '原生输入 / v-model' : '原生展开 / 链接')
        const label = attr(node, 'aria-label') || attr(node, 'title') || attr(node, 'placeholder') || textOf(node).slice(0, 140) || `${node.tag} ${attr(node, 'type')}`.trim()
        const props = { kind: attr(node, 'kind'), type: attr(node, 'type') }
        const line = descriptor.template.loc.start.line + node.loc.start.line - 1
        inventory.push({ file: relative(root, file).replace(/\\/g, '/'), line, tag: node.tag, label, handler, category: classify(node.tag, label, handler, props), repeated: node.props.some((prop) => prop.name === 'for'), feedback: node.tag === 'ActionButton' ? `共享按钮 ${attr(node, 'feedback') || '本地反馈'}` : attr(node, 'aria-busy') ? '真实忙碌态' : ['input', 'select', 'textarea'].includes(node.tag) ? '就地编辑 / 校验' : '原有状态 / 统一基础反馈' })
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
