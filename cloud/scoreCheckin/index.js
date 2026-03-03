/**
 * 云函数：打卡内容评分 v3
 * 基于运动内容和运动量进行评分
 * 支持大模型对文字和图片进行运动识别
 */
const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 默认配置（可以通过云开发环境变量覆盖）
const DEFAULT_LLM_CONFIG = {
  apiKey: process.env.LLM_API_KEY || '',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.LLM_MODEL || 'gpt-4o-mini'
}

/**
 * 运动类型配置
 * 定义每种运动的推荐运动量和基础分
 */
const SPORT_CONFIG = {
  running: { name: '跑步', baseScore: 85, recommendedMinutes: 30, maxBonus: 15 },
  walking: { name: '走路', baseScore: 70, recommendedMinutes: 60, maxBonus: 10 },
  cycling: { name: '骑行', baseScore: 80, recommendedMinutes: 45, maxBonus: 15 },
  swimming: { name: '游泳', baseScore: 90, recommendedMinutes: 40, maxBonus: 10 },
  workout: { name: '健身', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  yoga: { name: '瑜伽', baseScore: 80, recommendedMinutes: 30, maxBonus: 10 },
  basketball: { name: '篮球', baseScore: 85, recommendedMinutes: 40, maxBonus: 15 },
  football: { name: '足球', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  tennis: { name: '网球', baseScore: 80, recommendedMinutes: 40, maxBonus: 10 },
  badminton: { name: '羽毛球', baseScore: 75, recommendedMinutes: 40, maxBonus: 10 },
  pingpong: { name: '乒乓球', baseScore: 70, recommendedMinutes: 40, maxBonus: 10 },
  dance: { name: '舞蹈', baseScore: 80, recommendedMinutes: 30, maxBonus: 15 },
  hiking: { name: '徒步', baseScore: 75, recommendedMinutes: 120, maxBonus: 15 },
  climbing: { name: '攀岩', baseScore: 85, recommendedMinutes: 60, maxBonus: 15 },
  other: { name: '其他运动', baseScore: 60, recommendedMinutes: 30, maxBonus: 10 }
}

/**
 * 运动识别系统提示词 - 文字解析
 */
const TEXT_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的运动识别助手。请从用户的打卡文字中识别出运动内容和运动量。

支持识别的运动类型：
- running(跑步)、walking(走路)、cycling(骑行)、swimming(游泳)
- workout(健身/力量训练)、yoga(瑜伽)、basketball(篮球)、football(足球)
- tennis(网球)、badminton(羽毛球)、pingpong(乒乓球)、dance(舞蹈)
- hiking(徒步)、climbing(攀岩)、other(其他运动)

运动量单位：
- km(公里)、m(米)、minutes(分钟)、times(次)、reps(组/次)、steps(步数)、kcal(卡路里)

请以JSON格式返回识别结果：
{
  "activities": [
    {
      "type": "运动类型(英文)",
      "amount": 数值,
      "unit": "单位",
      "duration": 时长(分钟,可选),
      "note": "补充说明"
    }
  ],
  "summary": "运动总结描述(30字以内)",
  "isValid": true/false(是否有有效运动)
}

注意：
- 只返回JSON，不要有其他内容
- 如果无法识别出具体运动，isValid设为false
- 优先识别明确的运动关键词：跑步、跑了几公里、走路、步数、骑行、游泳、健身、瑜伽、篮球、足球、羽毛球、跳舞、徒步等
- 时长优先于距离，没有明确时长可根据距离估算`

/**
 * 图片运动识别系统提示词
 */
const IMAGE_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的运动识别助手。请分析用户打卡照片中的运动内容和环境。

请仔细观察图片中的：
1. 运动类型（人在做什么运动）
2. 运动环境（室内/室外、健身房/公园/球场等）
3. 运动强度（轻松/中等/激烈）
4. 可能的运动时长或消耗

支持识别的运动类型：
- running(跑步)、walking(走路)、cycling(骑行)、swimming(游泳)
- workout(健身/力量训练)、yoga(瑜伽)、basketball(篮球)、football(足球)
- tennis(网球)、badminton(羽毛球)、pingpong(乒乓球)、dance(舞蹈)
- hiking(徒步)、climbing(攀岩)、other(其他运动)

请以JSON格式返回识别结果：
{
  "activities": [
    {
      "type": "运动类型(英文)",
      "amount": 估计数值,
      "unit": "单位(minutes/steps/km)",
      "note": "观察到的运动描述"
    }
  ],
  "summary": "图片运动总结(30字以内)",
  "isValid": true/false(是否能识别出运动)
}

注意：
- 只返回JSON，不要有其他内容
- 如果图片中无运动相关内容，isValid设为false
- 可以根据图片中的运动环境、装备等推断运动类型
- 公园/跑道图片可能暗示跑步走路，健身房图片暗示健身，球场图片暗示球类运动`

/**
 * 评分生成系统提示词
 */
const SCORE_SYSTEM_PROMPT = `你是一个专业的打卡评分助手。根据识别出的运动内容和运动量，对用户的打卡进行评分。

评分标准：
1. 运动完成度(0-100分)：根据是否达到该运动的推荐运动量
2. 运动量得分(0-100分)：根据实际运动量与推荐量的比例
3. 内容完整度(0-100分)：根据打卡内容的完整程度
4. 额外奖励(0-100分)：根据朋友圈发布等情况

运动推荐量：
- 跑步30分钟、走路60分钟、骑行45分钟、游泳40分钟
- 健身60分钟、瑜伽30分钟、篮球40分钟、足球60分钟
- 网球40分钟、羽毛球40分钟、乒乓球40分钟、舞蹈30分钟、徒步120分钟

请以JSON格式返回评分结果：
{
  "activityScore": 运动完成度分数,
  "amountScore": 运动量分数,
  "completenessScore": 内容完整度分数,
  "publishScore": 额外奖励分数,
  "totalScore": 总分,
  "feedback": "评语(50字以内)"
}

注意：
- 只返回JSON，不要有其他内容
- 总分 = 运动完成度*0.4 + 运动量*0.3 + 内容完整度*0.2 + 额外奖励*0.1
- 评分要客观公正，根据实际运动量评分`

/**
 * 将运动量转换为分钟数
 */
function convertToMinutes(activity) {
  const { type, amount, unit, duration } = activity

  if (duration) return duration

  switch (unit) {
    case 'minutes':
      return amount
    case 'km':
    case 'm':
      const distanceKm = unit === 'm' ? amount / 1000 : amount
      return type === 'running'
        ? Math.round(distanceKm * 6)
        : Math.round(distanceKm * 12)
    case 'steps':
      return Math.round(amount / 10000 * 60)
    case 'kcal':
      return Math.round(amount / 7)
    case 'times':
    case 'reps':
      return Math.round(amount * 4)
    default:
      return amount || 0
  }
}

/**
 * 计算运动完成度得分
 */
function calculateActivityScore(activities) {
  if (!activities || activities.length === 0) {
    return 0
  }

  let totalMinutes = 0
  for (const activity of activities) {
    totalMinutes += convertToMinutes(activity)
  }

  let score = 0
  if (totalMinutes < 15) {
    score = Math.round(totalMinutes / 15 * 40)
  } else if (totalMinutes < 30) {
    score = 40 + Math.round((totalMinutes - 15) / 15 * 40)
  } else {
    score = Math.min(100, 80 + Math.round((totalMinutes - 30) / 10) * 5)
  }

  return score
}

/**
 * 计算运动量得分
 */
function calculateAmountScore(activities) {
  if (!activities || activities.length === 0) {
    return 0
  }

  let totalScore = 0

  for (const activity of activities) {
    const config = SPORT_CONFIG[activity.type]
    if (!config) continue

    const actualMinutes = convertToMinutes(activity)
    const recommended = config.recommendedMinutes

    const ratio = actualMinutes / recommended

    let score
    if (ratio < 0.5) {
      score = ratio * config.baseScore
    } else if (ratio >= 1) {
      const bonus = Math.min(config.maxBonus, Math.round((ratio - 1) * 10))
      score = config.baseScore + bonus
    } else {
      score = config.baseScore * ratio
    }

    totalScore += score
  }

  return Math.round(totalScore / activities.length)
}

/**
 * 计算内容完整度得分
 */
function calculateCompletenessScore(content) {
  let score = 0

  if (content.text && content.text.trim().length > 0) {
    score += 30
  }

  if (content.text && content.text.trim().length >= 20) {
    score += 10
  }

  if (content.photos && content.photos.length > 0) {
    score += 40
  }

  if (content.photos && content.photos.length >= 2) {
    score += 10
  }

  if (content.isPublishToMoments) {
    score += 10
  }

  return Math.min(100, score)
}

/**
 * 朋友圈发布奖励
 */
function calculatePublishScore(isPublishToMoments) {
  return isPublishToMoments ? 100 : 0
}

/**
 * 生成评语
 */
function generateFeedback(activities, activityScore, amountScore, completenessScore, content) {
  const feedbacks = []

  if (!activities || activities.length === 0) {
    feedbacks.push('未识别到运动内容')
  } else {
    const sportNames = activities.map(a => SPORT_CONFIG[a.type]?.name || a.type)
    const uniqueSports = [...new Set(sportNames)]

    if (activityScore >= 80) {
      feedbacks.push(`很棒！完成了${uniqueSports.join('、')}运动`)
    } else if (activityScore >= 60) {
      feedbacks.push(`不错，${uniqueSports.join('、')}运动完成了`)
    } else if (activityScore >= 40) {
      feedbacks.push(`${uniqueSports.join('、')}运动有进步空间哦`)
    } else {
      feedbacks.push('运动量有点少，建议增加时长或强度')
    }

    const totalMinutes = activities.reduce((sum, a) => sum + convertToMinutes(a), 0)
    if (totalMinutes >= 60) {
      feedbacks.push('运动量很充足！')
    } else if (totalMinutes < 20) {
      feedbacks.push('可以尝试延长运动时间')
    }
  }

  if (completenessScore >= 80) {
    feedbacks.push('打卡内容很完整')
  } else if (completenessScore < 50) {
    if (!content.photos || content.photos.length === 0) {
      feedbacks.push('建议添加运动照片')
    }
    if (!content.text || content.text.trim().length < 10) {
      feedbacks.push('可以配上运动心得')
    }
  }

  if (content.isPublishToMoments) {
    feedbacks.push('分享到朋友圈正能量满满')
  }

  if (feedbacks.length === 0) {
    return '继续保持运动习惯！'
  }

  return feedbacks.join('，').replace('。。', '。') + '！'
}

/**
 * 调用大模型API
 */
async function callLLM(apiKey, baseUrl, model, messages) {
  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: messages,
        temperature: 0.3,
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 45000
      }
    )

    const content = response.data.choices[0]?.message?.content || ''

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    throw new Error('无法解析大模型返回的JSON')
  } catch (error) {
    console.error('LLM API调用失败:', error.message)
    throw error
  }
}

/**
 * 解析文字中的运动内容
 */
async function analyzeTextContent(apiKey, baseUrl, model, text) {
  const messages = [
    { role: 'system', content: TEXT_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: `请识别以下文字中的运动内容和运动量：\n\n${text}` }
  ]

  return await callLLM(apiKey, baseUrl, model, messages)
}

/**
 * 分析图片中的运动内容
 */
async function analyzeImageContent(apiKey, baseUrl, model, imageUrl) {
  const messages = [
    { role: 'system', content: IMAGE_ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: imageUrl }
        }
      ]
    }
  ]

  return await callLLM(apiKey, baseUrl, model, messages)
}

/**
 * 生成最终评分
 */
async function generateScore(apiKey, baseUrl, model, activities, content) {
  const messages = [
    { role: 'system', content: SCORE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请对以下运动打卡进行评分：

运动识别结果：${JSON.stringify(activities)}
打卡内容：${JSON.stringify(content)}

运动推荐量：
- 跑步30分钟、走路60分钟、骑行45分钟、游泳40分钟
- 健身60分钟、瑜伽30分钟、篮球40分钟、足球60分钟
- 网球40分钟、羽毛球40分钟、乒乓球40分钟、舞蹈30分钟、徒步120分钟`
    }
  ]

  return await callLLM(apiKey, baseUrl, model, messages)
}

/**
 * 获取云存储临时链接
 */
async function getTempFileURL(fileList) {
  try {
    const result = await cloud.getTempFileURL({
      fileList: fileList
    })
    return result.fileList.map(f => f.tempFileURL).filter(Boolean)
  } catch (error) {
    console.error('获取临时链接失败:', error)
    return []
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const {
    text,
    photos,
    isPublishToMoments = true, // 打卡默认发朋友圈
    useLLM = true
  } = event

  const content = {
    text,
    photos,
    isPublishToMoments
  }

  // 初始化识别结果
  let textActivities = []
  let imageActivities = []
  let textSummary = ''
  let imageSummary = ''
  let isValid = false
  let totalMinutes = 0

  const apiKey = process.env.LLM_API_KEY || DEFAULT_LLM_CONFIG.apiKey

  // 如果没有配置API Key，返回默认评分
  if (!apiKey || !useLLM) {
    const activityScore = 60
    const amountScore = 60
    const completenessScore = calculateCompletenessScore(content)
    const publishScore = calculatePublishScore(isPublishToMoments)

    const weights = {
      activity: 0.4,
      amount: 0.3,
      completeness: 0.2,
      publish: 0.1
    }

    const totalScore = Math.min(100, Math.round(
      activityScore * weights.activity +
      amountScore * weights.amount +
      completenessScore * weights.completeness +
      publishScore * weights.publish
    ))

    const feedback = generateFeedback(
      [],
      activityScore,
      amountScore,
      completenessScore,
      content
    )

    return {
      success: true,
      data: {
        totalScore,
        activityScore,
        amountScore,
        completenessScore,
        publishScore,
        feedback,
        activities: [],
        summary: '打卡成功',
        totalMinutes: 0,
        isValid: false
      }
    }
  }

  // 1. 解析文字内容
  if (text && text.trim().length > 0) {
    try {
      const textResult = await analyzeTextContent(
        apiKey,
        DEFAULT_LLM_CONFIG.baseUrl,
        DEFAULT_LLM_CONFIG.model,
        text
      )

      if (textResult && textResult.activities) {
        textActivities = textResult.activities
        textSummary = textResult.summary || ''
        isValid = textResult.isValid || textActivities.length > 0
      }
    } catch (error) {
      console.error('文字解析失败:', error)
    }
  }

  // 2. 解析图片内容
  if (photos && photos.length > 0) {
    try {
      // 获取云存储临时链接
      const tempUrls = await getTempFileURL(photos)

      for (const url of tempUrls) {
        try {
          const imageResult = await analyzeImageContent(
            apiKey,
            DEFAULT_LLM_CONFIG.baseUrl,
            DEFAULT_LLM_CONFIG.model,
            url
          )

          if (imageResult && imageResult.activities) {
            imageActivities = imageActivities.concat(imageResult.activities)
            imageSummary += imageResult.summary || ''
            isValid = isValid || imageResult.isValid
          }
        } catch (error) {
          console.error('图片解析失败:', error)
        }
      }
    } catch (error) {
      console.error('获取图片临时链接失败:', error)
    }
  }

  // 3. 合并运动识别结果
  const allActivities = [...textActivities, ...imageActivities]

  // 计算总运动分钟数
  totalMinutes = allActivities.reduce((sum, a) => sum + convertToMinutes(a), 0)
  isValid = isValid || allActivities.length > 0

  const summary = [textSummary, imageSummary].filter(Boolean).join('；') || (isValid ? '已完成运动打卡' : '打卡成功')

  // 4. 生成评分
  let activityScore = 0
  let amountScore = 0
  let completenessScore = calculateCompletenessScore(content)
  let publishScore = calculatePublishScore(isPublishToMoments)
  let feedback = ''
  let totalScore = 0

  if (allActivities.length > 0) {
    // 使用本地评分计算
    activityScore = calculateActivityScore(allActivities)
    amountScore = calculateAmountScore(allActivities)

    const weights = {
      activity: 0.4,
      amount: 0.3,
      completeness: 0.2,
      publish: 0.1
    }

    totalScore = Math.min(100, Math.round(
      activityScore * weights.activity +
      amountScore * weights.amount +
      completenessScore * weights.completeness +
      publishScore * weights.publish
    ))

    feedback = generateFeedback(
      allActivities,
      activityScore,
      amountScore,
      completenessScore,
      content
    )
  } else {
    // 无法识别运动时的默认评分
    activityScore = 30
    amountScore = 30
    completenessScore = calculateCompletenessScore(content)
    publishScore = calculatePublishScore(isPublishToMoments)

    const weights = {
      activity: 0.4,
      amount: 0.3,
      completeness: 0.2,
      publish: 0.1
    }

    totalScore = Math.min(100, Math.round(
      activityScore * weights.activity +
      amountScore * weights.amount +
      completenessScore * weights.completeness +
      publishScore * weights.publish
    ))

    feedback = content.photos?.length > 0
      ? '照片已收到，建议配上运动说明哦'
      : '打卡成功，建议描述一下今天的运动内容'
  }

  // 5. 如果大模型评分可用，尝试使用大模型生成评分
  if (allActivities.length > 0 && useLLM) {
    try {
      const llmScoreResult = await generateScore(
        apiKey,
        DEFAULT_LLM_CONFIG.baseUrl,
        DEFAULT_LLM_CONFIG.model,
        allActivities,
        content
      )

      if (llmScoreResult && llmScoreResult.totalScore !== undefined) {
        // 综合大模型评分和本地评分（取平均）
        totalScore = Math.round((totalScore + llmScoreResult.totalScore) / 2)
        activityScore = Math.round((activityScore + (llmScoreResult.activityScore || activityScore)) / 2)
        amountScore = Math.round((amountScore + (llmScoreResult.amountScore || amountScore)) / 2)

        if (llmScoreResult.feedback) {
          feedback = llmScoreResult.feedback
        }
      }
    } catch (error) {
      console.error('大模型评分失败，使用本地评分:', error)
    }
  }

  // 获取运动类型名称
  const sportTypes = allActivities.map(a => SPORT_CONFIG[a.type]?.name || a.type || '未知运动')

  return {
    success: true,
    data: {
      totalScore,
      activityScore,
      amountScore,
      completenessScore,
      publishScore,
      feedback,
      activities: allActivities,
      summary,
      totalMinutes,
      isValid,
      sportTypes: [...new Set(sportTypes)]
    }
  }
}
