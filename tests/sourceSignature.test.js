import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeSourceSignature, collectReleaseFiles } from '../scripts/source-signature.mjs'

let temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
  temporaryRoots = []
})

function createTemporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'study-life-signature-'))
  temporaryRoots.push(root)
  return root
}

describe('release source signature', () => {
  it('ignores installed dependencies so clean CI and developer machines hash the same tracked sources', () => {
    const temporaryRoot = createTemporaryRoot()
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

  it('hashes the same paths in a deterministic order regardless of file creation order', () => {
    const projectRoots = [createTemporaryRoot(), createTemporaryRoot()]
    const fileNames = ['src/zeta.js', 'src/alpha.js', 'src/éclair.js', 'src/beta.js']
    const contents = new Map(fileNames.map((name) => [name, `// ${name}\n`]))

    for (const [index, projectRoot] of projectRoots.entries()) {
      for (const fileName of index === 0 ? fileNames : [...fileNames].reverse()) {
        const filePath = path.join(projectRoot, fileName)
        mkdirSync(path.dirname(filePath), { recursive: true })
        writeFileSync(filePath, contents.get(fileName))
      }
    }

    const signatures = projectRoots.map((projectRoot) => computeSourceSignature({
      projectRoot,
      releaseInputs: ['src'],
    }))
    expect(signatures[1]).toBe(signatures[0])
  })
})
