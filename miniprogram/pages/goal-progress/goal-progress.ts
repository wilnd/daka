// goal-progress.ts
import {
  Goal,
  calculateGoalProgress,
  getGoalStatus,
  isGoalCompleted,
  checkAndProcessGoal,
  getUserGoals,
  queryGoals,
  GoalQueryParams,
  confirmGoal,
  getGoalsPendingConfirm,
  GoalStatus,
  GoalPeriod,
  GoalType,
  deleteGoal
} from '../../services/goal'
import { goalsCol } from '../../services/db'

const app = getApp() as IAppOption

Page({
  data: {
    themeColor: '#1ABC9C',
    goal: null as Goal | null,
    progress: null as any,
    status: 'in_progress' as string,
    showResultModal: false,
    resultInfo: null as any,
    historyGoals: [] as any[],
    // 筛选条件
    filterStatus: 'all' as GoalStatus | 'all',
    filterPeriod: 'all' as GoalPeriod | 'all',
    filterType: 'all' as GoalType | 'all',
    // 是否为确认人模式
    isConfirmorMode: false,
    pendingConfirmGoals: [] as any[],
    // 确认弹窗
    showConfirmModal: false,
    confirmRemark: ''
  },

  onLoad(options: any) {
    this.setData({ themeColor: '#1ABC9C' })
    if (options.id) {
      this.loadGoal(options.id)
    } else if (options.confirmor === '1') {
      // 确认人模式 - 查看待确认的目标
      this.loadPendingConfirmGoals()
    } else {
      this.loadAllGoals()
    }
  },

  async loadGoal(goalId: string) {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const goalData = await goalsCol().doc(goalId).get()
      const goal = goalData.data as Goal

      if (!goal) {
        wx.showToast({ title: '目标不存在', icon: 'none' })
        return
      }

      // 检查是否已删除
      if (goal.deleted) {
        wx.showToast({ title: '目标已删除', icon: 'none' })
        wx.navigateBack()
        return
      }

      if (goal) {
        const progress = await calculateGoalProgress(openid, goal)
        const status = getGoalStatus(goal, progress)
        this.setData({ goal, progress, status })
      }
    } catch (e) {
      console.error('加载目标失败', e)
    }
  },

  async loadAllGoals() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const { filterStatus, filterPeriod, filterType } = this.data as any
      const params: GoalQueryParams = {
        status: filterStatus,
        period: filterPeriod,
        type: filterType,
        pageSize: 50
      }

      const { goals } = await queryGoals(openid, params)

      const goalsWithProgress = await Promise.all(
        goals.map(async (goal) => {
          const progress = await calculateGoalProgress(openid, goal)
          const status = getGoalStatus(goal, progress)
          return { ...goal, progress, status }
        })
      )

      this.setData({ historyGoals: goalsWithProgress, isConfirmorMode: false })
    } catch (e) {
      console.error('加载目标失败', e)
    }
  },

  // 加载待确认的目标（作为确认人）
  async loadPendingConfirmGoals() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const goals = await getGoalsPendingConfirm(openid)

      const app = getApp() as IAppOption
      const ownerOpenid = app.globalData.openid

      const goalsWithProgress = await Promise.all(
        goals.map(async (goal) => {
          const progress = await calculateGoalProgress(ownerOpenid, goal)
          const status = getGoalStatus(goal, progress)
          return { ...goal, progress, status }
        })
      )

      this.setData({ pendingConfirmGoals: goalsWithProgress, isConfirmorMode: true })
    } catch (e) {
      console.error('加载待确认目标失败', e)
    }
  },

  // 切换筛选状态
  onFilterStatusChange(e: any) {
    this.setData({ filterStatus: e.detail.value })
    this.loadAllGoals()
  },

  // 切换周期筛选
  onFilterPeriodChange(e: any) {
    this.setData({ filterPeriod: e.detail.value })
    this.loadAllGoals()
  },

  // 切换类型筛选
  onFilterTypeChange(e: any) {
    this.setData({ filterType: e.detail.value })
    this.loadAllGoals()
  },

  // 结算目标（手动触发）
  async onSettleGoal() {
    const { goal } = this.data
    if (!goal) return

    const openid = app.globalData.openid
    if (!openid) return

    wx.showLoading({ title: '结算中...' })

    try {
      const result = await checkAndProcessGoal(openid, goal._id!)
      wx.hideLoading()

      if (result.success && result.result) {
        this.setData({
          showResultModal: true,
          resultInfo: result.result
        })
        // 刷新进度
        this.loadGoal(goal._id!)
      } else {
        wx.showToast({ title: result.msg || '结算完成', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '结算失败', icon: 'none' })
    }
  },

  hideResultModal() {
    this.setData({ showResultModal: false })
  },

  // 确认人确认目标
  onConfirmGoal(e: any) {
    const goalId = e.currentTarget.dataset.id
    const { historyGoals } = this.data
    const goal = historyGoals.find((g: Goal) => g._id === goalId)
    if (goal) {
      this.setData({ goal, showConfirmModal: true })
    }
  },

  // 确认人拒绝目标
  async onRejectGoal(e: any) {
    const goalId = e.currentTarget.dataset.id
    const openid = app.globalData.openid
    if (!openid) return

    wx.showModal({
      title: '确认拒绝',
      content: '确定要拒绝这个目标吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          const result = await confirmGoal(goalId, openid, false)
          wx.hideLoading()

          if (result.success) {
            wx.showToast({ title: '已拒绝', icon: 'success' })
            this.loadPendingConfirmGoals()
          } else {
            wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 输入确认备注
  onConfirmRemarkInput(e: any) {
    this.setData({ confirmRemark: e.detail.value })
  },

  // 确认目标
  async onConfirmSubmit() {
    const { goal, confirmRemark } = this.data
    if (!goal) return

    const openid = app.globalData.openid
    if (!openid) return

    wx.showLoading({ title: '确认中...' })

    try {
      const result = await confirmGoal(goal._id!, openid, true, confirmRemark)
      wx.hideLoading()

      if (result.success) {
        wx.showToast({ title: '确认成功', icon: 'success' })
        this.setData({ showConfirmModal: false, confirmRemark: '' })
        this.loadPendingConfirmGoals()
      } else {
        wx.showToast({ title: result.msg || '确认失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '确认失败', icon: 'none' })
    }
  },

  // 关闭确认弹窗
  hideConfirmModal() {
    this.setData({ showConfirmModal: false, confirmRemark: '' })
  },

  // 跳转到确认人模式
  goToConfirmorMode() {
    wx.navigateTo({ url: '/pages/goal-progress/goal-progress?confirmor=1' })
  },

  // 查看历史目标详情
  viewGoalDetail(e: any) {
    const goalId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goal-progress/goal-progress?id=${goalId}` })
  },

  // 返回自律计划
  goToGoal() {
    wx.navigateTo({ url: '/pages/goal/goal' })
  },

  // 删除目标
  async onDeleteGoal(e: any) {
    const goalId = e.currentTarget.dataset.id
    const openid = app.globalData.openid

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个目标吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          try {
            const success = await deleteGoal(openid, goalId)
            wx.hideLoading()
            if (success) {
              wx.showToast({ title: '删除成功', icon: 'success' })
              // 延迟一点确保数据库操作完成
              setTimeout(() => {
                this.loadAllGoals()
              }, 500)
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  }
})
