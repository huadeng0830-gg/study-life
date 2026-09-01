// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assembleFrames,
  createTransferPackage,
  decryptTransfer,
  encryptTransfer,
  importTransferPackage,
  parseFrame,
  restoreTransferUndo,
  splitIntoFrames,
} from '../src/composables/localTransfer.js'

const PASSWORD = 'password123'

describe('二维码分帧', () => {
  it('分帧后可完整还原', () => {
    const payload = 'A'.repeat(2000)
    const frames = splitIntoFrames(payload)
    expect(frames.length).toBe(Math.ceil(2000 / 720))
    const map = new Map()
    for (const frame of frames) {
      const parsed = parseFrame(frame)
      map.set(parsed.index, parsed)
    }
    expect(assembleFrames(map)).toBe(payload)
  })

  it('无法识别的字符串被拒绝', () => {
    expect(() => parseFrame('hello')).toThrow()
  })

  it('缺少分片时返回 null 而不是报错', () => {
    const frames = splitIntoFrames('B'.repeat(1500))
    const map = new Map()
    for (const frame of frames.slice(0, -1)) {
      const parsed = parseFrame(frame)
      map.set(parsed.index, parsed)
    }
    expect(assembleFrames(map)).toBeNull()
  })
})

describe('加密迁移码', () => {
  it('加解密往返一致', async () => {
    const pkg = { app: 'study-life', version: 2, data: { sl_tasks: [{ id: 't1' }] } }
    const payload = await encryptTransfer(pkg, PASSWORD)
    const decoded = await decryptTransfer(payload, PASSWORD)
    expect(decoded).toEqual(pkg)
  })

  it('密码错误时抛出友好错误', async () => {
    const payload = await encryptTransfer({ app: 'x' }, PASSWORD)
    await expect(decryptTransfer(payload, 'wrong-password')).rejects.toThrow('无法解密')
  })

  it('短密码在加密前被拒绝', async () => {
    await expect(encryptTransfer({ app: 'x' }, 'short')).rejects.toThrow('8 个字符')
  })
})

describe('导入与撤销', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('覆盖模式替换数据并支持撤销', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'old', title: '旧任务' }]))
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['tasks'],
      data: { sl_tasks: [{ id: 'new1' }, { id: 'new2' }] },
    }

    const result = await importTransferPackage(pkg, 'replace')
    expect(result.affected).toBe(1)
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toHaveLength(2)

    expect(await restoreTransferUndo()).toBe(true)
    const restored = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('old')
  })

  it('合并模式对数组去重追加', async () => {
    localStorage.setItem(
      'sl_tasks',
      JSON.stringify([{ id: 'a', title: '相同' }, { id: 'b', title: '本地独有' }])
    )
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['tasks'],
      data: { sl_tasks: [{ id: 'a', title: '相同' }, { id: 'c', title: '新任务' }] },
    }

    const result = await importTransferPackage(pkg, 'merge')
    const tasks = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(tasks.map((task) => task.id)).toEqual(['a', 'b', 'c'])
    expect(result.added).toBe(1)
  })

  it('合并快速记录设置时保持对象结构并合并最近类型', async () => {
    localStorage.setItem('sl_quick_record_settings', JSON.stringify({
      clipboardHint: false,
      recentTypes: ['todo', 'note'],
    }))
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['tasks'],
      data: {
        sl_quick_record_settings: { clipboardHint: true, recentTypes: ['event', 'todo'] },
      },
    }

    await importTransferPackage(pkg, 'merge')
    expect(JSON.parse(localStorage.getItem('sl_quick_record_settings'))).toEqual({
      clipboardHint: false,
      recentTypes: ['todo', 'note', 'event'],
    })
    expect(localStorage.getItem('study_life_last_local_change')).toBeTruthy()
  })

  it('账本分类按 key 合并，不会产生重复分类键', async () => {
    localStorage.setItem('sl_ledger_categories', JSON.stringify([
      { key: 'food', name: '我的餐饮', icon: '🥗', hidden: true },
    ]))
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['expenses'],
      data: {
        sl_ledger_categories: [
          { key: 'food', name: '餐饮', icon: '🍜', hidden: false },
          { key: 'study', name: '学习', icon: '📚', hidden: false },
        ],
      },
    }

    await importTransferPackage(pkg, 'merge')
    const categories = JSON.parse(localStorage.getItem('sl_ledger_categories'))
    expect(categories.filter((item) => item.key === 'food')).toEqual([
      { key: 'food', name: '我的餐饮', icon: '🥗', hidden: true },
    ])
    expect(categories.find((item) => item.key === 'study')).toBeTruthy()
  })

  it('中途取消会自动恢复导入前数据，不留下半次导入', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'old-task' }]))
    localStorage.setItem('sl_exams', JSON.stringify([{ id: 'old-exam' }]))
    const controller = new AbortController()
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['tasks', 'countdowns'],
      data: {
        sl_tasks: [{ id: 'new-task' }],
        sl_exams: [{ id: 'new-exam' }],
      },
    }

    const pending = importTransferPackage(pkg, 'replace', {
      signal: controller.signal,
      onProgress: ({ stage, current }) => {
        if (stage === 'data' && current === 1) controller.abort()
      },
    })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'old-task' }])
    expect(JSON.parse(localStorage.getItem('sl_exams'))).toEqual([{ id: 'old-exam' }])
    expect(localStorage.getItem('sl_transfer_undo')).toBeNull()
  })

  it('非法包被拒绝', async () => {
    await expect(importTransferPackage({ app: 'other', version: 2 }, 'replace')).rejects.toThrow()
  })

  it('损坏的数据形状在写入前被拒绝，且不改动本机数据', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'safe' }]))
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: ['tasks'],
      data: { sl_tasks: { 0: { id: 'broken' } } },
    }
    await expect(importTransferPackage(pkg, 'replace')).rejects.toThrow('格式异常')
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'safe' }])
    expect(localStorage.getItem('sl_transfer_undo')).toBeNull()
  })

  it('迁移包不能写入项目未声明的存储键', async () => {
    const pkg = {
      app: 'study-life',
      version: 2,
      modules: [],
      data: { sl_unknown_private_key: { enabled: true } },
    }
    await expect(importTransferPackage(pkg, 'replace')).rejects.toThrow('不受支持')
    expect(localStorage.getItem('sl_unknown_private_key')).toBeNull()
  })

  it('打包器只收集所选模块的键', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([]))
    localStorage.setItem('sl_focus_sessions', JSON.stringify([{ id: 'f1' }]))
    localStorage.setItem('sl_bills', JSON.stringify([{ id: 'bill1' }]))
    const pkg = await createTransferPackage(['tasks'])
    expect(Object.keys(pkg.data)).toEqual(['sl_tasks'])
    expect(pkg.app).toBe('study-life')
    expect(pkg.version).toBe(2)

    const focus = await createTransferPackage(['focus'])
    expect(focus.data.sl_focus_sessions).toEqual([{ id: 'f1' }])
  })
})
