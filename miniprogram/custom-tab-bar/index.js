Component({
  data: { selected: 0, primary: '#3d63d8', tabs: [
    { label: '今天', icon: 'today', path: '/pages/home/index' },
    { label: '学习', icon: 'learn', path: '/pages/learning/index' },
    { label: '记录', icon: 'plus', path: '/pages/record/index' },
    { label: '校园', icon: 'campus', path: '/pages/campus/index' },
    { label: '更多', icon: 'more', path: '/pages/more/index' },
  ] },
  methods: { switchTab(event) { const index = Number(event.currentTarget.dataset.index); const tab = this.data.tabs[index]; if (tab) wx.switchTab({ url: tab.path }) } },
})
