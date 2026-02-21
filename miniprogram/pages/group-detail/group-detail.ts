// group-detail.ts
import { getGroupById, getGroupMembers } from '../../services/group'
import { usersCol } from '../../services/db'
import { checkinsCol } from '../../services/db'
import { getTodayStr } from '../../services/db'

const app = getApp<IAppOption>()

Component({
  data: {
    groupId: '',
    group: {} as any,
    members: [] as any[],
    todayMembers: [] as any[],
    loading: true,
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
      if (!groupId) { this.setData({ loading: false }); return }
      try {
        const group = await getGroupById(groupId)
        if (!group) { wx.showToast({ title: '小组不存在', icon: 'none' }); wx.navigateBack(); return }
        const members = await getGroupMembers(groupId)
        const today = getTodayStr()
        const { data: todayCheckins } = await checkinsCol()
          .where({ groupId, date: today })
          .get()
        const checkedIds = new Set((todayCheckins || []).map((c: any) => c.userId))

        const usersColRef = usersCol()
        const membersWithUser: any[] = []
        for (const m of members) {
          const { data: uList } = await usersColRef.where({ openid: m.userId }).get()
          const u = uList?.[0] as any
          membersWithUser.push({
            ...m,
            nickName: u?.nickName || '未知',
            avatarUrl: u?.avatarUrl || '',
            checked: checkedIds.has(m.userId),
          })
        }
        this.setData({
          group: group as any,
          members: membersWithUser,
          todayMembers: membersWithUser,
          loading: false,
        })
      } catch (e) {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    },
    copyInvite() {
      const code = this.data.group.inviteCode
      if (!code) return
      wx.setClipboardData({
        data: code,
        success: () => wx.showToast({ title: '已复制' }),
      })
    },
  },
})
