/**
 * 金额统一使用 Decimal（等价于 BigDecimal），避免浮点精度问题。
 * 依赖 decimal.js，构建前请：npm install && 微信开发者工具 -> 构建 npm
 */
import Decimal from 'decimal.js'

export type Amount = string

/** 金额 0 */
export const ZERO: Amount = '0'

/**
 * 创建金额（支持 string/number，内部统一为 string）
 */
export function amount(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value
  return new Decimal(String(value))
}

/**
 * 加法
 */
export function add(a: Amount | number, b: Amount | number): Amount {
  return amount(a).plus(b).toString()
}

/**
 * 减法
 */
export function sub(a: Amount | number, b: Amount | number): Amount {
  return amount(a).minus(b).toString()
}

/**
 * 乘法
 */
export function mul(a: Amount | number, b: Amount | number): Amount {
  return amount(a).times(b).toString()
}

/**
 * 除法（默认保留 2 位小数，避免除不尽）
 */
export function div(a: Amount | number, b: Amount | number, scale = 2): Amount {
  return amount(a).div(b).toDecimalPlaces(scale).toString()
}

/**
 * 比较：相等
 */
export function eq(a: Amount | number, b: Amount | number): boolean {
  return amount(a).eq(b)
}

/**
 * 比较：大于
 */
export function gt(a: Amount | number, b: Amount | number): boolean {
  return amount(a).gt(b)
}

/**
 * 比较：大于等于
 */
export function gte(a: Amount | number, b: Amount | number): boolean {
  return amount(a).gte(b)
}

/**
 * 比较：小于
 */
export function lt(a: Amount | number, b: Amount | number): boolean {
  return amount(a).lt(b)
}

/**
 * 格式化为人民币展示（保留 2 位小数，无千分位）
 * 例如：formatYuan('9') => '9.00'，formatYuan('99.5') => '99.50'
 */
export function formatYuan(value: Amount | number): string {
  return amount(value).toDecimalPlaces(2).toString()
}

/**
 * 格式化为带符号的人民币展示，如 ¥9.00
 */
export function formatYuanWithSymbol(value: Amount | number): string {
  return '¥' + formatYuan(value)
}
