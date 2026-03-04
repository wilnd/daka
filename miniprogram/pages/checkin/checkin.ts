// checkin.ts
import { doCheckinWithContent, updateTodayCheckinWithContent, getTodayCheckin, CheckinContent } from '../../services/checkin'
import { getOpenid, getOrCreateUser } from '../../services/auth'

const app = getApp<IAppOption>()

const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Page({
  data: {
    mode: 'create' as 'create' | 'edit',
    groupId: '',
    groupName: '',
    text: '',
    photos: [] as string[],
    maxPhotos: 9,
    sportType: '',
    sportTypes: ['跑步', '走路', '骑行', '游泳', '健身', '瑜伽', '篮球', '足球', '网球', '羽毛球', '乒乓球', '舞蹈', '徒步', '攀岩', '其他'],
    isPublishToMoments: true,
    submitting: false,
    userInfo: null as any
  },

  onLoad(options) {
    const mode = options.mode === 'edit' ? 'edit' : 'create'
    const groupId = options.groupId || ''
    const groupName = options.groupName ? decodeURIComponent(options.groupName) : ''
    this.setData({ mode, groupId, groupName })
    this.init()
  },

  async init() {
    const userInfo = wx.getStorageSync('userInfo')
    this.setData({ userInfo })

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

    await this.loadTodayCheckin()
  },

  async loadTodayCheckin() {
    const openid = app.globalData.openid || wx.getStorageSync('openid')
    if (!openid) return

    try {
      const ck = await getTodayCheckin(openid)
      if (!ck) {
        wx.showToast({ title: '今日还未打卡', icon: 'none' })
        this.setData({ mode: 'create' })
        return
      }

      const content = (ck as any).content || {}

      this.setData({
        text: content.text || '',
        photos: content.photos || [],
        sportType: content.sportType || '',
        isPublishToMoments: content.isPublishToMoments !== false
      })
    } catch (e) {
      console.error('加载今日打卡失败', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onTextInput(e: any) {
    this.setData({ text: e.detail.value })
  },

  onSportTypeChange(e: any) {
    const index = e.detail.value
    this.setData({ sportType: this.data.sportTypes[index] })
  },

  onToggleMomentsPublish() {
    this.setData({ isPublishToMoments: !this.data.isPublishToMoments })
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
    const photos = [...this.data.photos]
    photos.splice(index, 1)
    this.setData({ photos })
  },

  // 预览照片
  onPreviewPhoto(e: any) {
    const { url, index } = e.currentTarget.dataset
    wx.previewImage({
      current: url,
      urls: this.data.photos
    })
  },

  // 提交打卡
  async onSubmit() {
    const { text, photos, sportType, isPublishToMoments, submitting, mode, groupId } = this.data
    const openid = app.globalData.openid

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    if (!text && photos.length === 0) {
      wx.showToast({ title: '请输入文字或上传照片', icon: 'none' })
      return
    }

    if (submitting) return

    this.setData({ submitting: true })
    wx.showLoading({ title: mode === 'edit' ? '更新中...' : '打卡中...' })

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
        sportType
      }

      const result =
        mode === 'edit'
          ? await updateTodayCheckinWithContent(openid, content, groupId)
          : await doCheckinWithContent(openid, content, groupId)

      if (result.ok) {
        wx.showToast({ 
          title:
            mode === 'edit'
              ? (isPublishToMoments ? '更新成功，已同步朋友圈' : '更新成功')
              : (isPublishToMoments ? '打卡成功，已发布到朋友圈' : '打卡成功'),
          icon: 'none' 
        })
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' })
        }, 1500)
      } else {
        wx.showToast({ title: result.msg || '打卡失败', icon: 'none' })
      }
    } catch (e) {
      console.error('打卡失败', e)
      wx.showToast({ title: '打卡失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
      wx.hideLoading()
    }
  }
})
