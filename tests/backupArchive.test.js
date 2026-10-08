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
  it('从持久化快照读取已有记录并为缺失字段填入兼容默认值', () => {
    const courses = [{ id: 'course-1', name: '虚构课程' }]
    const tasks = [{ id: 'task-1', title: '虚构任务' }]
    const snapshot = createBackupSnapshot(memoryStorage({
      sl_courses: JSON.stringify(courses),
      sl_tasks: JSON.stringify(tasks),
      sl_exams: 'null',
    }))

    expect(snapshot).toMatchObject({
      app: 'study-life',
      version: 11,
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
