// profile.ts
import { getMyGroups } from '../../services/group'
import { getCheckinRecords } from '../../services/checkin'
import { getStreak, getMissStreak, getTotalDays } from '../../services/stats'
import { checkinsCol, membersCol } from '../../services/db'
import { usersCol } from '../../services/db'
import { getTodayStr } from '../../services/db'
import { updateUserInfo } from '../../services/auth'

const app = getApp<IAppOption>()
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    hasUserInfo: false,
    userInfo: {} as any,
    currentGroup: null as any,
    stats: {} as any,
    records: [] as any[],
    showRecordsModal: false,
    showEditModal: false,
    editingInfo: { nickName: '', avatarUrl: defaultAvatar },
  },
  lifetimes: {
    attached() { this.init() },
    show() { if (this.data.hasUserInfo) this.loadData() },
  },
  methods: {
    init() {
      const ui = wx.getStorageSync('userInfo')
      if (ui?.nickName && ui?.avatarUrl) {
        this.setData({ hasUserInfo: true, userInfo: ui })
        this.loadData()
      }
    },
    async loadData() {
      const openid = app.globalData.openid
      const gid = app.globalData.currentGroupId
      if (!openid) return
      try {
        const groups = await getMyGroups(openid)
        const cur = groups.find((g: any) => g._id === gid) || groups[0] || null
        let stats = {}
        if (cur) {
          const [streak, totalDays, missStreak] = await Promise.all([
            getStreak(openid, cur._id),
            getTotalDays(openid, cur._id),
            getMissStreak(openid, cur._id),
          ])
          stats = { streak, totalDays, missStreak }
        }
        this.setData({ currentGroup: cur, stats })
      } catch (e) {
        console.error(e)
      }
    },
    async showRecords() {
      const gid = this.data.currentGroup?._id
      if (!gid) { wx.showToast({ title: '请先选择小组', icon: 'none' }); return }
      wx.showLoading({ title: '加载中' })
      try {
        const records = await getCheckinRecords(app.globalData.openid!, gid)
        const groupName = this.data.currentGroup?.name || ''
        const recordsWithGroup = records.map((r: any) => ({ ...r, groupName }))
        this.setData({ records: recordsWithGroup, showRecordsModal: true })
        wx.hideLoading()
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    hideRecords() {
      this.setData({ showRecordsModal: false })
    },
    onEditUserInfo() {
      this.setData({
        showEditModal: true,
        editingInfo: { ...this.data.userInfo }
      })
    },
    hideEditModal() {
      this.setData({ showEditModal: false })
    },
    onChooseAvatar(e: any) {
      const { avatarUrl } = e.detail
      this.setData({ 'editingInfo.avatarUrl': avatarUrl || this.data.editingInfo.avatarUrl })
    },
    onNicknameInput(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'editingInfo.nickName': nickName })
    },
    async saveUserInfo() {
      const { nickName, avatarUrl } = this.data.editingInfo
      if (!nickName || !avatarUrl) {
        wx.showToast({ title: '请填写昵称并选择头像', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }
      wx.showLoading({ title: '保存中' })
      try {
        await updateUserInfo(openid, nickName, avatarUrl)
        wx.setStorageSync('userInfo', { nickName, avatarUrl })
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName, avatarUrl },
          showEditModal: false
        })
        wx.showToast({ title: '保存成功' })
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },
    subscribeRemind() {
      const templateId = 'YOUR_SUBSCRIBE_TEMPLATE_ID'
      if (!templateId || templateId.startsWith('YOUR_')) {
        wx.showToast({ title: '请在代码中配置订阅消息模板ID', icon: 'none' })
        return
      }
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (res: any) => {
          if (res[templateId] === 'accept') wx.showToast({ title: '订阅成功' })
          else wx.showToast({ title: '已取消', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '订阅失败', icon: 'none' }),
      })
    },
    async genRemindCopy() {
      const gid = this.data.currentGroup?._id
      if (!gid) { wx.showToast({ title: '请先选择小组', icon: 'none' }); return }
      try {
        const today = getTodayStr()
        const { data: members } = await membersCol().where({ groupId: gid, status: 'normal' }).get()
        const { data: checked } = await checkinsCol().where({ groupId: gid, date: today }).get()
        const checkedSet = new Set((checked || []).map((c: any) => c.userId))
        const missList: any[] = []
        for (const m of members || []) {
          if (!checkedSet.has(m.userId)) {
            const { data: u } = await usersCol().where({ openid: m.userId }).get()
            const nick = (u?.[0] as any)?.nickName || '未知'
            const missDays = await (await import('../../services/stats')).getMissStreak(m.userId, gid)
            missList.push({ nick, missDays })
          }
        }
        if (missList.length === 0) {
          wx.showToast({ title: '今日全员已打卡' })
          return
        }
        const txt = missList.map(x => `@${x.nick} 已连续${x.missDays}天未打卡`).join('，')
        wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制' }) })
      } catch (e) {
        wx.showToast({ title: '生成失败', icon: 'none' })
      }
    },
  },
})
