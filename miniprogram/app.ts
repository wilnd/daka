// app.ts
import './cloud-init' // 必须最先执行，初始化云开发
import { getOpenid } from './services/auth'
import { getSimpleThemeColor, THEMES, ThemeConfig, ThemeType } from './services/theme'

App({
  globalData: {
    openid: '',
    currentGroupId: '',
    shouldOpenJoinModal: false,
    /** 当前主题颜色 */
    themeColor: THEMES.checked.color,
    /** 当前主题配置 */
    themeConfig: THEMES.checked as ThemeConfig,
    /** 主题类型 */
    themeType: 'checked' as ThemeType,
    /** 用户已打卡状态（用于定时刷新） */
    userCheckedToday: false,
    userCheckedYesterday: false,
  },
  onLaunch() {
    this.checkAuth()
    this.initTheme()
    this.startThemeTimer()
  },
  /** 启动主题定时检查 */
  startThemeTimer() {
    // 每分钟检查一次主题
    setInterval(() => {
      this.refreshThemeByTime()
    }, 60000) // 1分钟
  },
  /** 根据时间刷新主题（不查询数据库） */
  refreshThemeByTime() {
    const { userCheckedToday, userCheckedYesterday } = this.globalData

    // 如果已打卡，保持绿色
    if (userCheckedToday) {
      return
    }

    // 如果昨天也没打卡，保持冻结色
    if (!userCheckedYesterday) {
      return
    }

    // 未打卡：根据时间重新计算主题
    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60

    let themeType: ThemeType
    let themeColor: string

    if (hour < 18) {
      themeType = 'normal'
      themeColor = THEMES.normal.color
    } else if (hour < 20) {
      themeType = 'warning'
      themeColor = getSimpleThemeColor()
    } else {
      themeType = 'danger'
      themeColor = getSimpleThemeColor()
    }

    // 只有颜色变化时才更新
    if (themeColor !== this.globalData.themeColor) {
      this.globalData.themeType = themeType
      this.globalData.themeColor = themeColor
      this.applyNavigationBarColor(themeColor)
    }
  },
  /** 初始化主题（根据当前时间） */
  initTheme() {
    const hour = new Date().getHours()
    let themeType: ThemeType = 'normal'
    let themeColor = THEMES.normal.color

    // 18点前默认绿色，之后根据时间渐变
    if (hour >= 18) {
      themeColor = getSimpleThemeColor()
      if (hour >= 20) themeType = 'warning'
      if (hour >= 22) themeType = 'danger'
    }

    this.globalData.themeType = themeType
    this.globalData.themeColor = themeColor
    this.globalData.themeConfig = {
      type: themeType,
      color: themeColor,
      gradientStart: themeColor,
      gradientEnd: themeColor,
      label: THEMES[themeType].label
    }

    // 应用到导航栏
    this.applyNavigationBarColor(themeColor)
  },
  /** 更新主题（根据打卡状态） */
  updateTheme(checkedToday: boolean, checkedYesterday: boolean) {
    // 保存用户打卡状态，用于定时刷新
    this.globalData.userCheckedToday = checkedToday
    this.globalData.userCheckedYesterday = checkedYesterday

    const now = new Date()
    const hour = now.getHours() + now.getMinutes() / 60

    let themeType: ThemeType
    let themeColor: string

    if (checkedToday) {
      themeType = 'checked'
      themeColor = THEMES.checked.color
    } else if (!checkedYesterday) {
      themeType = 'frozen'
      themeColor = THEMES.frozen.color
    } else {
      // 未打卡，根据时间计算颜色
      if (hour < 18) {
        themeType = 'normal'
        themeColor = THEMES.normal.color
      } else if (hour < 20) {
        themeType = 'warning'
        themeColor = getSimpleThemeColor()
      } else if (hour < 22) {
        themeType = 'danger'
        themeColor = getSimpleThemeColor()
      } else {
        themeType = 'danger'
        themeColor = getSimpleThemeColor()
      }
    }

    this.globalData.themeType = themeType
    this.globalData.themeColor = themeColor
    this.globalData.themeConfig = {
      type: themeType,
      color: themeColor,
      gradientStart: themeColor,
      gradientEnd: themeColor,
      label: THEMES[themeType].label
    }

    // 应用到导航栏
    this.applyNavigationBarColor(themeColor)
  },
  /** 应用导航栏颜色 */
  applyNavigationBarColor(color: string) {
    try {
      wx.setNavigationBarColor({
        frontColor: 'white',
        backgroundColor: color,
        animation: {
          duration: 300,
          timingFunc: 'easeInOut'
        }
      })
    } catch (e) {
      console.warn('设置导航栏颜色失败', e)
    }
  },
  async checkAuth() {
    const token = wx.getStorageSync('openid')
    if (token) {
      this.globalData.openid = token
      return
    }
    try {
      const openid = await getOpenid()
      this.globalData.openid = openid
      wx.setStorageSync('openid', openid)
    } catch (e: any) {
      const msg = (e && e.errMsg) || ''
      if (msg.includes('-601034') || msg.includes('没有权限')) {
        wx.showModal({
          title: '请先开通云开发',
          content: '1. 点击开发者工具顶部「云开发」\n2. 开通并创建环境\n3. 右键 cloud/login 上传云函数\n4. 将 cloud-init.ts 中 env 改为你的环境 ID',
          showCancel: false,
        })
      } else {
        console.warn('获取 openid 失败', e)
      }
    }
  },
})
