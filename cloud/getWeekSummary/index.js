/**
 * 云函数：获取一周打卡AI总结
 * 基于腾讯混元大模型生成一周打卡总结
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * 获取本周开始日期（周一）
 */
function getWeekStartDate() {
  const today = new Date()
  const day = today.getDay()
  const diff = today.getDate() - day + (day === 0 ? -6 : 1)
  const weekStart = new Date(today)
  weekStart.setDate(diff)
  const year = weekStart.getFullYear()
  const month = ('0' + (weekStart.getMonth() + 1)).slice(-2)
  const dayStr = ('0' + weekStart.getDate()).slice(-2)
  return year + '-' + month + '-' + dayStr
}

/**
 * 获取今天的日期字符串
 */
function getTodayStr() {
  const today = new Date()
  const year = today.getFullYear()
  const month = ('0' + (today.getMonth() + 1)).slice(-2)
  const day = ('0' + today.getDate()).slice(-2)
  return year + '-' + month + '-' + day
}

/**
 * 获取指定日期前N天的日期字符串
 */
function getDateBefore(dateStr, days) {
  const date = new Date(dateStr)
  date.setDate(date.getDate() - days)
  const year = date.getFullYear()
  const month = ('0' + (date.getMonth() + 1)).slice(-2)
  const day = ('0' + date.getDate()).slice(-2)
  return year + '-' + month + '-' + day
}

/**
 * 调用大模型生成一周总结
 */
async function generateWeekSummary(checkins, totalDays, totalCount, categoryId) {
  try {
    // 准备打卡数据摘要
    const categoryMap = {
      sports: '运动',
      study: '学习',
      life: '生活',
      work: '工作'
    }
    const categoryName = categoryMap[categoryId] || '运动'

    // 统计每天的打卡情况
    const dateStats = {}
    for (const checkin of checkins) {
      const date = checkin.date
      if (!dateStats[date]) {
        dateStats[date] = { count: 0, texts: [] }
      }
      dateStats[date].count++
      if (checkin.content && checkin.content.text) {
        dateStats[date].texts.push(checkin.content.text)
      }
    }

    // 计算本周打卡率
    const weekStart = getWeekStartDate()
    const today = getTodayStr()
    const daysInWeek = checkDiffDays(weekStart, today) + 1
    const checkInRate = Math.round((totalDays / daysInWeek) * 100)

    // 构建用户友好的数据摘要
    let dataSummary = `本周${categoryName}打卡记录：\n`
    dataSummary += `打卡天数：${totalDays}天 / ${daysInWeek}天（${checkInRate}%)\n`
    dataSummary += `打卡次数：${totalCount}次\n\n`

    // 添加本周亮点日期
    const sortedDates = Object.keys(dateStats).sort()
    if (sortedDates.length > 0) {
      dataSummary += '本周打卡日期：' + sortedDates.join('、') + '\n'
    }

    // 添加部分打卡内容摘要
    const allTexts = []
    for (const checkin of checkins) {
      if (checkin.content && checkin.content.text) {
        allTexts.push(checkin.content.text)
      }
    }
    if (allTexts.length > 0) {
      dataSummary += '\n打卡内容摘要：' + allTexts.slice(0, 3).join('；')
      if (allTexts.length > 3) {
        dataSummary += '...'
      }
    }

    // 调用大模型（文本总结用 instruct 模型）
    const model = cloud.ai().createModel('hunyuan-exp')

    const systemPrompt = `你是一个专业的${categoryName}打卡助手，擅长用温暖、正能量的语言总结用户的${categoryName}打卡记录。
请根据用户提供的本周打卡数据，生成一段 120～180 字的精彩周总结。
要求：
1. 语言温暖、正能量，有感染力
2. 突出坚持、进步和本周亮点（可概括打卡内容主题，但不要逐条罗列原文）
3. 可适当加入 1～2 个 emoji 让文案更生动
4. 不要使用 markdown 格式，直接输出纯文本
5. 分 2～4 句表达：如本周整体表现 + 具体亮点/进步 + 一句鼓励`

    const userPrompt = `用户本周打卡数据如下：\n${dataSummary}\n\n请生成一段 120～180 字的精彩周总结，突出坚持与进步，用温暖正能量的语言表达，不要逐字复述打卡原文。`

    const result = await model.generateText({
      model: 'hunyuan-t1-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 400
    })

    const rawContent = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content
    const content = (typeof rawContent === 'string' ? rawContent : '').trim()
    if (content && content.length > 20) {
      return content.replace(/^["']|["']$/g, '')
    }
    throw new Error('AI返回内容过短或为空')

  } catch (error) {
    console.error('生成AI总结失败:', error)
    throw error
  }
}

/**
 * 计算两个日期之间的天数差
 */
function checkDiffDays(startDate, endDate) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = end - start
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * 获取用户的主要打卡类别
 */
async function getUserMainCategory(openid) {
  try {
    const today = getTodayStr()
    const startDate = getDateBefore(today, 30) // 查询最近30天

    const checkinsRes = await db.collection('checkins')
      .where({
        _openid: openid,
        date: _.and(_.gte(startDate), _.lte(today))
      })
      .limit(100)
      .get()

    const checkins = checkinsRes.data || []

    // 统计各类别出现次数
    const categoryCount = {}
    for (const checkin of checkins) {
      if (checkin.content && checkin.content.categoryId) {
        const cat = checkin.content.categoryId
        categoryCount[cat] = (categoryCount[cat] || 0) + 1
      }
    }

    // 返回最常使用的类别
    let maxCount = 0
    let mainCategory = 'sports'
    for (const [cat, count] of Object.entries(categoryCount)) {
      if (count > maxCount) {
        maxCount = count
        mainCategory = cat
      }
    }

    return mainCategory

  } catch (e) {
    console.error('获取用户类别失败', e)
    return 'sports'
  }
}

// 云函数入口
exports.main = async (event, context) => {
  // 优先用入参 _openid，否则用鉴权上下文（小程序调用时必有）
  let openid = event._openid
  if (!openid) {
    try {
      const wxContext = cloud.getWXContext()
      openid = (wxContext && wxContext.OPENID) || ''
    } catch (e) {
      console.error('getWXContext 失败', e)
    }
  }
  if (!openid) {
    return { success: false, msg: '缺少_openid参数' }
  }

  try {
    // 获取本周数据
    const weekStart = getWeekStartDate()
    const today = getTodayStr()

    // 查询本周打卡记录（使用 _openid 与云端写入一致）
    const checkinsRes = await db.collection('checkins')
      .where({
        _openid: openid,
        date: _.and(_.gte(weekStart), _.lte(today))
      })
      .orderBy('date', 'asc')
      .get()

    const checkins = checkinsRes.data || []

    // 统计打卡天数和次数
    const uniqueDates = new Set(checkins.map(c => c.date))
    const totalDays = uniqueDates.size
    const totalCount = checkins.length

    // 如果本周没有打卡记录，返回默认文案
    if (totalDays === 0) {
      return {
        success: true,
        summary: '新的一周开始啦！继续保持，记录你的成长轨迹～'
      }
    }

    // 获取用户的主要打卡类别
    const categoryId = await getUserMainCategory(openid)

    const categoryMap = { sports: '运动', study: '学习', life: '生活', work: '工作' }
    const categoryName = categoryMap[categoryId] || '运动'
    const daysInWeek = Math.min(7, checkDiffDays(weekStart, today) + 1)
    const checkInRate = daysInWeek > 0 ? Math.round((totalDays / daysInWeek) * 100) : 0

    let summary
    try {
      summary = await generateWeekSummary(checkins, totalDays, totalCount, categoryId)
    } catch (aiError) {
      console.error('大模型生成总结失败，使用兜底文案:', aiError)
      summary = `本周${categoryName}打卡 ${totalDays} 天，共 ${totalCount} 次记录，打卡率约 ${checkInRate}%。坚持就是胜利，继续保持这份热情，下周一起加油～`
    }

    const finalSummary = (summary && summary.trim()) || `本周打卡 ${totalDays} 天，继续加油！`
    return {
      success: true,
      summary: finalSummary
    }

  } catch (error) {
    console.error('获取周总结失败:', error)
    return {
      success: false,
      msg: error.message || '获取周总结失败'
    }
  }
}
