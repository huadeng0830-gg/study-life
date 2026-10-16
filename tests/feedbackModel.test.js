import { describe, expect, it } from 'vitest'
import { feedbackValidation } from '../src/composables/feedbackModel.js'

describe('feedback handling rules', () => {
  const form = { status: 'pending', reply: '', publicReason: '', reward: '' }
  it.each(['needs_info', 'planned', 'processing', 'resolved'])('requires a public explanation for %s', status => {
    expect(feedbackValidation({ ...form, status })).not.toBe('')
    expect(feedbackValidation({ ...form, status, reply: '虚构处理说明' })).toBe('')
  })
  it.each(['duplicate', 'not_adopted'])('requires a reason for %s', status => {
    expect(feedbackValidation({ ...form, status })).not.toBe('')
    expect(feedbackValidation({ ...form, status, publicReason: '虚构公开说明' })).toBe('')
  })
  it('allows rewards only for resolved feedback and rejects invalid amounts', () => {
    for (const reward of [-1, 21, 1.5, 'invalid']) expect(feedbackValidation({ ...form, status: 'resolved', reply: '已修复', reward })).not.toBe('')
    expect(feedbackValidation({ ...form, status: 'planned', reply: '已计划', reward: 5 })).not.toBe('')
    expect(feedbackValidation({ ...form, status: 'resolved', reply: '已修复', reward: 0 })).toBe('')
  })
})
