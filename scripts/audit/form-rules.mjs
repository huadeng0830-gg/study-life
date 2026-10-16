// Source inventory complements the browser probe: includes hidden branches,
// files, custom controls and forms that are only available to signed-in roles.
// Inferred classifications are review candidates, never runtime acceptance.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(root, process.argv[2] || '../.tmp/v5-form-rules.json')
const markdownIndex = process.argv.indexOf('--markdown')
const markdownPath = markdownIndex < 0 ? '' : resolve(root, process.argv[markdownIndex + 1])
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? walk(resolve(dir, entry.name)) : entry.name.endsWith('.vue') ? [resolve(dir, entry.name)] : []))).flat()
}
function prop(node, name) {
  const found = node.props.find(item => item.type === 6 ? item.name === name : item.name === 'bind' && item.arg?.content === name)
  return found?.value?.content ?? found?.exp?.content ?? (found ? true : '')
}
function directive(node, name) { return node.props.find(item => item.type === 7 && item.name === name)?.exp?.content || '' }
function text(node) { return (node.children || []).map(child => child.type === 2 ? child.content : child.type === 1 && !['select', 'option'].includes(child.tag) ? text(child) : '').join(' ').replace(/\s+/g, ' ').trim() }
const fields = [], forms = [], overlays = []
let fileCount = 0
for (const file of (await walk(resolve(root, 'src'))).sort()) {
  if (relative(root, file).replaceAll('\\', '/').startsWith('src/components/ui/')) continue
  const { descriptor } = parseSfc(await readFile(file, 'utf8'))
  if (!descriptor.template) continue
  fileCount++
  const ast = parseTemplate(descriptor.template.content)
  const sourceFile = relative(root, file).replaceAll('\\', '/')
  const labels = new Map()
  function collect(node) {
    if (node.type === 1 && /^(label|FieldLabel|Label)$/.test(node.tag) && prop(node, 'for')) labels.set(prop(node, 'for'), text(node))
    for (const child of node.children || []) collect(child)
  }
  collect(ast)
  function visit(node, parents = []) {
    if (node.type === 1) {
      const line = descriptor.template.loc.start.line + node.loc.start.line - 1
      const condition = [...parents, node].flatMap(parent => ['if', 'else-if', 'show', 'for'].map(name => directive(parent, name)).filter(Boolean)).join(' && ')
      const model = directive(node, 'model')
      const handlers = node.props.filter(item => item.type === 7 && item.name === 'on').map(item => `${item.arg?.content || '*'}: ${item.exp?.content || ''}`).join('; ')
      if (node.tag === 'form') forms.push({ id: `FORM-${forms.length + 1}`, file: sourceFile, line, handlers, condition })
      if (/^(Modal|Dialog|Sheet|Drawer|ConfirmDialog|Popover)$/.test(node.tag)) overlays.push({ id: `OVERLAY-${overlays.length + 1}`, file: sourceFile, line, tag: node.tag, title: prop(node, 'title'), condition, handlers })
      if (['input', 'textarea', 'select', 'Input', 'Textarea', 'Select', 'NativeSelect', 'Checkbox', 'Switch', 'RadioGroup', 'Slider', 'Calendar'].includes(node.tag) || model && !['Modal', 'Dialog', 'Sheet', 'Drawer', 'Tabs', 'TabsRoot'].includes(node.tag)) {
        const id = prop(node, 'id')
        const wrapper = [...parents].reverse().find(parent => parent.tag === 'label')
        const label = prop(node, 'aria-label') || labels.get(id) || (wrapper ? text(wrapper) : '') || prop(node, 'placeholder') || model || node.tag
        const required = prop(node, 'required')
        const ariaRequired = prop(node, 'aria-required')
        const nativeType = prop(node, 'type') || node.tag
        const classification = required || ariaRequired || /[*＊]|必填/.test(String(label)) ? (condition ? 'B候选' : 'A候选')
          : nativeType === 'hidden' || prop(node, 'readonly') ? 'D候选'
            : /checkbox|radio|range|color|select/i.test(String(nativeType)) || /Checkbox|Switch|Slider|Select|Calendar/.test(node.tag) ? 'E候选' : 'C候选'
        fields.push({ id: `FIELD-${String(fields.length + 1).padStart(4, '0')}`, file: sourceFile, line, tag: node.tag, model, label, inputId: id, nativeType, required, ariaRequired, classification, condition, details: parents.filter(parent => parent.tag === 'details').map(parent => ({ open: prop(parent, 'open'), summary: text(parent.children?.find(child => child.type === 1 && child.tag === 'summary') || {}) })), submit: [...parents].reverse().find(parent => parent.tag === 'form')?.props.filter(item => item.name === 'on' && item.arg?.content === 'submit').map(item => item.exp?.content).join('; ') || '', handlers, status: '源码已列入；业务必要性/保存/隐藏分支待验' })
      }
      parents = [...parents, node]
    }
    for (const child of node.children || []) visit(child, parents)
  }
  visit(ast)
}
const report = { fileCount, fields, forms, overlays }
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2))
if (markdownPath) {
  const escape = value => String(value || '—').replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/\s+/g, ' ')
  const lines = ['# V5 全量表单、隐藏字段与浮层源码索引', '', `扫描当前 ${fileCount} 个业务 Vue 模板，识别 ${fields.length} 个原生/自定义输入定义、${forms.length} 个 form 定义和 ${overlays.length} 个基础浮层调用。循环按源码定义计数，不代表运行实例数量。`, '', '候选 A/B/C/D/E 仅来自 UI 标记与控件形状，用于排查，不是最终业务规则。JS/服务端校验可能更严格；尚未人工追踪的字段必须保持待验。阶段状态、真实规则、问题与验证记录见 V5_STATUS.md。', '']
  for (const file of [...new Set(fields.map(field => field.file))]) {
    lines.push(`## ${file}`, '', '| ID | 行/控件 | 名称 | 模型 | 规则候选 | 显示条件/折叠 | 提交入口 | 状态 |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const field of fields.filter(field => field.file === file)) lines.push(`| ${field.id} | ${field.line} / ${field.tag} | ${escape(field.label)} | ${escape(field.model)} | ${field.classification} | ${escape([field.condition, ...field.details.map(detail => `${detail.summary}，open=${detail.open || '默认折叠'}`)].filter(Boolean).join('；'))} | ${escape(field.submit || field.handlers)} | ${field.status} |`)
    lines.push('')
  }
  lines.push('## 表单与浮层提交/关闭入口', '', '| ID | 文件:行 | 类型/标题 | 事件 | 条件 |', '| --- | --- | --- | --- | --- |')
  for (const item of [...forms, ...overlays]) lines.push(`| ${item.id} | ${item.file}:${item.line} | ${escape(item.title || item.tag || 'form')} | ${escape(item.handlers)} | ${escape(item.condition)} |`)
  await writeFile(markdownPath, lines.join('\n') + '\n')
}
console.log(JSON.stringify({ files: fileCount, fields: fields.length, forms: forms.length, overlays: overlays.length }))
