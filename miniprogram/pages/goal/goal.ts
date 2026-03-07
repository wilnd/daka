// goal.ts
import {
  GoalConfigs,
  GoalType,
  GoalPeriod,
  GoalReward,
  RewardTemplates,
  PenaltyTemplates,
  CommonRewardTags,
  CommonPenaltyTags,
  CommonRewardTag,
  CommonPenaltyTag,
  GoalConfirmor,
  createGoal,
  getActiveGoals,
  getUserGoals,
  deleteGoal,
  calculateGoalProgress,
  getGoalStatus,
  Goal,
  GoalStatus,
  queryGoals,
  GoalQueryParams,
  CategoryLabels,
  RewardPenaltyCategory,
  UserRewardPenaltyTag,
  getAllTagsWithDefaults,
  addUserTag,
  deleteUserTag,
  DefaultUserRewardTags,
  DefaultUserPenaltyTags,
  GoalCategory
} from '../../services/goal'
import { getTodayStr } from '../../services/db'
import { generateConfirmCode } from '../../services/utils'
import { generateGoalShareUrl } from '../../services/goal'
import { getMyGroups, getGroupMembersWithUserInfo } from '../../services/group'
import { CHECKIN_CATEGORIES, getSubCategories, getCategoryDisplayName, Category, SubCategory } from '../../services/category'

const app = getApp() as IAppOption

Page({
  data: {
    themeColor: '#1ABC9C',
    activeGoals: [] as any[],
    today: getTodayStr(),
    // 目标模式：periodic-周期目标，deadline-时间点目标
    goalMode: 'periodic' as 'periodic' | 'deadline',
    // 选中的目标类型
    selectedPeriod: 'daily' as GoalPeriod,
    selectedType: 'checkin' as GoalType,
    targetValue: 1,
    // 奖励和惩罚
    selectedReward: RewardTemplates[0],
    selectedPenalty: PenaltyTemplates[0],
    // 分类标签
    categoryLabels: CategoryLabels,
    // 当前选中的分类
    selectedRewardCategory: 'exercise' as RewardPenaltyCategory,
    selectedPenaltyCategory: 'exercise' as RewardPenaltyCategory,
    // 按分类的奖励/惩罚标签
    categorizedRewardTags: DefaultUserRewardTags,
    categorizedPenaltyTags: DefaultUserPenaltyTags,
    // 常用标签（保留兼容）
    commonRewardTags: CommonRewardTags,
    commonPenaltyTags: CommonPenaltyTags,
    selectedRewardTags: [] as UserRewardPenaltyTag[],
    selectedPenaltyTags: [] as UserRewardPenaltyTag[],
    // 自定义奖励/惩罚
    customRewardName: '',
    customRewardValue: 0,
    customPenaltyName: '',
    customPenaltyValue: 0,
    showCustomReward: false,
    showCustomPenalty: false,
    // 自定义时间
    useCustomDate: false,
    // 时间点目标专用 - 截止日期
    deadlineDate: getTodayStr(),
    startDate: getTodayStr(),
    endDate: getTodayStr(),
    // 确认人
    showConfirmorModal: false,
    confirmorName: '',
    confirmorOpenid: '',
    confirmCode: '',
    // 确认人选择（先选组织再选用户）
    confirmorSelectionStep: 1, // 1: 选择组织, 2: 选择成员
    confirmorGroups: [] as any[],
    confirmorGroupMembers: [] as any[],
    selectedConfirmorGroup: null as any,
    // 筛选状态
    filterStatus: 'all' as GoalStatus | 'all',
    // 预览
    showPreview: false,
    previewGoal: null as any,
    // 标签管理
    showTagManageModal: false,
    manageTagType: 'reward' as 'reward' | 'penalty',
    manageTagCategory: 'exercise' as RewardPenaltyCategory,
    // 当前管理分类的标签数量
    manageTagsCount: 0,
    // 当前展示的奖励/惩罚标签列表（用于wxml中遍历）
    currentRewardTags: [] as UserRewardPenaltyTag[],
    currentPenaltyTags: [] as UserRewardPenaltyTag[],
    // 奖励输入框中显示的标签（用于达成奖励输入框）
    rewardInputTags: [] as UserRewardPenaltyTag[],
    // 惩罚输入框中显示的标签（用于达成惩罚输入框）
    penaltyInputTags: [] as UserRewardPenaltyTag[],
    // 输入框是否聚焦
    rewardInputFocused: false,
    penaltyInputFocused: false,
    // 直接输入的奖励/惩罚值
    rewardInputValue: '',
    penaltyInputValue: '',
    // 目标分类（用于成长墙类型的目标）
    showCategorySelector: false,
    categories: CHECKIN_CATEGORIES as Category[],
    selectedCategoryId: '',
    selectedCategoryName: '',
    selectedSubCategoryId: '',
    selectedSubCategoryName: '',
    subCategories: [] as SubCategory[],
    // 是否显示分类选择（根据目标类型动态显示）
    needCategory: false,
  },

  onLoad() {
    this.setData({ themeColor: '#1ABC9C' })
    const { selectedRewardCategory, selectedPenaltyCategory, categorizedRewardTags, categorizedPenaltyTags, selectedRewardTags, selectedPenaltyTags, rewardInputTags, penaltyInputTags } = this.data
    // 为每个标签添加 selected 属性
    const rewardTags = (categorizedRewardTags[selectedRewardCategory] || []).map((tag: UserRewardPenaltyTag) => ({
      ...tag,
      selected: selectedRewardTags.some(t => t.id === tag.id) || rewardInputTags.some(t => t.id === tag.id)
    }))
    const penaltyTags = (categorizedPenaltyTags[selectedPenaltyCategory] || []).map((tag: UserRewardPenaltyTag) => ({
      ...tag,
      selected: selectedPenaltyTags.some(t => t.id === tag.id) || penaltyInputTags.some(t => t.id === tag.id)
    }))
    this.setData({
      currentRewardTags: rewardTags,
      currentPenaltyTags: penaltyTags
    })
    this.loadUserTags()
  },

  async loadUserTags() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const { rewards, penalties } = await getAllTagsWithDefaults(openid)
      const { selectedRewardTags, selectedPenaltyTags, selectedPenaltyCategory, selectedRewardCategory, rewardInputTags, penaltyInputTags } = this.data
      // 为每个标签添加 selected 属性
      const rewardTags = (rewards[selectedRewardCategory] || []).map((tag: UserRewardPenaltyTag) => ({
        ...tag,
        selected: selectedRewardTags.some(t => t.id === tag.id) || rewardInputTags.some(t => t.id === tag.id)
      }))
      const penaltyTags = (penalties[selectedPenaltyCategory] || []).map((tag: UserRewardPenaltyTag) => ({
        ...tag,
        selected: selectedPenaltyTags.some(t => t.id === tag.id) || penaltyInputTags.some(t => t.id === tag.id)
      }))
      this.setData({
        categorizedRewardTags: rewards,
        categorizedPenaltyTags: penalties,
        currentRewardTags: rewardTags,
        currentPenaltyTags: penaltyTags
      })
      this.updateManageTagsCount()
    } catch (e) {
      console.error('加载用户标签失败', e)
    }
  },

  onShow() {
    this.loadActiveGoals()
  },

  async loadActiveGoals() {
    const openid = app.globalData.openid
    if (!openid) return

    try {
      const goals = await getActiveGoals(openid)
      // 计算每个目标的进度
      const goalsWithProgress = await Promise.all(
        goals.map(async (goal) => {
          const progress = await calculateGoalProgress(openid, goal)
          const status = getGoalStatus(goal, progress)
          return { ...goal, progress, status }
        })
      )
      this.setData({ activeGoals: goalsWithProgress })
    } catch (e) {
      console.error('加载目标失败', e)
    }
  },

  // 切换目标模式（周期目标/时间点目标）
  onGoalModeChange(e: any) {
    const mode = e.currentTarget.dataset.mode as 'periodic' | 'deadline'
    this.setData({
      goalMode: mode,
      // 切换到时间点目标时，设置默认截止日期为一个月后
      // 切换模式时重置日期
      ...this.getDefaultDateRange()
    })
  },

  // 获取默认日期范围（今天 + 1个月）
  getDefaultDateRange() {
    const today = new Date()
    const todayStr = getTodayStr()

    // 默认截止日期为一个月后
    const nextMonth = new Date(today)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const year = nextMonth.getFullYear()
    const month = String(nextMonth.getMonth() + 1).padStart(2, '0')
    const day = String(nextMonth.getDate()).padStart(2, '0')
    const defaultEndDate = `${year}-${month}-${day}`

    return {
      startDate: todayStr,
      endDate: defaultEndDate,
      deadlineDate: defaultEndDate
    }
  },

  // 获取默认截止日期
  getDefaultDeadlineDate() {
    const today = new Date()
    const nextMonth = new Date(today)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const year = nextMonth.getFullYear()
    const month = String(nextMonth.getMonth() + 1).padStart(2, '0')
    const day = String(nextMonth.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  // 选择截止日期（时间点目标）
  onDeadlineChange(e: any) {
    this.setData({ deadlineDate: e.detail.value })
  },

  // 切换目标类型
  onTypeChange(e: any) {
    const type = e.currentTarget.dataset.type as GoalType
    const { selectedPeriod } = this.data
    const config = GoalConfigs[selectedPeriod][type]

    // 新的目标类型（sports、study、life）本身就是分类
    // 将选中的类型作为分类ID，并获取对应的子类型
    const categoryMap: Record<GoalType, { categoryId: string; categoryName: string; subCategories: any[] }> = {
      sports: { categoryId: 'sports', categoryName: '运动类', subCategories: CHECKIN_CATEGORIES.find(c => c.id === 'sports') && CHECKIN_CATEGORIES.find(c => c.id === 'sports').subCategories ? CHECKIN_CATEGORIES.find(c => c.id === 'sports').subCategories : [] },
      study: { categoryId: 'study', categoryName: '学习类', subCategories: CHECKIN_CATEGORIES.find(c => c.id === 'study') && CHECKIN_CATEGORIES.find(c => c.id === 'study').subCategories ? CHECKIN_CATEGORIES.find(c => c.id === 'study').subCategories : [] },
      life: { categoryId: 'life', categoryName: '生活类', subCategories: CHECKIN_CATEGORIES.find(c => c.id === 'life') && CHECKIN_CATEGORIES.find(c => c.id === 'life').subCategories ? CHECKIN_CATEGORIES.find(c => c.id === 'life').subCategories : [] }
    }
    const categoryInfo = categoryMap[type]

    this.setData({
      selectedType: type,
      targetValue: config.defaultTarget,
      needCategory: false,
      // 直接将类型作为分类，并加载对应的子类型
      selectedCategoryId: categoryInfo.categoryId,
      selectedCategoryName: categoryInfo.categoryName,
      selectedSubCategoryId: '',
      selectedSubCategoryName: '',
      subCategories: categoryInfo.subCategories
    })
  },

  // 切换周期时也检查是否需要分类
  onPeriodChange(e: any) {
    const period = e.currentTarget.dataset.period as GoalPeriod
    const types = Object.keys(GoalConfigs[period]) as GoalType[]
    const defaultType = types[0]

    // 新的目标类型本身就是分类
    const categoryMap: Record<GoalType, { categoryId: string; categoryName: string }> = {
      sports: { categoryId: 'sports', categoryName: '运动类' },
      study: { categoryId: 'study', categoryName: '学习类' },
      life: { categoryId: 'life', categoryName: '生活类' }
    }
    const categoryInfo = categoryMap[defaultType]

    this.setData({
      selectedPeriod: period,
      selectedType: defaultType,
      targetValue: GoalConfigs[period][defaultType].defaultTarget,
      needCategory: false,
      // 直接将类型作为分类
      selectedCategoryId: categoryInfo.categoryId,
      selectedCategoryName: categoryInfo.categoryName,
      selectedSubCategoryId: '',
      selectedSubCategoryName: '',
      subCategories: []
    })
  },

  // 选择分类（大类）
  onCategoryChange(e: any) {
    const categoryId = e.currentTarget.dataset.id
    const category = CHECKIN_CATEGORIES.find(c => c.id === categoryId)
    if (category) {
      this.setData({
        selectedCategoryId: categoryId,
        selectedCategoryName: category.name,
        subCategories: category.subCategories,
        selectedSubCategoryId: '',
        selectedSubCategoryName: ''
      })
    }
  },

  // 选择小类
  onSubCategoryChange(e: any) {
    const subCategoryId = e.currentTarget.dataset.id
    const { subCategories, selectedCategoryName } = this.data
    const subCategory = subCategories.find(s => s.id === subCategoryId)
    if (subCategory) {
      this.setData({
        selectedSubCategoryId: subCategoryId,
        selectedSubCategoryName: subCategory.name
      })
    }
  },

  // 修改目标值
  onTargetChange(e: any) {
    this.setData({ targetValue: parseInt(e.detail.value) || 1 })
  },

  // 选择奖励
  onRewardChange(e: any) {
    const index = parseInt(e.detail.value)
    this.setData({ selectedReward: RewardTemplates[index] })
  },

  // 选择惩罚
  onPenaltyChange(e: any) {
    const index = parseInt(e.detail.value)
    this.setData({ selectedPenalty: PenaltyTemplates[index] })
  },

  // 切换是否使用自定义日期（仅时间点目标可用）
  onToggleCustomDate(e: any) {
    const useCustomDate = e.detail.value
    const today = getTodayStr()
    this.setData({
      useCustomDate,
      startDate: useCustomDate ? today : today,
      endDate: useCustomDate ? today : today
    })
  },

  // 选择开始日期
  onStartDateChange(e: any) {
    this.setData({ startDate: e.detail.value })
  },

  // 选择结束日期
  onEndDateChange(e: any) {
    this.setData({ endDate: e.detail.value })
  },

  // 切换确认人模态框
  async toggleConfirmorModal() {
    const { showConfirmorModal: oldShow } = this.data
    if (!oldShow) {
      // 打开弹窗时，加载用户的组织列表
      const userId = app.globalData.openid
      if (userId) {
        const confirmorGroups = await getMyGroups(userId)
        this.setData({
          showConfirmorModal: true,
          confirmorSelectionStep: 1,
          confirmorGroups,
          confirmorGroupMembers: [],
          selectedConfirmorGroup: null,
          confirmorName: '',
          confirmorOpenid: '',
          confirmCode: ''
        })
      } else {
        this.setData({ showConfirmorModal: true })
      }
    } else {
      this.setData({ showConfirmorModal: false })
    }
  },

  // 选择确认人组织
  async onSelectConfirmorGroup(e: any) {
    const group = e.currentTarget.dataset.group
    const groupMembers = await getGroupMembersWithUserInfo(group._id)
    // 过滤掉当前用户
    const currentUserId = app.globalData.openid
    const filteredMembers = groupMembers.filter(m => m.userId !== currentUserId)

    this.setData({
      confirmorSelectionStep: 2,
      selectedConfirmorGroup: group,
      confirmorGroupMembers: filteredMembers
    })
  },

  // 选择确认人成员
  onSelectConfirmorMember(e: any) {
    const member = e.currentTarget.dataset.member
    const confirmCode = generateConfirmCode()

    this.setData({
      confirmorName: member.nickName || '未知用户',
      confirmorOpenid: member.userId,
      confirmCode,
      showConfirmorModal: false
    })
    wx.showToast({ title: '已添加确认人', icon: 'success' })
  },

  // 返回选择组织步骤
  onBackToGroupSelection() {
    this.setData({
      confirmorSelectionStep: 1,
      confirmorGroupMembers: [],
      selectedConfirmorGroup: null
    })
  },

  // 阻止事件冒泡
  preventClose() {},

  // 移除确认人
  removeConfirmor() {
    this.setData({ confirmorName: '', confirmorOpenid: '', confirmCode: '' })
  },

  // 复制确认码
  copyConfirmCode() {
    const { confirmCode } = this.data
    if (confirmCode) {
      wx.setClipboardData({
        data: confirmCode,
        success: () => {
          wx.showToast({ title: '已复制确认码', icon: 'success' })
        }
      })
    }
  },

  // 切换奖励分类
  onRewardCategoryChange(e: any) {
    const category = e.currentTarget.dataset.category as RewardPenaltyCategory
    const { selectedRewardTags, categorizedRewardTags, rewardInputTags } = this.data
    const tags = categorizedRewardTags[category] || []
    // 为每个标签添加 selected 属性
    const tagsWithSelected = tags.map((tag: UserRewardPenaltyTag) => ({
      ...tag,
      selected: selectedRewardTags.some(t => t.id === tag.id) || rewardInputTags.some(t => t.id === tag.id)
    }))
    this.setData({
      selectedRewardCategory: category,
      currentRewardTags: tagsWithSelected
    })
  },

  // 切换惩罚分类
  onPenaltyCategoryChange(e: any) {
    const category = e.currentTarget.dataset.category as RewardPenaltyCategory
    const { selectedPenaltyTags, categorizedPenaltyTags, penaltyInputTags } = this.data
    const tags = categorizedPenaltyTags[category] || []
    // 为每个标签添加 selected 属性
    const tagsWithSelected = tags.map((tag: UserRewardPenaltyTag) => ({
      ...tag,
      selected: selectedPenaltyTags.some(t => t.id === tag.id) || penaltyInputTags.some(t => t.id === tag.id)
    }))
    this.setData({
      selectedPenaltyCategory: category,
      currentPenaltyTags: tagsWithSelected
    })
  },

  // 选择奖励标签
  onRewardTagSelect(e: any) {
    const tag: UserRewardPenaltyTag = e.currentTarget.dataset.tag
    const { selectedRewardTags, currentRewardTags, rewardInputTags } = this.data

    // 检查是否已选择
    const index = selectedRewardTags.findIndex(t => t.id === tag.id)
    if (index > -1) {
      // 取消选择
      selectedRewardTags.splice(index, 1)
    } else {
      // 添加选择
      selectedRewardTags.push({
        id: tag.id,
        name: tag.name,
        type: tag.type as any,
        value: tag.value,
        category: tag.category,
        isCustom: tag.isCustom
      })
    }

    // 更新 currentRewardTags 中的 selected 属性
    const updatedCurrentTags = currentRewardTags.map((t: any) => ({
      ...t,
      selected: selectedRewardTags.some(s => s.id === t.id)
    }))

    this.setData({ selectedRewardTags, currentRewardTags: updatedCurrentTags })
  },

  // 点击奖励标签后添加到输入框
  addRewardToInput(e: any) {
    const tag: UserRewardPenaltyTag = e.currentTarget.dataset.tag
    const { rewardInputTags, selectedRewardTags } = this.data

    // 检查是否已添加到输入框
    const inputIndex = rewardInputTags.findIndex(t => t.id === tag.id)
    if (inputIndex === -1) {
      // 添加到输入框
      rewardInputTags.push({
        id: tag.id,
        name: tag.name,
        type: tag.type as any,
        value: tag.value,
        category: tag.category,
        isCustom: tag.isCustom
      })

      // 同时添加到已选列表
      const selectedIndex = selectedRewardTags.findIndex(t => t.id === tag.id)
      if (selectedIndex === -1) {
        selectedRewardTags.push({
          id: tag.id,
          name: tag.name,
          type: tag.type as any,
          value: tag.value,
          category: tag.category,
          isCustom: tag.isCustom
        })
      }
    }

    // 更新标签选中状态
    const updatedCurrentTags = this.data.currentRewardTags.map((t: any) => ({
      ...t,
      selected: rewardInputTags.some(s => s.id === t.id)
    }))

    this.setData({
      rewardInputTags,
      selectedRewardTags,
      currentRewardTags: updatedCurrentTags
    })
  },

  // 从输入框移除奖励标签
  removeRewardFromInput(e: any) {
    const tagId = e.currentTarget.dataset.id
    const { rewardInputTags, selectedRewardTags } = this.data

    // 从输入框移除
    const inputIndex = rewardInputTags.findIndex(t => t.id === tagId)
    if (inputIndex > -1) {
      rewardInputTags.splice(inputIndex, 1)
    }

    // 从已选列表移除
    const selectedIndex = selectedRewardTags.findIndex(t => t.id === tagId)
    if (selectedIndex > -1) {
      selectedRewardTags.splice(selectedIndex, 1)
    }

    // 更新标签选中状态
    const updatedCurrentTags = this.data.currentRewardTags.map((t: any) => ({
      ...t,
      selected: rewardInputTags.some(s => s.id === t.id)
    }))

    this.setData({
      rewardInputTags,
      selectedRewardTags,
      currentRewardTags: updatedCurrentTags
    })
  },

  // 奖励输入框聚焦
  onRewardInputFocus() {
    this.setData({ rewardInputFocused: true })
  },

  // 奖励输入框输入
  onRewardInput(e: any) {
    const value = e.detail.value
    this.setData({ rewardInputValue: value })
  },

  // 奖励输入框确认（按回车）
  onRewardInputConfirm(e: any) {
    const value = e.detail.value.trim()
    if (value) {
      const { rewardInputTags } = this.data
      const newTag = {
        id: `input_${Date.now()}`,
        name: value,
        type: 'custom' as const,
        value: 1,
        isCustom: true
      }
      rewardInputTags.push(newTag)
      this.setData({
        rewardInputTags,
        rewardInputValue: ''
      })
    }
  },

  // 奖励输入框失焦
  onRewardInputBlur(e: any) {
    const value = e.detail.value.trim()
    if (value) {
      const { rewardInputTags } = this.data
      const newTag = {
        id: `input_${Date.now()}`,
        name: value,
        type: 'custom' as const,
        value: 1,
        isCustom: true
      }
      rewardInputTags.push(newTag)
      this.setData({
        rewardInputTags,
        rewardInputValue: ''
      })
    }
    this.setData({ rewardInputFocused: false })
  },

  // 惩罚输入框聚焦
  onPenaltyInputFocus() {
    this.setData({ penaltyInputFocused: true })
  },

  // 惩罚输入框失焦
  onPenaltyInputBlur(e: any) {
    const value = e.detail.value.trim()
    if (value) {
      const { penaltyInputTags } = this.data
      const newTag = {
        id: `input_${Date.now()}`,
        name: value,
        type: 'custom' as const,
        value: 1,
        isCustom: true
      }
      penaltyInputTags.push(newTag)
      this.setData({
        penaltyInputTags,
        penaltyInputValue: ''
      })
    }
    this.setData({ penaltyInputFocused: false })
  },

  // 惩罚输入框输入
  onPenaltyInput(e: any) {
    const value = e.detail.value
    this.setData({ penaltyInputValue: value })
  },

  // 惩罚输入框确认（按回车）
  onPenaltyInputConfirm(e: any) {
    const value = e.detail.value.trim()
    if (value) {
      const { penaltyInputTags } = this.data
      const newTag = {
        id: `input_${Date.now()}`,
        name: value,
        type: 'custom' as const,
        value: 1,
        isCustom: true
      }
      penaltyInputTags.push(newTag)
      this.setData({
        penaltyInputTags,
        penaltyInputValue: ''
      })
    }
  },

  // 选择惩罚标签
  onPenaltyTagSelect(e: any) {
    const tag: UserRewardPenaltyTag = e.currentTarget.dataset.tag
    const { selectedPenaltyTags, currentPenaltyTags } = this.data

    // 检查是否已选择
    const index = selectedPenaltyTags.findIndex(t => t.id === tag.id)
    if (index > -1) {
      // 取消选择
      selectedPenaltyTags.splice(index, 1)
    } else {
      // 添加选择
      selectedPenaltyTags.push({
        id: tag.id,
        name: tag.name,
        type: tag.type as any,
        value: tag.value,
        category: tag.category,
        isCustom: tag.isCustom
      })
    }

    // 更新 currentPenaltyTags 中的 selected 属性
    const updatedCurrentTags = currentPenaltyTags.map((t: any) => ({
      ...t,
      selected: selectedPenaltyTags.some(s => s.id === t.id)
    }))

    this.setData({ selectedPenaltyTags, currentPenaltyTags: updatedCurrentTags })
  },

  // 点击惩罚标签后添加到输入框
  addPenaltyToInput(e: any) {
    const tag: UserRewardPenaltyTag = e.currentTarget.dataset.tag
    const { penaltyInputTags, selectedPenaltyTags } = this.data

    // 检查是否已添加到输入框
    const inputIndex = penaltyInputTags.findIndex(t => t.id === tag.id)
    if (inputIndex === -1) {
      // 添加到输入框
      penaltyInputTags.push({
        id: tag.id,
        name: tag.name,
        type: tag.type as any,
        value: tag.value,
        category: tag.category,
        isCustom: tag.isCustom
      })

      // 同时添加到已选列表
      const selectedIndex = selectedPenaltyTags.findIndex(t => t.id === tag.id)
      if (selectedIndex === -1) {
        selectedPenaltyTags.push({
          id: tag.id,
          name: tag.name,
          type: tag.type as any,
          value: tag.value,
          category: tag.category,
          isCustom: tag.isCustom
        })
      }
    }

    // 更新标签选中状态
    const updatedCurrentTags = this.data.currentPenaltyTags.map((t: any) => ({
      ...t,
      selected: penaltyInputTags.some(s => s.id === t.id)
    }))

    this.setData({
      penaltyInputTags,
      selectedPenaltyTags,
      currentPenaltyTags: updatedCurrentTags
    })
  },

  // 从输入框移除惩罚标签
  removePenaltyFromInput(e: any) {
    const tagId = e.currentTarget.dataset.id
    const { penaltyInputTags, selectedPenaltyTags } = this.data

    // 从输入框移除
    const inputIndex = penaltyInputTags.findIndex(t => t.id === tagId)
    if (inputIndex > -1) {
      penaltyInputTags.splice(inputIndex, 1)
    }

    // 从已选列表移除
    const selectedIndex = selectedPenaltyTags.findIndex(t => t.id === tagId)
    if (selectedIndex > -1) {
      selectedPenaltyTags.splice(selectedIndex, 1)
    }

    // 更新标签选中状态
    const updatedCurrentTags = this.data.currentPenaltyTags.map((t: any) => ({
      ...t,
      selected: penaltyInputTags.some(s => s.id === t.id)
    }))

    this.setData({
      penaltyInputTags,
      selectedPenaltyTags,
      currentPenaltyTags: updatedCurrentTags
    })
  },

  // 打开标签管理弹窗
  openTagManageModal(e: any) {
    const { type, category } = e.currentTarget.dataset
    this.setData({
      showTagManageModal: true,
      manageTagType: type,
      manageTagCategory: (category || 'exercise') as RewardPenaltyCategory
    })
    this.updateManageTagsCount()
  },

  // 标签管理弹窗中切换分类
  onManageTagCategoryChange(e: any) {
    const category = e.currentTarget.dataset.category as RewardPenaltyCategory
    this.setData({ manageTagCategory: category })
    this.updateManageTagsCount()
  },

  // 更新管理弹窗中的标签数量
  updateManageTagsCount() {
    const { manageTagType, manageTagCategory, categorizedRewardTags, categorizedPenaltyTags } = this.data
    let count = 0
    if (manageTagType === 'reward') {
      count = categorizedRewardTags[manageTagCategory] && categorizedRewardTags[manageTagCategory].length ? categorizedRewardTags[manageTagCategory].length : 0
    } else {
      count = categorizedPenaltyTags[manageTagCategory] && categorizedPenaltyTags[manageTagCategory].length ? categorizedPenaltyTags[manageTagCategory].length : 0
    }
    this.setData({ manageTagsCount: count })
  },

  // 刷新当前显示的标签的选中状态
  refreshCurrentTags() {
    const { selectedRewardTags, selectedPenaltyTags, currentRewardTags, currentPenaltyTags } = this.data
    const updatedRewardTags = currentRewardTags.map((tag: any) => ({
      ...tag,
      selected: selectedRewardTags.some(t => t.id === tag.id)
    }))
    const updatedPenaltyTags = currentPenaltyTags.map((tag: any) => ({
      ...tag,
      selected: selectedPenaltyTags.some(t => t.id === tag.id)
    }))
    this.setData({
      currentRewardTags: updatedRewardTags,
      currentPenaltyTags: updatedPenaltyTags
    })
  },

  // 关闭标签管理弹窗
  closeTagManageModal() {
    this.setData({ showTagManageModal: false })
  },

  // 添加新标签
  async onAddNewTag() {
    const { customRewardName, customRewardValue, customPenaltyName, customPenaltyValue, manageTagType, manageTagCategory } = this.data

    const name = manageTagType === 'reward' ? customRewardName : customPenaltyName
    const value = manageTagType === 'reward' ? customRewardValue : customPenaltyValue
    const openid = app.globalData.openid

    if (!name || !name.trim()) {
      wx.showToast({ title: '请输入标签名称', icon: 'none' })
      return
    }

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    try {
      const result = await addUserTag(openid, {
        name: name.trim(),
        type: manageTagCategory,
        value: value || 1,
        category: manageTagCategory,
        isCustom: true,
        isReward: manageTagType === 'reward'
      })

      if (result.success) {
        wx.showToast({ title: '添加成功', icon: 'success' })
        this.setData({
          customRewardName: '',
          customRewardValue: 0,
          customPenaltyName: '',
          customPenaltyValue: 0,
          showTagManageModal: false
        })
        await this.loadUserTags()
        this.updateManageTagsCount()
        // 重新设置当前分类的标签 selected 状态
        this.refreshCurrentTags()
      } else {
        wx.showToast({ title: result.msg || '添加失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '添加失败', icon: 'none' })
    }
  },

  // 删除用户自定义标签
  async onDeleteTag(e: any) {
    const tagId = e.currentTarget.dataset.id
    const openid = app.globalData.openid

    if (!openid) return

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个标签吗？',
      success: async (res) => {
        if (res.confirm) {
          const result = await deleteUserTag(openid, tagId)
          if (result.success) {
            wx.showToast({ title: '删除成功', icon: 'success' })
            await this.loadUserTags()
            this.updateManageTagsCount()
            this.refreshCurrentTags()
          } else {
            wx.showToast({ title: result.msg || '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 切换常用奖励标签（保留兼容）
  onRewardTagToggle(e: any) {
    const tag: CommonRewardTag = e.currentTarget.dataset.tag
    const { selectedRewardTags } = this.data
    const index = selectedRewardTags.findIndex(t => t.id === tag.id)

    if (index > -1) {
      selectedRewardTags.splice(index, 1)
    } else {
      selectedRewardTags.push(tag)
    }

    this.setData({ selectedRewardTags })
  },

  // 切换常用惩罚标签
  onPenaltyTagToggle(e: any) {
    const tag: CommonPenaltyTag = e.currentTarget.dataset.tag
    const { selectedPenaltyTags } = this.data
    const index = selectedPenaltyTags.findIndex(t => t.id === tag.id)

    if (index > -1) {
      selectedPenaltyTags.splice(index, 1)
    } else {
      selectedPenaltyTags.push(tag)
    }

    this.setData({ selectedPenaltyTags })
  },

  // 显示自定义奖励输入
  showCustomRewardInput() {
    this.setData({ showCustomReward: true })
  },

  // 隐藏自定义奖励输入
  hideCustomRewardInput() {
    this.setData({ showCustomReward: false, customRewardName: '', customRewardValue: 0 })
  },

  // 自定义奖励名称输入
  onCustomRewardNameInput(e: any) {
    this.setData({ customRewardName: e.detail.value })
  },

  // 自定义奖励值输入
  onCustomRewardValueInput(e: any) {
    this.setData({ customRewardValue: parseInt(e.detail.value) || 0 })
  },

  // 保存自定义奖励
  saveCustomReward() {
    const { customRewardName, customRewardValue, selectedRewardTags } = this.data
    if (!customRewardName || customRewardValue <= 0) {
      wx.showToast({ title: '请输入有效的奖励名称和值', icon: 'none' })
      return
    }

    const customTag: CommonRewardTag = {
      id: `custom_${Date.now()}`,
      name: customRewardName,
      type: 'custom',
      value: customRewardValue,
      isCustom: true
    }

    selectedRewardTags.push(customTag)
    this.setData({
      selectedRewardTags,
      showCustomReward: false,
      customRewardName: '',
      customRewardValue: 0
    })
  },

  // 显示自定义惩罚输入
  showCustomPenaltyInput() {
    this.setData({ showCustomPenalty: true })
  },

  // 隐藏自定义惩罚输入
  hideCustomPenaltyInput() {
    this.setData({ showCustomPenalty: false, customPenaltyName: '', customPenaltyValue: 0 })
  },

  // 自定义惩罚名称输入
  onCustomPenaltyNameInput(e: any) {
    this.setData({ customPenaltyName: e.detail.value })
  },

  // 自定义惩罚值输入
  onCustomPenaltyValueInput(e: any) {
    this.setData({ customPenaltyValue: parseInt(e.detail.value) || 0 })
  },

  // 保存自定义惩罚
  saveCustomPenalty() {
    const { customPenaltyName, customPenaltyValue, selectedPenaltyTags } = this.data
    if (!customPenaltyName || customPenaltyValue < 0) {
      wx.showToast({ title: '请输入有效的惩罚名称', icon: 'none' })
      return
    }

    const customTag: CommonPenaltyTag = {
      id: `custom_${Date.now()}`,
      name: customPenaltyName,
      type: 'custom',
      value: customPenaltyValue,
      isCustom: true
    }

    selectedPenaltyTags.push(customTag)
    this.setData({
      selectedPenaltyTags,
      showCustomPenalty: false,
      customPenaltyName: '',
      customPenaltyValue: 0
    })
  },

  // 预览目标
  onPreview() {
    const {
      goalMode,
      selectedPeriod,
      selectedType,
      targetValue,
      selectedReward,
      selectedPenalty,
      startDate,
      endDate,
      confirmorName,
      confirmCode,
      rewardInputTags,
      penaltyInputTags,
      useCustomDate,
      deadlineDate,
      needCategory,
      selectedCategoryName,
      selectedSubCategoryName
    } = this.data
    const config = GoalConfigs[selectedPeriod][selectedType]

    const confirmor = confirmorName && confirmCode ? {
      openid: '',
      nickname: confirmorName,
      confirmStatus: 'pending' as const,
      confirmCode
    } : undefined

    // 根据模式显示不同的时间信息
    let timeRangeText = ''
    if (goalMode === 'periodic') {
      // 周期目标 - 显示自动计算
      timeRangeText = useCustomDate ? `${startDate} ~ ${endDate}` : '自动计算'
    } else {
      // 时间点目标 - 显示截止日期
      timeRangeText = `截止至 ${deadlineDate}`
    }

    // 构建分类显示文本（新的目标类型本身就是分类）
    let categoryText = selectedCategoryName || ''

    // 处理惩罚：优先使用自定义惩罚标签，其次使用模板惩罚
    let penaltyToShow = selectedPenalty
    if (penaltyInputTags && penaltyInputTags.length > 0) {
      // 如果有自定义惩罚标签，显示第一个作为主要惩罚
      penaltyToShow = {
        ...penaltyInputTags[0],
        type: 'custom'
      }
    }

    // 处理奖励：优先使用自定义奖励标签，其次使用模板奖励
    let rewardToShow = selectedReward
    if (rewardInputTags && rewardInputTags.length > 0) {
      // 如果有自定义奖励标签，显示第一个作为主要奖励
      rewardToShow = {
        ...rewardInputTags[0],
        type: 'custom'
      }
    }

    this.setData({
      showPreview: true,
      previewGoal: {
        title: config.title,
        description: config.description,
        period: selectedPeriod,
        type: selectedType,
        target: targetValue,
        reward: rewardToShow,
        penalty: penaltyToShow,
        customRewardTags: rewardInputTags,
        customPenaltyTags: penaltyInputTags,
        startDate: useCustomDate ? startDate : '自动计算',
        endDate: useCustomDate ? endDate : '自动计算',
        deadlineDate: deadlineDate,
        goalMode: goalMode,
        timeRangeText: timeRangeText,
        confirmor,
        category: categoryText
      }
    })
  },

  // 隐藏预览
  hidePreview() {
    this.setData({ showPreview: false })
  },

  // 创建目标
  async onCreateGoal() {
    const openid = app.globalData.openid
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const {
      goalMode,
      selectedType,
      selectedPeriod,
      targetValue,
      selectedReward,
      selectedPenalty,
      startDate,
      endDate,
      confirmorName,
      confirmCode,
      rewardInputTags,
      penaltyInputTags,
      useCustomDate,
      deadlineDate,
      needCategory,
      selectedCategoryId,
      selectedCategoryName,
      selectedSubCategoryId,
      selectedSubCategoryName
    } = this.data

    // 如果需要分类但未选择，提示用户
    if (needCategory && !selectedCategoryId) {
      wx.showToast({ title: '请选择分类', icon: 'none' })
      return
    }

    wx.showLoading({ title: '创建中...' })

    try {
      const reward = selectedReward.type !== 'none' ? selectedReward : undefined
      const penalty = selectedPenalty.type !== 'none' ? selectedPenalty : undefined

      const confirmor: GoalConfirmor | undefined = confirmorName && confirmCode ? {
        openid: '', // 不再需要openid，使用确认码方式
        nickname: confirmorName,
        confirmStatus: 'pending',
        confirmCode
      } : undefined

      // 构建分类信息
      // 构建分类信息（新的目标类型本身就是分类）
      const category: GoalCategory | undefined = selectedCategoryId ? {
        categoryId: selectedCategoryId,
        categoryName: selectedCategoryName,
        subCategoryId: selectedSubCategoryId || undefined,
        subCategoryName: selectedSubCategoryName || undefined
      } : undefined

      // 根据模式设置日期
      let customStartDate: string | undefined
      let customEndDate: string | undefined

      if (goalMode === 'periodic') {
        // 周期目标 - 如果启用自定义日期则使用，否则不传（自动计算）
        if (useCustomDate) {
          customStartDate = startDate
          customEndDate = endDate
        }
      } else {
        // 时间点目标 - 开始日期为今天，截止日期为设置的日期
        customStartDate = getTodayStr()
        customEndDate = deadlineDate
      }

      const result = await createGoal(
        openid,
        selectedType,
        selectedPeriod,
        targetValue,
        reward,
        penalty,
        customStartDate,
        customEndDate,
        confirmor,
        rewardInputTags,
        penaltyInputTags,
        category
      )

      if (result.success) {
        wx.showToast({ title: '目标创建成功', icon: 'success' })
        this.setData({
          showPreview: false,
          confirmorName: '',
          confirmorOpenid: '',
          confirmCode: '',
          selectedRewardTags: [],
          selectedPenaltyTags: [],
          rewardInputTags: [],
          penaltyInputTags: [],
          useCustomDate: false,
          goalMode: 'periodic',
          deadlineDate: this.getDefaultDeadlineDate(),
          // 重置分类
          needCategory: false,
          selectedCategoryId: '',
          selectedCategoryName: '',
          selectedSubCategoryId: '',
          selectedSubCategoryName: '',
          subCategories: []
        })
        this.loadActiveGoals()
      } else {
        wx.showToast({ title: result.msg || '创建失败', icon: 'none' })
      }
    } catch (e) {
      console.error('创建目标失败', e)
      wx.showToast({ title: '创建失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 删除目标
  async onDeleteGoal(e: any) {
    const goalId = e.currentTarget.dataset.id
    const openid = app.globalData.openid

    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个目标吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          const success = await deleteGoal(openid, goalId)
          wx.hideLoading()
          if (success) {
            wx.showToast({ title: '删除成功', icon: 'success' })
            // 延迟一点确保数据库操作完成
            setTimeout(() => {
              this.loadActiveGoals()
            }, 500)
          } else {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 查看目标详情
  goToGoalProgress(e: any) {
    const goalId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/goal-progress/goal-progress?id=${goalId}` })
  },

  // 跳转到目标进度页面
  goToAllGoals() {
    wx.navigateTo({ url: '/pages/goal-progress/goal-progress' })
  }
})
