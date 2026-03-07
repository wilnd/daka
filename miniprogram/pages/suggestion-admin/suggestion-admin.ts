/**
 * 管理员意见审批页面
 */
import { getOpenid } from '../../services/auth'
import {
  Suggestion,
  SuggestionStatus,
  SuggestionType,
  SuggestionTypeNames,
  SuggestionStatusNames,
  getPendingSuggestions,
  getAllSuggestions,
  approveSuggestion,
  getSuggestionStats,
  isAdmin,
  DEFAULT_VIP_DAYS
} from '../../services/suggestion'

interface PageData {
  isAdmin: boolean
  pendingSuggestions: Suggestion[]
  allSuggestions: Suggestion[]
  currentTab: 'pending' | 'history'
  stats: {
    total: number
    pending: number
    approved: number
    rejected: number
    vipApproved: number
  }
  loading: boolean
  selectedSuggestion: Suggestion | null
  showApprovalModal: boolean
  approvalRemark: string
  approvalVipDays: number
  themeColor: string
}

Page({
  data: {
    isAdmin: false,
    pendingSuggestions: [],
    allSuggestions: [],
    currentTab: 'pending',
    stats: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      vipApproved: 0
    },
    loading: false,
    selectedSuggestion: null,
    showApprovalModal: false,
    approvalRemark: '',
      approvalVipDays: DEFAULT_VIP_DAYS,
    themeColor: '#1ABC9C'
  },

  onLoad() {
    this.setData({ themeColor: '#1ABC9C' })
    this.checkAdminAndLoad()
  },

  onShow() {
    if (this.data.isAdmin) {
      this.loadData()
    }
  },

  async checkAdminAndLoad() {
    try {
      const openid = await getOpenid()
      const adminStatus = await isAdmin(openid)
      this.setData({ isAdmin: adminStatus })
      if (adminStatus) {
        this.loadData()
      }
    } catch (e) {
      console.error('checkAdminAndLoad error:', e)
    }
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [pendingSuggestions, stats] = await Promise.all([
        getPendingSuggestions(),
        getSuggestionStats()
      ])
      this.setData({
        pendingSuggestions,
        stats
      })
    } catch (e) {
      console.error('loadData error:', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  async switchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as 'pending' | 'history'
    this.setData({ currentTab: tab })

    if (tab === 'history' && this.data.allSuggestions.length === 0) {
      this.setData({ loading: true })
      try {
        const all = await getAllSuggestions()
        this.setData({ allSuggestions: all })
      } catch (e) {
        console.error('load history error:', e)
      } finally {
        this.setData({ loading: false })
      }
    }
  },

  showApprovalDialog(e: WechatMiniprogram.TouchEvent) {
    const suggestion = e.currentTarget.dataset.suggestion as Suggestion
    this.setData({
      selectedSuggestion: suggestion,
      showApprovalModal: true,
      approvalRemark: '',
      approvalVipDays: suggestion.type === 'vip_request' ? 30 : 0
    })
  },

  hideApprovalDialog() {
    this.setData({
      showApprovalModal: false,
      selectedSuggestion: null,
      approvalRemark: '',
      approvalVipDays: 30
    })
  },

  onRemarkChange(e: any) {
    this.setData({ approvalRemark: e.detail.value })
  },

  onVipDaysChange(e: any) {
    const days = parseInt(e.detail.value) || 0
    this.setData({ approvalVipDays: Math.max(0, days) })
  },

  async handleApprove(approved: boolean) {
    const { selectedSuggestion, approvalRemark, approvalVipDays } = this.data
    if (!selectedSuggestion) return

    wx.showLoading({ title: '处理中...' })
    try {
      const openid = await getOpenid()
      const result = await approveSuggestion(
        openid,
        selectedSuggestion._id,
        approved,
        approvalRemark,
        approved ? approvalVipDays : 0
      )

      if (result.ok) {
        wx.showToast({
          title: approved ? '已批准' : '已拒绝',
          icon: 'success'
        })
        this.hideApprovalDialog()
        this.loadData()
      } else {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
      }
    } catch (e) {
      console.error('handleApprove error:', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  getTypeName(type: SuggestionType): string {
    return SuggestionTypeNames[type]
  },

  getStatusName(status: SuggestionStatus): string {
    return SuggestionStatusNames[status]
  },

  formatTime(date: Date | string | undefined): string {
    if (!date) return '-'
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  },

  goToUserProfile(e: WechatMiniprogram.TouchEvent) {
    const openid = e.currentTarget.dataset.openid
    if (openid) {
      wx.navigateTo({
        url: `/pages/user-moments/user-moments?openid=${openid}`
      })
    }
  }
})
