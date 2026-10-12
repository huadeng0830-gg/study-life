import { readFileSync } from 'node:fs'
import { APP_VERSION, RELEASE_VERSION, RELEASE_NOTES } from '../release.config.js'
import semver from 'semver'
import { isReleaseStatusInSync } from './release-readme.mjs'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(readFileSync(new URL('../desktop-app/package.json', import.meta.url), 'utf8'))
const desktopLock = JSON.parse(readFileSync(new URL('../desktop-app/package-lock.json', import.meta.url), 'utf8'))
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const rootLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const history = JSON.parse(readFileSync(new URL('../release-history.json', import.meta.url), 'utf8'))

if (semver.valid(APP_VERSION, { loose: false }) !== APP_VERSION || RELEASE_VERSION !== APP_VERSION ||
  [rootPackage.version, rootLock.version, rootLock.packages?.['']?.version, desktopPackage.version, desktopLock.version, desktopLock.packages?.['']?.version].some((version) => version !== APP_VERSION)) {
  console.error('✗ release.config.js、两个 package.json 与 lock 文件必须使用同一有效 SemVer')
  process.exit(1)
}
if (!Array.isArray(history) || history[0]?.version !== APP_VERSION) {
  console.error('✗ release-history.json 顶部记录必须对应当前正式版本')
  process.exit(1)
}

const release = { webVersion: RELEASE_VERSION, desktopVersion: desktopPackage.version, notes: RELEASE_NOTES }
if (!isReleaseStatusInSync(readme, release)) {
  console.error('✗ README.md 的版本与最近更新区块没有同步')
  console.error('  运行 npm run release:bump -- --type patch --fixes "..." 同步版本、更新历史和 README')
  process.exit(1)
}

console.log(`✓ README、网页、Windows 桌面版及发布历史均为 ${APP_VERSION}（SemVer）`)
