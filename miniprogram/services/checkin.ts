/**
 * 记录服务
 */
import { db, checkinsCol, makeupQuotaCol, momentsCol, momentCommentsCol, getTodayStr, getCurrentMonth, getServerMonth } from './db'

export interface Checkin {
  _id: string
  userId: string
  groupId?: string
  date: string
  isMakeup: boolean
  createTime: Date
  /** 记录内容 */
  content?: CheckinContent
  /** 评分结果 */
  score?: ScoreResult
}

/** 记录内容 */
export interface CheckinContent {
  /** 照片云存储路径列表 */
  photos?: string[]
  /** 文字内容 */
  text?: string
  /** 是否发布成长墙 */
  isPublishToMoments: boolean
  /** 记录大类ID */
  categoryId?: string
  /** 记录小类ID */
  subCategoryId?: string
  /** 成长墙可见范围：'' 或空表示所有群组可见，指定 groupId 表示仅指定群组可见 */
  momentsGroupId?: string
  /** 时长数值 */
  duration?: number
  /** 时长单位：分钟/小时 */
  durationUnit?: string
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
  /** 成长墙发布奖励分 (0-100) */
  publishScore: number
  /** 评语/建议 */
  feedback: string
  /** 内容标签 */
  tags?: string[]
}

/** 获取用户今日记录（含内容） */
export async function getTodayCheckin(userId: string): Promise<Checkin | null> {
  const today = getTodayStr()
  const { data } = await checkinsCol()
    .where({ userId, date: today })
    .orderBy('createTime', 'desc')
    .limit(1)
    .get()
  return (data && data[0] ? (data[0] as Checkin) : null)
}

/** 每日记录（支持同一天多次记录，每次记录都会创建新记录） */
export async function doCheckinWithContent(
  userId: string,
  content?: CheckinContent,
  groupId?: string
): Promise<{ ok: boolean; msg?: string; score?: ScoreResult }> {
  const today = getTodayStr()

  // 支持多次记录，不再检查是否已记录
  // 每次记录都会创建新记录

  // 如果有内容，先调用评分云函数
  let score: ScoreResult | undefined
  if (content && (content.text || (content.photos && content.photos.length > 0) || (content.duration && content.duration > 0))) {
    try {
      const scoreRes = await wx.cloud.callFunction({
        name: 'scoreCheckin',
        data: {
          text: content.text,
          photos: content.photos,
          isPublishToMoments: content.isPublishToMoments,
          categoryId: content.categoryId,
          subCategoryId: content.subCategoryId,
          duration: content.duration,
          durationUnit: content.durationUnit
        }
      })
      if (scoreRes.result && scoreRes.result.success) {
        score = scoreRes.result.data
      }
    } catch (e) {
      console.warn('评分失败，使用默认分', e)
    }
  }

  const now = new Date()
  const momentsGroupId = (content && content.momentsGroupId) || ''
  const { _id: checkinId } = await checkinsCol().add({
    data: {
      userId,
      groupId,
      date: today,
      isMakeup: false,
      createTime: now,
      content: content || null,
      score: score ? {
        ...score,
        totalMinutes: score.totalMinutes || 0,
        aiFeedback: score.feedback || ''
      } : null
    }
  })

  // 如果需要发布到成长墙，自动发布
  // momentsGroupId 表示成长墙可见范围：'' 表示所有群组可见，指定 groupId 表示仅指定群组可见
  if (content && content.isPublishToMoments && (content.text || (content.photos && content.photos.length > 0) || (content.duration && content.duration > 0))) {
    // 使用 momentsGroupId，如果未指定则为空字符串（表示全局可见）
    const momentsGroupId = content.momentsGroupId || ''
    try {
      const momentsRes = await momentsCol().add({
        data: {
          userId,
          groupId: momentsGroupId, // 可能是空字符串（全局可见）或指定群组（仅该群组可见）
          checkinId,
          content: {
            photos: content.photos || [],
            text: content.text || '',
            categoryId: content.categoryId || '',
            subCategoryId: content.subCategoryId || '',
            duration: content.duration || 0,
            durationUnit: content.durationUnit || '',
            score: (score && score.totalScore),
            totalMinutes: (score && score.totalMinutes) || 0,
            aiFeedback: (score && score.feedback) || '',
            tags: (score && score.tags) || []
          },
          likeCount: 0,
          commentCount: 0,
          createTime: now
        }
      })

      // 如果有AI点评，自动添加为第一条评论
      if (score && score.feedback) {
        try {
          const momentId = momentsRes._id
          await momentCommentsCol().add({
            data: {
              momentId,
              userId,
              content: score.feedback,
              isAIFeedback: true,
              createTime: now
            }
          })
          // 更新评论数
          await momentsCol().doc(momentId).update({
            data: { commentCount: 1 }
          })
        } catch (e) {
          console.warn('添加AI评论失败', e)
        }
      }
    } catch (e) {
      console.warn('发布成长墙失败', e)
    }
  }

  return { ok: true, score }
}

/** 更新今日记录内容（可同步更新/创建/删除成长墙动态） */
export async function updateTodayCheckinWithContent(
  userId: string,
  content: CheckinContent,
  groupId?: string
): Promise<{ ok: boolean; msg?: string; score?: ScoreResult }> {
  const existing = await getTodayCheckin(userId)
  if (!existing || !existing._id) return { ok: false, msg: '今日还未记录，无法更新' }

  if (!content || (!content.text && (!content.photos || content.photos.length === 0))) {
    return { ok: false, msg: '请输入文字或上传照片' }
  }

  // 重新评分（与新增记录保持一致）
  let score: ScoreResult | undefined
  try {
    const scoreRes = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        text: content.text,
        photos: content.photos,
        isPublishToMoments: content.isPublishToMoments
      }
    })
    if (scoreRes.result && scoreRes.result.success) score = scoreRes.result.data
  } catch (e) {
    console.warn('评分失败，使用默认分', e)
  }

  const now = new Date()
  await checkinsCol().doc(existing._id).update({
    data: {
      groupId,
      content,
      score: score || null,
      updateTime: now
    } as any
  })

  // 同步成长墙：按 checkinId 关联
  try {
    const { data: momentList } = await momentsCol()
      .where({ checkinId: existing._id, userId })
      .limit(1)
      .get()
    const moment = momentList && momentList[0]

    const hasContent = !!(content.text || (content.photos && content.photos.length > 0))
    const shouldPublish = !!content.isPublishToMoments && hasContent

    if (shouldPublish) {
      const momentContent = {
        photos: content.photos || [],
        text: content.text || '',
        categoryId: content.categoryId || '',
        subCategoryId: content.subCategoryId || '',
        score: (score && score.totalScore),
        tags: (score && score.tags) || []
      }
      // 使用 momentsGroupId，如果未指定则为空字符串（表示全局可见）
      const momentsGroupId = content.momentsGroupId || ''

      if (moment && moment._id) {
        await momentsCol().doc((moment as any)._id).update({
          data: {
            groupId: momentsGroupId, // 可能是空字符串（全局可见）或指定群组
            content: momentContent,
            updateTime: now
          } as any
        })
      } else {
        await momentsCol().add({
          data: {
            userId,
            groupId: '', // 空字符串表示全局动态
            checkinId: existing._id,
            content: momentContent,
            likeCount: 0,
            commentCount: 0,
            createTime: now
          }
        })
      }
    } else if (moment && moment._id) {
      // 用户取消发布：删除对应成长墙动态
      await momentsCol().doc((moment as any)._id).remove()
    }
  } catch (e) {
    console.warn('同步成长墙失败', e)
  }

  return { ok: true, score }
}

/** 补卡：仅可补今天往前 3 天（不含今天），每月 2 次（与群组无关） */
export async function doMakeup(
  userId: string,
  date: string
): Promise<{ ok: boolean; msg?: string }> {
  const today = getTodayStr()
  const d1 = new Date(today).getTime()
  const d2 = new Date(date).getTime()
  const diffDays = Math.floor((d1 - d2) / 86400000)
  if (diffDays < 1 || diffDays > 3) return { ok: false, msg: '仅可补近3天内未记录日期' }

  const { data: existing } = await checkinsCol()
    // 补卡与群组无关：同一用户同一天只能补一次
    .where({ userId, date })
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
    data: { userId, date, isMakeup: true, createTime: now }
  })
  return { ok: true }
}

/** 获取某月打卡记录（与群组无关，按用户查询） */
export async function getCheckinsByMonth(
  userId: string,
  _groupId: string, // 保留参数兼容性，但实际不使用
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
    .where({ userId, date: today })
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
    .where({ userId })
    .orderBy('date', 'desc')
    .limit(limit)
    .get()
  return (data || []) as Checkin[]
}

/** 获取打卡记录详情（含小组名称） */
export async function getCheckinRecordsWithGroup(
  userId: string,
  limit = 50
): Promise<(Checkin & { groupName?: string })[]> {
  const { data } = await checkinsCol()
    .where({ userId })
    .orderBy('date', 'desc')
    .limit(limit)
    .get()

  const records = (data || []) as Checkin[]
  const groupIds = Array.from(new Set(records.map(r => r.groupId).filter(Boolean))) as string[]

  // 批量取 group 名称（in 条件有数量限制，做分批）
  const db2 = wx.cloud.database()
  const _ = db2.command
  const groupNameMap = new Map<string, string>()
  const batchSize = 10
  for (let i = 0; i < groupIds.length; i += batchSize) {
    const batch = groupIds.slice(i, i + batchSize)
    const { data: gs } = await db2.collection('groups').where({ _id: _.in(batch) }).get()
    for (const g of (gs || []) as any[]) {
      groupNameMap.set(g._id, g.name || '')
    }
  }

  return records.map(item => ({
    ...item,
    groupName: item.groupId ? (groupNameMap.get(item.groupId) || '') : ''
  }))
}
