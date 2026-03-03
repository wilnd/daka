// moments.ts
import { getOpenid, getOrCreateUser } from '../../services/auth'
import { getMyGroups } from '../../services/group'

const app = getApp<IAppOption>()

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
  userInfo?: {
    _id: string
    nickName: string
    avatarUrl: string
  }
  groupName?: string
  isLiked?: boolean
  comments?: any[]
}

Page({
  data: {
    moments: [] as MomentItem[],
    loading: false,
    refreshing: false,
    loadingMore: false,
    noMore: false,
    currentGroupId: '',
    currentGroupIndex: 0,
    groups: [] as any[],
    showCommentInput: false,
    currentCommentMomentId: '',
    commentSubmitting: false,
  },

  onLoad() {
    this.loadInitialData()
  },

  onShow() {
    // 首次进入时，onShow 可能早于异步初始化完成
    if (!this.data.currentGroupId) {
      this.loadInitialData()
      return
    }
    this.loadMoments()
  },

  onPullDownRefresh() {
    this.refreshMoments()
  },

  onReachBottom() {
    this.loadMoreMoments()
  },

  async loadInitialData() {
    let openid = app.globalData.openid || wx.getStorageSync('openid')
    if (!openid) {
      try {
        openid = await getOpenid()
        app.globalData.openid = openid
        wx.setStorageSync('openid', openid)
      } catch (e) {
        console.error('获取openid失败', e)
        return
      }
    } else if (!app.globalData.openid) {
      // 从本地缓存恢复时同步到全局，避免后续逻辑读取不到
      app.globalData.openid = openid
    }

    // 确保 users 集合有当前用户信息，避免展示为“匿名用户”
    const userInfo = wx.getStorageSync('userInfo')
    if (openid && userInfo?.nickName && userInfo?.avatarUrl) {
      try {
        await getOrCreateUser(openid, userInfo.nickName, userInfo.avatarUrl)
      } catch (e) {
        console.warn('同步用户信息失败', e)
      }
    }

    await this.loadGroups()
    // 群组与 groupId 就绪后再拉取数据，避免 groupId 为空导致查询不到
    await this.loadMoments()
  },

  async loadGroups() {
    const openid = app.globalData.openid
    if (!openid) return
    
    try {
      const groups = await getMyGroups(openid)
      this.setData({ groups })
      
      // 如果没有选择群组，使用第一个
      const currentGroupId = this.data.currentGroupId || (groups[0]?._id || '')
      if (currentGroupId && !this.data.currentGroupId) {
        this.setData({ 
          currentGroupId,
          currentGroupIndex: 0
        })
      }
    } catch (e) {
      console.error('加载群组失败', e)
    }
  },

  async loadMoments() {
    // 兜底：有些场景 globalData 还没恢复，但本地缓存已存在
    const cachedOpenid = wx.getStorageSync('openid')
    if (!app.globalData.openid && cachedOpenid) {
      app.globalData.openid = cachedOpenid
    }
    const openid = app.globalData.openid
    if (!openid) return
    
    const { currentGroupId, loading, noMore } = this.data
    if (!currentGroupId) return
    if (loading || noMore) return

    this.setData({ loading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getMoments',
          groupId: currentGroupId,
          limit: 20,
          userId: openid
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
    const openid = app.globalData.openid
    const { moments, loadingMore, noMore, currentGroupId } = this.data
    if (loadingMore || noMore || moments.length === 0 || !openid) return

    this.setData({ loadingMore: true })

    try {
      const lastId = moments[moments.length - 1]._id
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'getMoments',
          groupId: currentGroupId,
          limit: 20,
          lastId,
          userId: openid
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

  // 切换群组
  onGroupChange(e: any) {
    const groupIndex = e.detail.value
    const groupId = this.data.groups[groupIndex]?._id || ''
    this.setData({ 
      currentGroupId: groupId,
      currentGroupIndex: groupIndex,
      moments: [],
      noMore: false
    })
    this.loadMoments()
  },

  // 点赞
  async onLike(e: any) {
    const openid = app.globalData.openid
    if (!openid) return

    const { momentId, liked } = e.currentTarget.dataset
    const action = liked ? 'unlike' : 'like'

    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action,
          momentId,
          userId: openid
        }
      })

      const result = res.result as any
      if (result.success) {
        // 更新本地状态
        const moments = this.data.moments.map(m => {
          if (m._id === momentId) {
            return {
              ...m,
              isLiked: !liked,
              likeCount: liked ? m.likeCount - 1 : m.likeCount + 1
            }
          }
          return m
        })
        this.setData({ moments })
      } else {
        wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
      }
    } catch (e) {
      console.error('点赞失败', e)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // 打开评论弹窗
  onComment(e: any) {
    const { momentId } = e.currentTarget.dataset
    if (!momentId) {
      wx.showToast({ title: '数据异常，请重试', icon: 'none' })
      return
    }
    this.setData({ 
      currentCommentMomentId: momentId,
      showCommentInput: true 
    })
  },

  // 发送评论
  async onSendComment(e: any) {
    const openid = app.globalData.openid
    if (!openid) return
    if (this.data.commentSubmitting) return

    // form submit: e.detail.value = { content: string }
    // input confirm: e.detail.value = string
    const rawValue = e?.detail?.value
    const content =
      typeof rawValue === 'string'
        ? rawValue
        : (rawValue && typeof rawValue === 'object' ? rawValue.content : '')
    const { currentCommentMomentId: momentId } = this.data
    if (!momentId) {
      wx.showToast({ title: '未找到要评论的动态', icon: 'none' })
      return
    }

    if (!content || !content.trim()) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    try {
      this.setData({ commentSubmitting: true })
      wx.hideKeyboard()
      wx.showLoading({ title: '发送中', mask: true })

      // 非阻塞兜底同步用户信息（避免同步失败/卡顿影响评论）
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo?.nickName && userInfo?.avatarUrl) {
        try {
          // 不 await：同步失败不影响评论发送
          getOrCreateUser(openid, userInfo.nickName, userInfo.avatarUrl)
        } catch (e) {
          console.warn('同步用户信息失败', e)
        }
      }

      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: {
          action: 'comment',
          momentId,
          content: content.trim(),
          userId: openid
        }
      })

      const result = res.result as any
      if (result.success) {
        // 更新本地评论列表
        const moments = this.data.moments.map(m => {
          if (m._id === momentId) {
            return {
              ...m,
              commentCount: m.commentCount + 1,
              comments: [...(m.comments || []), result.data]
            }
          }
          return m
        })
        this.setData({ 
          moments,
          showCommentInput: false,
          currentCommentMomentId: ''
        })
        wx.showToast({ title: '评论成功', icon: 'none' })
      } else {
        wx.showToast({ title: result.msg || '评论失败', icon: 'none' })
      }
    } catch (e) {
      console.error('评论失败', e)
      const msg =
        (e as any)?.errMsg ||
        (e as any)?.message ||
        '评论失败'
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ commentSubmitting: false })
    }
  },

  // 关闭评论弹窗
  onCloseComment() {
    this.setData({ 
      showCommentInput: false,
      currentCommentMomentId: ''
    })
  },

  // 预览图片
  onPreviewImage(e: any) {
    const { url, urls } = e.currentTarget.dataset
    wx.previewImage({
      current: url,
      urls: urls || [url]
    })
  },

  // 查看大图（头像）
  onPreviewAvatar(e: any) {
    const { url } = e.currentTarget.dataset
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  // 查看用户朋友圈
  onViewUserMoments(e: any) {
    const { userId, nickName, avatarUrl } = e.currentTarget.dataset
    if (!userId) {
      wx.showToast({ title: '无法查看', icon: 'none' })
      return
    }

    // 编码参数
    const params = [
      `userId=${encodeURIComponent(userId)}`,
      `nickName=${encodeURIComponent(nickName || '')}`,
      `avatarUrl=${encodeURIComponent(avatarUrl || '')}`
    ].join('&')

    wx.navigateTo({
      url: `/pages/user-moments/user-moments?${params}`
    })
  },

  // 格式化时间
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
