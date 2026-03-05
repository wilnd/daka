// group.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups, createGroup, joinByInviteCode } from '../../services/group'

const app = getApp() as IAppOption

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 本地缓存的群组列表 key */
const GROUPS_CACHE_KEY = 'cachedGroups'

/** 更新本地缓存的群组列表 */
function updateCachedGroups(groups: any[]): void {
  wx.setStorageSync(GROUPS_CACHE_KEY, groups)
}

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
    // 动态主题色
    themeColor: '#34A853',
  },
  lifetimes: {
    attached() {
      this.init()
      // 检查是否是否需要自动打开加入弹窗
      if (app.globalData.shouldOpenJoinModal) {
        app.globalData.shouldOpenJoinModal = false
        this.setData({ showJoinModal: true, joinCode: '' })
      }
    },
  },
  pageLifetimes: {
    show() {
      // 同步主题色
      this.setData({ themeColor: '#34A853' })
      // 每次显示时检查授权状态
      let ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName && ui.avatarUrl) {
        let avatarUrl = ui.avatarUrl
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
          ui = { ...ui, avatarUrl }
          wx.setStorageSync('userInfo', ui)
        }
        if (!this.data.hasUserInfo) {
          this.setData({ hasUserInfo: true, userInfoStr: JSON.stringify(ui) })
        }
      }
      // 检查是否需要自动打开加入弹窗
      if (app.globalData.shouldOpenJoinModal) {
        app.globalData.shouldOpenJoinModal = false
        this.setData({ showJoinModal: true, joinCode: '' })
      }
      this.loadGroups()
    },
  },
  methods: {
    async init() {
      let ui = wx.getStorageSync('userInfo')
      this.setData({ userInfoStr: JSON.stringify(ui) })
      if (ui && ui.nickName && ui.avatarUrl) {
        let avatarUrl = ui.avatarUrl
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
          ui = { ...ui, avatarUrl }
          wx.setStorageSync('userInfo', ui)
        }
        this.setData({ hasUserInfo: true, userInfoStr: JSON.stringify(ui) })
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
        // 更新本地缓存
        updateCachedGroups(groups)
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
