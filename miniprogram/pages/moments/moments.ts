// moments.ts
import { getOpenid, getOrCreateUser } from '../../services/auth'
import { getMyGroups } from '../../services/group'
import { getCategoryInfoBySubCategoryId, getCategoryById } from '../../services/category'

const app = getApp() as IAppOption

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 本地缓存的群组列表 key */
const GROUPS_CACHE_KEY = 'cachedGroups'

/** 本地缓存的成长墙数据 key */
const MOMENTS_CACHE_KEY = 'cachedMoments'
const MOMENTS_GROUP_ID_KEY = 'cachedMomentsGroupId'

/** 从本地缓存获取群组列表 */
function getCachedGroups(): any[] {
  try {
    const cached = wx.getStorageSync(GROUPS_CACHE_KEY)
    return cached || []
  } catch {
    return []
  }
}

/** 保存群组列表到本地缓存 */
function setCachedGroups(groups: any[]): void {
  wx.setStorageSync(GROUPS_CACHE_KEY, groups)
}

/** 从本地缓存获取成长墙数据 */
function getCachedMoments(): { moments: any[]; groupId: string } | null {
  try {
    const cached = wx.getStorageSync(MOMENTS_CACHE_KEY)
    const cachedGroupId = wx.getStorageSync(MOMENTS_GROUP_ID_KEY)
    if (cached && Array.isArray(cached) && cachedGroupId) {
      return { moments: cached, groupId: cachedGroupId }
    }
    return null
  } catch {
    return null
  }
}

/** 保存成长墙数据到本地缓存 */
function setCachedMoments(moments: any[], groupId: string): void {
  wx.setStorageSync(MOMENTS_CACHE_KEY, moments)
  wx.setStorageSync(MOMENTS_GROUP_ID_KEY, groupId)
}

interface MomentItem {
  _id: string
  userId: string
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
    showSwitchModal: false,
    // 动态主题色
    themeColor: '#1ABC9C',
  },

  // 用于跟踪最新的成长墙请求，防止请求乱序返回导致数据错乱
  _loadMomentsRequestId: 0,

  onLoad() {
    this.loadInitialData()
  },

  onShow() {
    // 同步主题色
    this.setData({
      themeColor: '#1ABC9C'
    })
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
    const syncUserPromise = openid && userInfo && userInfo.nickName && userInfo.avatarUrl
      ? getOrCreateUser(openid, userInfo.nickName, userInfo.avatarUrl).catch(e => console.warn('同步用户信息失败', e))
      : Promise.resolve()

    // 先并行加载群组和用户信息（群组会先显示缓存，再更新）
    // 成长墙加载也可以并行进行（如果有缓存会立即显示）
    await Promise.all([
      this.loadGroups(),
      syncUserPromise,
      this.loadMoments()
    ])
  },

  async loadGroups() {
    const openid = app.globalData.openid
    if (!openid) return

    // 优先从本地缓存加载群组列表（同步操作，立即显示）
    const cachedGroups = getCachedGroups()
    if (cachedGroups.length > 0) {
      const currentGroupId = this.data.currentGroupId || ((cachedGroups[0] && cachedGroups[0]._id) || '')
      if (currentGroupId && !this.data.currentGroupId) {
        this.setData({
          groups: cachedGroups,
          currentGroupId,
          currentGroupIndex: 0
        })
      } else {
        this.setData({ groups: cachedGroups })
      }
    }

    // 异步从服务器获取最新群组列表（不阻塞 UI）
    getMyGroups(openid)
      .then(groups => {
        // 保存到本地缓存
        setCachedGroups(groups)
        this.setData({ groups })

        // 如果没有选择群组，使用第一个
        const currentGroupId = this.data.currentGroupId || ((groups[0] && groups[0]._id) || '')
        if (currentGroupId && !this.data.currentGroupId) {
          this.setData({
            currentGroupId,
            currentGroupIndex: 0
          })
        }
      })
      .catch(e => {
        console.error('加载群组失败', e)
      })
  },

  async loadMoments(groupId?: string) {
    // 兜底：有些场景 globalData 还没恢复，但本地缓存已存在
    const cachedOpenid = wx.getStorageSync('openid')
    if (!app.globalData.openid && cachedOpenid) {
      app.globalData.openid = cachedOpenid
    }
    const openid = app.globalData.openid
    if (!openid) return

    // 如果传入了 groupId 则使用，否则使用 data 中的
    const currentGroupId = groupId || this.data.currentGroupId
    const { loading, noMore } = this.data
    if (!currentGroupId) return
    if (loading || noMore) return

    // 生成新的请求 ID，用于识别最新的请求
    const requestId = ++this._loadMomentsRequestId

    // 优先显示缓存（同步操作，立即呈现）
    const cached = getCachedMoments()
    if (cached && cached.groupId === currentGroupId && cached.moments.length > 0) {
      this.setData({
        moments: cached.moments,
        loading: true  // 仍然显示 loading，但先显示缓存内容
      })
    } else {
      this.setData({ loading: true })
    }

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

      // 检查是否是最新请求，防止旧请求覆盖新数据
      if (requestId !== this._loadMomentsRequestId) {
        console.log('跳过过期的成长墙请求', { requestId, currentRequestId: this._loadMomentsRequestId })
        return
      }

      const result = res.result as any
      if (result.success) {
          // 批量转换云存储 URL 为临时 HTTP URL
          const momentsData = result.data || []

        // 收集所有需要转换的 fileId
        const allFileIds = {
          avatars: [] as string[],
          photos: [] as string[],
          commentAvatars: [] as string[]
        }
        const avatarToMomentIndex = new Map<string, number>()
        const photoToMomentIndex = new Map<string, { momentIndex: number; photoIndex: number }>()
        const commentAvatarToCommentIndex = new Map<string, { momentIndex: number; commentIndex: number }>()

        momentsData.forEach((moment, momentIndex) => {
          // 头像
          if (moment.userInfo && moment.userInfo.avatarUrl && moment.userInfo.avatarUrl.startsWith('cloud://')) {
            allFileIds.avatars.push(moment.userInfo.avatarUrl)
            avatarToMomentIndex.set(moment.userInfo.avatarUrl, momentIndex)
          }
          // 成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos.forEach((photo: string, photoIndex: number) => {
              if (photo && photo.startsWith('cloud://')) {
                allFileIds.photos.push(photo)
                photoToMomentIndex.set(photo, { momentIndex, photoIndex })
              }
            })
          }
          // 评论头像
          if (moment.comments && moment.comments.length > 0) {
            moment.comments.forEach((comment, commentIndex) => {
              if (comment.userInfo && comment.userInfo.avatarUrl && comment.userInfo.avatarUrl.startsWith('cloud://')) {
                allFileIds.commentAvatars.push(comment.userInfo.avatarUrl)
                commentAvatarToCommentIndex.set(comment.userInfo.avatarUrl, { momentIndex, commentIndex })
              }
            })
          }
        })

        // 批量获取临时 URL（所有类型一次请求）
        const allCloudIds = [
          ...(allFileIds.avatars || []),
          ...(allFileIds.photos || []),
          ...(allFileIds.commentAvatars || [])
        ]
        const urlMap = new Map<string, string>()

        if (allCloudIds.length > 0) {
          try {
            const res = await wx.cloud.getTempFileURL({ fileList: allCloudIds })
            if (res.fileList) {
              for (const item of res.fileList) {
                if (item.status === 0 && item.fileID && item.tempFileURL) {
                  urlMap.set(item.fileID, item.tempFileURL)
                }
              }
            }
          } catch (e) {
            console.warn('批量转换云存储URL失败', e)
          }
        }

        // 应用转换后的 URL
        momentsData.forEach((moment) => {
          // 头像
          if (moment.userInfo && moment.userInfo.avatarUrl) {
            if (urlMap.has(moment.userInfo.avatarUrl)) {
              moment.userInfo.avatarUrl = urlMap.get(moment.userInfo.avatarUrl)!
            } else if (moment.userInfo.avatarUrl.startsWith('cloud://')) {
              moment.userInfo.avatarUrl = defaultAvatar
            }
          }
          // 成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos = moment.content.photos.map((photo: string) => {
              if (urlMap.has(photo)) {
                return urlMap.get(photo)!
              } else if (photo.startsWith('cloud://')) {
                return defaultAvatar
              }
              return photo
            })
          }
          // 评论头像
          if (moment.comments && moment.comments.length > 0) {
            moment.comments.forEach((comment) => {
              if (comment.userInfo && comment.userInfo.avatarUrl) {
                if (urlMap.has(comment.userInfo.avatarUrl)) {
                  comment.userInfo.avatarUrl = urlMap.get(comment.userInfo.avatarUrl)!
                } else if (comment.userInfo.avatarUrl.startsWith('cloud://')) {
                  comment.userInfo.avatarUrl = defaultAvatar
                }
              }
            })
          }
          // 转换类别ID为显示名称
          if (moment.content && moment.content.subCategoryId) {
            const info = getCategoryInfoBySubCategoryId(moment.content.subCategoryId)
            if (info) {
              moment.content.categoryDisplayName = `${info.categoryName} · ${info.subCategoryName}`
            }
          } else if (moment.content && moment.content.categoryId) {
            const cat = getCategoryById(moment.content.categoryId)
            if (cat) {
              moment.content.categoryDisplayName = cat.name
            }
          }
        })

        // 确保每个moment的comments字段都有默认值（空数组），避免渲染层遍历undefined报错
        momentsData.forEach((moment) => {
          if (!moment.comments) {
            moment.comments = []
          }
          // 确保content.photos也有默认值
          if (moment.content && !moment.content.photos) {
            moment.content.photos = []
          }
        })

        this.setData({
          moments: momentsData,
          loading: false,
          noMore: momentsData.length < 20
        })
        // 保存到本地缓存
        setCachedMoments(momentsData, currentGroupId)
      } else {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (e) {
      // 检查是否是最新请求，防止旧请求的错误覆盖新数据
      if (requestId !== this._loadMomentsRequestId) {
        console.log('跳过过期的成长墙请求错误', { requestId, currentRequestId: this._loadMomentsRequestId })
        return
      }
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
        // 批量转换云存储 URL 为临时 HTTP URL
        const newMoments = result.data || []

        // 收集所有需要转换的 fileId
        const allFileIds = {
          avatars: [] as string[],
          photos: [] as string[],
          commentAvatars: [] as string[]
        }

        newMoments.forEach((moment, momentIndex) => {
          // 头像
          if (moment.userInfo && moment.userInfo.avatarUrl && moment.userInfo.avatarUrl.startsWith('cloud://')) {
            allFileIds.avatars.push(moment.userInfo.avatarUrl)
          }
          // 成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos.forEach((photo: string) => {
              if (photo && photo.startsWith('cloud://')) {
                allFileIds.photos.push(photo)
              }
            })
          }
          // 评论头像
          if (moment.comments && moment.comments.length > 0) {
            moment.comments.forEach((comment) => {
              if (comment.userInfo && comment.userInfo.avatarUrl && comment.userInfo.avatarUrl.startsWith('cloud://')) {
                allFileIds.commentAvatars.push(comment.userInfo.avatarUrl)
              }
            })
          }
        })

        // 批量获取临时 URL
        const allCloudIds = [...allFileIds.avatars, ...allFileIds.photos, ...allFileIds.commentAvatars]
        const urlMap = new Map<string, string>()

        if (allCloudIds.length > 0) {
          try {
            const res = await wx.cloud.getTempFileURL({ fileList: allCloudIds })
            if (res.fileList) {
              for (const item of res.fileList) {
                if (item.status === 0 && item.fileID && item.tempFileURL) {
                  urlMap.set(item.fileID, item.tempFileURL)
                }
              }
            }
          } catch (e) {
            console.warn('批量转换云存储URL失败', e)
          }
        }

        // 应用转换后的 URL
        newMoments.forEach((moment) => {
          // 头像
          if (moment.userInfo && moment.userInfo.avatarUrl) {
            if (urlMap.has(moment.userInfo.avatarUrl)) {
              moment.userInfo.avatarUrl = urlMap.get(moment.userInfo.avatarUrl)!
            } else if (moment.userInfo.avatarUrl.startsWith('cloud://')) {
              moment.userInfo.avatarUrl = defaultAvatar
            }
          }
          // 成长墙图片
          if (moment.content && moment.content.photos && moment.content.photos.length > 0) {
            moment.content.photos = moment.content.photos.map((photo: string) => {
              if (urlMap.has(photo)) {
                return urlMap.get(photo)!
              } else if (photo.startsWith('cloud://')) {
                return defaultAvatar
              }
              return photo
            })
          }
          // 评论头像
          if (moment.comments && moment.comments.length > 0) {
            moment.comments.forEach((comment) => {
              if (comment.userInfo && comment.userInfo.avatarUrl) {
                if (urlMap.has(comment.userInfo.avatarUrl)) {
                  comment.userInfo.avatarUrl = urlMap.get(comment.userInfo.avatarUrl)!
                } else if (comment.userInfo.avatarUrl.startsWith('cloud://')) {
                  comment.userInfo.avatarUrl = defaultAvatar
                }
              }
            })
          }
          // 转换类别ID为显示名称
          if (moment.content && moment.content.subCategoryId) {
            const info = getCategoryInfoBySubCategoryId(moment.content.subCategoryId)
            if (info) {
              moment.content.categoryDisplayName = `${info.categoryName} · ${info.subCategoryName}`
            }
          } else if (moment.content && moment.content.categoryId) {
            const cat = getCategoryById(moment.content.categoryId)
            if (cat) {
              moment.content.categoryDisplayName = cat.name
            }
          }
        })

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

  // 切换群组
  onGroupChange(e: any) {
    const groupIndex = e.detail.value
    const groupId = (this.data.groups[groupIndex] && this.data.groups[groupIndex]._id) || ''
    if (!groupId) return

    this.setData({
      currentGroupId: groupId,
      currentGroupIndex: groupIndex,
      moments: [],
      noMore: false
    })
    // 直接传递 groupId 给 loadMoments，确保使用正确的群组 ID
    this.loadMoments(groupId)
  },

  // 显示切换群组弹窗
  showSwitchGroup() {
    this.setData({ showSwitchModal: true })
  },

  // 隐藏切换群组弹窗
  hideSwitchGroup() {
    this.setData({ showSwitchModal: false })
  },

  // 跳转创建群组
  goCreateGroup() {
    this.setData({ showSwitchModal: false })
    wx.navigateTo({ url: '/pages/group/group' })
  },

  // 阻止事件冒泡
  stopPropagation() {},

  // 选择群组
  selectGroup(e: any) {
    const groupId = e.currentTarget.dataset.id
    const g = this.data.groups.find((x: any) => x._id === groupId)
    if (!g) return

    const groupIndex = this.data.groups.findIndex((x: any) => x._id === groupId)
    this.setData({
      currentGroupId: groupId,
      currentGroupIndex: groupIndex >= 0 ? groupIndex : 0,
      showSwitchModal: false,
      moments: [],
      noMore: false
    })
    // 直接传递 groupId 给 loadMoments，确保使用正确的群组 ID
    this.loadMoments(groupId)
  },

  // 设置默认群组
  setDefaultGroup(e: any) {
    const groupId = e.currentTarget.dataset.id
    wx.setStorageSync('defaultGroupId', groupId)
    app.globalData.currentGroupId = groupId
    const g = this.data.groups.find((x: any) => x._id === groupId)
    if (!g) return

    const groupIndex = this.data.groups.findIndex((x: any) => x._id === groupId)
    this.setData({
      currentGroupId: groupId,
      currentGroupIndex: groupIndex >= 0 ? groupIndex : 0,
      showSwitchModal: false,
    })
    wx.showToast({ title: '已设为默认', icon: 'none' })
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
    const rawValue = (e && e.detail && e.detail.value)
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
      if (userInfo && userInfo.nickName && userInfo.avatarUrl) {
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
        ((e as any) && (e as any).errMsg) ||
        ((e as any) && (e as any).message) ||
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

  // 查看用户成长墙
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
