import { removeVaultKeys } from './dataVault.js'
import { FOOD_RETIREMENT_MIGRATION, PACKAGE_RETIREMENT_MIGRATION, RETIRED_FOOD_KEYS, RETIRED_PACKAGE_KEYS, removeRetiredAppearanceFields } from './retiredData.js'
import { restoreStoredValues } from './store/index.js'

const MIGRATIONS_KEY = 'sl_migrations'

async function downloadEmergencyBackupOnDemand() {
  const { downloadEmergencyBackup } = await import('./emergencyExport.js')
  return downloadEmergencyBackup()
}

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function hasRetiredFoodData() {
  const hasFoodKey = RETIRED_FOOD_KEYS.some((key) => localStorage.getItem(key) !== null)
  const appearance = readJson('sl_appearance', {})
  const wallpaper = readJson('sl_wallpaper_config', {})
  return hasFoodKey || appearance?.foodPickerMode !== undefined || wallpaper?.targets?.food !== undefined
}

function hasRetiredPackageData() {
  return RETIRED_PACKAGE_KEYS.some((key) => localStorage.getItem(key) !== null)
}

function hasMigrationRun(migration) {
  const migrations = readJson(MIGRATIONS_KEY, {})
  return migrations?.[migration] === true
}

function markMigrationRun(migration) {
  const migrations = readJson(MIGRATIONS_KEY, {})
  localStorage.setItem(MIGRATIONS_KEY, JSON.stringify({
    ...(migrations && typeof migrations === 'object' && !Array.isArray(migrations) ? migrations : {}),
    [migration]: true,
  }))
}

async function createRequiredBackup(exportBackup) {
  try {
    const backup = await exportBackup?.()
    if (!backup) throw new Error('未生成备份文件')
    // 应急导出会如实报告自己漏掉了哪些键。之前这里只看「有没有返回对象」，
    // 于是 `completeness.complete === false` 的残缺备份也算通过，
    // 紧接着就把旧数据永久删除 —— 而那份文件根本救不回来。
    if (backup.completeness && backup.completeness.complete === false) {
      const missing = [...(backup.completeness.missingKeys || []), ...(backup.completeness.unreadableKeys || [])]
      throw new Error(`备份内容不完整（${missing.join('、') || '部分键无法读取'}），清理已取消`)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

// 退休流程必须先确认可恢复备份，再先清理 Vault，最后才移除 localStorage。
// 这样任何失败都会保留原始业务数据，也不会在下次启动被 Vault 重新写回。
export async function retireFoodData({ exportBackup = downloadEmergencyBackupOnDemand, removeVault = removeVaultKeys } = {}) {
  const foodDone = hasMigrationRun(FOOD_RETIREMENT_MIGRATION)
  const packageDone = hasMigrationRun(PACKAGE_RETIREMENT_MIGRATION)
  if (foodDone && packageDone) return { changed: false, alreadyRun: true }

  const foodDetected = !foodDone && hasRetiredFoodData()
  const packageDetected = !packageDone && hasRetiredPackageData()
  if (!foodDetected && !packageDetected) return { changed: false, alreadyRun: false }

  const backup = await createRequiredBackup(exportBackup)
  if (!backup.ok) {
    return {
      changed: false,
      aborted: true,
      error: '旧数据备份失败，本次清理已取消，原数据仍保留。',
      cause: backup.error,
    }
  }

  const vaultKeys = [
    ...(foodDetected ? RETIRED_FOOD_KEYS : []),
    ...(packageDetected ? RETIRED_PACKAGE_KEYS : []),
  ]
  const vaultResult = await removeVault(vaultKeys)
  if (!vaultResult?.ok) {
    return {
      changed: false,
      aborted: true,
      error: '旧数据安全副本清理失败，本次清理已取消，原数据仍保留。',
      cause: vaultResult?.error,
    }
  }

  if (foodDetected) {
    for (const key of RETIRED_FOOD_KEYS) localStorage.removeItem(key)

    const cleanAppearanceValues = {}
    const appearance = readJson('sl_appearance', null)
    if (appearance) cleanAppearanceValues.sl_appearance = removeRetiredAppearanceFields(appearance)
    const wallpaper = readJson('sl_wallpaper_config', null)
    if (wallpaper) cleanAppearanceValues.sl_wallpaper_config = removeRetiredAppearanceFields(wallpaper)
    if (Object.keys(cleanAppearanceValues).length) {
      await restoreStoredValues(cleanAppearanceValues, { markChanged: false })
    }
    markMigrationRun(FOOD_RETIREMENT_MIGRATION)
  }

  if (packageDetected) {
    for (const key of RETIRED_PACKAGE_KEYS) localStorage.removeItem(key)
    markMigrationRun(PACKAGE_RETIREMENT_MIGRATION)
  }
  return { changed: foodDetected || packageDetected, alreadyRun: false }
}

export function foodRetirementDetected() {
  return hasRetiredFoodData() && !hasMigrationRun(FOOD_RETIREMENT_MIGRATION)
}
