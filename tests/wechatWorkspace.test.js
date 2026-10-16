import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { createMiniRuntime, createMemoryStore } from './helpers/wechatRuntime.js'
const require = createRequire(import.meta.url)
const { createService } = require('../miniprogram/cloudfunctions/study-life/service.js')
const { normalize } = require('../miniprogram/utils/record-model.js')
const { hash } = require('../miniprogram/cloudfunctions/study-life/rules.js')
const { parseCapture } = require('../miniprogram/utils/capture.js')
const appId='wx4377be9f658a4c7d'
const task=title=>({title,duration:25,priority:'normal',completed:false,spentSeconds:0})
const course={title:'虚构高数课',weekday:5,startTime:'08:00',endTime:'09:40',startWeek:1,endWeek:20,parity:'all'}
const bill={title:'虚构月度账单',amountMinor:1800,date:'2027-01-31',currency:'CNY',cycle:'monthly'}
function backend(){const store=createMemoryStore();const handler=createService({store,appId,checkText:async()=>true});return{store,handler,client(name='student'){return createMiniRuntime({cloudHandler:data=>handler(data,{APPID:appId,OPENID:`fictional-${name}`})})}}}
const input=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}})
const event=dataset=>({currentTarget:{dataset}})

describe('个人云记录权限与事务',()=>{
  it('模型覆盖核心个人记录，客户端与云函数规范一致',()=>{
    expect(readFileSync(new URL('../miniprogram/utils/record-model.js',import.meta.url),'utf8')).toBe(readFileSync(new URL('../miniprogram/cloudfunctions/study-life/record-model.js',import.meta.url),'utf8'))
    expect(normalize('transaction',{title:'午饭',amountMinor:1800,date:'2026-10-16'}).currency).toBe('CNY')
    expect(()=>normalize('transaction',{title:'午饭',amountMinor:-1,date:'2026-10-16'})).toThrow('金额')
    expect(()=>normalize('course',{...course,startTime:'12:00',endTime:'09:00'})).toThrow('结束时间')
    expect(()=>normalize('settings',{termStart:'2026-10-16'})).toThrow('周一')
    expect(()=>normalize('event',{title:'虚构日程',date:'2026-02-30'})).toThrow('日期')
  })
  it('个人数据按微信身份隔离，客户端伪造 user_id 无效',async()=>{
    const b=backend(),a=b.client('a'),other=b.client('b')
    await a.api.wechatLogin();await other.api.wechatLogin()
    a.workspace.put('note',{title:'虚构私人笔记',body:'完全虚构的个人内容。'})
    await a.workspace.sync();await other.workspace.sync()
    expect(a.workspace.all('note')).toHaveLength(1)
    expect(other.workspace.all('note')).toHaveLength(0)
    const result=await other.api.personalRequest('list',{user_id:hash(`${appId}:fictional-a`)})
    expect(result.records).toHaveLength(0)
  })
  it('一组记录有旧版本时全部回滚，不产生半笔账单',async()=>{
    const b=backend(),a=b.client();await a.api.wechatLogin()
    const id=a.workspace.put('bill',bill);await a.workspace.sync()
    const result=await b.handler({service:'personal',action:'commit',payload:{operations:[
      {id:'fixture-payment',kind:'transaction',values:{...bill,direction:'expense'},mutationId:'m1',expectedRevision:0},
      {id,kind:'bill',values:{...bill,date:'2027-02-28'},mutationId:'m2',expectedRevision:0},
    ]}},{APPID:appId,OPENID:'fictional-student'})
    expect(result.code).toBe('record_conflict')
    const remote=await a.api.personalRequest('list')
    expect(remote.records).toHaveLength(1)
    expect(remote.records[0].values.date).toBe('2027-01-31')
  })
  it('相同 mutation 重试不会重复加版本或重建记录',async()=>{
    const b=backend(),a=b.client();await a.api.wechatLogin()
    const operation={id:'fixture-task',kind:'task',values:task('虚构待办'),mutationId:'same-mutation',expectedRevision:0}
    const first=await a.api.personalRequest('commit',{operations:[operation]})
    const retry=await a.api.personalRequest('commit',{operations:[operation]})
    expect(first.records[0].revision).toBe(1)
    expect(retry.records[0].revision).toBe(1)
    expect((await a.api.personalRequest('list')).records).toHaveLength(1)
  })
  it('伪造 deleted 字段不能绕过记录内容验证',async()=>{
    const b=backend(),a=b.client();await a.api.wechatLogin()
    await expect(a.api.personalRequest('commit',{operations:[{id:'bad-row',kind:'task',values:{},deleted:'false',mutationId:'mutation-bad',expectedRevision:0}]})).rejects.toThrow('名称')
    expect((await a.api.personalRequest('list')).records).toHaveLength(0)
  })
})

describe('本机优先与同步队列',()=>{
  it('未配置云环境也能创建、编辑、完成和删除本机待办',async()=>{
    const r=createMiniRuntime({initialConfig:{cloudEnvId:'',cloudFunctionName:'study-life'}})
    const id=r.workspace.put('task',task('先做一道虚构练习题'))
    expect(r.workspace.get(id).completed).toBe(false)
    r.workspace.put('task',{...r.workspace.get(id),completed:true},id)
    expect(r.workspace.get(id).completed).toBe(true)
    expect((await r.workspace.sync()).status).toBe('local')
    expect(r.wx.cloud.callFunction).not.toHaveBeenCalled()
    r.workspace.remove(id);expect(r.workspace.all()).toHaveLength(0)
  })
  it('存储写入失败不会伪报保存成功',()=>{
    const r=createMiniRuntime();r.wx.setStorageSync=()=>{throw new Error('storage quota')}
    expect(()=>r.workspace.put('task',task('虚构待办'))).toThrow('storage quota')
    expect(r.workspace.all()).toHaveLength(0)
  })
  it('登录前后及不同微信账号使用独立空间',async()=>{
    const b=backend();let who='a'
    const r=createMiniRuntime({cloudHandler:data=>b.handler(data,{APPID:appId,OPENID:`fictional-${who}`})})
    r.workspace.put('task',task('虚构访客待办'));await r.api.wechatLogin()
    expect(r.workspace.all()).toHaveLength(0)
    r.workspace.put('task',task('虚构账号 A 待办'));await r.workspace.sync();await r.api.signOut()
    expect(r.workspace.all()[0].title).toBe('虚构访客待办')
    who='b';await r.api.wechatLogin();expect(r.workspace.all()).toHaveLength(0)
    await r.api.signOut();who='a';await r.api.wechatLogin();expect(r.workspace.all()[0].title).toBe('虚构账号 A 待办')
  })
  it('离线编辑保持队列，联网后上传并拉取其他设备修改',async()=>{
    const b=backend(),r=b.client();await r.api.wechatLogin()
    const original=r.wx.cloud.callFunction
    r.wx.cloud.callFunction=vi.fn(async()=>{throw new Error('offline')})
    const id=r.workspace.put('task',task('离线虚构待办'))
    expect((await r.workspace.sync()).status).toBe('pending')
    expect(r.workspace.read().queue).toHaveLength(1)
    r.wx.cloud.callFunction=original;await r.workspace.sync();expect(r.workspace.read().queue).toHaveLength(0)
    const second=b.client();await second.api.wechatLogin();await second.workspace.sync();expect(second.workspace.get(id).title).toBe('离线虚构待办')
  })
  it('上传期间继续修改同一条记录不会丢失后一次输入',async()=>{
    const b=backend(),r=b.client();await r.api.wechatLogin()
    const id=r.workspace.put('task',task('最初的虚构标题'))
    const original=r.wx.cloud.callFunction
    let release;let first=true
    r.wx.cloud.callFunction=async request=>{if(first&&request.data.service==='personal'&&request.data.action==='commit'){first=false;await new Promise(resolve=>{release=resolve})}return original(request)}
    const pending=r.workspace.sync();await Promise.resolve();await Promise.resolve()
    r.workspace.put('task',{...r.workspace.get(id),title:'上传期间的新标题'},id)
    release();await pending
    expect(r.workspace.get(id).title).toBe('上传期间的新标题')
    expect(r.workspace.read().queue).toHaveLength(0)
    expect((await r.api.personalRequest('list')).records[0].values.title).toBe('上传期间的新标题')
  })
  it('其他设备的新版本触发冲突，重复查看后仍能解决并继续同步',async()=>{
    const b=backend(),a=b.client(),r=b.client();await a.api.wechatLogin();await r.api.wechatLogin()
    const id=a.workspace.put('task',task('原始虚构待办'));await a.workspace.sync();await r.workspace.sync()
    a.workspace.put('task',{...a.workspace.get(id),title:'另一设备的版本'},id);await a.workspace.sync()
    r.workspace.put('task',{...r.workspace.get(id),title:'本机的版本'},id)
    expect((await r.workspace.sync()).status).toBe('conflict')
    await r.workspace.sync();await r.workspace.sync()
    expect((await r.workspace.resolveConflict(true)).status).toBe('synced')
    r.workspace.put('task',{...r.workspace.get(id),title:'解决后的下一次修改'},id);await r.workspace.sync()
    await a.workspace.sync();expect(a.workspace.get(id).title).toBe('解决后的下一次修改')
  })
  it('冲突处理保留账单与收支的原子批次',async()=>{
    const b=backend(),a=b.client(),r=b.client();await a.api.wechatLogin();await r.api.wechatLogin()
    const id=a.workspace.put('bill',bill);await a.workspace.sync();await r.workspace.sync()
    a.workspace.put('bill',{...a.workspace.get(id),note:'另一设备的备注'},id);await a.workspace.sync()
    r.workspace.commit([{id:'payment-fixture',kind:'transaction',values:{...bill,direction:'expense'}},{id,kind:'bill',values:{...r.workspace.get(id),date:'2027-02-28'}}])
    await r.workspace.sync();expect(r.workspace.read().status).toBe('conflict')
    await r.workspace.resolveConflict(true)
    const calls=r.wx.cloud.callFunction.mock.calls.filter(([request])=>request.data.action==='commit')
    expect(calls.at(-1)[0].data.payload.operations).toHaveLength(2)
    expect((await r.api.personalRequest('list')).records).toHaveLength(2)
  })
  it('删除通过墓碑同步，旧设备不能把删除项重新拉回来',async()=>{
    const b=backend(),a=b.client(),r=b.client();await a.api.wechatLogin();await r.api.wechatLogin()
    const id=a.workspace.put('task',task('稍后删除的虚构待办'));await a.workspace.sync();await r.workspace.sync()
    a.workspace.remove(id);await a.workspace.sync();await r.workspace.sync()
    expect(r.workspace.get(id)).toBeNull()
    expect(r.workspace.all()).toHaveLength(0)
  })
  it('慢响应不会把原账号记录写进切换后的空间',async()=>{
    const b=backend(),r=b.client();await r.api.wechatLogin();r.workspace.put('task',task('原账号的虚构待办'))
    const original=r.wx.cloud.callFunction;let release
    r.wx.cloud.callFunction=async request=>{if(request.data.action==='commit')await new Promise(resolve=>{release=resolve});return original(request)}
    const pending=r.workspace.sync();await Promise.resolve();await Promise.resolve();await r.api.signOut();release();await pending
    expect(r.workspace.all()).toHaveLength(0)
  })
})

describe('完整工作台页面行为',()=>{
  it('底栏与网页版的五个工作区一致，所有入口都有实际页面',()=>{
    const app=JSON.parse(readFileSync(new URL('../miniprogram/app.json',import.meta.url),'utf8'))
    expect(app.tabBar.custom).toBe(true)
    expect(app.tabBar.list.map(row=>row.text)).toEqual(['今天','学习','记录','校园','更多'])
    for(const name of ['home','learning','record','more','editor','collection','focus','insights','settings','data'])expect(app.pages).toContain(`pages/${name}/index`)
  })
  it('新建待办 → 今天聚合 → 完成 → 学习页状态一致',async()=>{
    const r=createMiniRuntime();const editor=r.page('editor');editor.onLoad({kind:'task'});editor.input(input('title','完成虚构高数作业'));editor.input(input('dueDate','2026-10-16'));await editor.save()
    expect(editor.data.error).toBe('');expect(r.wx.navigateBack).toHaveBeenCalled()
    const home=r.page('home');home.build();expect(home.data.tasks[0].title).toBe('完成虚构高数作业')
    home.toggle(event({id:home.data.tasks[0].id}));const learning=r.page('learning');learning.setData({filter:'done'});learning.build();expect(learning.data.tasks).toHaveLength(1)
  })
  it('课表遵守周次、单双周与星期，今天时间线和课程进度关联同一记录',()=>{
    const r=createMiniRuntime();r.workspace.put('settings',{theme:'blue',termStart:'2026-10-05'},'preferences')
    const id=r.workspace.put('course',{...course,parity:'even'})
    r.workspace.put('task',{...task('虚构课程作业'),courseId:id,spentSeconds:1800})
    expect(r.ui.coursesOn('2026-10-16')).toHaveLength(1)
    expect(r.ui.coursesOn('2026-10-09')).toHaveLength(0)
    const learning=r.page('learning');learning.build();expect(learning.data.courseProgress[0].minutes).toBe(30)
    const home=r.page('home');home.build();expect(home.data.agenda[0].title).toBe(course.title)
  })
  it('表单打开后被其他设备更新时，保存不会覆盖新版本',async()=>{
    const b=backend(),a=b.client(),r=b.client();await a.api.wechatLogin();await r.api.wechatLogin()
    const id=a.workspace.put('task',task('旧虚构标题'));await a.workspace.sync();await r.workspace.sync()
    const editor=r.page('editor');editor.onLoad({kind:'task',id})
    a.workspace.put('task',{...a.workspace.get(id),title:'另一设备的新标题'},id);await a.workspace.sync();await r.workspace.sync()
    editor.input(input('title','旧表单内容'));await editor.save()
    expect(editor.data.error).toContain('编辑期间已更新')
    expect(r.workspace.get(id).title).toBe('另一设备的新标题')
    expect(r.wx.navigateBack).not.toHaveBeenCalled()
  })
  it('表单打开后切换空间不会把旧内容保存进另一账号',async()=>{
    const b=backend(),r=b.client();const editor=r.page('editor');editor.onLoad({kind:'note'});editor.input(input('title','虚构本机笔记'));editor.input(input('body','原本只打算留在访客空间。'));await r.api.wechatLogin();await editor.save()
    expect(editor.data.error).toContain('空间已切换');expect(r.workspace.all()).toHaveLength(0)
  })
  it('恢复文件的确认框期间切换账号，不会导入新账号',async()=>{
    const b=backend(),r=b.client();const source=createMiniRuntime();source.workspace.put('task',task('虚构访客备份'))
    r.files.set('/fictional/import.json',source.workspace.exportBackup());r.wx.chooseMessageFile.mockResolvedValue({tempFiles:[{path:'/fictional/import.json',size:500}]})
    r.wx.showModal.mockImplementation(async()=>{await r.api.wechatLogin();return{confirm:true}})
    const page=r.page('data');await page.importFile();expect(page.data.error).toContain('空间已切换');expect(r.workspace.all()).toHaveLength(0)
  })
  it('设置表单在同版本的另一个空间中不能保存，重新打开使用新空间默认值',async()=>{
    const b=backend(),r=b.client();r.workspace.put('settings',{theme:'green',campus:'虚构访客校区'},'preferences')
    await r.api.wechatLogin();r.workspace.put('settings',{theme:'purple',campus:'虚构账号校区'},'preferences')
    const page=r.page('settings');page.onShow();await r.api.signOut();page.save()
    expect(page.data.error).toContain('空间已切换');expect(r.ui.settings().campus).toBe('虚构访客校区')
    await r.api.wechatLogin();r.workspace.remove('preferences');page.onShow()
    expect(page.data.values.theme).toBe('blue');expect(page.data.values.campus).toBe('')
  })
  it('快速录入草稿在切换空间后不会自动带入新账号',async()=>{
    const b=backend(),r=b.client();const page=r.page('record');page.setData({text:'未登录空间的虚构私人想法',selected:'note'});page.preview();await r.api.wechatLogin()
    const editor=r.page('editor');editor.onLoad({kind:'note',draft:'1'})
    expect(editor.data.values.body||'').toBe('');expect(editor.data.error).toContain('空间已切换')
  })
  it('固定账单在一月31日、二月末、三月31日保持原日期锚点',async()=>{
    const r=createMiniRuntime();const id=r.workspace.put('bill',bill);const page=r.page('collection');page.onLoad({kind:'bill'})
    await page.pay(event({id}));expect(r.workspace.get(id).date).toBe('2027-02-28');expect(r.workspace.all('transaction')).toHaveLength(1)
    await page.pay(event({id}));expect(r.workspace.get(id).date).toBe('2027-03-31');expect(r.workspace.all('transaction')).toHaveLength(2)
    expect(r.workspace.all('transaction')[0].date).toBe('2026-10-16')
  })
  it('专注暂停恢复、进展持久化、结束后回写待办且不会重复记录',async()=>{
    const r=createMiniRuntime();const id=r.workspace.put('task',task('虚构复习任务'));let focus=r.page('focus');focus.onLoad({taskId:id});focus.onShow();focus.start()
    r.clock.now+=90000;focus.pause();expect(focus.data.actual).toBe(90)
    focus.input({currentTarget:{dataset:{field:'note'}},detail:{value:'已读完虚构第一节，下次继续第二节。'}})
    focus.onUnload();focus=r.page('focus');focus.onLoad({});focus.onShow()
    expect(focus.data.note).toContain('下次继续第二节');expect(focus.data.state).toBe('paused')
    r.clock.now+=60000;focus.tick();expect(focus.data.actual).toBe(90)
    await focus.finish();await focus.finish()
    expect(r.workspace.all('focus')).toHaveLength(1)
    expect(r.workspace.get(id).spentSeconds).toBe(90)
    expect(r.workspace.all('focus')[0].note).toContain('下次继续第二节')
  })
  it('不同币种不按1比1计入人民币汇总，预算仅计算人民币支出',()=>{
    const r=createMiniRuntime();r.workspace.put('transaction',{title:'虚构午餐',amountMinor:1800,date:'2026-10-16',currency:'CNY'});r.workspace.put('transaction',{title:'虚构外币支出',amountMinor:900,date:'2026-10-16',currency:'USD'});r.workspace.put('settings',{budgetMinor:10000},'preferences')
    const page=r.page('collection');page.onLoad({kind:'transaction'});page.build();expect(page.data.totals.expense).toBe('18.00');expect(page.data.totals.excluded).toBe(1);expect(page.data.totals.remaining).toBe('82.00')
  })
  it('清单编辑保留原项目完成状态，新项目可勾选',async()=>{
    const r=createMiniRuntime();const id=r.workspace.put('list',{title:'虚构出行清单',items:[{id:'item-a',title:'水杯',done:true}]});const editor=r.page('editor');editor.onLoad({kind:'list',id});editor.input(input('lines','水杯\n雨伞'));await editor.save()
    expect(r.workspace.get(id).items[0].done).toBe(true)
    const page=r.page('collection');page.onLoad({kind:'list'});page.showList(event({id}));page.toggleItem(event({id:r.workspace.get(id).items[1].id}));expect(r.workspace.get(id).items[1].done).toBe(true)
  })
  it('快速记录识别日期时间金额，但保留原文供用户确认',()=>{
    expect(parseCapture('明天 18:00 交虚构高数作业','task','2026-10-16').values).toMatchObject({dueDate:'2026-10-17',dueTime:'18:00',note:'明天 18:00 交虚构高数作业'})
    expect(parseCapture('午饭 18 元','','2026-10-16')).toMatchObject({kind:'transaction',values:{amount:'18',direction:'expense'}})
    expect(parseCapture('下周一开始虚构练习','task','2026-10-16').values.dueDate).toBe('2026-10-19')
    expect(()=>parseCapture('','','2026-10-16')).toThrow('先写下')
  })
})

describe('个人备份恢复',()=>{
  it('恢复重建课程/待办关系，并保留设置与当天心情的可查找身份',()=>{
    const source=createMiniRuntime();const cid=source.workspace.put('course',course);const tid=source.workspace.put('task',{...task('虚构关联作业'),courseId:cid});source.workspace.put('focus',{title:'虚构专注',date:'2026-10-16',durationSeconds:60,taskId:tid,courseId:cid});source.workspace.put('settings',{theme:'purple',termStart:'2026-10-05'},'preferences');source.workspace.put('mood',{date:'2026-10-16',mood:'充实'},'mood_2026-10-16')
    const target=createMiniRuntime();expect(target.workspace.restoreBackup(source.workspace.exportBackup())).toBe(5)
    const importedCourse=target.workspace.all('course')[0],importedTask=target.workspace.all('task')[0],focus=target.workspace.all('focus')[0]
    expect(importedCourse.id).not.toBe(cid);expect(importedTask.courseId).toBe(importedCourse.id);expect(focus.taskId).toBe(importedTask.id);expect(focus.courseId).toBe(importedCourse.id)
    expect(target.ui.settings().theme).toBe('purple');expect(target.workspace.get('mood_2026-10-16').mood).toBe('充实')
  })
  it('备份中的坏记录不会导致部分恢复',()=>{
    const r=createMiniRuntime();const before=JSON.stringify(r.workspace.read())
    const raw=JSON.stringify({application:'study-life-miniprogram',schema:1,records:[{...task('有效虚构待办'),id:'one',kind:'task'},{id:'bad',kind:'event',title:'无效日期',date:'2026-02-31'}]})
    expect(()=>r.workspace.restoreBackup(raw)).toThrow('日期')
    expect(JSON.stringify(r.workspace.read())).toBe(before)
  })
})
