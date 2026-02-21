/**
 * 小组管理服务
 */
import { db, groupsCol, membersCol, genInviteCode } from './db'

export interface Group {
  _id: string
  name: string
  inviteCode: string
  creatorId: string
  createTime: Date
  updateTime: Date
}

export interface Member {
  _id: string
  groupId: string
  userId: string
  role: 'admin' | 'member'
  status: 'normal' | 'removed' | 'quit'
  joinTime: Date
}

/** 创建小组 */
export async function createGroup(name: string, creatorId: string): Promise<Group> {
  const inviteCode = genInviteCode()
  const now = new Date()
  const { _id } = await groupsCol().add({
    data: { name, inviteCode, creatorId, createTime: now, updateTime: now }
  })
  await membersCol().add({
    data: {
      groupId: _id,
      userId: creatorId,
      role: 'admin',
      status: 'normal',
      joinTime: now,
      updateTime: now
    }
  })
  return { _id, name, inviteCode, creatorId, createTime: now, updateTime: now } as Group
}

/** 通过邀请码加入小组 */
export async function joinByInviteCode(inviteCode: string, userId: string): Promise<Group | null> {
  const { data: list } = await groupsCol().where({ inviteCode }).get()
  if (list.length === 0) return null
  const group = list[0] as any
  const { data: members } = await membersCol()
    .where({ groupId: group._id, userId, status: 'normal' })
    .get()
  if (members.length > 0) return group // 已在组内
  const now = new Date()
  await membersCol().add({
    data: {
      groupId: group._id,
      userId,
      role: 'member',
      status: 'normal',
      joinTime: now,
      updateTime: now
    }
  })
  return group
}

/** 获取用户加入的小组列表 */
export async function getMyGroups(userId: string): Promise<(Group & { memberCount?: number })[]> {
  const { data: myMembers } = await membersCol()
    .where({ userId, status: 'normal' })
    .get()
  if (myMembers.length === 0) return []
  const groupIds = (myMembers as any[]).map(m => m.groupId)
  const _ = db.command
  const { data: groups } = await groupsCol()
    .where({ _id: _.in(groupIds) })
    .get()
  const result: (Group & { memberCount?: number })[] = []
  for (const g of groups as any[]) {
    const { total } = await membersCol().where({ groupId: g._id, status: 'normal' }).count()
    result.push({ ...g, memberCount: total })
  }
  return result
}

/** 获取小组详情 */
export async function getGroupById(groupId: string): Promise<Group | null> {
  const { data } = await groupsCol().doc(groupId).get()
  return data as Group | null
}

/** 获取小组成员（含用户信息需额外查 users） */
export async function getGroupMembers(groupId: string): Promise<Member[]> {
  const { data } = await membersCol()
    .where({ groupId, status: 'normal' })
    .orderBy('joinTime', 'asc')
    .get()
  return data as Member[]
}
