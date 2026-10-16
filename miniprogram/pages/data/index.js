const workspace=require('../../utils/workspace')
const api=require('../../utils/api')
const ui=require('../../utils/presentation')
Page({
  data:{themeStyle:'',error:'',notice:'',count:0,sync:{},loggedIn:false,busy:false},
  onShow(){this.build();ui.present(this)},
  build(){this.setData({count:workspace.all().length,sync:workspace.summary(),loggedIn:api.isLoggedIn()})},
  async synchronize(){if(this.data.busy)return;this.setData({busy:true,error:''});try{await workspace.sync();this.build()}catch(error){ui.message(this,error)}finally{this.setData({busy:false})}},
  async exportFile(){
    try{const filename=`三两事-小程序备份-${ui.localDate()}.json`;const path=`${wx.env.USER_DATA_PATH}/${filename}`;wx.getFileSystemManager().writeFileSync(path,workspace.exportBackup(),'utf8');if(wx.shareFileMessage)await wx.shareFileMessage({filePath:path,fileName:filename});this.setData({notice:'备份文件已生成。请选择自己信任的位置保存，其中包含个人记录。'})}catch(error){this.setData({error:error.errMsg||error.message||'导出未完成，请重试。'})}
  },
  async importFile(){
    const identity=workspace.identity()
    try{const result=await wx.chooseMessageFile({count:1,type:'file',extension:['json']});const file=result.tempFiles[0];if(!file||file.size>5*1024*1024)throw new Error('请选择 5 MB 以内的小程序 JSON 备份。');const raw=wx.getFileSystemManager().readFileSync(file.path,'utf8');const confirmation=await wx.showModal({title:'从备份恢复？',content:'个人记录会追加复制；设置和同一天的心情以备份为准。重复导入会产生重复记录。'});if(!confirmation.confirm)return;if(workspace.identity()!==identity)throw new Error('账号或数据空间已切换，请重新选择备份。');const count=workspace.restoreBackup(raw);this.setData({notice:`已恢复 ${count} 条记录。`});this.build();void workspace.sync()}catch(error){this.setData({error:error.errMsg||error.message||'恢复未完成。'})}
  },
  async resolve(event){
    const identity=workspace.identity()
    const keepLocal=event.currentTarget.dataset.local==='yes'
    const result=await wx.showModal({title:keepLocal?'保留本机待同步版本？':'采用云端版本？',content:keepLocal?'当前所有待同步记录将以本机内容覆盖云端对应记录。请先导出备份。':'当前所有待同步修改将被云端对应版本替换。请先导出本机备份。',confirmText:'确认处理'})
    if(!result.confirm)return
    try{if(workspace.identity()!==identity)throw new Error('账号或数据空间已切换，请重新操作。');await workspace.resolveConflict(keepLocal);this.build()}catch(error){ui.message(this,error)}
  },
})
