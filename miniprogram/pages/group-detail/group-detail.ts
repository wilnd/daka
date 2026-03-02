// group-detail.ts
import { getGroupById, getGroupMembers, removeMember, quitGroup, transferAdmin, updateInviteCode, regenerateInviteCode } from '../../services/group'
import { usersCol } from '../../services/db'
import { checkinsCol } from '../../services/db'
import { getTodayStr } from '../../services/db'

const app = getApp<IAppOption>()
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Component({
  data: {
    groupId: '',
    group: {} as any,
    members: [] as any[],
    todayMembers: [] as any[],
    loading: true,
    isAdmin: false,
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
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1] as any
      const id = cur?.options?.id || ''
      this.setData({ groupId: id })
      this.load()
    },
  },
  methods: {
    async load() {
      const { groupId } = this.data
      const openid = app.globalData.openid
      if (!groupId || !openid) { this.setData({ loading: false }); return }
      try {
        const group = await getGroupById(groupId)
        if (!group) { wx.showToast({ title: '小组不存在', icon: 'none' }); wx.navigateBack(); return }
        const members = await getGroupMembers(groupId)
        const isAdmin = members.some((m: any) => m.userId === openid && m.role === 'admin')
        const today = getTodayStr()
        const { data: todayCheckins } = await checkinsCol()
          .where({ groupId, date: today })
          .get()
        const checkedIds = new Set((todayCheckins || []).map((c: any) => c.userId))

        const userIds = members.map((m: any) => m.userId)
        let membersWithUser: any[] = []
        if (userIds.length > 0) {
          const _ = wx.cloud.database().command
          const { data: users } = await usersCol()
            .where({
              openid: _.in(userIds)
            })
            .get()
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

        this.setData({
          group: group as any,
          members: membersWithUser,
          todayMembers: membersWithUser,
          loading: false,
          isAdmin
        })
      } catch (e) {
        console.error('load error:', e)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    copyInvite() {
      const code = this.data.group.inviteCode
      if (!code) return
      wx.setClipboardData({
        data: code,
        success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'none' }),
      })
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
    async doRegenerateInvite() {
      const openid = app.globalData.openid
      if (!openid) return

      wx.showModal({
        title: '重新生成邀请码',
        content: '确定要重新生成邀请码吗？旧邀请码将失效',
        success: async (res) => {
          if (!res.confirm) return
          wx.showLoading({ title: '生成中...' })
          try {
            const result = await regenerateInviteCode(this.data.groupId, openid)
            wx.hideLoading()
            if (result.ok) {
              wx.showToast({ title: '已生成新邀请码' })
              this.load()
            } else {
              wx.showToast({ title: result.msg || '生成失败', icon: 'none' })
            }
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '生成失败', icon: 'none' })
          }
        }
      })
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
