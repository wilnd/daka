// index.ts
import { getOrCreateUser, getOpenid } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { doCheckinWithContent, isCheckedToday } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays, getTotalCount, getAllRank, getDayRank, getWeekRank, getMonthRank, RankUser } from '../../services/stats'
import { getYesterdayCheckin, getSimpleThemeColor } from '../../services/theme'
import { callGetMyRank, callGetGroupStats, callGetStats, callGetAchievements, RankResult, GroupStats } from '../../services/score'
import { getCachedGroups, setCachedGroups, convertRankAvatarUrls, convertCloudUrl, hexToRgb, uploadAvatarIfNeeded, defaultAvatar } from '../../services/utils'

const app = getApp() as IAppOption

/** 将十六进制颜色转换为 RGB 格式 */
// 使用 utils.ts 中的 hexToRgb 函数

/** 本地缓存的群组列表 key */
// 使用 utils.ts 中的 getCachedGroups / setCachedGroups 函数

/** 从本地缓存获取群组列表 */
// 已迁移到 utils.ts

/** 保存群组列表到本地缓存 */
// 已迁移到 utils.ts

/** 将云存储 fileID 转换为临时可访问的 HTTP URL */
// 已迁移到 utils.ts，使用 convertCloudUrl

/** 批量转换排行榜头像 URL */
// 已迁移到 utils.ts

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
    rankType: 'week' as 'all' | 'week' | 'month',
    rankList: [] as RankUser[],
    rankLoading: false,
    // 多维度排行榜
    rankDimension: 'days' as 'minutes' | 'days' | 'score',
    currentRankList: [] as any[],
    groupStats: null as GroupStats | null,
    myRank: null as RankResult | null,
    statsLoading: false,
    // 动态主题色
    themeColor: '#1ABC9C',
    themeColorRgb: '26, 188, 156',
    // 定时刷新
    rankTimer: null as any,
  },
  lifetimes: {
    attached() {
      console.log('[Index] lifetimes.attached() 组件 attached')
      // 使用动态主题色（根据时间变化）
      const dynamicColor = getSimpleThemeColor()
      const dynamicColorRgb = hexToRgb(dynamicColor)
      this.setData({ themeColor: dynamicColor, themeColorRgb: dynamicColorRgb })
      this.init()
      // 启动排行榜定时刷新（每30秒，减少不必要的网络请求）
      this.startRankAutoRefresh()
    },
    detached() {
      // 页面销毁时清除定时器
      this.stopRankAutoRefresh()
    },
  },
  pageLifetimes: {
    show() {
      console.log('[Index] pageLifetimes.show() 页面显示')
      // 使用动态主题色（根据时间变化）
      const dynamicColor = getSimpleThemeColor()
      const dynamicColorRgb = hexToRgb(dynamicColor)
      this.setData({
        themeColor: dynamicColor,
        themeColorRgb: dynamicColorRgb
      })
      // 每次页面显示时都强制刷新数据，确保补卡后能更新
      console.log('[Index] pageLifetimes.show() 准备调用 loadData(true)')
      this.loadData(true)
    },
  },
  methods: {
    async init() {
      console.log('[Index] init() 开始初始化')
      const ui = wx.getStorageSync('userInfo')
      console.log('[Index] init() 从存储获取 userInfo:', ui)
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
        console.log('[Index] init() userInfo 准备完成，准备获取 openid')
        await this.ensureOpenid()
        console.log('[Index] init() openid 获取完成，准备加载数据')
        this.loadData()
        return
      }
      const canUse = wx.canIUse('button.open-type.chooseAvatar')
      if (!canUse) {
        wx.showToast({ title: '请升级微信版本', icon: 'none' })
      }
    },
    async ensureOpenid() {
      console.log('[Index] ensureOpenid() 开始获取 openid')
      let openid = app.globalData.openid
      console.log('[Index] ensureOpenid() 当前全局 openid:', openid)
      if (!openid) {
        try {
          console.log('[Index] ensureOpenid() 调用 getOpenid()')
          openid = await getOpenid()
          console.log('[Index] ensureOpenid() getOpenid() 返回:', openid)
          app.globalData.openid = openid
          wx.setStorageSync('openid', openid)
        } catch (e: any) {
          const msg = (e && e.errMsg) || ''
          console.error('[Index] ensureOpenid() 获取 openid 失败:', e)
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
      console.log('[Index] ensureOpenid() 返回 openid:', openid)
      return openid
    },
    async loadData(forceRefresh = false) {
      console.log('[Index] loadData() 开始加载数据, forceRefresh:', forceRefresh)
      const openid = app.globalData.openid
      console.log('[Index] loadData() openid:', openid)
      if (!openid) {
        console.warn('[Index] loadData() openid 为空，直接返回')
        return
      }

      // 如果不是强制刷新，且已有数据，则跳过（用于 attached 初始化）
      if (!forceRefresh && this.data.currentGroup && this.data.stats) {
        console.log('[Index] loadData() 非强制刷新且已有数据，跳过')
        return
      }

      // 优先从本地缓存加载群组列表
      const cachedGroups = getCachedGroups()
      console.log('[Index] loadData() 本地缓存群组列表:', cachedGroups)
      if (cachedGroups.length > 0) {
        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        console.log('[Index] loadData() defaultGroupId:', defaultGroupId, 'globalGroupId:', globalGroupId)
        let cur = cachedGroups.find((g: any) => g._id === defaultGroupId)
          || cachedGroups.find((g: any) => g._id === globalGroupId)
          || cachedGroups[0]
          || null
        if (cur) {
          console.log('[Index] loadData() 从缓存设置当前群组:', cur)
          this.setData({
            groups: cachedGroups,
            currentGroup: cur,
          })
        }
      }

      this.setData({ loading: true })
      try {
        // 从服务器获取最新群组列表
        console.log('[Index] loadData() 调用 getMyGroups()')
        const groups = await getMyGroups(openid)
        console.log('[Index] loadData() getMyGroups() 返回, groups.length:', groups ? groups.length : 0)
        // 保存到本地缓存
        setCachedGroups(groups)

        // 优先使用本地存储的默认群组ID，否则使用全局选中的，再否则使用第一个加入的群组
        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        console.log('[Index] loadData() 选取群组, defaultGroupId:', defaultGroupId, 'globalGroupId:', globalGroupId)
        let cur = groups.find((g: any) => g._id === defaultGroupId)
          || groups.find((g: any) => g._id === globalGroupId)
          || groups[0]
          || null
        console.log('[Index] loadData() 选中群组:', cur)
        // 如果当前群组不是默认群组，保存为默认群组
        if (cur && !defaultGroupId) {
          wx.setStorageSync('defaultGroupId', cur._id)
        }

        let checkedToday = false
        let stats = null
        let rankList: RankUser[] = []
        if (cur) {
          console.log('[Index] loadData() 准备获取记录状态和统计数据, groupId:', cur._id)
          checkedToday = await isCheckedToday(openid, cur._id)
          console.log('[Index] loadData() isCheckedToday 返回:', checkedToday)
          const [streak, totalDays, totalCount, missStreak] = await Promise.all([
            getStreak(openid, cur._id),
            getTotalDays(openid, cur._id),
            getTotalCount(openid, cur._id),
            getMissStreak(openid, cur._id),
          ])
          stats = { streak, totalDays, totalCount, missStreak }
          console.log('[Index] loadData() 统计数据:', stats)
          rankList = await getWeekRank(cur._id)
          console.log('[Index] loadData() getWeekRank 返回, length:', rankList ? rankList.length : 0)
          // 转换排行榜头像 URL
          rankList = await convertRankAvatarUrls(rankList)

          // 获取群组统计数据和我的排名
          console.log('[Index] loadData() 调用 loadGroupStats()')
          this.loadGroupStats(openid, cur._id)

          // 更新全局主题
          const checkedYesterday = await getYesterdayCheckin(openid)
          console.log('[Index] loadData() getYesterdayCheckin 返回:', checkedYesterday)
          if (app.updateTheme) {
            app.updateTheme(checkedToday, checkedYesterday)
          }
        } else {
          console.warn('[Index] loadData() cur (当前群组) 为空，不获取记录和统计')
        }
        console.log('[Index] loadData() 准备 setData')
        this.setData({
          groups,
          currentGroup: cur,
          checkedToday,
          stats,
          rankList: rankList || [],
          loading: false,
          themeColor: app.globalData.themeColor,
        })
        console.log('[Index] loadData() setData 完成')
      } catch (e) {
        console.error('[Index] loadData() 加载失败:', e)
        this.setData({ loading: false, rankList: [], groupStats: null, myRank: null, currentRankList: [] })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    onChooseAvatar(e: any) {
      console.log('[Index] onChooseAvatar 事件:', JSON.stringify(e.detail))
      // 微信头像选择返回的头像已经是临时文件路径
      const avatarUrl = e.detail.avatarUrl
      if (avatarUrl) {
        this.setData({ 'userInfo.avatarUrl': avatarUrl })
      }
    },
    onNicknameInput(e: any) {
      console.log('[Index] onNicknameInput:', e.detail.value)
      const nickName = e.detail.value || ''
      this.setData({ 'userInfo.nickName': nickName })
    },
    onNicknameBlur(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'userInfo.nickName': nickName })
    },

    // uploadAvatarIfNeeded 已迁移到 services/utils.ts

    async onConfirmAuth() {
      const currentNickName = this.data.userInfo.nickName
      const { avatarUrl } = this.data.userInfo

      console.log('[Index] onConfirmAuth() 开始授权')
      console.log('[Index] onConfirmAuth() nickName:', currentNickName, 'avatarUrl:', avatarUrl)

      // 昵称是必填的，头像使用默认的或选择的
      if (!currentNickName || currentNickName.trim() === '') {
        wx.showToast({ title: '请填写昵称', icon: 'none' })
        return
      }

      const trimmedNickName = currentNickName.trim()
      wx.showLoading({ title: '登录中' })
      try {
        // 第一步：获取 openid
        console.log('[Index] onConfirmAuth() 第一步：获取 openid')
        const openid = await this.ensureOpenid()
        console.log('[Index] onConfirmAuth() openid:', openid)
        if (!openid) throw new Error('获取 openid 失败')

        // 第二步：上传头像
        console.log('[Index] onConfirmAuth() 第二步：上传头像')
        const savedAvatarUrl = await uploadAvatarIfNeeded(avatarUrl, openid)
        console.log('[Index] onConfirmAuth() 上传后头像:', savedAvatarUrl)

        // 第三步：创建或更新用户
        console.log('[Index] onConfirmAuth() 第三步：创建或更新用户')
        await getOrCreateUser(openid, trimmedNickName, savedAvatarUrl)
        console.log('[Index] onConfirmAuth() 用户创建/更新成功')

        // 第四步：保存到本地存储
        console.log('[Index] onConfirmAuth() 第四步：保存到本地存储')
        wx.setStorageSync('userInfo', { nickName: trimmedNickName, avatarUrl: savedAvatarUrl })

        // 第五步：更新页面状态
        console.log('[Index] onConfirmAuth() 第五步：更新页面状态')
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName: trimmedNickName, avatarUrl: savedAvatarUrl }
        })

        // 第六步：加载数据
        console.log('[Index] onConfirmAuth() 第六步：加载数据')
        app.globalData.openid = openid
        this.loadData(true)

        wx.showToast({ title: '登录成功' })
      } catch (e: any) {
        console.error('[Index] onConfirmAuth() 授权失败:', e)
        wx.showToast({ title: '授权失败: ' + (e && e.message ? e.message : '请稍后重试'), icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },
    showSwitchGroup() {
      console.log('[Index] showSwitchGroup() groups.length:', this.data.groups ? this.data.groups.length : 0)
      if (this.data.groups.length === 0) {
        console.log('[Index] showSwitchGroup() 群组为空，跳转到 group 页面')
        wx.navigateTo({ url: '/pages/group/group' })
        return
      }
      console.log('[Index] showSwitchGroup() 显示切换群组弹窗')
      this.setData({ showSwitchModal: true })
    },
    goCreateGroup() {
      console.log('[Index] goCreateGroup()')
      this.setData({ showSwitchModal: false })
      wx.switchTab({ url: '/pages/group/group' })
    },
    goJoinGroup() {
      console.log('[Index] goJoinGroup()')
      this.setData({ showSwitchModal: false })
      // 设置标志位，通知组织页面打开加入弹窗
      const app = getApp() as IAppOption
      app.globalData.shouldOpenJoinModal = true
      wx.switchTab({ url: '/pages/group/group' })
    },
    hideSwitchGroup() { this.setData({ showSwitchModal: false }) },
    stopPropagation() {},
    // 启动排行榜定时刷新
    startRankAutoRefresh() {
      this.stopRankAutoRefresh()
      // 30秒刷新一次，减少不必要的网络请求
      this.data.rankTimer = setInterval(() => {
        this.refreshRankList()
      }, 30000)
    },
    // 停止排行榜定时刷新
    stopRankAutoRefresh() {
      if (this.data.rankTimer) {
        clearInterval(this.data.rankTimer)
        this.setData({ rankTimer: null })
      }
    },
    // 刷新排行榜数据
    async refreshRankList() {
      console.log('[Index] refreshRankList() 开始刷新排行榜')
      const { currentGroup, rankType } = this.data
      console.log('[Index] refreshRankList() currentGroup:', currentGroup, 'rankType:', rankType)
      if (!currentGroup) {
        console.warn('[Index] refreshRankList() currentGroup 为空，直接返回')
        return
      }

      try {
        let rankList: RankUser[] = []
        if (rankType === 'all') rankList = await getAllRank(currentGroup._id)
        else if (rankType === 'week') rankList = await getWeekRank(currentGroup._id)
        else rankList = await getMonthRank(currentGroup._id)
        console.log('[Index] refreshRankList() 获取排行榜, length:', rankList ? rankList.length : 0)
        // 转换排行榜头像 URL
        rankList = await convertRankAvatarUrls(rankList)
        console.log('[Index] refreshRankList() 头像转换完成，准备 setData')
        this.setData({ rankList: rankList || [] })
      } catch (e) {
        console.error('[Index] refreshRankList() 刷新失败:', e)
      }
    },
    async switchRank(e: any) {
      const type = e.currentTarget.dataset.type as 'all' | 'week' | 'month'
      console.log('[Index] switchRank() 切换排行榜类型:', type)
      console.log('[Index] switchRank() currentGroup:', this.data.currentGroup)
      if (!this.data.currentGroup) return
      this.setData({ rankType: type, rankLoading: true })
      try {
        let rankList: RankUser[] = []
        if (type === 'all') rankList = await getAllRank(this.data.currentGroup._id)
        else if (type === 'week') rankList = await getWeekRank(this.data.currentGroup._id)
        else rankList = await getMonthRank(this.data.currentGroup._id)
        console.log('[Index] switchRank() 获取排行榜, length:', rankList ? rankList.length : 0)
        // 转换排行榜头像 URL
        rankList = await convertRankAvatarUrls(rankList)
        this.setData({ rankList: rankList || [], rankLoading: false })

        // 刷新群组统计数据
        const openid = app.globalData.openid
        console.log('[Index] switchRank() openid:', openid)
        if (openid) {
          console.log('[Index] switchRank() 调用 loadGroupStats()')
          this.loadGroupStats(openid, this.data.currentGroup._id)
        }
      } catch (e) {
        this.setData({ rankLoading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    // 加载群组统计数据
    async loadGroupStats(openid: string, groupId: string) {
      console.log('[Index] loadGroupStats() 开始加载, openid:', openid, 'groupId:', groupId)
      this.setData({ statsLoading: true })
      try {
        // 获取群组统计
        console.log('[Index] loadGroupStats() 调用 callGetGroupStats() 和 callGetMyRank()')
        const [groupRes, myRes] = await Promise.all([
          callGetGroupStats(groupId, this.data.rankType),
          callGetMyRank(groupId, this.data.rankType)
        ])

        console.log('[Index] loadGroupStats() callGetGroupStats 返回:', groupRes)
        console.log('[Index] loadGroupStats() callGetMyRank 返回:', myRes)

        if (groupRes.success && groupRes.stats) {
          console.log('[Index] loadGroupStats() 群组统计有效, stats:', groupRes.stats)
          this.setData({ groupStats: groupRes.stats })
          // 更新当前排行榜数据
          this.updateCurrentRankList()
        } else {
          console.warn('[Index] loadGroupStats() 群组统计无效')
          this.setData({ groupStats: null, currentRankList: [] })
        }
        if (myRes.success && myRes.rank && myRes.rank.myRank && myRes.rank.myRank.minutes != null && myRes.rank.myRank.days != null && myRes.rank.myRank.score != null) {
          console.log('[Index] loadGroupStats() 我的排名有效, rank:', myRes.rank)
          this.setData({ myRank: myRes.rank.myRank, groupPercentiles: myRes.rank.percentiles, groupAvg: myRes.rank.groupAvg, totalMembers: myRes.rank.totalMembers })
        } else {
          console.warn('[Index] loadGroupStats() 我的排名无效')
          this.setData({ myRank: null })
        }
      } catch (e) {
        console.error('[Index] loadGroupStats() 加载失败:', e)
        this.setData({ groupStats: null, myRank: null, currentRankList: [] })
      } finally {
        this.setData({ statsLoading: false })
      }
    },
    // 切换排行榜维度
    switchRankDimension(e: any) {
      const dimension = e.currentTarget.dataset.dimension as 'minutes' | 'days' | 'score'
      console.log('[Index] switchRankDimension() 切换维度:', dimension)
      this.setData({ rankDimension: dimension })
      // 更新当前显示的排行榜数据
      console.log('[Index] switchRankDimension() 调用 updateCurrentRankList()')
      this.updateCurrentRankList()
      // 刷新排行榜和统计数据
      const openid = app.globalData.openid
      console.log('[Index] switchRankDimension() openid:', openid, 'currentGroup:', this.data.currentGroup)
      if (openid && this.data.currentGroup) {
        console.log('[Index] switchRankDimension() 调用 loadGroupStats()')
        this.loadGroupStats(openid, this.data.currentGroup._id)
      }
    },
    // 更新当前显示的排行榜数据
    updateCurrentRankList() {
      console.log('[Index] updateCurrentRankList() 开始更新')
      const { groupStats, rankDimension } = this.data
      console.log('[Index] updateCurrentRankList() groupStats:', groupStats, 'rankDimension:', rankDimension)
      if (!groupStats || !groupStats.leaderboard) {
        console.warn('[Index] updateCurrentRankList() 无 leaderboard 数据')
        this.setData({ currentRankList: [] })
        return
      }

      let currentRankList: any[] = []
      if (rankDimension === 'minutes') {
        currentRankList = groupStats.leaderboard.byMinutes || []
      } else if (rankDimension === 'days') {
        currentRankList = groupStats.leaderboard.byDays || []
      } else {
        currentRankList = groupStats.leaderboard.byScore || []
      }
      console.log('[Index] updateCurrentRankList() 更新后排行榜, length:', currentRankList.length)
      this.setData({ currentRankList })
    },
    // 切换组织时刷新排行榜（只刷新排行榜，不刷新整个页面）
    async refreshRankForNewGroup(groupId: string) {
      console.log('[Index] refreshRankForNewGroup() 开始刷新排行榜, groupId:', groupId)
      const openid = app.globalData.openid
      if (!openid || !groupId) {
        console.warn('[Index] refreshRankForNewGroup() openid 或 groupId 为空')
        return
      }

      this.setData({ rankLoading: true, statsLoading: true })
      try {
        // 并行获取排行榜数据和群组统计
        const [rankList, groupRes, myRes] = await Promise.all([
          // 排行榜
          this.data.rankType === 'all' ? getAllRank(groupId)
            : this.data.rankType === 'week' ? getWeekRank(groupId)
            : getMonthRank(groupId),
          // 群组统计
          callGetGroupStats(groupId, this.data.rankType),
          // 我的排名
          callGetMyRank(groupId, this.data.rankType)
        ])

        // 转换头像 URL
        const convertedRankList = await convertRankAvatarUrls(rankList || [])

        // 更新排行榜
        this.setData({ rankList: convertedRankList })

        // 更新群组统计
        if (groupRes.success && groupRes.stats) {
          this.setData({ groupStats: groupRes.stats })
          this.updateCurrentRankList()
        } else {
          this.setData({ groupStats: null, currentRankList: [] })
        }

        // 更新我的排名
        if (myRes.success && myRes.rank && myRes.rank.myRank) {
          this.setData({
            myRank: myRes.rank.myRank,
            groupPercentiles: myRes.rank.percentiles,
            groupAvg: myRes.rank.groupAvg,
            totalMembers: myRes.rank.totalMembers
          })
        } else {
          this.setData({ myRank: null })
        }
      } catch (e) {
        console.error('[Index] refreshRankForNewGroup() 刷新失败:', e)
      } finally {
        this.setData({ rankLoading: false, statsLoading: false })
      }
    },
    selectGroup(e: any) {
      const id = e.currentTarget.dataset.id
      const isSetDefault = e.currentTarget.dataset.setDefault
      const g = this.data.groups.find((x: any) => x._id === id)
      console.log('[Index] selectGroup() 选中群组 id:', id, 'isSetDefault:', isSetDefault, '群组信息:', g)
      if (!g) {
        console.warn('[Index] selectGroup() 未找到群组')
        return
      }

      // 设置为默认群组
      if (isSetDefault) {
        wx.setStorageSync('defaultGroupId', id)
        app.globalData.currentGroupId = id
        wx.showToast({ title: '已设为默认', icon: 'none' })
      } else {
        app.globalData.currentGroupId = id
      }

      console.log('[Index] selectGroup() 准备 setData, currentGroup:', g)
      this.setData({
        currentGroup: g,
        showSwitchModal: false,
      })
      console.log('[Index] selectGroup() 准备刷新排行榜')
      this.refreshRankForNewGroup(g._id)
    },
    // 设置默认群组
    setDefaultGroup(e: any) {
      const id = e.currentTarget.dataset.id
      console.log('[Index] setDefaultGroup() 设置默认群组 id:', id)
      wx.setStorageSync('defaultGroupId', id)
      app.globalData.currentGroupId = id
      const g = this.data.groups.find((x: any) => x._id === id)
      console.log('[Index] setDefaultGroup() 群组信息:', g)
      this.setData({
        currentGroup: g,
        showSwitchModal: false,
      })
      console.log('[Index] setDefaultGroup() 准备刷新排行榜')
      this.refreshRankForNewGroup(g._id)
    },
    async onCheckin() {
      console.log('[Index] onCheckin() 点击记录')
      const { currentGroup, checkinAnimating, groups } = this.data
      console.log('[Index] onCheckin() currentGroup:', currentGroup, 'groups.length:', groups ? groups.length : 0)
      if (checkinAnimating) {
        console.warn('[Index] onCheckin() 记录动画中，忽略')
        return
      }

      // 构建记录URL，可选传入当前选中的组织用于排名对比
      const groupId = currentGroup ? currentGroup._id : (groups[0] ? groups[0]._id : '')
      const groupName = currentGroup ? currentGroup.name : (groups[0] ? groups[0].name : '')

      console.log('[Index] onCheckin() 准备跳转到记录页, groupId:', groupId, 'groupName:', groupName)
      // 支持多次记录，始终使用创建模式
      wx.navigateTo({
        url: `/pages/checkin/checkin?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`
      })
    },
    // 查看用户成长墙
    onViewUserMoments(e: any) {
      const { userId, nickName, avatarUrl } = e.currentTarget.dataset
      console.log('[Index] onViewUserMoments() userId:', userId, 'nickName:', nickName)
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

      console.log('[Index] onViewUserMoments() 准备跳转到 user-moments')
      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
  },
})
