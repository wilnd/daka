// vip.ts（访客可浏览 VIP 介绍与档位，开通时再要求登录）
import { isLoggedIn, requireLogin } from '../../services/auth'
import { getVipInfo, VipLevelNames, VipLevelColors, upgradeVip, getVipRemainingDays, VipLevel } from '../../services/vip'
import { formatYuan, type Amount } from '../../services/amount'
import { callGetPointsBalance, callExchangePointsForVip } from '../../services/score'

interface LevelOption {
  level: number
  name: string
  recommended?: boolean
}

interface DurationOption {
  days: number
  /** 金额一律用 BigDecimal（此处为 string） */
  price: Amount
  originalPrice?: Amount
  priceDisplay: string
  originalPriceDisplay?: string
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
    /** 当前选中套餐金额（BigDecimal 字符串） */
    currentPrice: '9' as Amount,
    /** 当前金额展示用（¥9.00） */
    currentPriceDisplay: formatYuan('9'),
    canUpgrade: false,
    isUpgrading: false,
    // 等级选项
    levelOptions: [
      { level: 0, name: '普通' },
      { level: 1, name: '青铜VIP', recommended: true },
      { level: 2, name: '白银VIP' },
      { level: 3, name: '黄金VIP' }
    ] as LevelOption[],
    // 时长选项（金额一律用 string/BigDecimal）
    durationOptions: [
      { days: 30, price: '9', originalPrice: '18', priceDisplay: formatYuan('9'), originalPriceDisplay: formatYuan('18'), tag: '首月' },
      { days: 90, price: '25', originalPrice: '50', priceDisplay: formatYuan('25'), originalPriceDisplay: formatYuan('50') },
      { days: 365, price: '99', originalPrice: '199', priceDisplay: formatYuan('99'), originalPriceDisplay: formatYuan('199'), tag: '特惠' }
    ] as DurationOption[],
    // 积分兑换
    referralPoints: 0,
    /** 积分兑换选项：每档位每天所需积分 青铜50/白银80/黄金120 */
    pointsExchangeOptions: [
      { level: 1, levelName: '青铜VIP', days: 7, points: 350 },
      { level: 1, levelName: '青铜VIP', days: 30, points: 1500 },
      { level: 2, levelName: '白银VIP', days: 7, points: 560 },
      { level: 2, levelName: '白银VIP', days: 30, points: 2400 },
      { level: 3, levelName: '黄金VIP', days: 7, points: 840 },
      { level: 3, levelName: '黄金VIP', days: 30, points: 3600 }
    ] as { level: 1 | 2 | 3; levelName: string; days: number; points: number }[],
    isExchanging: false
  },

  get currentPrice(): Amount {
    const option = this.data.durationOptions.find(d => d.days === this.data.selectedDuration)
    return option ? option.price : '0'
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
    if (!isLoggedIn()) {
      // 访客模式：保持默认 vipInfo，不请求接口
      return
    }
    const app = getApp() as any
    const openid = (app.globalData && app.globalData.openid) || wx.getStorageSync('openid')
    if (!openid) return

    try {
      const [vipInfo, remainingDays, pointsRes] = await Promise.all([
        getVipInfo(openid),
        getVipRemainingDays(openid),
        callGetPointsBalance()
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
        remainingDays,
        referralPoints: pointsRes.success ? (pointsRes.referralPoints != null ? pointsRes.referralPoints : 0) : 0
      })
    } catch (e) {
      console.error('loadVipInfo error:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 积分兑换 VIP */
  onExchangeWithPoints(e: WechatMiniprogram.CustomEvent) {
    const index = e.currentTarget.dataset.index as number
    const option = this.data.pointsExchangeOptions[index]
    if (!option || this.data.isExchanging) return
    if (this.data.referralPoints < option.points) {
      wx.showToast({ title: `积分不足，需要${option.points}积分`, icon: 'none' })
      return
    }
    const openid = requireLogin()
    if (!openid) return
    wx.showModal({
      title: '确认兑换',
      content: `使用 ${option.points} 积分兑换 ${option.days} 天${option.levelName}？`,
      success: (res) => {
        if (!res.confirm) return
        this.setData({ isExchanging: true })
        callExchangePointsForVip(option.level, option.days).then((result) => {
          if (result.success) {
            wx.showToast({ title: '兑换成功', icon: 'success' })
            if (result.remainingPoints != null) this.setData({ referralPoints: result.remainingPoints })
            this.loadVipInfo()
          } else {
            wx.showToast({ title: result.msg || '兑换失败', icon: 'none' })
          }
        }).finally(() => {
          this.setData({ isExchanging: false })
        })
      }
    })
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
      currentPrice: option ? option.price : '0',
      currentPriceDisplay: option ? formatYuan(option.price) : formatYuan('0'),
      canUpgrade
    })
  },

  async confirmUpgrade() {
    const canUpgrade = this.data.selectedLevel > 0 && this.data.selectedDuration > 0
    if (!canUpgrade || this.data.isUpgrading) return

    const openid = requireLogin()
    if (!openid) return

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
