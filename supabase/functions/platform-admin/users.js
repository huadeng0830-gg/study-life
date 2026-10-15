export function publicAccount(user, admins) {
  const suspended = Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now())
  const email = String(user.email || '').trim().toLowerCase()
  const emailVerifiedAt = email.endsWith('@wechat.study-life.invalid') ? null : user.email_confirmed_at || null
  return {
    id: user.id,
    email: user.email || '',
    createdAt: user.created_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    emailVerifiedAt,
    status: suspended ? 'suspended' : emailVerifiedAt ? 'active' : 'unverified',
    platformOwner: admins.has(user.id),
  }
}

async function usersPage(client, page, perPage) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage })
  if (error) throw error
  return Array.isArray(data?.users) ? data.users : []
}

export async function countAuthUsers(client, { pageSize = 1000, maxPages = 50 } = {}) {
  let scanned = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const users = await usersPage(client, page, pageSize)
    scanned += users.length
    if (users.length < pageSize) return { count: scanned, scanned, truncated: false }
  }

  const moreUsers = await usersPage(client, maxPages + 1, 1)
  const truncated = moreUsers.length > 0
  return { count: truncated ? null : scanned, scanned, truncated }
}

export async function searchAuthUsers(client, { query, requestedPage, admins, pageSize = 1000, maxPages = 50, resultPageSize = 25 }) {
  const normalized = query.toLowerCase()
  const firstResult = (requestedPage - 1) * resultPageSize
  let total = 0
  const matches = []
  let scannedAll = false

  for (let page = 1; page <= maxPages; page += 1) {
    const users = await usersPage(client, page, pageSize)
    for (const user of users) {
      if (!String(user.email || '').toLowerCase().includes(normalized)) continue
      if (total >= firstResult && matches.length < resultPageSize) matches.push(publicAccount(user, admins))
      total += 1
    }
    if (users.length < pageSize) {
      scannedAll = true
      break
    }
  }

  let truncated = !scannedAll
  if (truncated) truncated = (await usersPage(client, maxPages + 1, 1)).length > 0
  return { users: matches, page: requestedPage, pageSize: resultPageSize, total, truncated }
}
