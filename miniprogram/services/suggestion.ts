/**
 * 意见反馈服务
 */
import { suggestionsCol, usersCol } from './db'
import { upgradeVip, VipLevel } from './vip'

/** ========== 管理员配置 ========== */
/** 管理员 openid 列表（在这里配置你的 openid） */
export const ADMIN_OPENIDS: string[] = [
  'oty1n1yZenDCTN-d3Ihx6k61kq8o',  // 替换为你的 openid
]

/** 默认增加的VIP天数 */
export const DEFAULT_VIP_DAYS = 30

/** 意见类型 */
export type SuggestionType = 'bug' | 'feature' | 'feedback' | 'vip_request'

/** 意见状态 */
export type SuggestionStatus = 'pending' | 'approved' | 'rejected'

/** 意见类型名称 */
export const SuggestionTypeNames: Record<SuggestionType, string> = {
  bug: 'Bug反馈',
  feature: '功能建议',
  feedback: '其他反馈',
  vip_request: 'VIP申请'
}

/** 意见状态名称 */
export const SuggestionStatusNames: Record<SuggestionStatus, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已拒绝'
}

/** 意见记录类型 */
export interface Suggestion {
  _id: string
  _openid?: string
  openid: string
  content: string
  type: SuggestionType
  status: SuggestionStatus
  adminId?: string
  adminRemark?: string
  vipDays?: number
  contact?: string
  nickname?: string
  avatarUrl?: string
  processedAt?: Date
  createTime: Date
  updateTime: Date
}

/** 管理员微信号列表（可配置多个管理员） */
const ADMIN_WECHAT_IDS = ['ch668816888']

/**
 * 检查用户是否为管理员（通过 openid 判断）
 */
export function isAdminByOpenid(openid: string): boolean {
  return ADMIN_OPENIDS.includes(openid)
}

/**
 * 检查用户是否为管理员
 */
export async function isAdmin(openid: string): Promise<boolean> {
  // 优先使用配置的白名单
  if (ADMIN_OPENIDS.length > 0 && ADMIN_OPENIDS[0].startsWith('oL-')) {
    return isAdminByOpenid(openid)
  }

  // 方式1: 检查 isAdmin 字段
  const { data } = await usersCol().where({ openid, isAdmin: true }).get()
  if (data.length > 0) return true

  // 方式2: 检查是否在管理员列表中
  return isAdminByOpenid(openid)
}

/**
 * 提交意见
 */
export async function submitSuggestion(
  openid: string,
  content: string,
  type: SuggestionType,
  contact?: string
): Promise<{ ok: boolean; msg?: string; suggestionId?: string }> {
  if (!content || content.trim().length === 0) {
    return { ok: false, msg: '请输入意见内容' }
  }

  if (content.length > 500) {
    return { ok: false, msg: '意见内容不能超过500字' }
  }

  // VIP申请类型必须有合理的理由
  if (type === 'vip_request' && content.length < 10) {
    return { ok: false, msg: 'VIP申请请详细说明理由（至少10个字）' }
  }

  try {
    const now = new Date()
    const { _id } = await suggestionsCol().add({
      data: {
        openid,
        content: content.trim(),
        type,
        status: 'pending' as SuggestionStatus,
        contact: contact && contact.trim() ? contact.trim() : '',
        createTime: now,
        updateTime: now
      }
    })

    return { ok: true, suggestionId: _id }
  } catch (e) {
    console.error('submitSuggestion error:', e)
    return { ok: false, msg: '提交失败，请重试' }
  }
}

/**
 * 获取用户提交的意见列表
 */
export async function getUserSuggestions(openid: string): Promise<Suggestion[]> {
  try {
    const { data } = await suggestionsCol()
      .where({ openid })
      .orderBy('createTime', 'desc')
      .get()
    return data as Suggestion[]
  } catch (e) {
    console.error('getUserSuggestions error:', e)
    return []
  }
}

/**
 * 获取用户的最新一条意见
 */
export async function getLatestSuggestion(openid: string): Promise<Suggestion | null> {
  try {
    const { data } = await suggestionsCol()
      .where({ openid })
      .orderBy('createTime', 'desc')
      .limit(1)
      .get()
    return data.length > 0 ? (data[0] as Suggestion) : null
  } catch (e) {
    console.error('getLatestSuggestion error:', e)
    return null
  }
}

/**
 * 获取待处理的意见列表（管理员用）
 */
export async function getPendingSuggestions(): Promise<Suggestion[]> {
  try {
    const { data } = await suggestionsCol()
      .where({ status: 'pending' as SuggestionStatus })
      .orderBy('createTime', 'asc')
      .get()
    return data as Suggestion[]
  } catch (e) {
    console.error('getPendingSuggestions error:', e)
    return []
  }
}

/**
 * 获取所有意见列表（管理员用）
 */
export async function getAllSuggestions(
  status?: SuggestionStatus,
  limit: number = 50,
  skip: number = 0
): Promise<Suggestion[]> {
  try {
    let query: any = {}
    if (status) {
      query.status = status
    }

    const { data } = await suggestionsCol()
      .where(query)
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    return data as Suggestion[]
  } catch (e) {
    console.error('getAllSuggestions error:', e)
    return []
  }
}

/**
 * 管理员审批意见
 */
export async function approveSuggestion(
  adminOpenid: string,
  suggestionId: string,
  approved: boolean,
  remark?: string,
  vipDays?: number
): Promise<{ ok: boolean; msg?: string }> {
  // 检查是否为管理员
  const isAdminUser = await isAdmin(adminOpenid)
  if (!isAdminUser) {
    return { ok: false, msg: '只有管理员才能审批意见' }
  }

  try {
    // 获取意见详情
    const suggestionDoc = await suggestionsCol().doc(suggestionId).get()
    const suggestion = suggestionDoc.data as Suggestion

    if (!suggestion) {
      return { ok: false, msg: '意见不存在' }
    }

    if (suggestion.status !== 'pending') {
      return { ok: false, msg: '该意见已处理，不能重复审批' }
    }

    const now = new Date()
    const newStatus: SuggestionStatus = approved ? 'approved' : 'rejected'

    // 如果是批准VIP申请，自动增加VIP时间
    if (approved && suggestion.type === 'vip_request' && vipDays && vipDays > 0) {
      const upgradeSuccess = await upgradeVip(suggestion.openid, VipLevel.BRONZE, vipDays)
      if (!upgradeSuccess) {
        return { ok: false, msg: 'VIP升级失败，请重试' }
      }
    }

    // 更新意见状态
    await suggestionsCol().doc(suggestionId).update({
      data: {
        status: newStatus,
        adminId: adminOpenid,
        adminRemark: remark && remark.trim() ? remark.trim() : '',
        vipDays: approved ? vipDays : undefined,
        processedAt: now,
        updateTime: now
      }
    })

    return { ok: true }
  } catch (e) {
    console.error('approveSuggestion error:', e)
    return { ok: false, msg: '审批失败，请重试' }
  }
}

/**
 * 获取意见详情
 */
export async function getSuggestionById(suggestionId: string): Promise<Suggestion | null> {
  try {
    const { data } = await suggestionsCol().doc(suggestionId).get()
    return data as Suggestion
  } catch (e) {
    console.error('getSuggestionById error:', e)
    return null
  }
}

/**
 * 获取统计数据（管理员用）
 */
export async function getSuggestionStats(): Promise<{
  total: number
  pending: number
  approved: number
  rejected: number
  vipApproved: number
}> {
  try {
    const { total } = await suggestionsCol().count()
    const { total: pending } = await suggestionsCol().where({ status: 'pending' as SuggestionStatus }).count()
    const { total: approved } = await suggestionsCol().where({ status: 'approved' as SuggestionStatus }).count()
    const { total: rejected } = await suggestionsCol().where({ status: 'rejected' as SuggestionStatus }).count()
    const { total: vipApproved } = await suggestionsCol()
      .where({ status: 'approved' as SuggestionStatus, type: 'vip_request' as SuggestionType })
      .count()

    return { total, pending, approved, rejected, vipApproved }
  } catch (e) {
    console.error('getSuggestionStats error:', e)
    return { total: 0, pending: 0, approved: 0, rejected: 0, vipApproved: 0 }
  }
}
