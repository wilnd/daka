// vip.ts
import { getVipInfo, VipLevelNames, VipLevelColors, upgradeVip, getVipRemainingDays, VipLevel } from '../../services/vip'

interface LevelOption {
  level: number
  name: string
  recommended?: boolean
}

interface DurationOption {
  days: number
  price: number
  originalPrice?: number
  tag?: string
}

Page({
  data: {
    themeColor: '#1ABC9C',
    vipInfo: {
      level: 0,
      expireTime: null,
      startTime: null,
      totalVipDays: 0,
      isExpired: true,
      formattedStartTime: '-',
      formattedExpireTime: '-'
    },
    vipLevelNames: VipLevelNames,
    vipLevelColors: VipLevelColors,
    remainingDays: 0,
    // 权益亮点
    highlightBenefits: [
      { icon: '💎', text: '专属徽章' },
      { icon: '📊', text: '高级统计' },
      { icon: '🔄', text: '无限补卡' }
    ],
    // 权益列表
    benefitsList: [
      { icon: '💎', title: '专属徽章', desc: '个人主页展示VIP标识' },
      { icon: '📈', title: '高级统计', desc: '查看更详细的运动数据分析' },
      { icon: '🔄', title: '补卡次数', desc: '每月最多12次补卡机会' },
      { icon: '🎁', title: '专属礼品', desc: '黄金VIP可兑换限量礼品' },
      { icon: '💬', title: '客服优先', desc: '享受优先客服支持' },
      { icon: '⚡', title: '成长加速', desc: '获取更多成长值加成' }
    ],
    // 开通弹窗相关
    showUpgradeModal: false,
    selectedLevel: 1,
    selectedDuration: 30,
    currentPrice: 9,
    canUpgrade: false,
    isUpgrading: false,
    // 等级选项
    levelOptions: [
      { level: 0, name: '普通' },
      { level: 1, name: '青铜VIP', recommended: true },
      { level: 2, name: '白银VIP' },
      { level: 3, name: '黄金VIP' }
    ] as LevelOption[],
    // 时长选项
    durationOptions: [
      { days: 30, price: 9, originalPrice: 18, tag: '首月' },
      { days: 90, price: 25, originalPrice: 50 },
      { days: 365, price: 99, originalPrice: 199, tag: '特惠' }
    ] as DurationOption[]
  },

  get currentPrice(): number {
    const option = this.data.durationOptions.find(d => d.days === this.data.selectedDuration)
    return option ? option.price : 0
  },

  get canUpgrade(): boolean {
    return this.data.selectedLevel > 0 && this.data.selectedDuration > 0
  },

  onLoad() {
    // 数据加载在 onShow 中处理
  },

  onShow() {
    this.loadVipInfo()
  },

  async loadVipInfo() {
    const app = getApp() as any
    const openid = app.globalData.openid
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    try {
      const [vipInfo, remainingDays] = await Promise.all([
        getVipInfo(openid),
        getVipRemainingDays(openid)
      ])

      // 预格式化日期
      const formattedVipInfo = {
        ...vipInfo,
        formattedStartTime: this.formatDate(vipInfo.startTime),
        formattedExpireTime: this.formatDate(vipInfo.expireTime)
      }

      // 如果有VIP，默认选中对应等级
      if (vipInfo.level > 0) {
        this.setData({
          selectedLevel: vipInfo.level
        })
      }

      this.setData({
        vipInfo: formattedVipInfo,
        remainingDays
      })
    } catch (e) {
      console.error('loadVipInfo error:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  formatDate(date: Date | null | string): string {
    if (!date) return '-'
    const d = typeof date === 'string' ? new Date(date) : date
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  showUpgradeOptions() {
    this.setData({ showUpgradeModal: true })
  },

  closeUpgradeModal() {
    this.setData({ showUpgradeModal: false })
  },

  selectLevel(e: any) {
    const level = e.currentTarget.dataset.level
    const canUpgrade = level > 0 && this.data.selectedDuration > 0
    this.setData({ 
      selectedLevel: level,
      canUpgrade
    })
  },

  selectDuration(e: any) {
    const days = e.currentTarget.dataset.days
    const option = this.data.durationOptions.find(d => d.days === days)
    const canUpgrade = this.data.selectedLevel > 0 && days > 0
    this.setData({ 
      selectedDuration: days,
      currentPrice: option ? option.price : 0,
      canUpgrade
    })
  },

  async confirmUpgrade() {
    const canUpgrade = this.data.selectedLevel > 0 && this.data.selectedDuration > 0
    if (!canUpgrade || this.data.isUpgrading) return

    const app = getApp() as any
    const openid = app.globalData.openid

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    this.setData({ isUpgrading: true })

    try {
      const success = await upgradeVip(
        openid,
        this.data.selectedLevel as VipLevel,
        this.data.selectedDuration
      )

      if (success) {
        wx.showToast({
          title: '开通成功',
          icon: 'success'
        })
        this.setData({ showUpgradeModal: false })
        this.loadVipInfo()
      } else {
        wx.showToast({
          title: '开通失败',
          icon: 'none'
        })
      }
    } catch (e) {
      console.error('confirmUpgrade error:', e)
      wx.showToast({
        title: '开通失败',
        icon: 'none'
      })
    } finally {
      this.setData({ isUpgrading: false })
    }
  },

  onShareAppMessage() {
    return {
      title: '运动成长助手 - VIP会员',
      path: '/pages/index/index'
    }
  }
})
