// group-detail.ts
import { getGroupById, getGroupMembers, removeMember, quitGroup, transferAdmin, updateInviteCode, updateGroup } from '../../services/group'
import { getOpenid } from '../../services/auth'
import { usersCol, checkinsCol, getTodayStr, getCurrentMonth } from '../../services/db'

const app = getApp<IAppOption>()
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    groupId: '',
    group: {} as any,
    members: [] as any[],
    todayMembers: [] as any[],
    rankMembers: [] as any[],
    loading: true,
    isAdmin: false,
    currentTab: 'today', // today | members | rank
    showMemberModal: false,
    showConfirmModal: false,
    showEditInviteModal: false,
    selectedMember: null as any,
    confirmTitle: '',
    confirmContent: '',
    confirmActionType: '',
    defaultAvatar,
    // 弹窗辅助变量
    selectedMemberNickName: '',
    selectedMemberAvatarUrl: '',
    canTransferAdmin: false,
    canRemoveMember: false,
    isSelfMember: false,
    // 邀请码编辑
    editInviteCode: '',
    // 邀请开关
    inviteEnabled: true,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1] as any
      const id = cur?.options?.id || cur?.options?.groupId || ''
      this.setData({ groupId: id, loading: true })
      this.load()
    },
  },
  methods: {
    async ensureOpenid() {
      let openid = app.globalData.openid || wx.getStorageSync('openid')
      if (openid && !app.globalData.openid) {
        app.globalData.openid = openid
      }
      if (!openid) {
        try {
          openid = await getOpenid()
          app.globalData.openid = openid
          wx.setStorageSync('openid', openid)
        } catch (e) {
          console.error('获取 openid 失败', e)
          return ''
        }
      }
      return openid
    },
    async load() {
      const { groupId } = this.data
      const openid = await this.ensureOpenid()
      if (!groupId || !openid) {
        this.setData({ loading: false })
        if (!groupId) wx.showToast({ title: '参数错误', icon: 'none' })
        return
      }
      try {
        const db = wx.cloud.database()
        const _ = db.command

        const group = await getGroupById(groupId)
        if (!group) { wx.showToast({ title: '小组不存在', icon: 'none' }); wx.navigateBack(); return }
        const members = await getGroupMembers(groupId)
        const isAdmin = members.some((m: any) => m.userId === openid && m.role === 'admin')

        const userIds = members.map((m: any) => m.userId)
        // 打卡与群组无关：只要用户今天打过卡，在其加入的任意群都视为已打卡
        const today = getTodayStr()
        const checkedIds = new Set<string>()
        const batchSize = 10
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          const { data: todayCheckins } = await checkinsCol()
            .where({ userId: _.in(batch), date: today })
            .get()
          for (const c of (todayCheckins || []) as any[]) {
            if (c?.userId) checkedIds.add(c.userId)
          }
        }

        let membersWithUser: any[] = []
        if (userIds.length > 0) {
          const users: any[] = []
          for (let i = 0; i < userIds.length; i += batchSize) {
            const batch = userIds.slice(i, i + batchSize)
            const { data } = await usersCol()
              .where({ openid: _.in(batch) })
              .get()
            users.push(...((data || []) as any[]))
          }
          const userMap = new Map(users.map((u: any) => [u.openid, u]))
          membersWithUser = members.map((m: any) => {
            const u = userMap.get(m.userId)
            return {
              ...m,
              _id: m._id,
              nickName: u?.nickName || '未知',
              avatarUrl: u?.avatarUrl || defaultAvatar,
              checked: checkedIds.has(m.userId),
              isSelf: m.userId === openid
            }
          })
        }

        // 打卡排行 - 统计本月打卡天数
        const currentMonth = getCurrentMonth()
        const monthDateRegExp = db.RegExp({
          regexp: `^${currentMonth}`,
          options: ''
        })
        const monthCheckins: any[] = []
        const limit = 100
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          let skip = 0
          while (true) {
            const { data } = await checkinsCol()
              .where({ userId: _.in(batch), date: monthDateRegExp })
              .orderBy('date', 'asc')
              .skip(skip)
              .limit(limit)
              .get()
            monthCheckins.push(...(data || []))
            if (!data || data.length < limit) break
            skip += limit
          }
        }
        const checkinCountMap = new Map<string, number>()
        ;(monthCheckins || []).forEach((c: any) => {
          const count = checkinCountMap.get(c.userId) || 0
          checkinCountMap.set(c.userId, count + 1)
        })
        const rankMembers = membersWithUser.map(m => ({
          ...m,
          checkinDays: checkinCountMap.get(m.userId) || 0
        })).sort((a, b) => b.checkinDays - a.checkinDays)

        this.setData({
          group: group as any,
          members: membersWithUser,
          todayMembers: membersWithUser,
          rankMembers,
          loading: false,
          isAdmin,
          inviteEnabled: (group as any).inviteEnabled !== false
        })
      } catch (e) {
        console.error('load error:', e)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    copyInvite() {
      const { group, inviteEnabled } = this.data
      if (!inviteEnabled) {
        wx.showToast({ title: '邀请已关闭', icon: 'none' })
        return
      }
      const code = group.inviteCode
      if (!code) return
      wx.setClipboardData({
        data: code,
        success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' }),
      })
    },
    async toggleInviteEnabled() {
      const openid = app.globalData.openid
      if (!openid) return
      const { inviteEnabled, groupId } = this.data
      const newValue = !inviteEnabled

      wx.showLoading({ title: '保存中...' })
      try {
        const result = await updateGroup(groupId, openid, { inviteEnabled: newValue })
        wx.hideLoading()
        if (result.ok) {
          wx.showToast({ title: newValue ? '邀请已开启' : '邀请已关闭' })
          this.setData({ inviteEnabled: newValue })
        } else {
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
        }
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },
    switchTab(e: any) {
      const tab = e.currentTarget.dataset.tab
      this.setData({ currentTab: tab })
    },
    showEditInvite() {
      this.setData({
        showEditInviteModal: true,
        editInviteCode: this.data.group.inviteCode || ''
      })
    },
    hideEditInvite() {
      this.setData({ showEditInviteModal: false, editInviteCode: '' })
    },
    onEditInviteInput(e: any) {
      this.setData({ editInviteCode: e.detail.value })
    },
    async doUpdateInvite() {
      const code = (this.data.editInviteCode || '').trim().toUpperCase()
      if (code.length < 4 || code.length > 10) {
        wx.showToast({ title: '邀请码长度4-10位', icon: 'none' })
        return
      }
      const openid = app.globalData.openid
      if (!openid) return

      wx.showLoading({ title: '保存中...' })
      try {
        const result = await updateInviteCode(this.data.groupId, openid, code)
        wx.hideLoading()
        if (result.ok) {
          wx.showToast({ title: '修改成功' })
          this.hideEditInvite()
          this.load()
        } else {
          wx.showToast({ title: result.msg || '修改失败', icon: 'none' })
        }
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '修改失败', icon: 'none' })
      }
    },
    onMemberTap(e: any) {
      const member = e.currentTarget.dataset.member
      if (!member) return
      const { isAdmin } = this.data
      this.setData({
        selectedMember: member,
        showMemberModal: true,
        selectedMemberNickName: member.nickName || '成员',
        selectedMemberAvatarUrl: member.avatarUrl || defaultAvatar,
        canTransferAdmin: isAdmin && member.role !== 'admin',
        canRemoveMember: isAdmin && member.role !== 'admin',
        isSelfMember: member.isSelf
      })
    },
    hideMemberModal() {
      this.setData({ showMemberModal: false })
    },
    hideConfirmModal() {
      this.setData({ showConfirmModal: false })
    },
    onTransferAdmin() {
      const { selectedMember } = this.data
      if (!selectedMember) return
      this.setData({
        confirmTitle: '转让组长',
        confirmContent: `确定将组长转让给 ${selectedMember.nickName} 吗？`,
        confirmActionType: 'transferAdmin',
        showMemberModal: false,
        showConfirmModal: true
      })
    },
    onRemoveMember() {
      const { selectedMember } = this.data
      if (!selectedMember) return
      this.setData({
        confirmTitle: '移除成员',
        confirmContent: `确定将 ${selectedMember.nickName} 移出小组吗？`,
        confirmActionType: 'removeMember',
        showMemberModal: false,
        showConfirmModal: true
      })
    },
    onQuitGroup() {
      this.setData({
        confirmTitle: '退出小组',
        confirmContent: '确定要退出该小组吗？',
        confirmActionType: 'quitGroup',
        showMemberModal: false,
        showConfirmModal: true
      })
    },
    async confirmAction() {
      const { confirmActionType, selectedMember, groupId } = this.data
      const openid = app.globalData.openid
      if (!openid) return

      let result: { ok: boolean; msg?: string }
      try {
        switch (confirmActionType) {
          case 'transferAdmin':
            result = await transferAdmin(selectedMember._id, openid)
            break
          case 'removeMember':
            result = await removeMember(selectedMember._id, openid)
            break
          case 'quitGroup':
            const members = this.data.members as any[]
            const myMember = members.find((m: any) => m.userId === openid)
            if (myMember) {
              result = await quitGroup(myMember._id, openid)
            } else {
              result = { ok: false, msg: '未找到你的小组信息' }
            }
            break
          default:
            result = { ok: false, msg: '未知操作' }
        }

        if (result.ok) {
          wx.showToast({ title: '操作成功' })
          this.hideConfirmModal()
          if (confirmActionType === 'quitGroup') {
            wx.navigateBack()
          } else {
            this.load()
          }
        } else {
          wx.showToast({ title: result.msg || '操作失败', icon: 'none' })
        }
      } catch (e) {
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },
  },
})
