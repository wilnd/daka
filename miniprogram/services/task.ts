/**
 * 任务服务
 */
import { userTasksCol, userAchievementsCol, db } from './db'

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

/**
 * 获取用户成就列表
 */
export async function getUserAchievements(openid: string): Promise<Achievement[]> {
  try {
    // 这里应该从数据库获取用户已解锁的成就
    // 目前返回空列表，实际应该查询用户的成就记录
    // 简化实现：返回所有成就，解锁状态由前端根据条件判断
    const achievements = ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: false // 默认未解锁，实际应该从数据库查询
    }))
    return achievements
  } catch (e) {
    console.error('getUserAchievements error:', e)
    return []
  }
}

/**
 * 解锁用户成就
 */
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
