// 小勤同学点评(AI) - 查看周/月/年批注并分享成海报
const app = getApp() as IAppOption

interface AnnotationItem {
  _id?: string
  type: 'weekly' | 'monthly' | 'yearly'
  period: string
  content: string
  contentShort?: string
  createTime: string
  weekDisplay?: string
  listKey?: string
}

Page({
  data: {
    themeColor: '#1ABC9C',
    loading: true,
    generating: false,
    annotations: [] as AnnotationItem[],
    weeklyList: [] as AnnotationItem[],
    monthlyList: [] as AnnotationItem[],
    yearlyList: [] as AnnotationItem[],
    aiReviewQuota: 0,
    aiReviewUsed: 0,
    aiReviewRemaining: 0
  },

  onLoad() {
    this.setData({ themeColor: (app.globalData && app.globalData.themeColor) || '#1ABC9C' })
    this.loadAnnotations()
    this.loadQuota()
  },

  async loadQuota() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'generateMomentAnnotations',
        data: { action: 'getQuota' }
      })
      const result = (res && res.result != null ? res.result : {}) as { success?: boolean; quota?: number; used?: number; remaining?: number }
      if (result && result.success && result.quota != null) {
        this.setData({
          aiReviewQuota: result.quota != null ? result.quota : 0,
          aiReviewUsed: result.used != null ? result.used : 0,
          aiReviewRemaining: Math.max(0, result.remaining != null ? result.remaining : 0)
        })
      }
    } catch (e) {
      console.error('拉取点评配额失败', e)
    }
  },

  onShow() {
    if (this.data.themeColor !== ((app.globalData && app.globalData.themeColor) || '#1ABC9C')) {
      this.setData({ themeColor: (app.globalData && app.globalData.themeColor) || '#1ABC9C' })
    }
  },

  async onGenerate(e: WechatMiniprogram.TouchEvent) {
    const action = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.action) as 'weekly' | 'monthly' | 'yearly'
    if (!action) return
    this.setData({ generating: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'generateMomentAnnotations',
        data: { action }
      })
      const result = (res && res.result != null ? res.result : {}) as {
        success?: boolean
        msg?: string
        period?: string
        data?: { type: string; period: string; content: string; contentShort?: string; createTime?: any }
      }
      if (result && result.success) {
        wx.showToast({ title: '点评已生成', icon: 'success' })
        if (result.data && typeof result.data === 'object') {
          this.mergeGeneratedAnnotation(result.data as AnnotationItem)
        }
        await this.loadAnnotations()
        this.loadQuota()
      } else {
        wx.showToast({ title: (result && result.msg) || '生成失败', icon: 'none' })
      }
    } catch (err: any) {
      console.error('生成点评失败', err)
      const msg = (err && err.errMsg && String(err.errMsg).includes('504003'))
        ? '生成超时（约 3 秒），请在云开发控制台将云函数「generateMomentAnnotations」超时时间改为 60 秒'
        : '生成失败'
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ generating: false })
    }
  },

  /** 周 period（YYYY-Www）转展示文案：2025年第3周 */
  formatWeekDisplay(period: string): string {
    if (!period) return period
    const m = String(period).match(/^(\d{4})-W(\d{1,2})$/)
    if (m) return `${m[1]}年第${parseInt(m[2], 10)}周`
    return period
  },

  /** 周 period（YYYY-Www）解析为可比较的数值，用于倒序 */
  parseWeekPeriod(period: string): { y: number; w: number } {
    const m = String(period || '').match(/^(\d{4})-W(\d{1,2})$/)
    if (m) return { y: parseInt(m[1], 10), w: parseInt(m[2], 10) }
    return { y: 0, w: 0 }
  },

  /** 按 period 倒序、同 period 内按 createTime 倒序，周列表附加 weekDisplay、listKey */
  buildSortedLists(list: AnnotationItem[]) {
    const sortByCreateTimeDesc = (a: AnnotationItem, b: AnnotationItem) => {
      const tA = a.createTime ? new Date(a.createTime).getTime() : 0
      const tB = b.createTime ? new Date(b.createTime).getTime() : 0
      return tB - tA
    }
    const sortWeeklyByPeriodThenCreateTime = (a: AnnotationItem, b: AnnotationItem) => {
      if (a.period !== b.period) {
        const pa = this.parseWeekPeriod(a.period)
        const pb = this.parseWeekPeriod(b.period)
        if (pa.y !== pb.y) return pb.y - pa.y
        return pb.w - pa.w
      }
      return sortByCreateTimeDesc(a, b)
    }
    const sortByPeriodThenCreateTime = (a: AnnotationItem, b: AnnotationItem) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period)
      return sortByCreateTimeDesc(a, b)
    }
    const weekly = (list.filter((a: AnnotationItem) => a.type === 'weekly') as AnnotationItem[])
      .sort(sortWeeklyByPeriodThenCreateTime)
      .map((a, i) => ({
        ...a,
        weekDisplay: this.formatWeekDisplay(a.period),
        listKey: `w_${a.period}_${a.createTime || i}`
      }))
    const monthly = (list.filter((a: AnnotationItem) => a.type === 'monthly') as AnnotationItem[])
      .sort(sortByPeriodThenCreateTime)
      .map((a, i) => ({ ...a, listKey: `m_${a.period}_${a.createTime || i}` }))
    const yearly = (list.filter((a: AnnotationItem) => a.type === 'yearly') as AnnotationItem[])
      .sort(sortByPeriodThenCreateTime)
      .map((a, i) => ({ ...a, listKey: `y_${a.period}_${a.createTime || i}` }))
    return { weeklyList: weekly, monthlyList: monthly, yearlyList: yearly }
  },

  mergeGeneratedAnnotation(item: AnnotationItem) {
    const base = this.data.annotations
    const list = Array.isArray(base) ? [...base] : []
    const newItem: AnnotationItem = {
      type: item.type as 'weekly' | 'monthly' | 'yearly',
      period: item.period,
      content: item.content,
      contentShort: item.contentShort,
      createTime: item.createTime
    }
    list.unshift(newItem)
    const { weeklyList, monthlyList, yearlyList } = this.buildSortedLists(list)
    this.setData({
      annotations: list,
      weeklyList,
      monthlyList,
      yearlyList
    })
  },

  async loadAnnotations() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: { action: 'getAnnotations' }
      })
      const payload = (res && res.result != null ? res.result : {}) as { success?: boolean; data?: AnnotationItem[]; msg?: string }
      const rawList = (payload.success && Array.isArray(payload.data)) ? payload.data : []
      const list = Array.isArray(rawList) ? rawList : []
      const { weeklyList, monthlyList, yearlyList } = this.buildSortedLists(list)
      this.setData({
        annotations: list,
        weeklyList,
        monthlyList,
        yearlyList,
        loading: false
      })
    } catch (e) {
      console.error('拉取批注失败', e)
      this.setData({
        annotations: [],
        weeklyList: [],
        monthlyList: [],
        yearlyList: [],
        loading: false
      })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onCardTap(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget && e.currentTarget.dataset
    const type = (ds && ds.type) as string
    const period = (ds && ds.period) as string
    const id = (ds && ds.id) as string
    if (!type || !period) return
    let url = `/pages/ai-review-detail/ai-review-detail?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}`
    if (id) url += `&id=${encodeURIComponent(id)}`
    wx.navigateTo({ url })
  },

  periodLabel(type: string, period: string): string {
    if (type === 'weekly') return `第 ${period.replace(/^.*W/, '')} 周`
    if (type === 'monthly') return period
    if (type === 'yearly') return `${period} 年`
    return period
  }
})
