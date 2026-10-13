import { describe, expect, it, vi } from 'vitest'
import { countAuthUsers, searchAuthUsers } from '../supabase/functions/platform-admin/users.js'

function account(id, email, extra = {}) {
  return { id, email, created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', ...extra }
}

function client(pages) {
  const listUsers = vi.fn(async ({ page, perPage }) => ({
    data: { users: (pages[page] || []).slice(0, perPage) },
    error: null,
  }))
  return { auth: { admin: { listUsers } }, listUsers }
}

describe('platform admin account pagination', () => {
  it('counts accounts from pages instead of inventing a total from one page', async () => {
    const supabase = client({ 1: [account('one', 'one@example.test'), account('two', 'two@example.test')] })
    await expect(countAuthUsers(supabase, { pageSize: 2, maxPages: 2 })).resolves.toEqual({
      count: 2, scanned: 2, truncated: false,
    })
    expect(supabase.listUsers).toHaveBeenCalledTimes(2)
  })

  it('distinguishes an exact scan limit from accounts beyond the scan limit', async () => {
    const exactlyAtLimit = client({
      1: [account('one', 'one@example.test'), account('two', 'two@example.test')],
      2: [account('three', 'three@example.test'), account('four', 'four@example.test')],
    })
    await expect(countAuthUsers(exactlyAtLimit, { pageSize: 2, maxPages: 2 })).resolves.toEqual({
      count: 4, scanned: 4, truncated: false,
    })

    const beyondLimit = client({
      1: [account('one', 'one@example.test'), account('two', 'two@example.test')],
      2: [account('three', 'three@example.test'), account('four', 'four@example.test')],
      3: [account('five', 'five@example.test')],
    })
    await expect(countAuthUsers(beyondLimit, { pageSize: 2, maxPages: 2 })).resolves.toEqual({
      count: null, scanned: 4, truncated: true,
    })
  })

  it('searches case-insensitively, paginates sanitized results, and reports a bounded scan', async () => {
    const supabase = client({
      1: [
        account('one', 'first@Example.test', { user_metadata: { private: 'not returned' } }),
        account('two', 'unrelated@other.test'),
      ],
      2: [account('three', 'second@example.test'), account('four', 'third@example.test')],
      3: [account('five', 'fourth@example.test')],
    })

    const result = await searchAuthUsers(supabase, {
      query: 'EXAMPLE.TEST', requestedPage: 2, admins: new Set(),
      pageSize: 2, maxPages: 2, resultPageSize: 1,
    })

    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 3, truncated: true })
    expect(result.users).toEqual([expect.objectContaining({ id: 'three', email: 'second@example.test' })])
    expect(result.users[0]).not.toHaveProperty('user_metadata')
  })

  it('propagates Auth API failures instead of reporting a partial count as complete', async () => {
    const supabase = client({})
    supabase.auth.admin.listUsers.mockResolvedValueOnce({ data: null, error: new Error('auth unavailable') })
    await expect(countAuthUsers(supabase)).rejects.toThrow('auth unavailable')
  })
})
