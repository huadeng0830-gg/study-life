const workspace=require('../../utils/workspace')
const ui=require('../../utils/presentation')
Page({
  data:{themeStyle:'',month:ui.localDate().slice(0,7),stats:{},days:[],recent:[]},
  onShow(){ui.refresh(this,this.build)},
  month(event){this.setData({month:event.detail.value.slice(0,7)});this.build()},
  build(){
    const month=this.data.month;const records=workspace.all();const focuses=records.filter(row=>row.kind==='focus'&&row.date.startsWith(month));const transactions=records.filter(row=>row.kind==='transaction'&&row.date.startsWith(month)&&row.currency==='CNY');const expense=transactions.filter(row=>row.direction==='expense').reduce((sum,row)=>sum+row.amountMinor,0);const income=transactions.filter(row=>row.direction==='income').reduce((sum,row)=>sum+row.amountMinor,0)
    const count=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();const days=Array.from({length:count},(_,index)=>{const date=`${month}-${String(index+1).padStart(2,'0')}`;const minutes=Math.floor(focuses.filter(row=>row.date===date).reduce((sum,row)=>sum+row.durationSeconds,0)/60);const mood=records.find(row=>row.kind==='mood'&&row.date===date)?.mood||'';return{date,label:index+1,minutes,mood,active:minutes>0||Boolean(mood)}})
    const completed=records.filter(row=>row.kind==='task'&&row.completed&&row.updatedAt?.startsWith(month)).length
    this.setData({stats:{completed,focusMinutes:Math.floor(focuses.reduce((sum,row)=>sum+row.durationSeconds,0)/60),focusCount:focuses.length,expense:ui.money(expense),income:ui.money(income),notes:records.filter(row=>row.kind==='note'&&row.updatedAt?.startsWith(month)).length},days,recent:focuses.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(row=>({...row,meta:ui.meta(row)}))})
  },
})
