// 小勤同学点评详情 - 展示单条点评全文，并支持生成该条点评的海报
// eslint-disable-next-line no-undef
const app = getApp();

Page({
  data: {
    themeColor: '#1ABC9C',
    loading: true,
    item: null,
    typeLabel: '',
    periodSuffix: '',
    showSharePoster: false,
    aiReviewPosterData: null
  },

  onLoad(options) {
    this.setData({ themeColor: app.globalData && app.globalData.themeColor ? app.globalData.themeColor : '#1ABC9C' });
    const type = options.type || '';
    const period = options.period || '';
    if (!type || !period) {
      this.setData({ loading: false, item: null });
      return;
    }
    const typeLabel = type === 'weekly' ? '周批注' : type === 'monthly' ? '月批注' : '年批注';
    const periodSuffix = type === 'yearly' ? ' 年' : '';
    this.setData({ typeLabel: typeLabel, periodSuffix: periodSuffix });
    this.loadDetail(type, period);
  },

  loadDetail(type, period) {
    var _this = this;
    this.setData({ loading: true });
    return wx.cloud.callFunction({
      name: 'moments',
      data: { action: 'getAnnotations' }
    }).then(function (res) {
      var payload = res && res.result != null ? res.result : {};
      var list = payload.success && Array.isArray(payload.data) ? payload.data : [];
      var item = list.find(function (a) { return a.type === type && String(a.period) === String(period); }) || null;
      _this.setData({ item: item, loading: false });
    }).catch(function (e) {
      console.error('拉取点评详情失败', e);
      _this.setData({ item: null, loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  onSharePoster() {
    var item = this.data.item;
    if (!item) return;
    var userInfo = wx.getStorageSync('userInfo') || {};
    var nickName = userInfo.nickName || '我';
    var text = (item.contentShort || item.content || '').trim();
    var weekly = item.type === 'weekly' ? text : '';
    var monthly = item.type === 'monthly' ? text : '';
    var yearly = item.type === 'yearly' ? text : '';
    var periodWeekly = item.type === 'weekly' ? item.period : '';
    var periodMonthly = item.type === 'monthly' ? item.period : '';
    var periodYearly = item.type === 'yearly' ? item.period : '';
    this.setData({
      aiReviewPosterData: {
        mode: 'aiReview',
        nickName: nickName,
        weekly: weekly,
        monthly: monthly,
        yearly: yearly,
        periodWeekly: periodWeekly,
        periodMonthly: periodMonthly,
        periodYearly: periodYearly
      },
      showSharePoster: true
    });
  },

  onClosePoster() {
    this.setData({ showSharePoster: false, aiReviewPosterData: null });
  }
});
