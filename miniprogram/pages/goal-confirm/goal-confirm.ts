// goal-confirm.ts - 确认目标页面
import { Goal, getGoalByConfirmCode, confirmGoalByCode, GoalStatus } from '../../services/goal'
import { generateConfirmCode, generateUUID } from '../../services/utils'

const app = getApp() as IAppOption

Page({
  data: {
    themeColor: '#1ABC9C',
    goal: null as Goal | null,
    loading: true,
    error: '',
    // 用户输入
    userName: '',
    remark: '',
    // 确认状态
    confirmStatus: '' as 'pending' | 'confirmed' | 'rejected' | '',
    // 输入确认码模式
    inputCodeMode: false,
    inputCode: '',
    // 我的用户ID
    myUserId: '',
  },

  onLoad(options: any) {
    this.setData({ themeColor: '#1ABC9C' })

    // 获取或生成用户ID
    let userId = wx.getStorageSync('userId')
    if (!userId) {
      userId = generateUUID()
      wx.setStorageSync('userId', userId)
    }
    this.setData({ myUserId: userId })

    // 如果有确认码参数，直接加载
    if (options.code) {
      this.loadGoalByCode(options.code)
    } else if (options.id && options.code) {
      // 分享链接模式
      this.loadGoalByCode(options.code)
    } else {
      // 没有确认码，显示输入框
      this.setData({
        loading: false,
        inputCodeMode: true
      })
    }
  },

  // 通过确认码加载目标
  async loadGoalByCode(code: string) {
    wx.showLoading({ title: '加载中...' })

    try {
      const goal = await getGoalByConfirmCode(code)
      wx.hideLoading()

      if (!goal) {
        this.setData({
          loading: false,
          error: '确认码无效，请检查后重试'
        })
        return
      }

      // 检查是否已确认
      if (goal.confirmor && goal.confirmor.confirmStatus !== 'pending') {
        this.setData({
          loading: false,
          goal,
          confirmStatus: goal.confirmor.confirmStatus
        })
        return
      }

      this.setData({
        loading: false,
        goal,
        inputCodeMode: false
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({
        loading: false,
        error: '加载失败，请重试'
      })
    }
  },

  // 输入确认码
  onInputCode(e: any) {
    this.setData({ inputCode: e.detail.value })
  },

  // 提交确认码
  onSubmitCode() {
    const { inputCode } = this.data
    if (!inputCode || inputCode.length !== 6) {
      wx.showToast({ title: '请输入6位确认码（由确认人提供）', icon: 'none' })
      return
    }

    this.loadGoalByCode(inputCode)
  },

  // 输入用户名
  onUserNameInput(e: any) {
    this.setData({ userName: e.detail.value })
  },

  // 输入备注
  onRemarkInput(e: any) {
    this.setData({ remark: e.detail.value })
  },

  // 确认目标
  async onConfirm(confirmed: boolean) {
    const { goal, userName, remark, myUserId, inputCode } = this.data

    if (!goal && !inputCode) {
      wx.showToast({ title: '目标不存在', icon: 'none' })
      return
    }

    if (!userName.trim()) {
      wx.showToast({ title: '请输入您的昵称', icon: 'none' })
      return
    }

    const code = (goal && goal.confirmor && goal.confirmor.confirmCode) || inputCode

    wx.showLoading({ title: '提交中...' })

    try {
      const result = await confirmGoalByCode(code, myUserId, confirmed, remark)
      wx.hideLoading()

      if (result.success) {
        this.setData({
          confirmStatus: confirmed ? 'confirmed' : 'rejected'
        })
        wx.showToast({
          title: confirmed ? '确认成功' : '已拒绝',
          icon: 'success'
        })
      } else {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 复制确认码
  copyCode() {
    const { goal } = this.data
    if (goal && goal.confirmor && goal.confirmor.confirmCode) {
      wx.setClipboardData({
        data: goal.confirmor.confirmCode,
        success: () => {
          wx.showToast({ title: '已复制', icon: 'success' })
        }
      })
    }
  },

  // 复制分享链接
  copyShareLink() {
    const { goal } = this.data
    if (goal && goal._id && goal.confirmor && goal.confirmor.confirmCode) {
      const link = `https://yourdomain.com/pages/goal-confirm/goal-confirm?id=${goal._id}&code=${goal.confirmor.confirmCode}`
      wx.setClipboardData({
        data: link,
        success: () => {
          wx.showToast({ title: '链接已复制', icon: 'success' })
        }
      })
    }
  }
})
