const app = getApp<IAppOption>()

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 将云存储 fileID 转换为临时可访问的 HTTP URL */
async function convertCloudUrl(fileId: string): Promise<string> {
  if (!fileId) return defaultAvatar
  if (!fileId.startsWith('cloud://')) return fileId
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList[0]) {
      // 检查是否有错误
      if (res.fileList[0].status !== 0) {
        console.warn('云存储文件获取失败:', res.fileList[0].errMsg || '未知错误')
        return defaultAvatar  // 返回默认头像
      }
      if (res.fileList[0].tempFileURL) {
        return res.fileList[0].tempFileURL
      }
    }
  } catch (e) {
    console.warn('转换云存储URL失败', e)
  }
  return defaultAvatar  // 转换失败返回默认头像
}

/** 批量转换云存储 URL */
async function convertCloudUrls(fileIds: string[]): Promise<string[]> {
  if (!fileIds || fileIds.length === 0) return []
  const validIds = fileIds.filter(id => id && id.startsWith('cloud://'))
  if (validIds.length === 0) return fileIds
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: validIds })
    const urlMap = new Map<string, string>()
    for (const item of res.fileList || []) {
      // 只处理成功的文件，失败的返回默认头像
      if (item.status === 0 && item.fileID && item.tempFileURL) {
        urlMap.set(item.fileID, item.tempFileURL)
      }
    }
    return fileIds.map(id => urlMap.get(id) || defaultAvatar)
  } catch (e) {
    console.warn('批量转换云存储URL失败', e)
    return fileIds.map(() => defaultAvatar)
  }
}

interface MomentItem {
  _id: string
  openid: string
  groupId: string
  content: {
    photos?: string[]
    text?: string
    categoryId?: string
    subCategoryId?: string
    score?: number
    tags?: string[]
  }
  likeCount: number
  commentCount: number
  createTime: Date
  comments?: any[]
}

interface UserInfo {
  _id: string
  nickName: string
  avatarUrl: string
}

Page({
  data: {
    openid: '',
    userInfo: null as UserInfo | null,
    defaultAvatar,
    moments: [] as MomentItem[],
    loading: false,
    refreshing: false,
    loadingMore: false,
    noMore: false,
    // 动态主题色
    themeColor: '#1ABC9C',
  },

  onLoad(options: any) {
    // 同步主题色
    this.setData({
      themeColor: '#1ABC9C'
    })
    const openid = options.openid || ''
    const nickName = options.nickName || ''
    let avatarUrl = (options.avatarUrl || defaultAvatar)

    // URL 解码
    try { avatarUrl = decodeURIComponent(avatarUrl) } catch {}

    // 如果不是有效的网络头像，使用默认头像
    if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
      avatarUrl = defaultAvatar
    }

    if (openid) {
      this.setData({
        openid,
        userInfo: {
          _id: '',
          nickName,
          avatarUrl
        }
      })
      this.loadUserInfo(openid)
      this.loadMoments()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    }
  },

  onShow() {
    // 同步主题色
    this.setData({
      themeColor: '#1ABC9C'
    })
    if (this.data.openid) {
      this.loadMoments()
    }
  },

  onPullDownRefresh() {
    this.refreshMoments()
  },

  onReachBottom() {
    this.loadMoreMoments()
  },

  async loadUserInfo(openid: string) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserInfo',
          _openid: openid
        }
      })

      const result = res.result as any
      if (result.success && result.data) {
        let avatarUrl = result.data.avatarUrl || defaultAvatar
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
        } else if (avatarUrl.startsWith('cloud://')) {
          // 转换云存储 URL 为临时 HTTP URL
          avatarUrl = await convertCloudUrl(avatarUrl)
        }
        this.setData({
          userInfo: { ...result.data, avatarUrl }
        })
      }
    } catch (e) {
      console.error('获取用户信息失败', e)
    }
  },

  async loadMoments() {
    const { openid, loading, noMore } = this.data
    if (!openid) return
    if (loading || noMore) return

    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserMoments',
          _openid: openid,
          limit: 20
        }
      })

      const result = res.result as any
      if (result.success) {
        // 转换云存储 URL 为临时 HTTP URL
        const momentsData = result.data || []
        for (const moment of momentsData) {
          // 转换成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos = await convertCloudUrls(moment.content.photos)
          }
          // 转换评论中的头像
          if (moment.comments && moment.comments.length > 0) {
            for (const comment of moment.comments) {
              if (comment.userInfo && comment.userInfo.avatarUrl) {
                comment.userInfo.avatarUrl = await convertCloudUrl(comment.userInfo.avatarUrl)
              }
            }
          }
        }

        // 确保每个moment的comments和photos字段都有默认值
        momentsData.forEach((moment) => {
          if (!moment.comments) {
            moment.comments = []
          }
          if (moment.content && !moment.content.photos) {
            moment.content.photos = []
          }
        })

        this.setData({
          moments: momentsData,
          loading: false,
          noMore: momentsData.length < 20
        })
      } else {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (e) {
      console.error('加载成长墙失败', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async refreshMoments() {
    this.setData({ refreshing: true, noMore: false })
    await this.loadMoments()
    this.setData({ refreshing: false })
    wx.stopPullDownRefresh()
  },

  async loadMoreMoments() {
    const { moments, loadingMore, noMore, openid } = this.data
    if (loadingMore || noMore || moments.length === 0 || !openid) return

    this.setData({ loadingMore: true })

    try {
      const lastId = moments[moments.length - 1]._id
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserMoments',
          _openid: openid,
          limit: 20,
          lastId
        }
      })

      const result = res.result as any
      if (result.success) {
        // 转换云存储 URL 为临时 HTTP URL
        const newMoments = result.data || []
        for (const moment of newMoments) {
          // 转换成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos = await convertCloudUrls(moment.content.photos)
          }
          // 转换评论中的头像
          if (moment.comments && moment.comments.length > 0) {
            for (const comment of moment.comments) {
              if (comment.userInfo && comment.userInfo.avatarUrl) {
                comment.userInfo.avatarUrl = await convertCloudUrl(comment.userInfo.avatarUrl)
              }
            }
          }
        }

        // 确保每个moment的comments和photos字段都有默认值
        newMoments.forEach((moment) => {
          if (!moment.comments) {
            moment.comments = []
          }
          if (moment.content && !moment.content.photos) {
            moment.content.photos = []
          }
        })

        this.setData({
          moments: [...moments, ...newMoments],
          loadingMore: false,
          noMore: newMoments.length < 20
        })
      } else {
        this.setData({ loadingMore: false })
      }
    } catch (e) {
      console.error('加载更多失败', e)
      this.setData({ loadingMore: false })
    }
  },

  onPreviewImage(e: any) {
    const { url, urls } = e.currentTarget.dataset
    wx.previewImage({
      current: url,
      urls: urls || [url]
    })
  },

  formatTime(date: Date | string | number) {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`

    return `${d.getMonth() + 1}-${d.getDate()}`
  },

  // 发表时间：显示具体日期时间
  formatPublishTime(date: Date | string | number) {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const month = d.getMonth() + 1
    const day = d.getDate()
    const h = d.getHours()
    const m = d.getMinutes()
    const timeStr = `${h < 10 ? '0' + h : h}:${m < 10 ? '0' + m : m}`
    if (dDay.getTime() === today.getTime()) {
      return `今天 ${timeStr}`
    }
    if (dDay.getTime() === yesterday.getTime()) {
      return `昨天 ${timeStr}`
    }
    return `${month}月${day}日 ${timeStr}`
  }
})
