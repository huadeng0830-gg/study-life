// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { completeBackupArchive, createBackupArchiveParts, createBackupSnapshot, parseBackupArchive } from '../src/composables/backupArchive.js'

function memoryStorage(values = {}) {
  return {
    getItem(key) {
      return Object.hasOwn(values, key) ? values[key] : null
    },
  }
}

describe('本机备份文件格式', () => {
  it('存储不可用时停止备份，不以默认值生成空文件', () => {
    expect(() => createBackupSnapshot(null)).toThrow('本机存储不可用')
  })
  it('可选分区的错误类型不会被静默转成空记录', async () => {
    await expect(parseBackupArchive({ app: 'study-life', version: 1, data: { courses: [], countdowns: [], tasks: 'invalid' } })).rejects.toThrow('待办与快速记录格式不正确')
  })

  it('可选分区的 null 不会被兼容默认值变成覆盖操作', async () => {
    const parsed = await parseBackupArchive({ app: 'study-life', version: 1, data: { courses: [], countdowns: [], tasks: null } })
    expect(parsed.providedFields).not.toContain('tasks')
  })
  it('从持久化快照读取已有记录并为缺失字段填入兼容默认值', () => {
    const courses = [{ id: 'course-1', name: '虚构课程' }]
    const tasks = [{ id: 'task-1', title: '虚构任务', workCheckpoint: { lastStep: '整理资料', nextStep: '完成报告', resources: ['https://example.com/'] } }]
    const snapshot = createBackupSnapshot(memoryStorage({
      sl_courses: JSON.stringify(courses),
      sl_tasks: JSON.stringify(tasks),
      sl_exams: 'null',
    }))

    expect(snapshot).toMatchObject({
      app: 'study-life',
      version: 16,
      schema: 'study-life.backup/v1',
      data: {
        courses,
        countdowns: [],
        tasks,
        events: [],
        theme: 'blue',
      },
    })
    expect(Number.isNaN(Date.parse(snapshot.exportedAt))).toBe(false)
    expect(snapshot).not.toHaveProperty('checksum')
  })

  it('通知原文和来源设置可以完整备份、校验并恢复', async () => {
    const notices = [{ id: 'notice-fictional-1', raw: '虚构通知：周五交实验报告', source: '虚构课程群', title: '实验报告', topic: '作业', status: 'handled', createdAt: '2026-10-01T08:00:00.000Z' }]
    const noticeSources = [{ id: 'source-fictional-1', source: '虚构课程群', muted: true }]
    const snapshot = createBackupSnapshot(memoryStorage({ sl_notices: JSON.stringify(notices), sl_notice_sources: JSON.stringify(noticeSources) }))
    const parsed = await parseBackupArchive(await completeBackupArchive(snapshot))

    expect(parsed.providedFields).toContain('notices')
    expect(parsed.providedFields).toContain('noticeSources')
    expect(parsed.data.notices).toMatchObject(notices)
    expect(parsed.data.noticeSources).toEqual(noticeSources)
  })

  it('体检阈值跟随本机备份往返，旧备份缺省时不覆盖已有设置', async () => {
    const settings = { staleTaskDays: 120, unhandledNoticeDays: 45, maxTransactionAmount: 80000 }
    const snapshot = createBackupSnapshot(memoryStorage({ sl_data_health_settings: JSON.stringify(settings) }))
    const parsed = await parseBackupArchive(await completeBackupArchive(snapshot))

    expect(parsed.data.dataHealthSettings).toEqual(settings)
    expect(parsed.providedFields).toContain('dataHealthSettings')

    const legacy = await parseBackupArchive(await completeBackupArchive({
      app: 'study-life', version: 14, schema: 'study-life.backup/v1', ownerId: '',
      data: { courses: [], countdowns: [], __owner_id: '' },
    }))
    expect(legacy.data.dataHealthSettings).toBeNull()
    expect(legacy.providedFields).not.toContain('dataHealthSettings')
  })

  it('地点、到访和优惠在本机备份、校验和恢复中完整往返', async () => {
    const places = [{ id: 'place-fiction-1', name: '虚构面馆', campus: '虚构校区', area: '北苑', placeHint: '食堂二楼', category: 'food', ratingTemplateId: 'food', scores: { value: 'worth', portion: 'large' }, note: '虚构备注', visibility: 'private', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', archivedAt: null }]
    const placeVisits = [{ id: 'visit-fiction-1', placeId: 'place-fiction-1', visitedAt: '2026-10-02T12:00:00.000Z', price: 18, scores: { value: 'worth', portion: 'large' }, transactionId: 'expense-fiction-1', createdAt: '2026-10-02T12:00:00.000Z' }]
    const placeOffers = [{ id: 'offer-fiction-1', placeId: 'place-fiction-1', title: '虚构午餐券', note: '虚构优惠说明', price: 12, originalPrice: 18, expiresAt: '2026-12-31', status: 'active', transactionId: '', noticeId: '', createdAt: '2026-10-03T12:00:00.000Z' }]
    const archive = await completeBackupArchive(createBackupSnapshot(memoryStorage({
      sl_places: JSON.stringify(places),
      sl_place_visits: JSON.stringify(placeVisits),
      sl_place_offers: JSON.stringify(placeOffers),
    })))
    const parsed = await parseBackupArchive(archive)

    expect(parsed.providedFields).toEqual(expect.arrayContaining(['places', 'placeVisits', 'placeOffers']))
    expect(parsed.data.places).toEqual(places)
    expect(parsed.data.placeVisits).toEqual(placeVisits)
    expect(parsed.data.placeOffers).toEqual(placeOffers)
  })

  it('旧备份缺少通知分区时填默认值但不把空值加入恢复范围', async () => {
    const legacyArchive = await completeBackupArchive({
      app: 'study-life',
      version: 13,
      schema: 'study-life.backup/v1',
      ownerId: '',
      data: { courses: [], countdowns: [], __owner_id: '' },
    })
    const parsed = await parseBackupArchive(legacyArchive)
    expect(parsed.data.notices).toEqual([])
    expect(parsed.data.noticeSources).toEqual([])
    expect(parsed.providedFields).not.toContain('notices')
    expect(parsed.providedFields).not.toContain('noticeSources')
  })

  it('持久化 JSON 损坏时停止导出并保留原始值', () => {
    const raw = '{invalid json'
    const storage = memoryStorage({ sl_events: raw })
    expect(() => createBackupSnapshot(storage)).toThrow('JSON 内容损坏')
    expect(storage.getItem('sl_events')).toBe(raw)
  })

  it('本机记录类型错误时不会导出无法恢复的备份', () => {
    const raw = '{"invalid":"shape"}'
    const storage = memoryStorage({ sl_tasks: raw })
    expect(() => createBackupSnapshot(storage)).toThrow('已停止导出')
    expect(storage.getItem('sl_tasks')).toBe(raw)
  })

  it('封存后可重新校验，且保留来源数据', async () => {
    const snapshot = createBackupSnapshot(memoryStorage({
      sl_courses: JSON.stringify([{ id: 'course-1' }]),
      sl_exams: '[]',
    }))
    const archive = await completeBackupArchive(snapshot)
    const parsed = await parseBackupArchive(archive)

    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(parsed.providedFields).toContain('courses')
    expect(parsed.providedFields).toContain('countdowns')
    expect(parsed.data.courses).toEqual([{ id: 'course-1' }])
    expect(snapshot).not.toHaveProperty('checksum')
  })

  it('备份来源账号与校验和覆盖的来源标记不一致时拒绝导入', async () => {
    const snapshot = createBackupSnapshot(memoryStorage({
      'study-life-data-owner': 'fictional-account-a',
      sl_courses: '[]',
      sl_exams: '[]',
    }))
    const archive = await completeBackupArchive(snapshot)

    await expect(parseBackupArchive({ ...archive, ownerId: 'fictional-account-b' }))
      .rejects.toThrow('来源账号信息不一致')
    expect((await parseBackupArchive(archive)).ownerId).toBe('fictional-account-a')
  })

  it('数据在封存后被改动时拒绝导入', async () => {
    const archive = await completeBackupArchive({
      app: 'study-life',
      version: 10,
      schema: 'study-life.backup/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      data: { courses: [], countdowns: [] },
    })

    await expect(parseBackupArchive({
      ...archive,
      data: { courses: [{ id: 'tampered' }], countdowns: [] },
    })).rejects.toThrow('校验失败')
  })

  it('导出分片仍组成可校验的归档 JSON', async () => {
    const snapshot = {
      app: 'study-life', version: 10, schema: 'study-life.backup/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      data: { courses: [{ id: 'course-1' }], countdowns: [], tasks: Array.from({ length: 3 }, (_, id) => ({ id })) },
    }
    const parts = await createBackupArchiveParts(snapshot)
    const archive = JSON.parse(parts.join(''))
    const parsed = await parseBackupArchive(archive)

    expect(parts).toHaveLength(3)
    expect(parsed.data.tasks).toEqual(snapshot.data.tasks)
    expect(archive.checksum).toMatch(/^[a-f0-9]{64}$/)
  })
})
