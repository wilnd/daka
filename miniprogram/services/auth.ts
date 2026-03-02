/**
 * 登录授权服务
 */
import { usersCol } from './db'

export interface UserInfo {
  openid: string
  nickName: string
  avatarUrl: string
}

/** 云函数获取 openid */
export async function getOpenid(): Promise<string> {
  const res = await wx.cloud.callFunction({ name: 'login' })
  const data = res.result as { openid?: string }
  if (!data?.openid) throw new Error('获取 openid 失败')
  return data.openid
}

/** 获取或创建用户 */
export async function getOrCreateUser(openid: string, nickName: string, avatarUrl: string) {
  const col = usersCol()
  const { data: list } = await col.where({ openid }).get()
  const now = new Date()
  if (list.length > 0) {
    await col.doc((list[0] as any)._id).update({
      data: { nickName, avatarUrl, updateTime: now }
    })
    return list[0] as any
  }
  const { _id } = await col.add({
    data: { openid, nickName, avatarUrl, createTime: now, updateTime: now }
  })
  return { _id, openid, nickName, avatarUrl }
}

/** 更新用户信息 */
export async function updateUserInfo(openid: string, nickName: string, avatarUrl: string) {
  const col = usersCol()
  const { data: list } = await col.where({ openid }).get()
  if (list.length === 0) {
    const now = new Date()
    const { _id } = await col.add({
      data: { openid, nickName, avatarUrl, createTime: now, updateTime: now }
    })
    return { _id, openid, nickName, avatarUrl }
  }
  const now = new Date()
  await col.doc((list[0] as any)._id).update({
    data: { nickName, avatarUrl, updateTime: now }
  })
  return { ...list[0], nickName, avatarUrl, updateTime: now }
}
