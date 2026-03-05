// index.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { doCheckinWithContent, isCheckedToday } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays, getTotalCount, getDayRank, getWeekRank, getMonthRank, RankUser } from '../../services/stats'
import { getYesterdayCheckin } from '../../services/theme'

const app = getApp() as IAppOption
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 本地缓存的群组列表 key */
const GROUPS_CACHE_KEY = 'cachedGroups'

/** 从本地缓存获取群组列表 */
function getCachedGroups(): any[] {
  try {
    const cached = wx.getStorageSync(GROUPS_CACHE_KEY)
    return cached || []
  } catch {
    return []
  }
}

/** 保存群组列表到本地缓存 */
function setCachedGroups(groups: any[]): void {
  wx.setStorageSync(GROUPS_CACHE_KEY, groups)
}

/** 将云存储 fileID 转换为临时可访问的 HTTP URL */
async function convertCloudUrl(fileId: string): Promise<string> {
  if (!fileId) return defaultAvatar
  if (!fileId.startsWith('cloud://')) return fileId
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList[0]) {
      // 检查是否有错误
      if (res.fileList[0].status !== 0) {
        console.warn('云存储文件获取失败:', res.fileList[0].errMsg || '未知错误')
        return defaultAvatar  // 返回默认头像
      }
      if (res.fileList[0].tempFileURL) {
        return res.fileList[0].tempFileURL
      }
    }
  } catch (e) {
    console.warn('转换云存储URL失败', e)
  }
  return defaultAvatar  // 转换失败返回默认头像
}

/** 批量转换排行榜头像 URL */
async function convertRankAvatarUrls(rankList: RankUser[]): Promise<RankUser[]> {
  if (!rankList || rankList.length === 0) return rankList
  // 收集需要转换的 cloud:// URL
  const cloudUrls: string[] = []
  const urlIndexMap = new Map<string, number>()
  for (let i = 0; i < rankList.length; i++) {
    const url = rankList[i].avatarUrl
    if (url && url.startsWith('cloud://')) {
      cloudUrls.push(url)
      urlIndexMap.set(url, i)
    }
  }
  if (cloudUrls.length === 0) return rankList
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: cloudUrls })
    for (const item of res.fileList || []) {
      // 只处理成功的文件，失败的返回默认头像
      if (item.status === 0 && item.fileID && item.tempFileURL) {
        const idx = urlIndexMap.get(item.fileID)
        if (idx !== undefined) {
          rankList[idx].avatarUrl = item.tempFileURL
        }
      }
    }
  } catch (e) {
    console.warn('批量转换排行榜头像URL失败', e)
  }
  return rankList
}

Component({
  data: {
    showSwitchModal: false,
    hasUserInfo: false,
    userInfo: { avatarUrl: defaultAvatar, nickName: '' },
    currentGroup: null as any,
    groups: [] as any[],
    checkedToday: false,
    stats: null as { streak: number; totalDays: number; totalCount: number; missStreak: number } | null,
    loading: false,
    checkinAnimating: false,
    // 排行榜
    rankType: 'day' as 'day' | 'week' | 'month',
    rankList: [] as RankUser[],
    rankLoading: false,
    // 动态主题色
    themeColor: '#34A853',
    // 定时刷新
    rankTimer: null as any,
  },
  lifetimes: {
    attached() {
      this.init()
      // 启动排行榜定时刷新（每5秒）
      this.startRankAutoRefresh()
    },
    detached() {
      // 页面销毁时清除定时器
      this.stopRankAutoRefresh()
    },
  },
  pageLifetimes: {
    show() {
      // 同步主题色
      this.setData({
        themeColor: app.globalData.themeColor
      })
      // 每次页面显示时都强制刷新数据，确保补卡后能更新
      this.loadData(true)
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
        } else if (avatarUrl.startsWith('cloud://')) {
          // 转换云存储 URL 为临时 HTTP URL
          avatarUrl = await convertCloudUrl(avatarUrl)
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
          const msg = (e && e.errMsg) || ''
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
    async loadData(forceRefresh = false) {
      const openid = app.globalData.openid
      if (!openid) return

      // 如果不是强制刷新，且已有数据，则跳过（用于 attached 初始化）
      if (!forceRefresh && this.data.currentGroup && this.data.stats) {
        return
      }

      // 优先从本地缓存加载群组列表
      const cachedGroups = getCachedGroups()
      if (cachedGroups.length > 0) {
        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        let cur = cachedGroups.find((g: any) => g._id === defaultGroupId)
          || cachedGroups.find((g: any) => g._id === globalGroupId)
          || cachedGroups[0]
          || null
        if (cur) {
          this.setData({
            groups: cachedGroups,
            currentGroup: cur,
          })
        }
      }

      this.setData({ loading: true })
      try {
        // 从服务器获取最新群组列表
        const groups = await getMyGroups(openid)
        // 保存到本地缓存
        setCachedGroups(groups)

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
          const [streak, totalDays, totalCount, missStreak] = await Promise.all([
            getStreak(openid, cur._id),
            getTotalDays(openid, cur._id),
            getTotalCount(openid, cur._id),
            getMissStreak(openid, cur._id),
          ])
          stats = { streak, totalDays, totalCount, missStreak }
          rankList = await getDayRank(cur._id)
          // 转换排行榜头像 URL
          rankList = await convertRankAvatarUrls(rankList)

          // 更新全局主题
          const checkedYesterday = await getYesterdayCheckin(openid)
          app.updateTheme(checkedToday, checkedYesterday)
        }
        this.setData({
          groups,
          currentGroup: cur,
          checkedToday,
          stats,
          rankList,
          loading: false,
          themeColor: app.globalData.themeColor,
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
      wx.switchTab({ url: '/pages/group/group' })
    },
    goJoinGroup() {
      this.setData({ showSwitchModal: false })
      // 设置标志位，通知小组页面打开加入弹窗
      const app = getApp() as IAppOption
      app.globalData.shouldOpenJoinModal = true
      wx.switchTab({ url: '/pages/group/group' })
    },
    hideSwitchGroup() { this.setData({ showSwitchModal: false }) },
    stopPropagation() {},
    // 启动排行榜定时刷新
    startRankAutoRefresh() {
      this.stopRankAutoRefresh()
      this.data.rankTimer = setInterval(() => {
        this.refreshRankList()
      }, 5000)
    },
    // 停止排行榜定时刷新
    stopRankAutoRefresh() {
      if (this.data.rankTimer) {
        clearInterval(this.data.rankTimer)
        this.data.rankTimer = null
      }
    },
    // 刷新排行榜数据
    async refreshRankList() {
      const { currentGroup, rankType } = this.data
      if (!currentGroup) return

      try {
        let rankList: RankUser[] = []
        if (rankType === 'day') rankList = await getDayRank(currentGroup._id)
        else if (rankType === 'week') rankList = await getWeekRank(currentGroup._id)
        else rankList = await getMonthRank(currentGroup._id)
        // 转换排行榜头像 URL
        rankList = await convertRankAvatarUrls(rankList)
        this.setData({ rankList })
      } catch (e) {
        console.error('刷新排行榜失败', e)
      }
    },
    async switchRank(e: any) {
      const type = e.currentTarget.dataset.type as 'day' | 'week' | 'month'
      if (!this.data.currentGroup) return
      this.setData({ rankType: type, rankLoading: true })
      try {
        let rankList: RankUser[] = []
        if (type === 'day') rankList = await getDayRank(this.data.currentGroup._id)
        else if (type === 'week') rankList = await getWeekRank(this.data.currentGroup._id)
        else rankList = await getMonthRank(this.data.currentGroup._id)
        // 转换排行榜头像 URL
        rankList = await convertRankAvatarUrls(rankList)
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
      const { currentGroup, checkinAnimating, groups } = this.data
      if (checkinAnimating) return

      // 构建打卡URL，可选传入当前选中的小组用于排名对比
      const groupId = currentGroup ? currentGroup._id : (groups[0] ? groups[0]._id : '')
      const groupName = currentGroup ? currentGroup.name : (groups[0] ? groups[0].name : '')

      // 支持多次打卡，始终使用创建模式
      wx.navigateTo({
        url: `/pages/checkin/checkin?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`
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
