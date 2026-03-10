/**
 * 登录授权服务
 */
import { usersCol, checkinStatsCol } from './db'

export interface UserInfo {
  openid: string
  nickName: string
  avatarUrl: string
}

/** 用户记录类型（包含数据库字段） */
export interface UserRecord extends UserInfo {
  _id: string
  _openid?: string
  remarkName?: string
  createTime?: Date
  updateTime?: Date
  vipLevel?: number
  vipExpireTime?: Date
  subscribeRemindEnabled?: boolean
  remindTime?: string
}

/** 登录页路径（首页报道） */
export const LOGIN_PAGE = '/pages/index/index'

/**
 * 判断当前是否已登录（已获取 openid 且用户已完成报道，即存在 userInfo）
 */
export function isLoggedIn(): boolean {
  const app = getApp() as any
  const openid = wx.getStorageSync('openid') || (app.globalData && app.globalData.openid)
  const userInfo = wx.getStorageSync('userInfo')
  return !!(openid && userInfo && userInfo.nickName)
}

/**
 * 使用功能前调用：若未登录则提示并跳转登录页，登录后可返回原页面。
 * @param redirectUrl 登录成功后要跳转的页面路径（可选，不传则使用当前页面路径）
 * @returns 已登录时返回 openid，未登录时跳转登录页并返回 null
 */
export function requireLogin(redirectUrl?: string): string | null {
  if (isLoggedIn()) {
    const app = getApp() as any
    const openid = wx.getStorageSync('openid') || (app.globalData && app.globalData.openid)
    return openid || null
  }
  wx.showToast({ title: '请先登录', icon: 'none' })
  const url = redirectUrl || (() => {
    const pages = getCurrentPages()
    const cur = pages[pages.length - 1] as any
    return cur && cur.route ? '/' + cur.route : LOGIN_PAGE
  })()
  wx.setStorageSync('loginRedirectUrl', url)
  wx.switchTab({ url: LOGIN_PAGE })
  return null
}

/**
 * 异步版本：使用功能前调用，若未登录则跳转登录页。
 * @param redirectUrl 登录成功后要跳转的页面路径（可选）
 * @returns 已登录时返回 openid，未登录时返回 null（已跳转登录页）
 */
export async function requireLoginAsync(redirectUrl?: string): Promise<string | null> {
  return Promise.resolve(requireLogin(redirectUrl))
}

/** 云函数获取 openid */
export async function getOpenid(): Promise<string> {
  const res = await wx.cloud.callFunction({ name: 'login' })
  const data = res.result as { openid?: string }
  if (!data || !data.openid) throw new Error('获取 openid 失败')
  return data.openid
}

/** 获取或创建用户 */
export async function getOrCreateUser(openid: string, nickName: string, avatarUrl: string): Promise<UserRecord> {
  const col = usersCol()
  const { data: list } = await col.where({ _openid: openid } as any).get()
  const now = new Date()
  if (list.length > 0) {
    const existingUser = list[0] as UserRecord
    await col.doc(existingUser._id).update({
      data: { nickName, avatarUrl, updateTime: now }
    })
    return { ...existingUser, nickName, avatarUrl, updateTime: now }
  }
  // 兼容历史数据：旧 users 记录可能只有 openid 字段
  const { data: legacy } = await col.where({ openid } as any).limit(1).get()
  if (legacy.length > 0) {
    const legacyUser = legacy[0] as UserRecord
    await col.doc(legacyUser._id).update({
      data: { openid, nickName, avatarUrl, updateTime: now }
    })
    return { ...legacyUser, openid, nickName, avatarUrl, updateTime: now }
  }
  const { _id } = await col.add({
    data: { openid, nickName, avatarUrl, createTime: now, updateTime: now }
  })
  try {
    await checkinStatsCol().add({
      data: {
        _openid: openid,
        current_streak: 0,
        best_streak: 0,
        recorded_days: 0,
        slack_days: 0,
        createTime: now,
        updateTime: now
      }
    })
  } catch (e) {
    console.warn('创建打卡统计记录失败，不影响注册', e)
  }
  return { _id, openid, nickName, avatarUrl }
}

/** 更新用户信息 */
export async function updateUserInfo(openid: string, nickName: string, avatarUrl: string): Promise<UserRecord> {
  const col = usersCol()
  const { data: list } = await col.where({ _openid: openid } as any).get()
  const now = new Date()
  if (list.length === 0) {
    // 兼容历史数据：旧 users 记录可能只有 openid 字段
    const { data: legacy } = await col.where({ openid } as any).limit(1).get()
    if (legacy.length > 0) {
      const legacyUser = legacy[0] as UserRecord
      await col.doc(legacyUser._id).update({
        data: { openid, nickName, avatarUrl, updateTime: now }
      })
      return { ...legacyUser, openid, nickName, avatarUrl, updateTime: now }
    }
    const { _id } = await col.add({
      data: { openid, nickName, avatarUrl, createTime: now, updateTime: now }
    })
    try {
      await checkinStatsCol().add({
        data: {
          _openid: openid,
          current_streak: 0,
          best_streak: 0,
          recorded_days: 0,
          slack_days: 0,
          createTime: now,
          updateTime: now
        }
      })
    } catch (e) {
      console.warn('创建打卡统计记录失败，不影响注册', e)
    }
    return { _id, openid, nickName, avatarUrl }
  }
  const existingUser = list[0] as UserRecord
  await col.doc(existingUser._id).update({
    data: { nickName, avatarUrl, updateTime: now }
  })
  return { ...existingUser, nickName, avatarUrl, updateTime: now }
}

/** 更新备注名（仅自己可见） */
export async function updateRemarkName(openid: string, remarkName: string): Promise<UserRecord | null> {
  const col = usersCol()
  const { data: list } = await col.where({ _openid: openid } as any).get()
  const now = new Date()
  if (list.length > 0) {
    const existingUser = list[0] as UserRecord
    await col.doc(existingUser._id).update({
      data: { remarkName, updateTime: now }
    })
    return { ...existingUser, remarkName, updateTime: now }
  }
  // 兼容历史数据：旧 users 记录可能只有 openid 字段
  const { data: legacy } = await col.where({ openid } as any).limit(1).get()
  if (legacy.length > 0) {
    const legacyUser = legacy[0] as UserRecord
    await col.doc(legacyUser._id).update({
      data: { remarkName, updateTime: now }
    })
    return { ...legacyUser, remarkName, updateTime: now }
  }
  // 如果用户记录不存在，返回失败
  return null
}
