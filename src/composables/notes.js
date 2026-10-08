export function noteText(note) {
  return String(note?.content || note?.note || note?.title || '').trim()
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value) {
  return escapeHtml(value).replace(/`[^`\n]+`|\*\*[^*\n]+\*\*/g, (segment) => (
    segment.startsWith('`')
      ? `<code>${segment.slice(1, -1)}</code>`
      : `<strong>${segment.slice(2, -2)}</strong>`
  ))
}

/**
 * 渲染笔记中常用的轻量 Markdown：标题、段落、列表、行内代码、粗体和 fenced code block。
 * 用户原文先完整转义，再只拼接本函数生成的固定标签；不会把笔记里的 HTML 当成页面标记执行。
 */
export function renderNoteMarkdown(value) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let paragraph = []
  let listTag = ''
  let listItems = []
  let codeLines = []
  let inCode = false

  const flushParagraph = () => {
    if (!paragraph.length) return
    output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!listTag) return
    output.push(`<${listTag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listTag}>`)
    listTag = ''
    listItems = []
  }
  const flushCode = () => {
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = []
    inCode = false
  }

  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) flushCode()
      else codeLines.push(line)
      continue
    }
    if (/^\s*```/.test(line)) {
      flushParagraph()
      flushList()
      inCode = true
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim())
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      flushParagraph()
      const nextTag = unordered ? 'ul' : 'ol'
      if (listTag && listTag !== nextTag) flushList()
      listTag = nextTag
      listItems.push((unordered || ordered)[1])
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  if (inCode) flushCode()
  return output.join('')
}

export function filterNotes(notes, query = '', { includeArchived = false } = {}) {
  const keyword = String(query || '').trim().toLowerCase()
  return (Array.isArray(notes) ? notes : [])
    .filter((note) => includeArchived || !note?.archivedAt)
    .filter((note) => {
      if (!keyword) return true
      return `${note?.title || ''} ${noteText(note)} ${(note?.tags || []).join(' ')}`.toLowerCase().includes(keyword)
    })
    .sort((left, right) => String(right?.updatedAt || right?.createdAt || '').localeCompare(String(left?.updatedAt || left?.createdAt || '')))
}
