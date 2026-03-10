// group.ts
import { getOrCreateUser, getOpenid, requireLogin } from '../../services/auth'
import { getMyGroups, createGroup, joinByInviteCode, getGroupByInviteCode } from '../../services/group'

const app = getApp() as IAppOption

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 本地缓存的群组列表 key */
const GROUPS_CACHE_KEY = 'cachedGroups'

/** 用户拒绝加入的邀请码列表（取消弹窗后不再弹出） */
const DISMISSED_JOIN_CODES_KEY = 'dismissedJoinInviteCodes'

function getDismissedJoinCodes(): string[] {
  try {
    const raw = wx.getStorageSync(DISMISSED_JOIN_CODES_KEY)
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function addDismissedJoinCode(code: string): void {
  if (!code) return
  const upper = code.trim().toUpperCase()
  const list = getDismissedJoinCodes()
  if (list.includes(upper)) return
  list.push(upper)
  wx.setStorageSync(DISMISSED_JOIN_CODES_KEY, list)
}

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
    joinGroupName: '', // 根据邀请码查到的组织名，弹窗展示「加入 XXX 组织」，不展示邀请人
    inviterOpenid: '' as string, // 从分享链接带入，用于邀请业务埋点
    // 动态主题色
    themeColor: '#1ABC9C',
  },
  lifetimes: {
    attached() {
      this.init()
      this.tryApplyJoinModal()
      this.checkInviteCodeFromShare()
    },
  },
  pageLifetimes: {
    show() {
      this.setData({ themeColor: '#1ABC9C' })
      let ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName) {
        if (!this.data.hasUserInfo) {
          this.setData({ hasUserInfo: true, userInfoStr: JSON.stringify(ui) })
        }
      }
      this.tryApplyJoinModal()
      this.checkInviteCodeFromShare()
      this.loadGroups()
    },
  },
  methods: {
    async init() {
      let ui = wx.getStorageSync('userInfo')
      this.setData({ userInfoStr: JSON.stringify(ui) })
      if (ui && ui.nickName) {
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
    showJoin() { this.setData({ showJoinModal: true, joinCode: '', joinGroupName: '' }) },
    /** 本次忽略：关闭弹窗，不加入“不再提示”列表 */
    hideJoin() {
      this.setData({ showJoinModal: false })
    },
    /** 不再提示：加入 dismissed 列表并关闭弹窗 */
    dismissJoinForever() {
      const code = (this.data.joinCode || '').trim().toUpperCase()
      if (code) addDismissedJoinCode(code)
      this.setData({ showJoinModal: false })
    },
    onJoinInput(e: any) { this.setData({ joinCode: (e.detail.value || '').toUpperCase() }) },
    async doCreate() {
      const name = (this.data.createName || '').trim()
      if (name.length < 2 || name.length > 10) {
        wx.showToast({ title: '名称长度2-10字', icon: 'none' })
        return
      }
      const openid = requireLogin()
      if (!openid) return
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
        console.error('创建组织失败', e)
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
      const openid = requireLogin()
      if (!openid) return
      try {
        const result = await joinByInviteCode(code, openid, this.data.inviterOpenid || undefined)
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
    /** 若有待加入群组（登录后从首页跳转过来），先拉群列表判断是否已在群内、是否曾拒绝，未在且未拒绝则弹出加入弹窗；弹窗仅展示组织名，不展示邀请人 */
    async tryApplyJoinModal() {
      if (!app.globalData.shouldOpenJoinModal || !app.globalData.pendingGroupInviteCode) return
      const code = String(app.globalData.pendingGroupInviteCode || '').trim().toUpperCase()
      const inviterOpenid = String(app.globalData.pendingGroupInviterOpenid || '').trim()
      app.globalData.shouldOpenJoinModal = false
      app.globalData.pendingGroupInviteCode = ''
      app.globalData.pendingGroupInviterOpenid = ''
      const openid = app.globalData.openid
      if (!openid) return
      if (getDismissedJoinCodes().includes(code)) return
      let joinGroupName = ''
      try {
        const group = await getGroupByInviteCode(code)
        if (group && group.name) joinGroupName = group.name
      } catch (_) {}
      try {
        const groups = await getMyGroups(openid)
        const alreadyIn = groups.some((g: any) => (g.inviteCode || '').toUpperCase() === code)
        if (!alreadyIn) {
          this.setData({ showJoinModal: true, joinCode: code, joinGroupName, inviterOpenid })
        }
      } catch (_) {
        this.setData({ showJoinModal: true, joinCode: code, joinGroupName, inviterOpenid })
      }
    },
    /** 检查是否有邀请码参数（从分享链接带入）；已登录、未在该群且未拒绝过该邀请时才弹窗；仅展示组织名，不展示邀请人 */
    async checkInviteCodeFromShare() {
      const openid = app.globalData.openid
      if (!openid) return
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1] as any
      const options = (cur && cur.options) ? cur.options : {}
      const inviteCode = options.inviteCode
      const inviterOpenid = options.inviterOpenid && typeof options.inviterOpenid === 'string' ? options.inviterOpenid : ''
      if (!inviteCode || typeof inviteCode !== 'string' || inviteCode.length < 4) return
      const code = inviteCode.trim().toUpperCase()
      if (getDismissedJoinCodes().includes(code)) return
      let joinGroupName = ''
      try {
        const group = await getGroupByInviteCode(code)
        if (group && group.name) joinGroupName = group.name
      } catch (_) {}
      try {
        const groups = await getMyGroups(openid)
        const alreadyIn = groups.some((g: any) => (g.inviteCode || '').toUpperCase() === code)
        if (alreadyIn) return
      } catch (_) {}
      this.setData({ showJoinModal: true, joinCode: code, joinGroupName, inviterOpenid })
    },
    // 分享给好友
    onShareAppMessage() {
      return {
        title: '快来加入我的组织，一起坚持打卡吧！',
        path: '/pages/group/group',
        imageUrl: ''
      }
    },
  },
})
