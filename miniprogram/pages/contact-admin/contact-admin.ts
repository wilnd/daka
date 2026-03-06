Component({
  data: {
    wechatId: 'ch668816888',
    // 动态主题色
    themeColor: '#1ABC9C',
  },
  lifetimes: {
    attached() {
      // 同步主题色
      this.setData({
        themeColor: '#1ABC9C'
      })
    },
  },
  methods: {
    copyWechatId() {
      const id = this.data.wechatId
      wx.setClipboardData({
        data: id,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
        fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
      })
    },
    showGuide() {
      wx.showModal({
        title: '添加方式',
        content: `已为你准备好微信号：${this.data.wechatId}\n\n打开微信 → 顶部搜索 → 粘贴微信号 → 添加到通讯录`,
        showCancel: false,
      })
    },
  },
})

