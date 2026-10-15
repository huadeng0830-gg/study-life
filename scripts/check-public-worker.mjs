import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = 'workers/public-api/wrangler.jsonc'
const logPath = path.join(root, '.wrangler', 'logs')
mkdirSync(logPath, { recursive: true })
const tempPath = path.join(root, '.wrangler', 'tmp')
mkdirSync(tempPath, { recursive: true })
const options = { cwd: root, stdio: 'inherit', env: { ...process.env, TEMP: tempPath, TMP: tempPath, WRANGLER_LOG_PATH: logPath, WRANGLER_SEND_METRICS: 'false' } }
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js')
execFileSync(process.execPath, [wrangler, 'types', 'workers/public-api/worker-configuration.d.ts', '--config', config, '--strict-vars', 'false'], options)
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', 'workers/public-api/tsconfig.json'], options)
execFileSync(process.execPath, [wrangler, 'deploy', '--config', config, '--dry-run', '--outdir', path.join(root, '.wrangler/public-api-build')], options)
execFileSync(process.execPath, [path.join(root, 'scripts/smoke-public-worker.mjs')], options)
