// share-poster.ts

Component({
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
    canvasHeight: 480,
    posterLoading: true
  },

  lifetimes: {
    attached() {
      const userInfo = wx.getStorageSync('userInfo')
      this.setData({ userInfo })

      // 预计算 canvas 尺寸
      const ratio = wx.getSystemInfoSync().windowWidth / 375
      this.setData({ 
        canvasWidth: 300 * ratio, 
        canvasHeight: 480 * ratio 
      })
    }
  },

  observers: {
    'visible': async function(visible) {
      if (visible && !this.data.posterGenerated) {
        await this.generatePoster()
      } else if (visible && this.data.posterGenerated) {
        // 重新生成时重置
        this.setData({ posterLoading: false })
      }
    }
  },

  methods: {
    // 获取指定日期前N天的日期字符串
    getDateBefore(dateStr: string, days: number): string {
      const date = new Date(dateStr)
      date.setDate(date.getDate() - days)
      return date.getFullYear() + '-' + 
        String(date.getMonth() + 1).padStart(2, '0') + '-' + 
        String(date.getDate()).padStart(2, '0')
    },

    // 计算连胜天数
    calculateStreak(checkins: any[], today: string): number {
      const checkedDates = new Set(checkins.map((c: any) => c.date))
      const yesterday = this.getDateBefore(today, 1)
      
      if (!checkedDates.has(yesterday)) {
        return checkedDates.has(today) ? 1 : 0
      }
      
      let streak = 0
      let d = yesterday
      for (let i = 0; i < 365; i++) {
        if (checkedDates.has(d)) {
          streak++
          d = this.getDateBefore(d, 1)
        } else {
          break
        }
      }
      if (checkedDates.has(today)) {
        streak++
      }
      return streak
    },

    async generatePoster() {
      const { checkinData } = this.properties as any
      const openid = wx.getStorageSync('openid') || ''
      const groupId = checkinData.groupId || ''

      this.setData({ posterLoading: true })

      // 获取连胜
      let streak = 0
      try {
        const db = wx.cloud.database()
        const _ = db.command
        const today = new Date()
        const todayStr = today.getFullYear() + '-' + 
          String(today.getMonth() + 1).padStart(2, '0') + '-' + 
          String(today.getDate()).padStart(2, '0')
        
        // 获取最近的打卡记录
        const checkinsRes = await db.collection('checkins')
          .where({
            userId: openid,
            date: _.gte(this.getDateBefore(todayStr, 400))
          })
          .limit(500)
          .get()
        
        const checkins = checkinsRes.data || []
        if (checkins.length > 0) {
          streak = this.calculateStreak(checkins, todayStr)
        }
      } catch (e) {
        console.error('获取连胜失败', e)
      }

      this.setData({ streak })

      // 生成海报
      try {
        const posterUrl = await this.drawPoster(streak, checkinData)
        this.setData({ 
          posterGenerated: true,
          posterUrl,
          posterLoading: false
        })
      } catch (e) {
        console.error('生成海报失败', e)
        this.setData({ posterLoading: false })
        wx.showToast({ title: '生成海报失败', icon: 'none' })
      }
    },

    async drawPoster(streak: number, checkinData: any): Promise<string> {
      return new Promise((resolve, reject) => {
        const ctx = wx.createCanvasContext('poster-canvas', this)
        const width = 300
        const height = 480
        const userInfo = this.data.userInfo

        // 缩放比例
        const ratio = wx.getSystemInfoSync().windowWidth / 375
        const scaleWidth = width * ratio
        const scaleHeight = height * ratio

        this.setData({ canvasWidth: scaleWidth, canvasHeight: scaleHeight })

        // 背景渐变
        const grd = ctx.createLinearGradient(0, 0, 0, scaleHeight)
        grd.addColorStop(0, '#1a1a2e')
        grd.addColorStop(0.5, '#16213e')
        grd.addColorStop(1, '#0f3460')
        ctx.setFillStyle(grd)
        ctx.fillRect(0, 0, scaleWidth, scaleHeight)

        // 顶部装饰圆弧
        ctx.setFillStyle('#16213e')
        ctx.beginPath()
        ctx.arc(scaleWidth / 2, 0, scaleWidth / 2 + 20, 0, Math.PI, false)
        ctx.fill()

        // 标题
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(18 * ratio)
        ctx.setTextAlign('center')
        ctx.fillText('每日运动打卡', scaleWidth / 2, 45 * ratio)

        // 左侧装饰线
        ctx.setStrokeStyle('#2E8B57')
        ctx.setLineWidth(2)
        ctx.beginPath()
        ctx.moveTo(30 * ratio, 42 * ratio)
        ctx.lineTo(60 * ratio, 42 * ratio)
        ctx.stroke()

        // 右侧装饰线
        ctx.beginPath()
        ctx.moveTo(scaleWidth - 60 * ratio, 42 * ratio)
        ctx.lineTo(scaleWidth - 30 * ratio, 42 * ratio)
        ctx.stroke()

        // 连胜光环
        const gradient = ctx.createCircularGradient(scaleWidth / 2, 140 * ratio, 60 * ratio)
        gradient.addColorStop(0, 'rgba(255, 215, 0, 0.3)')
        gradient.addColorStop(1, 'rgba(255, 215, 0, 0)')
        ctx.setFillStyle(gradient)
        ctx.beginPath()
        ctx.arc(scaleWidth / 2, 140 * ratio, 60 * ratio, 0, 2 * Math.PI)
        ctx.fill()

        // 连胜圆圈
        ctx.setFillStyle('#FFD700')
        ctx.beginPath()
        ctx.arc(scaleWidth / 2, 140 * ratio, 45 * ratio, 0, 2 * Math.PI)
        ctx.fill()

        // 连胜数字
        ctx.setFillStyle('#1a1a2e')
        ctx.setFontSize(36 * ratio)
        ctx.setTextAlign('center')
        ctx.fillText(streak.toString(), scaleWidth / 2, 155 * ratio)

        // 连胜标签
        ctx.setFontSize(12 * ratio)
        ctx.setFillStyle('#FFD700')
        ctx.fillText('连续打卡', scaleWidth / 2, 205 * ratio)

        // 分割线
        ctx.setStrokeStyle('rgba(255, 255, 255, 0.1)')
        ctx.setLineWidth(1)
        ctx.beginPath()
        ctx.moveTo(40 * ratio, 230 * ratio)
        ctx.lineTo(scaleWidth - 40 * ratio, 230 * ratio)
        ctx.stroke()

        // 用户头像
        if (userInfo && userInfo.avatarUrl) {
          // 头像圆形背景
          ctx.setFillStyle('#2E8B57')
          ctx.beginPath()
          ctx.arc(scaleWidth / 2, 270 * ratio, 28 * ratio, 0, 2 * Math.PI)
          ctx.fill()
          
          // 由于 canvas 绘制头像需要先下载，这里用占位圆圈代替
          // 实际可以使用 wx.getImageInfo 下载头像后绘制
          ctx.setFillStyle('#ffffff')
          ctx.setFontSize(20 * ratio)
          ctx.fillText((userInfo.nickName || '运动达人').slice(0, 1), scaleWidth / 2, 276 * ratio)
        }

        // 用户名
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(14 * ratio)
        ctx.fillText((userInfo && userInfo.nickName) || '运动达人', scaleWidth / 2, 315 * ratio)

        // 打卡类别标签
        const categoryText = checkinData.subCategoryId || checkinData.categoryId || ''
        if (categoryText) {
          ctx.setFillStyle('#2E8B57')
          ctx.setFontSize(11 * ratio)
          ctx.fillText(categoryText, scaleWidth / 2, 345 * ratio)
        }

        // 打卡内容
        if (checkinData.text) {
          ctx.setFillStyle('rgba(255, 255, 255, 0.8)')
          ctx.setFontSize(11 * ratio)
          const text = checkinData.text.length > 40 
            ? checkinData.text.substring(0, 40) + '...' 
            : checkinData.text
          ctx.fillText(text, scaleWidth / 2, 375 * ratio)
        }

        // 日期
        const now = new Date()
        const dateStr = now.toLocaleDateString('zh-CN', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
        ctx.setFillStyle('rgba(255, 255, 255, 0.5)')
        ctx.setFontSize(10 * ratio)
        ctx.fillText(dateStr, scaleWidth / 2, 410 * ratio)

        // 底部装饰
        ctx.setFillStyle('#2E8B57')
        ctx.fillRect(0, scaleHeight - 50 * ratio, scaleWidth, 50 * ratio)

        // 底部文字
        ctx.setFillStyle('#ffffff')
        ctx.setFontSize(11 * ratio)
        ctx.fillText('扫码一起运动，让生活更健康', scaleWidth / 2, scaleHeight - 22 * ratio)

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
      this.setData({ posterGenerated: false, posterUrl: '' })
      this.triggerEvent('close')
      this.triggerEvent('skip')
    },

    preventTap() {}
  }
})
