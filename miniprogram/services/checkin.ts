/**
 * 记录服务
 */
import { db, checkinsCol, makeupQuotaCol, momentsCol, momentCommentsCol, getTodayStr, getCurrentMonth, getServerMonth } from './db'
import { syncGoalProgressAfterCheckin } from './goal'
import { syncTaskAndAchievementsAfterCheckin } from './task'
import { computeCheckinScore } from './scoreLocal'

export interface Checkin {
  _id: string
  openid: string
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
  /** 自定义朋友圈评论（可选，不填时使用默认评语） */
  momentsComment?: string
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
  /** 总时长（分钟），本地评分时使用 */
  totalMinutes?: number
}

/** 按用户查询打卡表（统一使用 _openid） */
function checkinUserWhere(openid: string, dateCond: any) {
  return { _openid: openid, ...dateCond }
}

/** 获取用户今日记录（含内容） */
export async function getTodayCheckin(openid: string): Promise<Checkin | null> {
  const today = getTodayStr()
  const { data } = await checkinsCol()
    .where(checkinUserWhere(openid, { date: today }) as any)
    .orderBy('createTime', 'desc')
    .limit(1)
    .get()
  return (data && data[0] ? (data[0] as Checkin) : null)
}

/** 每日记录（支持同一天多次记录，每次记录都会创建新记录） */
export async function doCheckinWithContent(
  openid: string,
  content?: CheckinContent,
  groupId?: string
): Promise<{ ok: boolean; msg?: string; score?: ScoreResult; streak?: number }> {
  const today = getTodayStr()

  // 提交打卡必须填运动类型和时长（时长大于 0）
  if (content) {
    if (!content.categoryId || !content.subCategoryId) {
      return { ok: false, msg: '请选择运动类型' }
    }
    const duration = content.duration != null ? content.duration : 0
    if (!duration || duration <= 0) {
      return { ok: false, msg: '请填写时长（大于 0）' }
    }
  }

  // 支持多次记录，不再检查是否已记录
  // 每次记录都会创建新记录

  // 评分与评语完全在本地计算，不调用云函数、不走 AI
  let score: ScoreResult | undefined
  if (content && (content.text || (content.photos && content.photos.length > 0) || (content.duration && content.duration > 0))) {
    const local = computeCheckinScore(content, { streakDays: 0, vipLevel: 0 })
    score = {
      totalScore: local.totalScore,
      photoScore: 0,
      textScore: 0,
      contentScore: local.completenessScore,
      publishScore: local.bonusScore,
      feedback: local.feedback,
      tags: [],
      totalMinutes: local.totalMinutes
    }
  }

  const now = new Date()
  const momentsGroupId = (content && content.momentsGroupId) || ''
  const hasContent = !!(content && (content.text || (content.photos && content.photos.length > 0) || (content.duration && content.duration > 0)))
  const isPublishToMoments = !!(content && content.isPublishToMoments && hasContent)

  const tAdd0 = Date.now()
  const { _id: checkinId } = await checkinsCol().add({
    data: {
      openid,
      groupId,
      date: today,
      isMakeup: false,
      isPublishToMoments,
      createTime: now,
      content: content || null,
      score: score ? {
        ...score,
        totalMinutes: score.totalMinutes || 0,
        aiFeedback: score.feedback || ''
      } : null
    }
  })
  console.log('[checkin.service] checkinsCol.add 耗时 ms=', Date.now() - tAdd0)

  // 打卡成功后同步更新四类统计（当前连胜、最佳连胜、有记录天数、摸鱼天数），便于首页/统计直读；并带回 streak 供恭喜页使用，避免再请求 getStreak
  let streakFromSync: number | undefined
  try {
    const tSync0 = Date.now()
    const syncRes = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'syncCheckinStats' }
    }) as any
    console.log('[checkin.service] syncCheckinStats 耗时 ms=', Date.now() - tSync0)
    if (syncRes.result && syncRes.result.success && syncRes.result.streak != null) {
      streakFromSync = syncRes.result.streak
      // 邀请用户连续打卡 7 天/27 天时给邀请人发放里程碑积分（一级 +10，二级 +3）
      if (streakFromSync === 7 || streakFromSync === 27) {
        try {
          await wx.cloud.callFunction({
            name: 'referral',
            data: { action: 'awardStreakMilestone', inviteeOpenid: openid, streak: streakFromSync }
          })
        } catch (e) {
          console.warn('邀请里程碑积分发放失败，不影响打卡成功', e)
        }
      }
    }
  } catch (e) {
    console.warn('同步打卡统计失败，不影响打卡成功', e)
  }

  // 打卡成功后同步日常任务进度并解锁成就（任务中心「日常任务」「成就徽章」）
  try {
    const tTask0 = Date.now()
    await syncTaskAndAchievementsAfterCheckin(openid, {
      hasPhoto: !!(content && content.photos && content.photos.length > 0)
    })
    console.log('[checkin.service] syncTaskAndAchievementsAfterCheckin 耗时 ms=', Date.now() - tTask0)
  } catch (e) {
    console.warn('同步任务与成就失败，不影响打卡成功', e)
  }

  // 打卡成功后同步更新自律计划进度
  if (content && content.categoryId) {
    try {
      const tGoal0 = Date.now()
      await syncGoalProgressAfterCheckin(openid, content.categoryId, content.subCategoryId)
      console.log('[checkin.service] syncGoalProgressAfterCheckin 耗时 ms=', Date.now() - tGoal0)
    } catch (e) {
      console.warn('同步自律计划进度失败', e)
    }
  }

  // 如果需要发布到成长墙，自动发布（isPublishToMoments 已写入 checkin 记录）
  // momentsGroupId 表示成长墙可见范围：'' 表示所有群组可见，指定 groupId 表示仅指定群组可见
  if (isPublishToMoments) {
    const tMoments0 = Date.now()
    // 使用 momentsGroupId，如果未指定则为空字符串（表示全局可见）
    const momentsGroupId = content.momentsGroupId || ''
    try {
      // 日批注：当日数据统计（不走 AI），用于总结当条动态的当日统计
      let dailyAnnotation = ''
      try {
        const countRes = await momentsCol().where({ _openid: openid, date: today }).count()
        const totalToday = (countRes.total || 0) + 1 // 本条为第 totalToday 条
        const parts = [`当日第${totalToday}条`, `共${totalToday}条`]
        if (content.duration && content.duration > 0) {
          parts.push(`${content.duration}分钟`)
        }
        if (score && score.totalScore != null) {
          parts.push(`评分${Math.round(score.totalScore)}`)
        }
        dailyAnnotation = parts.join(' · ')
      } catch (_) {
        dailyAnnotation = '当日动态'
      }

      const momentsRes = await momentsCol().add({
        data: {
          openid,
          groupId: momentsGroupId, // 可能是空字符串（全局可见）或指定群组（仅该群组可见）
          checkinId,
          date: today,
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
          dailyAnnotation,
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
              openid,
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
      console.log('[checkin.service] 发布成长墙 耗时 ms=', Date.now() - tMoments0)
    } catch (e) {
      console.warn('发布成长墙失败', e)
    }
  }

  return { ok: true, score, streak: streakFromSync }
}

/** 更新今日记录内容（可同步更新/创建/删除成长墙动态） */
export async function updateTodayCheckinWithContent(
  openid: string,
  content: CheckinContent,
  groupId?: string
): Promise<{ ok: boolean; msg?: string; score?: ScoreResult }> {
  const existing = await getTodayCheckin(openid)
  if (!existing || !existing._id) return { ok: false, msg: '今日还未记录，无法更新' }

  if (!content || (!content.text && (!content.photos || content.photos.length === 0))) {
    return { ok: false, msg: '请输入文字或上传照片' }
  }

  // 重新评分（与新增记录一致，本地计算不调云函数）
  let score: ScoreResult | undefined
  const local = computeCheckinScore(content, { streakDays: 0, vipLevel: 0 })
  score = {
    totalScore: local.totalScore,
    photoScore: 0,
    textScore: 0,
    contentScore: local.completenessScore,
    publishScore: local.bonusScore,
    feedback: local.feedback,
    tags: [],
    totalMinutes: local.totalMinutes
  }

  const now = new Date()
  const hasContent = !!(content.text || (content.photos && content.photos.length > 0))
  const isPublishToMoments = !!content.isPublishToMoments && hasContent

  await checkinsCol().doc(existing._id).update({
    data: {
      groupId,
      content,
      score: score || null,
      isPublishToMoments,
      updateTime: now
    } as any
  })

  // 同步成长墙：按 checkinId 关联
  try {
    const { data: momentList } = await momentsCol()
      .where({ checkinId: existing._id, _openid: openid })
      .limit(1)
      .get()
    const moment = momentList && momentList[0]

    if (isPublishToMoments) {
      const momentContent = {
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
      }
      // 使用 momentsGroupId，如果未指定则为空字符串（表示全局可见）
      const momentsGroupId = content.momentsGroupId || ''
      const momentDate = (existing as any).date || getTodayStr()

      if (moment && moment._id) {
        await momentsCol().doc((moment as any)._id).update({
          data: {
            groupId: momentsGroupId, // 可能是空字符串（全局可见）或指定群组
            content: momentContent,
            updateTime: now
          } as any
        })
      } else {
        // 日批注：当日数据统计（不走 AI）
        let dailyAnnotation = '当日动态'
        try {
          const countRes = await momentsCol().where({ _openid: openid, date: momentDate }).count()
          const totalToday = (countRes.total || 0) + 1
          const parts = [`当日第${totalToday}条`, `共${totalToday}条`]
          if (content.duration && content.duration > 0) parts.push(`${content.duration}分钟`)
          if (score && score.totalScore != null) parts.push(`评分${Math.round(score.totalScore)}`)
          dailyAnnotation = parts.join(' · ')
        } catch (_) {}
        await momentsCol().add({
          data: {
            openid,
            groupId: momentsGroupId || '',
            checkinId: existing._id,
            date: momentDate,
            content: momentContent,
            dailyAnnotation,
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

/** 补卡：仅可补今天往前 3 天（不含今天），每月有次数限制（含VIP加成） */
export async function doMakeup(
  openid: string,
  date: string
): Promise<{ ok: boolean; msg?: string }> {
  const today = getTodayStr()
  const d1 = new Date(today).getTime()
  const d2 = new Date(date).getTime()
  const diffDays = Math.floor((d1 - d2) / 86400000)
  if (diffDays < 1 || diffDays > 3) return { ok: false, msg: '仅可补近3天内未记录日期' }

  const { data: existing } = await checkinsCol()
    // 补卡与群组无关：同一用户同一天只能补一次
    .where(checkinUserWhere(openid, { date }) as any)
    .get()
  if (existing.length > 0) return { ok: false, msg: '该日期已打卡' }

  // 使用服务器时间获取当前月份，避免客户端时间被篡改
  const month = await getServerMonth()
  const { data: quotaList } = await makeupQuotaCol()
    .where({ _openid: openid, month })
    .get()
  const used = quotaList.length > 0 ? (quotaList[0] as any).usedCount : 0

  // 获取VIP加成后的补卡次数上限
  let maxQuota = 2
  try {
    const { getMakeupQuotaWithVip } = await import('./vip')
    maxQuota = await getMakeupQuotaWithVip(openid)
  } catch (e) {
    // 使用默认值
  }

  if (used >= maxQuota) {
    const vipBonus = maxQuota - 2
    if (vipBonus > 0) {
      return { ok: false, msg: `本月补卡次数已用尽（含VIP加成${vipBonus}次），下月可继续使用` }
    }
    return { ok: false, msg: '本月补卡次数已用尽，下月可继续使用' }
  }

  const now = new Date()
  if (quotaList.length > 0) {
    await makeupQuotaCol().doc((quotaList[0] as any)._id).update({
      data: { usedCount: used + 1, updateTime: now }
    })
  } else {
    await makeupQuotaCol().add({
      data: { openid, month, usedCount: 1, createTime: now, updateTime: now }
    })
  }

  await checkinsCol().add({
    data: { openid, date, isMakeup: true, isPublishToMoments: false, createTime: now }
  })

  try {
    await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'syncCheckinStats' }
    })
  } catch (e) {
    console.warn('同步补卡统计失败，不影响补卡成功', e)
  }
  return { ok: true }
}

const GET_PAGE_SIZE = 20 // 小程序端单次 get 最多 20 条，用游标分页拉取整月（避免 skip 导致 500）

/** 获取某月打卡记录（与群组无关，按用户查询）；游标分页以突破 20 条限制；失败时退回单页避免 500 导致页面白屏 */
export async function getCheckinsByMonth(
  openid: string,
  _groupId: string, // 保留参数兼容性，但实际不使用
  yearMonth: string
): Promise<Checkin[]> {
  const [y, m] = yearMonth.split('-').map(Number)
  const start = `${yearMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  const end = `${yearMonth}-${pad(lastDay)}`

  const _ = db.command
  const baseCond = _.and(
    _.or([{ openid }, { _openid: openid }]),
    { date: _.and(_.gte(start), _.lte(end)) }
  ) as any

  const all: Checkin[] = []
  let lastDate: string | null = null
  let lastId: string | null = null

  try {
    while (true) {
      const cursorCond =
        lastDate === null && lastId === null
          ? baseCond
          : (_.and(
              baseCond,
              _.or([
                { date: _.gt(lastDate!) },
                { date: lastDate!, _id: _.gt(lastId!) }
              ])
            ) as any)

      const { data } = await checkinsCol()
        .where(cursorCond)
        .orderBy('date', 'asc')
        .orderBy('_id', 'asc')
        .limit(GET_PAGE_SIZE)
        .get()
      const list = (data || []) as Checkin[]
      if (list.length === 0) break
      const last = list[list.length - 1]
      lastDate = last.date
      lastId = last._id
      all.push(...list)
      if (list.length < GET_PAGE_SIZE) break
    }
    return all
  } catch (e) {
    console.warn('getCheckinsByMonth paginated failed, fallback to first page', e)
    const { data } = await checkinsCol()
      .where(baseCond)
      .orderBy('date', 'asc')
      .limit(GET_PAGE_SIZE)
      .get()
    return (data || []) as Checkin[]
  }
}

/** 今日是否已打卡（不区分群组） */
export async function isCheckedToday(openid: string, _groupId?: string): Promise<boolean> {
  const today = getTodayStr()
  const { total } = await checkinsCol()
    .where(checkinUserWhere(openid, { date: today }) as any)
    .count()
  return total > 0
}

/** 获取今日剩余补卡次数（含VIP加成） */
export async function getMakeupRemain(openid: string): Promise<number> {
  const month = await getServerMonth()
  const { data } = await makeupQuotaCol().where({ _openid: openid, month }).get()
  const used = data.length > 0 ? (data[0] as any).usedCount : 0
  // 基础2次 + VIP加成
  const baseQuota = 2
  // 动态导入避免循环依赖
  try {
    const { getMakeupQuotaWithVip } = await import('./vip')
    const vipQuota = await getMakeupQuotaWithVip(openid)
    return Math.max(0, vipQuota - used)
  } catch (e) {
    return Math.max(0, baseQuota - used)
  }
}

/** 获取打卡记录列表 */
export async function getCheckinRecords(
  openid: string,
  groupId: string,
  limit = 50
): Promise<Checkin[]> {
  const { data } = await checkinsCol()
    .where({ _openid: openid })
    .orderBy('date', 'desc')
    .limit(limit)
    .get()
  return (data || []) as Checkin[]
}

/** 获取打卡记录详情（含组织名称） */
export async function getCheckinRecordsWithGroup(
  openid: string,
  limit = 50
): Promise<(Checkin & { groupName?: string })[]> {
  const { data } = await checkinsCol()
    .where({ _openid: openid })
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
