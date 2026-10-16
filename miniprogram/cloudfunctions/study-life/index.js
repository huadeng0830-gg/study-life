const cloud = require('wx-server-sdk')
const { createService } = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  // 身份只取自微信云调用上下文，绝不信任 event 中的 openid、角色或 userId。
  const identity = cloud.getWXContext()
  const service = createService({
    db: cloud.database(),
    appId: 'wx4377be9f658a4c7d',
    ownerIds: (process.env.OWNER_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean),
    checkText: async (content) => {
      const result = await cloud.openapi.security.msgSecCheck({ openid: identity.OPENID, scene: 2, version: 2, content })
      return result.result?.suggest === 'pass'
    },
  })
  return service(event, identity)
}
