/**
 * 目标服务
 */
import { goalsCol, goalRecordsCol, userTagsCol, db, getTodayStr } from './db'

/** 目标类型 - 与打卡分类一致 */
export type GoalType = 'sports' | 'study' | 'life'

/** 目标周期 */
export type GoalPeriod = 'daily' | 'weekly' | 'monthly'

/** 奖励/惩罚分类 */
export type RewardPenaltyCategory = 'exercise' | 'work' | 'life' | 'learning' | 'custom'

/** 目标分类（用于成长墙类型的目标） */
export interface GoalCategory {
  categoryId: string
  categoryName: string
  subCategoryId?: string
  subCategoryName?: string
}

/** 奖励/惩罚配置 */
export interface GoalReward {
  type: 'points' | 'badge' | 'vip_days' | 'custom' | 'none'
  value: number
  name: string
  /** 奖励/惩罚分类 */
  category?: RewardPenaltyCategory
}

/** 用户自定义奖励/惩罚标签 */
export interface UserRewardPenaltyTag {
  id: string
  name: string
  type: 'points' | 'badge' | 'vip_days' | 'streak_reset' | 'points_deduct' | 'vip_downgrade' | 'custom' | 'exercise' | 'work' | 'life' | 'learning'
  value: number
  /** 分类 */
  category: RewardPenaltyCategory
  /** 是否是用户自定义的 */
  isCustom: boolean
  /** 是否是奖励（true=奖励，false=惩罚） */
  isReward?: boolean
  /** 创建时间 */
  createdAt?: Date
}

/** 常用奖励标签 */
export interface CommonRewardTag {
  id: string
  name: string
  type: 'points' | 'badge' | 'vip_days' | 'custom'
  value: number
  isCustom?: boolean
  /** 分类 */
  category?: RewardPenaltyCategory
}

/** 常用惩罚标签 */
export interface CommonPenaltyTag {
  id: string
  name: string
  type: 'streak_reset' | 'points_deduct' | 'vip_downgrade' | 'custom'
  value: number
  isCustom?: boolean
  /** 分类 */
  category?: RewardPenaltyCategory
}

/** 确认人状态 */
export type ConfirmStatus = 'none' | 'pending' | 'confirmed' | 'rejected'

/** 目标确认人信息 */
export interface GoalConfirmor {
  openid: string
  nickname: string
  avatarUrl?: string
  confirmStatus: ConfirmStatus
  confirmTime?: Date
  confirmRemark?: string
  /** 确认码（6位数字） */
  confirmCode?: string
  /** 确认人用户ID（UUID） */
  userId?: string
}

/** 目标信息 */
export interface Goal {
  _id?: string
  openid: string
  type: GoalType
  period: GoalPeriod
  target: number
  title: string
  description: string
  startDate: string
  endDate: string
  // 确认人（可选）
  confirmor?: GoalConfirmor
  // 需要确认人验收才能完成
  needConfirmorVerify: boolean
  // 常用奖励标签
  commonRewardTags?: UserRewardPenaltyTag[]
  // 常用惩罚标签
  commonPenaltyTags?: UserRewardPenaltyTag[]
  // 奖励
  reward?: GoalReward
  // 惩罚
  penalty?: GoalReward
  // 目标分类（用于成长墙类型的目标）
  category?: GoalCategory
  // 是否已删除（逻辑删除）
  deleted?: boolean
  // 删除时间
  deletedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

/** 目标进度信息 */
export interface GoalProgress {
  current: number
  target: number
  percent: number
  isCompleted: boolean
  remaining: number
}

/** 目标状态 */
export type GoalStatus = 'not_started' | 'in_progress' | 'completed' | 'failed'

/** 目标记录 */
export interface GoalRecord {
  _id?: string
  goalId: string
  openid: string
  period: string
  current: number
  processed: boolean
  processedAt?: Date
  createTime?: Date
}

/** 奖励/惩罚分类标签（用于展示） */
export const CategoryLabels: Record<RewardPenaltyCategory, { label: string; icon: string; color: string }> = {
  exercise: { label: '运动类', icon: '🏃', color: '#FF6B6B' },
  work: { label: '工作类', icon: '💼', color: '#4ECDC4' },
  life: { label: '生活类', icon: '🏠', color: '#45B7D1' },
  learning: { label: '学习类', icon: '📚', color: '#96CEB4' },
  custom: { label: '自定义', icon: '⭐', color: '#DDA0DD' }
}

/** 奖励模板 */
export const RewardTemplates = [
  { type: 'none' as const, name: '无奖励', value: 0 },
  { type: 'vip_days' as const, name: '3天VIP', value: 3 },
  { type: 'vip_days' as const, name: '7天VIP', value: 7 },
  { type: 'vip_days' as const, name: '30天VIP', value: 30 },
  { type: 'points' as const, name: '50积分', value: 50 },
  { type: 'points' as const, name: '100积分', value: 100 },
  { type: 'points' as const, name: '500积分', value: 500 },
  { type: 'badge' as const, name: '坚持不懈徽章', value: 1 },
  { type: 'badge' as const, name: '运动达人徽章', value: 1 },
]

/** 用户自定义奖励默认值 - 按类别分组（引人入胜的奖励） */
export const DefaultUserRewardTags: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]> = {
  exercise: [
    { id: 'default_ex_1', name: '吃顿大餐 🍔', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
    { id: 'default_ex_2', name: '看一场电影 🎬', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
    { id: 'default_ex_3', name: '买一件新衣服 👕', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
    { id: 'default_ex_4', name: '去喜欢的餐厅吃饭 🍜', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
    { id: 'default_ex_5', name: '睡到自然醒 😴', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
    { id: 'default_ex_6', name: '玩游戏1小时 🎮', type: 'exercise', value: 1, category: 'exercise', isCustom: false },
  ],
  work: [
    { id: 'default_work_1', name: '早下班2小时 ⏰', type: 'work', value: 2, category: 'work', isCustom: false },
    { id: 'default_work_2', name: '一天不加班 🎉', type: 'work', value: 1, category: 'work', isCustom: false },
    { id: 'default_work_3', name: '喝杯奶茶 🧋', type: 'work', value: 1, category: 'work', isCustom: false },
    { id: 'default_work_4', name: '休息半天 ☕', type: 'work', value: 0.5, category: 'work', isCustom: false },
    { id: 'default_work_5', name: '买想要的东西 🛍️', type: 'work', value: 1, category: 'work', isCustom: false },
  ],
  life: [
    { id: 'default_life_1', name: '去旅行一次 ✈️', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_life_2', name: '买想要的礼物 🎁', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_life_3', name: '吃顿大餐 🍰', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_life_4', name: '逛街购物 🛒', type: 'life', value: 2, category: 'life', isCustom: false },
    { id: 'default_life_5', name: '看一场演出 🎭', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_life_6', name: '按摩放松 💆', type: 'life', value: 1, category: 'life', isCustom: false },
  ],
  learning: [
    { id: 'default_learn_1', name: '买想要的书籍 📖', type: 'learning', value: 1, category: 'learning', isCustom: false },
    { id: 'default_learn_2', name: '报名想学的课程 🎓', type: 'learning', value: 1, category: 'learning', isCustom: false },
    { id: 'default_learn_3', name: '听一场演讲 🎤', type: 'learning', value: 1, category: 'learning', isCustom: false },
    { id: 'default_learn_4', name: '去博物馆参观 🏛️', type: 'learning', value: 1, category: 'learning', isCustom: false },
  ],
  custom: []
}

/** 用户自定义惩罚默认值 - 按类别分组（更有强度的惩罚） */
export const DefaultUserPenaltyTags: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]> = {
  exercise: [
    { id: 'default_pen_ex_1', name: '跑步30分钟 🏃', type: 'exercise', value: 30, category: 'exercise', isCustom: false },
    { id: 'default_pen_ex_2', name: '做100个俯卧撑 💪', type: 'exercise', value: 100, category: 'exercise', isCustom: false },
    { id: 'default_pen_ex_3', name: '平板支撑10分钟 ⏱️', type: 'exercise', value: 10, category: 'exercise', isCustom: false },
    { id: 'default_pen_ex_4', name: '扎马步30分钟 🚶', type: 'exercise', value: 30, category: 'exercise', isCustom: false },
    { id: 'default_pen_ex_5', name: '负重深蹲50个 🔥', type: 'exercise', value: 50, category: 'exercise', isCustom: false },
  ],
  work: [
    { id: 'default_pen_work_1', name: '加班3小时 ⏰', type: 'work', value: 3, category: 'work', isCustom: false },
    { id: 'default_pen_work_2', name: '额外完成3项工作 📋', type: 'work', value: 3, category: 'work', isCustom: false },
    { id: 'default_pen_work_3', name: '写5000字工作总结 📝', type: 'work', value: 1, category: 'work', isCustom: false },
    { id: 'default_pen_work_4', name: '取消休息日安排 😰', type: 'work', value: 1, category: 'work', isCustom: false },
  ],
  life: [
    { id: 'default_pen_life_1', name: '做家务3小时 🧹', type: 'life', value: 180, category: 'life', isCustom: false },
    { id: 'default_pen_life_2', name: '不准吃饭 🍚', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_pen_life_3', name: '不准玩手机 📱', type: 'life', value: 1, category: 'life', isCustom: false },
    { id: 'default_pen_life_4', name: '捐出100元 💰', type: 'life', value: 100, category: 'life', isCustom: false },
    { id: 'default_pen_life_5', name: '睡地板 🛏️', type: 'life', value: 1, category: 'life', isCustom: false },
  ],
  learning: [
    { id: 'default_pen_learn_1', name: '背单词100个 📚', type: 'learning', value: 100, category: 'learning', isCustom: false },
    { id: 'default_pen_learn_2', name: '阅读3小时 📖', type: 'learning', value: 180, category: 'learning', isCustom: false },
    { id: 'default_pen_learn_3', name: '写3篇学习笔记 📝', type: 'learning', value: 3, category: 'learning', isCustom: false },
    { id: 'default_pen_learn_4', name: '看纪录片5小时 🎬', type: 'learning', value: 300, category: 'learning', isCustom: false },
    { id: 'default_pen_learn_5', name: '抄写知识点50遍 ✍️', type: 'learning', value: 50, category: 'learning', isCustom: false },
  ],
  custom: []
}

/** 常用奖励标签列表 */
export const CommonRewardTags: CommonRewardTag[] = [
  { id: 'reward_1', name: '3天VIP', type: 'vip_days', value: 3 },
  { id: 'reward_2', name: '7天VIP', type: 'vip_days', value: 7 },
  { id: 'reward_3', name: '15天VIP', type: 'vip_days', value: 15 },
  { id: 'reward_4', name: '30天VIP', type: 'vip_days', value: 30 },
  { id: 'reward_5', name: '50积分', type: 'points', value: 50 },
  { id: 'reward_6', name: '100积分', type: 'points', value: 100 },
  { id: 'reward_7', name: '200积分', type: 'points', value: 200 },
  { id: 'reward_8', name: '500积分', type: 'points', value: 500 },
  { id: 'reward_9', name: '坚持不懈徽章', type: 'badge', value: 1 },
  { id: 'reward_10', name: '运动达人徽章', type: 'badge', value: 1 },
  { id: 'reward_11', name: '超级MVP徽章', type: 'badge', value: 1 },
]

/** 常用惩罚标签列表 */
export const CommonPenaltyTags: CommonPenaltyTag[] = [
  { id: 'penalty_1', name: '连续中断', type: 'streak_reset', value: 0 },
  { id: 'penalty_2', name: '扣除20积分', type: 'points_deduct', value: 20 },
  { id: 'penalty_3', name: '扣除50积分', type: 'points_deduct', value: 50 },
  { id: 'penalty_4', name: '扣除100积分', type: 'points_deduct', value: 100 },
  { id: 'penalty_5', name: '扣除200积分', type: 'points_deduct', value: 200 },
  { id: 'penalty_6', name: 'VIP降1级', type: 'vip_downgrade', value: 1 },
  { id: 'penalty_7', name: '取消VIP资格', type: 'vip_downgrade', value: 99 },
]

/** 惩罚模板 */
export const PenaltyTemplates = [
  { type: 'none' as const, name: '无惩罚', value: 0 },
  { type: 'streak_reset' as const, name: '连续中断', value: 0 },
  { type: 'points_deduct' as const, name: '扣除50积分', value: 50 },
  { type: 'points_deduct' as const, name: '扣除100积分', value: 100 },
  { type: 'vip_downgrade' as const, name: 'VIP降1级', value: 1 },
]

/** 目标配置 - 与打卡分类对应 */
export const GoalConfigs = {
  daily: {
    sports: { title: '每日运动', description: '每天完成至少1次运动打卡', defaultTarget: 1 },
    study: { title: '每日学习', description: '每天完成至少1次学习打卡', defaultTarget: 1 },
    life: { title: '每日生活', description: '每天完成至少1次生活打卡', defaultTarget: 1 },
  },
  weekly: {
    sports: { title: '每周运动', description: '每周完成指定次数运动打卡', defaultTarget: 5 },
    study: { title: '每周学习', description: '每周完成指定次数学习打卡', defaultTarget: 5 },
    life: { title: '每周生活', description: '每周完成指定次数生活打卡', defaultTarget: 5 },
  },
  monthly: {
    sports: { title: '每月运动', description: '每月完成指定次数运动打卡', defaultTarget: 20 },
    study: { title: '每月学习', description: '每月完成指定次数学习打卡', defaultTarget: 20 },
    life: { title: '每月生活', description: '每月完成指定次数生活打卡', defaultTarget: 20 },
  }
}

/** 目标配置项（带分类选项） */
export interface GoalConfigItem {
  title: string
  description: string
  defaultTarget: number
  /** 是否需要选择分类 */
  needCategory?: boolean
}

/**
 * 检查目标类型是否需要选择分类
 * @param type 目标类型
 * @param period 目标周期
 */
export function goalNeedsCategory(type: GoalType, period: GoalPeriod): boolean {
  const config = GoalConfigs[period] && GoalConfigs[period][type]
  return config && config.needCategory === true
}

/** 未删除的查询条件：deleted 不存在或 deleted 为 false */
function notDeletedCondition(openid: string) {
  const _ = db.command
  return _.and([
    { _openid: openid },
    _.or([
      { deleted: _.exists(false) },
      { deleted: _.eq(false) }
    ])
  ])
}

/**
 * 获取用户的所有活跃目标
 */
export async function getActiveGoals(openid: string): Promise<Goal[]> {
  try {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const _ = db.command
    const { data } = await goalsCol()
      .where(_.and([
        notDeletedCondition(openid),
        { endDate: _.gte(todayStr) }
      ]))
      .orderBy('createdAt', 'desc')
      .get()

    return data as Goal[]
  } catch (e) {
    console.error('getActiveGoals error:', e)
    return []
  }
}

/**
 * 获取用户的所有目标
 */
export async function getUserGoals(openid: string): Promise<Goal[]> {
  try {
    const { data } = await goalsCol()
      .where(notDeletedCondition(openid))
      .orderBy('createdAt', 'desc')
      .get()
    return data as Goal[]
  } catch (e) {
    console.error('getUserGoals error:', e)
    return []
  }
}

/** 目标列表查询条件 */
export interface GoalQueryParams {
  status?: GoalStatus | 'all'  // 目标状态
  period?: GoalPeriod | 'all'  // 周期
  type?: GoalType | 'all'      // 类型
  startDate?: string           // 开始日期筛选
  endDate?: string             // 结束日期筛选
  needConfirmorVerify?: boolean  // 是否需要确认人验收
  confirmStatus?: ConfirmStatus  // 确认状态
  sortBy?: 'createdAt' | 'startDate' | 'endDate' | 'progress'  // 排序字段
  sortOrder?: 'asc' | 'desc'   // 排序方向
  page?: number                // 页码
  pageSize?: number            // 每页数量
}

/**
 * 带筛选条件的目标列表查询
 */
export async function queryGoals(
  openid: string,
  params: GoalQueryParams = {}
): Promise<{ goals: Goal[]; total: number }> {
  try {
    const {
      status = 'all',
      period = 'all',
      type = 'all',
      startDate,
      endDate,
      needConfirmorVerify,
      confirmStatus,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20
    } = params

    const _ = db.command
    const extraConditions: any = {}

    // 状态筛选
    if (status !== 'all') {
      const todayStr = getTodayStr()
      if (status === 'not_started') {
        extraConditions.startDate = _.gt(todayStr)
      } else if (status === 'in_progress') {
        extraConditions.startDate = _.lte(todayStr)
        extraConditions.endDate = _.gte(todayStr)
      } else if (status === 'completed') {
        extraConditions.endDate = _.lt(todayStr)
      } else if (status === 'failed') {
        extraConditions.endDate = _.lt(todayStr)
      }
    }

    // 周期筛选
    if (period !== 'all') {
      extraConditions.period = period
    }

    // 类型筛选
    if (type !== 'all') {
      extraConditions.type = type
    }

    // 日期范围筛选
    if (startDate) {
      extraConditions.startDate = extraConditions.startDate || _.gte(startDate)
    }
    if (endDate) {
      extraConditions.endDate = extraConditions.endDate || _.lte(endDate)
    }

    // 是否需要确认人验收
    if (needConfirmorVerify !== undefined) {
      extraConditions.needConfirmorVerify = needConfirmorVerify
    }

    // 确认状态筛选
    if (confirmStatus) {
      extraConditions['confirmor.confirmStatus'] = confirmStatus
    }

    const whereClause = Object.keys(extraConditions).length > 0
      ? _.and([notDeletedCondition(openid), extraConditions])
      : notDeletedCondition(openid)

    // 查询总数
    const { total } = await goalsCol().where(whereClause).count()

    // 查询列表
    const { data } = await goalsCol()
      .where(whereClause)
      .orderBy(sortBy, sortOrder)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    return { goals: data as Goal[], total }
  } catch (e) {
    console.error('queryGoals error:', e)
    return { goals: [], total: 0 }
  }
}

/**
 * 获取我需要确认的目标列表（作为确认人）
 */
export async function getGoalsPendingConfirm(openid: string): Promise<Goal[]> {
  try {
    const _ = db.command
    const { data } = await goalsCol()
      .where(_.and([
        notDeletedCondition(openid),
        { 'confirmor.openid': openid, 'confirmor.confirmStatus': 'pending' }
      ]))
      .orderBy('createdAt', 'desc')
      .get()
    return data as Goal[]
  } catch (e) {
    console.error('getGoalsPendingConfirm error:', e)
    return []
  }
}

/**
 * 确认人确认目标
 */
export async function confirmGoal(
  goalId: string,
  confirmorOpenid: string,
  confirmed: boolean,
  remark?: string
): Promise<{ success: boolean; msg?: string }> {
  try {
    // 查询目标
    const { data: goals } = await goalsCol()
      .where({ _id: goalId })
      .get()

    if (goals.length === 0) {
      return { success: false, msg: '目标不存在' }
    }

    const goal = goals[0] as Goal

    // 检查目标是否已删除
    if (goal.deleted) {
      return { success: false, msg: '目标已删除' }
    }

    // 验证是否是指定的确认人
    if (!goal.confirmor || goal.confirmor.openid !== confirmorOpenid) {
      return { success: false, msg: '您不是该目标的确认人' }
    }

    // 更新确认状态
    await goalsCol()
      .where({ _id: goalId })
      .update({
        data: {
          'confirmor.confirmStatus': confirmed ? 'confirmed' : 'rejected',
          'confirmor.confirmTime': new Date(),
          'confirmor.confirmRemark': remark || '',
          updatedAt: new Date()
        } as any
      })

    return { success: true, msg: confirmed ? '已确认目标' : '已拒绝确认' }
  } catch (e) {
    console.error('confirmGoal error:', e)
    return { success: false, msg: '确认失败' }
  }
}

/**
 * 目标创建者设置确认人（发送确认请求）
 */
export async function setGoalConfirmor(
  goalId: string,
  ownerOpenid: string,
  confirmorInfo: GoalConfirmor
): Promise<{ success: boolean; msg?: string }> {
  try {
    // 查询目标
    const { data: goals } = await goalsCol()
      .where({ _id: goalId, _openid: ownerOpenid })
      .get()

    if (goals.length === 0) {
      return { success: false, msg: '目标不存在或无权限' }
    }

    const goal = goals[0] as Goal

    // 检查目标是否已删除
    if (goal.deleted) {
      return { success: false, msg: '目标已删除' }
    }

    // 更新确认人信息
    await goalsCol()
      .where({ _id: goalId })
      .update({
        data: {
          confirmor: {
            ...confirmorInfo,
            confirmStatus: 'pending'
          },
          needConfirmorVerify: true,
          updatedAt: new Date()
        } as any
      })

    return { success: true, msg: '已发送确认请求' }
  } catch (e) {
    console.error('setGoalConfirmor error:', e)
    return { success: false, msg: '设置确认人失败' }
  }
}

/**
 * 移除目标确认人
 */
export async function removeGoalConfirmor(
  goalId: string,
  ownerOpenid: string
): Promise<{ success: boolean; msg?: string }> {
  try {
    const { data: goals } = await goalsCol()
      .where({ _id: goalId, _openid: ownerOpenid })
      .get()

    if (goals.length === 0) {
      return { success: false, msg: '目标不存在或无权限' }
    }

    const goal = goals[0] as Goal

    // 检查目标是否已删除
    if (goal.deleted) {
      return { success: false, msg: '目标已删除' }
    }

    await goalsCol()
      .where({ _id: goalId })
      .update({
        data: {
          confirmor: null,
          needConfirmorVerify: false,
          updatedAt: new Date()
        } as any
      })

    return { success: true, msg: '已移除确认人' }
  } catch (e) {
    console.error('removeGoalConfirmor error:', e)
    return { success: false, msg: '移除确认人失败' }
  }
}

/**
 * 计算目标进度
 */
export async function calculateGoalProgress(openid: string, goal: Goal): Promise<GoalProgress> {
  try {
    const { data: records } = await goalRecordsCol()
      .where({
        _openid: openid,
        goalId: goal._id
      })
      .get()

    const current = records.reduce((sum: number, record: GoalRecord) => sum + record.current, 0)
    const percent = Math.min(100, Math.round((current / goal.target) * 100))
    const isCompleted = current >= goal.target
    const remaining = Math.max(0, goal.target - current)

    return {
      current,
      target: goal.target,
      percent,
      isCompleted,
      remaining
    }
  } catch (e) {
    console.error('calculateGoalProgress error:', e)
    return {
      current: 0,
      target: goal.target,
      percent: 0,
      isCompleted: false,
      remaining: goal.target
    }
  }
}

/**
 * 获取目标状态
 * @param goal 目标对象
 * @param progress 目标进度
 * @param requireConfirmorVerify 是否需要确认人验收（默认取目标配置）
 */
export function getGoalStatus(goal: Goal, progress: GoalProgress, requireConfirmorVerify?: boolean): GoalStatus {
  const todayStr = getTodayStr()
  const needVerify = requireConfirmorVerify !== undefined ? requireConfirmorVerify : goal.needConfirmorVerify

  // 尚未开始
  if (todayStr < goal.startDate) {
    return 'not_started'
  }

  // 已结束
  if (todayStr > goal.endDate) {
    // 如果需要确认人验收，但确认人还未确认，则为进行中
    if (needVerify && goal.confirmor && goal.confirmor.confirmStatus !== 'confirmed') {
      return 'in_progress'
    }
    return progress.isCompleted ? 'completed' : 'failed'
  }

  // 进行中
  return 'in_progress'
}

/**
 * 检查目标是否已完成（考虑确认人验收）
 */
export function isGoalCompleted(goal: Goal, progress: GoalProgress): boolean {
  // 如果需要确认人验收
  if (goal.needConfirmorVerify && goal.confirmor) {
    // 必须确认人确认才算完成
    return progress.isCompleted && goal.confirmor.confirmStatus === 'confirmed'
  }
  // 无需确认人验收，按正常进度判断
  return progress.isCompleted
}

/**
 * 检查并处理目标
 */
export async function checkAndProcessGoal(openid: string, goalId: string): Promise<{ success: boolean; result?: { type: 'reward' | 'penalty'; name: string; value: any }; msg?: string }> {
  try {
    const { data: goalData } = await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .get()

    if (goalData.length === 0) {
      return { success: false, msg: '目标不存在' }
    }

    const goal = goalData[0] as Goal

    // 检查目标是否已删除
    if (goal.deleted) {
      return { success: false, msg: '目标已删除' }
    }

    const progress = await calculateGoalProgress(openid, goal)

    // 标记记录为已处理
    await goalRecordsCol()
      .where({ _openid: openid, goalId: goalId, processed: false })
      .update({
        data: {
          processed: true,
          processedAt: new Date()
        } as any
      })

    if (progress.isCompleted && goal.reward && goal.reward.type !== 'none') {
      return { success: true, result: { type: 'reward', name: goal.reward.name, value: goal.reward.value } }
    } else if (!progress.isCompleted && goal.penalty && goal.penalty.type !== 'none') {
      return { success: true, result: { type: 'penalty', name: goal.penalty.name, value: goal.penalty.value } }
    }

    return { success: true, msg: '目标已结算' }
  } catch (e) {
    console.error('checkAndProcessGoal error:', e)
    return { success: false, msg: '检查目标失败' }
  }
}

/**
 * 创建新目标（兼容页面调用）
 * @param openid 用户openid
 * @param type 目标类型
 * @param period 目标周期
 * @param target 目标值
 * @param reward 奖励配置
 * @param penalty 惩罚配置
 * @param customStartDate 自定义开始日期（可选）
 * @param customEndDate 自定义结束日期（可选）
 * @param confirmor 确认人信息（可选）
 * @param commonRewardTags 常用奖励标签（可选）
 * @param commonPenaltyTags 常用惩罚标签（可选）
 * @param category 目标分类（用于成长墙类型的目标）
 */
export async function createGoal(
  openid: string,
  type: GoalType,
  period: GoalPeriod,
  target: number,
  reward?: GoalReward,
  penalty?: GoalReward,
  customStartDate?: string,
  customEndDate?: string,
  confirmor?: GoalConfirmor,
  commonRewardTags?: UserRewardPenaltyTag[],
  commonPenaltyTags?: UserRewardPenaltyTag[],
  category?: GoalCategory
): Promise<{ success: boolean; goal?: Goal; msg?: string }> {
  try {
    const config = GoalConfigs[period][type]
    if (!config) {
      return { success: false, msg: '目标类型不存在' }
    }

    // 计算开始和结束日期（如果没有自定义日期，则按周期自动计算）
    let startDate: string
    let endDate: string

    if (customStartDate && customEndDate) {
      // 使用自定义日期
      startDate = customStartDate
      endDate = customEndDate
    } else {
      const today = new Date()
      const todayStr = getTodayStr()

      if (period === 'daily') {
        startDate = todayStr
        endDate = todayStr
      } else if (period === 'weekly') {
        const dayOfWeek = today.getDay() || 7
        const start = new Date(today)
        start.setDate(today.getDate() - dayOfWeek + 1)
        const end = new Date(start)
        end.setDate(start.getDate() + 6)

        const pad = (n: number) => String(n).padStart(2, '0')
        startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
        endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`
      } else {
        const year = today.getFullYear()
        const month = today.getMonth() + 1
        const lastDay = new Date(year, month, 0).getDate()
        const pad = (n: number) => String(n).padStart(2, '0')
        startDate = `${year}-${pad(month)}-01`
        endDate = `${year}-${pad(month)}-${pad(lastDay)}`
      }
    }

    // 判断是否需要确认人验收
    const needConfirmorVerify = !!confirmor

    const goalData = {
      type,
      period,
      target,
      title: config.title,
      description: config.description,
      startDate,
      endDate,
      reward,
      penalty,
      confirmor: confirmor ? { ...confirmor, confirmStatus: 'pending' as ConfirmStatus } : undefined,
      needConfirmorVerify,
      commonRewardTags,
      commonPenaltyTags,
      category,
      deleted: false
    }

    const result = await goalsCol().add({
      data: {
        ...goalData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    } as any)

    return {
      success: true,
      goal: { ...goalData, _id: result._id, openid } as Goal
    }
  } catch (e) {
    console.error('createGoal error:', e)
    return { success: false, msg: '创建目标失败' }
  }
}

/**
 * 创建新目标（原始版本）
 */
export async function createGoalFull(openid: string, goalData: Omit<Goal, '_id' | 'openid' | 'createdAt' | 'updatedAt'>): Promise<Goal | null> {
  try {
    const result = await goalsCol().add({
      data: {
        ...goalData,
        deleted: goalData.deleted !== undefined ? goalData.deleted : false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      // @ts-ignore
    } as any)
    return { ...goalData, _id: result._id, openid } as Goal
  } catch (e) {
    console.error('createGoal error:', e)
    return null
  }
}

/**
 * 更新目标
 */
export async function updateGoal(openid: string, goalId: string, updates: Partial<Goal>): Promise<boolean> {
  try {
    // 先查询目标是否存在且未删除
    const { data: goals } = await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .get()

    if (goals.length === 0) {
      console.warn('updateGoal: 目标不存在')
      return false
    }

    const goal = goals[0] as Goal
    if (goal.deleted) {
      console.warn('updateGoal: 目标已删除')
      return false
    }

    await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .update({
        data: {
          ...updates,
          updatedAt: new Date()
        }
      })
    return true
  } catch (e) {
    console.error('updateGoal error:', e)
    return false
  }
}

/**
 * 删除目标
 */
export async function deleteGoal(openid: string, goalId: string): Promise<boolean> {
  try {
    // 逻辑删除：标记 deleted 为 true
    await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .update({
        data: {
          deleted: true,
          deletedAt: new Date()
        }
      })
    return true
  } catch (e) {
    console.error('deleteGoal error:', e)
    return false
  }
}

/**
 * 记录目标进度
 */
export async function recordGoalProgress(openid: string, goalId: string, progress: number): Promise<boolean> {
  try {
    // 先检查目标是否存在且未删除
    const { data: goals } = await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .get()

    if (goals.length === 0) {
      console.warn('recordGoalProgress: 目标不存在')
      return false
    }

    const goal = goals[0] as Goal
    if (goal.deleted) {
      console.warn('recordGoalProgress: 目标已删除')
      return false
    }

    const { data: existingRecords } = await goalRecordsCol()
      .where({
        _openid: openid,
        goalId: goalId,
        processed: false
      })
      .get()

    if (existingRecords.length > 0) {
      // 更新现有记录
      await goalRecordsCol()
        .where({ _openid: openid, goalId: goalId, processed: false })
        .update({
          data: {
            current: progress,
            createTime: new Date()
          }
        } as any)
    } else {
      // 创建新记录
      await goalRecordsCol().add({
        data: {
          _openid: openid,
          goalId: goalId,
          period: 'current',
          current: progress,
          processed: false,
          createTime: new Date()
        }
      } as any)
    }

    return true
  } catch (e) {
    console.error('recordGoalProgress error:', e)
    return false
  }
}

/**
 * 处理目标奖励/惩罚
 */
export async function processGoalReward(openid: string, goalId: string): Promise<{ reward?: GoalReward; penalty?: GoalReward }> {
  try {
    const { data: goalData } = await goalsCol()
      .where({ _openid: openid, _id: goalId })
      .get()

    if (goalData.length === 0) {
      return {}
    }

    const goal = goalData[0] as Goal

    // 检查目标是否已删除
    if (goal.deleted) {
      return {}
    }

    const progress = await calculateGoalProgress(openid, goal)

    // 标记记录为已处理
    await goalRecordsCol()
      .where({ _openid: openid, goalId: goalId, processed: false })
      .update({
        data: {
          processed: true,
          processedAt: new Date()
        }
      } as any)

    if (progress.isCompleted && goal.reward) {
      return { reward: goal.reward }
    } else if (!progress.isCompleted && goal.penalty) {
      return { penalty: goal.penalty }
    }

    return {}
  } catch (e) {
    console.error('processGoalReward error:', e)
    return {}
  }
}

/**
 * 获取用户的目标统计（优化版 - 避免 N+1 查询）
 */
export async function getGoalStats(openid: string): Promise<{
  total: number
  completed: number
  inProgress: number
  failed: number
}> {
  try {
    const { data: goals } = await goalsCol()
      .where(notDeletedCondition(openid))
      .get()

    if (goals.length === 0) {
      return { total: 0, completed: 0, inProgress: 0, failed: 0 }
    }

    // 批量获取所有目标的记录，避免 N+1 查询
    const goalIds = goals.map((g: Goal) => g._id)
    const { data: allRecords } = await goalRecordsCol()
      .where({
        _openid: openid,
        goalId: db.command.in(goalIds)
      })
      .get()

    // 按 goalId 分组记录
    const recordsByGoalId = new Map<string, GoalRecord[]>()
    for (const record of allRecords || []) {
      const goalId = (record as GoalRecord).goalId
      if (!recordsByGoalId.has(goalId)) {
        recordsByGoalId.set(goalId, [])
      }
      recordsByGoalId.get(goalId)!.push(record as GoalRecord)
    }

    // 在内存中计算每个目标的进度
    const today = new Date()
    let completed = 0
    let inProgress = 0
    let failed = 0

    for (const goal of goals as Goal[]) {
      const endDate = new Date(goal.endDate)
      const records = recordsByGoalId.get(goal._id) || []
      const current = records.reduce((sum: number, record: GoalRecord) => sum + record.current, 0)
      const isCompleted = current >= goal.target

      if (isCompleted) {
        completed++
      } else if (endDate < today) {
        failed++
      } else {
        inProgress++
      }
    }

    return {
      total: goals.length,
      completed,
      inProgress,
      failed
    }
  } catch (e) {
    console.error('getGoalStats error:', e)
    return { total: 0, completed: 0, inProgress: 0, failed: 0 }
  }
}

// ============================================================================
// 用户自定义奖惩标签管理
// ============================================================================

/**
 * 获取用户的所有自定义奖励/惩罚标签
 * @param openid 用户openid
 * @param tagType 标签类型：'reward' | 'penalty'
 */
export async function getUserTags(
  openid: string,
  tagType: 'reward' | 'penalty'
): Promise<{
  rewards: UserRewardPenaltyTag[]
  penalties: UserRewardPenaltyTag[]
}> {
  try {
    const { data } = await userTagsCol()
      .where({ _openid: openid })
      .get()

    const rewards: UserRewardPenaltyTag[] = []
    const penalties: UserRewardPenaltyTag[] = []

    for (const item of data) {
      const tag = item as UserRewardPenaltyTag
      if (tag.type.startsWith('reward') || tag.category === 'reward') {
        rewards.push(tag)
      } else {
        penalties.push(tag)
      }
    }

    return { rewards, penalties }
  } catch (e) {
    console.error('getUserTags error:', e)
    return { rewards: [], penalties: [] }
  }
}

/**
 * 获取用户自定义奖励标签
 */
export async function getUserRewardTags(openid: string): Promise<UserRewardPenaltyTag[]> {
  try {
    const { data } = await userTagsCol()
      .where({
        _openid: openid,
        isReward: true
      })
      .orderBy('createdAt', 'desc')
      .get()

    return data as UserRewardPenaltyTag[]
  } catch (e) {
    console.error('getUserRewardTags error:', e)
    return []
  }
}

/**
 * 获取用户自定义惩罚标签
 */
export async function getUserPenaltyTags(openid: string): Promise<UserRewardPenaltyTag[]> {
  try {
    const { data } = await userTagsCol()
      .where({
        _openid: openid,
        isReward: false
      })
      .orderBy('createdAt', 'desc')
      .get()

    return data as UserRewardPenaltyTag[]
  } catch (e) {
    console.error('getUserPenaltyTags error:', e)
    return []
  }
}

/**
 * 添加用户自定义奖励/惩罚标签
 */
export async function addUserTag(
  openid: string,
  tag: Omit<UserRewardPenaltyTag, 'id' | 'createdAt'>
): Promise<{ success: boolean; tag?: UserRewardPenaltyTag; msg?: string }> {
  try {
    const newTag: UserRewardPenaltyTag = {
      ...tag,
      id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date()
    }

    await userTagsCol().add({
      data: {
        _openid: openid,
        ...newTag
      } as any
    })

    return { success: true, tag: newTag }
  } catch (e) {
    console.error('addUserTag error:', e)
    return { success: false, msg: '添加标签失败' }
  }
}

/**
 * 更新用户自定义标签
 */
export async function updateUserTag(
  openid: string,
  tagId: string,
  updates: Partial<UserRewardPenaltyTag>
): Promise<{ success: boolean; msg?: string }> {
  try {
    await userTagsCol()
      .where({ _openid: openid, id: tagId })
      .update({
        data: {
          ...updates,
          updatedAt: new Date()
        } as any
      })

    return { success: true }
  } catch (e) {
    console.error('updateUserTag error:', e)
    return { success: false, msg: '更新标签失败' }
  }
}

/**
 * 删除用户自定义标签
 */
export async function deleteUserTag(
  openid: string,
  tagId: string
): Promise<{ success: boolean; msg?: string }> {
  try {
    await userTagsCol()
      .where({ _openid: openid, id: tagId })
      .remove()

    return { success: true }
  } catch (e) {
    console.error('deleteUserTag error:', e)
    return { success: false, msg: '删除标签失败' }
  }
}

/**
 * 获取用户的完整奖惩标签列表（默认标签 + 用户自定义标签）
 * @param openid 用户openid
 */
export async function getAllTagsWithDefaults(
  openid: string
): Promise<{
  rewards: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]>
  penalties: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]>
}> {
  try {
    // 获取用户自定义标签
    const { data: customTags } = await userTagsCol()
      .where({ _openid: openid })
      .get()

    // 初始化结果
    const rewards: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]> = {
      exercise: [...DefaultUserRewardTags.exercise],
      work: [...DefaultUserRewardTags.work],
      life: [...DefaultUserRewardTags.life],
      learning: [...DefaultUserRewardTags.learning],
      custom: [...DefaultUserRewardTags.custom]
    }

    const penalties: Record<RewardPenaltyCategory, UserRewardPenaltyTag[]> = {
      exercise: [...DefaultUserPenaltyTags.exercise],
      work: [...DefaultUserPenaltyTags.work],
      life: [...DefaultUserPenaltyTags.life],
      learning: [...DefaultUserPenaltyTags.learning],
      custom: [...DefaultUserPenaltyTags.custom]
    }

    // 分类添加用户自定义标签
    for (const tag of customTags as UserRewardPenaltyTag[]) {
      const category = (tag.category || 'custom') as RewardPenaltyCategory
      const isReward = (tag as any).isReward !== false

      if (isReward) {
        if (!rewards[category]) {
          rewards[category] = []
        }
        rewards[category].push({ ...tag, isCustom: true })
      } else {
        if (!penalties[category]) {
          penalties[category] = []
        }
        penalties[category].push({ ...tag, isCustom: true })
      }
    }

    return { rewards, penalties }
  } catch (e) {
    console.error('getAllTagsWithDefaults error:', e)
    // 返回默认标签
    return {
      rewards: DefaultUserRewardTags,
      penalties: DefaultUserPenaltyTags
    }
  }
}

/**
 * 根据确认码查询目标
 * @param confirmCode 确认码
 */
export async function getGoalByConfirmCode(confirmCode: string): Promise<Goal | null> {
  try {
    const _ = db.command
    const { data } = await goalsCol()
      .where(_.and([
        { 'confirmor.confirmCode': confirmCode },
        _.or([
          { deleted: _.exists(false) },
          { deleted: _.eq(false) }
        ])
      ]))
      .limit(1)
      .get()

    if (data.length === 0) {
      return null
    }

    return data[0] as Goal
  } catch (e) {
    console.error('getGoalByConfirmCode error:', e)
    return null
  }
}

/**
 * 确认人确认目标（通过确认码）
 * @param confirmCode 确认码
 * @param userId 确认人用户ID
 * @param confirmed 是否确认
 * @param remark 备注
 */
export async function confirmGoalByCode(
  confirmCode: string,
  userId: string,
  confirmed: boolean,
  remark?: string
): Promise<{ success: boolean; msg?: string }> {
  try {
    const goal = await getGoalByConfirmCode(confirmCode)
    if (!goal) {
      return { success: false, msg: '确认码无效' }
    }

    // 检查是否已经确认过
    if (goal.confirmor && goal.confirmor.confirmStatus !== 'pending') {
      return { success: false, msg: '该目标已确认' }
    }

    // 更新确认状态
    await goalsCol()
      .where({ _id: goal._id })
      .update({
        data: {
          'confirmor.confirmStatus': confirmed ? 'confirmed' : 'rejected',
          'confirmor.confirmTime': new Date(),
          'confirmor.confirmRemark': remark || '',
          'confirmor.userId': userId,
          updatedAt: new Date()
        } as any
      })

    return {
      success: true,
      msg: confirmed ? '确认成功' : '已拒绝确认'
    }
  } catch (e) {
    console.error('confirmGoalByCode error:', e)
    return { success: false, msg: '确认失败' }
  }
}

/**
 * 生成目标分享链接
 * @param goalId 目标ID
 * @param confirmCode 确认码
 */
export function generateGoalShareUrl(goalId: string, confirmCode: string): string {
  return `pages/goal-confirm/goal-confirm?id=${goalId}&code=${confirmCode}`
}
