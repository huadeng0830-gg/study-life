import { describe, expect, it } from 'vitest'
import { assertProductionDeployPreflight } from '../scripts/deploy-production.mjs'

describe('生产部署前置条件', () => {
  it('只允许已同步的 main 分支和干净工作区', () => {
    expect(() => assertProductionDeployPreflight({
      branch: 'main', status: '', localHead: 'abc', remoteHead: 'abc',
    })).not.toThrow()
    expect(() => assertProductionDeployPreflight({
      branch: 'feature', status: '', localHead: 'abc', remoteHead: 'abc',
    })).toThrow(/main/)
    expect(() => assertProductionDeployPreflight({
      branch: 'main', status: ' M package.json', localHead: 'abc', remoteHead: 'abc',
    })).toThrow(/干净的 Git 工作区/)
    expect(() => assertProductionDeployPreflight({
      branch: 'main', status: '', localHead: 'abc', remoteHead: 'def',
    })).toThrow(/origin\/main/)
  })
})
