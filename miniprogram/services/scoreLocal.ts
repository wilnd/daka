/**
 * 打卡评分本地计算（不调用 AI、不请求云函数）
 * 与云函数 scoreCheckin 的 useLLM: false 规则保持一致
 */

/** 权重配置（与云函数 DEFAULT_CONFIG.weights 一致） */
const WEIGHTS = {
  activity: 0.4,
  amount: 0.3,
  completeness: 0.2,
  bonus: 0.1
}

/** 默认运动配置（用于仅有时长、无活动列表时的运动量分） */
const DEFAULT_ACTIVITY_CONFIG = { recommendedMinutes: 30, baseScore: 30, maxBonus: 20 }

/** VIP 成长加成系数（与云函数一致） */
const VIP_GROWTH_BONUS_RATE = 0.2

export interface ScoreInputContent {
  text?: string
  photos?: string[]
  isPublishToMoments?: boolean
  categoryId?: string
  subCategoryId?: string
  duration?: number
  durationUnit?: string
  momentsComment?: string
}

export interface ScoreOutput {
  totalScore: number
  activityScore: number
  amountScore: number
  completenessScore: number
  bonusScore: number
  feedback: string
  totalMinutes: number
}

/** 运动完成度得分（仅基于时长） */
function calculateActivityScore(totalMinutes: number): number {
  if (totalMinutes <= 0) return 0
  if (totalMinutes < 15) return Math.round((totalMinutes / 15) * 40)
  if (totalMinutes < 30) return 40 + Math.round(((totalMinutes - 15) / 15) * 40)
  return Math.min(100, 80 + Math.round((totalMinutes - 30) / 10) * 5)
}

/** 运动量得分（无活动列表时按默认配置） */
function calculateAmountScore(totalMinutes: number): number {
  if (totalMinutes <= 0) return 0
  const { recommendedMinutes, baseScore, maxBonus } = DEFAULT_ACTIVITY_CONFIG
  const ratio = totalMinutes / recommendedMinutes
  let score: number
  if (ratio < 0.5) {
    score = ratio * baseScore
  } else if (ratio >= 1) {
    const bonus = Math.min(maxBonus, Math.round((ratio - 1) * 10))
    score = baseScore + bonus
  } else {
    score = baseScore * ratio
  }
  return Math.round(score)
}

/** 内容完整度得分 */
function calculateCompletenessScore(content: ScoreInputContent): number {
  if (!content) return 0
  let score = 0
  const text = (content.text || '').trim()
  if (text.length >= 50) score += 40
  else if (text.length >= 20) score += 25
  else if (text.length >= 10) score += 15
  else if (text.length > 0) score += 10

  const photos = content.photos || []
  if (photos.length >= 3) score += 40
  else if (photos.length >= 2) score += 30
  else if (photos.length >= 1) score += 20

  if (content.isPublishToMoments === true) score += 20
  return Math.min(100, score)
}

/** 额外奖励分 */
function calculateBonusScore(options: {
  isPublishToMoments?: boolean
  streakDays?: number
  checkinHour?: number
}): number {
  const { isPublishToMoments = false, streakDays = 0, checkinHour = new Date().getHours() } = options
  let bonus = 0
  if (streakDays >= 7) bonus += 10
  else if (streakDays >= 3) bonus += 5
  if (checkinHour >= 6 && checkinHour < 9) bonus += 5
  if (isPublishToMoments) bonus += 5
  return bonus
}

/** 生成评语（与云函数 generateFeedback 规则一致，无 AI） */
function generateFeedback(options: {
  content: ScoreInputContent
  activityScore: number
  amountScore: number
  completenessScore: number
  totalMinutes: number
  streakDays?: number
}): string {
  const { content, activityScore, completenessScore, totalMinutes = 0, streakDays = 0 } = options
  const categoryId = content.categoryId || ''
  const isStudy = categoryId === 'study'
  const isSports = categoryId === 'sports'
  const feedbacks: string[] = []

  // 无活动列表、仅有时长
  if (totalMinutes > 0) {
    if (isStudy) {
      if (totalMinutes >= 60) feedbacks.push('太棒了！学习超过1小时，专注力非常强！')
      else if (totalMinutes >= 45) feedbacks.push('学习45分钟以上，效率很高！')
      else if (totalMinutes >= 30) feedbacks.push('学习半小时，时长达标了！')
      else if (totalMinutes >= 20) feedbacks.push('学习20分钟以上，继续保持')
      else feedbacks.push('开始学习就是好样的，建议可以适当延长学习时间')
    } else if (isSports) {
      if (totalMinutes >= 60) feedbacks.push('太棒了！运动时长超过1小时，非常厉害！')
      else if (totalMinutes >= 45) feedbacks.push('运动45分钟以上，状态很棒！')
      else if (totalMinutes >= 30) feedbacks.push('运动半小时，时长达标了！')
      else if (totalMinutes >= 20) feedbacks.push('运动20分钟以上继续保持')
      else feedbacks.push('开始运动就是好样的，建议可以适当延长时长')
    } else {
      if (totalMinutes >= 60) feedbacks.push('太棒了！活动时长超过1小时，非常厉害！')
      else if (totalMinutes >= 45) feedbacks.push('活动45分钟以上，状态很棒！')
      else if (totalMinutes >= 30) feedbacks.push('活动半小时，时长达标了！')
      else feedbacks.push('开始活动就是好样的，继续保持')
    }
  } else {
    feedbacks.push(isStudy ? '未识别到学习内容' : '未识别到运动内容')
  }

  if (completenessScore >= 80) feedbacks.push('打卡内容很完整')
  else if (completenessScore < 50) {
    if (!content.photos || content.photos.length === 0) {
      feedbacks.push(isStudy ? '建议添加学习照片' : '建议添加运动照片')
    }
    if (!content.text || content.text.trim().length < 10) {
      feedbacks.push(isStudy ? '可以配上学习心得' : '可以配上运动心得')
    }
  }

  if (content.isPublishToMoments && content.momentsComment && content.momentsComment.trim()) {
    feedbacks.push(content.momentsComment.trim())
  }
  if (streakDays >= 7) feedbacks.push(`连续打卡${streakDays}天，太厉害了！`)
  else if (streakDays >= 3) feedbacks.push(`已经连续打卡${streakDays}天，继续保持！`)

  if (feedbacks.length === 0) {
    return isStudy ? '继续保持学习习惯！' : '继续保持运动习惯！'
  }

  let result = feedbacks.join('，')
  result = result.replace(/。。+/g, '。').slice(0, 50)
  if (result.endsWith('，')) result = result.slice(0, -1) + '。'
  if (result.endsWith('。')) result = result.slice(0, -1) + '！'
  else if (!result.endsWith('！')) result = result + '！'
  return result
}

function applyVipBonus(totalScore: number, vipLevel: number): number {
  if (!vipLevel || vipLevel <= 0) return totalScore
  const rate = 1 + vipLevel * VIP_GROWTH_BONUS_RATE
  return Math.round(totalScore * rate)
}

/**
 * 本地计算打卡评分与评语（不请求云、不走 AI）
 */
export function computeCheckinScore(
  content: ScoreInputContent,
  options: {
    streakDays?: number
    checkinHour?: number
    vipLevel?: number
  } = {}
): ScoreOutput {
  const { streakDays = 0, checkinHour = new Date().getHours(), vipLevel = 0 } = options

  const duration = content.duration != null ? content.duration : 0
  const unit = content.durationUnit || '分钟'
  let totalMinutes = 0
  if (duration > 0) {
    totalMinutes = unit === '小时' ? Math.round(duration * 60) : Math.round(duration)
  }

  const activityScore = totalMinutes > 0 ? calculateActivityScore(totalMinutes) : 30
  const amountScore = totalMinutes > 0 ? calculateAmountScore(totalMinutes) : 30
  const completenessScore = calculateCompletenessScore(content)
  const bonusScore = calculateBonusScore({
    isPublishToMoments: content.isPublishToMoments,
    streakDays,
    checkinHour
  })

  let totalScore = Math.min(
    100,
    Math.round(
      activityScore * WEIGHTS.activity +
        amountScore * WEIGHTS.amount +
        completenessScore * WEIGHTS.completeness +
        bonusScore * WEIGHTS.bonus
    )
  )
  totalScore = applyVipBonus(totalScore, vipLevel)

  const feedback = generateFeedback({
    content,
    activityScore,
    amountScore,
    completenessScore,
    totalMinutes,
    streakDays
  })

  return {
    totalScore,
    activityScore,
    amountScore,
    completenessScore,
    bonusScore,
    feedback,
    totalMinutes
  }
}
