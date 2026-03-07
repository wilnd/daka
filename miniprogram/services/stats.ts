/**
 * 数据统计服务：连胜、连续未记录、记录率
 * 优化：单次查询记录，本地计算，避免多次 DB 请求卡顿
 */
import { db, checkinsCol, membersCol, usersCol, getTodayStr, getDateBefore } from './db'

/** 排行榜缓存 key */
const RANK_CACHE_KEY = 'rankCache'

/** 头像 URL 缓存 key */
const AVATAR_CACHE_KEY = 'avatarUrlCache'

/** 缓存有效期：30秒 */
const RANK_CACHE_TTL = 30 * 1000

/** 缓存数据结构 */
interface RankCacheData {
  dayRank: RankUser[]
  weekRank: RankUser[]
  monthRank: RankUser[]
  timestamp: number
}

/** 获取排行榜缓存 */
function getRankCache(groupId: string): RankCacheData | null {
  try {
    const cache = wx.getStorageSync(RANK_CACHE_KEY)
    if (!cache) return null
    const data = cache[groupId] as RankCacheData | undefined
    if (!data) return null
    // 检查是否过期
    if (Date.now() - data.timestamp > RANK_CACHE_TTL) {
      return null
    }
    // 防御性检查：确保数组存在
    if (!data.dayRank || !data.weekRank || !data.monthRank) {
      return null
    }
    return data
  } catch {
    return null
  }
}

/** 设置排行榜缓存 */
function setRankCache(groupId: string, data: RankCacheData): void {
  try {
    const cache = wx.getStorageSync(RANK_CACHE_KEY) || {}
    cache[groupId] = data
    wx.setStorageSync(RANK_CACHE_KEY, cache)
  } catch {
    // 忽略存储错误
  }
}

/** 获取头像 URL 缓存 */
function getAvatarCache(): Record<string, string> {
  try {
    return wx.getStorageSync(AVATAR_CACHE_KEY) || {}
  } catch {
    return {}
  }
}

/** 设置头像 URL 缓存 */
function setAvatarCache(urlMap: Record<string, string>): void {
  try {
    const existing = getAvatarCache()
    const merged = { ...existing, ...urlMap }
    wx.setStorageSync(AVATAR_CACHE_KEY, merged)
  } catch {
    // 忽略存储错误
  }
}

/** 转换排行榜头像 URL（带缓存） */
export async function convertRankAvatarUrlsWithCache(rankList: RankUser[]): Promise<RankUser[]> {
  if (!rankList || rankList.length === 0) return []

  // 获取缓存
  const avatarCache = getAvatarCache()
  const cloudUrls: string[] = []
  const urlIndexMap = new Map<string, number>()

  // 检查哪些需要转换
  for (let i = 0; i < rankList.length; i++) {
    const url = rankList[i].avatarUrl
    if (!url) continue

    if (url.startsWith('cloud://')) {
      // 先检查缓存
      if (avatarCache[url]) {
        rankList[i].avatarUrl = avatarCache[url]
      } else {
        cloudUrls.push(url)
        urlIndexMap.set(url, i)
      }
    }
  }

  if (cloudUrls.length === 0) return rankList

  // 批量转换
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: cloudUrls })
    const urlMap: Record<string, string> = {}
    for (const item of res.fileList || []) {
      if (item.status === 0 && item.fileID && item.tempFileURL) {
        const idx = urlIndexMap.get(item.fileID)
        if (idx !== undefined) {
          rankList[idx].avatarUrl = item.tempFileURL
          urlMap[item.fileID] = item.tempFileURL
        }
      }
    }
    // 缓存转换后的 URL
    if (Object.keys(urlMap).length > 0) {
      setAvatarCache(urlMap)
    }
  } catch (e) {
    console.warn('批量转换排行榜头像URL失败', e)
  }

  return rankList
}

/** 获取近 400 天的打卡记录（用于计算连胜/未打卡） */
async function getRecentCheckins(
  userId: string,
  _groupId?: string  // 保留参数兼容性，但实际不使用
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
export async function getStreak(userId: string, groupId?: string): Promise<number> {
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
  groupId?: string
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

/** 总打卡次数（所有记录，含同一天多次打卡） */
export async function getTotalCount(
  userId: string,
  groupId?: string  // 保留参数兼容性，但实际不使用
): Promise<number> {
  const { total } = await checkinsCol()
    .where({ userId })
    .count()
  return total
}

/** 总打卡天数（去重后的日期数，同一天多次打卡只算1天） */
export async function getTotalDays(
  userId: string,
  groupId?: string  // 保留参数兼容性，但实际不使用
): Promise<number> {
  // 查询所有打卡记录，本地按日期去重
  const { data } = await checkinsCol()
    .where({ userId })
    .orderBy('date', 'desc')
    .limit(1000)
    .get()
  
  if (!data || data.length === 0) return 0
  
  // 按日期去重
  const uniqueDates = new Set(data.map((c: any) => c.date))
  return uniqueDates.size
}

/** 排行榜用户信息 */
export interface RankUser {
  userId: string
  nickName: string
  avatarUrl: string
  streak: number
}

/** 获取所有榜单数据（日/周/月），使用缓存 */
export async function getAllRanks(groupId: string): Promise<{ dayRank: RankUser[]; weekRank: RankUser[]; monthRank: RankUser[] }> {
  // 检查缓存
  const cached = getRankCache(groupId)
  if (cached) {
    // 返回缓存数据，同时异步刷新
    refreshRankInBackground(groupId)
    return {
      dayRank: cached.dayRank,
      weekRank: cached.weekRank,
      monthRank: cached.monthRank,
    }
  }

  // 无缓存，执行完整查询
  return computeAllRanks(groupId)
}

/** 后台异步刷新排行榜缓存 */
function refreshRankInBackground(groupId: string): void {
  computeAllRanks(groupId).then(data => {
    setRankCache(groupId, {
      dayRank: data.dayRank,
      weekRank: data.weekRank,
      monthRank: data.monthRank,
      timestamp: Date.now(),
    })
  }).catch(console.error)
}

/** 计算所有榜单数据 */
async function computeAllRanks(groupId: string): Promise<{ dayRank: RankUser[]; weekRank: RankUser[]; monthRank: RankUser[] }> {
  // 获取组织所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) {
    return { dayRank: [], weekRank: [], monthRank: [] }
  }

  // 获取所有成员最近400天的打卡记录
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const memberUserIds = (members as any[]).map(m => m.userId).filter(Boolean)
  const checkins = await getCheckinsForUsersInRange(memberUserIds, start, today)

  // 获取用户信息（批量查询）
  const userIds = members.map(m => m.userId).filter(Boolean)
  const users = await getUsersInfo(userIds || [])
  const userInfoMap: Record<string, any> = {}
  for (const u of (users || [])) {
    userInfoMap[u.openid] = u
  }

  // 一次性计算三个榜单
  const result = computeRank(members as any[], checkins as any[], userInfoMap)

  // 缓存结果
  setRankCache(groupId, {
    dayRank: result.dayRank,
    weekRank: result.weekRank,
    monthRank: result.monthRank,
    timestamp: Date.now(),
  })

  return result
}

/** 批量获取用户信息 */
async function getUsersInfo(userIds: string[]): Promise<any[]> {
  if (!userIds || userIds.length === 0) return []
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
  return users || []
}

/** 获取日榜：今日打卡排名（按连续打卡天数） */
export async function getDayRank(groupId: string): Promise<RankUser[]> {
  const { dayRank } = await getAllRanks(groupId)
  return dayRank
}

/** 获取周榜：本周打卡排名（按连续打卡天数） */
export async function getWeekRank(groupId: string): Promise<RankUser[]> {
  const { weekRank } = await getAllRanks(groupId)
  return weekRank
}

/** 获取月榜：本月打卡排名（按连续打卡天数） */
export async function getMonthRank(groupId: string): Promise<RankUser[]> {
  const { monthRank } = await getAllRanks(groupId)
  return monthRank
}

/** 获取总榜：累计打卡天数排名 */
export async function getAllRank(groupId: string): Promise<RankUser[]> {
  // 获取组织所有成员
  const { data: members } = await membersCol()
    .where({ groupId, status: 'normal' })
    .get()

  if (members.length === 0) {
    return []
  }

  // 获取用户信息（批量查询）
  const userIds = members.map(m => m.userId).filter(Boolean)
  const users = await getUsersInfo(userIds || [])
  const userInfoMap: Record<string, any> = {}
  for (const u of (users || [])) {
    userInfoMap[u.openid] = u
  }

  // 查询所有打卡记录，按日期去重
  const _ = db.command
  const { data: allCheckins } = await checkinsCol()
    .where({ userId: _.in(userIds) })
    .get()

  // 按用户分组，统计累计打卡天数
  const userTotalDays: Record<string, number> = {}
  const userCheckinDates: Record<string, Set<string>> = {}

  for (const checkin of (allCheckins || [])) {
    const uid = checkin.userId
    if (!userCheckinDates[uid]) {
      userCheckinDates[uid] = new Set()
    }
    userCheckinDates[uid].add(checkin.date)
  }

  // 统计每个用户的累计打卡天数
  for (const uid of userIds) {
    userTotalDays[uid] = userCheckinDates[uid] ? userCheckinDates[uid].size : 0
  }

  // 构建结果并按累计天数排序
  const result: RankUser[] = members.map(m => ({
    userId: m.userId,
    nickName: (userInfoMap[m.userId] && userInfoMap[m.userId].nickName) || '未知',
    avatarUrl: (userInfoMap[m.userId] && userInfoMap[m.userId].avatarUrl) || '',
    streak: userTotalDays[m.userId] || 0,
  }))

  return result.sort((a, b) => b.streak - a.streak)
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
      all.push(...((data || []) as any[]))
      if (!data || data.length < limit) break
      skip += limit
    }
  }
  return all || []
}

/** 计算排行榜（根据连续打卡天数排序）
 * @param userInfoMap 用户信息映射，用于避免重复查询
 */
function computeRank(
  members: any[],
  checkins: any[],
  userInfoMap: Record<string, any>
): { dayRank: RankUser[]; weekRank: RankUser[]; monthRank: RankUser[] } {
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

  // 构建结果并排序
  const buildRankList = (): RankUser[] => {
    const result: RankUser[] = members.map(m => ({
      userId: m.userId,
      nickName: (userInfoMap[m.userId] && userInfoMap[m.userId].nickName) || '未知',
      avatarUrl: (userInfoMap[m.userId] && userInfoMap[m.userId].avatarUrl) || '',
      streak: userStreaks[m.userId] || 0,
    }))
    return result.sort((a, b) => b.streak - a.streak)
  }

  // 三个榜单数据相同（都是按连续天数排序），返回三份引用
  const sortedRank = buildRankList()
  return {
    dayRank: sortedRank,
    weekRank: sortedRank,
    monthRank: sortedRank,
  }
}
