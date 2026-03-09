// tasks.ts
import { TASKS, ACHIEVEMENTS, getClaimableVipTasks, claimTaskReward, getUserTasks, getUserAchievements, Task, UserTaskProgress, Achievement } from '../../services/task'
import { getVipInfo, VipLevel, VipLevelNames, VipLevelColors } from '../../services/vip'
import { getStreak, getTotalDays, getAllStats } from '../../services/stats'
import { defaultAvatar, convertCloudUrl } from '../../services/utils'

const app = getApp() as IAppOption

interface TaskWithProgress extends Task {
  progress?: UserTaskProgress
  current: number
  percent: number
  rewardText?: string
}

/** 将 reward 对象格式化为展示文案 */
function formatReward(reward: Task['reward']): string {
  if (!reward || typeof reward !== 'object') return '0积分'
  const { type, value } = reward
  if (type === 'points') return `${value}积分`
  if (type === 'vip_days') return `${value}天VIP`
  if (type === 'badge') return `${value}个徽章`
  return `${value}`
}

Page({
  data: {
    themeColor: '#1ABC9C',
    defaultAvatar,
    userInfo: {} as any,
    vipInfo: null as any,
    vipLevelNames: VipLevelNames,
    vipLevelColors: VipLevelColors,
    tasks: [] as TaskWithProgress[],
    achievements: [] as Achievement[],
    claimableTasks: [] as Task[],
    completedTasksCount: 0,
    // 用户统计数据
    userStats: {
      streak: 0,
      totalDays: 0
    }
  },

  onLoad() {
    this.setData({ themeColor: '#1ABC9C' })
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    const openid = app.globalData.openid
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 从本地存储获取用户信息
    let userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.nickName) {
      wx.showToast({ title: '请先授权', icon: 'none' })
      return
    }

    // 处理头像路径：云存储路径需要转换为临时 URL
    let avatarUrl = userInfo.avatarUrl || defaultAvatar
    if (avatarUrl.startsWith('cloud://')) {
      avatarUrl = await convertCloudUrl(avatarUrl)
    }
    const displayUserInfo = { ...userInfo, avatarUrl }

    try {
      const [vipInfo, userTasks, claimableTasks, achievements, allStats] = await Promise.all([
        getVipInfo(openid),
        getUserTasks(openid),
        getClaimableVipTasks(openid),
        getUserAchievements(openid),
        getAllStats(openid)
      ])

      const streak = allStats.streak
      const totalDays = allStats.totalDays

      // 合并任务和进度
      const tasksWithProgress: TaskWithProgress[] = TASKS.map(task => {
        const progress = userTasks.find(t => t.taskId === task.id)
        const current = progress && progress.current ? progress.current : 0
        const percent = Math.min(100, Math.round((current / task.target) * 100))
        return {
          ...task,
          progress,
          current,
          percent,
          rewardText: formatReward(task.reward)
        }
      })

      // 为可领取任务补充展示文案
      const claimableTasksWithText = claimableTasks.map(t => ({ ...t, rewardText: formatReward(t.reward) }))

      // 计算已完成的任务数
      const completedTasksCount = tasksWithProgress.filter(t => t.percent >= 100).length

      this.setData({
        userInfo: displayUserInfo,
        vipInfo,
        tasks: tasksWithProgress,
        achievements,
        claimableTasks: claimableTasksWithText,
        completedTasksCount,
        userStats: {
          streak,
          totalDays
        }
      })
    } catch (e) {
      console.error('加载数据失败', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 领取奖励
  onClaimReward(e: any) {
    const task = e.currentTarget.dataset.task as Task
    const openid = app.globalData.openid
    if (!openid) return

    wx.showLoading({ title: '领取中...' })

    claimTaskReward(openid, task.id).then(success => {
      wx.hideLoading()
      if (success) {
        wx.showToast({ title: '领取成功', icon: 'success' })
        this.loadData()
      } else {
        wx.showToast({ title: '领取失败', icon: 'none' })
      }
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '领取失败', icon: 'none' })
    })
  },

  // 跳转到VIP页面
  goToVip() {
    wx.navigateTo({ url: '/pages/vip/vip' })
  }
})
