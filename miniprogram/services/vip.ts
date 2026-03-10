/**
 * VIP 服务
 *
 * 升级体系（单一数据源，避免多处文案/逻辑不一致）：
 * - 等级：0 普通、1 青铜、2 白银、3 黄金
 * - 补卡次数/月：普通 2 次，青铜 5 次，白银 10 次，黄金 无限（999）
 * - 获得方式：管理员审批（VIP 申请）→ 青铜 + N 天；VIP 页购买 → 自选等级 + 时长；任务/目标奖励 vip_days 需在领取时调用 upgradeVip（当前任务领取仅标记 claimed，未发 VIP 天数）
 * - 展示：补卡文案统一用 getMakeupQuotaDisplay(level)，权益列表用 VipBenefits，数量用 VIP_MAKEUP_QUOTA
 */
import { usersCol } from './db'
import { unlockAchievement } from './task'

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

/** 每月补卡次数上限（单一数据源：普通2次，青铜5次，白银10次，黄金视为无限） */
export const VIP_MAKEUP_QUOTA: Record<number, number> = {
  [VipLevel.NORMAL]: 2,
  [VipLevel.BRONZE]: 5,
  [VipLevel.SILVER]: 10,
  [VipLevel.GOLD]: 999
}

/** 每月小勤同学点评生成次数上限（普通5次，青铜20次，白银40次，黄金100次；每月初0点更新） */
export const VIP_AI_REVIEW_QUOTA: Record<number, number> = {
  [VipLevel.NORMAL]: 5,
  [VipLevel.BRONZE]: 20,
  [VipLevel.SILVER]: 40,
  [VipLevel.GOLD]: 100
}

/** 补卡次数展示文案（用于个人页、VIP 页等） */
export function getMakeupQuotaDisplay(level: number): string {
  const quota = VIP_MAKEUP_QUOTA[level] != null ? VIP_MAKEUP_QUOTA[level] : 2
  return quota >= 999 ? '无限' : `${quota}次`
}

/** 小勤点评次数展示文案（用于个人页、VIP 页等） */
export function getAiReviewQuotaDisplay(level: number): string {
  const quota = VIP_AI_REVIEW_QUOTA[level] != null ? VIP_AI_REVIEW_QUOTA[level] : 5
  return `每月${quota}次`
}

/** VIP等级对应的福利（与 VIP_MAKEUP_QUOTA、VIP_AI_REVIEW_QUOTA 一致，避免文案与逻辑不符） */
export const VipBenefits: Record<number, string[]> = {
  [VipLevel.NORMAL]: [
    '基础打卡功能',
    '查看统计数据',
    '小勤点评每月5次'
  ],
  [VipLevel.BRONZE]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持',
    '每月5次补卡',
    '小勤点评每月20次'
  ],
  [VipLevel.SILVER]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持',
    '高级统计数据',
    '每月10次补卡',
    '小勤点评每月40次'
  ],
  [VipLevel.GOLD]: [
    '基础打卡功能',
    '查看统计数据',
    '专属徽章标识',
    '优先客服支持',
    '高级统计数据',
    '无限补卡',
    '小勤点评每月100次',
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

    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const aiReviewQuotaMonth = `${y}-${m}`

    await usersCol().where({ _openid: openid }).update({
      data: {
        vipLevel: level,
        vipStartTime: isCurrentlyExpired ? now : user.vipStartTime,
        vipExpireTime: newExpireTime,
        totalVipDays: (user.totalVipDays || 0) + days,
        aiReviewUsedThisMonth: 0,
        aiReviewQuotaMonth
      }
    })

    // 成就埋点：成为 VIP 时解锁「VIP会员」成就
    try {
      await unlockAchievement(openid, 'vip_member')
    } catch (e) {
      console.warn('解锁VIP成就失败', e)
    }
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

  return VIP_MAKEUP_QUOTA[vipInfo.level] != null ? VIP_MAKEUP_QUOTA[vipInfo.level] : baseQuota
}

/**
 * 获取VIP对应的小勤点评每月生成次数上限
 */
export async function getAiReviewQuotaWithVip(openid: string): Promise<number> {
  const vipInfo = await getVipInfo(openid)
  if (vipInfo.level === VipLevel.NORMAL || vipInfo.isExpired) {
    return VIP_AI_REVIEW_QUOTA[VipLevel.NORMAL]
  }
  return VIP_AI_REVIEW_QUOTA[vipInfo.level] != null ? VIP_AI_REVIEW_QUOTA[vipInfo.level] : 0
}
