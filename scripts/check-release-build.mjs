import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_VERSION, LEGACY_RELEASE_VERSION, RELEASE_CHANNEL, RELEASE_SOURCE_SIGNATURE } from '../release.config.js'
import { computeSourceSignature } from './source-signature.mjs'
import { validateReleaseHistory, validateReleaseManifest } from '../src/composables/updateProtocol.js'

const output = resolve(process.argv[2] || 'dist')
function read(name) {
  const path = resolve(output, name)
  if (!existsSync(path)) throw new Error(`构建产物缺失：${name}`)
  return readFileSync(path, 'utf8')
}

function metaFromIndex(html) {
  const metadata = new Map()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((attribute) => [attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? '']))
    if (attributes.name) metadata.set(attributes.name, attributes.content || '')
  }
  return metadata
}

try {
  const index = read('index.html')
  const legacyVersion = read('version.txt').trim()
  const manifest = validateReleaseManifest(JSON.parse(read('release.json')), { channel: RELEASE_CHANNEL })
  const history = validateReleaseHistory(JSON.parse(read('release-history.json')), { channel: RELEASE_CHANNEL })
  if (!manifest) throw new Error('release.json 没有通过结构与渠道校验。')
  if (!history?.length || history[0].version !== APP_VERSION ||
    !history.some((entry) => entry.version === APP_VERSION && entry.channel === RELEASE_CHANNEL))
    throw new Error('release-history.json 缺少当前正式版本或首条记录不匹配。')
  if (manifest.version !== APP_VERSION || manifest.channel !== RELEASE_CHANNEL || manifest.legacyVersion !== LEGACY_RELEASE_VERSION ||
    legacyVersion !== LEGACY_RELEASE_VERSION || manifest.sourceSignature !== RELEASE_SOURCE_SIGNATURE)
    throw new Error('SemVer、兼容标识、源码签名或发布渠道没有保持一致。')
  const calculatedSignature = computeSourceSignature()
  if (calculatedSignature !== RELEASE_SOURCE_SIGNATURE)
    throw new Error(`构建源码签名不一致：配置 ${RELEASE_SOURCE_SIGNATURE}，实际 ${calculatedSignature}。`)
  const meta = metaFromIndex(index)
  if (meta.get('study-life-app-version') !== manifest.version || meta.get('study-life-release') !== manifest.legacyVersion ||
    meta.get('study-life-build-id') !== manifest.buildId || meta.get('study-life-source-signature') !== manifest.sourceSignature)
    throw new Error('index.html 版本元数据与发布清单不一致。')
  console.log(`✓ ${output}：${manifest.version} / ${manifest.buildId} / ${manifest.commitId}`)
} catch (error) {
  console.error(`✗ 发布构建校验失败：${error.message}`)
  process.exit(1)
}
