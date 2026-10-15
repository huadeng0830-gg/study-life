const OAUTH_PROVIDERS = Object.freeze({ github: 'GitHub', google: 'Google' })

// Public deployment capabilities, never credentials. Enable email delivery only
// after a production SMTP service has actually been configured and tested.
export function getAccountAuthOptions(env = import.meta.env) {
  const providers = [...new Set(String(env?.VITE_ACCOUNT_OAUTH_PROVIDERS || '').split(',').map(value => value.trim()))]
    .filter(id => Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, id))
    .map(id => ({ id, label: OAUTH_PROVIDERS[id] }))
  return {
    providers,
    emailSignup: env?.VITE_ACCOUNT_EMAIL_SIGNUP_ENABLED === 'true',
    emailDelivery: env?.VITE_ACCOUNT_EMAIL_DELIVERY_ENABLED === 'true',
  }
}

export function getPublicApiUrl(env = import.meta.env) {
  const value = String(env?.VITE_PUBLIC_API_URL || '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return url.origin
  } catch { return null }
}
