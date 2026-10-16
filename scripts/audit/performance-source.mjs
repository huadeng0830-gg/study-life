// Read every versioned/new source file, but never emit secrets or runtime data.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const files = execFileSync('git', ['ls-files','--cached','--others','--exclude-standard','-z'], { cwd:root,encoding:'utf8' }).split('\0').filter(Boolean)
const report = { sourceFiles:0, sourceBytes:0, groups:{}, wildcardReads:[], realtime:[], timers:[], browserSecretReferences:[], largeFiles:[], environment:[] }
for(const file of files) {
  if(file.startsWith('.env') || !existsSync(resolve(root,file)) || statSync(resolve(root,file)).isDirectory()) continue
  const size = statSync(resolve(root,file)).size
  const group = file.split('/')[0]
  report.groups[group] = (report.groups[group]||0)+1
  if(size>500000) report.largeFiles.push({file,bytes:size})
  if(!['.js','.ts','.vue','.sql','.json','.jsonc','.toml','.md','.yml','.html','.css'].includes(extname(file))) continue
  const source = readFileSync(resolve(root,file),'utf8')
  report.sourceFiles++; report.sourceBytes+=size
  if(!/^(src\/|supabase\/functions\/|workers\/|functions\/)/.test(file) || file.endsWith('.d.ts')) continue
  for(const [index,line] of source.split(/\r?\n/).entries()) {
    if(/\.select\(\s*['"`]\*['"`]/.test(line)) report.wildcardReads.push({file,line:index+1})
    if(/\.channel\(|\.subscribe\(/.test(line)) report.realtime.push({file,line:index+1})
    if(/setInterval\(|setTimeout\(/.test(line)) report.timers.push({file,line:index+1})
    if(file.startsWith('src/') && /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/.test(line)) report.browserSecretReferences.push({file,line:index+1,note:'reference only; inspect key guards vs actual credentials'})
  }
}
for(const file of ['.env.local','.env.production']) {
  if(!existsSync(resolve(root,file))) continue
  for(const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)) {
    const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if(match) report.environment.push({file,name:match[1],configured:Boolean(match[2]),publicSecretName:/^VITE_.*(?:SERVICE_ROLE|SECRET|PASSWORD)/.test(match[1])})
  }
}
const lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8'))
report.lock = { version:lock.lockfileVersion,packages:Object.keys(lock.packages||{}).length, supabase:lock.packages?.['node_modules/@supabase/supabase-js']?.version }
console.log(JSON.stringify(report,null,2))
if(report.wildcardReads.length || report.environment.some(entry=>entry.publicSecretName)) process.exitCode=1
