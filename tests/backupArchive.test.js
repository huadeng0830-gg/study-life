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
      version: 12,
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
