// profile.ts
import { getStreak, getMissStreak, getTotalDays, wasCheckedInYesterday } from '../../services/stats'
import { checkinsCol, membersCol, usersCol, SUBSCRIBE_TEMPLATE_ID, getTodayStr } from '../../services/db'
import { updateUserInfo, getOpenid } from '../../services/auth'
import { getVipInfo, VipLevel, VipLevelNames, VipLevelColors, VipBenefits } from '../../services/vip'
import { getClaimableVipTasks, getUserAchievements } from '../../services/task'
import { getActiveGoals, calculateGoalProgress, Goal } from '../../services/goal'
import { convertCloudUrl, defaultAvatar, uploadAvatarIfNeeded } from '../../services/utils'
import { isAdmin } from '../../services/suggestion'
import { getMyGroups } from '../../services/group'

const app = getApp() as IAppOption

Component({
  data: {
    hasUserInfo: false,
    userInfo: {} as any,
    stats: {} as any,
    // VIP相关
    vipInfo: {
      level: 0,
      expireTime: null,
      totalVipDays: 0
    } as any,
    vipLevelNames: VipLevelNames,
    vipLevelColors: VipLevelColors,
    // 任务相关
    claimableVipTasks: [] as any[],
    achievements: {
      total: 0,
      completed: 0,
      claimed: 0,
      vipTasks: 0,
      vipClaimed: 0
    },
    // 目标相关
    activeGoals: [] as any[],
    goalSummary: {
      total: 0,
      completed: 0,
      inProgress: 0
    },
    showEditModal: false,
    showTimePickerModal: false,
    // 生成提醒文案时需要群组选择
    showGroupPickerModal: false,
    groups: [] as any[],
    editingInfo: { nickName: '', avatarUrl: defaultAvatar },
    isSubscribed: false,
    remindTime: '21:00',
    // 管理员标识
    isAdmin: false,
    // 动态主题色
    themeColor: '#1ABC9C',
  },
  lifetimes: {
    attached() { this.init() },
  },
  pageLifetimes: {
    show() {
      // 同步主题色
      this.setData({ themeColor: '#1ABC9C' })
      // 检查用户是否已授权（每次页面显示时都检查）
      const ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName) {
        // 用户已授权，更新状态
        if (!this.data.hasUserInfo) {
          this.setData({ hasUserInfo: true })
        }
        this.loadData()
      }
    },
  },
  methods: {
    async init() {
      const ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName) {
        let avatarUrl = ui.avatarUrl || defaultAvatar
        // 云存储路径需要转换为临时 URL
        if (avatarUrl.startsWith('cloud://')) {
          avatarUrl = await convertCloudUrl(avatarUrl)
        }
        // 正确设置 userInfo
        const userInfo = { nickName: ui.nickName, avatarUrl }
        this.setData({ hasUserInfo: true, userInfo })
        this.loadData()
        this.loadSubscriptionStatus()
        this.checkAdminStatus()
      }
    },
    async checkAdminStatus() {
      try {
        const openid = app.globalData.openid
        if (!openid) return
        const adminStatus = await isAdmin(openid)
        this.setData({ isAdmin: adminStatus })
      } catch (e) {
        console.error('checkAdminStatus error:', e)
      }
    },
    async loadSubscriptionStatus() {
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        const user = users[0] as any
        const isSubscribed = (user && user.subscribeRemindEnabled) === true
        const remindTime = (user && user.remindTime) || '21:00'
        this.setData({ isSubscribed, remindTime })
      } catch (e) {
        console.error('loadSubscriptionStatus error', e)
      }
    },
    async loadData() {
      const openid = app.globalData.openid
      if (!openid) return

      try {
        // 直接获取个人统计（与群组无关）
        const [streak, totalDays, missStreak, vipInfo, claimableTasks, achievements, goals] = await Promise.all([
          getStreak(openid),
          getTotalDays(openid),
          getMissStreak(openid),
          getVipInfo(openid),
          getClaimableVipTasks(openid),
          getUserAchievements(openid),
          getActiveGoals(openid)
        ])

        // 计算目标进度
        const goalsWithProgress = await Promise.all(
          goals.map(async (goal: Goal) => {
            const progress = await calculateGoalProgress(openid, goal)
            return { ...goal, progress }
          })
        )

        const completedGoals = goalsWithProgress.filter((g: any) => g.progress.isCompleted).length
        const inProgressGoals = goalsWithProgress.filter((g: any) => !g.progress.isCompleted && new Date() <= new Date(g.endDate)).length

        this.setData({
          stats: { streak, totalDays, missStreak },
          vipInfo,
          claimableVipTasks: claimableTasks,
          achievements,
          activeGoals: goalsWithProgress.slice(0, 2),  // 只显示前2个
          goalSummary: {
            total: goalsWithProgress.length,
            completed: completedGoals,
            inProgress: inProgressGoals
          }
        })
      } catch (e) {
        console.error(e)
      }
    },
    onEditUserInfo() {
      const { userInfo } = this.data
      this.setData({
        showEditModal: true,
        editingInfo: {
          nickName: userInfo.nickName || '',
          avatarUrl: userInfo.avatarUrl || defaultAvatar,
        }
      })
    },
    hideEditModal() {
      this.setData({ showEditModal: false })
    },

    // 查看自己的成长墙
    onViewMyMoments(e: any) {
      const { userInfo } = this.data
      const openid = app.globalData.openid
      if (!openid || !userInfo) {
        wx.showToast({ title: '无法查看', icon: 'none' })
        return
      }

      const params = [
        `userId=${encodeURIComponent(openid)}`,
        `nickName=${encodeURIComponent(userInfo.nickName || '')}`,
        `avatarUrl=${encodeURIComponent(userInfo.avatarUrl || '')}`
      ].join('&')

      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
    onChooseAvatar(e: any) {
      const { avatarUrl } = e.detail
      this.setData({ 'editingInfo.avatarUrl': avatarUrl || this.data.editingInfo.avatarUrl })
    },
    onNicknameInput(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'editingInfo.nickName': nickName })
    },

    // uploadAvatarIfNeeded 已迁移到 services/utils.ts

    async saveUserInfo() {
      const { nickName, avatarUrl } = this.data.editingInfo
      if (!nickName || !avatarUrl) {
        wx.showToast({ title: '请填写昵称并选择头像', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
      wx.showLoading({ title: '保存中' })
      try {
        // 如果选择了新头像，先上传到云存储
        const savedAvatarUrl = await uploadAvatarIfNeeded(avatarUrl, openid)
        await updateUserInfo(openid, nickName, savedAvatarUrl)

        // 云存储路径需要转换为临时 URL 显示
        let displayAvatarUrl = savedAvatarUrl
        if (savedAvatarUrl.startsWith('cloud://')) {
          displayAvatarUrl = await convertCloudUrl(savedAvatarUrl)
        }

        // 保存到本地存储（保存云存储路径）
        wx.setStorageSync('userInfo', { nickName, avatarUrl: savedAvatarUrl })
        // 显示用临时 URL
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName, avatarUrl: displayAvatarUrl },
          showEditModal: false
        })
        wx.showToast({ title: '保存成功' })
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },
    async subscribeRemind() {
      const templateId = SUBSCRIBE_TEMPLATE_ID
      if (!templateId || templateId.startsWith('YOUR_')) {
        wx.showToast({ title: '请在代码中配置订阅消息模板ID', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }

      // 如果已订阅，提供修改时间或取消订阅的选项
      if (this.data.isSubscribed) {
        wx.showActionSheet({
          itemList: ['修改提醒时间', '取消订阅'],
          success: async (res) => {
            if (res.tapIndex === 0) {
              this.setData({ showTimePickerModal: true })
            } else if (res.tapIndex === 1) {
              await this.updateSubscriptionStatus(openid, false)
              this.setData({ isSubscribed: false })
              wx.showToast({ title: '已取消订阅' })
            }
          }
        })
        return
      }

      // 请求订阅
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: async (res: any) => {
          if (res[templateId] === 'accept') {
            await this.updateSubscriptionStatus(openid, true)
            this.setData({ isSubscribed: true, showTimePickerModal: true })
          } else if (res[templateId] === 'reject') {
            wx.showToast({ title: '需要您同意接收通知', icon: 'none' })
          } else {
            wx.showToast({ title: '已取消', icon: 'none' })
          }
        },
        fail: () => wx.showToast({ title: '订阅失败', icon: 'none' }),
      })
    },
    onTimeChange(e: any) {
      this.setData({ remindTime: e.detail.value })
    },
    async saveRemindTime() {
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        if (users.length > 0) {
          await usersCol().doc((users[0] as any)._id).update({
            data: { remindTime: this.data.remindTime }
          })
        }
        this.setData({ showTimePickerModal: false })
        wx.showToast({ title: '提醒时间已设置' })
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    },
    hideTimePickerModal() {
      this.setData({ showTimePickerModal: false })
    },
    async updateSubscriptionStatus(openid: string, enabled: boolean) {
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        if (users.length > 0) {
          await usersCol().doc((users[0] as any)._id).update({
            data: { subscribeRemindEnabled: enabled }
          })
        }
      } catch (e) {
        console.error('updateSubscriptionStatus error', e)
      }
    },
    async genRemindCopy() {
      // 先加载群组列表（如果还没有）
      if (this.data.groups.length === 0) {
        const openid = app.globalData.openid
        if (!openid) return
        try {
          const groups = await getMyGroups(openid)
          this.setData({ groups })
        } catch (e) {
          wx.showToast({ title: '加载群组失败', icon: 'none' })
          return
        }
      }
      // 弹出群组选择弹窗
      this.setData({ showGroupPickerModal: true })
    },
    onSelectGroupForCopy(e: any) {
      const groupIndex = parseInt(e.currentTarget.dataset.index)
      const group = this.data.groups[groupIndex]
      this.setData({ showGroupPickerModal: false })
      this.doGenRemindCopy(group._id)
    },
    hideGroupPickerModal() {
      this.setData({ showGroupPickerModal: false })
    },
    // 跳转到VIP页面
    goToVip() {
      wx.navigateTo({ url: '/pages/vip/vip' })
    },
    // 跳转到任务中心
    goToTasks() {
      wx.navigateTo({ url: '/pages/tasks/tasks' })
    },
    // 跳转到自律计划
    goToGoal() {
      wx.navigateTo({ url: '/pages/goal/goal' })
    },
    async doGenRemindCopy(gid: string) {
      try {
        const today = getTodayStr()
        const { data: members } = await membersCol().where({ groupId: gid, status: 'normal' }).get()
        const userIds = (members || []).map((m: any) => m.userId).filter(Boolean)

        // 批量查询今日已打卡用户
        const checkedSet = new Set<string>()
        const db = wx.cloud.database()
        const _ = db.command

        // 分批查询，每批10人
        const batchSize = 10
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          const { data: checked } = await checkinsCol().where({ userId: _.in(batch), date: today }).get()
          for (const c of (checked || []) as any[]) {
            if (c && c.userId) checkedSet.add(c.userId)
          }
        }

        // 批量获取未打卡用户的详细信息
        const missUserIds = userIds.filter(uid => !checkedSet.has(uid))
        const userInfoMap: Record<string, { nickName: string }> = {}

        // 批量获取用户信息
        for (let i = 0; i < missUserIds.length; i += batchSize) {
          const batch = missUserIds.slice(i, i + batchSize)
          const { data: users } = await usersCol().where({ openid: _.in(batch) }).get()
          for (const u of (users || []) as any[]) {
            if (u && u.openid) {
              userInfoMap[u.openid] = { nickName: u.nickName || '未知' }
            }
          }
        }

        // 批量获取未打卡成员的打卡状态（连续未打卡天数）
        const missList: any[] = []
        for (const m of members || []) {
          if (!checkedSet.has(m.userId)) {
            const missDays = await getMissStreak(m.userId, gid)
            const wasYesterday = await wasCheckedInYesterday(m.userId)
            const streak = wasYesterday ? await getStreak(m.userId, gid) : 0
            const nick = userInfoMap[m.userId] && userInfoMap[m.userId].nickName ? userInfoMap[m.userId].nickName : '未知'
            missList.push({ nick, missDays, wasYesterday, streak })
          }
        }

        if (missList.length === 0) {
          wx.showToast({ title: '今日全员已记录' })
          return
        }
        // 生成文案：昨天记录→显示连续天数+断掉风险；昨天未记录→显示未记录+鼓励
        const txt = missList.map(x => {
          if (x.wasYesterday && x.streak > 0) {
            return `@${x.nick} 已经连续运动${x.streak}天，今天还不运动会断掉连胜哦`
          } else {
            return `@${x.nick} 已连续${x.missDays}天未运动了，快快运动起来吧`
          }
        }).join('，')
        wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制' }) })
      } catch (e) {
        wx.showToast({ title: '生成失败', icon: 'none' })
      }
    },
  },
})
