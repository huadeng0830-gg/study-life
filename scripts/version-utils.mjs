// 版本号的纯函数：被 scripts/bump-release.mjs 使用，并有单元测试覆盖。
// 版本格式沿用既有约定：YYYY年MM月DD日-版本N，同日发布递增序号。

/**
 * 一条版本说明的最短长度。
 *
 * 与 `tests/releaseNotes.test.js` 里断言的 12 个字符是同一条契约：更新弹窗里
 * 一行说明太短就只是占位噪音。放在这里是为了让 bump 脚本能在**写入之前**拦下来，
 * 而不是等测试报红。
 */
export const MIN_RELEASE_NOTE_LENGTH = 12

export function formatDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  const d = date instanceof Date ? date : new Date()
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
}

// 依据现有版本条目计算下一个版本号：同一天则序号 +1，跨天则从版本1 重新开始。
export function nextVersion(entries, now = new Date()) {
  const first = Array.isArray(entries) && entries.length ? entries[0] : null
  const version = first?.version || ''
  const match = /^(\d{4}年\d{2}月\d{2}日)-版本(\d+)$/.exec(version)
  const today = formatDateKey(now)
  if (match && match[1] === today) return `${today}-版本${Number(match[2]) + 1}`
  return `${today}-版本1`
}

/**
 * 把内容归一为 LF 进行结构匹配，并记住原文件用的换行符以便写回时还原。
 *
 * 【为什么需要】本文件的结构识别全部靠 '\n' 字面量与 /^  \{\n…$/gm 这类正则。
 * Windows 上 core.autocrlf=true（且本仓库没有强制工作区换行的设置）会让检出的
 * release.config.js 变成 CRLF，于是 header 的 indexOf 恒为 -1、条目正则恒不匹配。
 * 后果不是报错而是**静默失效**：trimReleaseUpdates 原样返回（它本是用来防止
 * 历史条目堆到 150 条 / 127KB 的），插入分支则"没插入却照样同步签名并打印成功"——
 * 也就是发布说明被丢掉、构建却变绿，正是这道闸门本该拦住的事。
 *
 * @param {string} content
 * @returns {{ lf: string, eol: string }} lf 为归一后的内容，eol 为原换行符
 */
export function normalizeForStructure(content) {
  const text = String(content ?? '')
  return { lf: text.replace(/\r\n/g, '\n'), eol: text.includes('\r\n') ? '\r\n' : '\n' }
}

/** 把按 LF 构造出来的新内容还原成目标文件原本的换行符。 */
export function applyEol(content, eol) {
  return eol === '\r\n' ? String(content).replace(/\n/g, '\r\n') : String(content)
}

/** 把说明数组渲染成 `notes: [` 里的若干行（转义规则只有这一处）。 */
export function noteLines(notes) {
  return (Array.isArray(notes) ? notes : [])
    .filter(Boolean)
    .map((note) => `      '${String(note).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}',`)
    .join('\n')
}

// 构造一条新的 RELEASE_UPDATES 条目文本（signature 留空，写入前由脚本填入）。
export function buildReleaseEntry(version, notes) {
  return `  {\n    version: '${String(version).replace(/'/g, "\\'")}',\n    signature: '',\n    notes: [\n${noteLines(notes)}\n    ],\n  },\n`
}

/** 更新弹窗最多展示的历史条数；与 release.config.js 头注释、releaseNotes.js 的 MAX_SHOWN 对齐。 */
export const MAX_RELEASE_ENTRIES = 3

/**
 * 把 RELEASE_UPDATES 裁到最多 max 条（保留最新的在顶部）。
 *
 * 【为什么需要】release.config.js 曾堆积 150 个版本条目（约 127KB），整文件被
 * releaseNotes.js 静态 import 进首屏 chunk；应用实际只展示最近 3 条。
 * bump 脚本每次插入新条目后调用本函数，避免历史再次无限增长。
 *
 * @param {string} content release.config.js 全文
 * @param {number} [max=MAX_RELEASE_ENTRIES]
 * @returns {string} 裁剪后的内容；结构不符或未超限时原样返回
 */
export function trimReleaseUpdates(content, max = MAX_RELEASE_ENTRIES) {
  const { lf, eol } = normalizeForStructure(content)
  const header = 'export const RELEASE_UPDATES = Object.freeze([\n'
  const start = lf.indexOf(header)
  if (start === -1) return String(content ?? '')
  const bodyStart = start + header.length
  const end = lf.indexOf('\n])', bodyStart)
  if (end === -1) return String(content ?? '')
  const body = lf.slice(bodyStart, end)
  const matches = [...body.matchAll(/^  \{\n[\s\S]*?^  \},$/gm)]
  if (matches.length <= max) return String(content ?? '')
  const kept = matches.slice(0, max).map((match) => match[0]).join('\n')
  return applyEol(lf.slice(0, bodyStart) + kept + lf.slice(end), eol)
}

/**
 * 检查一组版本说明是否可以写入。
 *
 * 【为什么需要】说明是**手写并经由 shell 传参**的，而 shell 的引号规则很容易把
 * 文本弄坏：实测把 `--notes "\"/\" 打开全局搜索…"` 传进去，PowerShell 只留下了
 * 一个 `\`，脚本照写不误，直到 `tests/releaseNotes.test.js` 才报红。
 * 与其让坏文本进仓库再靠测试兜，不如在写入前就拒绝。
 *
 * @param {string[]} notes
 * @returns {string[]} 问题列表；空数组表示通过
 */
export function validateReleaseNotes(notes) {
  const problems = []
  const list = Array.isArray(notes) ? notes : []
  if (!list.length) problems.push('至少需要一条版本说明')
  list.forEach((note, index) => {
    const text = typeof note === 'string' ? note : ''
    const position = `第 ${index + 1} 条说明`
    if (text.trim().length < MIN_RELEASE_NOTE_LENGTH) {
      problems.push(`${position}太短：${JSON.stringify(text)}（至少 ${MIN_RELEASE_NOTE_LENGTH} 个字符）`)
    }
    // 被 shell 转义弄坏的两种典型痕迹：整条只剩反斜杠，或者平白多出 \" 。
    if (/^\s*\\+\s*$/.test(text)) problems.push(`${position}只剩反斜杠：${JSON.stringify(text)}，像是引号被 shell 吃掉了`)
    else if (text.includes('\\"')) problems.push(`${position}含 \\" ：${JSON.stringify(text)}，像是转义被 shell 弄坏了`)
  })
  return problems
}

/**
 * 只替换 RELEASE_UPDATES **顶部**（当前版本）那条的说明，不新增版本。
 *
 * 用于修正已经写坏的说明：说明本身参与源码签名，所以调用方拿到新内容后
 * 必须照常重算签名（bump-release.mjs 的第 2、3 步是共用的）。
 *
 * @returns {string|null} 新内容；结构不符合预期时返回 null（调用方据此报错退出）
 */
export function replaceCurrentNotes(content, notes) {
  const { lf, eol } = normalizeForStructure(content)
  const header = 'RELEASE_UPDATES = Object.freeze([\n'
  const headerAt = lf.indexOf(header)
  if (headerAt === -1) return null
  const entryStart = headerAt + header.length
  const entryEnd = lf.indexOf('\n  },\n', entryStart)
  if (entryEnd === -1) return null
  const entry = lf.slice(entryStart, entryEnd)
  const blockStart = entry.indexOf('notes: [')
  if (blockStart === -1) return null
  // 说明块的结尾是缩进 4 空格的 `],`；只认第一处，正是当前版本那条。
  const blockEnd = entry.indexOf('\n    ]', blockStart)
  if (blockEnd === -1) return null
  const replaced = `${entry.slice(0, blockStart)}notes: [\n${noteLines(notes)}\n    ]${entry.slice(blockEnd + '\n    ]'.length)}`
  return applyEol(lf.slice(0, entryStart) + replaced + lf.slice(entryEnd), eol)
}