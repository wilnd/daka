/**
 * 组织管理服务
 */
import { db, groupsCol, membersCol, usersCol, genInviteCode } from './db'
import { updateTaskProgress, unlockAchievement } from './task'

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
  openid: string
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
      openid: creatorId,
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

/**
 * 通过邀请码加入组织
 * @param inviterOpenid 邀请人 openid（从分享链接带入），用于统计邀请人数并更新任务/成就
 */
export async function joinByInviteCode(
  inviteCode: string,
  openid: string,
  inviterOpenid?: string
): Promise<{ ok: boolean; msg?: string; group?: Group | null }> {
  const { data: list } = await groupsCol().where({ inviteCode }).get()
  if (list.length === 0) return { ok: false, msg: '邀请码无效', group: null }
  const group = list[0] as any
  if (group && group.inviteEnabled === false) return { ok: false, msg: '邀请已关闭', group: null }
  const { data: members } = await membersCol()
    .where({ groupId: group._id, _openid: openid, status: 'normal' } as any)
    .get()
  if (members.length > 0) return { ok: false, msg: '你已在该组织中', group } // 已在组内

  // 检查用户已加入的组织数量
  const { data: myGroups } = await membersCol()
    .where({ _openid: openid, status: 'normal' } as any)
    .get()
  if (myGroups.length >= MAX_GROUP_PER_USER) {
    return { ok: false, msg: `你最多只能加入${MAX_GROUP_PER_USER}个组织`, group: null }
  }

  const now = new Date()
  await membersCol().add({
    data: {
      groupId: group._id,
      _openid: openid,
      role: 'member',
      status: 'normal',
      joinTime: now,
      updateTime: now
    }
  })

  // 邀请业务埋点：统计邀请人并更新「邀请好友」任务与「邀请5位好友」成就
  if (inviterOpenid && inviterOpenid !== openid) {
    try {
      const { data: inviterList } = await usersCol().where({ _openid: inviterOpenid }).get()
      if (inviterList && inviterList.length > 0) {
        const inviter = inviterList[0] as any
        const newCount = (inviter.invitedFriends || 0) + 1
        await usersCol().where({ _openid: inviterOpenid }).update({
          data: { invitedFriends: newCount, updateTime: now }
        })
        await updateTaskProgress(inviterOpenid, 'invite_friend', newCount)
        if (newCount >= 5) await unlockAchievement(inviterOpenid, 'invite_5')
      }
    } catch (e) {
      console.warn('邀请统计/任务成就更新失败', e)
    }
  }
  return { ok: true, group }
}

/** 根据邀请码查询组织（仅读，用于加入弹窗展示组织名，不展示邀请人） */
export async function getGroupByInviteCode(inviteCode: string): Promise<Group | null> {
  if (!inviteCode || typeof inviteCode !== 'string') return null
  const code = inviteCode.trim().toUpperCase()
  if (!code) return null
  const { data: list } = await groupsCol().where({ inviteCode: code }).get()
  if (!list || list.length === 0) return null
  return list[0] as Group
}

/** 获取用户加入的组织列表 */
export async function getMyGroups(openid: string): Promise<(Group & { memberCount?: number })[]> {
  const _ = db.command

  const res = await membersCol()
    .where({ _openid: openid, status: 'normal' })
    .get()
  const myMembers: any[] = res.data || []

  if (myMembers.length === 0) return []

  const groupIds = (myMembers as any[]).map(m => m.groupId)
  const { data: groups } = await groupsCol()
    .where({ _id: _.in(groupIds) })
    .get()

  const groupMemberCounts: Record<string, number> = {}
  const { data: allMemberCounts } = await membersCol()
    .where({
      groupId: _.in(groupIds),
      status: 'normal'
    })
    .get()

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

/** 小组详情（含成员列表）通过云函数获取，绕过客户端 members 权限限制 */
export interface GroupDetailResult {
  group: Group & { inviteEnabled?: boolean }
  members: Array<Member & { nickName?: string; avatarUrl?: string; checked?: boolean; checkinDays?: number; isSelf?: boolean }>
  rankMembers: Array<Member & { nickName?: string; avatarUrl?: string; checkinDays?: number; isSelf?: boolean }>
  isAdmin: boolean
  isCreator: boolean
  inviteEnabled: boolean
}

export async function callGetGroupDetail(groupId: string): Promise<{ success: boolean; data?: GroupDetailResult; error?: string }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'getGroupDetail', groupId }
    })
    const result = res.result as any
    if (result && result.success && result.data) {
      return { success: true, data: result.data }
    }
    return { success: false, error: (result && result.error) || '获取失败' }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' }
  }
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
  const userIds = members.map((m: any) => m._openid || m.openid).filter(Boolean)
  if (userIds.length === 0) return members

  const _ = db.command
  const { data: users } = await usersCol()
    .where({ _openid: _.in(userIds) } as any)
    .get()

  const userMap = new Map((users || []).map((u: any) => [(u._openid || u.openid), u]))

  // 合并用户信息
  return members.map((m: any) => {
    const userInfo = userMap.get(m._openid || m.openid)
    return {
      ...m,
      nickName: userInfo && userInfo.nickName ? userInfo.nickName : '未知用户',
      avatarUrl: userInfo && userInfo.avatarUrl ? userInfo.avatarUrl : ''
    }
  })
}

/** 移除成员（仅组长可操作，通过云函数写库以绕过客户端 members 写权限限制） */
export async function removeMember(memberId: string, adminId: string): Promise<{ ok: boolean; msg?: string }> {
  try {
    const res = await wx.cloud.callFunction({
      name: 'scoreCheckin',
      data: { action: 'removeMember', memberId }
    })
    const result = res.result as { ok?: boolean; msg?: string }
    if (result && result.ok) return { ok: true }
    return { ok: false, msg: (result && result.msg) || '移除失败' }
  } catch (e: any) {
    return { ok: false, msg: e.message || '移除失败' }
  }
}

/** 退出组织 */
export async function quitGroup(memberId: string, openid: string): Promise<{ ok: boolean; msg?: string }> {
  const { data: member } = await membersCol().doc(memberId).get()
  if (!member) return { ok: false, msg: '成员不存在' }
  if ((member as any)._openid !== openid && member.openid !== openid) return { ok: false, msg: '只能退出自己的组织' }

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
    .where({ groupId: targetMember.groupId, _openid: adminId, role: 'admin', status: 'normal' } as any)
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
    .where({ groupId, _openid: adminId, role: 'admin', status: 'normal' } as any)
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
    .where({ groupId, _openid: adminId, role: 'admin', status: 'normal' } as any)
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
    .where({ groupId, _openid: adminId, role: 'admin', status: 'normal' } as any)
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
    .where({ groupId, _openid: adminId, role: 'admin', status: 'normal' } as any)
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
