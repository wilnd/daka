// share-poster.ts
import { getStreak } from '../../services/stats'

const app = getApp<IAppOption>()

Component<IComponentOptions>({
  options: {
    styleIsolation: 'shared'
  },

  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    checkinData: {
      type: Object,
      value: {}
    }
  },

  data: {
    posterGenerated: false,
    posterUrl: '',
    streak: 0,
    userInfo: null as any,
    canvasWidth: 300,
    canvasHeight: 450
  },

  lifetimes: {
    attached() {
      const userInfo = wx.getStorageSync('userInfo')
      this.setData({ userInfo })

      // 预计算 canvas 尺寸
      const ratio = wx.getSystemInfoSync().windowWidth / 375
      this.setData({ 
        canvasWidth: 300 * ratio, 
        canvasHeight: 450 * ratio 
      })
    }
  },

  observers: {
    'visible': async function(visible) {
      if (visible && !this.data.posterGenerated) {
        await this.generatePoster()
      }
    }
  },

  methods: {
    async generatePoster() {
      const { checkinData } = this.properties as any
      const openid = app.globalData.openid || wx.getStorageSync('openid')
      const groupId = checkinData.groupId || ''

      // 获取连胜
      let streak = 0
      try {
        streak = await getStreak(openid, groupId)
      } catch (e) {
        console.error('获取连胜失败', e)
      }

      this.setData({ streak })

      // 生成海报
      try {
        const posterUrl = await this.drawPoster(streak, checkinData)
        this.setData({ 
          posterGenerated: true,
          posterUrl
        })
      } catch (e) {
        console.error('生成海报失败', e)
        wx.showToast({ title: '生成海报失败', icon: 'none' })
      }
    },

    async drawPoster(streak: number, checkinData: any): Promise<string> {
      return new Promise((resolve, reject) => {
        const ctx = wx.createCanvasContext('poster-canvas', this)
        const width = 300
        const height = 450
        const userInfo = this.data.userInfo

        // 缩放比例
        const ratio = wx.getSystemInfoSync().windowWidth / 375
        const scaleWidth = width * ratio
        const scaleHeight = height * ratio

        this.setData({ canvasWidth: scaleWidth, canvasHeight: scaleHeight })

        // 背景
        ctx.setFillStyle('#ffffff')
        ctx.fillRect(0, 0, scaleWidth, scaleHeight)

        // 顶部装饰
        ctx.setFillStyle('#2E8B57')
        ctx.fillRect(0, 0, scaleWidth, 60 * ratio)

        // 标题
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(20 * ratio)
        ctx.setTextAlign('center')
        ctx.fillText('每日运动打卡', scaleWidth / 2, 38 * ratio)

        // 连胜区域
        ctx.setFillStyle('#FFD700')
        ctx.beginPath()
        ctx.arc(scaleWidth / 2, 130 * ratio, 50 * ratio, 0, 2 * Math.PI)
        ctx.fill()

        // 连胜数字
        ctx.setFillStyle('#2E8B57')
        ctx.setFontSize(40 * ratio)
        ctx.setTextAlign('center')
        ctx.fillText(streak.toString(), scaleWidth / 2, 145 * ratio)

        // 连胜标签
        ctx.setFontSize(14 * ratio)
        ctx.setFillStyle('#666666')
        ctx.fillText('连续打卡天数', scaleWidth / 2, 200 * ratio)

        // 用户信息
        if (userInfo) {
          ctx.setFontSize(16 * ratio)
          ctx.setFillStyle('#333333')
          ctx.fillText(userInfo.nickName || '运动达人', scaleWidth / 2, 240 * ratio)
        }

        // 运动类型
        if (checkinData.sportType) {
          ctx.setFillStyle('#2E8B57')
          ctx.setFontSize(14 * ratio)
          ctx.fillText(checkinData.sportType, scaleWidth / 2, 270 * ratio)
        }

        // 打卡内容
        if (checkinData.text) {
          ctx.setFillStyle('#666666')
          ctx.setFontSize(12 * ratio)
          const text = checkinData.text.length > 50 ? checkinData.text.substring(0, 50) + '...' : checkinData.text
          ctx.fillText(text, scaleWidth / 2, 300 * ratio)
        }

        // 日期
        const now = new Date()
        const dateStr = now.toLocaleDateString('zh-CN', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
        ctx.setFillStyle('#999999')
        ctx.setFontSize(12 * ratio)
        ctx.fillText(dateStr, scaleWidth / 2, 340 * ratio)

        // 底部装饰
        ctx.setFillStyle('#2E8B57')
        ctx.fillRect(0, scaleHeight - 40 * ratio, scaleWidth, 40 * ratio)
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(12 * ratio)
        ctx.fillText('扫码一起运动', scaleWidth / 2, scaleHeight - 18 * ratio)

        ctx.draw(false, () => {
          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvasId: 'poster-canvas',
              success: (res) => {
                resolve(res.tempFilePath)
              },
              fail: reject
            }, this)
          }, 500)
        })
      })
    },

    onShareToFriends() {
      const { posterUrl } = this.data
      if (!posterUrl) {
        wx.showToast({ title: '海报未生成', icon: 'none' })
        return
      }

      wx.saveImageToPhotosAlbum({
        filePath: posterUrl,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'success' })
        },
        fail: (err) => {
          console.error('保存失败', err)
          if (err.errMsg.includes('auth deny')) {
            wx.showModal({
              title: '提示',
              content: '需要授权保存图片到相册',
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting()
                }
              }
            })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        }
      })
    },

    onShareTimeline() {
      this.triggerEvent('shareTimeline')
    },

    onClose() {
      this.triggerEvent('close')
    },

    preventTap() {}
  }
})
