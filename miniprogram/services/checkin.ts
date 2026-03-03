/**
 * 打卡服务
 */
import { db, checkinsCol, makeupQuotaCol, momentsCol, getTodayStr, getCurrentMonth, getServerMonth } from './db'

export interface Checkin {
  _id: string
  userId: string
  groupId: string
  date: string
  isMakeup: boolean
  createTime: Date
  /** 打卡内容 */
  content?: CheckinContent
  /** 评分结果 */
  score?: ScoreResult
}

/** 打卡内容 */
export interface CheckinContent {
  /** 照片云存储路径列表 */
  photos?: string[]
  /** 文字内容 */
  text?: string
  /** 是否发布朋友圈 */
  isPublishToMoments: boolean
  /** 运动类型 */
  sportType?: string
}

/** 评分结果 */
export interface ScoreResult {
  /** 总分 (0-100) */
  totalScore: number
  /** 照片得分 (0-100) */
  photoScore: number
  /** 文字得分 (0-100) */
  textScore: number
  /** 内容质量分 (0-100) */
  contentScore: number
  /** 朋友圈发布奖励分 (0-100) */
  publishScore: number
  /** 评语/建议 */
  feedback: string
  /** 内容标签 */
  tags?: string[]
}

/** 每日打卡（支持内容） */
export async function doCheckinWithContent(
  userId: string,
  groupId: string,
  content?: CheckinContent
): Promise<{ ok: boolean; msg?: string; score?: ScoreResult }> {
  const today = getTodayStr()
  const { data: existing } = await checkinsCol()
    .where({ userId, groupId, date: today })
    .get()
  if (existing.length > 0) return { ok: false, msg: '今日已打卡，无需重复操作' }

  // 如果有内容，先调用评分云函数
  let score: ScoreResult | undefined
  if (content && (content.text || (content.photos && content.photos.length > 0))) {
    try {
      const scoreRes = await wx.cloud.callFunction({
        name: 'scoreCheckin',
        data: {
          text: content.text,
          photos: content.photos,
          isPublishToMoments: content.isPublishToMoments
        }
      })
      if (scoreRes.result?.success) {
        score = scoreRes.result.data
      }
    } catch (e) {
      console.warn('评分失败，使用默认分', e)
    }
  }

  const now = new Date()
  const { _id: checkinId } = await checkinsCol().add({
    data: { 
      userId, 
      groupId, 
      date: today, 
      isMakeup: false, 
      createTime: now,
      content: content || null,
      score: score || null
    }
  })

  // 如果需要发布到朋友圈，自动发布
  if (content?.isPublishToMoments && (content.text || (content.photos && content.photos.length > 0))) {
    try {
      await momentsCol().add({
        data: {
          userId,
          groupId,
          checkinId,
          content: {
            photos: content.photos || [],
            text: content.text || '',
            sportType: content.sportType || '',
            score: score?.totalScore,
            tags: score?.tags || []
          },
          likeCount: 0,
          commentCount: 0,
          createTime: now
        }
      })
    } catch (e) {
      console.warn('发布朋友圈失败', e)
    }
  }

  return { ok: true, score }
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

  // 使用服务器时间获取当前月份，避免客户端时间被篡改
  const month = await getServerMonth()
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
  const month = await getServerMonth()
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

/** 获取打卡记录详情（含小组名称） */
export async function getCheckinRecordsWithGroup(
  userId: string,
  groupId: string,
  limit = 50
): Promise<(Checkin & { groupName?: string })[]> {
  const { data: groupsData } = await wx.cloud.database().collection('groups').doc(groupId).get()
  const groupName = groupsData?.name || ''

  const { data } = await checkinsCol()
    .where({ userId, groupId })
    .orderBy('date', 'desc')
    .limit(limit)
    .get()

  return ((data || []) as Checkin[]).map(item => ({
    ...item,
    groupName
  }))
}
