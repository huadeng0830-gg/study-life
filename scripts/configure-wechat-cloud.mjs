import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = process.argv[2]
const apply = process.argv.includes('--apply')
if (!cliEntry || !existsSync(cliEntry)) throw new Error('Usage: node scripts/configure-wechat-cloud.mjs <CloudBase CLI bin/tcb path> [--apply]')
const configPath = resolve(root, 'miniprogram/cloudbaserc.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const schema = JSON.parse(readFileSync(resolve(root, 'miniprogram/cloudfunctions/database.schema.json'), 'utf8'))
const fn = config.functions.find(item => item.name === 'study-life')
if (!config.envId || !fn || !schema.collections.every(name => /^sl_[a-z_]+$/.test(name))) throw new Error('Invalid cloud configuration.')

function run(args) {
  const result = spawnSync(process.execPath, [resolve(cliEntry), ...args, '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'CloudBase CLI failed.')
  const start = result.stdout.indexOf('{')
  if (start < 0) throw new Error('CloudBase CLI did not return JSON.')
  const response = JSON.parse(result.stdout.slice(start))
  if (response.error || response.success === false) throw new Error('CloudBase CLI reported a failed operation.')
  return response.data ?? response
}
const api = (action, body) => run(['api', 'tcb', action, '-e', config.envId, '--body', JSON.stringify(body)])

console.log(`${apply ? 'APPLY' : 'CHECK'} ${config.envId}`)
let changes = 0
for (const collection of schema.collections) {
  const body = { EnvId: config.envId, CollectionName: collection }
  let current = api('DescribeDatabaseACL', body)
  if (current.AclTag !== 'ADMINONLY') {
    changes++
    if (apply) {
      // Only narrow access. No documents, collection structures, or account roles are changed.
      api('ModifyDatabaseACL', { ...body, AclTag: 'ADMINONLY' })
      current = api('DescribeDatabaseACL', body)
      if (current.AclTag !== 'ADMINONLY') throw new Error(`Permission verification failed: ${collection}`)
    }
  }
  console.log(`${collection}: ${current.AclTag}${current.AclTag === 'ADMINONLY' ? '' : ' -> ADMINONLY'}`)
}
let details = run(['fn', 'detail', fn.name, '-e', config.envId])
if (details.Timeout !== fn.timeout) {
  changes++
  if (apply) {
    run(['api', 'scf', 'UpdateFunctionConfiguration', '-e', config.envId, '--body', JSON.stringify({
      FunctionName: fn.name, Namespace: config.envId, Timeout: fn.timeout,
    })])
    details = run(['fn', 'detail', fn.name, '-e', config.envId])
    if (details.Timeout !== fn.timeout) throw new Error('Function timeout verification failed.')
  }
}
console.log(`${fn.name}: ${details.Status}, ${details.Runtime}, timeout ${details.Timeout}s${details.Timeout === fn.timeout ? '' : ` -> ${fn.timeout}s`}`)
console.log(`${changes} configuration changes ${apply ? 'applied and verified' : 'needed'}. No user documents were changed.`)
