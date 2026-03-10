// index.ts
import { getOrCreateUser, getOpenid, LOGIN_PAGE } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { doCheckinWithContent, isCheckedToday } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays, getTotalCount, getBestStreak, getAllRank, getDayRank, getWeekRank, getMonthRank, getAllStats, RankUser } from '../../services/stats'
import { getYesterdayCheckin, getSimpleThemeColor, calculateTheme } from '../../services/theme'
import { callGetMyRank, callGetGroupStats, callGetStats, callGetAchievements, RankResult, GroupStats } from '../../services/score'
import { getCachedGroups, setCachedGroups, convertRankAvatarUrls, convertCloudUrl, hexToRgb, uploadAvatarIfNeeded, defaultAvatar, getAvatarInitial } from '../../services/utils'
import { getActiveGoals, calculateGoalProgress, getGoalStatus, Goal } from '../../services/goal'

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
    userInfo: { avatarUrl: '', nickName: '' },
    avatarInitial: '',
    currentGroup: null as any,
    groups: [] as any[],
    checkedToday: false,
    stats: null as { streak: number; totalDays: number; totalCount: number; missStreak: number; bestStreak: number; progressPercent: number } | null,
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
    // 全部群组汇总数据（用于统计对比）
    allStats: null as {
      totalMinutes: number
      totalDays: number
      avgScore: number
      totalCheckins: number
      streak: number
      bestStreak: number
    } | null,
    statsLoading: false,
    // 顶部导航栏固定绿色，动态色仅用于打卡区
    navBarColor: '#1ABC9C',
    checkinCardColor: '#1ABC9C',
    checkinCardColorRgb: '26, 188, 156',
    // 定时刷新
    rankTimer: null as any,
    // 正在进行的自律计划（首页展示前几条）
    activeGoals: [] as Array<Goal & { progress: { current: number; target: number; percent: number }; status: string }>,
  },
  lifetimes: {
    attached() {
      // 打卡区初始用时间色，loadData 后会按今日/昨日打卡状态更新
      const dynamicColor = getSimpleThemeColor()
      const dynamicColorRgb = hexToRgb(dynamicColor)
      this.setData({ checkinCardColor: dynamicColor, checkinCardColorRgb: dynamicColorRgb })
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
      const dynamicColor = getSimpleThemeColor()
      const dynamicColorRgb = hexToRgb(dynamicColor)
      this.setData({
        checkinCardColor: dynamicColor,
        checkinCardColorRgb: dynamicColorRgb
      })
      this.loadData(true)
    },
  },
  methods: {
    async init() {
      const ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName) {
        let avatarUrl = ui.avatarUrl || ''
        if (avatarUrl && !avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('http://')) {
          avatarUrl = ''
        } else if (avatarUrl && avatarUrl.startsWith('cloud://')) {
          avatarUrl = await convertCloudUrl(avatarUrl)
        }
        const userInfo = { ...ui, avatarUrl: avatarUrl || '' }
        wx.setStorageSync('userInfo', userInfo)
        this.setData({ hasUserInfo: true, userInfo: { ...userInfo, avatarUrl }, avatarInitial: getAvatarInitial(ui.nickName), loading: true })
        await this.ensureOpenid()
        this.loadData()
        const openid = app.globalData.openid
        if (openid) await this.tryBindInviteCode(openid)
        return
      }
      const canUse = wx.canIUse('button.open-type.chooseAvatar')
      if (!canUse) {
        wx.showToast({ title: '请升级微信版本', icon: 'none' })
      }
    },
    /** 若有待绑定邀请码则调用云函数绑定并清除缓存；仅新用户可绑定为下级。用户不感知被邀请，不 toast，静默处理。 */
    async tryBindInviteCode(openid: string) {
      const inviteCode = wx.getStorageSync('pendingInviteCode')
      if (!inviteCode) return
      try {
        await wx.cloud.callFunction({
          name: 'referral',
          data: { action: 'bindInvite', inviteCode }
        })
      } catch (_) {}
      wx.removeStorageSync('pendingInviteCode')
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

      if (!forceRefresh && this.data.currentGroup && this.data.stats) return

      const cachedGroups = getCachedGroups()
      if (cachedGroups.length > 0) {
        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        let cur = cachedGroups.find((g: any) => g._id === defaultGroupId)
          || cachedGroups.find((g: any) => g._id === globalGroupId)
          || cachedGroups[0]
          || null
        if (cur) {
          this.setData({ groups: cachedGroups, currentGroup: cur })
        }
      }

      this.setData({ loading: true })
      try {
        const groups = await getMyGroups(openid)
        setCachedGroups(groups)

        const defaultGroupId = wx.getStorageSync('defaultGroupId')
        const globalGroupId = app.globalData.currentGroupId
        let cur = groups.find((g: any) => g._id === defaultGroupId)
          || groups.find((g: any) => g._id === globalGroupId)
          || groups[0]
          || null
        if (cur && !defaultGroupId) wx.setStorageSync('defaultGroupId', cur._id)

        let checkedToday = false
        let stats = null
        let rankList: RankUser[] = []
        let checkinCardColor = this.data.checkinCardColor
        let checkinCardColorRgb = this.data.checkinCardColorRgb
        // 无论是否加入组织，都拉取今日打卡状态与个人统计（支持未加入组织时正常打卡与统计）
        checkedToday = await isCheckedToday(openid, cur ? cur._id : undefined)
        const allStatsData = await getAllStats(openid)
        const { streak, totalDays, totalCount, missStreak, bestStreak } = allStatsData
        const progressPercent = Math.min(100, Math.round((totalDays / 30) * 100))
        stats = { streak, totalDays, totalCount, missStreak, bestStreak, progressPercent }
        const checkedYesterday = await getYesterdayCheckin(openid)
        if (app.updateTheme) app.updateTheme(checkedToday, checkedYesterday)
        const cardTheme = calculateTheme(checkedToday, checkedYesterday)
        if (checkedToday) {
          checkinCardColor = '#1ABC9C'
          checkinCardColorRgb = '26, 188, 156'
        } else {
          checkinCardColor = cardTheme.color
          checkinCardColorRgb = hexToRgb(cardTheme.color)
        }
        if (cur) {
          rankList = await getWeekRank(cur._id)
          rankList = await convertRankAvatarUrls(rankList)
          this.loadGroupStats(openid, cur._id)
        }

        // 拉取正在进行的自律计划（仅在有组织时展示，最多 3 条）
        let activeGoals: Array<Goal & { progress: { current: number; target: number; percent: number }; status: string }> = []
        if (cur) {
          const goals = await getActiveGoals(openid)
          const goalsWithProgress = await Promise.all(
            goals.map(async (goal: Goal) => {
              const progress = await calculateGoalProgress(openid, goal)
              const status = getGoalStatus(goal, progress)
              return { ...goal, progress, status }
            })
          )
          activeGoals = goalsWithProgress.slice(0, 3)
        }

        this.setData({
          groups,
          currentGroup: cur,
          checkedToday,
          stats,
          rankList: rankList || [],
          loading: false,
          checkinCardColor,
          checkinCardColorRgb,
          activeGoals,
        })
      } catch (e) {
        this.setData({ loading: false, rankList: [], groupStats: null, myRank: null, currentRankList: [] })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    onChooseAvatar(e: any) {
      const avatarUrl = e.detail.avatarUrl
      if (avatarUrl) {
        this.setData({ 'userInfo.avatarUrl': avatarUrl })
      }
    },
    onNicknameInput(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'userInfo.nickName': nickName, avatarInitial: getAvatarInitial(nickName) })
    },
    onNicknameBlur(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'userInfo.nickName': nickName, avatarInitial: getAvatarInitial(nickName) })
    },

    // uploadAvatarIfNeeded 已迁移到 services/utils.ts

    async onConfirmAuth() {
      const currentNickName = this.data.userInfo.nickName
      const { avatarUrl } = this.data.userInfo

      if (!currentNickName || currentNickName.trim() === '') {
        wx.showToast({ title: '请填写昵称', icon: 'none' })
        return
      }

      const trimmedNickName = currentNickName.trim()
      wx.showLoading({ title: '登录中' })
      try {
        const openid = await this.ensureOpenid()
        if (!openid) throw new Error('获取 openid 失败')
        const savedAvatarUrl = await uploadAvatarIfNeeded(avatarUrl, openid)
        await getOrCreateUser(openid, trimmedNickName, savedAvatarUrl || '')
        wx.setStorageSync('userInfo', { nickName: trimmedNickName, avatarUrl: savedAvatarUrl || '' })
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName: trimmedNickName, avatarUrl: savedAvatarUrl || '' },
          avatarInitial: getAvatarInitial(trimmedNickName)
        })
        app.globalData.openid = openid
        await this.tryBindInviteCode(openid)
        this.loadData(true)
        wx.showToast({ title: '登录成功' })
        // 若有待加入的群组（从群组邀请链接来），跳转组织页并弹出加入弹窗
        const pendingGroupCode = wx.getStorageSync('pendingGroupInviteCode')
        const pendingGroupInviter = wx.getStorageSync('pendingGroupInviterOpenid') || ''
        if (pendingGroupCode) {
          wx.removeStorageSync('pendingGroupInviteCode')
          wx.removeStorageSync('pendingGroupInviterOpenid')
          app.globalData.shouldOpenJoinModal = true
          const g = app.globalData as Record<string, unknown>
          g.pendingGroupInviteCode = pendingGroupCode
          g.pendingGroupInviterOpenid = pendingGroupInviter
          wx.switchTab({ url: '/pages/group/group' })
        } else {
          // 若因使用功能被要求登录，登录成功后跳回原页面
          const redirect = wx.getStorageSync('loginRedirectUrl')
          if (redirect && redirect !== LOGIN_PAGE) {
            wx.removeStorageSync('loginRedirectUrl')
            const tabPages = ['/pages/index/index', '/pages/group/group', '/pages/moments/moments', '/pages/profile/profile']
            if (tabPages.includes(redirect)) {
              wx.switchTab({ url: redirect })
            } else {
              wx.redirectTo({ url: redirect })
            }
          }
        }
      } catch (e: any) {
        wx.showToast({ title: '授权失败: ' + (e && e.message ? e.message : '请稍后重试'), icon: 'none' })
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
    async refreshRankList() {
      const { currentGroup, rankType } = this.data
      if (!currentGroup) return
      try {
        let rankList: RankUser[] = []
        if (rankType === 'all') rankList = await getAllRank(currentGroup._id)
        else if (rankType === 'week') rankList = await getWeekRank(currentGroup._id)
        else rankList = await getMonthRank(currentGroup._id)
        rankList = await convertRankAvatarUrls(rankList)
        this.setData({ rankList: rankList || [] })
      } catch (_) {}
    },
    async switchRank(e: any) {
      const type = e.currentTarget.dataset.type as 'all' | 'week' | 'month'
      if (!this.data.currentGroup) return
      this.setData({ rankType: type, rankLoading: true })
      try {
        let rankList: RankUser[] = []
        if (type === 'all') rankList = await getAllRank(this.data.currentGroup._id)
        else if (type === 'week') rankList = await getWeekRank(this.data.currentGroup._id)
        else rankList = await getMonthRank(this.data.currentGroup._id)
        rankList = await convertRankAvatarUrls(rankList)
        this.setData({ rankList: rankList || [], rankLoading: false })
        const openid = app.globalData.openid
        if (openid) this.loadGroupStats(openid, this.data.currentGroup._id)
      } catch (e) {
        this.setData({ rankLoading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    async loadGroupStats(openid: string, groupId: string) {
      this.setData({ statsLoading: true })
      try {
        const [groupRes, myRes] = await Promise.all([
          callGetGroupStats(groupId, this.data.rankType),
          callGetMyRank(groupId, this.data.rankType)
        ])

        if (groupRes.success && groupRes.stats) {
          this.setData({ groupStats: groupRes.stats })

          // 构建 allStats 对象
          const stats = groupRes.stats
          // 从 leaderboard 汇总总记录数
          let totalCheckins = 0
          const allMembers = [
            ...(stats.leaderboard.byMinutes || []),
            ...(stats.leaderboard.byDays || []),
            ...(stats.leaderboard.byScore || [])
          ]
          // 去重统计
          const memberSet = new Set(allMembers.map(m => m.openid))
          for (const member of allMembers) {
            totalCheckins += (member.totalMinutes || 0) > 0 ? 1 : 0
          }

          // 从个人统计数据获取 streak、bestStreak 和 missStreak
          const allStatsData = await getAllStats(openid)

          this.setData({
            allStats: {
              totalMinutes: (stats.groupAvg && stats.groupAvg.totalMinutes) || 0,
              totalDays: (stats.groupAvg && stats.groupAvg.checkinDays) || 0,
              avgScore: (stats.groupAvg && stats.groupAvg.avgScore) || 0,
              totalCheckins: memberSet.size, // 使用群成员数作为参考
              streak: allStatsData.streak,
              bestStreak: allStatsData.bestStreak,
              missStreak: allStatsData.missStreak
            }
          })

          this.updateCurrentRankList()
        } else {
          this.setData({ groupStats: null, currentRankList: [] })
        }
        if (myRes.success && myRes.rank && myRes.rank.myRank && myRes.rank.myRank.minutes != null && myRes.rank.myRank.days != null && myRes.rank.myRank.score != null) {
          this.setData({ myRank: myRes.rank.myRank, groupPercentiles: myRes.rank.percentiles, groupAvg: myRes.rank.groupAvg, totalMembers: myRes.rank.totalMembers })
        } else {
          this.setData({ myRank: null })
        }
      } catch (e) {
        this.setData({ groupStats: null, myRank: null, currentRankList: [], allStats: null })
      } finally {
        this.setData({ statsLoading: false })
      }
    },
    switchRankDimension(e: any) {
      const dimension = e.currentTarget.dataset.dimension as 'minutes' | 'days' | 'score'
      this.setData({ rankDimension: dimension })
      this.updateCurrentRankList()
      const openid = app.globalData.openid
      if (openid && this.data.currentGroup) this.loadGroupStats(openid, this.data.currentGroup._id)
    },
    updateCurrentRankList() {
      const { groupStats, rankDimension } = this.data
      if (!groupStats || !groupStats.leaderboard) {
        this.setData({ currentRankList: [] })
        return
      }
      let currentRankList: any[] = []
      if (rankDimension === 'minutes') currentRankList = groupStats.leaderboard.byMinutes || []
      else if (rankDimension === 'days') currentRankList = groupStats.leaderboard.byDays || []
      else currentRankList = groupStats.leaderboard.byScore || []
      currentRankList = currentRankList.map((item: any) => ({ ...item, avatarInitial: getAvatarInitial(item.nickName) }))
      this.setData({ currentRankList })
    },
    async refreshRankForNewGroup(groupId: string) {
      const openid = app.globalData.openid
      if (!openid || !groupId) return
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
      } catch (_) {
      } finally {
        this.setData({ rankLoading: false, statsLoading: false })
      }
    },
    selectGroup(e: any) {
      const id = e.currentTarget.dataset.id
      const isSetDefault = e.currentTarget.dataset.setDefault
      const g = this.data.groups.find((x: any) => x._id === id)
      if (!g) return
      if (isSetDefault) {
        wx.setStorageSync('defaultGroupId', id)
        app.globalData.currentGroupId = id
        wx.showToast({ title: '已设为默认', icon: 'none' })
      } else {
        app.globalData.currentGroupId = id
      }
      this.setData({ currentGroup: g, showSwitchModal: false })
      this.refreshRankForNewGroup(g._id)
    },
    setDefaultGroup(e: any) {
      const id = e.currentTarget.dataset.id
      wx.setStorageSync('defaultGroupId', id)
      app.globalData.currentGroupId = id
      const g = this.data.groups.find((x: any) => x._id === id)
      this.setData({ currentGroup: g, showSwitchModal: false })
      this.refreshRankForNewGroup(g._id)
    },
    async onCheckin() {
      const { currentGroup, checkinAnimating, groups } = this.data
      if (checkinAnimating) return
      const groupId = currentGroup ? currentGroup._id : (groups[0] ? groups[0]._id : '')
      const groupName = currentGroup ? currentGroup.name : (groups[0] ? groups[0].name : '')
      wx.navigateTo({
        url: `/pages/checkin/checkin?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`
      })
    },
    onViewUserMoments(e: any) {
      const { openid, nickName, avatarUrl } = e.currentTarget.dataset
      if (!openid) {
        wx.showToast({ title: '无法查看', icon: 'none' })
        return
      }
      const params = [
        `openid=${encodeURIComponent(openid)}`,
        `nickName=${encodeURIComponent(nickName || '')}`,
        `avatarUrl=${encodeURIComponent(avatarUrl || '')}`
      ].join('&')
      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
    goToGoalProgress(e: any) {
      const id = e.currentTarget.dataset.id
      if (id) wx.navigateTo({ url: `/pages/goal-progress/goal-progress?id=${id}` })
    },
    goToAllGoals() {
      wx.navigateTo({ url: '/pages/goal/goal' })
    },
  },
})
