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

/** 各等级 RMB 续费价：月价 青铜5/白银15/黄金30，90天与一年性价比更高 */
const LEVEL_DURATION_PRICES: Record<number, { days: number; price: Amount; originalPrice?: Amount; tag?: string }[]> = {
  1: [
    { days: 30, price: '5' },
    { days: 90, price: '12', originalPrice: '15', tag: '省3元' },
    { days: 365, price: '45', originalPrice: '60', tag: '特惠' }
  ],
  2: [
    { days: 30, price: '15' },
    { days: 90, price: '40', originalPrice: '45', tag: '省5元' },
    { days: 365, price: '120', originalPrice: '180', tag: '特惠' }
  ],
  3: [
    { days: 30, price: '30' },
    { days: 90, price: '80', originalPrice: '90', tag: '省10元' },
    { days: 365, price: '240', originalPrice: '360', tag: '特惠' }
  ]
}

function getDurationOptionsForLevel(level: number): DurationOption[] {
  const raw = LEVEL_DURATION_PRICES[level] || LEVEL_DURATION_PRICES[1]
  return raw.map(r => ({
    days: r.days,
    price: r.price,
    originalPrice: r.originalPrice,
    priceDisplay: formatYuan(r.price),
    originalPriceDisplay: r.originalPrice ? formatYuan(r.originalPrice) : undefined,
    tag: r.tag
  })) as DurationOption[]
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
    currentPrice: '5' as Amount,
    /** 当前金额展示用（¥5.00） */
    currentPriceDisplay: formatYuan('5'),
    canUpgrade: false,
    isUpgrading: false,
    // 等级选项
    levelOptions: [
      { level: 0, name: '普通' },
      { level: 1, name: '青铜VIP', recommended: true },
      { level: 2, name: '白银VIP' },
      { level: 3, name: '黄金VIP' }
    ] as LevelOption[],
    // 时长选项（按等级不同价格，默认青铜档）
    durationOptions: getDurationOptionsForLevel(1),
    // 积分兑换
    referralPoints: 0,
    /** 积分兑换选项：仅 7 天套餐，青铜5积分/白银10积分/黄金15积分 */
    pointsExchangeOptions: [
      { level: 1, levelName: '青铜VIP', days: 7, points: 5 },
      { level: 2, levelName: '白银VIP', days: 7, points: 10 },
      { level: 3, levelName: '黄金VIP', days: 7, points: 15 }
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
    const level = this.data.selectedLevel
    const opts = getDurationOptionsForLevel(level > 0 ? level : 1)
    const current = opts.find(o => o.days === this.data.selectedDuration) || opts[0]
    this.setData({
      showUpgradeModal: true,
      durationOptions: opts,
      currentPrice: current.price,
      currentPriceDisplay: formatYuan(current.price)
    })
  },

  closeUpgradeModal() {
    this.setData({ showUpgradeModal: false })
  },

  selectLevel(e: any) {
    const level = Number(e.currentTarget.dataset.level)
    const opts = getDurationOptionsForLevel(level > 0 ? level : 1)
    const current = opts.find(o => o.days === this.data.selectedDuration) || opts[0]
    this.setData({
      selectedLevel: level,
      durationOptions: opts,
      currentPrice: current.price,
      currentPriceDisplay: formatYuan(current.price),
      canUpgrade: level > 0 && this.data.selectedDuration > 0
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
