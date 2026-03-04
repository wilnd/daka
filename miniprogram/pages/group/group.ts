// group.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups, createGroup, joinByInviteCode } from '../../services/group'

const app = getApp<IAppOption>()

Component({
  data: {
    hasUserInfo: false,
    userInfoStr: '',
    groups: [] as any[],
    loading: false,
    showCreateModal: false,
    showJoinModal: false,
    createName: '',
    joinCode: '',
  },
  lifetimes: {
    attached() { this.init() },
    show() { this.loadGroups() },
  },
  methods: {
    async init() {
      const ui = wx.getStorageSync('userInfo')
      this.setData({ userInfoStr: JSON.stringify(ui) })
      if (ui && ui.nickName && ui.avatarUrl) {
        this.setData({ hasUserInfo: true })
        await this.ensureOpenid()
        this.loadGroups()
      }
    },
    async ensureOpenid() {
      let openid = app.globalData.openid
      if (!openid) {
        try {
          openid = await getOpenid()
          app.globalData.openid = openid
          wx.setStorageSync('openid', openid)
        } catch (e) { console.error(e) }
      }
      return openid
    },
    async loadGroups() {
      const openid = app.globalData.openid
      if (!openid) return
      this.setData({ loading: true })
      try {
        const groups = await getMyGroups(openid)
        this.setData({ groups, loading: false })
      } catch (e) {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    showCreate() { 
      console.log('showCreate 被调用')
      this.setData({ showCreateModal: true, createName: '' }) 
    },
    hideCreate() { this.setData({ showCreateModal: false }) },
    stopPropagation() {},
    onCreateInput(e: any) { this.setData({ createName: e.detail.value }) },
    showJoin() { this.setData({ showJoinModal: true, joinCode: '' }) },
    hideJoin() { this.setData({ showJoinModal: false }) },
    onJoinInput(e: any) { this.setData({ joinCode: (e.detail.value || '').toUpperCase() }) },
    async doCreate() {
      const name = (this.data.createName || '').trim()
      if (name.length < 2 || name.length > 10) {
        wx.showToast({ title: '名称长度2-10字', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      wx.showLoading({ title: '创建中...' })
      try {
        const g = await createGroup(name, openid)
        wx.hideLoading()
        this.hideCreate()
        this.loadGroups()
        app.globalData.currentGroupId = g._id
        wx.showToast({ title: '创建成功' })
        wx.switchTab({ url: '/pages/index/index' })
      } catch (e: any) {
        wx.hideLoading()
        console.error('创建小组失败', e)
        const msg = ((e && e.errMsg) || (e && e.message) || '')
        if (msg.includes('-1') || msg.includes('system error')) {
          wx.showToast({ title: '云函数未上传或数据库未配置', icon: 'none', duration: 3000 })
        } else {
          wx.showToast({ title: '创建失败: ' + (msg || '请稍后重试'), icon: 'none' })
        }
      }
    },
    async doJoin() {
      const code = (this.data.joinCode || '').trim().toUpperCase()
      if (!code) { wx.showToast({ title: '请输入邀请码', icon: 'none' }); return }
      const openid = app.globalData.openid
      if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
      try {
        const result = await joinByInviteCode(code, openid)
        if (result.ok) {
          this.hideJoin()
          this.loadGroups()
          app.globalData.currentGroupId = (result.group as any)._id
          wx.showToast({ title: '加入成功' })
          wx.switchTab({ url: '/pages/index/index' })
        } else {
          wx.showToast({ title: result.msg || '邀请码无效', icon: 'none' })
        }
      } catch (e) {
        wx.showToast({ title: '加入失败', icon: 'none' })
      }
    },
    goDetail(e: any) {
      const id = e.currentTarget.dataset.id
      wx.navigateTo({ url: `/pages/group-detail/group-detail?id=${id}` })
    },
  },
})
