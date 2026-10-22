import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeSourceSignature, collectReleaseFiles, RELEASE_INPUTS } from '../scripts/source-signature.mjs'

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
  it('ignores Capacitor generated XML so web releases match a clean checkout', () => {
    const projectRoot = createTemporaryRoot()
    const resources = path.join(projectRoot, 'android/app/src/main/res')
    mkdirSync(path.join(resources, 'xml'), { recursive: true })
    writeFileSync(path.join(resources, 'xml/file_paths.xml'), '<paths/>')
    const options = { projectRoot, releaseInputs: ['android/app/src/main/res'] }
    const cleanSignature = computeSourceSignature(options)
    writeFileSync(path.join(resources, 'xml/config.xml'), '<widget/>')
    expect(computeSourceSignature(options)).toBe(cleanSignature)
    writeFileSync(path.join(resources, 'xml/file_paths.xml'), '<paths><cache-path/></paths>')
    expect(computeSourceSignature(options)).not.toBe(cleanSignature)
  })

  it('includes Worker sources in the release signature', () => {
    expect(RELEASE_INPUTS).toContain('workers')
    const projectRoot = createTemporaryRoot()
    const workerPath = path.join(projectRoot, 'workers', 'public-api', 'worker.js')
    mkdirSync(path.dirname(workerPath), { recursive: true })
    writeFileSync(workerPath, 'export default { fetch() { return new Response("one") } }\n')
    const firstSignature = computeSourceSignature({ projectRoot, releaseInputs: ['workers'] })
    writeFileSync(workerPath, 'export default { fetch() { return new Response("two") } }\n')
    const secondSignature = computeSourceSignature({ projectRoot, releaseInputs: ['workers'] })
    expect(secondSignature).not.toBe(firstSignature)
  })

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
