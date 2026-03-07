/**
 * 云数据库服务
 */
export const db = wx.cloud.database()

export const usersCol = () => db.collection('users')
export const groupsCol = () => db.collection('groups')
export const membersCol = () => db.collection('members')
export const checkinsCol = () => db.collection('checkins')
export const makeupQuotaCol = () => db.collection('makeupQuota')
export const momentsCol = () => db.collection('moments')
export const momentLikesCol = () => db.collection('momentLikes')
export const momentCommentsCol = () => db.collection('momentComments')
export const userTasksCol = () => db.collection('userTasks')  // 用户任务进度
export const goalsCol = () => db.collection('goals')          // 用户目标
export const goalRecordsCol = () => db.collection('goalRecords')  // 目标记录
/**
 * suggestions(用户意见反馈)表结构：
 * {
 *   _id: string
 *   openid: string (索引) - 提意见的用户
 *   content: string - 意见内容
 *   type: string - 意见类型: bug/feature/feedback/vip_request
 *   status: string - 状态: pending/approved/rejected
 *   adminId: string - 处理的管理员openid
 *   adminRemark: string - 管理员备注
 *   vipDays: number - 批准增加的VIP天数（如果有）
 *   contact: string - 联系方式（可选）
 *   processedAt: Date - 处理时间
 *   createTime: Date
 *   updateTime: Date
 * }
 */

export const userTagsCol = () => db.collection('userRewardPenaltyTags')  // 用户自定义奖励/惩罚标签
export const userAchievementsCol = () => db.collection('userAchievements')  // 用户成就
export const suggestionsCol = () => db.collection('suggestions')  // 用户意见反馈

/**
 * 用户表(vip)字段说明：
 * - vipLevel: VIP等级 (0=普通, 1=青铜, 2=白银, 3=黄金)
 * - vipExpireTime: VIP过期时间
 * - vipStartTime: VIP开始时间
 * - totalVipDays: 累计VIP天数
 * - createdGroups: 创建的群组数量
 * - invitedFriends: 邀请的好友数量
 */

/**
 * userTasks(用户任务)表结构：
 * {
 *   _id: string
 *   openid: string (索引)
 *   taskId: string (任务ID)
 *   current: number (当前进度)
 *   completed: boolean (是否完成)
 *   claimed: boolean (是否已领取)
 *   completedAt: Date (完成时间)
 *   claimedAt: Date (领取时间)
 *   createTime: Date
 *   updateTime: Date
 * }
 */

/**
 * goals(用户目标)表结构：
 * {
 *   _id: string
 *   openid: string (索引)
 *   type: string (目标类型: sports/study/life)
 *   period: string (周期: daily/weekly/monthly)
 *   target: number (目标值)
 *   title: string (标题)
 *   description: string (描述)
 *   startDate: string (开始日期 YYYY-MM-DD)
 *   endDate: string (结束日期 YYYY-MM-DD)
 *   // 确认人相关
 *   confirmor: {  // 确认人信息（可选）
 *     openid: string,  // 确认人openid
 *     nickname: string,  // 确认人昵称
 *     avatarUrl?: string,  // 确认人头像
 *     confirmStatus: string,  // 确认状态: none/pending/confirmed/rejected
 *     confirmTime?: Date,  // 确认时间
 *     confirmRemark?: string  // 确认备注
 *   }
 *   needConfirmorVerify: boolean,  // 是否需要确认人验收才能完成
 *   // 常用标签
 *   commonRewardTags: [  // 常用奖励标签
 *     { id: string, name: string, type: string, value: number, isCustom?: boolean }
 *   ]
 *   commonPenaltyTags: [  // 常用惩罚标签
 *     { id: string, name: string, type: string, value: number, isCustom?: boolean }
 *   ]
 *   reward: { type, value, name } (奖励配置)
 *   penalty: { type, value, name } (惩罚配置)
 *   createdAt: Date
 *   updatedAt: Date
 * }
 */

/**
 * goalRecords(目标记录)表结构：
 * {
 *   _id: string
 *   goalId: string (目标ID)
 *   openid: string
 *   period: string
 *   current: number
 *   processed: boolean (是否已处理奖励/惩罚)
 *   processedAt: Date
 *   createTime: Date
 * }
 */

/** 打卡提醒订阅配置 - 使用微信订阅消息 */
export const SUBSCRIBE_TEMPLATE_ID = 'Onu-1essigRNJuZ8K0a_WdBq7qR5ktHKxST6F0fCDuQ' // 打卡提醒模板ID

/** 生成唯一邀请码 6 位（避免重复） */
export async function genInviteCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const maxAttempts = 10 // 最多尝试10次

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }

    // 检查邀请码是否已存在
    const { data: existing } = await groupsCol().where({ inviteCode: code }).get()
    if (existing.length === 0) {
      return code
    }
  }

  // 尝试多次仍冲突，使用时间戳+随机字符作为后备
  const timestamp = Date.now().toString(36).toUpperCase()
  const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase()
  return (timestamp + randomSuffix).slice(-6).toUpperCase()
}

/** 获取今日日期 YYYY-MM-DD */
export function getTodayStr(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 获取某天往前 n 天的日期 */
export function getDateBefore(todayStr: string, days: number): string {
  const d = new Date(todayStr)
  d.setDate(d.getDate() - days)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 获取当前月份 YYYY-MM */
export function getCurrentMonth(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 从服务器获取当前月份（每次都实时获取，不缓存） */
export async function getServerMonth(): Promise<string> {
  try {
    const res = await wx.cloud.callFunction({ name: 'getServerTime' })
    const data = res.result as { currentMonth: string }
    return data.currentMonth
  } catch (e) {
    console.warn('getServerMonth failed, fallback to local', e)
    return getCurrentMonth()
  }
}
