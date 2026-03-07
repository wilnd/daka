/**
 * 联系管理员 / 提交意见页面
 */
import { getOpenid } from '../../services/auth'
import {
  SuggestionType,
  SuggestionTypeNames,
  submitSuggestion,
  getUserSuggestions,
  Suggestion
} from '../../services/suggestion'

interface PageData {
  themeColor: string
  wechatId: string
  currentTab: 'wechat' | 'suggest'
  selectedType: SuggestionType
  content: string
  contact: string
  submitting: boolean
  suggestions: Suggestion[]
  loadingSuggestions: boolean
}

Page({
  data: {
    themeColor: '#1ABC9C',
    wechatId: 'ch668816888',
    currentTab: 'suggest',
    selectedType: 'feedback',
    content: '',
    contact: '',
    submitting: false,
    suggestions: [],
    loadingSuggestions: false
  },

  lifetimes: {
    attached() {
      this.setData({ themeColor: '#1ABC9C' })
    },
  },

  onShow() {
    this.loadUserSuggestions()
  },

  async loadUserSuggestions() {
    this.setData({ loadingSuggestions: true })
    try {
      const openid = await getOpenid()
      const suggestions = await getUserSuggestions(openid)
      this.setData({ suggestions })
    } catch (e) {
      console.error('loadUserSuggestions error:', e)
    } finally {
      this.setData({ loadingSuggestions: false })
    }
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as 'wechat' | 'suggest'
    this.setData({ currentTab: tab })
  },

  selectType(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as SuggestionType
    this.setData({ selectedType: type })
  },

  onContentInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e: any) {
    this.setData({ contact: e.detail.value })
  },

  async submitSuggestion() {
    const { content, selectedType, contact, submitting } = this.data

    if (submitting) return

    if (!content || content.trim().length === 0) {
      wx.showToast({ title: '请输入意见内容', icon: 'none' })
      return
    }

    if (content.length > 500) {
      wx.showToast({ title: '意见内容不能超过500字', icon: 'none' })
      return
    }

    if (selectedType === 'vip_request' && content.length < 10) {
      wx.showToast({ title: 'VIP申请请详细说明理由（至少10个字），以便管理员审批', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...' })

    try {
      const openid = await getOpenid()
      const result = await submitSuggestion(openid, content, selectedType, contact)

      if (result.ok) {
        wx.showToast({ title: '提交成功', icon: 'success' })
        this.setData({ content: '', contact: '' })
        this.loadUserSuggestions()
      } else {
        wx.showToast({ title: result.msg || '提交失败', icon: 'none' })
      }
    } catch (e) {
      console.error('submitSuggestion error:', e)
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
      wx.hideLoading()
    }
  },

  copyWechatId() {
    const id = this.data.wechatId
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
    })
  },

  showGuide() {
    wx.showModal({
      title: '添加方式',
      content: `已为你准备好微信号：${this.data.wechatId}\n\n打开微信 → 顶部搜索 → 粘贴微信号 → 添加到通讯录`,
      showCancel: false,
    })
  },

  formatTime(date: Date | string | undefined): string {
    if (!date) return '-'
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
})
