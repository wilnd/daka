// share-poster.ts
// 静态导入，避免小程序动态 import 解析为 http URL 导致 Failed to fetch
import { getStreakFromCheckinStats } from '../../services/stats'

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
    },
    // 是否为周日（用于显示AI总结）
    isSunday: {
      type: Boolean,
      value: false
    },
    // 打卡页传入的当前连胜天数（本地查询为 0 时用此值，与特效一致）
    currentStreak: {
      type: Number,
      value: 0
    },
    // 海报模式：空为打卡分享，aiReview 为小勤同学点评海报
    mode: {
      type: String,
      value: ''
    },
    // 小勤点评海报数据：{ nickName, weekly, monthly, yearly, periodWeekly?, periodMonthly?, periodYearly? }
    aiReviewData: {
      type: Object,
      value: null
    }
  },

  data: {
    posterGenerated: false,
    posterUrl: '',
    streak: 0,
    userInfo: null,
    canvasWidth: 300,
    canvasHeight: 540,
    posterLoading: true,
    // AI总结相关
    weekSummary: '',
    showAISummary: false
  },

  lifetimes: {
    created() {
      // 尽早挂到实例上，避免渲染层在首帧调用 _getData/getData 时报错（defineProperty 保证存在且不被覆盖）
      const self = this
      const getDataFn = function () { return self.data }
      try {
        Object.defineProperty(this, '_getData', { value: getDataFn, writable: true, configurable: true })
        Object.defineProperty(this, 'getData', { value: getDataFn, writable: true, configurable: true })
      } catch (_) {
        this._getData = getDataFn
        this.getData = getDataFn
      }
    },
    attached() {
      const userInfo = wx.getStorageSync('userInfo')
      this.setData({ userInfo })

      // 预计算 canvas 尺寸
      const ratio = wx.getSystemInfoSync().windowWidth / 375
      this.setData({ 
        canvasWidth: 300 * ratio, 
        canvasHeight: 540 * ratio 
      })
      // 再次确保渲染层可用的 _getData/getData（部分环境下 created 与渲染层不同步）
      const self = this
      const getDataFn = function () { return self.data }
      if (typeof this._getData !== 'function') this._getData = getDataFn
      if (typeof this.getData !== 'function') this.getData = getDataFn
    },
    ready() {
      const self = this
      const getDataFn = function () { return self.data }
      if (typeof this._getData !== 'function') this._getData = getDataFn
      if (typeof this.getData !== 'function') this.getData = getDataFn
    }
  },

  observers: {
    'visible': function(visible) {
      if (visible && !this.data.posterGenerated) {
        const mode = this.properties.mode
        setTimeout(() => {
          if (mode === 'aiReview') {
            this.generateAIPoster()
          } else {
            this.generatePoster()
          }
        }, 80)
      } else if (visible && this.data.posterGenerated) {
        this.setData({ posterLoading: false })
      }
    }
  },

  methods: {
    /** 兼容渲染层：部分环境下会调用 _getData/getData，attached 中已挂到实例，此处保留以兼容 methods 调用 */
    _getData() {
      return this.data
    },
    getData() {
      return this.data
    },

    /** 日期类型：工作日 / 周末 / 法定假日 */
    getDayType(): 'workday' | 'weekend' | 'holiday' {
      const today = new Date()
      const year = today.getFullYear()
      const month = today.getMonth() + 1
      const day = today.getDate()
      if (this.isStatutoryHoliday(year, month, day)) return 'holiday'
      const dayOfWeek = today.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) return 'weekend'
      return 'workday'
    },

    /** 中国法定节假日（阳历近似，含调休区间） */
    isStatutoryHoliday(year: number, month: number, day: number): boolean {
      const ranges: { year?: number; month: number; start: number; end: number }[] = [
        { month: 1, start: 1, end: 1 },
        { year: 2025, month: 1, start: 28, end: 31 },
        { year: 2025, month: 2, start: 1, end: 4 },
        { year: 2026, month: 2, start: 17, end: 24 },
        { month: 4, start: 4, end: 6 },
        { month: 5, start: 1, end: 5 },
        { year: 2025, month: 5, start: 31, end: 31 },
        { year: 2026, month: 6, start: 19, end: 19 },
        { year: 2025, month: 10, start: 1, end: 7 },
        { year: 2026, month: 9, start: 25, end: 25 },
        { year: 2026, month: 10, start: 1, end: 7 },
      ]
      for (const range of ranges) {
        if (range.year !== undefined && range.year !== year) continue
        if (range.month !== month) continue
        if (day >= range.start && day <= range.end) return true
      }
      return false
    },

    // 判断是否为周日（优先使用props传入的值）
    isSundayMethod(): boolean {
      if (this.properties.isSunday !== undefined) {
        return this.properties.isSunday
      }
      const today = new Date()
      return today.getDay() === 0
    },

    // 获取本周开始日期（周一）
    getWeekStartDate(): string {
      const today = new Date()
      const day = today.getDay()
      const diff = today.getDate() - day + (day === 0 ? -6 : 1)
      const weekStart = new Date(today.setDate(diff))
      const year = weekStart.getFullYear()
      const month = ('0' + (weekStart.getMonth() + 1)).slice(-2)
      const dayStr = ('0' + weekStart.getDate()).slice(-2)
      return year + '-' + month + '-' + dayStr
    },

    /** 格式：2026第x周 03.02~03.08（上周一至上周日） */
    getWeekLabelForPoster(): string {
      const today = new Date()
      const day = today.getDay()
      const diff = today.getDate() - day + (day === 0 ? -6 : 1)
      const thisMonday = new Date(today.getFullYear(), today.getMonth(), diff)
      const monday = new Date(thisMonday)
      monday.setDate(monday.getDate() - 7)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      const year = monday.getFullYear()
      const pad = (n: number) => ('0' + n).slice(-2)
      const mondayStr = pad(monday.getMonth() + 1) + '.' + pad(monday.getDate())
      const sundayStr = pad(sunday.getMonth() + 1) + '.' + pad(sunday.getDate())
      const jan1 = new Date(year, 0, 1)
      const jan1Day = jan1.getDay()
      const firstMondayOffset = jan1Day === 0 ? -6 : 1 - jan1Day
      const firstMonday = new Date(year, 0, 1 + firstMondayOffset)
      const weekNum = 1 + Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
      return `${year}第${weekNum}周 ${mondayStr}~${sundayStr}`
    },

    // 获取一周打卡数据
    async getWeekCheckinData(openid: string): Promise<{ checkins: any[], totalDays: number, totalCount: number }> {
      const db = wx.cloud.database()
      const weekStart = this.getWeekStartDate()
      const today = new Date()
      const todayYear = today.getFullYear()
      const todayMonth = ('0' + (today.getMonth() + 1)).slice(-2)
      const todayDay = ('0' + today.getDate()).slice(-2)
      const todayStr = todayYear + '-' + todayMonth + '-' + todayDay

      try {
        const _ = db.command
        const checkinsRes = await db.collection('checkins')
          .where({
            _openid: openid,
            date: _.and(_.gte(weekStart), _.lte(todayStr))
          })
          .orderBy('date', 'asc')
          .get()

        const checkins = checkinsRes.data || []
        const uniqueDates = new Set(checkins.map((c: any) => c.date))

        return {
          checkins,
          totalDays: uniqueDates.size,
          totalCount: checkins.length
        }
      } catch (e) {
        console.error('获取周数据失败', e)
        return { checkins: [], totalDays: 0, totalCount: 0 }
      }
    },

    // 调用云函数获取AI一周总结（兼容多种返回结构）
    async getAISummary(openidParam: string): Promise<string> {
      try {
        const res = await wx.cloud.callFunction({
          name: 'getWeekSummary',
          data: { _openid: openidParam }
        }) as any
        const raw = res && (res.result !== undefined ? res.result : res)
        if (!raw) {
          console.warn('[分享海报] getWeekSummary 返回为空', res)
          return ''
        }
        const s = typeof raw.summary === 'string' ? raw.summary.trim() : ''
        if (s) return s
        if (raw.success === false && raw.msg) {
          console.warn('[分享海报] getWeekSummary 失败:', raw.msg)
        }
        return ''
      } catch (e) {
        console.error('[分享海报] 获取AI总结失败', e)
        return ''
      }
    },

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

    /** 小勤同学点评海报：仅用 aiReviewData 生成 */
    async generateAIPoster() {
      const aiReviewData = this.properties.aiReviewData
      if (!aiReviewData || aiReviewData.mode !== 'aiReview') {
        this.setData({ posterLoading: false })
        wx.showToast({ title: '点评数据为空', icon: 'none' })
        return
      }
      this.setData({ posterLoading: true })
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      try {
        const posterUrl = await Promise.race([
          this.drawAIPoster(aiReviewData),
          timeout
        ])
        this.setData({ posterGenerated: true, posterUrl, posterLoading: false })
      } catch (e) {
        console.error('生成点评海报失败', e)
        this.setData({ posterLoading: false })
        wx.showToast({ title: '生成海报失败', icon: 'none' })
      }
    },

    async generatePoster() {
      const checkinData = this.properties.checkinData || {}
      const app = getApp() as any
      const openid = (app && app.globalData && app.globalData.openid) || wx.getStorageSync('openid') || ''
      const isSunday = this.isSundayMethod()

      this.setData({ posterLoading: true })

      // 连胜直接查 checkinStats 表（与打卡页一致，数据权威）；使用静态导入避免动态 import 失败
      let streak = 0
      if (openid) {
        try {
          streak = await getStreakFromCheckinStats(openid)
        } catch (e) {
          console.error('获取连胜失败', e)
        }
      }
      // 优先使用打卡页传入的 currentStreak（刚打卡后取较大值避免显示 0）
      const fromParent = this.properties.currentStreak || 0
      streak = Math.max(streak, fromParent)

      this.setData({ streak })

      const dayType = this.getDayType()
      // 仅周末且为周日时获取 AI 周总结；工作日、法定假日不展示
      let weekSummary = ''
      let showAISummary = false
      if (dayType === 'weekend' && isSunday && openid) {
        try {
          weekSummary = await this.getAISummary(openid)
          if (!weekSummary || !weekSummary.trim()) {
            const weekData = await this.getWeekCheckinData(openid)
            if (weekData.totalDays > 0) {
              weekSummary = `本周打卡 ${weekData.totalDays} 天，共 ${weekData.totalCount} 次记录，坚持就是胜利～`
              showAISummary = true
            }
          } else {
            showAISummary = true
          }
        } catch (e) {
          console.error('获取AI总结失败', e)
          try {
            const weekData = await this.getWeekCheckinData(openid)
            if (weekData.totalDays > 0) {
              weekSummary = `本周打卡 ${weekData.totalDays} 天，共 ${weekData.totalCount} 次，继续加油！`
              showAISummary = true
            }
          } catch (e2) {
            console.error('获取周数据兜底失败', e2)
          }
        }
      }
      this.setData({ weekSummary, showAISummary })

      // 生成海报（含超时保底，防止永久卡在 loading）
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 8000)
      )
      try {
        const posterUrl = await Promise.race([
          this.drawPoster(dayType, streak, checkinData, { weekSummary, showAISummary }),
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

    /** 按打卡类型返回一条励志文案（从储备库中选取） */
    getMottoByCategory(categoryId: string, streak: number): string {
      const lib: Record<string, string[]> = {
        sports: [
          '每一次迈步，都在靠近更好的自己',
          '动起来，世界就是你的跑道',
          '汗水不会骗人，坚持必有回响',
          '身体和灵魂，都要在路上',
          '今天你运动了吗？',
          '自律给我自由',
          '运动是治愈一切的良药',
        ],
        study: [
          '每天进步一点点，时间会给你答案',
          '学习是回报最高的投资',
          '读书破万卷，下笔如有神',
          '今天的努力，是明天的底气',
          '学而不思则罔，思而不学则殆',
          '持续学习，终身成长',
          '知识就是力量',
        ],
        life: [
          '记录生活，留住美好',
          '每一天都值得被记住',
          '用心生活，自有回响',
          '小确幸积累成幸福',
          '生活不在别处，在此刻',
          '认真记录的人，不会被生活辜负',
          '把日子过成诗',
        ],
        work: [
          '专注当下，成就未来',
          '把每一件小事做到极致',
          '效率来自日复一日的积累',
          '今日事今日毕',
          '工作是最好的修行',
          '专业成就价值',
          '坚持复盘，持续精进',
        ],
      }
      const list = lib[categoryId] || lib['sports']
      const idx = Math.floor(Math.random() * list.length)
      return list[idx]
    },

    async drawPoster(dayType: 'workday' | 'weekend' | 'holiday', streak: number, checkinData: any, aiSummary?: { weekSummary: string, showAISummary: boolean }): Promise<string> {
      const weekSummary = (aiSummary && aiSummary.weekSummary) || ''
      const showAISummary = !!(aiSummary && aiSummary.showAISummary)
      const hasAISummary = dayType === 'weekend' && showAISummary && weekSummary && weekSummary.trim()

      const userInfo = this.data.userInfo
      const r = wx.getSystemInfoSync().windowWidth / 375
      const W0 = 300
      const pad = 20 * r
      const cardRad = 18 * r
      const summaryMaxLines = 7
      const summaryLineH = 20 * r
      const summaryPad = 16 * r
      const summaryBlockH = hasAISummary
        ? (summaryPad * 2 + 24 * r + summaryMaxLines * summaryLineH)
        : 0
      const mainCardTop = 24 * r
      const mainCardPad = 20 * r
      const gap = 24 * r
      const labelY = mainCardTop + mainCardPad + 18 * r
      const streakY = labelY + 12 * r + gap + 24 * r
      const streakLabelY = streakY + 24 * r + 10 * r + 6 * r
      const mottoGap = 18 * r
      const mottoY = streakLabelY + 12 * r + mottoGap + 6 * r
      const dividerY = mottoY + 6 * r + mottoGap
      // 姓名+时间区域高度
      const userRowH = 36 * r
      const nickY = dividerY + 10 * r
      const tagY = dividerY + userRowH + 14 * r
      const mainCardH = tagY - mainCardTop + 22 * r + mainCardPad
      const summaryCardTop = mainCardTop + mainCardH + 16 * r
      const qrCardH = 88 * r
      const qrCardGap = 16 * r
      const H0 = hasAISummary
        ? (summaryCardTop + summaryBlockH + qrCardGap + qrCardH + 24 * r)
        : (mainCardTop + mainCardH + qrCardGap + qrCardH + 24 * r)

      const W = W0 * r
      const H = H0
      const cx = W / 2
      const cardX = pad
      const cardW = W - pad * 2
      const qrCardY = hasAISummary ? summaryCardTop + summaryBlockH + qrCardGap : mainCardTop + mainCardH + qrCardGap
      const qrSize = 64 * r
      const qrPad = 16 * r
      const qrX = cardX + qrPad
      const qrY = qrCardY + (qrCardH - qrSize) / 2

      this.setData({ canvasWidth: W, canvasHeight: H })

      const categoryId = checkinData.categoryId || 'sports'
      const bigCategoryNames: Record<string, string> = {
        sports: '运动',
        study: '学习',
        life: '生活',
        work: '工作',
      }
      const bigName = ((checkinData.categoryName || '').trim() || bigCategoryNames[categoryId] || '运动')
      const smallName = (checkinData.subCategoryName || '').trim() || (checkinData.categoryName || '').trim() || bigName
      const typeSubText = bigName === smallName ? bigName : bigName + '·' + smallName
      const copyMap: Record<string, { streakLabel: string; cta: string }> = {
        sports: { streakLabel: '连续打卡', cta: '扫码加入，一起成长' },
        study:  { streakLabel: '连续打卡', cta: '扫码加入，一起成长' },
        life:   { streakLabel: '连续打卡', cta: '扫码加入，一起成长' },
        work:   { streakLabel: '连续打卡', cta: '扫码加入，一起成长' },
      }
      const copy = copyMap[categoryId] || copyMap['sports']
      let motto = this.getMottoByCategory(categoryId, streak)
      if (motto.length > 18) motto = motto.slice(0, 17) + '…'
      const isHoliday = dayType === 'holiday'
      const accent = isHoliday ? '#b8860b' : '#2d7d6e'
      const accentLight = isHoliday ? '#f0e6c8' : '#e8f2f0'

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          this.createSelectorQuery()
            .in(this)
            .select('#poster-canvas')
            .fields({ node: true })
            .exec((res) => {
              if (!res || !res[0] || !res[0].node) {
                reject(new Error('canvas node not found'))
                return
              }
              const canvas = res[0].node as WechatMiniprogram.Canvas
              const dpr = wx.getSystemInfoSync().pixelRatio || 2
              canvas.width = W * dpr
              canvas.height = H * dpr
              const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
              ctx.scale(dpr, dpr)

              const roundRect = (x: number, y: number, w: number, h: number, radius: number) => {
                ctx.beginPath()
                ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5)
                ctx.arc(x + w - radius, y + radius, radius, Math.PI * 1.5, 0)
                ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI * 0.5)
                ctx.arc(x + radius, y + h - radius, radius, Math.PI * 0.5, Math.PI)
                ctx.closePath()
              }

              // 背景：浅色渐变
              const bg = ctx.createLinearGradient(0, 0, 0, H)
              bg.addColorStop(0, '#f5f2ee')
              bg.addColorStop(1, '#ebe8e2')
              ctx.fillStyle = bg as unknown as string
              ctx.fillRect(0, 0, W, H)

              // 主卡片（白底 + 阴影）
              ctx.shadowOffsetX = 0
              ctx.shadowOffsetY = 4 * r
              ctx.shadowBlur = 16 * r
              ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
              ctx.fillStyle = '#ffffff'
              roundRect(cardX, mainCardTop, cardW, mainCardH, cardRad)
              ctx.fill()
              ctx.shadowColor = 'transparent'
              ctx.shadowBlur = 0
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
              ctx.lineWidth = 1
              roundRect(cardX, mainCardTop, cardW, mainCardH, cardRad)
              ctx.stroke()

              ctx.textAlign = 'center'
              ctx.fillStyle = accent
              ctx.font = `600 ${18 * r}px sans-serif`
              ctx.fillText('我的成长助手', cx, labelY)
              if (isHoliday) {
                ctx.fillStyle = '#b8860b'
                ctx.font = `${11 * r}px sans-serif`
                ctx.fillText('假期也在坚持', cx, labelY + 18 * r)
              }

              const streakStr = streak.toString()
              ctx.fillStyle = accent
              ctx.font = `600 ${48 * r}px sans-serif`
              ctx.fillText(streakStr + ' 天', cx, streakY)
              ctx.fillStyle = '#999'
              ctx.font = `${12 * r}px sans-serif`
              ctx.fillText(copy.streakLabel, cx, streakLabelY)
              ctx.fillStyle = '#555'
              ctx.font = `${12 * r}px sans-serif`
              ctx.fillText(motto, cx, mottoY)

              ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)'
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(cardX + mainCardPad, dividerY)
              ctx.lineTo(cardX + cardW - mainCardPad, dividerY)
              ctx.stroke()

                      const nickName = userInfo && (userInfo as { nickName?: string }).nickName
              const displayName = (nickName || '运动达人').substring(0, 8)
              const now = new Date()
              const dateStr = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`
              ctx.textAlign = 'center'
              ctx.fillStyle = '#333'
              ctx.font = `${14 * r}px sans-serif`
              ctx.fillText(displayName, cx, nickY)
              ctx.fillStyle = '#999'
              ctx.font = `${11 * r}px sans-serif`
              ctx.fillText(dateStr, cx, nickY + 14 * r)

              if (typeSubText) {
                ctx.fillStyle = accentLight
                const tagW = Math.min((typeSubText.length * 12 + 28) * r, cardW - mainCardPad * 2)
                roundRect(cx - tagW / 2, tagY, tagW, 22 * r, 11 * r)
                ctx.fill()
                ctx.fillStyle = accent
                ctx.font = `${11 * r}px sans-serif`
                ctx.fillText(typeSubText, cx, tagY + 14 * r)
              }

              if (hasAISummary) {
                ctx.fillStyle = '#ffffff'
                ctx.shadowOffsetY = 4 * r
                ctx.shadowBlur = 12 * r
                ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
                roundRect(cardX, summaryCardTop, cardW, summaryBlockH, cardRad)
                ctx.fill()
                ctx.shadowColor = 'transparent'
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
                roundRect(cardX, summaryCardTop, cardW, summaryBlockH, cardRad)
                ctx.stroke()
                ctx.fillStyle = '#666'
                ctx.font = `${12 * r}px sans-serif`
                ctx.fillText('本周总结', cx, summaryCardTop + summaryPad + 18 * r)
                const summaryLines = this.wrapText(weekSummary, 14).slice(0, summaryMaxLines)
                ctx.fillStyle = '#444'
                ctx.font = `${13 * r}px sans-serif`
                summaryLines.forEach((line: string, i: number) => {
                  ctx.fillText(line, cx, summaryCardTop + summaryPad + 24 * r + 18 * r + (i + 1) * summaryLineH)
                })
              }

              ctx.fillStyle = '#ffffff'
              ctx.shadowOffsetY = 4 * r
              ctx.shadowBlur = 12 * r
              ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
              roundRect(cardX, qrCardY, cardW, qrCardH, cardRad)
              ctx.fill()
              ctx.shadowColor = 'transparent'
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
              roundRect(cardX, qrCardY, cardW, qrCardH, cardRad)
              ctx.stroke()
              ctx.fillStyle = accent
              ctx.fillRect(cardX, qrCardY, cardW, 3 * r)
              ctx.fillStyle = '#333'
              ctx.font = `${15 * r}px sans-serif`
              ctx.textAlign = 'left'
              ctx.fillText(copy.cta, cardX + qrPad + qrSize + 14 * r, qrCardY + qrCardH / 2 + 6 * r)
              ctx.textAlign = 'center'

              const img = canvas.createImage()
              img.onload = () => {
                ctx.drawImage(img as unknown as CanvasImageSource, qrX, qrY, qrSize, qrSize)
                wx.canvasToTempFilePath({
                  canvas,
                  success: (res) => resolve(res.tempFilePath),
                  fail: reject
                })
              }
              img.onerror = () => reject(new Error('qrcode load failed'))
              img.src = '/images/qrcode.png'
            })
        }, 50)
      })
    },

    /** 绘制小勤同学点评海报（与打卡海报同套浅色卡片风格，布局更舒展） */
    drawAIPoster(aiReviewData: any): Promise<string> {
      const r = wx.getSystemInfoSync().windowWidth / 375
      const W0 = 300
      const pad = 24 * r
      const cardRad = 18 * r
      const W = W0 * r
      const nickName = (aiReviewData.nickName || '我').toString().slice(0, 8)
      const weekly = (aiReviewData.weekly || '').trim()
      const monthly = (aiReviewData.monthly || '').trim()
      const yearly = (aiReviewData.yearly || '').trim()
      const lineH = 22 * r
      const maxLinesPerBlock = 6
      const weeklyMaxLines = 10
      const weeklyCharsPerLine = 16
      const blockGap = 22 * r
      const blockLabelH = 26 * r
      const contentPadV = 20 * r
      const contentPadH = 20 * r
      let contentH = 0
      const blocks: { label: string; lines: string[] }[] = []
      if (yearly) {
        blocks.push({ label: '年批注', lines: this.wrapText(yearly, 14).slice(0, maxLinesPerBlock) })
        contentH += blockLabelH + blocks[blocks.length - 1].lines.length * lineH + blockGap
      }
      if (monthly) {
        blocks.push({ label: '月批注', lines: this.wrapText(monthly, 14).slice(0, maxLinesPerBlock) })
        contentH += blockLabelH + blocks[blocks.length - 1].lines.length * lineH + blockGap
      }
      if (weekly) {
        blocks.push({ label: '周批注', lines: this.wrapText(weekly, weeklyCharsPerLine).slice(0, weeklyMaxLines) })
        contentH += blockLabelH + blocks[blocks.length - 1].lines.length * lineH + blockGap
      }
      if (contentH < 80 * r) contentH = 80 * r
      contentH += contentPadV * 2
      const qrCardH = 96 * r
      const topCardTop = 28 * r
      const topCardH = 118 * r
      const cardGap = 24 * r
      const contentCardTop = topCardTop + topCardH + cardGap
      const qrCardY = contentCardTop + contentH + cardGap
      const H = qrCardY + qrCardH + 32 * r
      this.setData({ canvasWidth: W, canvasHeight: H })

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          this.createSelectorQuery()
            .in(this)
            .select('#poster-canvas')
            .fields({ node: true })
            .exec((res) => {
              if (!res || !res[0] || !res[0].node) {
                reject(new Error('canvas node not found'))
                return
              }
              const canvas = res[0].node as WechatMiniprogram.Canvas
              const dpr = wx.getSystemInfoSync().pixelRatio || 2
              canvas.width = W * dpr
              canvas.height = H * dpr
              const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
              ctx.scale(dpr, dpr)

              const roundRect = (x: number, y: number, w: number, h: number, radius: number) => {
                ctx.beginPath()
                ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5)
                ctx.arc(x + w - radius, y + radius, radius, Math.PI * 1.5, 0)
                ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI * 0.5)
                ctx.arc(x + radius, y + h - radius, radius, Math.PI * 0.5, Math.PI)
                ctx.closePath()
              }

              const accent = '#2d7d6e'
              const cx = W / 2
              const cardX = pad
              const cardW = W - pad * 2
              const qrSize = 64 * r
              const qrPad = 16 * r
              const qrX = cardX + qrPad
              const qrY = qrCardY + (qrCardH - qrSize) / 2

              const bg = ctx.createLinearGradient(0, 0, 0, H)
              bg.addColorStop(0, '#f5f2ee')
              bg.addColorStop(1, '#ebe8e2')
              ctx.fillStyle = bg as unknown as string
              ctx.fillRect(0, 0, W, H)

              ctx.shadowOffsetX = 0
              ctx.shadowOffsetY = 4 * r
              ctx.shadowBlur = 16 * r
              ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
              ctx.fillStyle = '#ffffff'
              roundRect(cardX, topCardTop, cardW, topCardH, cardRad)
              ctx.fill()
              ctx.shadowColor = 'transparent'
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
              roundRect(cardX, topCardTop, cardW, topCardH, cardRad)
              ctx.stroke()

              ctx.fillStyle = accent
              ctx.font = `600 ${15 * r}px sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText('小勤(AI)点评', cx, topCardTop + 22 * r)

              const avatarR = 22 * r
              const avatarY = topCardTop + 56 * r
              const userInfo = this.data.userInfo as { avatarUrl?: string; nickName?: string } | null
              const avatarUrl = userInfo && userInfo.avatarUrl && (userInfo.avatarUrl.startsWith('http') || userInfo.avatarUrl.startsWith('https') || userInfo.avatarUrl.startsWith('/') || userInfo.avatarUrl.startsWith('wxfile://')) ? userInfo.avatarUrl : ''
              const firstLetter = (nickName || '我').slice(0, 1)

              const drawAvatarLetter = () => {
                ctx.fillStyle = '#e8f2f0'
                ctx.beginPath()
                ctx.arc(cx, avatarY, avatarR, 0, 2 * Math.PI)
                ctx.fill()
                ctx.fillStyle = accent
                ctx.font = `600 ${24 * r}px sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(firstLetter, cx, avatarY)
              }
              const drawTopCardRest = () => {
                ctx.fillStyle = '#333'
                ctx.font = `${14 * r}px sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'alphabetic'
                ctx.fillText(nickName + ' 的成长点评', cx, topCardTop + 96 * r)
                ctx.fillStyle = '#999'
                ctx.font = `${11 * r}px sans-serif`
                ctx.fillText(this.getWeekLabelForPoster(), cx, topCardTop + 112 * r)
              }
              const drawContentAndQr = () => {
                ctx.fillStyle = '#ffffff'
                ctx.shadowOffsetY = 4 * r
                ctx.shadowBlur = 12 * r
                ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
                roundRect(cardX, contentCardTop, cardW, contentH, cardRad)
                ctx.fill()
                ctx.shadowColor = 'transparent'
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
                roundRect(cardX, contentCardTop, cardW, contentH, cardRad)
                ctx.stroke()
                let y = contentCardTop + contentPadV
                for (const block of blocks) {
                  ctx.fillStyle = '#666'
                  ctx.font = `${13 * r}px sans-serif`
                  ctx.fillText(block.label, cx, y)
                  y += blockLabelH
                  ctx.fillStyle = '#444'
                  ctx.font = `${13 * r}px sans-serif`
                  block.lines.forEach((line: string) => {
                    ctx.fillText(line, cx, y)
                    y += lineH
                  })
                  y += blockGap
                }
                ctx.fillStyle = '#ffffff'
                ctx.shadowOffsetY = 4 * r
                ctx.shadowBlur = 12 * r
                ctx.shadowColor = 'rgba(0, 0, 0, 0.06)'
                roundRect(cardX, qrCardY, cardW, qrCardH, cardRad)
                ctx.fill()
                ctx.shadowColor = 'transparent'
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)'
                roundRect(cardX, qrCardY, cardW, qrCardH, cardRad)
                ctx.stroke()
                ctx.fillStyle = accent
                ctx.fillRect(cardX, qrCardY, cardW, 3 * r)
                ctx.fillStyle = '#333'
                ctx.font = `${15 * r}px sans-serif`
                ctx.textAlign = 'left'
                ctx.fillText('扫码加入，一起成长', cardX + qrPad + qrSize + 14 * r, qrCardY + qrCardH / 2 + 6 * r)
                ctx.textAlign = 'center'
                const qrImg = canvas.createImage()
                qrImg.onload = () => {
                  ctx.drawImage(qrImg as unknown as CanvasImageSource, qrX, qrY, qrSize, qrSize)
                  wx.canvasToTempFilePath({
                    canvas,
                    success: (res) => resolve(res.tempFilePath),
                    fail: reject
                  })
                }
                qrImg.onerror = () => reject(new Error('qrcode load failed'))
                qrImg.src = '/images/qrcode.png'
              }

              ctx.save()
              ctx.beginPath()
              ctx.arc(cx, avatarY, avatarR, 0, 2 * Math.PI)
              ctx.closePath()
              ctx.clip()
              if (avatarUrl) {
                const img = canvas.createImage()
                img.onload = () => {
                  ctx.drawImage(img as unknown as CanvasImageSource, cx - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2)
                  ctx.restore()
                  drawTopCardRest()
                  drawContentAndQr()
                }
                img.onerror = () => {
                  ctx.restore()
                  drawAvatarLetter()
                  ctx.strokeStyle = 'rgba(0,0,0,0.06)'
                  ctx.lineWidth = 1
                  ctx.beginPath()
                  ctx.arc(cx, avatarY, avatarR, 0, 2 * Math.PI)
                  ctx.stroke()
                  drawTopCardRest()
                  drawContentAndQr()
                }
                img.src = avatarUrl
              } else {
                drawAvatarLetter()
                ctx.restore()
                ctx.strokeStyle = 'rgba(0,0,0,0.06)'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.arc(cx, avatarY, avatarR, 0, 2 * Math.PI)
                ctx.stroke()
                drawTopCardRest()
                drawContentAndQr()
              }
            })
        }, 50)
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

    // 文字换行处理
    wrapText(text: string, maxCharsPerLine: number): string[] {
      const lines: string[] = []
      let currentLine = ''

      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === '\n') {
          lines.push(currentLine)
          currentLine = ''
        } else if (currentLine.length >= maxCharsPerLine) {
          lines.push(currentLine)
          currentLine = char
        } else {
          currentLine += char
        }
      }

      if (currentLine) {
        lines.push(currentLine)
      }

      return lines
    },

    preventTap() {}
  }
})
