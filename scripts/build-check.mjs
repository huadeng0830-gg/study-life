// 日常质量门禁构建：`npm run check` 的最后一步。
//
// 与 `npm run build`（正式发布构建，Cloudflare Pages 用的就是它）唯一的区别是
// 这里把 STUDY_LIFE_RELEASE_GATE 设为 0，并让 check-release-build 跳过源码签名比对。
// 目的：改一行 src 之后 `npm run check` 仍然能整体通过，不必先发一个版本；
// 而发布一致性由 `npm run build` 与 `npm run check:release` 继续强制把关。
//
// 用 spawnSync + stdio:'inherit' 而不是管道：既保留实时输出，
// 也不会在受限沙箱里因 piped stdio 失败。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const VITE_ENTRY = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  if (result.error) {
    console.error(`✗ 无法执行 ${command}：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(VITE_ENTRY)) {
  console.error('✗ 找不到 node_modules/vite/bin/vite.js，请先运行 npm ci。')
  process.exit(1)
}

run(process.execPath, [VITE_ENTRY, 'build', '--configLoader', 'native'], { STUDY_LIFE_RELEASE_GATE: '0' })
run(process.execPath, [fileURLToPath(new URL('./check-release-build.mjs', import.meta.url)), 'dist', '--allow-dirty-signature'])