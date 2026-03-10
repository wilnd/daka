// profile.ts
import { getStreak, getMissStreak, wasCheckedInYesterday } from '../../services/stats'
import { checkinsCol, membersCol, usersCol, SUBSCRIBE_TEMPLATE_ID, getTodayStr } from '../../services/db'
import { updateUserInfo, getOpenid, requireLogin } from '../../services/auth'
import { getVipInfo, VipLevel, VipLevelNames, VipLevelColors, VipBenefits, getMakeupQuotaDisplay } from '../../services/vip'
import { getClaimableVipTasks, getUserAchievements } from '../../services/task'
import { getActiveGoals, calculateGoalProgress, Goal } from '../../services/goal'
import { convertCloudUrl, defaultAvatar, uploadAvatarIfNeeded, getAvatarInitial } from '../../services/utils'
import { isAdmin } from '../../services/suggestion'
import { getMyGroups } from '../../services/group'

const app = getApp() as IAppOption

/** 格式化 VIP 有效期为页面展示文案，如 2025年3月8日 */
function formatVipExpireTime(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}年${m}月${day}日`
}

Component({
  data: {
    hasUserInfo: false,
    userInfo: {} as any,
    // VIP相关（expireTimeText 为格式化后的有效期文案，用于页面展示）
    vipInfo: {
      level: 0,
      expireTime: null,
      expireTimeText: '',
      totalVipDays: 0,
      makeupQuotaText: '2次'
    } as any,
    /** 个人页顶部展示：本月剩余小勤点评次数，如 "剩余3/20次" 或 "开通VIP可用" */
    aiReviewQuotaText: '',
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
    editingInfo: { nickName: '', avatarUrl: '', avatarInitial: '?' },
    isSubscribed: false,
    remindTime: '21:00',
    // 管理员标识
    isAdmin: false,
    // 动态主题色
    themeColor: '#1ABC9C',
    // 当前选中的群组
    currentGroup: null as any,
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
        let avatarUrl = ui.avatarUrl || ''
        if (avatarUrl && avatarUrl.startsWith('cloud://')) {
          avatarUrl = await convertCloudUrl(avatarUrl)
        }
        const userInfo = { nickName: ui.nickName, avatarUrl: avatarUrl || '', avatarInitial: getAvatarInitial(ui.nickName) }
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
        const { data: users } = await usersCol().where({ _openid: openid } as any).get()
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
        // 获取群组列表和当前选中的群组
        const groups = await getMyGroups(openid)
        const globalGroupId = app.globalData.currentGroupId
        let currentGroup = groups.find((g: any) => g._id === globalGroupId) || (groups.length > 0 ? groups[0] : null)
        
        // 使用当前群组的 groupId（如果有）
        const groupId = currentGroup ? currentGroup._id : ''

        // 获取统计数据（按群组过滤）
        const [vipInfo, claimableTasks, achievements, goals] = await Promise.all([
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

        // 格式化 VIP 有效期供页面展示（Date 在 setData 后视图层可能不显示）
        const expireTimeText = vipInfo.expireTime
          ? formatVipExpireTime(vipInfo.expireTime)
          : ''
        const makeupQuotaText = getMakeupQuotaDisplay(vipInfo.level)

        // 本月小勤点评剩余次数文案（成长值加成右侧展示）
        let aiReviewQuotaText = ''
        try {
          const res = await wx.cloud.callFunction({
            name: 'generateMomentAnnotations',
            data: { action: 'getQuota' }
          })
          const result = (res && res.result != null ? res.result : {}) as { success?: boolean; quota?: number; remaining?: number }
          if (result && result.success && result.quota != null) {
            const quota = result.quota
            const remaining = Math.max(0, result.remaining != null ? result.remaining : 0)
            aiReviewQuotaText = quota > 0 ? `剩余${remaining}/${quota}次` : '开通VIP可用'
          } else {
            aiReviewQuotaText = '开通VIP可用'
          }
        } catch (_) {
          aiReviewQuotaText = '--'
        }

        this.setData({
          groups,
          currentGroup,
          vipInfo: { ...vipInfo, expireTimeText, makeupQuotaText },
          aiReviewQuotaText,
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
    // 切换群组
    async onSelectGroup(e: any) {
      const { currentGroup, groups } = this.data
      const index = e.currentTarget.dataset.index
      const group = groups[index]
      if (!group) return
      
      const openid = app.globalData.openid
      if (!openid) return

      // 保存到全局
      app.globalData.currentGroupId = group._id

      this.setData({
        currentGroup: group
      })
    },
    onEditUserInfo() {
      const { userInfo } = this.data
      this.setData({
        showEditModal: true,
        editingInfo: {
          nickName: userInfo.nickName || '',
          avatarUrl: userInfo.avatarUrl || '',
          avatarInitial: getAvatarInitial(userInfo.nickName),
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
        `openid=${encodeURIComponent(openid)}`,
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
      this.setData({ 'editingInfo.nickName': nickName, 'editingInfo.avatarInitial': getAvatarInitial(nickName) })
    },

    // uploadAvatarIfNeeded 已迁移到 services/utils.ts

    async saveUserInfo() {
      const { nickName, avatarUrl } = this.data.editingInfo
      if (!nickName || !nickName.trim()) {
        wx.showToast({ title: '请填写昵称', icon: 'none' })
        return
      }
      const openid = requireLogin()
      if (!openid) return
      wx.showLoading({ title: '保存中' })
      try {
        const trimmedNickName = nickName.trim()
        const savedAvatarUrl = await uploadAvatarIfNeeded(avatarUrl || '', openid)
        await updateUserInfo(openid, trimmedNickName, savedAvatarUrl || '')

        let displayAvatarUrl = savedAvatarUrl || ''
        if (displayAvatarUrl && displayAvatarUrl.startsWith('cloud://')) {
          displayAvatarUrl = await convertCloudUrl(displayAvatarUrl)
        }

        wx.setStorageSync('userInfo', { nickName: trimmedNickName, avatarUrl: savedAvatarUrl || '' })
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName: trimmedNickName, avatarUrl: displayAvatarUrl, avatarInitial: getAvatarInitial(trimmedNickName) },
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
      const openid = requireLogin()
      if (!openid) return

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
      // 将时间对齐到30分钟区间
      const time = e.detail.value
      const [hour, minute] = time.split(':').map(Number)
      const alignedMinute = minute < 30 ? '00' : '30'
      const alignedTime = `${hour}:${alignedMinute}`
      this.setData({ remindTime: alignedTime })
    },
    async saveRemindTime() {
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const { data: users } = await usersCol().where({ _openid: openid } as any).get()
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
        const { data: users } = await usersCol().where({ _openid: openid } as any).get()
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
      
      // 更新当前群组和统计数据
      const openid = app.globalData.openid
      if (openid) {
        // 保存到全局
        app.globalData.currentGroupId = group._id
        this.setData({ currentGroup: group })
      }
      
      // 继续执行生成提醒文案（如果有）
      this.doGenRemindCopy(group._id)
    },
    hideGroupPickerModal() {
      this.setData({ showGroupPickerModal: false })
    },
    // 显示群组选择器（用于切换群组查看数据）
    showSwitchGroup() {
      const { groups } = this.data
      if (groups.length === 0) {
        wx.showToast({ title: '暂无群组', icon: 'none' })
        return
      }
      this.setData({ showGroupPickerModal: true })
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
        const userIds = (members || []).map((m: any) => m._openid || m.openid).filter(Boolean)

        // 批量查询今日已打卡用户
        const checkedSet = new Set<string>()
        const db = wx.cloud.database()
        const _ = db.command

        // 分批查询，每批10人
        const batchSize = 10
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          const { data: checked } = await checkinsCol().where({ _openid: _.in(batch), date: today } as any).get()
          for (const c of (checked || []) as any[]) {
            if (c && (c._openid || c.openid)) checkedSet.add(c._openid || c.openid)
          }
        }

        // 批量获取未打卡用户的详细信息
        const missUserIds = userIds.filter(uid => !checkedSet.has(uid))
        const userInfoMap: Record<string, { nickName: string }> = {}

        // 批量获取用户信息
        for (let i = 0; i < missUserIds.length; i += batchSize) {
          const batch = missUserIds.slice(i, i + batchSize)
          const { data: users } = await usersCol().where({ _openid: _.in(batch) } as any).get()
          for (const u of (users || []) as any[]) {
            const uid = u && (u._openid || u.openid)
            if (uid) {
              userInfoMap[uid] = { nickName: u.nickName || '未知' }
            }
          }
        }

        // 批量获取未打卡成员的打卡状态（连续未打卡天数）
        const missList: any[] = []
        for (const m of members || []) {
          const mid = (m as any)._openid || m.openid
          if (mid && !checkedSet.has(mid)) {
            const missDays = await getMissStreak(mid)
            const wasYesterday = await wasCheckedInYesterday(mid)
            const streak = wasYesterday ? await getStreak(mid) : 0
            const nick = userInfoMap[mid] && userInfoMap[mid].nickName ? userInfoMap[mid].nickName : '未知'
            missList.push({ nick, missDays, wasYesterday, streak })
          }
        }

        if (missList.length === 0) {
          wx.showToast({ title: '今日全员已记录' })
          return
        }
        // 生成文案：昨天记录→显示连胜天数+断掉风险；昨天未记录→显示未记录+鼓励
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
