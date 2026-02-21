/**
 * 打卡服务
 */
import { db, checkinsCol, makeupQuotaCol, getTodayStr, getCurrentMonth } from './db'

export interface Checkin {
  _id: string
  userId: string
  groupId: string
  date: string
  isMakeup: boolean
  createTime: Date
}

/** 每日打卡 */
export async function doCheckin(userId: string, groupId: string): Promise<{ ok: boolean; msg?: string }> {
  const today = getTodayStr()
  const { data: existing } = await checkinsCol()
    .where({ userId, groupId, date: today })
    .get()
  if (existing.length > 0) return { ok: false, msg: '今日已打卡，无需重复操作' }

  const now = new Date()
  await checkinsCol().add({
    data: { userId, groupId, date: today, isMakeup: false, createTime: now }
  })
  return { ok: true }
}

/** 补卡：仅可补今天往前 3 天（不含今天），每月 2 次 */
export async function doMakeup(
  userId: string,
  groupId: string,
  date: string
): Promise<{ ok: boolean; msg?: string }> {
  const today = getTodayStr()
  const d1 = new Date(today).getTime()
  const d2 = new Date(date).getTime()
  const diffDays = Math.floor((d1 - d2) / 86400000)
  if (diffDays < 1 || diffDays > 3) return { ok: false, msg: '仅可补近3天内未打卡日期' }

  const { data: existing } = await checkinsCol()
    .where({ userId, groupId, date })
    .get()
  if (existing.length > 0) return { ok: false, msg: '该日期已打卡' }

  const month = getCurrentMonth()
  const { data: quotaList } = await makeupQuotaCol()
    .where({ userId, month })
    .get()
  const used = quotaList.length > 0 ? (quotaList[0] as any).usedCount : 0
  if (used >= 2) return { ok: false, msg: '本月补卡次数已用尽，下月可继续使用' }

  const now = new Date()
  if (quotaList.length > 0) {
    await makeupQuotaCol().doc((quotaList[0] as any)._id).update({
      data: { usedCount: used + 1, updateTime: now }
    })
  } else {
    await makeupQuotaCol().add({
      data: { userId, month, usedCount: 1, createTime: now, updateTime: now }
    })
  }

  await checkinsCol().add({
    data: { userId, groupId, date, isMakeup: true, createTime: now }
  })
  return { ok: true }
}

/** 获取某月打卡记录 */
export async function getCheckinsByMonth(
  userId: string,
  groupId: string,
  yearMonth: string
): Promise<Checkin[]> {
  const [y, m] = yearMonth.split('-').map(Number)
  const start = `${yearMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  const end = `${yearMonth}-${pad(lastDay)}`

  const _ = db.command
  const { data } = await checkinsCol()
    .where({
      userId,
      groupId,
      date: _.and(_.gte(start), _.lte(end))
    })
    .orderBy('date', 'asc')
    .get()

  return (data || []) as Checkin[]
}

/** 今日是否已打卡 */
export async function isCheckedToday(userId: string, groupId: string): Promise<boolean> {
  const today = getTodayStr()
  const { total } = await checkinsCol()
    .where({ userId, groupId, date: today })
    .count()
  return total > 0
}

/** 获取今日剩余补卡次数 */
export async function getMakeupRemain(userId: string): Promise<number> {
  const month = getCurrentMonth()
  const { data } = await makeupQuotaCol().where({ userId, month }).get()
  const used = data.length > 0 ? (data[0] as any).usedCount : 0
  return Math.max(0, 2 - used)
}

/** 获取打卡记录列表 */
export async function getCheckinRecords(
  userId: string,
  groupId: string,
  limit = 50
): Promise<Checkin[]> {
  const { data } = await checkinsCol()
    .where({ userId, groupId })
    .orderBy('date', 'desc')
    .limit(limit)
    .get()
  return (data || []) as Checkin[]
}
