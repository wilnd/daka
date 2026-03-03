const app = getApp<IAppOption>()

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

interface MomentItem {
  _id: string
  userId: string
  groupId: string
  content: {
    photos?: string[]
    text?: string
    sportType?: string
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
    userId: '',
    userInfo: null as UserInfo | null,
    defaultAvatar,
    moments: [] as MomentItem[],
    loading: false,
    refreshing: false,
    loadingMore: false,
    noMore: false,
  },

  onLoad(options: any) {
    const userId = options.userId || ''
    const nickName = options.nickName || ''
    let avatarUrl = (options.avatarUrl || defaultAvatar)

    // URL 解码
    try { avatarUrl = decodeURIComponent(avatarUrl) } catch {}

    // 如果不是有效的网络头像，使用默认头像
    if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
      avatarUrl = defaultAvatar
    }

    if (userId) {
      this.setData({
        userId,
        userInfo: {
          _id: '',
          nickName,
          avatarUrl
        }
      })
      this.loadUserInfo(userId)
      this.loadMoments()
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    }
  },

  onShow() {
    if (this.data.userId) {
      this.loadMoments()
    }
  },

  onPullDownRefresh() {
    this.refreshMoments()
  },

  onReachBottom() {
    this.loadMoreMoments()
  },

  async loadUserInfo(userId: string) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserInfo',
          userId
        }
      })

      const result = res.result as any
      if (result.success && result.data) {
        let avatarUrl = result.data.avatarUrl || defaultAvatar
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
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
    const { userId, loading, noMore } = this.data
    if (!userId) return
    if (loading || noMore) return

    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserMoments',
          userId,
          limit: 20
        }
      })

      const result = res.result as any
      if (result.success) {
        this.setData({
          moments: result.data || [],
          loading: false,
          noMore: (result.data || []).length < 20
        })
      } else {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (e) {
      console.error('加载朋友圈失败', e)
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
    const { moments, loadingMore, noMore, userId } = this.data
    if (loadingMore || noMore || moments.length === 0 || !userId) return

    this.setData({ loadingMore: true })

    try {
      const lastId = moments[moments.length - 1]._id
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getUserMoments',
          userId,
          limit: 20,
          lastId
        }
      })

      const result = res.result as any
      if (result.success) {
        const newMoments = result.data || []
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
  }
})
