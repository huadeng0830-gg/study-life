import { APP_VERSION as CONFIG_APP_VERSION, LEGACY_RELEASE_VERSION, RELEASE_CHANNEL } from '../../release.config.js'
import { ACCOUNT_SYNC_DATA_SCHEMA_VERSION } from './accountSyncSchema.js'
import { DOMAIN_SCHEMA_VERSION } from './domain/migrations.js'

const build = globalThis.__STUDY_LIFE_BUILD_INFO__ || {}

export const APP_RELEASE = globalThis.__STUDY_LIFE_RELEASE__ || CONFIG_APP_VERSION || 'development'
export const APP_CHANNEL = RELEASE_CHANNEL || 'stable'
export const APP_LEGACY_RELEASE = LEGACY_RELEASE_VERSION || ''
export const BUILD_ID = typeof build.buildId === 'string' ? build.buildId : 'development'
export const COMMIT_ID = typeof build.commitId === 'string' ? build.commitId : 'unknown'
export const SOURCE_SIGNATURE = typeof build.sourceSignature === 'string' ? build.sourceSignature : ''
export const APP_SCHEMA_VERSION = Number.isSafeInteger(build.schemaVersion) ? build.schemaVersion : ACCOUNT_SYNC_DATA_SCHEMA_VERSION
export const APP_DOMAIN_SCHEMA_VERSION = Number.isSafeInteger(build.domainSchemaVersion) ? build.domainSchemaVersion : DOMAIN_SCHEMA_VERSION

export const currentVersionInfo = Object.freeze({
  appVersion: APP_RELEASE,
  buildId: BUILD_ID,
  commitId: COMMIT_ID,
  sourceSignature: SOURCE_SIGNATURE,
  channel: APP_CHANNEL,
  schemaVersion: APP_SCHEMA_VERSION,
  domainSchemaVersion: APP_DOMAIN_SCHEMA_VERSION,
})
