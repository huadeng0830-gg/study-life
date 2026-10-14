import { describe, expect, it } from 'vitest'
import { activeNoticeReminders, normalizeNoticeRecord, summarizeNoticeSources, visibleNoticeRecords } from '../src/composables/noticeArchiveModel.js'

const sample = (id, status, source = '虚构课程群', extra = {}) => ({
  id, raw: `虚构通知内容 ${id}`, title: `通知 ${id}`, source, topic: '作业', status,
  createdAt: '2026-10-02T10:00:00.000Z', needsAction: status === 'new', ...extra,
})

describe('notice archive model', () => {
  it('normalizes old snapshots with missing fields and unknown states', () => {
    expect(normalizeNoticeRecord({ id: 'old', raw: '虚构原文' })).toMatchObject({ status: 'new', source: '', topic: '通知', linkedEntityId: '' })
    expect(normalizeNoticeRecord({ id: 'old', status: 'future' }).status).toBe('new')
  })

  it('preserves the legacy entity link and supports additional linked offers', () => {
    expect(normalizeNoticeRecord({ id: 'linked', linkedEntityType: 'task', linkedEntityId: 'task-1' }).linkedEntities)
      .toEqual([{ type: 'task', id: 'task-1' }])
    expect(normalizeNoticeRecord({ id: 'linked', linkedEntityType: 'task', linkedEntityId: 'task-1', linkedEntities: [{ type: 'task', id: 'task-1' }, { type: 'place-offer', id: 'offer-1' }] }).linkedEntities)
      .toEqual([{ type: 'task', id: 'task-1' }, { type: 'place-offer', id: 'offer-1' }])
  })

  it('keeps only new, unmuted sources in the reminder queue', () => {
    const rows = [sample('new', 'new'), sample('done', 'handled'), sample('hidden', 'archived', '静音群'), sample('other', 'new', '其它群')]
    expect(activeNoticeReminders(rows, [{ source: '静音群', muted: true }]).map((item) => item.id)).toEqual(['new', 'other'])
  })

  it('hides archived records by default and restores them in the archived filter', () => {
    const rows = [sample('new', 'new'), sample('done', 'handled'), sample('old', 'archived')]
    expect(visibleNoticeRecords(rows).map((item) => item.id)).toEqual(['new', 'done'])
    expect(visibleNoticeRecords(rows, { status: 'archived' }).map((item) => item.id)).toEqual(['old'])
  })

  it('summarizes this month by source and keeps action counts separate', () => {
    const rows = [sample('a', 'handled'), sample('b', 'new', '虚构课程群', { needsAction: false }), sample('c', 'new', '虚构课程群', { createdAt: '2026-09-30T23:00:00.000Z' })]
    expect(summarizeNoticeSources(rows, [{ source: '屏蔽空群', muted: true }], '2026-10')).toEqual([
      { source: '屏蔽空群', muted: true, monthCount: 0, actionCount: 0 },
      { source: '虚构课程群', muted: false, monthCount: 2, actionCount: 1 },
    ])
  })
})
