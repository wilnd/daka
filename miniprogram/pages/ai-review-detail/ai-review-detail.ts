// 小勤同学点评详情 - 展示单条点评全文，并支持生成该条点评的海报
const app = getApp() as IAppOption

interface AnnotationItem {
  _id?: string
  type: 'weekly' | 'monthly' | 'yearly'
  period: string
  content: string
  contentShort?: string
  createTime: string
}

Page({
  data: {
    themeColor: '#1ABC9C',
    loading: true,
    item: null as AnnotationItem | null,
    typeLabel: '',
    periodSuffix: '',
    showSharePoster: false,
    aiReviewPosterData: null as any
  },

  onLoad(options: { type?: string; period?: string; id?: string }) {
    this.setData({ themeColor: (app.globalData && app.globalData.themeColor) || '#1ABC9C' })
    const type = (options.type || '') as 'weekly' | 'monthly' | 'yearly'
    const period = options.period || ''
    const id = options.id || ''
    if (!type || !period) {
      this.setData({ loading: false, item: null })
      return
    }
    const typeLabel = type === 'weekly' ? '周批注' : type === 'monthly' ? '月批注' : '年批注'
    const periodSuffix = type === 'yearly' ? ' 年' : ''
    this.setData({ typeLabel, periodSuffix })
    this.loadDetail(type, period, id)
  },

  async loadDetail(type: string, period: string, idParam?: string) {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'moments',
        data: { action: 'getAnnotations' }
      })
      const payload = (res && res.result != null ? res.result : {}) as { success?: boolean; data?: AnnotationItem[] }
      const list = (payload.success && Array.isArray(payload.data)) ? payload.data : []
      let item: AnnotationItem | null = null
      if (idParam) {
        item = list.find((a: AnnotationItem) => String(a._id) === String(idParam)) || null
      }
      if (!item) {
        item = list.find((a: AnnotationItem) => a.type === type && String(a.period) === String(period)) || null
      }
      this.setData({ item, loading: false })
    } catch (e) {
      console.error('拉取点评详情失败', e)
      this.setData({ item: null, loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onSharePoster() {
    const item = this.data.item as AnnotationItem | null
    if (!item) return
    const userInfo = wx.getStorageSync('userInfo') || {}
    const nickName = (userInfo as any).nickName || '我'
    const text = (item.contentShort || item.content || '').trim()
    const weekly = item.type === 'weekly' ? text : ''
    const monthly = item.type === 'monthly' ? text : ''
    const yearly = item.type === 'yearly' ? text : ''
    const periodWeekly = item.type === 'weekly' ? item.period : ''
    const periodMonthly = item.type === 'monthly' ? item.period : ''
    const periodYearly = item.type === 'yearly' ? item.period : ''
    this.setData({
      aiReviewPosterData: {
        mode: 'aiReview',
        nickName,
        weekly,
        monthly,
        yearly,
        periodWeekly,
        periodMonthly,
        periodYearly
      },
      showSharePoster: true
    })
  },

  onClosePoster() {
    this.setData({ showSharePoster: false, aiReviewPosterData: null })
  }
})
