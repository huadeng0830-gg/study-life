const api=require('../../utils/api')
const ui=require('../../utils/presentation')
const statusLabels={pending_review:'等待审核',approved:'已公开',rejected:'未通过',removed:'已下架',withdrawn:'已撤回',pending:'待处理',resolved:'已处理',dismissed:'举报不成立'}
Page({
  data:{themeStyle:'',mode:'mine_list',items:[],page:0,hasMore:false,selected:null,title:'',body:'',error:'',notice:'',busy:false},
  onShow(){ui.present(this);this.load()},
  async load(){try{const result=await api.campusRequest(this.data.mode,{page:this.data.page});this.setData({items:result.items.map(row=>({...row,statusLabel:statusLabels[row.status]||row.status})),hasMore:result.hasMore})}catch(error){ui.message(this,error)}},
  mode(event){this.setData({mode:event.currentTarget.dataset.mode,page:0,selected:null,error:''});this.load()},
  select(event){const row=this.data.items.find(item=>item.id===event.currentTarget.dataset.id);if(row)this.setData({selected:row,title:row.title,body:row.body,error:''})},
  input(event){if(['title','body'].includes(event.currentTarget.dataset.key))this.setData({[event.currentTarget.dataset.key]:event.detail.value})},
  async save(){if(this.data.busy)return;this.setData({busy:true,error:''});try{await api.campusRequest('content_resubmit',{targetId:this.data.selected.id,revision:this.data.selected.revision,title:this.data.title,body:this.data.body});this.setData({selected:null,notice:'已重新提交审核。'});await this.load()}catch(error){ui.message(this,error)}finally{this.setData({busy:false})}},
  async withdraw(event){const row=this.data.items.find(item=>item.id===event.currentTarget.dataset.id);const result=await wx.showModal({title:'撤回这条校园投稿？',content:'撤回后不再公开显示。'});if(!result.confirm)return;try{await api.campusRequest('content_withdraw',{targetId:row.id,revision:row.revision});await this.load()}catch(error){ui.message(this,error)}},
  next(){if(this.data.hasMore){this.setData({page:this.data.page+1});this.load()}},previous(){if(this.data.page){this.setData({page:this.data.page-1});this.load()}},
})
