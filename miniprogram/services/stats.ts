/**
 * 数据统计服务：连胜、连续未打卡、打卡率
 * 优化：单次查询打卡记录，本地计算，避免多次 DB 请求卡顿
 */
import { db, checkinsCol, membersCol, getTodayStr, getDateBefore } from './db'

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

/** 排行榜用户信息 */
export interface RankUser {
  userId: string
  nickName: string
  avatarUrl: string
  streak: number
}

/** 获取日榜：今日打卡排名（按连续打卡天数） */
export async function getDayRank(groupId: string): Promise<RankUser[]> {
  // 获取小组所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) return []

  // 获取所有成员最近400天的打卡记录
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const _ = db.command
  const { data: checkins } = await checkinsCol()
    .where({
      groupId,
      date: _.and(_.gte(start), _.lte(today)),
    })
    .get()

  // 按用户分组，统计连续打卡天数
  return computeRank(members as any[], checkins as any[])
}

/** 获取周榜：本周打卡排名（按连续打卡天数） */
export async function getWeekRank(groupId: string): Promise<RankUser[]> {
  // 获取小组所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) return []

  // 获取所有成员最近400天的打卡记录
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const _ = db.command
  const { data: checkins } = await checkinsCol()
    .where({
      groupId,
      date: _.and(_.gte(start), _.lte(today)),
    })
    .get()

  return computeRank(members as any[], checkins as any[])
}

/** 获取月榜：本月打卡排名（按连续打卡天数） */
export async function getMonthRank(groupId: string): Promise<RankUser[]> {
  // 获取小组所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) return []

  // 获取所有成员最近400天的打卡记录
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const _ = db.command
  const { data: checkins } = await checkinsCol()
    .where({
      groupId,
      date: _.and(_.gte(start), _.lte(today)),
    })
    .get()

  return computeRank(members as any[], checkins as any[])
}

/** 计算排行榜（根据连续打卡天数排序） */
async function computeRank(members: any[], checkins: any[]): Promise<RankUser[]> {
  // 按用户分组打卡记录
  const userCheckins: Record<string, Set<string>> = {}
  for (const c of checkins) {
    if (!userCheckins[c.userId]) {
      userCheckins[c.userId] = new Set()
    }
    userCheckins[c.userId].add(c.date)
  }

  // 计算每个用户的连续打卡天数
  const userStreaks: Record<string, number> = {}
  const today = getTodayStr()
  for (const member of members) {
    const uid = member.userId
    const dates = userCheckins[uid]
    if (!dates || dates.size === 0) {
      userStreaks[uid] = 0
      continue
    }
    // 计算连续打卡天数（从今天往前数）
    let streak = 0
    let d = today
    for (let i = 0; i < 400; i++) {
      if (dates.has(d)) {
        streak++
        d = getDateBefore(d, 1)
      } else {
        break
      }
    }
    userStreaks[uid] = streak
  }

  // 获取用户信息
  const userIds = members.map(m => m.userId)
  const { data: users } = await db.collection('users')
    .where({
      _openid: db.command.in(userIds)
    })
    .get()

  const userInfoMap: Record<string, any> = {}
  for (const u of users as any[]) {
    userInfoMap[u._openid] = u
  }

  // 构建结果并按连续天数排序
  const result: RankUser[] = members.map(m => ({
    userId: m.userId,
    nickName: userInfoMap[m.userId]?.nickName || '未知',
    avatarUrl: userInfoMap[m.userId]?.avatarUrl || '',
    streak: userStreaks[m.userId] || 0,
  }))

  return result.sort((a, b) => b.streak - a.streak)
}
