/**
 * 成长墙服务
 * 记录内容默认发布到成长墙，同一群组成员可见
 */
import { db, momentsCol, momentLikesCol, momentCommentsCol, membersCol, groupsCol } from './db'
import { getTodayStr } from './db'

export interface Moment {
  _id: string
  userId: string
  groupId: string
  checkinId: string
  content: MomentContent
  likeCount: number
  commentCount: number
  createTime: Date
}

export interface MomentContent {
  photos?: string[]
  text?: string
  categoryId?: string
  subCategoryId?: string
  score?: number
  tags?: string[]
}

export interface MomentLike {
  _id: string
  momentId: string
  userId: string
  createTime: Date
}

export interface MomentComment {
  _id: string
  momentId: string
  userId: string
  content: string
  createTime: Date
}

/** 打卡时自动发布到成长墙 */
export async function publishMomentFromCheckin(
  userId: string,
  groupId: string,
  checkinId: string,
  content: MomentContent
): Promise<string> {
  const now = new Date()
  const { _id } = await momentsCol().add({
    data: {
      userId,
      groupId,
      checkinId,
      content,
      likeCount: 0,
      commentCount: 0,
      createTime: now
    }
  })
  return _id
}

/** 获取用户在某个群组的成长墙列表 */
export async function getMomentsByGroup(
  groupId: string,
  limit = 20,
  lastId?: string
): Promise<Moment[]> {
  let query = momentsCol().where({ groupId }).orderBy('createTime', 'desc').limit(limit)
  
  if (lastId) {
    const lastMoment = await momentsCol().doc(lastId).get()
    if (lastMoment.data) {
      query = momentsCol()
        .where({ groupId, createTime: db.command.lt(lastMoment.data.createTime) })
        .orderBy('createTime', 'desc')
        .limit(limit)
    }
  }

  const { data } = await query.get()
  return (data || []) as Moment[]
}

/** 获取用户在所有群组的成长墙列表（首页展示） */
export async function getAllMomentsByUserId(
  userId: string,
  limit = 20,
  lastId?: string
): Promise<Moment[]> {
  // 获取用户加入的所有群组
  const { data: members } = await membersCol()
    .where({ userId, status: 'normal' })
    .get()
  
  if (members.length === 0) return []

  const groupIds = (members as any[]).map(m => m.groupId)
  
  let query = momentsCol()
    .where({ groupId: db.command.in(groupIds) })
    .orderBy('createTime', 'desc')
    .limit(limit)

  if (lastId) {
    const lastMoment = await momentsCol().doc(lastId).get()
    if (lastMoment.data) {
      query = momentsCol()
        .where({ 
          groupId: db.command.in(groupIds),
          createTime: db.command.lt(lastMoment.data.createTime)
        })
        .orderBy('createTime', 'desc')
        .limit(limit)
    }
  }

  const { data } = await query.get()
  return (data || []) as Moment[]
}

/** 获取单条成长墙详情 */
export async function getMomentById(momentId: string): Promise<Moment | null> {
  const { data } = await momentsCol().doc(momentId).get()
  return data as Moment | null
}

/** 点赞成长墙 */
export async function likeMoment(momentId: string, userId: string): Promise<{ ok: boolean; msg?: string }> {
  // 检查是否已点赞
  const { data: existing } = await momentLikesCol()
    .where({ momentId, userId })
    .get()

  if (existing.length > 0) {
    return { ok: false, msg: '已点赞' }
  }

  const now = new Date()
  await momentLikesCol().add({
    data: { momentId, userId, createTime: now }
  })

  // 使用原子操作更新点赞数，避免并发问题
  await momentsCol().doc(momentId).update({
    data: { likeCount: db.command.inc(1) }
  })

  return { ok: true }
}

/** 取消点赞 */
export async function unlikeMoment(momentId: string, userId: string): Promise<{ ok: boolean; msg?: string }> {
  const { data: existing } = await momentLikesCol()
    .where({ momentId, userId })
    .get()

  if (existing.length === 0) {
    return { ok: false, msg: '未点赞' }
  }

  await momentLikesCol().doc((existing[0] as any)._id).remove()

  // 使用原子操作更新点赞数，避免并发问题
  await momentsCol().doc(momentId).update({
    data: { likeCount: db.command.inc(-1) }
  })

  return { ok: true }
}

/** 获取用户对某条成长墙的点赞状态 */
export async function getLikeStatus(momentId: string, userId: string): Promise<boolean> {
  const { data } = await momentLikesCol()
    .where({ momentId, userId })
    .get()
  return data.length > 0
}

/** 获取成长墙的所有点赞用户 */
export async function getMomentLikes(momentId: string): Promise<MomentLike[]> {
  const { data } = await momentLikesCol()
    .where({ momentId })
    .orderBy('createTime', 'desc')
    .get()
  return data as MomentLike[]
}

/** 评论成长墙 */
export async function commentMoment(
  momentId: string,
  userId: string,
  content: string
): Promise<{ ok: boolean; msg?: string; commentId?: string }> {
  if (!content || content.trim().length === 0) {
    return { ok: false, msg: '评论内容不能为空' }
  }

  if (content.length > 200) {
    return { ok: false, msg: '评论内容不能超过200字' }
  }

  const now = new Date()
  const { _id } = await momentCommentsCol().add({
    data: { momentId, userId, content: content.trim(), createTime: now }
  })

  // 使用原子操作更新评论数，避免并发问题
  await momentsCol().doc(momentId).update({
    data: { commentCount: db.command.inc(1) }
  })

  return { ok: true, commentId: _id }
}

/** 删除评论（仅评论者本人可删除，且必须在群组中） */
export async function deleteComment(
  commentId: string,
  userId: string
): Promise<{ ok: boolean; msg?: string }> {
  const { data: comment } = await momentCommentsCol().doc(commentId).get()

  if (!comment) {
    return { ok: false, msg: '评论不存在' }
  }

  if ((comment as any).userId !== userId) {
    return { ok: false, msg: '只能删除自己的评论' }
  }

  // 获取moments的groupId来验证成员资格
  const { data: moment } = await momentsCol().doc((comment as any).momentId).get()
  if (!moment) {
    return { ok: false, msg: '成长墙不存在' }
  }

  // 验证用户是否仍在群组中（已退群用户不能删除评论）
  const { data: members } = await membersCol()
    .where({ groupId: (moment as any).groupId, userId, status: 'normal' })
    .limit(1)
    .get()

  if (members.length === 0) {
    return { ok: false, msg: '您已退出该群组，无法删除评论' }
  }

  await momentCommentsCol().doc(commentId).remove()

  // 使用原子操作更新评论数，避免并发问题
  await momentsCol().doc((comment as any).momentId).update({
    data: { commentCount: db.command.inc(-1) }
  })

  return { ok: true }
}

/** 获取成长墙的所有评论 */
export async function getMomentComments(momentId: string): Promise<MomentComment[]> {
  const { data } = await momentCommentsCol()
    .where({ momentId })
    .orderBy('createTime', 'asc')
    .get()
  return data as MomentComment[]
}

/** 删除成长墙（仅发布者本人可删除，且必须在群组中） */
export async function deleteMoment(
  momentId: string,
  userId: string
): Promise<{ ok: boolean; msg?: string }> {
  const { data: moment } = await momentsCol().doc(momentId).get()

  if (!moment) {
    return { ok: false, msg: '成长墙不存在' }
  }

  // 验证是否是发布者本人
  if ((moment as any).userId !== userId) {
    return { ok: false, msg: '只能删除自己的成长墙' }
  }

  // 验证用户是否仍在群组中（已退群用户不能删除）
  const { data: members } = await membersCol()
    .where({ groupId: (moment as any).groupId, userId, status: 'normal' })
    .limit(1)
    .get()

  if (members.length === 0) {
    return { ok: false, msg: '您已退出该群组，无法删除成长墙' }
  }

  // 批量删除相关点赞和评论（使用 where + remove 批量操作）
  await momentLikesCol().where({ momentId }).remove()
  await momentCommentsCol().where({ momentId }).remove()

  await momentsCol().doc(momentId).remove()

  return { ok: true }
}

/** 批量获取成长墙列表（带发布者信息） */
export interface MomentWithUser extends Moment {
  userInfo?: {
    nickName: string
    avatarUrl: string
  }
  isLiked?: boolean
}

export async function getMomentsWithUserInfo(
  groupId: string,
  userId: string,
  limit = 20,
  lastId?: string
): Promise<MomentWithUser[]> {
  const moments = await getMomentsByGroup(groupId, limit, lastId)
  if (moments.length === 0) return []

  // 获取发布者信息
  const userIds = [...new Set(moments.map(m => m.userId))]
  const { data: users } = await wx.cloud.database().collection('users')
    .where({ _id: db.command.in(userIds) })
    .get()

  const userMap = new Map()
  for (const user of users) {
    userMap.set(user._id, user)
  }

  // 获取当前用户对每条成长墙的点赞状态
  const result: MomentWithUser[] = []
  for (const moment of moments) {
    const isLiked = await getLikeStatus(moment._id, userId)
    const userInfo = userMap.get(moment.userId)
    result.push({
      ...moment,
      userInfo: userInfo ? {
        nickName: userInfo.nickName,
        avatarUrl: userInfo.avatarUrl
      } : undefined,
      isLiked
    })
  }

  return result
}
