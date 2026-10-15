import { describe, expect, it } from 'vitest'
import { getAccountAuthOptions, getPublicApiUrl } from '../src/services/cloudConfig.js'
describe('cloud deployment capabilities', () => {
  it('defaults to existing-account login without promising unavailable email or OAuth', () => {
    expect(getAccountAuthOptions({})).toEqual({ providers: [], emailSignup: false, emailDelivery: false })
    expect(getAccountAuthOptions({ VITE_ACCOUNT_OAUTH_PROVIDERS: 'github,github,unknown,__proto__,google' }).providers.map(item => item.id)).toEqual(['github', 'google'])
  })
  it('accepts only clean HTTPS or loopback API origins', () => {
    expect(getPublicApiUrl({ VITE_PUBLIC_API_URL: 'https://public.example.invalid/' })).toBe('https://public.example.invalid')
    expect(getPublicApiUrl({ VITE_PUBLIC_API_URL: 'http://localhost:8787' })).toBe('http://localhost:8787')
    for (const value of ['http://public.example.invalid', 'https://secret@public.example.invalid', 'https://public.example.invalid/path', 'https://public.example.invalid/?token=fictional', 'javascript:alert(1)']) expect(getPublicApiUrl({ VITE_PUBLIC_API_URL: value })).toBeNull()
  })
})
