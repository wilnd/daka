/**
 * 轻量小数运算，用于金额计算，避免浮点精度问题。
 * 不依赖 npm 包，兼容微信小程序（无需构建 npm）。
 */

function parse(s: string): { int: string; frac: string; neg: boolean } {
  const str = String(s).trim()
  const neg = str.startsWith('-')
  const num = neg ? str.slice(1) : str
  const dot = num.indexOf('.')
  const int = dot < 0 ? num : num.slice(0, dot) || '0'
  const frac = dot < 0 ? '' : num.slice(dot + 1)
  return { int, frac, neg }
}

function toIntStr(p: { int: string; frac: string; neg: boolean }, scale: number): { val: string; neg: boolean } {
  const fracPadded = p.frac.padEnd(scale, '0').slice(0, scale)
  const intPart = !p.int || p.int === '0' ? '' : p.int
  const val = intPart + fracPadded
  return { val: val || '0', neg: p.neg }
}

function alignScale(a: ReturnType<typeof toIntStr>, b: ReturnType<typeof toIntStr>, scale: number): { a: string; b: string; negA: boolean; negB: boolean } {
  const len = Math.max(a.val.length, b.val.length, scale)
  const pad = (v: string) => v.padStart(len, '0')
  return { a: pad(a.val), b: pad(b.val), negA: a.neg, negB: b.neg }
}

export default class Decimal {
  private readonly _int: string
  private readonly _frac: string
  private readonly _neg: boolean

  constructor(value: string | number) {
    const p = parse(String(value))
    this._int = p.int
    this._frac = p.frac
    this._neg = p.neg
  }

  private _str(scale?: number): string {
    const frac = scale !== undefined ? this._frac.padEnd(scale, '0').slice(0, scale) : this._frac
    const sign = this._neg ? '-' : ''
    if (!frac) return sign + this._int
    return sign + this._int + '.' + frac
  }

  plus(b: string | number | Decimal): Decimal {
    const scale = Math.max(this._frac.length, b instanceof Decimal ? b._frac.length : parse(String(b)).frac.length)
    const pa = toIntStr({ int: this._int, frac: this._frac, neg: this._neg }, scale)
    const pb = toIntStr(b instanceof Decimal ? { int: (b as Decimal)._int, frac: (b as Decimal)._frac, neg: (b as Decimal)._neg } : parse(String(b)), scale)
    const { a: aStr, b: bStr, negA, negB } = alignScale(pa, pb, scale)
    let result: string
    if (negA === negB) {
      result = addIntStr(aStr, bStr)
      if (negA) result = '-' + result
    } else {
      const cmp = compareIntStr(aStr, bStr)
      if (cmp === 0) return new Decimal('0')
      result = cmp > 0 ? subIntStr(aStr, bStr) : subIntStr(bStr, aStr)
      if ((cmp > 0 && negA) || (cmp < 0 && negB)) result = '-' + result
    }
    return Decimal.fromIntStr(result, scale)
  }

  minus(b: string | number | Decimal): Decimal {
    const negB = b instanceof Decimal ? (b as Decimal)._neg : parse(String(b)).neg
    const bb = b instanceof Decimal ? new Decimal((b as Decimal)._str()) : new Decimal(String(b))
    return this.plus(bb._neg ? new Decimal(bb._str().slice(1)) : new Decimal('-' + bb._str()))
  }

  times(b: string | number | Decimal): Decimal {
    const other = b instanceof Decimal ? b : new Decimal(String(b))
    const scale = this._frac.length + other._frac.length
    const aVal = this._int + this._frac.padEnd(this._frac.length, '0')
    const bVal = other._int + other._frac.padEnd(other._frac.length, '0')
    const prod = mulIntStr(aVal.replace(/^0+/, '') || '0', bVal.replace(/^0+/, '') || '0')
    const neg = this._neg !== other._neg
    return Decimal.fromIntStr((neg ? '-' : '') + prod, scale)
  }

  div(b: string | number | Decimal, scale?: number): Decimal {
    const divisor = b instanceof Decimal ? b : new Decimal(String(b))
    const scaleOut = (scale !== undefined && scale !== null) ? scale : Math.max(this._frac.length, divisor._frac.length, 2)
    const num = (this._int + this._frac.padEnd(this._frac.length, '0')).replace(/^0+/, '') || '0'
    const den = (divisor._int + divisor._frac.padEnd(divisor._frac.length, '0')).replace(/^0+/, '') || '0'
    const numScaled = num + '0'.repeat(scaleOut)
    const q = divIntStr(numScaled, den)
    const intPart = q.length <= scaleOut ? '0' : q.slice(0, -scaleOut)
    const fracPart = q.slice(-scaleOut).padStart(scaleOut, '0')
    const neg = this._neg !== divisor._neg
    const resultStr = (neg && (intPart !== '0' || fracPart !== '00') ? '-' : '') + intPart + '.' + fracPart
    return new Decimal(resultStr)
  }

  toDecimalPlaces(scale: number): Decimal {
    const frac = this._frac.padEnd(scale, '0').slice(0, scale)
    return new Decimal((this._neg ? '-' : '') + this._int + (scale ? '.' + frac : ''))
  }

  eq(b: string | number | Decimal): boolean {
    return this._str() === (b instanceof Decimal ? (b as Decimal)._str() : new Decimal(String(b))._str())
  }

  gt(b: string | number | Decimal): boolean {
    const other = b instanceof Decimal ? b : new Decimal(String(b))
    if (this._neg !== other._neg) return !this._neg
    const scale = Math.max(this._frac.length, other._frac.length)
    const pa = toIntStr({ int: this._int, frac: this._frac, neg: false }, scale)
    const pb = toIntStr({ int: other._int, frac: other._frac, neg: false }, scale)
    const { a: aStr, b: bStr } = alignScale(pa, pb, scale)
    const cmp = compareIntStr(aStr, bStr)
    return this._neg ? cmp < 0 : cmp > 0
  }

  gte(b: string | number | Decimal): boolean {
    return this.eq(b) || this.gt(b)
  }

  lt(b: string | number | Decimal): boolean {
    return !this.gte(b)
  }

  toString(): string {
    return this._str()
  }

  private static fromIntStr(intStr: string, scale: number): Decimal {
    const neg = intStr.startsWith('-')
    const s = neg ? intStr.slice(1) : intStr
    const intPart = s.slice(0, -scale) || '0'
    const fracPart = s.slice(-scale).replace(/0+$/, '')
    const frac = scale > 0 ? fracPart.padStart(scale, '0').slice(-scale) : ''
    return new Decimal((neg ? '-' : '') + intPart + (frac ? '.' + frac : ''))
  }
}

function addIntStr(a: string, b: string): string {
  let carry = 0
  let i = a.length - 1
  let j = b.length - 1
  const out: number[] = []
  while (i >= 0 || j >= 0 || carry) {
    const sum = (i >= 0 ? +a[i] : 0) + (j >= 0 ? +b[j] : 0) + carry
    out.unshift(sum % 10)
    carry = (sum / 10) | 0
    i--
    j--
  }
  return out.join('').replace(/^0+/, '') || '0'
}

function subIntStr(a: string, b: string): string {
  let borrow = 0
  const out: number[] = []
  for (let i = a.length - 1; i >= 0; i--) {
    const j = i - (a.length - b.length)
    let d = +a[i] - (j >= 0 ? +b[j] : 0) - borrow
    if (d < 0) {
      d += 10
      borrow = 1
    } else borrow = 0
    out.unshift(d)
  }
  return out.join('').replace(/^0+/, '') || '0'
}

function compareIntStr(a: string, b: string): number {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return +a[i] > +b[i] ? 1 : -1
  }
  return 0
}

function mulIntStr(a: string, b: string): string {
  if (a === '0' || b === '0') return '0'
  const len = a.length + b.length
  const arr: number[] = new Array(len).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const p = +a[i] * +b[j] + arr[i + j + 1]
      arr[i + j + 1] = p % 10
      arr[i + j] += (p / 10) | 0
    }
  }
  for (let k = len - 1; k > 0; k--) {
    if (arr[k] >= 10) {
      arr[k - 1] += (arr[k] / 10) | 0
      arr[k] %= 10
    }
  }
  return arr.join('').replace(/^0+/, '') || '0'
}

/** Integer division: floor(a / b) */
function divIntStr(a: string, b: string): string {
  if (b === '0') throw new Error('Division by zero')
  let q = ''
  let rem = '0'
  for (let i = 0; i < a.length; i++) {
    rem = (rem === '0' ? '' : rem) + a[i]
    let d = 0
    while (compareIntStr(rem, b) >= 0) {
      rem = subIntStr(rem, b)
      d++
    }
    q += d
  }
  return q.replace(/^0+/, '') || '0'
}
