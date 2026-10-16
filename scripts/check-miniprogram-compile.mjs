import { readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const [projectArgument, compilerArgument] = process.argv.slice(2)
if (!projectArgument || !compilerArgument) {
  console.error('Usage: node scripts/check-miniprogram-compile.mjs <project-directory> <wcc-exec-directory>')
  process.exit(1)
}
const project = resolve(projectArgument)
const compiler = resolve(compilerArgument)
const config = JSON.parse(readFileSync(join(project, 'project.config.json'), 'utf8').replace(/^\uFEFF/, ''))
const root = resolve(project, config.miniprogramRoot || '.')
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8').replace(/^\uFEFF/, ''))
const output = mkdtempSync(join(tmpdir(), 'study-life-mini-compile-'))
mkdirSync(output, { recursive: true })
function compile(executable, args) {
  const result = spawnSync(join(compiler, executable + (process.platform === 'win32' ? '.exe' : '')), args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
}
try {
  // 覆盖工具的全局样式阶段；只检查页面文件会漏掉这个入口。
  compile('wcsc', ['-lc', '-o', join(output, 'global.js'), 'app.wxss'])
  const styles = app.pages.map(page => `${page}.wxss`)
  const templates = app.pages.map(page => `${page}.wxml`)
  if (app.tabBar?.custom) { styles.push('custom-tab-bar/index.wxss'); templates.push('custom-tab-bar/index.wxml') }
  for (const file of [...styles, ...templates]) {
    if (!existsSync(join(root, file))) throw new Error(`Missing page file: ${file}`)
  }
  compile('wcsc', ['-lc', '-pc', String(styles.length), '-o', join(output, 'styles.js'), ...styles, 'app.wxss'])
  compile('wcc', ['-d', '-o', join(output, 'templates.js'), ...templates])
  console.log(`WeChat native compilation passed: app.wxss, ${styles.length} page styles, ${templates.length} page templates.`)
  console.log(`Compiler output: ${output}`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
