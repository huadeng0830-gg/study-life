export function noteText(note) {
  return String(note?.content || note?.note || note?.title || '').trim()
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
