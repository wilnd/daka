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
    userInfo: null,
    canvasWidth: 300,
    canvasHeight: 540,
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
        canvasHeight: 540 * ratio 
      })
    }
  },

  observers: {
    'visible': function(visible) {
      if (visible && !this.data.posterGenerated) {
        this.generatePoster()
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
      const year = date.getFullYear()
      const month = ('0' + (date.getMonth() + 1)).slice(-2)
      const day = ('0' + date.getDate()).slice(-2)
      return year + '-' + month + '-' + day
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
      const checkinData = this.properties.checkinData
      const openid = wx.getStorageSync('openid') || ''

      this.setData({ posterLoading: true })

      // 获取连胜
      let streak = 0
      try {
        const db = wx.cloud.database()
        const _ = db.command
        const today = new Date()
        const todayYear = today.getFullYear()
        const todayMonth = ('0' + (today.getMonth() + 1)).slice(-2)
        const todayDay = ('0' + today.getDate()).slice(-2)
        const todayStr = todayYear + '-' + todayMonth + '-' + todayDay
        
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

      // 生成海报（含超时保底，防止永久卡在 loading）
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 8000)
      )
      try {
        const posterUrl = await Promise.race([
          this.drawPoster(streak, checkinData),
          timeout
        ])
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
        const W0 = 300, H0 = 540
        const userInfo = this.data.userInfo
        const r = wx.getSystemInfoSync().windowWidth / 375
        const W = W0 * r
        const H = H0 * r
        const cx = W / 2

        this.setData({ canvasWidth: W, canvasHeight: H })

        // ── 背景：深红 → 正红 → 橙红 热烈渐变 ──
        const bg = ctx.createLinearGradient(0, 0, 0, H)
        bg.addColorStop(0, '#6B0000')
        bg.addColorStop(0.45, '#C80000')
        bg.addColorStop(1, '#FF4500')
        ctx.setFillStyle(bg)
        ctx.fillRect(0, 0, W, H)

        // ── 顶部放射光线（12条，金橙交替）──
        const rayCount = 12
        const rayLen = H * 0.55
        for (let i = 0; i < rayCount; i++) {
          const angle = Math.PI + (i / rayCount) * Math.PI
          const nextAngle = Math.PI + ((i + 0.5) / rayCount) * Math.PI
          ctx.beginPath()
          ctx.moveTo(cx, 0)
          ctx.arc(cx, 0, rayLen, angle, nextAngle, false)
          ctx.closePath()
          ctx.setFillStyle(i % 2 === 0
            ? 'rgba(255, 200, 0, 0.13)'
            : 'rgba(255, 120, 0, 0.09)')
          ctx.fill()
        }

        // ── 顶部暗色半圆（衬托标题）──
        ctx.setFillStyle('rgba(0, 0, 0, 0.25)')
        ctx.beginPath()
        ctx.arc(cx, 0, 90 * r, 0, Math.PI, false)
        ctx.fill()

        // ── 按类别定制文案 ──
        const categoryId = checkinData.categoryId || 'sports'
        const copyMap: Record<string, { badge: string; slogan: string; streakLabel: string; cta1: string; cta2: string; cta3: string }> = {
          sports: {
            badge:       '★  每日运动打卡  ★',
            slogan:      '燃烧卡路里，超越自我！',
            streakLabel: '连续运动',
            cta1:        '扫码一起运动打卡',
            cta2:        '燃烧卡路里，健康生活',
            cta3:        '加入打卡群，一起变强！',
          },
          study: {
            badge:       '★  每日学习打卡  ★',
            slogan:      '知识改变命运，坚持成就未来！',
            streakLabel: '连续学习',
            cta1:        '扫码一起学习打卡',
            cta2:        '坚持学习，知识赋能',
            cta3:        '加入学习群，共同进步！',
          },
          life: {
            badge:       '★  每日生活打卡  ★',
            slogan:      '积极生活，热爱每一天！',
            streakLabel: '连续打卡',
            cta1:        '扫码一起生活打卡',
            cta2:        '好习惯，好生活',
            cta3:        '加入打卡群，一起成长！',
          },
        }
        const copy = copyMap[categoryId] || copyMap['sports']

        // ── 标题区 ──
        ctx.setTextAlign('center')
        ctx.setFillStyle('#FFD700')
        ctx.setFontSize(11 * r)
        ctx.fillText(copy.badge, cx, 26 * r)

        ctx.setFillStyle('#FFFFFF')
        ctx.setFontSize(17 * r)
        ctx.fillText(copy.slogan, cx, 56 * r)

        // ── 黄金装饰短横线 ──
        ctx.setStrokeStyle('#FFD700')
        ctx.setLineWidth(1.5 * r)
        ctx.beginPath()
        ctx.moveTo(cx - 60 * r, 65 * r)
        ctx.lineTo(cx - 20 * r, 65 * r)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx + 20 * r, 65 * r)
        ctx.lineTo(cx + 60 * r, 65 * r)
        ctx.stroke()

        // ── 连胜光环（多层渐变营造炫光感）──
        const circleY = 162 * r

        // 最外层散射光
        const aura3 = ctx.createCircularGradient(cx, circleY, 82 * r)
        aura3.addColorStop(0, 'rgba(255, 220, 0, 0.22)')
        aura3.addColorStop(1, 'rgba(255, 220, 0, 0)')
        ctx.setFillStyle(aura3)
        ctx.beginPath()
        ctx.arc(cx, circleY, 82 * r, 0, 2 * Math.PI)
        ctx.fill()

        // 中层光晕
        const aura2 = ctx.createCircularGradient(cx, circleY, 65 * r)
        aura2.addColorStop(0, 'rgba(255, 180, 0, 0.35)')
        aura2.addColorStop(1, 'rgba(255, 180, 0, 0)')
        ctx.setFillStyle(aura2)
        ctx.beginPath()
        ctx.arc(cx, circleY, 65 * r, 0, 2 * Math.PI)
        ctx.fill()

        // 金色描边圆环
        ctx.setStrokeStyle('#FFD700')
        ctx.setLineWidth(3 * r)
        ctx.beginPath()
        ctx.arc(cx, circleY, 52 * r, 0, 2 * Math.PI)
        ctx.stroke()

        // 内填充（深红半透明，营造立体感）
        ctx.setFillStyle('rgba(80, 0, 0, 0.65)')
        ctx.beginPath()
        ctx.arc(cx, circleY, 50 * r, 0, 2 * Math.PI)
        ctx.fill()

        // 连胜数字 + 天
        const streakStr = streak.toString()
        ctx.setFillStyle('#FFD700')
        ctx.setFontSize(46 * r)
        ctx.fillText(streakStr + '天', cx, circleY + 16 * r)

        // 类别标签（圆圈下方）
        ctx.setFontSize(12 * r)
        ctx.setFillStyle('#FFE87C')
        ctx.fillText(copy.streakLabel, cx, circleY + 72 * r)

        // ── 侧面装饰小圆点 ──
        const dots = [
          { x: 28, y: 115, s: 4 }, { x: 18, y: 148, s: 3 },
          { x: 35, y: 180, s: 5 }, { x: 272, y: 120, s: 3 },
          { x: 280, y: 158, s: 5 }, { x: 265, y: 190, s: 4 },
        ]
        dots.forEach(d => {
          ctx.setFillStyle('rgba(255, 215, 0, 0.6)')
          ctx.beginPath()
          ctx.arc(d.x * r, d.y * r, d.s * r / 2, 0, 2 * Math.PI)
          ctx.fill()
        })

        // ── 金色分割线 ──
        const divY = 253 * r
        const divGrd = ctx.createLinearGradient(30 * r, divY, W - 30 * r, divY)
        divGrd.addColorStop(0, 'rgba(255, 215, 0, 0)')
        divGrd.addColorStop(0.5, 'rgba(255, 215, 0, 0.85)')
        divGrd.addColorStop(1, 'rgba(255, 215, 0, 0)')
        ctx.setStrokeStyle(divGrd)
        ctx.setLineWidth(1)
        ctx.beginPath()
        ctx.moveTo(30 * r, divY)
        ctx.lineTo(W - 30 * r, divY)
        ctx.stroke()

        // ── 用户信息区 ──
        const avatarCY = 292 * r
        // 头像外环
        ctx.setStrokeStyle('#FFD700')
        ctx.setLineWidth(2 * r)
        ctx.beginPath()
        ctx.arc(cx, avatarCY, 30 * r, 0, 2 * Math.PI)
        ctx.stroke()
        // 头像填充
        ctx.setFillStyle('rgba(139, 0, 0, 0.8)')
        ctx.beginPath()
        ctx.arc(cx, avatarCY, 28 * r, 0, 2 * Math.PI)
        ctx.fill()
        // 头像首字
        ctx.setFillStyle('#FFD700')
        ctx.setFontSize(22 * r)
        const nickName = userInfo && userInfo.nickName
        ctx.fillText((nickName || '运').slice(0, 1), cx, avatarCY + 8 * r)

        // 用户名
        ctx.setFillStyle('#FFFFFF')
        ctx.setFontSize(15 * r)
        ctx.fillText((nickName || '运动达人').substring(0, 8), cx, 337 * r)

        // 日期
        const now = new Date()
        const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
        ctx.setFillStyle('rgba(255, 230, 140, 0.9)')
        ctx.setFontSize(11 * r)
        ctx.fillText(dateStr, cx, 356 * r)

        // 打卡类别标签
        const categoryText = checkinData.subCategoryId || checkinData.categoryId || ''
        if (categoryText) {
          const tagW = (categoryText.length * 13 + 28) * r
          ctx.setFillStyle('rgba(255, 215, 0, 0.2)')
          ctx.fillRect(cx - tagW / 2, 364 * r, tagW, 22 * r)
          ctx.setFillStyle('#FFD700')
          ctx.setFontSize(11 * r)
          ctx.fillText(categoryText, cx, 379 * r)
        }

        // 打卡内容文字
        if (checkinData.text) {
          const text = checkinData.text.length > 28
            ? checkinData.text.substring(0, 28) + '...'
            : checkinData.text
          ctx.setFillStyle('rgba(255, 255, 255, 0.88)')
          ctx.setFontSize(12 * r)
          ctx.fillText(`"${text}"`, cx, 403 * r)
        }

        // ── 底部二维码卡片区 ──
        const cardY = 420 * r
        const cardH = 106 * r
        const cardX = 14 * r
        const cardW = W - 28 * r

        // 白色卡片背景
        ctx.setFillStyle('rgba(255, 255, 255, 0.95)')
        ctx.fillRect(cardX, cardY, cardW, cardH)

        // 卡片顶部红色细条
        ctx.setFillStyle('#CC0000')
        ctx.fillRect(cardX, cardY, cardW, 4 * r)

        // 二维码图片（直接用包路径，文件不存在时静默跳过不阻塞）
        const qrSize = 80 * r
        const qrX = cardX + 12 * r
        const qrY = cardY + (cardH - qrSize) / 2
        ctx.drawImage('/images/qrcode.png', qrX, qrY, qrSize, qrSize)

        // 右侧文字
        const textX = cardX + 12 * r + qrSize + 14 * r
        ctx.setTextAlign('left')
        ctx.setFillStyle('#CC0000')
        ctx.setFontSize(14 * r)
        ctx.fillText(copy.cta1, textX, cardY + 30 * r)
        ctx.setFillStyle('#555555')
        ctx.setFontSize(11 * r)
        ctx.fillText(copy.cta2, textX, cardY + 52 * r)
        ctx.fillText(copy.cta3, textX, cardY + 70 * r)
        ctx.setTextAlign('center')

        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          wx.canvasToTempFilePath({
            canvasId: 'poster-canvas',
            success: (res) => resolve(res.tempFilePath),
            fail: reject
          }, this)
        }
        // draw 回调不可靠时兜底：600ms 后强制导出
        ctx.draw(false, () => setTimeout(finish, 300))
        setTimeout(finish, 2500)
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
