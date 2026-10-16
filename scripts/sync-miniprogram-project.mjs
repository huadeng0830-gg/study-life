import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../miniprogram')
const target=process.argv[2]&&resolve(process.argv[2])
if(!target||!existsSync(join(target,'project.config.json')))throw new Error('Specify an existing WeChat project directory.')
const original=JSON.parse(readFileSync(join(target,'project.config.json'),'utf8').replace(/^\uFEFF/,''))
const project=JSON.parse(readFileSync(join(source,'project.config.json'),'utf8'))
if(original.appid!==project.appid)throw new Error('Destination AppID does not match the source project.')
const backup=join(target,`source-backup-${new Date().toISOString().replace(/[:.]/g,'-')}`)
let count=0
function copy(from,to){
  if(statSync(from).isDirectory()){mkdirSync(to,{recursive:true});for(const name of readdirSync(from)){if(name!=='node_modules')copy(join(from,name),join(to,name))};return}
  if(existsSync(to)){const relative=to.slice(target.length+1);const saved=join(backup,relative);mkdirSync(dirname(saved),{recursive:true});copyFileSync(to,saved)}
  mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);count++
}
for(const name of ['pages','utils','assets','custom-tab-bar','app.js','app.json','app.wxss','package.json','sitemap.json'])copy(join(source,name),join(target,'miniprogram',name))
if(!existsSync(join(target,'miniprogram/config.js')))copy(join(source,'config.js'),join(target,'miniprogram/config.js'))
copy(join(source,'cloudfunctions'),join(target,'cloudfunctions'))
copy(join(source,'cloudbaserc.json'),join(target,'cloudbaserc.json'))
copy(join(source,'README.md'),join(target,'README.md'))
const readmePath=join(target,'README.md')
writeFileSync(readmePath,readFileSync(readmePath,'utf8').replace('`D:\\study-life\\study-life\\miniprogram`（含 `app.js`、`app.json` 和 `project.config.json` 的文件夹）',`\`${target}\`（项目根目录，页面源码在 miniprogram/）`).replace('修改 `config.js`：','修改 `miniprogram/config.js`：'))
project.miniprogramRoot='miniprogram/';project.cloudfunctionRoot='cloudfunctions/'
copyFileSync(join(target,'project.config.json'),join(backup,'project.config.json'))
writeFileSync(join(target,'project.config.json'),JSON.stringify(project,null,2)+'\n')
console.log(`Updated ${count} files in ${target}`)
console.log(`Previous source files preserved in ${backup}`)
console.log('Existing config.js and project.private.config.json preserved.')
