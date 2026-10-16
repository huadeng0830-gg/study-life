const { normalize, KINDS } = require('./record-model')
const { fail, hash, id } = require('./rules')
const COLLECTION = 'sl_personal_records'
function createPersonal({ store, registered, stamp }) {
  return async function personal(actor, action, payload) {
    if (action === 'list') {
      const page = Number.isSafeInteger(payload.page) ? payload.page : 0
      if (page < 0 || page > 10000) fail('invalid_input', '页码无效。')
      const rows = await store.list(COLLECTION, { user_id: actor }, { order: 'id', direction: 'asc', offset: page * 80, limit: 81 })
      return { records: rows.slice(0, 80).map(({ _id, user_id, ...row }) => row), hasMore: rows.length > 80 }
    }
    if (action !== 'commit') fail('invalid_action', '个人记录操作无效。')
    const operations = payload.operations
    if (!Array.isArray(operations) || !operations.length || operations.length > 10) fail('invalid_input', '每次最多保存 10 条记录。')
    const prepared = operations.map(operation => {
      if (!operation || !KINDS.includes(operation.kind)) fail('invalid_input', '记录类型无效。')
      const key = id(operation.id)
      if (!Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 0) fail('invalid_input', '记录版本无效。')
      let values = {}
      try { if (operation.deleted !== true) values = normalize(operation.kind, operation.values) } catch (error) { fail('invalid_input', error.message) }
      if (JSON.stringify(values).length > 16000) fail('invalid_input', '记录内容过长，请拆分后保存。')
      return { id: key, kind: operation.kind, values, expectedRevision: operation.expectedRevision, mutationId: id(operation.mutationId), deleted: operation.deleted === true }
    })
    if (new Set(prepared.map(row => row.id)).size !== prepared.length) fail('invalid_input', '同一次保存不能重复修改同一记录。')
    return store.transaction(async tx => {
      await registered(actor, tx)
      const records = []
      for (const operation of prepared) {
        const documentId = hash(`${actor}:${operation.id}`)
        const previous = await tx.get(COLLECTION, documentId)
        if (previous && previous.kind !== operation.kind) fail('invalid_input', '记录类型不能修改。')
        if (previous?.mutationId === operation.mutationId) { records.push(previous); continue }
        if ((previous?.revision || 0) !== operation.expectedRevision) fail('record_conflict', '其他设备已经修改这条记录，请在更多 → 数据管理中处理冲突。')
        const row = { id: operation.id, user_id: actor, kind: operation.kind, values: operation.values, deleted: operation.deleted, mutationId: operation.mutationId, revision: (previous?.revision || 0) + 1, created_at: previous?.created_at || stamp(), updated_at: stamp() }
        await tx.put(COLLECTION, documentId, row)
        records.push(row)
      }
      return { records: records.map(({ _id, user_id, ...row }) => row) }
    })
  }
}
module.exports = { createPersonal, COLLECTION }
