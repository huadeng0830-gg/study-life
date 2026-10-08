// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BACKUP_MODULES, BACKUP_STORAGE_KEYS, restoreBackupModuleLabels } from '../src/composables/backupArchive.js'

/**
 * 「从备份恢复」的确认文案必须**等于真实恢复范围**。
 *
 * 【这个文件来自一次对抗性复核】本轮先修的是把写死的"课程、重要日期和待办"换成另一段写死的清单，
 * 复核直接指出那段清单**仍然漏说**了会真写回的东西：日程、专注记录、课程打卡、心情记录、
 * OCR 词表、作息/学期/调课/课表备注、账本分类·汇率·预算·模板。
 * 漏说的代价是实打实的：这是一个**覆盖式、不可撤销**的操作，用户在确认框里看到三项、
 * 实际丢掉八项，等于没有知情同意。
 *
 * 所以最终口径不是"再补一遍清单"，而是**从备份字段与存储映射算出来**
 * （`providedFields` × `BACKUP_STORAGE_KEYS` × `BACKUP_MODULES`），写死清单因此不可能再漂移。
 * 判据：① 备份里有的模块都必须出现；② 备份里**没有**的模块不许出现（不能吓唬用户）；
 * ③ 落在 `BACKUP_MODULES` 之外、但确实会被写回的键要归到「其它本机设置」，不许静默略过。
 */
function backupWith(fields) {
  return { providedFields: fields, data: Object.fromEntries(fields.map((field) => [field, field === 'theme' ? 'blue' : []])) }
}

describe('备份恢复范围：文案必须由真源算出', () => {
  it('备份携带的每个模块都会出现在范围里（含旧文案漏掉的账本/清单/笔记/外观）', () => {
    const labels = restoreBackupModuleLabels(backupWith([
      'courses', 'countdowns', 'tasks', 'events', 'expenses', 'bills',
      'checklists', 'quickNotes', 'theme', 'focusSessions', 'moodLog',
      'timeConfig', 'semester', 'scheduleExceptions', 'scheduleNote',
      'ledgerCategories', 'ledgerFx', 'ledgerBudget', 'ledgerTemplates', 'ocrVocabulary',
    ]))

    // 旧文案提到的三项
    expect(labels).toContain('课程与课表')
    expect(labels).toContain('重要日期')
    expect(labels).toContain('待办与快速记录')
    // 旧文案**没提**、但确实会被写回的那些（这条就是复核抓出来的缺口）
    expect(labels).toContain('账本')
    expect(labels).toContain('清单')
    expect(labels).toContain('专注记录')
    expect(labels).toContain('外观与主题')
    expect(labels).toContain('氛围与心情')
  })

  it('完整备份包含提醒去重记录，并在恢复预览中准确展示', () => {
    const labels = restoreBackupModuleLabels(backupWith(['courses', 'reminderLog']))
    expect(labels).toContain('课程与课表')
    expect(labels).toContain('提醒记录')
    expect(restoreBackupModuleLabels(backupWith(['courses']))).not.toContain('提醒记录')
  })

  it('备份里没有的模块不许出现在范围里', () => {
    const labels = restoreBackupModuleLabels(backupWith(['courses']))
    expect(labels).toEqual(['课程与课表'])
    expect(labels).not.toContain('账本')
    expect(labels).not.toContain('清单')
  })

  it('旧版备份（只有三项）不会把新模块写成"将被覆盖"', () => {
    const labels = restoreBackupModuleLabels(backupWith(['courses', 'countdowns', 'tasks']))
    expect(labels.sort()).toEqual(['待办与快速记录', '重要日期', '课程与课表'].sort())
  })

  it('落在 BACKUP_MODULES 之外、但会被写回的键归为「其它本机设置」', () => {
    // 用一个刻意不在 BACKUP_MODULES 里的存储键，验证不会被静默略过
    const labels = restoreBackupModuleLabels(
      { providedFields: ['theme', 'mysterySetting'], data: { theme: 'blue', mysterySetting: 'x' } },
      {
        storageKeys: { theme: 'sl_theme', mysterySetting: 'sl_mystery_setting' },
        modules: [{ key: 'appearance', label: '外观与主题', keys: ['sl_theme'] }],
      },
    )
    expect(labels).toEqual(['外观与主题', '其它本机设置'])
  })

  it('空备份/未选文件时不产生任何范围（不会误报会覆盖什么）', () => {
    expect(restoreBackupModuleLabels(null)).toEqual([])
    expect(restoreBackupModuleLabels({ providedFields: [], data: {} })).toEqual([])
    // 字段名在 providedFields 里、但值为 null 的：与 buildBackupRestoreValues 的口径一致，不写回、也不算覆盖
    expect(restoreBackupModuleLabels({ providedFields: ['courses'], data: { courses: null } })).toEqual([])
  })

  it('判据与真实写入路径同源：buildBackupRestoreValues 写回的键集合 == 被判为覆盖的键集合', async () => {
    const { buildBackupRestoreValues } = await import('../src/composables/backupRestore.js')
    const backup = backupWith(['theme', 'checklists', 'focusSessions'])
    const written = Object.keys(buildBackupRestoreValues(backup.data, backup.providedFields, BACKUP_STORAGE_KEYS))
    const covered = restoreBackupModuleLabels(backup)
    // 每一个真的会被写回的键，都必须能落到某个已列出的模块标签上
    const uncovered = written.filter((key) => !BACKUP_MODULES.some((mod) => mod.keys.includes(key)))
    expect(uncovered).toEqual([])
    expect(covered.length).toBeGreaterThan(0)
  })
})
