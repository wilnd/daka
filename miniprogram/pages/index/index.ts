// index.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { doCheckinWithContent, isCheckedToday } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays, getDayRank, getWeekRank, getMonthRank, RankUser } from '../../services/stats'

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
    checkinAnimating: false,
    // 排行榜
    rankType: 'day' as 'day' | 'week' | 'month',
    rankList: [] as RankUser[],
    rankLoading: false,
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
        let avatarUrl = ui.avatarUrl
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
        }
        const userInfo = { ...ui, avatarUrl }
        wx.setStorageSync('userInfo', userInfo)
        this.setData({ hasUserInfo: true, userInfo, loading: true })
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
        // 优先使用本地存储的默认群组ID，否则使用全局选中的，再否则使用第一个加入的群组
        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        let cur = groups.find((g: any) => g._id === defaultGroupId) 
          || groups.find((g: any) => g._id === globalGroupId) 
          || groups[0] 
          || null
        // 如果当前群组不是默认群组，保存为默认群组
        if (cur && !defaultGroupId) {
          wx.setStorageSync('defaultGroupId', cur._id)
        }

        let checkedToday = false
        let stats = null
        let rankList: RankUser[] = []
        if (cur) {
          checkedToday = await isCheckedToday(openid, cur._id)
          const [streak, totalDays, missStreak] = await Promise.all([
            getStreak(openid, cur._id),
            getTotalDays(openid, cur._id),
            getMissStreak(openid, cur._id),
          ])
          stats = { streak, totalDays, missStreak }
          rankList = await getDayRank(cur._id)
        }
        this.setData({
          groups,
          currentGroup: cur,
          checkedToday,
          stats,
          rankList,
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
    async uploadAvatarIfNeeded(avatarUrl: string, openid: string): Promise<string> {
      // 如果已经是云存储路径，直接返回
      if (avatarUrl.startsWith('cloud://')) {
        return avatarUrl
      }
      // 如果是本地临时路径，需要上传到云存储
      if (avatarUrl.startsWith('/tmp/') || avatarUrl.startsWith('http://tmp/') || avatarUrl.startsWith('wxfile://')) {
        try {
          const cloudPath = `avatars/${openid}/${Date.now()}.jpg`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: avatarUrl,
          })
          return uploadRes.fileID
        } catch (e) {
          console.error('头像上传失败', e)
          return avatarUrl
        }
      }
      return avatarUrl
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
        // 如果选择了新头像，先上传到云存储
        const savedAvatarUrl = await this.uploadAvatarIfNeeded(avatarUrl, openid)
        await getOrCreateUser(openid, nickName, savedAvatarUrl)
        wx.setStorageSync('userInfo', { nickName, avatarUrl: savedAvatarUrl })
        this.setData({ hasUserInfo: true, userInfo: { ...this.data.userInfo, avatarUrl: savedAvatarUrl } })
        this.loadData()
        wx.showToast({ title: '登录成功' })
      } catch (e) {
        wx.showToast({ title: '授权失败，请稍后重试', icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },
    showSwitchGroup() {
      if (this.data.groups.length === 0) {
        wx.navigateTo({ url: '/pages/group/group' })
        return
      }
      this.setData({ showSwitchModal: true })
    },
    goCreateGroup() {
      this.setData({ showSwitchModal: false })
      wx.navigateTo({ url: '/pages/group/group' })
    },
    goJoinGroup() {
      this.setData({ showSwitchModal: false })
      wx.navigateTo({ url: '/pages/group/group?tab=join' })
    },
    hideSwitchGroup() { this.setData({ showSwitchModal: false }) },
    stopPropagation() {},
    async switchRank(e: any) {
      const type = e.currentTarget.dataset.type as 'day' | 'week' | 'month'
      if (!this.data.currentGroup) return
      this.setData({ rankType: type, rankLoading: true })
      try {
        let rankList: RankUser[] = []
        if (type === 'day') rankList = await getDayRank(this.data.currentGroup._id)
        else if (type === 'week') rankList = await getWeekRank(this.data.currentGroup._id)
        else rankList = await getMonthRank(this.data.currentGroup._id)
        this.setData({ rankList, rankLoading: false })
      } catch (e) {
        this.setData({ rankLoading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    selectGroup(e: any) {
      const id = e.currentTarget.dataset.id
      const isSetDefault = e.currentTarget.dataset.setDefault
      const g = this.data.groups.find((x: any) => x._id === id)
      if (!g) return

      // 设置为默认群组
      if (isSetDefault) {
        wx.setStorageSync('defaultGroupId', id)
        app.globalData.currentGroupId = id
        wx.showToast({ title: '已设为默认', icon: 'none' })
      } else {
        app.globalData.currentGroupId = id
      }

      this.setData({
        currentGroup: g,
        showSwitchModal: false,
      })
      this.loadData()
    },
    // 设置默认群组
    setDefaultGroup(e: any) {
      const id = e.currentTarget.dataset.id
      wx.setStorageSync('defaultGroupId', id)
      app.globalData.currentGroupId = id
      const g = this.data.groups.find((x: any) => x._id === id)
      this.setData({
        currentGroup: g,
        showSwitchModal: false,
      })
      wx.showToast({ title: '已设为默认', icon: 'none' })
      this.loadData()
    },
    async onCheckin() {
      const { currentGroup, checkinAnimating, checkedToday } = this.data
      if (!currentGroup || checkinAnimating) return
      
      // 已打卡：进入更新模式；未打卡：进入发布模式
      wx.navigateTo({
        url: checkedToday
          ? `/pages/checkin/checkin?mode=edit&groupId=${currentGroup._id}&groupName=${encodeURIComponent(currentGroup.name)}`
          : `/pages/checkin/checkin?groupId=${currentGroup._id}&groupName=${encodeURIComponent(currentGroup.name)}`
      })
    },

    onUpdateCheckin() {
      const { currentGroup, checkedToday, checkinAnimating } = this.data
      if (!currentGroup || !checkedToday || checkinAnimating) return
      wx.navigateTo({
        url: `/pages/checkin/checkin?mode=edit&groupId=${currentGroup._id}&groupName=${encodeURIComponent(currentGroup.name)}`
      })
    },
    // 查看用户朋友圈
    onViewUserMoments(e: any) {
      const { userId, nickName, avatarUrl } = e.currentTarget.dataset
      if (!userId) {
        wx.showToast({ title: '无法查看', icon: 'none' })
        return
      }

      // 编码参数
      const params = [
        `userId=${encodeURIComponent(userId)}`,
        `nickName=${encodeURIComponent(nickName || '')}`,
        `avatarUrl=${encodeURIComponent(avatarUrl || '')}`
      ].join('&')

      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
  },
})
