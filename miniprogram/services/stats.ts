/**
 * 数据统计服务：连胜、连续未打卡、打卡率
 * 优化：单次查询打卡记录，本地计算，避免多次 DB 请求卡顿
 */
import { db, checkinsCol, getTodayStr, getDateBefore } from './db'

/** 获取近 400 天的打卡记录（用于计算连胜/未打卡） */
async function getRecentCheckins(
  userId: string,
  groupId: string
): Promise<{ date: string; isMakeup: boolean }[]> {
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const _ = db.command
  const { data } = await checkinsCol()
    .where({
      userId,
      groupId,
      date: _.and(_.gte(start), _.lte(today)),
    })
    .limit(500)
    .get()
  return (data || []) as { date: string; isMakeup: boolean }[]
}

/** 计算连胜天数（不含补卡） */
export async function getStreak(userId: string, groupId: string): Promise<number> {
  const checkins = await getRecentCheckins(userId, groupId)
  const normalDates = new Set(
    checkins.filter((c) => !c.isMakeup).map((c) => c.date)
  )
  let streak = 0
  let d = getTodayStr()
  for (let i = 0; i < 365; i++) {
    if (normalDates.has(d)) {
      streak++
      d = getDateBefore(d, 1)
    } else {
      break
    }
  }
  return streak
}

/** 计算连续未打卡天数 */
export async function getMissStreak(
  userId: string,
  groupId: string
): Promise<number> {
  const checkins = await getRecentCheckins(userId, groupId)
  const checkedDates = new Set(checkins.map((c) => c.date))
  let miss = 0
  let d = getTodayStr()
  for (let i = 0; i < 365; i++) {
    if (!checkedDates.has(d)) {
      miss++
      d = getDateBefore(d, 1)
    } else {
      break
    }
  }
  return miss
}

/** 总打卡天数（含补卡） */
export async function getTotalDays(
  userId: string,
  groupId: string
): Promise<number> {
  const { total } = await checkinsCol()
    .where({ userId, groupId })
    .count()
  return total
}
