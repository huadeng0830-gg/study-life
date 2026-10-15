import { accountUser } from './accountAuth.js'

export function hasVerifiedContactEmail(user = accountUser.value) {
  const email = String(user?.email || '').trim().toLowerCase()
  return Boolean(user?.email_confirmed_at && email && !email.endsWith('@wechat.study-life.invalid'))
}
