/**
 * 数据统计服务：连胜、连续未打卡、打卡率
 * 优化：单次查询打卡记录，本地计算，避免多次 DB 请求卡顿
 */
import { db, checkinsCol, membersCol, usersCol, getTodayStr, getDateBefore } from './db'

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
      date: _.and(_.gte(start), _.lte(today)),
    })
    .limit(500)
    .get()
  return (data || []) as { date: string; isMakeup: boolean }[]
}

/** 计算连胜天数（不含补卡）
 * 逻辑：
 * - 昨天打卡了，今天还没打 → 显示昨天之前的连续天数
 * - 昨天没打，今天打了 → 显示1
 * - 昨天今天都没打 → 显示0
 */
export async function getStreak(userId: string, groupId: string): Promise<number> {
  const checkins = await getRecentCheckins(userId, groupId)
  if (!checkins || checkins.length === 0) return 0

  const normalDates = new Set(
    checkins.map((c) => c.date)  // 包含补卡
  )

  const today = getTodayStr()
  const yesterday = getDateBefore(today, 1)

  // 昨天没打卡
  if (!normalDates.has(yesterday)) {
    // 今天打了，返回1；今天没打，返回0
    return normalDates.has(today) ? 1 : 0
  }

  // 昨天打卡了，从昨天往前连续统计
  let streak = 0
  let d = yesterday
  for (let i = 0; i < 365; i++) {
    if (normalDates.has(d)) {
      streak++
      d = getDateBefore(d, 1)
    } else {
      break
    }
  }
  // 如果今天也打卡了，需要把今天算上
  if (normalDates.has(today)) {
    streak++
  }

  return streak
}

/** 计算连续未打卡天数（只算到昨天为止，今天未打卡不算） */
export async function getMissStreak(
  userId: string,
  groupId: string
): Promise<number> {
  const checkins = await getRecentCheckins(userId, groupId)
  // 没有打卡记录时，返回0
  if (!checkins || checkins.length === 0) {
    return 0
  }
  const checkedDates = new Set(checkins.map((c) => c.date))
  let miss = 0
  // 从昨天开始计算连续未打卡，不包含今天
  let d = getDateBefore(getTodayStr(), 1)
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

/** 判断昨天是否已打卡 */
export async function wasCheckedInYesterday(userId: string): Promise<boolean> {
  const yesterday = getDateBefore(getTodayStr(), 1)
  const { data } = await checkinsCol()
    .where({ userId, date: yesterday })
    .limit(1)
    .get()
  return (data && data.length > 0) || false
}

/** 总打卡天数（含补卡） */
export async function getTotalDays(
  userId: string,
  groupId: string
): Promise<number> {
  const { total } = await checkinsCol()
    .where({ userId })
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

  // 获取所有成员最近400天的打卡记录（打卡与群组无关：按用户维度聚合）
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const memberUserIds = (members as any[]).map(m => m.userId).filter(Boolean)
  const checkins = await getCheckinsForUsersInRange(memberUserIds, start, today)

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

  // 获取所有成员最近400天的打卡记录（打卡与群组无关：按用户维度聚合）
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const memberUserIds = (members as any[]).map(m => m.userId).filter(Boolean)
  const checkins = await getCheckinsForUsersInRange(memberUserIds, start, today)

  return computeRank(members as any[], checkins as any[])
}

/** 获取月榜：本月打卡排名（按连续打卡天数） */
export async function getMonthRank(groupId: string): Promise<RankUser[]> {
  // 获取小组所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) return []

  // 获取所有成员最近400天的打卡记录（打卡与群组无关：按用户维度聚合）
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const memberUserIds = (members as any[]).map(m => m.userId).filter(Boolean)
  const checkins = await getCheckinsForUsersInRange(memberUserIds, start, today)

  return computeRank(members as any[], checkins as any[])
}

/** 获取一组用户在日期区间内的打卡记录（分批 + 分页） */
async function getCheckinsForUsersInRange(userIds: string[], start: string, end: string): Promise<any[]> {
  if (!userIds || userIds.length === 0) return []
  const _ = db.command
  const all: any[] = []
  const batchSize = 10
  const limit = 100

  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    let skip = 0
    while (true) {
      const { data } = await checkinsCol()
        .where({
          userId: _.in(batch),
          date: _.and(_.gte(start), _.lte(end)),
        })
        .orderBy('date', 'asc')
        .skip(skip)
        .limit(limit)
        .get()
      all.push(...(data || []))
      if (!data || data.length < limit) break
      skip += limit
    }
  }
  return all
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
  const yesterday = getDateBefore(today, 1)
  for (const member of members) {
    const uid = member.userId
    const dates = userCheckins[uid]
    if (!dates || dates.size === 0) {
      userStreaks[uid] = 0
      continue
    }

    // 昨天没打卡
    if (!dates.has(yesterday)) {
      // 今天打了，返回1；今天没打，返回0
      userStreaks[uid] = dates.has(today) ? 1 : 0
      continue
    }

    // 昨天打卡了，从昨天往前连续统计
    let streak = 0
    let d = yesterday
    for (let i = 0; i < 400; i++) {
      if (dates.has(d)) {
        streak++
        d = getDateBefore(d, 1)
      } else {
        break
      }
    }
    // 如果今天也打卡了，需要把今天算上
    if (dates.has(today)) {
      streak++
    }

    userStreaks[uid] = streak
  }

  // 获取用户信息
  const userIds = members.map(m => m.userId)
  const _ = db.command
  const users: any[] = []
  const batchSize = 10
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    const { data } = await usersCol()
      .where({ openid: _.in(batch) })
      .get()
    users.push(...((data || []) as any[]))
  }

  const userInfoMap: Record<string, any> = {}
  for (const u of users as any[]) {
    userInfoMap[u.openid] = u
  }

  // 构建结果并按连续天数排序
  const result: RankUser[] = members.map(m => ({
    userId: m.userId,
    nickName: (userInfoMap[m.userId] && userInfoMap[m.userId].nickName) || '未知',
    avatarUrl: (userInfoMap[m.userId] && userInfoMap[m.userId].avatarUrl) || '',
    streak: userStreaks[m.userId] || 0,
  }))

  return result.sort((a, b) => b.streak - a.streak)
}
