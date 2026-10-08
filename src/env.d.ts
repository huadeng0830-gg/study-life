/// <reference types="vite/client" />

declare const __STUDY_LIFE_RELEASE__: string

interface Window {
  __STUDY_LIFE_RELEASE__?: string
}

interface Window {
  studyLifeDesktop?: {
    isDesktop: boolean
    getUpdateState?: () => Promise<{
      stage: string
      currentVersion: string
      availableVersion: string
      percent: number
      lastCheckedAt: number
      message: string
    }>
    checkForUpdates?: () => Promise<boolean>
    downloadUpdate?: () => Promise<boolean>
    installUpdate?: () => Promise<boolean>
    onUpdateState?: (listener: (state: {
      stage: string
      currentVersion: string
      availableVersion: string
      percent: number
      lastCheckedAt: number
      message: string
    }) => void) => () => void
  }
}
