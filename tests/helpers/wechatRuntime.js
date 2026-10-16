import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import { vi } from 'vitest'
const root = fileURLToPath(new URL('../../miniprogram/', import.meta.url))
export function createMiniRuntime({ cloudHandler, initialConfig = { cloudEnvId: 'fictional-env', cloudFunctionName: 'study-life' }, storage = new Map(), clock = { now: Date.parse('2026-10-16T04:00:00Z') } } = {}) {
  const cache = new Map()
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  class MiniDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])) } static now() { return clock.now } }
  const files = new Map()
  const wx = {
    cloud: { init: vi.fn(), callFunction: vi.fn(async ({ data }) => ({ result: cloudHandler ? await cloudHandler(data) : { ok: false, code: 'offline', error: '离线测试' } })) },
    getStorageSync: key => copy(storage.get(key)), setStorageSync: (key,value) => storage.set(key,copy(value)), removeStorageSync: key => storage.delete(key),
    switchTab: vi.fn(), navigateTo: vi.fn(), navigateBack: vi.fn(), setNavigationBarTitle: vi.fn(), setNavigationBarColor: vi.fn(), setClipboardData: vi.fn(), getClipboardData: vi.fn(async()=>({data:''})), stopPullDownRefresh: vi.fn(), showToast: vi.fn(), showModal: vi.fn(async()=>({confirm:true})),
    env: { USER_DATA_PATH: '/fictional/userdata' }, getFileSystemManager: () => ({ writeFileSync: (path,data)=>files.set(path,data), readFileSync:path=>files.get(path) }), shareFileMessage:vi.fn(async()=>({})), chooseMessageFile:vi.fn(),
  }
  function load(file) {
    const path=resolve(file)
    if(path===resolve(root,'config.js'))return initialConfig
    if(cache.has(path))return cache.get(path).exports
    const module={exports:{}}
    cache.set(path,module)
    vm.runInNewContext(readFileSync(path,'utf8'),{module,exports:module.exports,require:name=>load(resolve(dirname(path),name.endsWith('.js')?name:name+'.js')),wx,Date:MiniDate,console,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout},{filename:path})
    return module.exports
  }
  function page(name) {
    let descriptor
    const path=resolve(root,`pages/${name}/index.js`)
    vm.runInNewContext(readFileSync(path,'utf8'),{require:name=>load(resolve(dirname(path),name+'.js')),wx,Date:MiniDate,console,Page(value){descriptor=value},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout},{filename:path})
    descriptor.setData=updates=>{for(const[path,value]of Object.entries(updates)){const keys=path.split('.');let target=descriptor.data;for(const key of keys.slice(0,-1))target=target[key]||={};target[keys.at(-1)]=value}}
    return descriptor
  }
  return { api:load(resolve(root,'utils/api.js')), workspace:load(resolve(root,'utils/workspace.js')), ui:load(resolve(root,'utils/presentation.js')), page, wx, storage, files, clock, config:initialConfig }
}

export function createMemoryStore() {
  let data=new Map()
  let queue=Promise.resolve()
  const key=(collection,id)=>`${collection}/${id}`
  const clone=value=>structuredClone(value)
  const access=target=>({ get:async(c,id)=>clone(target.get(key(c,id))||null), put:async(c,id,row)=>{target.set(key(c,id),clone({...row,_id:id}))} })
  return {
    get:async(c,id)=>access(data).get(c,id),put:async(c,id,row)=>access(data).put(c,id,row),in:values=>({$in:values}),
    async list(c,where={}, {offset=0,limit=60,order='created_at',direction='desc'}={}) {
      const rows=[...data.entries()].filter(([k,row])=>k.startsWith(c+'/')&&Object.entries(where).every(([field,value])=>value?.$in?value.$in.includes(row[field]):row[field]===value)).map(([,row])=>clone(row))
      rows.sort((a,b)=>(String(a[order]||'').localeCompare(String(b[order]||''))*(direction==='desc'?-1:1))||a._id.localeCompare(b._id))
      return rows.slice(offset,offset+limit)
    },
    async transaction(callback){const work=queue.then(async()=>{const next=clone(data);const result=await callback(access(next));data=next;return result});queue=work.catch(()=>{});return work},
    snapshot:()=>JSON.stringify([...data]),
  }
}
