// app.ts
import './cloud-init' // 必须最先执行，初始化云开发
import { getOpenid } from './services/auth'

App<IAppOption>({
  globalData: {
    openid: '',
    currentGroupId: '',
  },
  onLaunch() {
    this.checkAuth()
  },
  async checkAuth() {
    const token = wx.getStorageSync('openid')
    if (token) {
      this.globalData.openid = token
      return
    }
    try {
      const openid = await getOpenid()
      this.globalData.openid = openid
      wx.setStorageSync('openid', openid)
    } catch (e: any) {
      const msg = e?.errMsg || ''
      if (msg.includes('-601034') || msg.includes('没有权限')) {
        wx.showModal({
          title: '请先开通云开发',
          content: '1. 点击开发者工具顶部「云开发」\n2. 开通并创建环境\n3. 右键 cloud/login 上传云函数\n4. 将 cloud-init.ts 中 env 改为你的环境 ID',
          showCancel: false,
        })
      } else {
        console.warn('获取 openid 失败', e)
      }
    }
  },
})
