// group-detail.ts
import { callGetGroupDetail, removeMember, quitGroup, transferAdmin, updateInviteCode, updateGroup, dissolveGroup } from '../../services/group'
import { getOpenid } from '../../services/auth'

const app = getApp() as IAppOption
const defaultAvatar = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

/** 将云存储 fileID 转换为临时可访问的 HTTP URL */
async function convertCloudUrl(fileId: string): Promise<string> {
  if (!fileId) return defaultAvatar
  if (!fileId.startsWith('cloud://')) return fileId
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileId] })
    if (res.fileList && res.fileList[0]) {
      // 检查是否有错误
      if (res.fileList[0].status !== 0) {
        console.warn('云存储文件获取失败:', res.fileList[0].errMsg || '未知错误')
        return defaultAvatar  // 返回默认头像
      }
      if (res.fileList[0].tempFileURL) {
        return res.fileList[0].tempFileURL
      }
    }
  } catch (e) {
    console.warn('转换云存储URL失败', e)
  }
  return defaultAvatar  // 转换失败返回默认头像
}

Page({
  data: {
    groupId: '',
    group: {} as any,
    members: [] as any[],
    todayMembers: [] as any[],
    rankMembers: [] as any[],
    loading: true,
    isAdmin: false,
    isCreator: false,
    currentTab: 'today', // today | members | rank
    showMemberModal: false,
    showConfirmModal: false,
    showEditInviteModal: false,
    selectedMember: null as any,
    confirmTitle: '',
    confirmContent: '',
    confirmActionType: '',
    defaultAvatar,
    selectedMemberNickName: '',
    selectedMemberAvatarUrl: '',
    canTransferAdmin: false,
    canRemoveMember: false,
    isSelfMember: false,
    editInviteCode: '',
    inviteEnabled: true,
    themeColor: '#1ABC9C',
  },
  onLoad(options: Record<string, string | undefined>) {
    const id = (options && (options.id || options.groupId)) || app.globalData.currentGroupId || ''
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      this.setData({ loading: false })
      return
    }
    this.setData({ groupId: id, loading: true })
    this.load()
  },
  onShow() {
    this.setData({ themeColor: '#1ABC9C' })
  },
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
        const result = await callGetGroupDetail(groupId)
        if (!result.success || !result.data) {
          if (result.error === '组织不存在') {
            wx.showToast({ title: '组织不存在', icon: 'none' })
            wx.navigateBack()
          } else {
            wx.showToast({ title: result.error || '加载失败', icon: 'none' })
          }
          this.setData({ loading: false })
          return
        }
        const { group, members: membersFromCloud, rankMembers: rankFromCloud, isAdmin, isCreator, inviteEnabled } = result.data
        // 云存储头像转临时链接（客户端才能调 getTempFileURL）
        const membersWithAvatar = await Promise.all((membersFromCloud || []).map(async (m: any) => {
          let avatarUrl = m.avatarUrl || defaultAvatar
          if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
            avatarUrl = defaultAvatar
          } else if (avatarUrl.startsWith('cloud://')) {
            avatarUrl = await convertCloudUrl(avatarUrl)
          }
          return { ...m, avatarUrl }
        }))
        const rankMembers = await Promise.all((rankFromCloud || []).map(async (m: any) => {
          let avatarUrl = m.avatarUrl || defaultAvatar
          if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
            avatarUrl = defaultAvatar
          } else if (avatarUrl.startsWith('cloud://')) {
            avatarUrl = await convertCloudUrl(avatarUrl)
          }
          return { ...m, avatarUrl }
        }))
        this.setData({
          group: group as any,
          members: membersWithAvatar,
          todayMembers: membersWithAvatar,
          rankMembers,
          loading: false,
          isAdmin,
          isCreator,
          inviteEnabled: inviteEnabled !== false
        })
      } catch (e: any) {
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

      // 点击自己，跳转到成长墙
      if (member.isSelf) {
        wx.navigateTo({
          url: '/pages/moments/moments'
        })
        return
      }

      const { isAdmin, isCreator } = this.data
      this.setData({
        selectedMember: member,
        showMemberModal: true,
        selectedMemberNickName: member.nickName || '成员',
        selectedMemberAvatarUrl: member.avatarUrl || defaultAvatar,
        canTransferAdmin: isAdmin && member.role !== 'admin',
        // 只有群主才能移除成员，且不能移除自己
        canRemoveMember: isCreator && !member.isSelf,
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
        confirmContent: `确定将 ${selectedMember.nickName} 移出组织吗？`,
        confirmActionType: 'removeMember',
        showMemberModal: false,
        showConfirmModal: true
      })
    },
    onQuitGroup() {
      this.setData({
        confirmTitle: '退出组织',
        confirmContent: '确定要退出该组织吗？',
        confirmActionType: 'quitGroup',
        showMemberModal: false,
        showConfirmModal: true
      })
    },
    onViewMoments() {
      const { selectedMember } = this.data
      if (!selectedMember) return
      const { openid, nickName, avatarUrl } = selectedMember
      const params = [
        `openid=${encodeURIComponent(openid)}`,
        `nickName=${encodeURIComponent(nickName || '')}`,
        `avatarUrl=${encodeURIComponent(avatarUrl || '')}`
      ].join('&')
      wx.navigateTo({
        url: `/pages/user-moments/user-moments?${params}`
      })
    },
    onDissolveGroup() {
      this.setData({
        confirmTitle: '解散组织',
        confirmContent: '确定要解散该组织吗？解散后所有成员将被移除，且无法恢复。',
        confirmActionType: 'dissolveGroup',
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
            const myMember = members.find((m: any) => m.openid === openid)
            if (myMember) {
              result = await quitGroup(myMember._id, openid)
            } else {
              result = { ok: false, msg: '未找到你的组织信息' }
            }
            break
          case 'dissolveGroup':
            result = await dissolveGroup(groupId, openid)
            break
          default:
            result = { ok: false, msg: '未知操作' }
        }

        if (result.ok) {
          wx.showToast({ title: '操作成功' })
          this.hideConfirmModal()
          if (confirmActionType === 'quitGroup' || confirmActionType === 'dissolveGroup') {
            // 退出或解散组织后，返回组织列表页
            wx.navigateBack({ delta: 1 })
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
    // 分享给好友（带上邀请人 openid，用于邀请业务埋点）
    onShareAppMessage() {
      const { group, inviteEnabled } = this.data
      const openid = app.globalData.openid
      if (!inviteEnabled || !group.inviteCode) {
        return {
          title: '快来加入我的组织吧',
          path: '/pages/group/group'
        }
      }
      const query = openid ? `inviteCode=${group.inviteCode}&inviterOpenid=${openid}` : `inviteCode=${group.inviteCode}`
      return {
        title: `${group.name || '组织'} 邀请码：${group.inviteCode}，点击即可加入！`,
        path: `/pages/group/group?${query}`,
        imageUrl: ''
      }
    },
    // 分享到朋友圈（带上邀请人 openid，用于邀请业务埋点）
    onShareTimeline() {
      const { group, inviteEnabled } = this.data
      const openid = app.globalData.openid
      if (!inviteEnabled || !group.inviteCode) {
        return {
          title: group.name ? `${group.name} - 邀请你加入` : '快来加入组织吧',
          query: ''
        }
      }
      const query = openid ? `inviteCode=${group.inviteCode}&inviterOpenid=${openid}` : `inviteCode=${group.inviteCode}`
      return {
        title: `${group.name || '组织'} 邀请码：${group.inviteCode}，点击即可加入！`,
        query
      }
    },
})
