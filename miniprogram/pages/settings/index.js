const workspace=require('../../utils/workspace')
const ui=require('../../utils/presentation')
Page({
  data:{themeStyle:'',error:'',themes:[{key:'blue',label:'蓝色',color:'#3d63d8'},{key:'purple',label:'紫色',color:'#7650c8'},{key:'green',label:'绿色',color:'#067654'},{key:'pink',label:'粉色',color:'#b83878'}],values:{theme:'blue',termStart:'',campus:'',season:'默认作息',budgetMinor:0},budget:''},
  onShow(){this.workspaceIdentity=workspace.identity();const row=workspace.all('settings')[0];this.recordId=row?.id||'preferences';this.loadedRevision=row?.revision||0;const values={theme:'blue',termStart:'',campus:'',season:'默认作息',budgetMinor:0,...row};this.setData({values,budget:values.budgetMinor?ui.money(values.budgetMinor):''});ui.present(this)},
  input(event){const key=event.currentTarget.dataset.key;if(['termStart','campus','season'].includes(key))this.setData({[`values.${key}`]:event.detail.value});else if(key==='budget')this.setData({budget:event.detail.value})},
  theme(event){this.setData({'values.theme':event.currentTarget.dataset.theme})},
  clearTerm(){this.setData({'values.termStart':''})},
  save(){try{if(workspace.identity()!==this.workspaceIdentity)throw new Error('账号或数据空间已切换，请重新打开设置。');if(this.data.budget&&!/^\d+(\.\d{1,2})?$/.test(this.data.budget))throw new Error('预算最多两位小数。');workspace.put('settings',{...this.data.values,budgetMinor:this.data.budget?Math.round(Number(this.data.budget)*100):0},this.recordId,this.loadedRevision);this.loadedRevision=workspace.get(this.recordId).revision;ui.present(this);void workspace.sync();wx.showToast({title:'设置已保存',icon:'success'})}catch(error){ui.message(this,error)}},
})
