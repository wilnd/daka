/**
 * 数据统计服务：连胜、连续未记录、记录率
 * 优化：单次查询记录，本地计算，避免多次 DB 请求卡顿
 */
import { db, checkinsCol, checkinStatsCol, membersCol, usersCol, getTodayStr, getDateBefore } from './db'

/** 获取用户创建时间 */
async function getUserCreateTime(openid: string): Promise<Date | null> {
  const { data } = await usersCol()
    .where({ _openid: openid } as any)
    .limit(1)
    .get()
  if (data && data.length > 0) {
    return data[0].createTime || null
  }
  return null
}

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

/** 获取近 400 天的打卡记录（用于计算连胜/未打卡）
 * 注意：使用 _openid 字段查询（云开发自动填充） */
async function getRecentCheckins(
  openid: string
): Promise<{ date: string; isMakeup: boolean }[]> {
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const _ = db.command

  const allCheckins: { date: string; isMakeup: boolean }[] = []
  let skip = 0
  const batchSize = 100

  while (true) {
    // 使用 _openid 字段查询（云开发自动填充）
    const { data } = await checkinsCol()
      .where({
        _openid: openid,
        date: _.and(_.gte(start), _.lte(today)),
      })
      .orderBy('date', 'desc')
      .skip(skip)
      .limit(batchSize)
      .get()
    
    if (!data || data.length === 0) break
    allCheckins.push(...(data as { date: string; isMakeup: boolean }[]))
    
    if (data.length < batchSize) break
    skip += batchSize
  }
  
  return allCheckins
}

/**
 * 统一获取所有统计数据（从云函数一次获取）
 */
export interface AllStatsData {
  streak: number
  bestStreak: number
  missStreak: number
  totalDays: number
  totalCount: number
  totalMinutes: number
  avgScore: number
}

export async function getAllStats(openid: string): Promise<AllStatsData> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'getAllStats', period: 'all' }
    }) as any
    if (res.result && res.result.success) {
      const data = res.result.data
      return {
        streak: data.streak || 0,
        bestStreak: data.bestStreak || 0,
        missStreak: data.missStreak || 0,
        totalDays: data.totalDays || 0,
        totalCount: data.totalCheckins || 0,
        totalMinutes: data.totalMinutes || 0,
        avgScore: data.avgScore || 0
      }
    }
    return { streak: 0, bestStreak: 0, missStreak: 0, totalDays: 0, totalCount: 0, totalMinutes: 0, avgScore: 0 }
  } catch (e) {
    console.error('[getAllStats] error:', e)
    return { streak: 0, bestStreak: 0, missStreak: 0, totalDays: 0, totalCount: 0, totalMinutes: 0, avgScore: 0 }
  }
}

/** 计算连胜天数（不含补卡）
 * 逻辑：
 * - 昨天打卡了，今天还没打 → 显示昨天之前的连胜天数
 * - 昨天没打，今天打了 → 显示1
 * - 昨天今天都没打 → 显示0
 */
/** 获取连胜天数 - 直接从云函数获取（数据库统计，不受条数限制） */
export async function getStreak(openid: string): Promise<number> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'getAllStats', period: 'all' }
    }) as any
    if (res.result && res.result.success) {
      return (res.result.data && res.result.data.streak) || 0
    }
    return 0
  } catch (e) {
    console.error('[getStreak] error:', e)
    return 0
  }
}

/**
 * 从 checkinStats 表直接读取当前连胜天数（打卡/补卡后由云函数更新，数据权威）
 */
export async function getStreakFromCheckinStats(openid: string): Promise<number> {
  if (!openid) return 0
  try {
    const { data } = await checkinStatsCol()
      .where({ _openid: openid } as any)
      .limit(1)
      .get()
    const row = data && data[0] ? (data[0] as { current_streak?: number }) : null
    const streak = row && row.current_streak != null ? row.current_streak : 0
    return typeof streak === 'number' ? streak : 0
  } catch (e) {
    console.warn('[getStreakFromCheckinStats] error:', e)
    return 0
  }
}

/** 计算摸鱼天数（直接由云函数统计）
 * 逻辑：总自然日数（从用户创建账号到当前）- 有记录的天数
 */
export async function getMissStreak(
  openid: string
): Promise<number> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'getAllStats', period: 'all' }
    }) as any
    if (res.result && res.result.success) {
      return (res.result.data && res.result.data.missStreak) || 0
    }
    return 0
  } catch (e) {
    console.error('[getMissStreak] error:', e)
    return 0
  }
}

/** 判断昨天是否已打卡 */
export async function wasCheckedInYesterday(openid: string): Promise<boolean> {
  const yesterday = getDateBefore(getTodayStr(), 1)
  // 使用 _openid 字段查询
  const { data } = await checkinsCol()
    .where({ _openid: openid, date: yesterday })
    .limit(1)
    .get()
  return (data && data.length > 0) || false
}

/** 总打卡次数（所有记录，含同一天多次打卡） */
export async function getTotalCount(
  openid: string
): Promise<number> {
  // 使用 _openid 字段查询
  const { total } = await checkinsCol()
    .where({ _openid: openid })
    .count()
  return total
}

/** 总打卡天数（去重后的日期数，同一天多次打卡只算1天） */
export async function getTotalDays(
  openid: string
  ): Promise<number> {
  // 查询所有打卡记录，本地按日期去重
  const allDates: string[] = []
  let skip = 0
  const batchSize = 100

  while (true) {
    // 使用 _openid 字段查询
    const { data } = await checkinsCol()
      .where({ _openid: openid })
      .orderBy('date', 'desc')
      .skip(skip)
      .limit(batchSize)
      .get()

    if (!data || data.length === 0) break
    allDates.push(...data.map((c: any) => c.date))

    if (data.length < batchSize) break
    skip += batchSize
  }

  if (allDates.length === 0) return 0

  // 按日期去重
  const uniqueDates = new Set(allDates)
  return uniqueDates.size
}

/** 获取最佳连胜天数 - 直接从云函数获取 */
export async function getBestStreak(openid: string): Promise<number> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'getAllStats', period: 'all' }
    }) as any
    if (res.result && res.result.success) {
      return (res.result.data && res.result.data.bestStreak) || 0
    }
    return 0
  } catch (e) {
    console.error('[getBestStreak] error:', e)
    return 0
  }
}

/** 排行榜用户信息 */
export interface RankUser {
  openid: string
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

  // 获取成员 openid 列表
  const memberOpenids = (members as any[]).map(m => m.openid).filter(Boolean)

  // 获取所有成员最近400天的打卡记录
  const today = getTodayStr()
  const start = getDateBefore(today, 400)
  const checkins = await getCheckinsForUsersInRange(memberOpenids, start, today)

  // 获取用户信息（批量查询）
  const users = await getUsersInfo(memberOpenids)
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
      .where({ _openid: _.in(batch) } as any)
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

  // 获取成员 openid 列表
  const memberOpenids = members.map(m => m.openid).filter(Boolean)

  // 获取用户信息（批量查询）
  const users = await getUsersInfo(memberOpenids)
  const userInfoMap: Record<string, any> = {}
  for (const u of (users || [])) {
    userInfoMap[u.openid] = u
  }

  // 查询所有打卡记录，按日期去重
  const _ = db.command
  // 使用 _openid 字段查询
  const { data: allCheckins } = await checkinsCol()
    .where({ _openid: _.in(memberOpenids) })
    .get()

  // 按用户分组，统计累计打卡天数
  const userTotalDays: Record<string, number> = {}
  const userCheckinDates: Record<string, Set<string>> = {}

  for (const checkin of (allCheckins || [])) {
    const uid = checkin._openid || checkin.openid
    if (!uid) continue
    if (!userCheckinDates[uid]) {
      userCheckinDates[uid] = new Set()
    }
    userCheckinDates[uid].add(checkin.date)
  }

  // 统计每个用户的累计打卡天数
  for (const uid of memberOpenids) {
    userTotalDays[uid] = userCheckinDates[uid] ? userCheckinDates[uid].size : 0
  }

  // 构建结果并按累计天数排序
  const result: RankUser[] = members.map(m => ({
    openid: m.openid,
    nickName: (userInfoMap[m.openid] && userInfoMap[m.openid].nickName) || '未知',
    avatarUrl: (userInfoMap[m.openid] && userInfoMap[m.openid].avatarUrl) || '',
    streak: userTotalDays[m.openid] || 0,
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
      // 使用 _openid 字段查询
      const { data } = await checkinsCol()
        .where({
          _openid: _.in(batch),
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
  // 按用户分组打卡记录（云开发返回 _openid，无 openid 字段）
  const userCheckins: Record<string, Set<string>> = {}
  for (const c of checkins) {
    const uid = c._openid || c.openid
    if (!uid) continue
    if (!userCheckins[uid]) {
      userCheckins[uid] = new Set()
    }
    userCheckins[uid].add(c.date)
  }

  // 计算每个用户的连续打卡天数
  const userStreaks: Record<string, number> = {}
  const today = getTodayStr()
  const yesterday = getDateBefore(today, 1)
  for (const member of members) {
    const uid = member.openid
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
      openid: m.openid,
      nickName: (userInfoMap[m.openid] && userInfoMap[m.openid].nickName) || '未知',
      avatarUrl: (userInfoMap[m.openid] && userInfoMap[m.openid].avatarUrl) || '',
      streak: userStreaks[m.openid] || 0,
    }))
    return result.sort((a, b) => b.streak - a.streak)
  }

  // 三个榜单数据相同（都是按连胜天数排序），返回三份引用
  const sortedRank = buildRankList()
  return {
    dayRank: sortedRank,
    weekRank: sortedRank,
    monthRank: sortedRank,
  }
}
