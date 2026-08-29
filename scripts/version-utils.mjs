// 版本号的纯函数：被 scripts/bump-release.mjs 使用，并有单元测试覆盖。
// 版本格式沿用既有约定：YYYY年MM月DD日-版本N，同日发布递增序号。

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

// 构造一条新的 RELEASE_UPDATES 条目文本（signature 留空，写入前由脚本填入）。
export function buildReleaseEntry(version, notes) {
  const lines = (Array.isArray(notes) ? notes : []).filter(Boolean)
    .map((note) => `      '${String(note).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    .join('\n')
  return `  {\n    version: '${String(version).replace(/'/g, "\\'")}',\n    signature: '',\n    notes: [\n${lines}\n    ],\n  },\n`
}