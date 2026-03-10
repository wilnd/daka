/**
 * 云函数：AI 点评（以 checkin 为基础）
 * - 周点评：上周打卡摘要 → 详细(100-300字，含运动/学习/作息/进步点/小建议) + 本周整体概括(50-80字，概括本周做了哪些事)
 * - 月点评：上月各周周点评聚合 → 详细(200-400字，复盘成果/不足/成长/下月建议) + 简要点评(40-50字)
 * - 年点评：上一年各月月点评聚合 → 详细(300-500字，全年成长/突破/不足/来年方向) + 简要点评(40-50字)
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const CATEGORY_MAP = { sports: '运动', study: '学习', life: '生活', work: '工作' }

/**
 * 获取大模型实例（云函数需使用 wx-server-sdk 3.x 并开通云开发大模型扩展）
 * 若出现 401：请在云开发控制台开通「大模型」扩展，并确保腾讯混元服务已开通/已绑定
 */
function getAIModel() {
  const ai = typeof cloud.ai === 'function' ? cloud.ai() : (cloud.extend && cloud.extend.AI)
  if (!ai || typeof ai.createModel !== 'function') {
    throw new Error('当前环境不支持 cloud.ai()，请确认：1) 云函数依赖 wx-server-sdk@~3.0.5-beta.1 或更高；2) 已在云开发控制台开通「大模型」扩展')
  }
  return ai.createModel('hunyuan-exp')
}

/** 获取今日 YYYY-MM-DD */
function getTodayStr() {
  const d = new Date()
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本周一 YYYY-MM-DD */
function getWeekStartDate() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - (day === 0 ? 7 : day) + 1
  const mon = new Date(d)
  mon.setDate(diff)
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`
}

/** 本周日 YYYY-MM-DD */
function getWeekEndDate() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() + (day === 0 ? 0 : 7 - day)
  const sun = new Date(d)
  sun.setDate(diff)
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`
}

/** 上一周周一、周日 YYYY-MM-DD（用于周一 0 点定时跑「上周」批注） */
function getLastWeekStartEnd() {
  const d = new Date()
  const day = d.getDay()
  // 今天到上周日的天数：周一=1 则 1，周二=2 则 2，… 周日=0 则 7
  const daysToLastSun = day === 0 ? 7 : day
  const lastSun = new Date(d)
  lastSun.setDate(d.getDate() - daysToLastSun)
  const lastMon = new Date(lastSun)
  lastMon.setDate(lastSun.getDate() - 6)
  const pad = n => (n < 10 ? '0' + n : String(n))
  return {
    start: `${lastMon.getFullYear()}-${pad(lastMon.getMonth() + 1)}-${pad(lastMon.getDate())}`,
    end: `${lastSun.getFullYear()}-${pad(lastSun.getMonth() + 1)}-${pad(lastSun.getDate())}`
  }
}

/** 获取某天所在周的 ISO 周编号，返回 YYYY-Www */
function getPeriodWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const w = Math.ceil((((d - jan1) / 86400000) + 1) / 7)
  const y = d.getFullYear()
  return `${y}-W${String(w).padStart(2, '0')}`
}

/** 当月第一天、最后一天 YYYY-MM-DD */
function getMonthRange() {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth()
  const pad = n => (n < 10 ? '0' + n : String(n))
  const first = `${y}-${pad(m + 1)}-01`
  const last = new Date(y, m + 1, 0)
  const lastStr = `${y}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
  return { first, last: lastStr }
}

/** 当月 YYYY-MM */
function getPeriodMonth() {
  const d = new Date()
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 上一月 YYYY-MM（本月对上月点评用） */
function getLastMonthPeriod() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  const pad = n => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 上一年 YYYY（本年对上一年点评用） */
function getLastYear() {
  return String(new Date().getFullYear() - 1)
}

/** 上周所有打卡记录（按 _openid、日期+时间正序），分批拉取不遗漏 */
const CHECKIN_BATCH_SIZE = 100
async function getCheckinsInWeek(openid, weekStart, weekEnd) {
  const all = []
  let offset = 0
  while (true) {
    const { data: list } = await db.collection('checkins')
      .where({
        _openid: openid,
        date: _.and(_.gte(weekStart), _.lte(weekEnd))
      })
      .orderBy('date', 'asc')
      .orderBy('createTime', 'asc')
      .skip(offset)
      .limit(CHECKIN_BATCH_SIZE)
      .get()
    const batch = list || []
    all.push(...batch)
    if (batch.length < CHECKIN_BATCH_SIZE) break
    offset += CHECKIN_BATCH_SIZE
  }
  return all
}

/** 从单条 checkin 生成摘要：大类型/小类型/时长/时间/打卡说明（无则生成占位） */
function buildCheckinSummaryLine(c) {
  const date = c.date || ''
  const content = c.content || {}
  const catId = content.categoryId || ''
  const bigType = CATEGORY_MAP[catId] || (catId ? catId : '未分类')
  const subType = content.subCategoryId ? String(content.subCategoryId).slice(0, 12) : ''
  const duration = (content.duration && content.duration > 0) ? `${content.duration}分钟` : (content.durationUnit === 'hour' ? '按小时' : '-')
  let timeStr = ''
  const ct = c.createTime
  if (ct) {
    const d = typeof ct === 'object' && ct.getHours != null ? ct : new Date(ct)
    if (!isNaN(d.getTime())) timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const desc = (content.text && content.text.trim()) ? content.text.trim().slice(0, 120) : '无详细说明'
  return [date, bigType, subType, duration, timeStr, desc].filter(Boolean).join(' | ')
}

/** 上周周一～周日每一天的日期与星期标签 */
function getWeekDayLabels(weekStart, weekEnd) {
  const pad = n => (n < 10 ? '0' + n : String(n))
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const result = []
  const start = new Date(weekStart + 'T12:00:00')
  const end = new Date(weekEnd + 'T12:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (d > end) break
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    result.push({ dateStr, label: days[i] })
  }
  return result
}

/** 按日整理上周打卡，拼成一段完整文本发给 AI：周一～周日全覆盖，单日多条不遗漏 */
function buildWeeklyInputByDay(weekStart, weekEnd, checkinsInWeek) {
  const byDate = {}
  for (const c of checkinsInWeek) {
    const d = c.date || ''
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(buildCheckinSummaryLine(c))
  }
  const parts = []
  for (const { dateStr, label } of getWeekDayLabels(weekStart, weekEnd)) {
    const dayLines = byDate[dateStr]
    if (dayLines && dayLines.length > 0) {
      parts.push(`${label} ${dateStr}：${dayLines.join('；')}`)
    } else {
      parts.push(`${label} ${dateStr}：无打卡`)
    }
  }
  return `【上周按日汇总】周期 ${weekStart} 至 ${weekEnd}，共 ${checkinsInWeek.length} 条打卡。\n\n${parts.join('\n')}`
}

/**
 * 从 generateText 返回值中提取文本（兼容多种返回结构）
 * - 云开发 Node SDK：result.text
 * - OpenAI 风格：result.choices[0].message.content
 * - content 为数组时取 content[0].text
 */
function extractContentFromResult(result) {
  if (!result) return ''
  if (typeof result.text === 'string' && result.text.trim()) return result.text.trim()
  const c = result.choices && result.choices[0]
  if (!c) return ''
  const msg = c.message || c
  if (!msg) return ''
  let content = msg.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0]
    if (first && typeof first.text === 'string') return first.text.trim()
    if (first && typeof first.content === 'string') return first.content.trim()
  }
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text.trim()
  return ''
}

/** 解析 AI 返回的两段点评（详细 + 简要），用空行或明确分隔 */
function parseTwoPartReview(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim().replace(/^["']|["']$/g, '')
  if (!s) return null
  const byDoubleNewline = s.split(/\n\s*\n/)
  if (byDoubleNewline.length >= 2) {
    return { content: byDoubleNewline[0].trim(), contentShort: byDoubleNewline[byDoubleNewline.length - 1].trim() }
  }
  const secondMatch = s.match(/\n第二段[：:]\s*([\s\S]+)/) || s.match(/\n简要点评[：:]\s*([\s\S]+)/) || s.match(/\n本周整体概括[：:]\s*([\s\S]+)/)
  if (secondMatch) {
    return { content: s.slice(0, secondMatch.index).trim(), contentShort: secondMatch[1].trim() }
  }
  const mid = Math.min(200, Math.max(80, Math.floor(s.length / 2)))
  const idx = s.indexOf('。', mid)
  const splitAt = idx > 0 ? idx + 1 : mid
  return { content: s.slice(0, splitAt).trim(), contentShort: s.slice(splitAt).trim() }
}

/** 大模型调用日志：记录维度、入参长度、出参长度、耗时 */
function logAICall(dimension, period, inputLen, rawLen, durationMs, err) {
  const msg = err ? `[AI点评] ${dimension} period=${period} 失败` : `[AI点评] ${dimension} period=${period} 成功`
  console.log(msg, {
    dimension,
    period,
    inputChars: inputLen,
    outputChars: rawLen,
    durationMs: durationMs != null ? Math.round(durationMs) : undefined,
    error: err ? (err.message || String(err)) : undefined
  })
  if (err) console.error('[AI点评] 大模型调用异常', err)
}

/** 周点评：上周按日整理的打卡汇总 → AI 生成 详细(100-300字) + 本周整体概括(50-80字) */
async function generateWeeklyReview(checkinsInWeek, periodWeek, weekStart, weekEnd) {
  if (!checkinsInWeek || checkinsInWeek.length === 0) return null

  const input = buildWeeklyInputByDay(weekStart, weekEnd, checkinsInWeek)
  const inputLen = input.length

  const model = getAIModel()
  const messages = [
    {
      role: 'system',
      content: '你是打卡成长助手。请根据用户本周运动、学习、生活数据，生成两段内容。第一段：详细描述 100～300 字，包含运动、学习、作息、进步点、小建议，语言温暖、可加 1～2 个 emoji，纯文本无 markdown。第二段：本周整体概括 50～80 字，用一两句话概括本周主要做了哪些事（如运动了几次/学了什么/生活作息等），让读者一眼能看出这周做了什么，信息量足、不要泛泛的鼓励语，适合分享。两段之间请用空行分隔。'
    },
    { role: 'user', content: `上周按日汇总（周期 ${periodWeek}，${weekStart}～${weekEnd}）：\n\n${input}\n\n请根据以上「每天」的打卡情况生成两段：第一段详细描述100-300字（含运动、学习、作息、进步点、小建议）。第二段本周整体概括50-80字，概括本周主要做了哪些事情（如运动/学习/生活维度的具体内容与频率），整体描述、信息具体，两段之间空行分隔。` }
  ]
  const params = { type: 'weekly', period: periodWeek, model: 'hunyuan-t1-latest', messages, temperature: 0.7, max_tokens: 1500 }
  console.log('[AI点评] 周点评请求参数:', JSON.stringify({ ...params, messages: params.messages }, null, 2))

  const t0 = Date.now()
  let result
  try {
    result = await model.generateText({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    })
  } catch (e) {
    logAICall('weekly', periodWeek, inputLen, 0, Date.now() - t0, e)
    throw e
  }

  const raw = extractContentFromResult(result)
  const rawLen = raw.length
  if (rawLen === 0) {
    console.warn('[AI点评] 大模型返回内容为空，请检查返回结构。result keys:', result ? Object.keys(result) : 'null')
    if (result && result.choices && result.choices[0]) {
      console.warn('[AI点评] choices[0] keys:', Object.keys(result.choices[0]))
      if (result.choices[0].message) console.warn('[AI点评] message keys:', Object.keys(result.choices[0].message))
    }
  }
  logAICall('weekly', periodWeek, inputLen, rawLen, Date.now() - t0, null)
  return parseTwoPartReview(raw) || null
}

/** 月点评：上月各周周点评(详细) 聚合 → AI 生成 详细(200-400字) + 简要(40-50字) */
async function generateMonthlyReview(weeklyItems) {
  if (!weeklyItems || weeklyItems.length === 0) return null

  const input = weeklyItems.map((w, i) => `第${i + 1}周（${w.period}）：\n${w.content || ''}`).join('\n\n')
  const inputLen = input.length
  const periodLabel = `${weeklyItems.length}周`

  const model = getAIModel()
  const messages = [
    {
      role: 'system',
      content: '你是打卡成长助手。请根据用户本月运动、学习、习惯、目标完成情况，生成两段点评。第一段：详细描述 200～400 字，复盘成果、不足、成长、下月建议，纯文本。第二段：简要点评 40～50 字，总结亮点，鼓励为主，适合分享。两段之间用空行分隔。'
    },
    { role: 'user', content: `上月各周点评如下：\n${input}\n\n请生成两段月点评：第一段详细描述200-400字（复盘成果、不足、成长、下月建议），第二段简要点评40-50字，空行分隔。` }
  ]
  const params = { type: 'monthly', period: periodLabel, model: 'hunyuan-t1-latest', messages, temperature: 0.7, max_tokens: 3000 }
  console.log('[AI点评] 月点评请求参数:', JSON.stringify({ ...params, messages: params.messages }, null, 2))

  const t0 = Date.now()
  let result
  try {
    result = await model.generateText({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    })
  } catch (e) {
    logAICall('monthly', periodLabel, inputLen, 0, Date.now() - t0, e)
    throw e
  }

  const raw = extractContentFromResult(result)
  const rawLen = raw.length
  if (rawLen === 0) console.warn('[AI点评] 月点评大模型返回内容为空 result keys:', result ? Object.keys(result) : 'null')
  logAICall('monthly', periodLabel, inputLen, rawLen, Date.now() - t0, null)
  return parseTwoPartReview(raw) || null
}

/** 年点评：上一年各月月点评(详细) 聚合 → AI 生成 详细(300-500字) + 简要(40-50字) */
async function generateYearlyReview(monthlyItems) {
  if (!monthlyItems || monthlyItems.length === 0) return null

  const input = monthlyItems.map((m, i) => `${m.period}月：\n${m.content || ''}`).join('\n\n')
  const inputLen = input.length
  const periodLabel = `${monthlyItems.length}月`

  const model = getAIModel()
  const messages = [
    {
      role: 'system',
      content: '你是打卡成长助手。请根据用户全年运动、学习、成长、目标达成情况，生成两段年度点评。第一段：详细描述 300～500 字，总结全年成长、突破、不足、来年方向，纯文本。第二段：简要点评 40～50 字，温暖有力量，适合年度总结分享。两段之间用空行分隔。'
    },
    { role: 'user', content: `上一年各月点评如下：\n${input}\n\n请生成两段年点评：第一段详细描述300-500字（全年成长、突破、不足、来年方向），第二段简要点评40-50字，空行分隔。` }
  ]
  const params = { type: 'yearly', period: periodLabel, model: 'hunyuan-t1-latest', messages, temperature: 0.7, max_tokens: 5000 }
  console.log('[AI点评] 年点评请求参数:', JSON.stringify({ ...params, messages: params.messages }, null, 2))

  const t0 = Date.now()
  let result
  try {
    result = await model.generateText({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    })
  } catch (e) {
    logAICall('yearly', periodLabel, inputLen, 0, Date.now() - t0, e)
    throw e
  }

  const raw = extractContentFromResult(result)
  const rawLen = raw.length
  if (rawLen === 0) console.warn('[AI点评] 年点评大模型返回内容为空 result keys:', result ? Object.keys(result) : 'null')
  logAICall('yearly', periodLabel, inputLen, rawLen, Date.now() - t0, null)
  return parseTwoPartReview(raw) || null
}

/** 各档位 VIP 每月小勤点评生成次数上限（与 miniprogram/services/vip.ts 一致；每月初0点更新） */
const VIP_AI_REVIEW_QUOTA = { 0: 5, 1: 20, 2: 40, 3: 100 }

/** 当前月 YYYY-MM（与 resetAiReviewQuota、users.aiReviewQuotaMonth 一致） */
function getCurrentMonthStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 获取用户本月已使用小勤点评次数（来自 users.aiReviewUsedThisMonth，每月初由定时任务重置） */
async function getUsedAiReviewCountThisMonth(openid, user) {
  const monthStr = getCurrentMonthStr()
  const usersRes = await db.collection('users').where({ _openid: openid }).limit(1).get()
  const u = user || (usersRes.data && usersRes.data[0])
  if (!u) return 0
  if (u.aiReviewQuotaMonth === monthStr && u.aiReviewUsedThisMonth != null) {
    return u.aiReviewUsedThisMonth
  }
  return 0
}

/** 点评生成成功后：将用户本月已用次数 +1 并写回 users */
async function incrementUserAiReviewUsed(openid) {
  const monthStr = getCurrentMonthStr()
  const { data: users } = await db.collection('users').where({ _openid: openid }).limit(1).get()
  if (!users || users.length === 0) return
  const u = users[0]
  const current = (u.aiReviewQuotaMonth === monthStr && u.aiReviewUsedThisMonth != null) ? u.aiReviewUsedThisMonth : 0
  await db.collection('users').doc(u._id).update({
    data: {
      aiReviewUsedThisMonth: current + 1,
      aiReviewQuotaMonth: monthStr
    }
  })
}

/** 获取用户 VIP 等级对应的点评次数上限（未开通或已过期视为 0） */
async function getAiReviewQuota(openid) {
  const { data: users } = await db.collection('users').where({ _openid: openid }).limit(1).get()
  if (!users || users.length === 0) return 0
  const u = users[0]
  const level = u.vipLevel != null ? u.vipLevel : 0
  const expire = u.vipExpireTime ? new Date(u.vipExpireTime) : null
  if (expire && expire < new Date()) return 0 // 已过期
  return VIP_AI_REVIEW_QUOTA[level] != null ? VIP_AI_REVIEW_QUOTA[level] : 0
}

/** 新增 momentAnnotations（不覆盖历史，每次生成一条；content=详细点评，contentShort=简要点评，用于海报） */
async function addAnnotation(openid, type, period, content, contentShort) {
  const now = new Date()
  await db.collection('momentAnnotations').add({
    data: {
      _openid: openid,
      type,
      period,
      content: content || '',
      contentShort: contentShort || content || '',
      createTime: now
    }
  })
}

exports.main = async (event, context) => {
  const { action: paramAction, openid: paramOpenid } = event || {}

  let openid = paramOpenid
  if (!openid) {
    try {
      const wxContext = cloud.getWXContext()
      openid = (wxContext && wxContext.OPENID) || ''
    } catch (e) {
      console.error('getWXContext failed', e)
    }
  }
  if (!openid) {
    return { success: false, msg: '缺少用户标识' }
  }

  const action = paramAction
  if (!action) {
    return { success: false, msg: '请传入 action：weekly | monthly | yearly | getQuota' }
  }

  // 仅查询本月点评次数配额与已用（用于点评页展示剩余次数；已用来自 users.aiReviewUsedThisMonth）
  if (action === 'getQuota') {
    const [quota, used] = await Promise.all([getAiReviewQuota(openid), getUsedAiReviewCountThisMonth(openid)])
    return { success: true, quota, used, remaining: Math.max(0, quota - used) }
  }

  // 生成点评前需拿到 user，用于校验已用次数（每次点评消耗 1 次）
  const { data: userList } = await db.collection('users').where({ _openid: openid }).limit(1).get()
  const user = userList && userList[0] ? userList[0] : null

  if (!['weekly', 'monthly', 'yearly'].includes(action)) {
    return { success: false, msg: '请传入 action：weekly | monthly | yearly' }
  }

  // 按 VIP 档位校验本月小勤点评次数（开通即拥有额度，每月初0点更新）
  const quota = await getAiReviewQuota(openid)
  if (!quota || quota < 1) {
    return { success: false, msg: '小勤点评需开通VIP后使用，开通即拥有当月额度' }
  }
  // 每次生成都扣额度，不区分是否同周期已有点评（已用次数来自 users.aiReviewUsedThisMonth）
  const used = await getUsedAiReviewCountThisMonth(openid, user)
  if (used >= quota) {
    return {
      success: false,
      msg: `本月小勤点评次数已用完（${quota}次/月），升级VIP可获得更多次数`
    }
  }

  try {
    if (action === 'weekly') {
      // 周点评：取上周每条 checkin 的摘要进行汇总 → AI 生成 详细+简要，带周期与创建时间
      const { start: weekStart, end: weekEnd } = getLastWeekStartEnd()
      const period = getPeriodWeek(weekEnd)

      const checkinsInWeek = await getCheckinsInWeek(openid, weekStart, weekEnd)
      if (checkinsInWeek.length === 0) {
        return { success: false, msg: '上周暂无打卡数据', action: 'weekly', period }
      }

      let detail, brief
      try {
        const two = await generateWeeklyReview(checkinsInWeek, period, weekStart, weekEnd)
        detail = (two && two.content) ? two.content : `本周共 ${checkinsInWeek.length} 条打卡，坚持得很好～`
        brief = (two && two.contentShort) ? two.contentShort : detail.slice(0, 80)
      } catch (e) {
        console.error('AI 周点评失败', openid, e)
        if (e && (e.code === '401' || (e.message && e.message.includes('401')))) {
          console.error('[AI点评] 401 鉴权失败：请在云开发控制台开通「大模型」扩展，并确认已开通腾讯混元服务（混元控制台或云开发扩展绑定）')
        }
        detail = `本周共 ${checkinsInWeek.length} 条打卡，坚持得很好～`
        brief = detail.slice(0, 80)
      }
      const now = new Date()
      await addAnnotation(openid, 'weekly', period, detail, brief)
      await incrementUserAiReviewUsed(openid)
      return { success: true, action: 'weekly', period, data: { type: 'weekly', period, content: detail, contentShort: brief, createTime: now } }
    }

    if (action === 'monthly') {
      // 月点评：上月各周的最后一条周点评(详细) 聚合 → AI 生成 详细+简要，带周期与创建时间
      const month = getLastMonthPeriod()
      const weeklyList = await getWeeklyAnnotationsInMonth(openid, month)
      if (weeklyList.length === 0) {
        return { success: false, msg: '上月暂无周点评数据', action: 'monthly', period: month }
      }

      let detail, brief
      try {
        const two = await generateMonthlyReview(weeklyList)
        detail = (two && two.content) ? two.content : `上月共 ${weeklyList.length} 周有周点评，继续保持～`
        brief = (two && two.contentShort) ? two.contentShort : detail.slice(0, 50)
      } catch (e) {
        console.error('AI 月点评失败', openid, e)
        if (e && (e.code === '401' || (e.message && e.message.includes('401')))) {
          console.error('[AI点评] 401 鉴权失败：请在云开发控制台开通「大模型」扩展，并确认已开通腾讯混元服务')
        }
        detail = `上月共 ${weeklyList.length} 周有周点评，继续保持～`
        brief = detail.slice(0, 50)
      }
      const now = new Date()
      await addAnnotation(openid, 'monthly', month, detail, brief)
      await incrementUserAiReviewUsed(openid)
      return { success: true, action: 'monthly', period: month, data: { type: 'monthly', period: month, content: detail, contentShort: brief, createTime: now } }
    }

    if (action === 'yearly') {
      // 年点评：上一年各月月点评(详细) 聚合 → AI 生成 详细+简要，带周期与创建时间
      const year = getLastYear()
      const monthlyList = await getMonthlyAnnotationsInYear(openid, year)
      if (monthlyList.length === 0) {
        return { success: false, msg: '上一年暂无月点评数据', action: 'yearly', period: year }
      }

      let detail, brief
      try {
        const two = await generateYearlyReview(monthlyList)
        detail = (two && two.content) ? two.content : `上一年共 ${monthlyList.length} 个月有月点评，继续保持～`
        brief = (two && two.contentShort) ? two.contentShort : detail.slice(0, 50)
      } catch (e) {
        console.error('AI 年点评失败', openid, e)
        if (e && (e.code === '401' || (e.message && e.message.includes('401')))) {
          console.error('[AI点评] 401 鉴权失败：请在云开发控制台开通「大模型」扩展，并确认已开通腾讯混元服务')
        }
        detail = `上一年共 ${monthlyList.length} 个月有月点评，继续保持～`
        brief = detail.slice(0, 50)
      }
      const now = new Date()
      await addAnnotation(openid, 'yearly', year, detail, brief)
      await incrementUserAiReviewUsed(openid)
      return { success: true, action: 'yearly', period: year, data: { type: 'yearly', period: year, content: detail, contentShort: brief, createTime: now } }
    }

    return { success: false, msg: '不支持的 action' }
  } catch (error) {
    console.error('generateMomentAnnotations error', error)
    return { success: false, msg: error.message || '生成批注失败' }
  }
}

/** 在日期范围内有 moments 的 openid 列表（去重） */
async function getOpenidsWithMomentsInRange(start, end) {
  const { data } = await db.collection('moments')
    .where({ date: _.and(_.gte(start), _.lte(end)) })
    .field({ _openid: true })
    .limit(500)
    .get()

  const ids = [...new Set((data || []).map(m => m._openid || m.openid).filter(Boolean))]
  return ids
}

/** 当月有周批注的 openid 列表 */
async function getOpenidsWithWeeklyInMonth(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number)
  const weekPeriods = getWeekPeriodsInMonth(y, m)

  const { data } = await db.collection('momentAnnotations')
    .where({ type: 'weekly', period: _.in(weekPeriods) })
    .field({ _openid: true })
    .limit(500)
    .get()

  return [...new Set((data || []).map(a => a._openid || a.openid).filter(Boolean))]
}

/** 某月内所有周的 period 列表（YYYY-Www） */
function getWeekPeriodsInMonth(year, month) {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const periods = []
  const d = new Date(first)
  while (d <= last) {
    const pad = n => (n < 10 ? '0' + n : String(n))
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const p = getPeriodWeek(dateStr)
    if (!periods.includes(p)) periods.push(p)
    d.setDate(d.getDate() + 1)
  }
  return periods
}

/** 用户当月所有周批注（按周顺序） */
async function getWeeklyAnnotationsInMonth(openid, periodMonth) {
  const weekPeriods = getWeekPeriodsInMonth(
    ...periodMonth.split('-').map(Number)
  )
  const { data } = await db.collection('momentAnnotations')
    .where({ _openid: openid, type: 'weekly', period: _.in(weekPeriods) })
    .orderBy('period', 'asc')
    .get()

  return data || []
}

/** 当年有月批注的 openid 列表 */
async function getOpenidsWithMonthlyInYear(year) {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
    `${year}-${String(m).padStart(2, '0')}`
  )
  const { data } = await db.collection('momentAnnotations')
    .where({ type: 'monthly', period: _.in(months) })
    .field({ _openid: true })
    .limit(500)
    .get()

  return [...new Set((data || []).map(a => a._openid || a.openid).filter(Boolean))]
}

/** 用户当年所有月批注（按月顺序） */
async function getMonthlyAnnotationsInYear(openid, year) {
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m =>
    `${year}-${String(m).padStart(2, '0')}`
  )
  const { data } = await db.collection('momentAnnotations')
    .where({ _openid: openid, type: 'monthly', period: _.in(months) })
    .orderBy('period', 'asc')
    .get()

  return data || []
}
