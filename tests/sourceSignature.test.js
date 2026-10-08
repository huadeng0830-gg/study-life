import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeSourceSignature, collectReleaseFiles } from '../scripts/source-signature.mjs'

let temporaryRoot

afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('release source signature', () => {
  it('ignores installed dependencies so clean CI and developer machines hash the same tracked sources', () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'study-life-signature-'))
    const appDirectory = path.join(temporaryRoot, 'desktop-app')
    const packageDirectory = path.join(appDirectory, 'node_modules', 'electron-updater')
    mkdirSync(packageDirectory, { recursive: true })
    const sourcePath = path.join(appDirectory, 'main.cjs')
    const dependencyPath = path.join(packageDirectory, 'package.json')
    writeFileSync(sourcePath, 'module.exports = 1\n')
    writeFileSync(dependencyPath, '{"version":"6.8.10"}\n')

    const sourceFiles = collectReleaseFiles(appDirectory)
    const firstSignature = computeSourceSignature({ projectRoot: temporaryRoot, releaseInputs: ['desktop-app'] })
    writeFileSync(dependencyPath, '{"version":"different-local-install"}\n')
    const secondSignature = computeSourceSignature({ projectRoot: temporaryRoot, releaseInputs: ['desktop-app'] })

    expect(sourceFiles.map((file) => path.relative(appDirectory, file))).toEqual(['main.cjs'])
    expect(secondSignature).toBe(firstSignature)
  })
})
