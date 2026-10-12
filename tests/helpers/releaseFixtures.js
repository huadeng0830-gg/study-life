import { APP_VERSION, LEGACY_RELEASE_VERSION } from '../../release.config.js'
import { SOURCE_SIGNATURE } from '../../src/composables/versionInfo.js'

export const CURRENT_TEST_VERSION = APP_VERSION
export const NEXT_TEST_VERSION = `${APP_VERSION.split('.').slice(0, 2).join('.')}.${Number(APP_VERSION.split('.')[2].split('-')[0]) + 1}`
export const TEST_BUILD_ID = 'test-build-0123456789'
export const TEST_SOURCE_SIGNATURE = SOURCE_SIGNATURE || '0123456789abcdef'

export function makeReleaseManifest(version = CURRENT_TEST_VERSION, overrides = {}) {
  return {
    version,
    buildId: TEST_BUILD_ID,
    commitId: 'abcdef0123456789',
    sourceSignature: TEST_SOURCE_SIGNATURE,
    channel: 'stable',
    publishedAt: null,
    title: `三两事 ${version}`,
    summary: '可靠的更新摘要',
    changes: { features: [], improvements: [], fixes: [], security: [], breaking: [] },
    notes: ['可靠的测试更新说明'],
    legacyVersion: LEGACY_RELEASE_VERSION,
    minimumSupportedVersion: null,
    schemaVersion: 7,
    compatibility: { accountSyncSchemaVersion: 7, domainSchemaVersion: 3 },
    releaseUrl: null,
    updateAction: 'refresh',
    ...overrides,
  }
}

function response(text, ok = true) {
  return { ok, text: async () => text, body: { cancel: async () => {} } }
}

export function releaseFetchResponse(input, manifest = makeReleaseManifest()) {
  const url = new URL(String(input), 'https://fixture.invalid/')
  if (url.pathname === '/index.html') {
    return response(`<html><head>
      <meta name="study-life-app-version" content="${manifest.version}">
      <meta name="study-life-build-id" content="${manifest.buildId}">
      <meta name="study-life-source-signature" content="${manifest.sourceSignature}">
      <meta name="study-life-release" content="${manifest.legacyVersion}">
    </head></html>`)
  }
  if (url.pathname === '/release.json') return response(JSON.stringify(manifest))
  if (url.pathname === '/release-history.json') return response(JSON.stringify([{
    version: manifest.version,
    legacyVersion: manifest.legacyVersion,
    channel: manifest.channel,
    publishedAt: manifest.publishedAt,
    title: manifest.title,
    summary: manifest.summary,
    changes: manifest.changes,
    notes: manifest.notes,
    releaseUrl: manifest.releaseUrl,
  }]))
  return response('asset')
}

export function makeReleaseFetcher(version = CURRENT_TEST_VERSION, overrides = {}) {
  const manifest = makeReleaseManifest(version, overrides)
  return Object.assign(async (input) => releaseFetchResponse(input, manifest), { manifest })
}
