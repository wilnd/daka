// profile.ts
import { getStreak, getMissStreak, getTotalDays, wasCheckedInYesterday } from '../../services/stats'
import { checkinsCol, membersCol, usersCol, SUBSCRIBE_TEMPLATE_ID, getTodayStr } from '../../services/db'
import { updateUserInfo } from '../../services/auth'

const app = getApp() as IAppOption
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    hasUserInfo: false,
    userInfo: {} as any,
    stats: {} as any,
    showEditModal: false,
    showTimePickerModal: false,
    // 生成提醒文案时需要群组选择
    showGroupPickerModal: false,
    groups: [] as any[],
    editingInfo: { nickName: '', avatarUrl: defaultAvatar },
    isSubscribed: false,
    remindTime: '21:00',
    // 动态主题色
    themeColor: '#34A853',
  },
  lifetimes: {
    attached() { this.init() },
  },
  pageLifetimes: {
    show() {
      // 同步主题色
      this.setData({ themeColor: '#34A853' })
      if (this.data.hasUserInfo) this.loadData()
    },
  },
  methods: {
    init() {
      const ui = wx.getStorageSync('userInfo')
      if (ui && ui.nickName && ui.avatarUrl) {
        let avatarUrl = ui.avatarUrl
        // 如果不是有效的网络头像，使用默认头像
        if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
          avatarUrl = defaultAvatar
        }
        const userInfo = { ...ui, avatarUrl }
        wx.setStorageSync('userInfo', userInfo)
        this.setData({ hasUserInfo: true, userInfo })
        this.loadData()
        this.loadSubscriptionStatus()
      }
    },
    async loadSubscriptionStatus() {
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        const user = users[0] as any
        const isSubscribed = (user && user.subscribeRemindEnabled) === true
        const remindTime = (user && user.remindTime) || '21:00'
        this.setData({ isSubscribed, remindTime })
      } catch (e) {
        console.error('loadSubscriptionStatus error', e)
      }
    },
    async loadData() {
      const openid = app.globalData.openid
      if (!openid) return

      try {
        // 直接获取个人统计（与群组无关）
        const [streak, totalDays, missStreak] = await Promise.all([
          getStreak(openid),
          getTotalDays(openid),
          getMissStreak(openid),
        ])
        this.setData({ stats: { streak, totalDays, missStreak } })
      } catch (e) {
        console.error(e)
      }
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

    // 查看自己的成长墙
    onViewMyMoments(e: any) {
      const { userInfo } = this.data
      const openid = app.globalData.openid
      if (!openid || !userInfo) {
        wx.showToast({ title: '无法查看', icon: 'none' })
        return
      }

      const params = [
        `userId=${encodeURIComponent(openid)}`,
        `nickName=${encodeURIComponent(userInfo.nickName || '')}`,
        `avatarUrl=${encodeURIComponent(userInfo.avatarUrl || '')}`
      ].join('&')

      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
    onChooseAvatar(e: any) {
      const { avatarUrl } = e.detail
      this.setData({ 'editingInfo.avatarUrl': avatarUrl || this.data.editingInfo.avatarUrl })
    },
    onNicknameInput(e: any) {
      const nickName = e.detail.value || ''
      this.setData({ 'editingInfo.nickName': nickName })
    },
    async uploadAvatarIfNeeded(avatarUrl: string, openid: string): Promise<string> {
      // 如果已经是云存储路径，直接返回
      if (avatarUrl.startsWith('cloud://')) {
        return avatarUrl
      }
      // 如果是本地临时路径，需要上传到云存储
      if (avatarUrl.startsWith('/tmp/') || avatarUrl.startsWith('http://tmp/') || avatarUrl.startsWith('wxfile://')) {
        try {
          const cloudPath = `avatars/${openid}/${Date.now()}.jpg`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: avatarUrl,
          })
          return uploadRes.fileID
        } catch (e) {
          console.error('头像上传失败', e)
          // 上传失败时返回原路径
          return avatarUrl
        }
      }
      return avatarUrl
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
        // 如果选择了新头像，先上传到云存储
        const savedAvatarUrl = await this.uploadAvatarIfNeeded(avatarUrl, openid)
        await updateUserInfo(openid, nickName, savedAvatarUrl)
        wx.setStorageSync('userInfo', { nickName, avatarUrl: savedAvatarUrl })
        this.setData({
          hasUserInfo: true,
          userInfo: { nickName, avatarUrl: savedAvatarUrl },
          showEditModal: false
        })
        wx.showToast({ title: '保存成功' })
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        wx.hideLoading()
      }
    },
    async subscribeRemind() {
      const templateId = SUBSCRIBE_TEMPLATE_ID
      if (!templateId || templateId.startsWith('YOUR_')) {
        wx.showToast({ title: '请在代码中配置订阅消息模板ID', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return }

      // 如果已订阅，提供修改时间或取消订阅的选项
      if (this.data.isSubscribed) {
        wx.showActionSheet({
          itemList: ['修改提醒时间', '取消订阅'],
          success: async (res) => {
            if (res.tapIndex === 0) {
              this.setData({ showTimePickerModal: true })
            } else if (res.tapIndex === 1) {
              await this.updateSubscriptionStatus(openid, false)
              this.setData({ isSubscribed: false })
              wx.showToast({ title: '已取消订阅' })
            }
          }
        })
        return
      }

      // 请求订阅
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: async (res: any) => {
          if (res[templateId] === 'accept') {
            await this.updateSubscriptionStatus(openid, true)
            this.setData({ isSubscribed: true, showTimePickerModal: true })
          } else if (res[templateId] === 'reject') {
            wx.showToast({ title: '需要您同意接收通知', icon: 'none' })
          } else {
            wx.showToast({ title: '已取消', icon: 'none' })
          }
        },
        fail: () => wx.showToast({ title: '订阅失败', icon: 'none' }),
      })
    },
    onTimeChange(e: any) {
      this.setData({ remindTime: e.detail.value })
    },
    async saveRemindTime() {
      const openid = app.globalData.openid
      if (!openid) return
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        if (users.length > 0) {
          await usersCol().doc((users[0] as any)._id).update({
            data: { remindTime: this.data.remindTime }
          })
        }
        this.setData({ showTimePickerModal: false })
        wx.showToast({ title: '提醒时间已设置' })
      } catch (e) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    },
    hideTimePickerModal() {
      this.setData({ showTimePickerModal: false })
    },
    async updateSubscriptionStatus(openid: string, enabled: boolean) {
      try {
        const { data: users } = await usersCol().where({ openid }).get()
        if (users.length > 0) {
          await usersCol().doc((users[0] as any)._id).update({
            data: { subscribeRemindEnabled: enabled }
          })
        }
      } catch (e) {
        console.error('updateSubscriptionStatus error', e)
      }
    },
    async genRemindCopy() {
      // 先加载群组列表（如果还没有）
      if (this.data.groups.length === 0) {
        const { getMyGroups } = await import('../../services/group')
        const openid = app.globalData.openid
        if (!openid) return
        try {
          const groups = await getMyGroups(openid)
          this.setData({ groups })
        } catch (e) {
          wx.showToast({ title: '加载群组失败', icon: 'none' })
          return
        }
      }
      // 弹出群组选择弹窗
      this.setData({ showGroupPickerModal: true })
    },
    onSelectGroupForCopy(e: any) {
      const groupIndex = parseInt(e.currentTarget.dataset.index)
      const group = this.data.groups[groupIndex]
      this.setData({ showGroupPickerModal: false })
      this.doGenRemindCopy(group._id)
    },
    hideGroupPickerModal() {
      this.setData({ showGroupPickerModal: false })
    },
    async doGenRemindCopy(gid: string) {
      try {
        const today = getTodayStr()
        const { data: members } = await membersCol().where({ groupId: gid, status: 'normal' }).get()
        const userIds = (members || []).map((m: any) => m.userId).filter(Boolean)
        const checkedSet = new Set<string>()
        const db = wx.cloud.database()
        const _ = db.command
        const batchSize = 10
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          const { data: checked } = await checkinsCol().where({ userId: _.in(batch), date: today }).get()
          for (const c of (checked || []) as any[]) {
            if (c && c.userId) checkedSet.add(c.userId)
          }
        }
        const missList: any[] = []
        for (const m of members || []) {
          if (!checkedSet.has(m.userId)) {
            const { data: u } = await usersCol().where({ openid: m.userId }).get()
            const nick = ((u && u[0]) as any && (u[0] as any).nickName) || '未知'
            const missDays = await getMissStreak(m.userId, gid)
            const wasYesterday = await wasCheckedInYesterday(m.userId)
            const streak = wasYesterday ? await getStreak(m.userId, gid) : 0
            missList.push({ nick, missDays, wasYesterday, streak })
          }
        }
        if (missList.length === 0) {
          wx.showToast({ title: '今日全员已打卡' })
          return
        }
        // 生成文案：昨天打卡→显示连续天数+断掉风险；昨天未打卡→显示未打卡+鼓励
        const txt = missList.map(x => {
          if (x.wasYesterday && x.streak > 0) {
            return `@${x.nick} 已经连续运动${x.streak}天，今天还不运动会断掉连胜哦`
          } else {
            return `@${x.nick} 已连续${x.missDays}天未运动了，快快运动起来吧`
          }
        }).join('，')
        wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制' }) })
      } catch (e) {
        wx.showToast({ title: '生成失败', icon: 'none' })
      }
    },
  },
})
