// group-detail.ts
import { getGroupById, getGroupMembers, removeMember, quitGroup, transferAdmin, updateInviteCode, updateGroup, dissolveGroup } from '../../services/group'
import { getOpenid } from '../../services/auth'
import { usersCol, checkinsCol, getTodayStr, getCurrentMonth } from '../../services/db'

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

Component({
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
    // 动态主题色
    themeColor: '#1ABC9C',
  },
  lifetimes: {
    attached() {
      // 页面加载时调用 onLoad（使用 nextTick 确保路由参数已注入）
      wx.nextTick(() => {
        this.onLoadInternal()
      })
    },
  },
  pageLifetimes: {
    show() {
      // 同步主题色
      this.setData({ themeColor: '#1ABC9C' })
      // 页面显示时刷新数据（可选）
    },
  },
  methods: {
    onLoadInternal() {
      // 从页面 options 中获取 groupId
      // 优先使用 this.options，其次使用 getCurrentPages() 获取当前页面参数
      let id = ''

      // 1. 组件化页面场景：this.options 中可能带有路由参数
      const selfAny = this as any
      const selfOptions = selfAny.options || {}
      if (selfOptions) {
        id = selfOptions.id || selfOptions.groupId || ''
      }

      // 2. 兜底：从当前页面栈中读取
      if (!id) {
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1] as any
        const pageOptions = (cur && cur.options) ? cur.options : {}
        id = pageOptions.id || pageOptions.groupId || ''
        console.log('group-detail attached, this.options:', selfOptions, 'page options:', pageOptions, 'id:', id)
      } else {
        console.log('group-detail attached, this.options:', selfOptions, 'id:', id)
      }

      // 3. 再兜底：使用全局当前组织 ID
      if (!id && app.globalData.currentGroupId) {
        id = app.globalData.currentGroupId
      }

      if (!id) {
        wx.showToast({ title: '参数错误', icon: 'none' })
        this.setData({ loading: false })
        return
      }

      this.setData({ groupId: id, loading: true })
      this.load()
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
        const db = wx.cloud.database()
        const _ = db.command

        const group = await getGroupById(groupId)
        if (!group) { wx.showToast({ title: '组织不存在', icon: 'none' }); wx.navigateBack(); return }
        const members = await getGroupMembers(groupId)
        if (!Array.isArray(members)) {
          wx.showToast({ title: '数据错误', icon: 'none' })
          return
        }
        const userIds = members.map((m: any) => m.userId).filter(Boolean)
        const isAdmin = members.some((m: any) => m.userId === openid && m.role === 'admin')
        // 判断当前用户是否是群主（创建者）
        const isCreator = (group as any).creatorId === openid
        
        const today = getTodayStr()
        const checkedIds = new Set<string>()
        const batchSize = 10
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize)
          const { data: todayCheckins } = await checkinsCol()
            .where({ userId: _.in(batch), date: today })
            .get()
          for (const c of (todayCheckins || []) as any[]) {
            if (c && c.userId) checkedIds.add(c.userId)
          }
        }

        let membersWithUser: any[] = []
        if (userIds.length > 0) {
          const users: any[] = []
          try {
            for (let i = 0; i < userIds.length; i += batchSize) {
              const batch = userIds.slice(i, i + batchSize)
              const { data } = await usersCol()
                .where({ openid: _.in(batch) })
                .get()
              users.push(...((data || []) as any[]))
            }
          } catch (e) {
            console.error('query users error:', e)
          }
          const userMap = new Map(users.map((u: any) => [u.openid, u]))
          membersWithUser = await Promise.all(members.map(async (m: any) => {
            const u = userMap.get(m.userId)
            let avatarUrl = (u && u.avatarUrl) || defaultAvatar
            // 如果不是有效的网络头像，使用默认头像
            if (!avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('https://')) {
              avatarUrl = defaultAvatar
            } else if (avatarUrl.startsWith('cloud://')) {
              // 转换云存储 URL 为临时 HTTP URL
              avatarUrl = await convertCloudUrl(avatarUrl)
            }
            return {
              ...m,
              _id: m._id,
              nickName: (u && u.nickName) || '未知',
              avatarUrl,
              checked: checkedIds.has(m.userId),
              isSelf: m.userId === openid
            }
          }))
        }

        // 记录排行 - 统计本月记录天数
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
          isCreator,
          inviteEnabled: (group as any).inviteEnabled !== false
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
      const { userId, nickName, avatarUrl } = selectedMember
      const params = [
        `userId=${encodeURIComponent(userId)}`,
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
            const myMember = members.find((m: any) => m.userId === openid)
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
    // 分享给好友
    onShareAppMessage() {
      const { group, inviteEnabled } = this.data
      if (!inviteEnabled || !group.inviteCode) {
        return {
          title: '快来加入我的组织吧',
          path: '/pages/group/group'
        }
      }
      return {
        title: `${group.name || '组织'} 邀请码：${group.inviteCode}，点击即可加入！`,
        path: `/pages/group/group?inviteCode=${group.inviteCode}`,
        imageUrl: ''
      }
    },
    // 分享到朋友圈
    onShareTimeline() {
      const { group, inviteEnabled } = this.data
      if (!inviteEnabled || !group.inviteCode) {
        return {
          title: group.name ? `${group.name} - 邀请你加入` : '快来加入组织吧',
          query: ''
        }
      }
      return {
        title: `${group.name || '组织'} 邀请码：${group.inviteCode}，点击即可加入！`,
        query: `inviteCode=${group.inviteCode}`
      }
    },
  },
})
