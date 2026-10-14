import { describe, expect, it } from 'vitest'
import { campusNotificationRoute } from '../src/composables/campusContentModel.js'

describe('campus notification destinations', () => {
  it('opens the receiving inbox for a shared place and own places for moderation', () => {
    expect(campusNotificationRoute({ kind: 'place_preset' })).toBe('/campus?section=invites')
    expect(campusNotificationRoute({ kind: 'campus_place_reviewed' })).toBe('/campus?section=mine')
  })
  it('opens personal results for content and report decisions', () => {
    expect(campusNotificationRoute({ kind: 'campus_content_reviewed' })).toBe('/campus/mine')
    expect(campusNotificationRoute({ kind: 'campus_report_reviewed' })).toBe('/campus/reports')
  })
})
