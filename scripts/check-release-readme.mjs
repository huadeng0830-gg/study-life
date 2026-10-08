import { readFileSync } from 'node:fs'
import { RELEASE_VERSION, RELEASE_NOTES } from '../release.config.js'
import { isReleaseStatusInSync } from './release-readme.mjs'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const desktopPackage = JSON.parse(readFileSync(new URL('../desktop-app/package.json', import.meta.url), 'utf8'))
const desktopLock = JSON.parse(readFileSync(new URL('../desktop-app/package-lock.json', import.meta.url), 'utf8'))

if (desktopPackage.version !== desktopLock.version || desktopPackage.version !== desktopLock.packages?.['']?.version) {
  console.error('✗ desktop-app/package.json 与 package-lock.json 的桌面版本号不一致')
  process.exit(1)
}

const release = { webVersion: RELEASE_VERSION, desktopVersion: desktopPackage.version, notes: RELEASE_NOTES }
if (!isReleaseStatusInSync(readme, release)) {
  console.error('✗ README.md 的版本与最近更新区块没有同步')
  console.error('  运行 npm run release:bump -- --notes "更新说明一|更新说明二" 自动同步版本、桌面包版本和 README')
  process.exit(1)
}

console.log(`✓ README 与网页 ${RELEASE_VERSION}、Windows 桌面版 ${desktopPackage.version} 及更新说明一致`)
