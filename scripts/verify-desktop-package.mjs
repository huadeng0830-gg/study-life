import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isExpectedDesktopUpdateSource } from './desktop-update-source.mjs'

const require = createRequire(import.meta.url)
const { extractFile, listPackage } = require('@electron/asar')
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const packageDirectory = path.resolve(ROOT, process.argv[2] || 'release-desktop/win-unpacked')
const archivePath = path.join(packageDirectory, 'resources', 'app.asar')
const updateConfigPath = path.join(packageDirectory, 'resources', 'app-update.yml')

function fail(message) {
  console.error(`✗ 桌面更新包校验失败：${message}`)
  process.exit(1)
}

if (!existsSync(archivePath)) fail(`找不到 ${archivePath}；请先生成 Windows --dir 包`)
if (!existsSync(updateConfigPath)) fail('缺少 resources/app-update.yml，安装包无法定位更新源')

const entries = new Set(listPackage(archivePath).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')))
const updaterManifestPath = 'node_modules/electron-updater/package.json'
if (!entries.has(updaterManifestPath)) fail(`app.asar 未包含 ${updaterManifestPath}`)
if (!entries.has('updaterController.cjs') || !entries.has('cachePaths.cjs') || !entries.has('main.cjs')) fail('主进程更新入口或安装目录缓存配置没有完整打入 app.asar')

const appManifest = JSON.parse(extractFile(archivePath, 'package.json').toString('utf8'))
const configuredPackage = JSON.parse(readFileSync(path.join(ROOT, 'desktop-app/package.json'), 'utf8'))
const configuredLock = JSON.parse(readFileSync(path.join(ROOT, 'desktop-app/package-lock.json'), 'utf8'))
const appUpdaterVersion = configuredPackage.dependencies?.['electron-updater']
const lockedUpdaterVersion = configuredLock.packages?.['node_modules/electron-updater']?.version
if (appManifest.version !== configuredPackage.version) fail(`包内版本 ${appManifest.version} 与源码版本 ${configuredPackage.version} 不一致`)
if (appManifest.dependencies?.['electron-updater'] !== appUpdaterVersion || lockedUpdaterVersion !== appUpdaterVersion) {
  fail(`应用清单、锁文件的 electron-updater 版本不一致：${appUpdaterVersion} / ${lockedUpdaterVersion}`)
}

const updateConfig = readFileSync(updateConfigPath, 'utf8')
if (!isExpectedDesktopUpdateSource(updateConfig)) {
  fail('app-update.yml 没有指向预期的 GitHub Releases 仓库')
}

console.log(`✓ Windows 包含 electron-updater ${appUpdaterVersion}、版本 ${appManifest.version} 和 GitHub 更新源配置`)
