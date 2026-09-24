import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('同步服务发布契约', () => {
  it('生产发布必须先部署 Durable Object 协调器，再部署 Pages', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const releaseScript = packageJson.scripts?.['deploy:sync:production']

    expect(releaseScript).toEqual(expect.any(String))
    const checkStep = releaseScript.indexOf('npm run check')
    const coordinatorStep = releaseScript.indexOf('wrangler deploy --config sync-coordinator/wrangler.jsonc')
    const pagesStep = releaseScript.indexOf('wrangler pages deploy dist --project-name=study-life --branch=main')
    const healthStep = releaseScript.indexOf('npm run sync:health')
    expect(checkStep).toBeGreaterThanOrEqual(0)
    expect(coordinatorStep).toBeGreaterThan(checkStep)
    expect(pagesStep).toBeGreaterThan(coordinatorStep)
    expect(healthStep).toBeGreaterThan(pagesStep)
  })
})
