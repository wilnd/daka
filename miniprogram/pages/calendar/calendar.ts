// calendar.ts
import { getCheckinsByMonth, doMakeup, getMakeupRemain } from '../../services/checkin'
import { getTodayStr, getDateBefore } from '../../services/db'

const app = getApp<IAppOption>()

Component({
  data: {
    currentGroup: null as any,
    yearMonth: '',
    displayMonth: '',
    days: [] as any[],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    makeupRemain: 0,
    isCurrentMonth: true,
  },
  lifetimes: {
    attached() { this.init() },
    show() { if (this.data.currentGroup) this.load() },
  },
  methods: {
    init() {
      const gid = app.globalData.currentGroupId
      const now = new Date()
      const ym = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      this.setData({
        currentGroup: gid ? { _id: gid } : null as any,
        yearMonth: ym,
        displayMonth: this.fmtMonth(ym),
        isCurrentMonth: true,
      })
      this.load()
    },
    fmtMonth(ym: string) {
      const [y, m] = ym.split('-')
      return `${y}年${parseInt(m)}月`
    },
    pad(n: number) { return n < 10 ? '0' + n : String(n) },
    prevMonth() {
      const [y, m] = this.data.yearMonth.split('-').map(Number)
      const d = new Date(y, m - 2, 1)
      const ym = `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`
      this.setData({ yearMonth: ym, displayMonth: this.fmtMonth(ym) })
      this.updateCurrentMonth()
      this.load()
    },
    nextMonth() {
      if (this.data.isCurrentMonth) return
      const [y, m] = this.data.yearMonth.split('-').map(Number)
      const d = new Date(y, m, 1)
      const ym = `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}`
      this.setData({ yearMonth: ym, displayMonth: this.fmtMonth(ym) })
      this.updateCurrentMonth()
      this.load()
    },
    goToday() {
      const now = new Date()
      const ym = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      this.setData({
        yearMonth: ym,
        displayMonth: this.fmtMonth(ym),
        isCurrentMonth: true,
      })
      this.load()
    },
    updateCurrentMonth() {
      const now = new Date()
      const currentYm = `${now.getFullYear()}-${this.pad(now.getMonth() + 1)}`
      this.setData({ isCurrentMonth: this.data.yearMonth === currentYm })
    },
    async load() {
      const { currentGroup, yearMonth } = this.data
      const openid = app.globalData.openid
      if (!openid || !currentGroup) return
      const gid = typeof currentGroup === 'object' ? currentGroup._id : currentGroup
      if (!gid) return
      try {
        const [checkins, makeupRemain] = await Promise.all([
          getCheckinsByMonth(openid, gid, yearMonth),
          getMakeupRemain(openid),
        ])
        const checkMap = new Map<string, { isMakeup: boolean }>()
        for (const c of checkins) {
          checkMap.set(c.date, { isMakeup: c.isMakeup })
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
          const info = checkMap.get(date)
          const checked = !!info
          const makeup = info?.isMakeup || false
          const canMakeup = !checked && date >= canMakeupStart && date <= canMakeupEnd
          days.push({ date, day: d, checked, makeup, canMakeup, empty: false })
        }
        this.setData({
          days,
          makeupRemain,
          currentGroup: { _id: gid },
        })
      } catch (e) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    async onDayTap(e: any) {
      const { date, can, checked } = e.currentTarget.dataset
      if (!date || checked) return
      if (!can) {
        wx.showToast({ title: '仅可补近3天内未打卡', icon: 'none' })
        return
      }
      wx.showModal({
        title: '补卡',
        content: `确认补卡 ${date}？`,
        success: async (res) => {
          if (!res.confirm) return
          const gid = this.data.currentGroup?._id
          if (!gid) return
          try {
            const r = await doMakeup(app.globalData.openid!, gid, date)
            if (r.ok) {
              wx.showToast({ title: '补卡成功' })
              this.load()
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
