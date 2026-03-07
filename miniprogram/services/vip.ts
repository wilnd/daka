/**
 * VIP服务
 */
import { usersCol } from './db'

/** VIP等级枚举 */
export enum VipLevel {
  NORMAL = 0,
  BRONZE = 1,
  SILVER = 2,
  GOLD = 3
}

/** VIP等级名称 */
export const VipLevelNames: Record<number, string> = {
  [VipLevel.NORMAL]: '普通用户',
  [VipLevel.BRONZE]: '青铜VIP',
  [VipLevel.SILVER]: '白银VIP',
  [VipLevel.GOLD]: '黄金VIP'
}

/** VIP等级对应的颜色 */
export const VipLevelColors: Record<number, string> = {
  [VipLevel.NORMAL]: '#999999',
  [VipLevel.BRONZE]: '#CD7F32',
  [VipLevel.SILVER]: '#C0C0C0',
  [VipLevel.GOLD]: '#FFD700'
}

/** VIP等级对应的福利 */
export const VipBenefits: Record<number, string[]> = {
  [VipLevel.NORMAL]: [
    '基础打卡功能',
    '查看统计数据'
  ],
  [VipLevel.BRONZE]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持'
  ],
  [VipLevel.SILVER]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持',
    '高级统计数据',
    '无限补卡次数'
  ],
  [VipLevel.GOLD]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持',
    '高级统计数据',
    '无限补卡次数',
    '专属客服支持',
    '限量礼品兑换'
  ]
}

/** VIP信息接口 */
export interface VipInfo {
  level: number
  expireTime: Date | null
  startTime: Date | null
  totalVipDays: number
  isExpired: boolean
}

/**
 * 获取用户VIP信息
 */
export async function getVipInfo(openid: string): Promise<VipInfo> {
  try {
    const { data } = await usersCol().where({ _openid: openid }).get()

    if (data.length === 0) {
      return {
        level: VipLevel.NORMAL,
        expireTime: null,
        startTime: null,
        totalVipDays: 0,
        isExpired: true
      }
    }

    const user = data[0]
    const now = new Date()
    const expireTime = user.vipExpireTime ? new Date(user.vipExpireTime) : null
    const isExpired = expireTime ? expireTime < now : true

    return {
      level: user.vipLevel || VipLevel.NORMAL,
      expireTime,
      startTime: user.vipStartTime ? new Date(user.vipStartTime) : null,
      totalVipDays: user.totalVipDays || 0,
      isExpired
    }
  } catch (e) {
    console.error('getVipInfo error:', e)
    return {
      level: VipLevel.NORMAL,
      expireTime: null,
      startTime: null,
      totalVipDays: 0,
      isExpired: true
    }
  }
}

/**
 * 升级VIP
 */
export async function upgradeVip(openid: string, level: VipLevel, days: number): Promise<boolean> {
  try {
    const now = new Date()
    const expireTime = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const { data } = await usersCol().where({ _openid: openid }).get()

    if (data.length === 0) {
      return false
    }

    const user = data[0]
    const currentExpireTime = user.vipExpireTime ? new Date(user.vipExpireTime) : new Date()
    const isCurrentlyExpired = !user.vipExpireTime || currentExpireTime < now

    // 计算新的过期时间
    let newExpireTime: Date
    if (isCurrentlyExpired) {
      newExpireTime = expireTime
    } else {
      newExpireTime = new Date(currentExpireTime.getTime() + days * 24 * 60 * 60 * 1000)
    }

    await usersCol().where({ _openid: openid }).update({
      data: {
        vipLevel: level,
        vipStartTime: isCurrentlyExpired ? now : user.vipStartTime,
        vipExpireTime: newExpireTime,
        totalVipDays: (user.totalVipDays || 0) + days
      }
    })

    return true
  } catch (e) {
    console.error('upgradeVip error:', e)
    return false
  }
}

/**
 * 检查用户是否为VIP（未过期）
 */
export async function isVip(openid: string): Promise<boolean> {
  const vipInfo = await getVipInfo(openid)
  return vipInfo.level > VipLevel.NORMAL && !vipInfo.isExpired
}

/**
 * 获取用户的VIP剩余天数
 */
export async function getVipRemainingDays(openid: string): Promise<number> {
  const vipInfo = await getVipInfo(openid)
  if (!vipInfo.expireTime || vipInfo.isExpired) {
    return 0
  }

  const now = new Date()
  const diff = vipInfo.expireTime.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

/**
 * 获取VIP加成后的补卡次数上限
 */
export async function getMakeupQuotaWithVip(openid: string): Promise<number> {
  const baseQuota = 2
  const vipInfo = await getVipInfo(openid)

  if (vipInfo.level === VipLevel.NORMAL || vipInfo.isExpired) {
    return baseQuota
  }

  // 不同VIP等级有不同的补卡加成
  switch (vipInfo.level) {
    case VipLevel.BRONZE:
      return 5 // 青铜VIP额外3次
    case VipLevel.SILVER:
      return 10 // 白银VIP额外8次（无限）
    case VipLevel.GOLD:
      return 999 // 黄金VIP无限次
    default:
      return baseQuota
  }
}
