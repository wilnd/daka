// 我的邀请 - 分销体系页（访客可浏览，操作时再要求登录）
import { isLoggedIn, requireLogin } from '../../services/auth'
import { convertCloudUrl, defaultAvatar, getAvatarInitial } from '../../services/utils'

const app = getApp() as IAppOption

interface ReferralUser {
  _openid?: string
  openid?: string
  nickName?: string
  avatarUrl?: string
  inviteTime?: string
  inviteTimeText?: string
}

Page({
  data: {
    themeColor: '#1ABC9C',
    inviteCode: '' as string,
    rewardRules: { desc: '', directPoints: 10, secondPoints: 3 } as { desc: string; directPoints: number; secondPoints: number },
    stats: { directCount: 0, secondCount: 0, referralPoints: 0 } as { directCount: number; secondCount: number; referralPoints: number },
    directInvites: [] as ReferralUser[],
    secondLevelInvites: [] as ReferralUser[],
    _referralLoading: false,
  },

  onLoad() {
    this.setData({ themeColor: (app.globalData && app.globalData.themeColor) || '#1ABC9C' })
  },

  onShow() {
    this.loadReferralData()
  },

  async loadReferralData() {
    if (!isLoggedIn()) {
      // 访客模式：展示空状态，不跳转
      this.setData({
        inviteCode: '',
        stats: { directCount: 0, secondCount: 0, referralPoints: 0 },
        directInvites: [],
        secondLevelInvites: [],
      })
      return
    }
    const openid = app.globalData.openid || wx.getStorageSync('openid')
    if (!openid) return
    if (this.data._referralLoading) return
    this.setData({ _referralLoading: true })
    wx.showLoading({ title: '加载中' })
    try {
      const [codeRes, treeRes, statsRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'referral', data: { action: 'ensureInviteCode' } }),
        wx.cloud.callFunction({ name: 'referral', data: { action: 'getReferralTree' } }),
        wx.cloud.callFunction({ name: 'referral', data: { action: 'getReferralStats' } }),
      ])
      const codeData = (codeRes.result as any) || {}
      const treeData = (treeRes.result as any) || {}
      const statsData = (statsRes.result as any) || {}

      // 云函数可能返回 success: false（如未登录）
      const errMsg = codeData.errMsg || treeData.errMsg || statsData.errMsg
      if (errMsg) {
        this.setData({
          inviteCode: '',
          directInvites: [],
          secondLevelInvites: [],
          stats: { directCount: 0, secondCount: 0, referralPoints: 0 },
        })
        wx.showToast({ title: String(errMsg || '加载失败').slice(0, 30), icon: 'none' })
        return
      }

      const inviteCode = codeData.inviteCode || ''
      const rewardRules = (statsData.rewardRules && typeof statsData.rewardRules === 'object')
        ? statsData.rewardRules
        : { desc: '', directPoints: 10, secondPoints: 3 }
      const stats = {
        directCount: Number(statsData.directCount) || 0,
        secondCount: Number(statsData.secondCount) || 0,
        referralPoints: Number(statsData.referralPoints) || 0,
      }

      const formatInviteTime = (t: string | Date | undefined) => {
        if (!t) return '--'
        const d = typeof t === 'string' ? new Date(t) : t
        if (isNaN(d.getTime())) return '--'
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }

      const toDisplayUrl = async (url: string | undefined) => {
        if (!url || !url.startsWith('cloud://')) return url || ''
        return convertCloudUrl(url)
      }

      const directList: ReferralUser[] = Array.isArray(treeData.directInvites) ? treeData.directInvites : []
      const secondList: ReferralUser[] = Array.isArray(treeData.secondLevelInvites) ? treeData.secondLevelInvites : []
      const directInvites = await Promise.all(
        directList.map(async (u: ReferralUser) => {
          const avatarUrl = await toDisplayUrl(u && u.avatarUrl)
          return {
            ...u,
            avatarUrl: avatarUrl || '',
            avatarInitial: getAvatarInitial(u && u.nickName),
            inviteTimeText: formatInviteTime(u && u.inviteTime),
          }
        })
      )
      const secondLevelInvites = await Promise.all(
        secondList.map(async (u: ReferralUser) => {
          const avatarUrl = await toDisplayUrl(u && u.avatarUrl)
          return {
            ...u,
            avatarUrl: avatarUrl || '',
            avatarInitial: getAvatarInitial(u && u.nickName),
            inviteTimeText: formatInviteTime(u && u.inviteTime),
          }
        })
      )

      this.setData({
        inviteCode,
        rewardRules,
        stats,
        directInvites,
        secondLevelInvites,
      })
    } catch (e: any) {
      const msg = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '加载失败'
      console.error('我的邀请页 loadReferralData 报错:', e)
      wx.showToast({ title: msg.length > 20 ? '加载失败' : msg, icon: 'none' })
    } finally {
      this.setData({ _referralLoading: false })
      wx.hideLoading()
    }
  },

  onCopyCode() {
    const openid = requireLogin()
    if (!openid) return
    const { inviteCode } = this.data
    if (!inviteCode) {
      wx.showToast({ title: '邀请码未生成', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码' }),
    })
  },

  onShareAppMessage() {
    const { inviteCode } = this.data
    return {
      title: '好友运动成长助手，一起来打卡',
      path: inviteCode ? `/pages/index/index?ref=${encodeURIComponent(inviteCode)}` : '/pages/index/index',
    }
  },
})
