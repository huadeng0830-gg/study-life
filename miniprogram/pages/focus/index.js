const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
Page({
  data:{themeStyle:'',title:'',minutes:'25',choices:[15,25,45,60],state:'idle',clock:'25:00',tasks:[],taskIndex:0,note:'',error:'',actual:0},
  onLoad(options) { const tasks=[{id:'',title:'不关联待办'},...workspace.all('task').filter(row=>!row.completed)]; this.setData({tasks,taskIndex:Math.max(0,tasks.findIndex(row=>row.id===options.taskId))}); this.key=workspace.identity() },
  onShow() { ui.present(this); const next=workspace.identity(); if(this.key!==next)this.setData({title:'',tasks:[{id:'',title:'不关联待办'},...workspace.all('task').filter(row=>!row.completed)],taskIndex:0,error:''}); this.key=next; this.restore(); this.timer=setInterval(()=>this.tick(),1000) },
  onHide() { clearInterval(this.timer) },
  onUnload() { clearInterval(this.timer) },
  storageKey() { return `study-life-focus:${this.key}` },
  restore() { try { this.run=wx.getStorageSync(this.storageKey())||null; if(this.run) this.setData({title:this.run.title,note:this.run.note||'',state:this.run.state,taskIndex:Math.max(0,this.data.tasks.findIndex(row=>row.id===this.run.taskId))}); else this.setData({state:'idle',note:'',clock:`${this.data.minutes}:00`}); this.tick() } catch(error) { ui.message(this,error) } },
  choose(event) { if(this.run) return; this.setData({minutes:String(event.currentTarget.dataset.minutes),clock:`${event.currentTarget.dataset.minutes}:00`}) },
  input(event) { const field=event.currentTarget.dataset.field; if(['title','minutes','note'].includes(field)) { this.setData({[field]:event.detail.value}); if(field==='note'&&this.run) { try { const next={...this.run,note:event.detail.value};wx.setStorageSync(this.storageKey(),next);this.run=next }catch(error){ui.message(this,error)} } } },
  taskChange(event) { if(!this.run) this.setData({taskIndex:Number(event.detail.value)}) },
  tick() {
    if(!this.run) return
    const remaining=this.run.state==='running'?Math.max(0,Math.ceil((this.run.endAt-Date.now())/1000)):this.run.remaining
    this.setData({clock:`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`,state:remaining===0?'finished':this.run.state,actual:this.run.planned-remaining})
  },
  start() {
    try {
      if(workspace.identity()!==this.key) throw new Error('账号已切换，请重新打开专注。')
      const minutes=Number(this.data.minutes)
      if(!Number.isInteger(minutes)||minutes<1||minutes>180) throw new Error('专注时长请选择 1–180 分钟。')
      const task=this.data.tasks[this.data.taskIndex]
      const title=this.data.title.trim()||task?.title
      if(!title||!task?.id&&!this.data.title.trim()) throw new Error('写下专注目标，或选择一个待办。')
      const next={id:workspace.uid(),title,taskId:task?.id||'',note:'',planned:minutes*60,remaining:minutes*60,endAt:Date.now()+minutes*60000,state:'running'}
      wx.setStorageSync(this.storageKey(),next); this.run=next; this.tick()
    } catch(error) { ui.message(this,error) }
  },
  pause() { if(!this.run) return; const next={...this.run}; if(next.state==='running'){next.remaining=Math.max(0,Math.ceil((next.endAt-Date.now())/1000));next.state='paused'}else{next.endAt=Date.now()+next.remaining*1000;next.state='running'}; try{wx.setStorageSync(this.storageKey(),next);this.run=next;this.tick()}catch(error){ui.message(this,error)} },
  async finish() {
    if(!this.run) return
    this.tick()
    const seconds=this.data.actual
    if(seconds<1) { this.setData({error:'尚未产生专注时长，可以稍后再结束。'}); return }
    const result=await wx.showModal({title:'结束并记录这次专注？',content:`已专注 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒。将记录实际时长。`})
    if(!result.confirm) return
    try{
      if(workspace.identity()!==this.key) throw new Error('账号已切换，请回到原账号结束专注。')
      if(!workspace.get(this.run.id)) {
        const task=workspace.get(this.run.taskId)
        const changes=[{kind:'focus',id:this.run.id,values:{title:this.run.title,taskId:this.run.taskId,durationSeconds:seconds,date:ui.localDate(),note:this.data.note}}]
        if(task?.kind==='task') changes.push({kind:'task',id:task.id,values:{...task,spentSeconds:(task.spentSeconds||0)+seconds}})
        workspace.commit(changes)
      }
      wx.removeStorageSync(this.storageKey()); this.run=null; this.setData({state:'idle',clock:`${this.data.minutes}:00`,note:'',error:''}); void workspace.sync(); wx.showToast({title:'专注已记录',icon:'success'})
    }catch(error){ui.message(this,error)}
  },
  history(){ui.collection('focus')},
})
