/**
 * 任务服务
 *
 * 成就/任务埋点说明（各成就在对应业务处解锁，任务进度在对应业务处更新）：
 * - 打卡业务（checkin.ts → syncTaskAndAchievementsAfterCheckin）：
 *   任务进度：daily_checkin、streak_7、streak_30、upload_photo
 *   成就：first_checkin、streak_7、streak_30、streak_100、total_50、total_200
 * - VIP 业务（vip.ts → upgradeVip 成功后）：成就 vip_member
 * - 邀请业务（group.ts → joinByInviteCode 传入 inviterOpenid 时）：
 *   任务进度：invite_friend；成就：invite_5
 */
import { userTasksCol, userAchievementsCol } from './db'
import { getAllStats } from './stats'

/** 任务类型 */
export type TaskType = 'checkin' | 'streak' | 'duration' | 'upload' | 'invite'

/** 任务信息 */
export interface Task {
  id: string
  title: string
  description: string
  type: TaskType
  target: number
  reward: { type: string; value: number }
  vipOnly: boolean
  icon: string
}

/** 用户任务进度 */
export interface UserTaskProgress {
  _id?: string
  openid: string
  taskId: string
  current: number
  completed: boolean
  claimed: boolean
  completedAt?: Date
  claimedAt?: Date
  createTime?: Date
  updateTime?: Date
}

/** 用户成就 */
export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  unlockedAt?: Date
}

// 预定义任务列表
export const TASKS: Task[] = [
  {
    id: 'daily_checkin',
    title: '每日打卡',
    description: '每天完成打卡',
    type: 'checkin',
    target: 1,
    reward: { type: 'points', value: 10 },
    vipOnly: false,
    icon: '📅'
  },
  {
    id: 'streak_7',
    title: '连续7天打卡',
    description: '连续打卡7天',
    type: 'streak',
    target: 7,
    reward: { type: 'points', value: 50 },
    vipOnly: false,
    icon: '🔥'
  },
  {
    id: 'streak_30',
    title: '连续30天打卡',
    description: '连续打卡30天',
    type: 'streak',
    target: 30,
    reward: { type: 'badge', value: 1 },
    vipOnly: true,
    icon: '💪'
  },
  {
    id: 'upload_photo',
    title: '上传照片',
    description: '上传一张照片',
    type: 'upload',
    target: 1,
    reward: { type: 'points', value: 20 },
    vipOnly: false,
    icon: '📷'
  },
  {
    id: 'invite_friend',
    title: '邀请好友',
    description: '邀请一位好友加入',
    type: 'invite',
    target: 1,
    reward: { type: 'vip_days', value: 7 },
    vipOnly: false,
    icon: '👥'
  }
]

// 预定义成就列表
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_checkin',
    name: '初次打卡',
    description: '完成第一次打卡',
    icon: '🎯'
  },
  {
    id: 'streak_7',
    name: '坚持不懈',
    description: '连续打卡7天',
    icon: '🔥'
  },
  {
    id: 'streak_30',
    name: '习惯养成',
    description: '连续打卡30天',
    icon: '💪'
  },
  {
    id: 'streak_100',
    name: '百日英雄',
    description: '连续打卡100天',
    icon: '🏆'
  },
  {
    id: 'total_50',
    name: '打卡达人',
    description: '累计打卡50次',
    icon: '⭐'
  },
  {
    id: 'total_200',
    name: '打卡传奇',
    description: '累计打卡200次',
    icon: '👑'
  },
  {
    id: 'invite_5',
    name: '社交达人',
    description: '邀请5位好友',
    icon: '🤝'
  },
  {
    id: 'vip_member',
    name: 'VIP会员',
    description: '成为VIP会员',
    icon: '💎'
  }
]

/**
 * 获取用户可领取的任务奖励列表
 */
export async function getClaimableVipTasks(openid: string): Promise<Task[]> {
  try {
    const { data: userTasks } = await userTasksCol()
      .where({ _openid: openid, completed: true, claimed: false })
      .get()

    const claimableTasks: Task[] = []

    for (const userTask of userTasks) {
      const task = TASKS.find(t => t.id === userTask.taskId)
      if (task && task.vipOnly) {
        claimableTasks.push(task)
      }
    }

    return claimableTasks
  } catch (e) {
    console.error('getClaimableVipTasks error:', e)
    return []
  }
}

/**
 * 领取任务奖励
 */
export async function claimTaskReward(openid: string, taskId: string): Promise<boolean> {
  try {
    const { data } = await userTasksCol()
      .where({ _openid: openid, taskId: taskId, completed: true, claimed: false })
      .get()

    if (data.length === 0) {
      return false
    }

    await userTasksCol()
      .where({ _openid: openid, taskId: taskId })
      .update({
        data: {
          claimed: true,
          claimedAt: new Date()
        }
      })

    return true
  } catch (e) {
    console.error('claimTaskReward error:', e)
    return false
  }
}

/** 成就项（含解锁状态，用于页面展示） */
export interface AchievementWithUnlocked extends Achievement {
  unlocked: boolean
}

/**
 * 获取用户成就列表（从数据库读取已解锁记录并合并）
 */
export async function getUserAchievements(openid: string): Promise<AchievementWithUnlocked[]> {
  try {
    const { data: unlockedRecords } = await userAchievementsCol()
      .where({ _openid: openid })
      .get()
    const unlockedIds = new Set((unlockedRecords || []).map((r: { achievementId: string }) => r.achievementId))
    return ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: unlockedIds.has(a.id)
    }))
  } catch (e) {
    console.error('getUserAchievements error:', e)
    return []
  }
}

/**
 * 打卡业务埋点：打卡成功后同步日常任务进度并解锁符合条件的成就
 * 在 doCheckinWithContent 成功后调用（需在 syncCheckinStats 之后，以便 getAllStats 拿到最新连胜/累计天数）
 */
export async function syncTaskAndAchievementsAfterCheckin(
  openid: string,
  opts?: { hasPhoto?: boolean }
): Promise<void> {
  try {
    const { streak, totalDays } = await getAllStats(openid)

    // 更新日常任务进度
    await updateTaskProgress(openid, 'daily_checkin', 1)
    await updateTaskProgress(openid, 'streak_7', streak)
    await updateTaskProgress(openid, 'streak_30', streak)
    if (opts && opts.hasPhoto) {
      await updateTaskProgress(openid, 'upload_photo', 1)
    }

    // 按条件解锁成就（已解锁的 unlockAchievement 内会直接返回 true）
    if (totalDays >= 1) await unlockAchievement(openid, 'first_checkin')
    if (streak >= 7) await unlockAchievement(openid, 'streak_7')
    if (streak >= 30) await unlockAchievement(openid, 'streak_30')
    if (streak >= 100) await unlockAchievement(openid, 'streak_100')
    if (totalDays >= 50) await unlockAchievement(openid, 'total_50')
    if (totalDays >= 200) await unlockAchievement(openid, 'total_200')
  } catch (e) {
    console.warn('syncTaskAndAchievementsAfterCheckin error:', e)
  }
}

/**
 * 解锁用户成就
 */
export async function unlockAchievement(openid: string, achievementId: string): Promise<boolean> {
  try {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId)
    if (!achievement) {
      console.warn('成就不存在:', achievementId)
      return false
    }

    // 检查是否已经解锁
    const { data: existing } = await userAchievementsCol()
      .where({ _openid: openid, achievementId })
      .limit(1)
      .get()

    if (existing.length > 0) {
      // 已解锁，返回成功
      return true
    }

    // 添加成就记录到数据库
    await userAchievementsCol().add({
      data: {
        achievementId,
        unlockedAt: new Date(),
        createTime: new Date()
      }
    })

    return true
  } catch (e) {
    console.error('unlockAchievement error:', e)
    return false
  }
}

/**
 * 更新用户任务进度
 */
export async function updateTaskProgress(openid: string, taskId: string, progress: number): Promise<void> {
  try {
    const { data } = await userTasksCol()
      .where({ _openid: openid, taskId: taskId })
      .get()

    const task = TASKS.find(t => t.id === taskId)
    if (!task) return

    const completed = progress >= task.target

    if (data.length === 0) {
      // 创建新任务记录
      await userTasksCol().add({
        data: {
          taskId: taskId,
          current: progress,
          completed: completed,
          claimed: false,
          completedAt: completed ? new Date() : undefined,
          createTime: new Date(),
          updateTime: new Date()
        }
      })
    } else {
      // 更新现有记录
      await userTasksCol()
        .where({ _openid: openid, taskId: taskId })
        .update({
          data: {
            current: progress,
            completed: completed || data[0].completed,
            completedAt: completed && !data[0].completed ? new Date() : data[0].completedAt,
            updateTime: new Date()
          }
        })
    }
  } catch (e) {
    console.error('updateTaskProgress error:', e)
  }
}

/**
 * 获取用户所有任务进度
 */
export async function getUserTasks(openid: string): Promise<UserTaskProgress[]> {
  try {
    const { data } = await userTasksCol()
      .where({ _openid: openid })
      .get()
    return data
  } catch (e) {
    console.error('getUserTasks error:', e)
    return []
  }
}
