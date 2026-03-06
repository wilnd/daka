// calendar.ts
import { getCheckinsByMonth, doMakeup, getMakeupRemain } from '../../services/checkin'
import { getTodayStr, getDateBefore } from '../../services/db'

const app = getApp() as IAppOption

Component({
  data: {
    yearMonth: '',
    displayMonth: '',
    days: [] as any[],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    makeupRemain: 0,
    isCurrentMonth: true,
    hasOpenid: false,
    themeColor: '#34A853',
    // 选中日期及当天记录
    selectedDate: '',
    selectedCheckins: [] as any[],
    checkinsMap: {} as Record<string, any[]>,
  },
  lifetimes: {
    attached() { this.init() },
  },
  pageLifetimes: {
    show() {
      this.setData({ themeColor: '#34A853' })
      if (this.data.hasOpenid) this.load()
    },
  },
  methods: {
    init() {
      const openid = app.globalData.openid
      const now = new Date()
      const ym = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      const today = getTodayStr()
      this.setData({
        hasOpenid: !!openid,
        yearMonth: ym,
        displayMonth: this.fmtMonth(ym),
        isCurrentMonth: true,
        selectedDate: today,   // 默认选中今天
      })
      if (openid) this.load()
    },
    fmtMonth(ym: string) {
      const [y, m] = ym.split('-')
      return `${y}年${parseInt(m)}月`
    },
    pad(n: number) { return n < 10 ? '0' + n : String(n) },
    formatTime(createTime: any): string {
      if (!createTime) return ''
      const d = new Date(createTime)
      if (isNaN(d.getTime())) return ''
      const h = d.getHours().toString().padStart(2, '0')
      const min = d.getMinutes().toString().padStart(2, '0')
      return `${h}:${min}`
    },
    prevMonth() {
      const [y, m] = this.data.yearMonth.split('-').map(Number)
      const d = new Date(y, m - 2, 1)
      const ym = `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`
      this.setData({ yearMonth: ym, displayMonth: this.fmtMonth(ym), selectedDate: '', selectedCheckins: [] })
      this.updateCurrentMonth()
      this.load()
    },
    nextMonth() {
      if (this.data.isCurrentMonth) return
      const [y, m] = this.data.yearMonth.split('-').map(Number)
      const d = new Date(y, m, 1)
      const ym = `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`
      this.setData({ yearMonth: ym, displayMonth: this.fmtMonth(ym), selectedDate: '', selectedCheckins: [] })
      this.updateCurrentMonth()
      this.load()
    },
    goToday() {
      const now = new Date()
      const ym = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      this.setData({ yearMonth: ym, displayMonth: this.fmtMonth(ym), isCurrentMonth: true, selectedDate: '', selectedCheckins: [] })
      this.load()
    },
    updateCurrentMonth() {
      const now = new Date()
      const currentYm = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      this.setData({ isCurrentMonth: this.data.yearMonth === currentYm })
    },
    async load() {
      const { yearMonth } = this.data
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const [checkins, makeupRemain] = await Promise.all([
          getCheckinsByMonth(openid, '', yearMonth),
          getMakeupRemain(openid),
        ])

        // 按日期分组，保存完整记录（每天可多次打卡）
        const checkinsMap: Record<string, any[]> = {}
        for (const c of checkins) {
          if (!checkinsMap[c.date]) checkinsMap[c.date] = []
          checkinsMap[c.date].push({ ...c, timeStr: this.formatTime(c.createTime) })
        }

        const [y, m] = yearMonth.split('-').map(Number)
        const firstDay = new Date(y, m - 1, 1).getDay()
        const lastDay = new Date(y, m, 0).getDate()
        const today = getTodayStr()
        const canMakeupStart = getDateBefore(today, 3)
        const canMakeupEnd = getDateBefore(today, 1)
        const days: any[] = []
        for (let i = 0; i < firstDay; i++) days.push({ empty: true, date: `empty-${i}`, day: 0 })
        for (let d = 1; d <= lastDay; d++) {
          const date = `${yearMonth}-${this.pad(d)}`
          const dayCheckins = checkinsMap[date] || []
          const checked = dayCheckins.length > 0
          const makeup = checked && dayCheckins.some((c: any) => c.isMakeup)
          const canMakeup = !checked && date >= canMakeupStart && date <= canMakeupEnd
          const isToday = date === today
          days.push({ date, day: d, checked, makeup, canMakeup, isToday, empty: false })
        }

        // 若当前有选中日期则刷新它的记录
        const { selectedDate } = this.data
        const selectedCheckins = selectedDate && checkinsMap[selectedDate] ? checkinsMap[selectedDate] : []

        this.setData({ days, makeupRemain, checkinsMap, selectedCheckins })
      } catch (e) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    async onDayTap(e: any) {
      const { date, can, checked } = e.currentTarget.dataset
      if (!date || (date as string).startsWith('empty')) return

      if (checked) {
        // 已打卡：切换选中，展示当天记录
        if (this.data.selectedDate === date) {
          this.setData({ selectedDate: '', selectedCheckins: [] })
        } else {
          const selectedCheckins = this.data.checkinsMap[date] || []
          this.setData({ selectedDate: date, selectedCheckins })
        }
        return
      }

      // 未打卡：清除选中
      this.setData({ selectedDate: '', selectedCheckins: [] })

      if (!can) return

      wx.showModal({
        title: '补卡',
        content: `确认补卡 ${date}？`,
        success: async (res) => {
          if (!res.confirm) return
          try {
            const r = await doMakeup(app.globalData.openid!, date)
            if (r.ok) {
              wx.showModal({
                title: '补卡成功',
                content: '补卡不计入排行榜，只在个人连胜显示',
                showCancel: false,
                confirmText: '知道了',
                success: () => {
                  this.load()
                  const pages = getCurrentPages()
                  const indexPage = pages.find(p => p.route === 'pages/index/index')
                  if (indexPage) (indexPage as any).loadData(true)
                  wx.switchTab({ url: '/pages/index/index' })
                }
              })
            } else {
              wx.showToast({ title: r.msg || '补卡失败', icon: 'none' })
            }
          } catch {
            wx.showToast({ title: '补卡失败', icon: 'none' })
          }
        },
      })
    },
  },
})
