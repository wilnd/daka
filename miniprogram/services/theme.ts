/**
 * 动态主题服务
 * 根据记录状态和时间动态调整主题颜色
 */
import { checkinsCol } from './db'

/** 主题类型 */
export type ThemeType = 'checked' | 'normal' | 'warning' | 'danger' | 'frozen'

/** 主题配置 */
export interface ThemeConfig {
  type: ThemeType
  color: string
  gradientStart: string
  gradientEnd: string
  label: string
}

/** 预设主题色 */
const THEMES: Record<ThemeType, ThemeConfig> = {
  checked: {
    type: 'checked',
    color: '#1ABC9C',
    gradientStart: '#48C9B0',
    gradientEnd: '#16A085',
    label: '已完成'
  },
  normal: {
    type: 'normal',
    color: '#1ABC9C',
    gradientStart: '#48C9B0',
    gradientEnd: '#16A085',
    label: '未记录'
  },
  warning: {
    type: 'warning',
    color: '#FF9800',
    gradientStart: '#FFB74D',
    gradientEnd: '#F57C00',
    label: '提醒'
  },
  danger: {
    type: 'danger',
    color: '#F44336',
    gradientStart: '#EF5350',
    gradientEnd: '#C62828',
    label: '危险'
  },
  frozen: {
    type: 'frozen',
    color: '#78909C',
    gradientStart: '#90A4AE',
    gradientEnd: '#546E7A',
    label: '冻结'
  }
}

/** 渐变关键点：时间(小时) -> 颜色 */
const TIME_COLOR_MAP: Array<{ hour: number; color: string }> = [
  { hour: 18, color: '#FFC107' },   // 琥珀色/深黄（更醒目）
  { hour: 19, color: '#FF9800' },   // 橙色
  { hour: 20, color: '#FF5722' },   // 深橙色
  { hour: 22, color: '#F44336' },    // 红色
  { hour: 23.5, color: '#B71C1C' }   // 深红/黑红
]

/** 基础绿色 */
const BASE_GREEN = '#1ABC9C'

/**
 * 线性插值计算颜色
 */
function lerpColor(color1: string, color2: string, ratio: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16)
  const g1 = parseInt(color1.slice(3, 5), 16)
  const b1 = parseInt(color1.slice(5, 7), 16)

  const r2 = parseInt(color2.slice(1, 3), 16)
  const g2 = parseInt(color2.slice(3, 5), 16)
  const b2 = parseInt(color2.slice(5, 7), 16)

  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * 根据时间计算渐变颜色（18:00后提醒，20:00后警告）
 * @param hour 当前小时（含小数，如 18.5 表示 18:30）
 */
function getColorByTime(hour: number): string {
  if (hour < 18) return BASE_GREEN

  // 找到当前时间所在的区间
  for (let i = 0; i < TIME_COLOR_MAP.length - 1; i++) {
    const curr = TIME_COLOR_MAP[i]
    const next = TIME_COLOR_MAP[i + 1]

    if (hour >= curr.hour && hour <= next.hour) {
      const ratio = (hour - curr.hour) / (next.hour - curr.hour)
      return lerpColor(curr.color, next.color, ratio)
    }
  }

  // 超过23:30，返回最深红色
  return TIME_COLOR_MAP[TIME_COLOR_MAP.length - 1].color
}

/**
 * 获取当前主题类型
 * @param checkedToday 今日是否已记录
 * @param checkedYesterday 昨日是否已记录
 */
export function getThemeType(checkedToday: boolean, checkedYesterday: boolean): ThemeType {
  if (checkedToday) return 'checked'
  if (!checkedYesterday) return 'frozen'

  const hour = new Date().getHours()
  if (hour < 20) return 'normal'
  if (hour < 22) return 'warning'
  return 'danger'
}

/**
 * 计算当前主题
 * @param checkedToday 今日是否已记录
 * @param checkedYesterday 昨日是否已记录
 */
export function calculateTheme(checkedToday: boolean, checkedYesterday: boolean): ThemeConfig {
  const themeType = getThemeType(checkedToday, checkedYesterday)

  if (themeType === 'checked') {
    return THEMES.checked
  }

  if (themeType === 'frozen') {
    return THEMES.frozen
  }

  // 未记录：根据时间计算动态颜色
  const hour = new Date().getHours() + new Date().getMinutes() / 60
  const dynamicColor = getColorByTime(hour)

  return {
    type: themeType,
    color: dynamicColor,
    gradientStart: dynamicColor,
    gradientEnd: dynamicColor,
    label: THEMES[themeType].label
  }
}

/**
 * 获取用户昨日记录状态
 */
export async function getYesterdayCheckin(userId: string): Promise<boolean> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const year = yesterday.getFullYear()
  const month = String(yesterday.getMonth() + 1).padStart(2, '0')
  const day = String(yesterday.getDate()).padStart(2, '0')
  const yesterdayStr = `${year}-${month}-${day}`

  const { total } = await checkinsCol()
    .where({ userId, date: yesterdayStr })
    .count()

  return total > 0
}

/**
 * 获取用户当前主题（需要查询数据库）
 */
export async function getUserTheme(userId: string): Promise<ThemeConfig> {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayStr = `${year}-${month}-${day}`

  // 查询今日记录
  const { total: todayTotal } = await checkinsCol()
    .where({ userId, date: todayStr })
    .count()

  const checkedToday = todayTotal > 0

  // 查询昨日记录
  const checkedYesterday = await getYesterdayCheckin(userId)

  return calculateTheme(checkedToday, checkedYesterday)
}

/**
 * 简单获取当前时间对应的主题颜色（不需要数据库查询）
 * 用于不需要精确昨日状态的场景
 */
export function getSimpleThemeColor(): string {
  const hour = new Date().getHours() + new Date().getMinutes() / 60
  return getColorByTime(hour)
}

export { THEMES }
