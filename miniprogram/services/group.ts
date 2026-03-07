/**
 * 组织管理服务
 */
import { db, groupsCol, membersCol, usersCol, genInviteCode } from './db'

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

/** 创建组织 */
export async function createGroup(name: string, creatorId: string): Promise<Group> {
  const inviteCode = await genInviteCode()
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

/** 每个用户最多加入的组织数量 */
const MAX_GROUP_PER_USER = 20

/** 通过邀请码加入组织 */
export async function joinByInviteCode(inviteCode: string, userId: string): Promise<{ ok: boolean; msg?: string; group?: Group | null }> {
  const { data: list } = await groupsCol().where({ inviteCode }).get()
  if (list.length === 0) return { ok: false, msg: '邀请码无效', group: null }
  const group = list[0] as any
  if (group && group.inviteEnabled === false) return { ok: false, msg: '邀请已关闭', group: null }
  const { data: members } = await membersCol()
    .where({ groupId: group._id, userId, status: 'normal' })
    .get()
  if (members.length > 0) return { ok: false, msg: '你已在该组织中', group } // 已在组内

  // 检查用户已加入的组织数量
  const { data: myGroups } = await membersCol()
    .where({ userId, status: 'normal' })
    .get()
  if (myGroups.length >= MAX_GROUP_PER_USER) {
    return { ok: false, msg: `你最多只能加入${MAX_GROUP_PER_USER}个组织`, group: null }
  }

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
  return { ok: true, group }
}

/** 获取用户加入的组织列表 */
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

  // 批量获取所有群组的成员数量
  const groupMemberCounts: Record<string, number> = {}
  const { data: allMemberCounts } = await membersCol()
    .where({
      groupId: _.in(groupIds),
      status: 'normal'
    })
    .get()

  // 按 groupId 统计成员数量
  for (const member of (allMemberCounts || []) as any[]) {
    if (member.groupId) {
      groupMemberCounts[member.groupId] = (groupMemberCounts[member.groupId] || 0) + 1
    }
  }

  const result: (Group & { memberCount?: number })[] = []
  for (const g of groups as any[]) {
    result.push({ ...g, memberCount: groupMemberCounts[g._id] || 0 })
  }
  return result
}

/** 获取组织详情 */
export async function getGroupById(groupId: string): Promise<Group | null> {
  const { data } = await groupsCol().doc(groupId).get()
  return data as Group | null
}

/** 获取组织成员（含用户信息需额外查 users） */
export async function getGroupMembers(groupId: string): Promise<Member[]> {
  const { data } = await membersCol()
    .where({ groupId, status: 'normal' })
    .orderBy('joinTime', 'asc')
    .get()
  return data as Member[]
}

/** 获取组织成员（含用户昵称和头像） */
export async function getGroupMembersWithUserInfo(groupId: string): Promise<(Member & { nickName?: string; avatarUrl?: string })[]> {
  const members = await getGroupMembers(groupId)
  if (members.length === 0) return []

  // 批量获取用户信息
  const userIds = members.map(m => m.userId).filter(Boolean)
  if (userIds.length === 0) return members

  const _ = db.command
  const { data: users } = await usersCol()
    .where({ openid: _.in(userIds) })
    .get()

  const userMap = new Map((users || []).map((u: any) => [u.openid, u]))

  // 合并用户信息
  return members.map(m => {
    const userInfo = userMap.get(m.userId)
    return {
      ...m,
      nickName: userInfo && userInfo.nickName ? userInfo.nickName : '未知用户',
      avatarUrl: userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : ''
    }
  })
}

/** 移除成员（仅组长可操作） */
export async function removeMember(memberId: string, adminId: string): Promise<{ ok: boolean; msg?: string }> {
  const { data: member } = await membersCol().doc(memberId).get()
  if (!member) return { ok: false, msg: '成员不存在' }
  if (member.userId === adminId) return { ok: false, msg: '不能移除自己' }

  const { data: adminMember } = await membersCol()
    .where({ groupId: member.groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能移除成员' }

  await membersCol().doc(memberId).update({
    data: { status: 'removed', updateTime: new Date() }
  })
  return { ok: true }
}

/** 退出组织 */
export async function quitGroup(memberId: string, userId: string): Promise<{ ok: boolean; msg?: string }> {
  const { data: member } = await membersCol().doc(memberId).get()
  if (!member) return { ok: false, msg: '成员不存在' }
  if (member.userId !== userId) return { ok: false, msg: '只能退出自己的组织' }

  const { data: members } = await membersCol()
    .where({ groupId: member.groupId, status: 'normal' })
    .get()
  const adminCount = members.filter((m: any) => m.role === 'admin').length

  if (member.role === 'admin' && adminCount === 1) {
    const normalMembers = members.filter((m: any) => m.role !== 'admin')
    if (normalMembers.length > 0) {
      return { ok: false, msg: '请先转让组长身份再退出组织' }
    }
  }

  await membersCol().doc(memberId).update({
    data: { status: 'quit', updateTime: new Date() }
  })
  return { ok: true }
}

/** 转让组长 */
export async function transferAdmin(memberId: string, adminId: string): Promise<{ ok: boolean; msg?: string }> {
  const { data: targetMember } = await membersCol().doc(memberId).get()
  if (!targetMember) return { ok: false, msg: '成员不存在' }

  const { data: adminMember } = await membersCol()
    .where({ groupId: targetMember.groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能转让身份' }

  const now = new Date()
  await membersCol().doc((adminMember[0] as any)._id).update({ data: { role: 'member', updateTime: now } })
  await membersCol().doc(memberId).update({ data: { role: 'admin', updateTime: now } })
  return { ok: true }
}

/** 更新组织邀请码（自定义） */
export async function updateInviteCode(groupId: string, adminId: string, newCode: string): Promise<{ ok: boolean; msg?: string }> {
  // 验证权限
  const { data: adminMember } = await membersCol()
    .where({ groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能修改邀请码' }

  // 验证邀请码格式
  const code = newCode.trim().toUpperCase()
  if (code.length < 4 || code.length > 10) {
    return { ok: false, msg: '邀请码长度4-10位' }
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    return { ok: false, msg: '邀请码只能包含字母和数字' }
  }

  // 检查邀请码是否已被其他组织使用
  const { data: existing } = await groupsCol()
    .where({ inviteCode: code })
    .get()
  if (existing.length > 0 && existing[0]._id !== groupId) {
    return { ok: false, msg: '该邀请码已被使用' }
  }

  await groupsCol().doc(groupId).update({
    data: { inviteCode: code, updateTime: new Date() }
  })
  return { ok: true }
}

/** 更新组织信息 */
export async function updateGroup(groupId: string, adminId: string, data: { inviteEnabled?: boolean }): Promise<{ ok: boolean; msg?: string }> {
  // 验证权限
  const { data: adminMember } = await membersCol()
    .where({ groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能修改组织设置' }

  const updateData: any = { updateTime: new Date() }
  if (data.inviteEnabled !== undefined) {
    updateData.inviteEnabled = data.inviteEnabled
  }

  await groupsCol().doc(groupId).update({ data: updateData })
  return { ok: true }
}

/** 重新生成组织邀请码 */
export async function regenerateInviteCode(groupId: string, adminId: string): Promise<{ ok: boolean; msg?: string; newCode?: string }> {
  // 验证权限
  const { data: adminMember } = await membersCol()
    .where({ groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能重新生成邀请码' }

  // 生成新邀请码
  const newCode = await genInviteCode()

  await groupsCol().doc(groupId).update({
    data: { inviteCode: newCode, updateTime: new Date() }
  })
  return { ok: true, newCode }
}

/** 解散组织（仅组长可操作，解散后所有成员自动退组） */
export async function dissolveGroup(groupId: string, adminId: string): Promise<{ ok: boolean; msg?: string }> {
  // 验证权限：必须是组长
  const { data: adminMember } = await membersCol()
    .where({ groupId, userId: adminId, role: 'admin', status: 'normal' })
    .get()
  if (adminMember.length === 0) return { ok: false, msg: '只有组长才能解散组织' }

  // 批量更新所有成员状态为 quit（使用 where + update 批量操作）
  await membersCol()
    .where({ groupId, status: 'normal' })
    .update({
      data: { status: 'quit', updateTime: new Date() }
    })

  // 更新组织状态为已解散
  await groupsCol().doc(groupId).update({
    data: { status: 'dissolved', updateTime: new Date() }
  })

  return { ok: true }
}
