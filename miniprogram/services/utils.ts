// utils.ts - 公共工具函数

import { db, membersCol } from './db'
import { RankUser } from './stats'

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

export { defaultAvatar }

/** 本地缓存的群组列表 key */
const GROUPS_CACHE_KEY = 'cachedGroups'

/** 从本地缓存获取群组列表 */
export function getCachedGroups(): any[] {
  try {
    const cached = wx.getStorageSync(GROUPS_CACHE_KEY)
    return cached || []
  } catch {
    return []
  }
}

/** 保存群组列表到本地缓存 */
export function setCachedGroups(groups: any[]): void {
  wx.setStorageSync(GROUPS_CACHE_KEY, groups)
}

/** 将十六进制颜色转换为 RGB 格式 */
export function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (result) {
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
  }
  return '26, 188, 156'
}

/** 将云存储 fileID 转换为临时可访问的 HTTP URL */
export async function convertCloudUrl(fileId: string): Promise<string> {
  if (!fileId) return defaultAvatar
  if (!fileId.startsWith('cloud://')) return fileId
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList[0]) {
      if (res.fileList[0].status !== 0) {
        console.warn('云存储文件获取失败:', res.fileList[0].errMsg || '未知错误')
        return defaultAvatar
      }
      return res.fileList[0].tempFileURL || defaultAvatar
    }
    return defaultAvatar
  } catch (e) {
    console.error('convertCloudUrl error:', e)
    return defaultAvatar
  }
}

/** 批量转换云存储 URL（带缓存） */
const urlCache = new Map<string, string>()
const URL_CACHE_MAX = 100

export async function convertCloudUrls(fileIds: string[]): Promise<string[]> {
  if (!fileIds || fileIds.length === 0) return []

  const results: string[] = []
  const toFetch: { id: string; index: number }[] = []

  // 先从缓存获取
  for (let i = 0; i < fileIds.length; i++) {
    const fileId = fileIds[i]
    if (!fileId) {
      results[i] = defaultAvatar
      continue
    }
    if (!fileId.startsWith('cloud://')) {
      results[i] = fileId
      continue
    }
    const cached = urlCache.get(fileId)
    if (cached) {
      results[i] = cached
    } else {
      toFetch.push({ id: fileId, index: i })
    }
  }

  if (toFetch.length > 0) {
    try {
      const fileList = toFetch.map(item => item.id)
      const res = await wx.cloud.getTempFileURL({ fileList })

      for (const item of res.fileList || []) {
        if (item.status === 0 && item.fileID && item.tempFileURL) {
          const target = toFetch.find(t => t.id === item.fileID)
          if (target) {
            const url = item.tempFileURL
            results[target.index] = url

            // 添加到缓存
            if (urlCache.size >= URL_CACHE_MAX) {
              const firstKey = urlCache.keys().next().value
              urlCache.delete(firstKey)
            }
            urlCache.set(item.fileID, url)
          }
        }
      }
    } catch (e) {
      console.error('convertCloudUrls error:', e)
    }
  }

  return results
}

/** 批量转换排行榜头像 URL */
export async function convertRankAvatarUrls(rankList: RankUser[]): Promise<RankUser[]> {
  if (!rankList || rankList.length === 0) return []

  const cloudUrls: { url: string; index: number }[] = []
  for (let i = 0; i < rankList.length; i++) {
    const url = rankList[i].avatarUrl
    if (url && url.startsWith('cloud://')) {
      cloudUrls.push({ url, index: i })
    }
  }
  if (cloudUrls.length === 0) return rankList

  try {
    const res = await wx.cloud.getTempFileURL({ fileList: cloudUrls.map(u => u.url) })
    for (const item of res.fileList || []) {
      if (item.status === 0 && item.fileID && item.tempFileURL) {
        const target = cloudUrls.find(u => u.url === item.fileID)
        if (target) {
          rankList[target.index].avatarUrl = item.tempFileURL
        }
      }
    }
  } catch (e) {
    console.warn('convertRankAvatarUrls failed:', e)
  }
  return rankList
}

/** 上传头像到云存储（如果是本地临时路径） */
export async function uploadAvatarIfNeeded(avatarUrl: string, openid: string): Promise<string> {
  // 如果已经是云存储路径，直接返回
  if (!avatarUrl || avatarUrl.startsWith('cloud://')) {
    return avatarUrl
  }
  // 如果是本地临时路径，需要上传到云存储
  if (avatarUrl.startsWith('/tmp/') || avatarUrl.startsWith('http://tmp/') || avatarUrl.startsWith('wxfile://')) {
    try {
      const cloudPath = `avatars/${openid}/${Date.now()}.jpg`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: avatarUrl,
      })
      return uploadRes.fileID
    } catch (e) {
      console.error('头像上传失败', e)
      return avatarUrl
    }
  }
  // 非临时路径，直接返回
  return avatarUrl
}

/** 格式化日期 */
export function formatDate(date: Date | string | number, format = 'YYYY-MM-DD'): string {
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''

  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

/** 格式化时间戳为友好显示 */
export function formatTimeAgo(date: Date | string | number): string {
  const now = Date.now()
  const past = new Date(date).getTime()
  const diff = now - past

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return '刚刚'
}

/** 防抖函数 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay = 300
): (...args: Parameters<T>) => void {
  let timer: number | null = null
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = wx.setTimeout(() => {
      fn.apply(this, args)
    }, delay)
  }
}

/** 节流函数 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay = 300
): (...args: Parameters<T>) => void {
  let lastTime = 0
  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now()
    if (now - lastTime >= delay) {
      lastTime = now
      fn.apply(this, args)
    }
  }
}

/** 验证用户是否在群组中 */
export async function verifyUserInGroup(userId: string, groupId: string): Promise<boolean> {
  try {
    const { data } = await membersCol()
      .where({ userId, groupId, status: 'normal' })
      .limit(1)
      .get()
    return data.length > 0
  } catch {
    return false
  }
}

/** 生成确认码（6位数字） */
export function generateConfirmCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/** 生成UUID（用于确认人ID） */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
