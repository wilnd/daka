/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo
    openid?: string
    currentGroupId?: string
    shouldOpenJoinModal?: boolean
    themeColor?: string
    themeType?: string
    themeConfig?: any
    userCheckedToday?: boolean
    userCheckedYesterday?: boolean
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback
  updateTheme?: (checkedToday: boolean, checkedYesterday: boolean) => void
}