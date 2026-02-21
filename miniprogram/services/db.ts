/**
 * 云数据库服务
 */
export const db = wx.cloud.database()

export const usersCol = () => db.collection('users')
export const groupsCol = () => db.collection('groups')
export const membersCol = () => db.collection('members')
export const checkinsCol = () => db.collection('checkins')
export const makeupQuotaCol = () => db.collection('makeupQuota')

/** 生成唯一邀请码 6 位 */
export function genInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
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
