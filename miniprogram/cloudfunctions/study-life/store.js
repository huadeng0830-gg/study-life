// 统一处理 SDK 文档返回值，同时将数据库操作集中在这一处。
function createStore(db) {
  function access(source = db) {
    return {
      async get(collection, id) {
        try {
          const result = await source.collection(collection).doc(id).get()
          return (Array.isArray(result.data) ? result.data[0] : result.data) || null
        } catch (error) {
          // 仅把文档缺失当作空值；集合缺失、权限和网络错误必须继续抛出。
          if (error.errCode === -1 && /document.*not.*exist/i.test(error.errMsg || error.message || '')) return null
          if (['DATABASE_DOCUMENT_NOT_EXIST', 'DOCUMENT_NOT_FOUND'].includes(error.code)) return null
          throw error
        }
      },
      async put(collection, id, data) {
        const { _id, ...fields } = data
        await source.collection(collection).doc(id).set({ data: fields })
        return { ...fields, _id: id }
      },
    }
  }
  return {
    ...access(),
    async list(collection, where = {}, { limit = 60, offset = 0, order = 'created_at', direction = 'desc' } = {}) {
      const result = await db.collection(collection).where(where).orderBy(order, direction).orderBy('_id', 'asc').skip(offset).limit(limit).get()
      return result.data || []
    },
    in: values => db.command.in(values),
    async transaction(callback) { return db.runTransaction(transaction => callback(access(transaction))) },
  }
}
module.exports = { createStore }
