/**
 * 记录内容评分模块 v3
 * 基于运动内容和运动量进行评分
 */

export interface CheckinContent {
  /** 照片云存储路径列表 */
  photos?: string[]
  /** 文字内容 */
  text?: string
  /** 是否发布成长墙 */
  isPublishToMoments: boolean
}

/** 运动类型定义 */
export interface SportActivity {
  /** 运动类型 */
  type: SportType
  /** 运动量数值 */
  amount: number
  /** 运动量单位 */
  unit: SportUnit
  /** 时长（分钟） */
  duration?: number
  /** 其他补充说明 */
  note?: string
}

/** 运动类型枚举 */
export type SportType =
  | 'running'     // 跑步
  | 'walking'     // 走路/步行
  | 'cycling'     // 骑行
  | 'swimming'    // 游泳
  | 'workout'     // 健身/力量训练
  | 'yoga'        // 瑜伽
  | 'basketball'  // 篮球
  | 'football'    // 足球
  | 'tennis'      // 网球
  | 'badminton'   // 羽毛球
  | 'pingpong'    // 乒乓球
  | 'dance'       // 舞蹈
  | 'hiking'      // 徒步
  | 'climbing'    // 攀岩
  | 'other'       // 其他运动

/** 运动量单位 */
export type SportUnit =
  | 'km'      // 公里
  | 'm'       // 米
  | 'minutes' // 分钟
  | 'times'   // 次
  | 'reps'    // 组/次
  | 'steps'   // 步数
  | 'kcal'    // 卡路里

/** 解析后的运动信息 */
export interface ParsedSportInfo {
  /** 识别到的运动列表 */
  activities: SportActivity[]
  /** 运动总结描述 */
  summary: string
  /** 是否识别到有效运动 */
  isValid: boolean
}

/** 评分结果 */
export interface ScoreResult {
  /** 总分 (0-100) */
  totalScore: number
  /** 运动完成度得分 (0-100) */
  activityScore: number
  /** 运动量得分 (0-100) */
  amountScore: number
  /** 内容完整度得分 (0-100) */
  completenessScore: number
  /** 成长墙发布奖励分 (0-100) */
  publishScore: number
  /** 评语/建议 */
  feedback: string
  /** 识别的运动类型 */
  sportTypes?: string[]
  /** 总运动量（统一转为分钟） */
  totalMinutes?: number
  /** 详细运动列表 */
  activities?: SportActivity[]
  /** 运动总结 */
  summary?: string
  /** 是否有效运动 */
  isValid?: boolean
}

/** 运动类型配置 */
export const SPORT_CONFIG: Record<SportType, {
  name: string
  baseScore: number
  /** 推荐运动量（分钟） */
  recommendedMinutes: number
  /** 每超标的加分上限 */
  maxBonus: number
}> = {
  running: { name: '跑步', baseScore: 85, recommendedMinutes: 30, maxBonus: 15 },
  walking: { name: '走路', baseScore: 70, recommendedMinutes: 60, maxBonus: 10 },
  cycling: { name: '骑行', baseScore: 80, recommendedMinutes: 45, maxBonus: 15 },
  swimming: { name: '游泳', baseScore: 90, recommendedMinutes: 40, maxBonus: 10 },
  workout: { name: '健身', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  yoga: { name: '瑜伽', baseScore: 80, recommendedMinutes: 30, maxBonus: 10 },
  basketball: { name: '篮球', baseScore: 85, recommendedMinutes: 40, maxBonus: 15 },
  football: { name: '足球', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  tennis: { name: '网球', baseScore: 80, recommendedMinutes: 40, maxBonus: 10 },
  badminton: { name: '羽毛球', baseScore: 75, recommendedMinutes: 40, maxBonus: 10 },
  pingpong: { name: '乒乓球', baseScore: 70, recommendedMinutes: 40, maxBonus: 10 },
  dance: { name: '舞蹈', baseScore: 80, recommendedMinutes: 30, maxBonus: 15 },
  hiking: { name: '徒步', baseScore: 75, recommendedMinutes: 120, maxBonus: 15 },
  climbing: { name: '攀岩', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  other: { name: '其他', baseScore: 60, recommendedMinutes: 30, maxBonus: 10 }
}

/**
 * 将不同运动量转换为统一分钟数
 */
export function convertToMinutes(activity: SportActivity): number {
  const { type, amount, unit, duration } = activity

  // 如果有明确时长，直接使用
  if (duration) return duration

  // 根据单位转换
  switch (unit) {
    case 'minutes':
      return amount
    case 'km':
    case 'm':
      // 跑步/走路：根据距离估算时间
      // 假设平均配速：跑步6min/km, 走路12min/km
      const distanceKm = unit === 'm' ? amount / 1000 : amount
      return type === 'running'
        ? Math.round(distanceKm * 6)
        : Math.round(distanceKm * 12)
    case 'steps':
      // 步数估算：10000步 ≈ 60分钟
      return Math.round(amount / 10000 * 60)
    case 'kcal':
      // 卡路里估算：平均每分钟消耗5-10kcal，取7
      return Math.round(amount / 7)
    case 'times':
    case 'reps':
      // 次数/组：每组约3-5分钟
      return Math.round(amount * 4)
    default:
      return amount || 0
  }
}

/**
 * 计算运动完成度得分
 * 基于是否完成了推荐的运动量
 */
export function calculateActivityScore(activities: SportActivity[]): number {
  if (!activities || activities.length === 0) {
    return 0
  }

  // 计算总运动量（分钟）
  let totalMinutes = 0
  const sportTypes: string[] = []

  for (const activity of activities) {
    const minutes = convertToMinutes(activity)
    totalMinutes += minutes
    sportTypes.push((SPORT_CONFIG[activity.type] && SPORT_CONFIG[activity.type].name) || activity.type)
  }

  // 计算完成度得分
  // 以30分钟为基准线，完成30分钟得80分，每增加10分钟多加5分，上限100
  let score = 0
  if (totalMinutes < 15) {
    // 运动量太少
    score = Math.round(totalMinutes / 15 * 40)
  } else if (totalMinutes < 30) {
    score = 40 + Math.round((totalMinutes - 15) / 15 * 40)
  } else {
    score = Math.min(100, 80 + Math.round((totalMinutes - 30) / 10) * 5)
  }

  return score
}

/**
 * 计算运动量得分
 * 根据不同运动类型的推荐量进行评估
 */
export function calculateAmountScore(activities: SportActivity[]): number {
  if (!activities || activities.length === 0) {
    return 0
  }

  let totalScore = 0

  for (const activity of activities) {
    const config = SPORT_CONFIG[activity.type]
    if (!config) continue

    const actualMinutes = convertToMinutes(activity)
    const recommended = config.recommendedMinutes

    // 与推荐量比较
    const ratio = actualMinutes / recommended

    let score: number
    if (ratio < 0.5) {
      // 完成不到50%，按比例得分
      score = ratio * config.baseScore
    } else if (ratio >= 1) {
      // 完成推荐量，给予基础分+奖励
      const bonus = Math.min(config.maxBonus, Math.round((ratio - 1) * 10))
      score = config.baseScore + bonus
    } else {
      // 50%-100%之间，线性得分
      score = config.baseScore * ratio
    }

    totalScore += score
  }

  // 取平均分
  return Math.round(totalScore / activities.length)
}

/**
 * 计算内容完整度得分
 * 评估打卡内容的完整程度
 */
export function calculateCompletenessScore(content: CheckinContent): number {
  let score = 0

  // 有文字说明 +30分
  if (content.text && content.text.trim().length > 0) {
    score += 30
  }

  // 文字超过20字额外 +10分
  if (content.text && content.text.trim().length >= 20) {
    score += 10
  }

  // 有照片 +40分
  if (content.photos && content.photos.length > 0) {
    score += 40
  }

  // 照片2张以上额外 +10分
  if (content.photos && content.photos.length >= 2) {
    score += 10
  }

  // 有成长墙发布 +10分
  if (content.isPublishToMoments) {
    score += 10
  }

  return Math.min(100, score)
}

/**
 * 成长墙发布奖励
 */
export function calculatePublishScore(isPublishToMoments: boolean): number {
  return isPublishToMoments ? 100 : 0
}

/**
 * 生成评语
 */
function generateFeedback(
  activities: SportActivity[],
  activityScore: number,
  amountScore: number,
  completenessScore: number,
  content: CheckinContent
): string {
  const feedbacks: string[] = []

  // 运动相关评语
  if (!activities || activities.length === 0) {
    feedbacks.push('未识别到运动内容')
  } else {
    const sportNames = activities.map(a => (SPORT_CONFIG[a.type] && SPORT_CONFIG[a.type].name) || a.type)
    const uniqueSports = [...new Set(sportNames)]

    if (activityScore >= 80) {
      feedbacks.push(`很棒！完成了${uniqueSports.join('、')}运动`)
    } else if (activityScore >= 60) {
      feedbacks.push(`不错，${uniqueSports.join('、')}运动完成了`)
    } else if (activityScore >= 40) {
      feedbacks.push(`${uniqueSports.join('、')}运动有进步空间哦`)
    } else {
      feedbacks.push('运动量有点少，建议增加时长或强度')
    }

    // 针对具体运动量的评语
    const totalMinutes = activities.reduce((sum, a) => sum + convertToMinutes(a), 0)
    if (totalMinutes >= 60) {
      feedbacks.push('运动量很充足！')
    } else if (totalMinutes < 20) {
      feedbacks.push('可以尝试延长运动时间')
    }
  }

  // 内容完整度评语
  if (completenessScore >= 80) {
    feedbacks.push('打卡内容很完整')
  } else if (completenessScore < 50) {
    if (!content.photos || content.photos.length === 0) {
      feedbacks.push('建议添加运动照片')
    }
    if (!content.text || content.text.trim().length < 10) {
      feedbacks.push('可以配上运动心得')
    }
  }

  // 成长墙评语
  if (content.isPublishToMoments) {
    feedbacks.push('分享到成长墙正能量满满')
  }

  if (feedbacks.length === 0) {
    return '继续保持运动习惯！'
  }

  return feedbacks.join('，').replace('。。', '。') + '！'
}

/**
 * 计算综合评分（无大模型，纯本地计算）
 * 需要传入已解析的运动信息
 */
export function calculateScore(
  content: CheckinContent,
  parsedInfo: ParsedSportInfo
): ScoreResult {
  const activities = parsedInfo.activities
  const activityScore = calculateActivityScore(activities)
  const amountScore = calculateAmountScore(activities)
  const completenessScore = calculateCompletenessScore(content)
  const publishScore = calculatePublishScore(content.isPublishToMoments)

  // 权重分配
  const weights = {
    activity: 0.4,    // 运动完成度 40%
    amount: 0.3,      // 运动量 30%
    completeness: 0.2, // 内容完整度 20%
    publish: 0.1      // 成长墙发布 10%
  }

  const totalScore = Math.min(100, Math.round(
    activityScore * weights.activity +
    amountScore * weights.amount +
    completenessScore * weights.completeness +
    publishScore * weights.publish
  ))

  const feedback = generateFeedback(
    activities,
    activityScore,
    amountScore,
    completenessScore,
    content
  )

  const sportTypes = activities.map(a => (SPORT_CONFIG[a.type] && SPORT_CONFIG[a.type].name) || a.type)
  const totalMinutes = activities.reduce((sum, a) => sum + convertToMinutes(a), 0)

  return {
    totalScore,
    activityScore,
    amountScore,
    completenessScore,
    publishScore,
    feedback,
    sportTypes: [...new Set(sportTypes)],
    totalMinutes,
    activities,
    summary: parsedInfo.summary,
    isValid: parsedInfo.isValid
  }
}

/**
 * 快速评分（不依赖解析结果）
 * 根据内容特征估算分数
 */
export function estimateScore(content: CheckinContent): ScoreResult {
  // 模拟一个基本的运动信息
  const hasContent = content.text || (content.photos && content.photos.length > 0)

  const estimatedActivities: SportActivity[] = hasContent ? [
    { type: 'other', amount: 30, unit: 'minutes', note: '估计运动' }
  ] : []

  return calculateScore(content, {
    activities: estimatedActivities,
    summary: hasContent ? '检测到运动打卡' : '无运动内容',
    isValid: hasContent
  })
}

/**
 * 调用云函数进行评分（对接大模型）
 */
export async function callScoreCheckin(
  text?: string,
  photos?: string[],
  isPublishToMoments: boolean = true,
  groupId?: string
): Promise<ScoreResult | null> {
  try {
    const scoreRes = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'score',
        text,
        photos,
        isPublishToMoments,
        groupId,
        useLLM: true
      }
    })

    if (scoreRes.result && scoreRes.result.success) {
      return scoreRes.result.data as ScoreResult
    }
    return null
  } catch (e) {
    console.warn('评分调用失败', e)
    return null
  }
}

/**
 * 评分结果扩展（包含更多统计信息）
 */
export interface ScoreResultEnhanced extends ScoreResult {
  /** 连续打卡天数 */
  streakDays?: number
  /** 奖励分 */
  bonusScore?: number
  /** 识别方式 */
  analysisMethod?: 'local' | 'llm' | 'none'
  /** 新解锁成就 */
  newAchievements?: Achievement[]
}

/**
 * 成就信息
 */
export interface Achievement {
  id: string
  name: string
  desc: string
  icon: string
  type: string
  unlockedAt?: string
}

/**
 * 用户目标
 */
export interface UserGoal {
  weeklyMinutes: number
  weeklyDays: number
  dailyMinutes: number
}

/**
 * 目标进度
 */
export interface GoalProgress {
  weeklyMinutes: number
  weeklyDays: number
  dailyMinutes: number
  weeklyProgress: number
  dailyProgress: number
  daysProgress: number
  overallProgress: number
  isGoalAchieved: boolean
}

/**
 * 设置用户运动目标
 */
export async function callSetGoal(
  groupId: string,
  goal: Partial<UserGoal>
): Promise<{ success: boolean; goal?: UserGoal; progress?: GoalProgress }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'setGoal',
        groupId,
        ...goal
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        goal: res.result.data.goal,
        progress: res.result.data.progress
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('设置目标失败', e)
    return { success: false }
  }
}

/**
 * 获取用户运动目标
 */
export async function callGetGoal(groupId: string): Promise<{ success: boolean; goal?: UserGoal; progress?: GoalProgress }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'getGoal',
        groupId
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        goal: res.result.data.goal,
        progress: res.result.data.progress
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('获取目标失败', e)
    return { success: false }
  }
}

/**
 * 用户统计数据
 */
export interface UserStats {
  period: string
  totalCheckins: number
  totalMinutes: number
  totalScore: number
  avgScore: number
  sports: { name: string; count: number }[]
  days: number
  streak: number
  bestStreak: number
}

/**
 * 获取用户统计报告
 */
export async function callGetStats(groupId: string, period: 'week' | 'month' | 'year' = 'week'): Promise<{ success: boolean; stats?: UserStats }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'getStats',
        groupId,
        period
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        stats: res.result.data
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('获取统计失败', e)
    return { success: false }
  }
}

/**
 * 用户成就
 */
export interface UserAchievement {
  achievementId: string
  type: string
  name: string
  desc: string
  icon: string
  unlockedAt: string
}

/**
 * 成就结果
 */
export interface AchievementsResult {
  unlocked: UserAchievement[]
  total: number
  unlockedCount: number
  progress: number
}

/**
 * 获取用户成就列表
 */
export async function callGetAchievements(groupId: string): Promise<{ success: boolean; achievements?: AchievementsResult }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'getAchievements',
        groupId
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        achievements: res.result.data
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('获取成就失败', e)
    return { success: false }
  }
}

/**
 * 群组成员统计数据
 */
export interface GroupMemberStats {
  userId: string
  nickName: string
  avatarUrl: string
  totalMinutes: number
  checkinDays: number
  avgScore: number
  rank: number
}

/**
 * 群组统计数据
 */
export interface GroupStats {
  period: string
  memberCount: number
  groupAvg: {
    totalMinutes: number
    checkinDays: number
    avgScore: number
  }
  leaderboard: {
    byMinutes: GroupMemberStats[]
    byDays: GroupMemberStats[]
    byScore: GroupMemberStats[]
  }
}

/**
 * 我的排名信息
 */
export interface MyRankInfo {
  minutes: GroupMemberStats
  days: GroupMemberStats
  score: GroupMemberStats
}

/**
 * 排名结果
 */
export interface RankResult {
  period: string
  myRank: MyRankInfo
  groupAvg: {
    totalMinutes: number
    checkinDays: number
    avgScore: number
  }
  percentiles: {
    minutes: number
    days: number
    score: number
  }
  totalMembers: number
}

/**
 * 获取群组统计
 */
export async function callGetGroupStats(groupId: string, period: 'all' | 'day' | 'week' | 'month' = 'week'): Promise<{ success: boolean; stats?: GroupStats }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'getGroupStats',
        groupId,
        period
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        stats: res.result.data
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('获取群组统计失败', e)
    return { success: false }
  }
}

/**
 * 获取我的排名
 */
export async function callGetMyRank(groupId: string, period: 'all' | 'day' | 'week' | 'month' = 'week'): Promise<{ success: boolean; rank?: RankResult }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: {
        action: 'getMyRank',
        groupId,
        period
      }
    })

    if (res.result && res.result.success) {
      return {
        success: true,
        rank: res.result.data
      }
    }
    return { success: false }
  } catch (e) {
    console.warn('获取我的排名失败', e)
    return { success: false }
  }
}
