/// <reference types="vite/client" />

declare var __STUDY_LIFE_RELEASE__: string
declare var __STUDY_LIFE_BUILD_INFO__: {
  buildId: string
  commitId: string
  sourceSignature: string
  schemaVersion: number
  domainSchemaVersion: number
}

interface Window {
  __STUDY_LIFE_RELEASE__?: string
  __STUDY_LIFE_BUILD_INFO__?: {
    buildId: string
    commitId: string
    sourceSignature: string
    schemaVersion: number
    domainSchemaVersion: number
  }
}

interface DesktopUpdateSnapshot {
  stage: string
  currentVersion: string
  availableVersion: string
  percent: number | null
  transferred?: number
  total?: number
  bytesPerSecond?: number
  taskId?: number
  revision?: number
  startedAt?: number
  finishedAt?: number
  taskPending?: boolean
  canCancel?: boolean
  canRetry?: boolean
  error?: { code: string; message: string; retryAction: string } | null
  timings?: Array<{ stage: string; durationMs: number }>
  log?: Array<{ at: number; stage: string; code: string }>
  releaseNotes?: string
  releaseDate?: string
  lastCheckedAt: number
  message: string
}

interface Window {
  studyLifeDesktop?: {
    isDesktop: boolean
    getUpdateState?: () => Promise<DesktopUpdateSnapshot>
    checkForUpdates?: () => Promise<boolean>
    downloadUpdate?: () => Promise<boolean>
    installUpdate?: () => Promise<boolean>
    cancelUpdate?: () => Promise<boolean>
    onUpdateState?: (listener: (state: DesktopUpdateSnapshot) => void) => () => void
    getReleaseHistory?: () => Promise<unknown>
  }
}
