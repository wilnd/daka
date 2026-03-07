// checkin.ts
import { doCheckinWithContent, getTodayCheckin, CheckinContent } from '../../services/checkin'
import { getOpenid, getOrCreateUser } from '../../services/auth'
import { getStreak } from '../../services/stats'
import { getMyGroups } from '../../services/group'
import { getCategories, getSubCategories, Category, SubCategory } from '../../services/category'
import { getCachedGroups, setCachedGroups, defaultAvatar } from '../../services/utils'

const app = getApp() as IAppOption

/** 上次选择的打卡默认值 key */
const DEFAULT_CHECKIN_KEY = 'defaultCheckin'

/** 默认值的数据结构 */
interface DefaultCheckinData {
  selectedTag: string
  categoryIndex: number
  subCategoryIndex: number
  duration: string
  durationUnitIndex: number
  isPublishToMoments: boolean
  momentsGroupId: string
  momentsGroupIndex: number
}

/** 从本地缓存获取打卡默认值 */
function getDefaultCheckin(): DefaultCheckinData | null {
  try {
    const data = wx.getStorageSync(DEFAULT_CHECKIN_KEY)
    return data || null
  } catch {
    return null
  }
}

/** 保存打卡默认值到本地缓存 */
function setDefaultCheckin(data: DefaultCheckinData): void {
  wx.setStorageSync(DEFAULT_CHECKIN_KEY, data)
}

Page({
  data: {
    mode: 'create' as 'create' | 'edit',
    groupId: '',
    groupName: '',
    text: '',
    photos: [] as string[],
    maxPhotos: 9,
    // 大类和小类（使用索引便于picker使用）
    categoryIndex: -1,
    subCategoryIndex: -1,
    categories: [] as Category[],
    subCategories: [] as SubCategory[],
    // Tags选择模式的数据
    categoryGroups: [] as { category: Category; subCategories: SubCategory[] }[],
    // 当前选中的标签（categoryId_subCategoryId 格式）
    selectedTag: '',
    // 时长输入
    duration: '',
    durationUnits: ['分钟', '小时'],
    durationUnitIndex: 0,
    isPublishToMoments: true,
    // 成长墙可见范围
    momentsGroupId: '',
    momentsGroupName: '',
    momentsGroupIndex: 0,
    // 组合后的可见范围选项（包含"所有群组"和实际群组）
    momentsGroupRange: [] as any[],
    // 用户的群组列表
    groups: [] as any[],
    submitting: false,
    userInfo: null as any,
    showStreakAnimation: false,
    currentStreak: 0,
    showSharePoster: false,
    checkinResult: null as any,
    // 动态主题色
    themeColor: '#1ABC9C',
  },

  onLoad(options) {
    // 同步主题色
    this.setData({
      themeColor: '#1ABC9C'
    })
    const mode = options.mode === 'edit' ? 'edit' : 'create'
    const groupId = options.groupId || ''
    const groupName = options.groupName ? decodeURIComponent(options.groupName) : ''
    this.setData({ mode, groupId, groupName })
    this.init()
  },

  onShow() {
    // onLoad 中已设置主题色，不需要重复设置
    // 如果需要刷新数据，可以在这里调用 init()
  },

  async init() {
    const userInfo = wx.getStorageSync('userInfo')
    this.setData({ userInfo })

    // 初始化类别数据
    const categories = getCategories()
    // 构建分类后的Tags数据（按大类分组）
    const categoryGroups = categories.map(cat => ({
      category: cat,
      subCategories: cat.subCategories
    }))
    this.setData({ categories, categoryGroups })

    const openid = app.globalData.openid || wx.getStorageSync('openid')
    if (!openid) {
      try {
        const newOpenid = await getOpenid()
        app.globalData.openid = newOpenid
        wx.setStorageSync('openid', newOpenid)
      } catch (e) {
        wx.showToast({ title: '获取用户信息失败', icon: 'none' })
        return
      }
    }

    const finalOpenid = app.globalData.openid || wx.getStorageSync('openid')
    if (finalOpenid && userInfo && userInfo.nickName && userInfo.avatarUrl) {
      try {
        await getOrCreateUser(finalOpenid, userInfo.nickName, userInfo.avatarUrl)
      } catch (e) {
        console.warn('同步用户信息失败', e)
      }
    }

    // 加载用户的群组列表
    await this.loadGroups()
    // 加载今日记录（仅用于展示用户历史选择）
    await this.loadTodayCheckin()
  },

  async loadGroups() {
    const openid = app.globalData.openid
    if (!openid) return

    // 优先从本地缓存加载群组列表
    const cachedGroups = getCachedGroups() || []
    if (cachedGroups.length > 0) {
      const momentsGroupRange = [
        { _id: '', name: '所有群组' },
        ...cachedGroups
      ]
      this.setData({ groups: cachedGroups, momentsGroupRange })
    }

    try {
      // 从服务器获取最新群组列表
      const groups = await getMyGroups(openid) || []
      // 保存到本地缓存
      setCachedGroups(groups)
      // 构建成长墙可见范围选项：第一个是"所有群组"，后面是实际群组
      const momentsGroupRange = [
        { _id: '', name: '所有群组' },
        ...groups
      ]
      this.setData({ groups, momentsGroupRange })
    } catch (e) {
      console.warn('加载群组失败', e)
    }
  },

  async loadTodayCheckin() {
    const openid = app.globalData.openid || wx.getStorageSync('openid')
    if (!openid) return

    try {
      const ck = await getTodayCheckin(openid)
      // 无论是否已记录，都使用 create 模式（支持多次记录）
      // 如果有历史记录，记录最后一次的类别选择供用户参考
      if (!ck) {
        // 没有今日记录时，加载上次保存的默认值
        this.loadDefaultCheckin()
        return
      }

      const content = (ck as any).content || {}

      // 从记录内容中读取成长墙可见范围
      const momentsGroupId = (content as any).momentsGroupId || ''

      // 根据 momentsGroupId 查找群组名称和索引
      // 使用 momentsGroupRange，第一个是"所有群组"
      let momentsGroupName = ''
      let momentsGroupIndex = 0
      if (momentsGroupId) {
        const momentsGroupRange = this.data.momentsGroupRange
        const rangeIndex = momentsGroupRange.findIndex((g: any) => g._id === momentsGroupId)
        if (rangeIndex > 0) {  // > 0 因为第0个是"所有群组"
          momentsGroupIndex = rangeIndex
          momentsGroupName = momentsGroupRange[rangeIndex].name || ''
        }
      }

      // 回显上次的类别选择（根据ID找到对应的索引）
      const categoryId = content.categoryId || ''
      const subCategoryId = content.subCategoryId || ''
      // 构建选中标签的标识
      const selectedTag = categoryId && subCategoryId ? `${categoryId}_${subCategoryId}` : ''

      const categories = this.data.categories
      const categoryIndex = categories.findIndex(c => c.id === categoryId)
      const subCategories = categoryId ? getSubCategories(categoryId) : []
      const subCategoryIndex = subCategories.findIndex(s => s.id === subCategoryId)

      this.setData({
        mode: 'create',  // 始终使用创建模式，支持多次记录
        categoryIndex: categoryIndex >= 0 ? categoryIndex : -1,
        subCategoryIndex: subCategoryIndex >= 0 ? subCategoryIndex : -1,
        subCategories,
        selectedTag,  // 回显上次选择的标签
        text: content.text || '',
        photos: content.photos || [],
        isPublishToMoments: content.isPublishToMoments !== false,
        momentsGroupId,
        momentsGroupName,
        momentsGroupIndex
      })
    } catch (e) {
      console.error('加载今日记录失败', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 加载上次保存的默认值
  loadDefaultCheckin() {
    const defaultData = getDefaultCheckin()
    if (!defaultData) {
      this.setData({ mode: 'create' })
      return
    }

    const categories = this.data.categories
    const categoryIndex = defaultData.categoryIndex >= 0 ? defaultData.categoryIndex : -1
    const categoryId = categoryIndex >= 0 && categories[categoryIndex] ? categories[categoryIndex].id : ''
    const subCategories = categoryId ? getSubCategories(categoryId) : []
    const subCategoryIndex = defaultData.subCategoryIndex >= 0 ? defaultData.subCategoryIndex : -1

    // 根据 momentsGroupId 查找群组名称和索引
    let momentsGroupName = ''
    let momentsGroupIndex = defaultData.momentsGroupIndex || 0
    if (defaultData.momentsGroupId && this.data.momentsGroupRange) {
      const rangeIndex = this.data.momentsGroupRange.findIndex((g: any) => g._id === defaultData.momentsGroupId)
      if (rangeIndex > 0) {
        momentsGroupIndex = rangeIndex
        momentsGroupName = this.data.momentsGroupRange[rangeIndex] && this.data.momentsGroupRange[rangeIndex].name ? this.data.momentsGroupRange[rangeIndex].name : ''
      }
    }

    this.setData({
      mode: 'create',
      selectedTag: defaultData.selectedTag || '',
      categoryIndex,
      subCategoryIndex,
      subCategories,
      duration: defaultData.duration || '',
      durationUnitIndex: defaultData.durationUnitIndex || 0,
      isPublishToMoments: defaultData.isPublishToMoments !== false,
      momentsGroupId: defaultData.momentsGroupId || '',
      momentsGroupName,
      momentsGroupIndex
    })
  },

  onTextInput(e: any) {
    this.setData({ text: e.detail.value })
  },

  // 选择标签（Tags/胶囊选择模式）
  onSelectTag(e: any) {
    const { categoryid, subcategoryid } = e.currentTarget.dataset
    const selectedTag = `${categoryid}_${subcategoryid}`

    // 查找对应的索引用于内部处理
    const categories = this.data.categories
    const categoryIndex = categories.findIndex(c => c.id === categoryid)
    const subCategories = categoryIndex >= 0 ? getSubCategories(categoryid) : []
    const subCategoryIndex = subCategories.findIndex(s => s.id === subcategoryid)

    this.setData({
      selectedTag,
      categoryIndex,
      subCategoryIndex,
      subCategories
    })
  },

  // 清除标签选择
  onClearTag() {
    this.setData({
      selectedTag: '',
      categoryIndex: -1,
      subCategoryIndex: -1
    })
  },

  onCategoryChange(e: any) {
    const index = e.detail.value
    const categories = this.data.categories
    const selectedCategory = categories[index]
    if (!selectedCategory) return

    const subCategories = getSubCategories(selectedCategory.id)
    this.setData({
      categoryIndex: index,
      subCategoryIndex: -1,
      subCategories
    })
  },

  onSubCategoryChange(e: any) {
    const index = e.detail.value
    this.setData({ subCategoryIndex: index })
  },

  onDurationInput(e: any) {
    this.setData({ duration: e.detail.value })
  },

  onDurationUnitChange(e: any) {
    this.setData({ durationUnitIndex: e.detail.value })
  },

  onToggleMomentsPublish() {
    this.setData({ isPublishToMoments: !this.data.isPublishToMoments })
  },

  // 切换成长墙可见范围
  onMomentsGroupChange(e: any) {
    const index = e.detail.value
    const momentsGroupRange = this.data.momentsGroupRange
    const selectedGroup = momentsGroupRange[index]
    if (!selectedGroup || !selectedGroup._id) {
      // 选择"所有群组"
      this.setData({
        momentsGroupId: '',
        momentsGroupName: '',
        momentsGroupIndex: index
      })
    } else {
      this.setData({
        momentsGroupId: selectedGroup._id,
        momentsGroupName: selectedGroup.name,
        momentsGroupIndex: index
      })
    }
  },

  // 选择照片
  onChoosePhoto() {
    const { photos, maxPhotos } = this.data
    const remain = maxPhotos - photos.length

    if (remain <= 0) {
      wx.showToast({ title: `最多${maxPhotos}张图片`, icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newPhotos = res.tempFiles.map(f => f.tempFilePath)
        this.setData({
          photos: [...photos, ...newPhotos].slice(0, maxPhotos)
        })
      }
    })
  },

  // 删除照片
  onRemovePhoto(e: any) {
    const index = e.currentTarget.dataset.index
    const photos = [...(this.data.photos || [])]
    photos.splice(index, 1)
    this.setData({ photos })
  },

  // 预览照片
  onPreviewPhoto(e: any) {
    const { url, index } = e.currentTarget.dataset
    wx.previewImage({
      current: url,
      urls: this.data.photos || []
    })
  },

  // 提交记录
  async onSubmit() {
    const { text, photos, selectedTag, isPublishToMoments, submitting, groupId } = this.data
    const openid = app.globalData.openid

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 使用Tags选择模式：验证 selectedTag
    if (!selectedTag) {
      wx.showToast({ title: '请选择记录类别', icon: 'none' })
      return
    }

    const [categoryId, subCategoryId] = selectedTag.split('_')

    if (!text && photos.length === 0) {
      wx.showToast({ title: '请输入文字或上传照片', icon: 'none' })
      return
    }

    if (submitting) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '记录中...' })

    try {
      const cloudPhotos: string[] = []
      const localPhotos: string[] = []
      for (const p of (photos || [])) {
        if (typeof p === 'string' && p.startsWith('cloud://')) cloudPhotos.push(p)
        else localPhotos.push(p)
      }

      let uploadedPhotos: string[] = [...cloudPhotos]

      // 上传照片到云存储
      if (localPhotos.length > 0) {
        for (const photo of localPhotos) {
          const cloudPath = `checkins/${openid}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: photo
          })
          uploadedPhotos.push(uploadRes.fileID)
        }
      }

      const content: CheckinContent = {
        text: text.trim(),
        photos: uploadedPhotos,
        isPublishToMoments,
        categoryId,
        subCategoryId,
        momentsGroupId: this.data.momentsGroupId,
        duration: this.data.duration ? parseFloat(this.data.duration) : 0,
        durationUnit: this.data.durationUnits[this.data.durationUnitIndex]
      }

      const result = await doCheckinWithContent(openid, content, groupId)

      if (result.ok) {
        wx.showToast({
          title: isPublishToMoments ? '记录成功，已发布到成长墙' : '记录成功',
          icon: 'none'
        })

        // 记录成功后更新主题为绿色
        if (app.updateTheme) {
          app.updateTheme(true, true)
        }

        // 保存用户选择的默认值到本地存储
        const defaultData: DefaultCheckinData = {
          selectedTag: this.data.selectedTag,
          categoryIndex: this.data.categoryIndex,
          subCategoryIndex: this.data.subCategoryIndex,
          duration: this.data.duration,
          durationUnitIndex: this.data.durationUnitIndex,
          isPublishToMoments: this.data.isPublishToMoments,
          momentsGroupId: this.data.momentsGroupId,
          momentsGroupIndex: this.data.momentsGroupIndex
        }
        setDefaultCheckin(defaultData)

        // 显示连胜动画和分享海报
        // 获取当前连胜（记录后的连胜）
        let currentStreak = 1
        try {
          const openid = app.globalData.openid
          if (openid) {
            currentStreak = await getStreak(openid, groupId) || 1
          }
        } catch (e) {
          console.warn('获取连胜失败', e)
        }

        // 保存记录结果用于生成海报
        const checkinResult = {
          text: text.trim(),
          categoryId,
          subCategoryId,
          groupId,
          photos: uploadedPhotos
        }
        this.setData({ 
          currentStreak, 
          checkinResult,
          showStreakAnimation: true,
          // 临时保存 categoryId 用于动画显示
          themeColor: categoryId === 'sports' ? '#FF4500' : categoryId === 'study' ? '#4169E1' : '#32CD32'
        })
      } else {
        wx.showToast({ title: result.msg || '记录失败', icon: 'none' })
      }
    } catch (e) {
      console.error('记录失败', e)
      wx.showToast({ title: '记录失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
      wx.hideLoading()
    }
  },

  // 连胜动画完成
  onStreakAnimationComplete() {
    this.setData({ showStreakAnimation: false })
    // 显示分享海报
    this.setData({ showSharePoster: true })
  },

  // 跳过分享
  onSkipShare() {
    this.setData({ 
      showStreakAnimation: false,
      showSharePoster: false 
    })
    // 跳转回首页
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 关闭分享海报
  onClosePoster() {
    this.setData({ showSharePoster: false })
    // 跳转回首页
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 分享到成长墙
  onShareTimeline() {
    return {
      title: '每日运动记录',
      query: ''
    }
  }
})
