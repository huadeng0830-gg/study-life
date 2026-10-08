import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isExpectedDesktopUpdateSource } from './desktop-update-source.mjs'
import { matchesDesktopPublisher } from './desktop-signature.mjs'
import { readPublicSupabaseConfig, verifySupabaseBundle } from './supabase-build-checks.mjs'

const require = createRequire(import.meta.url)
const { extractFile, listPackage } = require('@electron/asar')
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const requireSignature = args.includes('--require-signature')
const packageDirectory = path.resolve(ROOT, args.find((arg) => !arg.startsWith('--')) || 'release-desktop/win-unpacked')
const archivePath = path.join(packageDirectory, 'resources', 'app.asar')
const updateConfigPath = path.join(packageDirectory, 'resources', 'app-update.yml')
const desktopRendererPath = path.join(packageDirectory, 'resources', 'dist-desktop')

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

if (requireSignature) {
  if (process.platform !== 'win32') fail('签名校验必须在 Windows runner 上执行')
  const yaml = createRequire(path.join(ROOT, 'desktop-app/package.json'))('js-yaml')
  const publisherNames = yaml.load(updateConfig)?.publisherName
  const publicCertificatePath = path.join(ROOT, 'desktop/certificates/study-life-code-signing.cer')
  if (!existsSync(publicCertificatePath)) fail('缺少用于核对签名者身份的公钥证书')
  const expectedThumbprint = new X509Certificate(readFileSync(publicCertificatePath)).fingerprint.replaceAll(':', '').toUpperCase()
  const executables = readdirSync(packageDirectory).filter((name) => name.toLowerCase().endsWith('.exe'))
  if (executables.length !== 1) fail(`预期在解包目录找到一个应用 exe，实际找到 ${executables.length} 个`)
  const executablePath = path.join(packageDirectory, executables[0])
  const encodedPath = Buffer.from(executablePath, 'utf8').toString('base64')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    `$path = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPath}'))`,
    '$signature = Get-AuthenticodeSignature -LiteralPath $path',
    '$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new(); $null = $chain.Build($signature.SignerCertificate)',
    '[PSCustomObject]@{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject; thumbprint = [string]$signature.SignerCertificate.Thumbprint; chainStatus = @($chain.ChainStatus | ForEach-Object { [string]$_.Status }) } | ConvertTo-Json -Compress',
  ].join('; ')
  const signatureResult = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 15000,
  })
  if (signatureResult.error || signatureResult.status !== 0) fail(`无法读取 Authenticode 签名：${signatureResult.stderr || signatureResult.error?.message || 'PowerShell 失败'}`)
  let signature
  try { signature = JSON.parse(signatureResult.stdout.trim()) } catch { fail('Windows 未返回可解析的 Authenticode 签名信息') }
  const actualThumbprint = String(signature.thumbprint ?? '').replaceAll(':', '').toUpperCase()
  if (!actualThumbprint) fail('Windows 未返回签名证书指纹')
  if (actualThumbprint !== expectedThumbprint) fail('应用 exe 的签名者指纹与仓库内公钥证书不匹配')
  const chainStatus = (Array.isArray(signature.chainStatus) ? signature.chainStatus : [signature.chainStatus])
    .filter(Boolean)
  const untrustedSelfSignedChain = signature.status === 'UnknownError'
    && chainStatus.length === 1
    && chainStatus[0] === 'UntrustedRoot'
  if (signature.status !== 'Valid' && !untrustedSelfSignedChain) {
    fail(`应用 exe 的 Authenticode 签名状态为 ${signature.status || 'unknown'}${chainStatus.length ? `（${chainStatus.join(', ')}）` : ''}`)
  }
  if (!matchesDesktopPublisher(publisherNames, signature.subject)) {
    fail('app-update.yml 的 publisherName 与公钥证书主题不匹配')
  }
}

try {
  verifySupabaseBundle(desktopRendererPath, readPublicSupabaseConfig('desktop'))
} catch (error) {
  fail(`桌面渲染资源没有有效的账号配置：${error.message}`)
}

console.log(`✓ Windows 包含 electron-updater ${appUpdaterVersion}、版本 ${appManifest.version}、GitHub 更新源和有效的 Supabase 账号配置${requireSignature ? '；Authenticode 签名与发布者匹配' : ''}`)
