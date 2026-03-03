/**
 * 云数据库服务
 */
export const db = wx.cloud.database()

export const usersCol = () => db.collection('users')
export const groupsCol = () => db.collection('groups')
export const membersCol = () => db.collection('members')
export const checkinsCol = () => db.collection('checkins')
export const makeupQuotaCol = () => db.collection('makeupQuota')
export const momentsCol = () => db.collection('moments')
export const momentLikesCol = () => db.collection('momentLikes')
export const momentCommentsCol = () => db.collection('momentComments')

/** 生成唯一邀请码 6 位（避免重复） */
export async function genInviteCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const maxAttempts = 10 // 最多尝试10次

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }

    // 检查邀请码是否已存在
    const { data: existing } = await groupsCol().where({ inviteCode: code }).get()
    if (existing.length === 0) {
      return code
    }
  }

  // 尝试多次仍冲突，使用时间戳+随机字符作为后备
  const timestamp = Date.now().toString(36).toUpperCase()
  const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase()
  return (timestamp + randomSuffix).slice(-6).toUpperCase()
}

/** 获取今日日期 YYYY-MM-DD */
export function getTodayStr(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 获取某天往前 n 天的日期 */
export function getDateBefore(todayStr: string, days: number): string {
  const d = new Date(todayStr)
  d.setDate(d.getDate() - days)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 获取当前月份 YYYY-MM */
export function getCurrentMonth(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 从服务器获取当前月份（更可靠） */
let serverMonthCache: { month: string; expire: number } | null = null
export async function getServerMonth(): Promise<string> {
  const now = Date.now()
  if (serverMonthCache && serverMonthCache.expire > now) {
    return serverMonthCache.month
  }
  try {
    const res = await wx.cloud.callFunction({ name: 'getServerTime' })
    const data = res.result as { currentMonth: string }
    serverMonthCache = { month: data.currentMonth, expire: now + 60000 }
    return data.currentMonth
  } catch (e) {
    console.warn('getServerMonth failed, fallback to local', e)
    return getCurrentMonth()
  }
}
