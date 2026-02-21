// index.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { doCheckin, isCheckedToday } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays } from '../../services/stats'

const app = getApp<IAppOption>()
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    showSwitchModal: false,
    hasUserInfo: false,
    userInfo: { avatarUrl: defaultAvatar, nickName: '' },
    currentGroup: null as any,
    groups: [] as any[],
    checkedToday: false,
    stats: null as { streak: number; totalDays: number; missStreak: number } | null,
    loading: false,
  },
  lifetimes: {
    attached() {
      this.init()
    },
    show() {
      if (this.data.hasUserInfo) this.loadData()
    },
  },
  methods: {
    async init() {
      const ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName && ui.avatarUrl) {
        this.setData({ hasUserInfo: true, userInfo: ui, loading: true })
        await this.ensureOpenid()
        this.loadData()
        return
      }
      const canUse = wx.canIUse('button.open-type.chooseAvatar')
      if (!canUse) {
        wx.showToast({ title: '请升级微信版本', icon: 'none' })
      }
    },
    async ensureOpenid() {
      let openid = app.globalData.openid
      if (!openid) {
        try {
          openid = await getOpenid()
          app.globalData.openid = openid
          wx.setStorageSync('openid', openid)
        } catch (e: any) {
          const msg = e?.errMsg || ''
          if (msg.includes('-601034') || msg.includes('没有权限')) {
            wx.showModal({
              title: '请先开通云开发',
              content: '点击开发者工具顶部「云开发」开通并创建环境，然后将 cloud-init.ts 中的 env 改为你的环境 ID',
              showCancel: false,
            })
          }
          return undefined
        }
      }
      return openid
    },
    async loadData() {
      const openid = app.globalData.openid
      if (!openid) return
      this.setData({ loading: true })
      try {
        const groups = await getMyGroups(openid)
        const gid = app.globalData.currentGroupId
        let cur = groups.find((g: any) => g._id === gid) || groups[0] || null
        if (cur && !gid) app.globalData.currentGroupId = cur._id

        let checkedToday = false
        let stats = null
        if (cur) {
          checkedToday = await isCheckedToday(openid, cur._id)
          const [streak, totalDays, missStreak] = await Promise.all([
            getStreak(openid, cur._id),
            getTotalDays(openid, cur._id),
            getMissStreak(openid, cur._id),
          ])
          stats = { streak, totalDays, missStreak }
        }
        this.setData({
          groups,
          currentGroup: cur,
          checkedToday,
          stats,
          loading: false,
        })
      } catch (e) {
        console.error(e)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    onChooseAvatar(e: any) {
      const { avatarUrl } = e.detail
      this.setData({ 'userInfo.avatarUrl': avatarUrl || this.data.userInfo.avatarUrl })
    },
    onNicknameBlur(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'userInfo.nickName': nickName })
    },
    async onConfirmAuth() {
      const { nickName, avatarUrl } = this.data.userInfo
      if (!nickName || !avatarUrl) {
        wx.showToast({ title: '请填写昵称并选择头像', icon: 'none' })
        return
      }
      wx.showLoading({ title: '登录中' })
      try {
        const openid = await this.ensureOpenid()
        if (!openid) throw new Error('获取 openid 失败')
        await getOrCreateUser(openid, nickName, avatarUrl)
        wx.setStorageSync('userInfo', { nickName, avatarUrl })
        this.setData({ hasUserInfo: true })
        this.loadData()
        wx.showToast({ title: '登录成功' })
      } catch (e) {
        wx.showToast({ title: '授权失败，请稍后重试', icon: 'none' })
      }
    },
    showSwitchGroup() {
      if (this.data.groups.length === 0) {
        wx.navigateTo({ url: '/pages/group/group' })
        return
      }
      this.setData({ showSwitchModal: true })
    },
    hideSwitchGroup() { this.setData({ showSwitchModal: false }) },
    selectGroup(e: any) {
      const id = e.currentTarget.dataset.id
      app.globalData.currentGroupId = id
      const g = this.data.groups.find((x: any) => x._id === id)
      this.setData({
        currentGroup: g || null,
        showSwitchModal: false,
      })
      this.loadData()
    },
    async onCheckin() {
      const { currentGroup } = this.data
      if (!currentGroup) return
      wx.showModal({
        title: '确认打卡',
        content: '确认今日已运动打卡？',
        success: async (res) => {
          if (!res.confirm) return
          try {
            const r = await doCheckin(app.globalData.openid!, currentGroup._id)
            if (r.ok) {
              this.setData({ checkedToday: true })
              this.loadData()
              wx.showToast({ title: '打卡成功' })
            } else {
              wx.showToast({ title: r.msg || '打卡失败', icon: 'none' })
            }
          } catch {
            wx.showToast({ title: '打卡失败，请稍后重试', icon: 'none' })
          }
        },
      })
    },
  },
})
