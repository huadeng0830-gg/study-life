// node scripts/audit/performance-budget.mjs dist browser-report.json
// Use --inventory as the second argument for bundle inventory without enforcement.
import { readFileSync,readdirSync,statSync } from 'node:fs'
import { resolve,extname,relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
const root=fileURLToPath(new URL('../../',import.meta.url))
const dist=resolve(process.argv[2]||resolve(root,'dist'))
const budget=JSON.parse(readFileSync(resolve(root,'PERFORMANCE-BUDGET.json'),'utf8'))
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]) }
const assets=walk(dist).filter(file=>file.includes('assets'))
const sum=extension=>assets.filter(f=>extname(f)===extension).reduce((a,file)=>{const data=readFileSync(file);return {files:a.files+1,bytes:a.bytes+data.byteLength,gzipBytes:a.gzipBytes+gzipSync(data).byteLength}},{files:0,bytes:0,gzipBytes:0})
const report={ js:sum('.js'),css:sum('.css'),largest:assets.map(file=>({file:relative(dist,file).replaceAll('\\','/'),bytes:statSync(file).size})).sort((a,b)=>b.bytes-a.bytes).slice(0,5),checks:[] }
const inventoryOnly=process.argv[3]==='--inventory'
report.mode=inventoryOnly?'inventory-only':'enforce'
if(!process.argv[3]) throw new Error('Provide a populated browser report for budget enforcement, or explicitly use --inventory.')
if(!inventoryOnly) {
  const rows=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'))
  if(!Array.isArray(rows)||rows.length===0) throw new Error('Browser report must contain at least one measured page.')
  for(const row of rows) {
    const resources=row.metrics.resources
    const check=(name,actual,max)=>report.checks.push({target:row.target,width:row.width,name,actual,max,passed:actual<=max})
    check('home requests until useful content',row.firstScreenRequests,budget.homeRequestsMax)
    check('home JS decoded bytes including early warmups',resources.filter(x=>x.path.endsWith('.js')).reduce((a,x)=>a+x.decoded,0),budget.homeDecodedJsBytesMax)
    check('home CSS decoded bytes including early warmups',resources.filter(x=>x.path.endsWith('.css')).reduce((a,x)=>a+x.decoded,0),budget.homeDecodedCssBytesMax)
    check('home images decoded bytes',resources.filter(x=>x.type==='img').reduce((a,x)=>a+x.decoded,0),budget.homeImageBytesMax)
    check('home API calls',row.requests.filter(x=>['xhr','fetch'].includes(x.type)&&!['/release.json','/version.txt','/release-history.json'].includes(x.path)).length,budget.homeApiRequestsMax)
  }
}
console.log(JSON.stringify(report,null,2))
if(report.checks.some(c=>!c.passed)) process.exitCode=1
