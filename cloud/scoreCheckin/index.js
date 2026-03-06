/**
 * 云函数：打卡内容评分 v6
 * 基于运动内容和运动量进行评分
 * 支持大模型对文字和图片进行运动识别
 * 使用微信云开发免鉴权原生集成 - 腾讯混元大模型
 *
 * 优化点：
 * 1. 添加更多运动类型（中国特色运动：八段锦、太极、跳绳等）
 * 2. 优化提示词，提高识别准确率
 * 3. 添加完善的错误处理和重试机制
 * 4. 添加评分历史记录分析
 * 5. 支持运动目标设置
 * 6. 添加周/月统计报告功能
 * 7. 支持运动成就系统
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

/**
 * 默认评分配置
 */
const DEFAULT_CONFIG = {
  // 评分权重
  weights: {
    activity: 0.4,      // 运动完成度权重
    amount: 0.3,       // 运动量权重
    completeness: 0.2,  // 内容完整度权重
    bonus: 0.1         // 额外奖励权重
  },
  // 额外奖励配置
  bonus: {
    streakDays: 7,     // 连续打卡多少天开始有额外奖励
    streakBonus: 10,   // 连续打卡额外加分
    onTimeHours: [6, 9], // 按时打卡时间段（早上6-9点）
    onTimeBonus: 5,    // 按时打卡额外加分
    publishBonus: 5,   // 发布到成长墙额外加分
    goalBonus: 10,    // 完成目标额外加分
    perfectBonus: 5    // 完美打卡（文字+图片）额外加分
  },
  // 默认运动目标
  defaultGoal: {
    weeklyMinutes: 150,  // 每周150分钟（WHO推荐）
    weeklyDays: 5,      // 每周5天
    dailyMinutes: 30    // 每天30分钟
  }
}

/**
 * 运动类型配置（扩展版）
 * 包含更多中国特色运动
 */
const SPORT_CONFIG = {
  // 有氧运动
  running: { name: '跑步', category: '有氧', baseScore: 85, recommendedMinutes: 30, maxBonus: 15, met: 9.8, icon: '🏃' },
  walking: { name: '走路', category: '有氧', baseScore: 70, recommendedMinutes: 60, maxBonus: 10, met: 3.5, icon: '🚶' },
  cycling: { name: '骑行', category: '有氧', baseScore: 80, recommendedMinutes: 45, maxBonus: 15, met: 7.5, icon: '🚴' },
  swimming: { name: '游泳', category: '有氧', baseScore: 90, recommendedMinutes: 40, maxBonus: 10, met: 8.0, icon: '🏊' },
  hiking: { name: '徒步', category: '有氧', baseScore: 75, recommendedMinutes: 120, maxBonus: 15, met: 6.0, icon: '🥾' },
  ropeSkipping: { name: '跳绳', category: '有氧', baseScore: 85, recommendedMinutes: 30, maxBonus: 15, met: 10.0, icon: '🪢' },
  rollerSkating: { name: '轮滑', category: '有氧', baseScore: 80, recommendedMinutes: 40, maxBonus: 15, met: 7.5, icon: '🛼' },

  // 球类运动
  basketball: { name: '篮球', category: '球类', baseScore: 85, recommendedMinutes: 40, maxBonus: 15, met: 8.0, icon: '🏀' },
  football: { name: '足球', category: '球类', baseScore: 85, recommendedMinutes: 60, maxBonus: 15, met: 10.0, icon: '⚽' },
  tennis: { name: '网球', category: '球类', baseScore: 80, recommendedMinutes: 40, maxBonus: 10, met: 7.3, icon: '🎾' },
  badminton: { name: '羽毛球', category: '球类', baseScore: 75, recommendedMinutes: 40, maxBonus: 10, met: 5.5, icon: '🏸' },
  pingpong: { name: '乒乓球', category: '球类', baseScore: 70, recommendedMinutes: 40, maxBonus: 10, met: 4.0, icon: '🏓' },
  volleyball: { name: '排球', category: '球类', baseScore: 80, recommendedMinutes: 40, maxBonus: 10, met: 5.0, icon: '🏐' },

  // 健身运动
  workout: { name: '健身', category: '健身', baseScore: 85, recommendedMinutes: 60, maxBonus: 15, met: 6.0, icon: '🏋️' },
  yoga: { name: '瑜伽', category: '健身', baseScore: 80, recommendedMinutes: 30, maxBonus: 10, met: 3.0, icon: '🧘' },
  dance: { name: '舞蹈', category: '健身', baseScore: 80, recommendedMinutes: 30, maxBonus: 15, met: 6.0, icon: '💃' },
  climbing: { name: '攀岩', category: '健身', baseScore: 85, recommendedMinutes: 60, maxBonus: 15, met: 8.0, icon: '🧗' },
  fitness: { name: '力量训练', category: '健身', baseScore: 85, recommendedMinutes: 45, maxBonus: 15, met: 6.0, icon: '💪' },

  // 传统运动（中国特色）
  taiji: { name: '太极', category: '传统', baseScore: 75, recommendedMinutes: 30, maxBonus: 10, met: 3.0, icon: '☯️' },
  baduanjin: { name: '八段锦', category: '传统', baseScore: 75, recommendedMinutes: 20, maxBonus: 10, met: 3.0, icon: '🧘‍♂️' },
  qigong: { name: '气功', category: '传统', baseScore: 75, recommendedMinutes: 30, maxBonus: 10, met: 3.0, icon: '🫁' },
  wushu: { name: '武术', category: '传统', baseScore: 80, recommendedMinutes: 40, maxBonus: 15, met: 5.0, icon: '🥋' },
  xiyangyang: { name: '夕阳红健身', category: '传统', baseScore: 70, recommendedMinutes: 30, maxBonus: 10, met: 3.0, icon: '👴' },

  // 其他
  other: { name: '其他运动', category: '其他', baseScore: 60, recommendedMinutes: 30, maxBonus: 10, met: 5.0, icon: '🏃' }
}

/**
 * 运动关键词映射（用于快速识别）
 */
const SPORT_KEYWORDS = {
  running: ['跑', '跑步', '跑步机', '慢跑', '快走'],
  walking: ['走', '走路', '步行', '散步'],
  cycling: ['骑', '骑行', '骑车', '自行车'],
  swimming: ['游泳', '泳', '自由泳', '蛙泳'],
  hiking: ['徒步', '登山', '爬山', '郊游'],
  ropeSkipping: ['跳绳', '绳跳'],
  rollerSkating: ['轮滑', '滑旱冰'],
  basketball: ['篮球', '打球'],
  football: ['足球', '踢球'],
  tennis: ['网球', 'tennis'],
  badminton: ['羽毛球', '羽球', '打球'],
  pingpong: ['乒乓球', '桌球', 'ping pong'],
  volleyball: ['排球', '传球'],
  workout: ['健身', '健身房', '举铁', '器械'],
  yoga: ['瑜伽', '普拉提'],
  dance: ['舞蹈', '跳舞', '广场舞'],
  climbing: ['攀岩', '岩壁'],
  fitness: ['力量', '无氧', '器械训练'],
  taiji: ['太极', '太极拳'],
  baduanjin: ['八段锦', '八段'],
  qigong: ['气功', '导引'],
  wushu: ['武术', '功夫', '套路'],
  xiyangyang: ['夕阳红', '老年健身', '晨练']
}

/**
 * 运动识别系统提示词 - 文字解析（最终优化版）
 */
const TEXT_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的运动识别助手。请从用户的打卡文字中识别出运动内容和运动量。

支持识别的运动类型：
- 有氧：跑步(running)、走路(walking)、骑行(cycling)、游泳(swimming)、徒步(hiking)、跳绳(ropeSkipping)、轮滑(rollerSkating)
- 球类：篮球(basketball)、足球(football)、网球(tennis)、羽毛球(badminton)、乒乓球(pingpong)、排球(volleyball)
- 健身：健身(workout)、瑜伽(yoga)、舞蹈(dance)、攀岩(climbing)、力量训练(fitness)
- 传统(中国特色)：太极(taiji)、八段锦(baduanjin)、气功(qigong)、武术(wushu)

运动量单位：
- 分钟类：minutes/分钟/分/hour/小时
- 距离类：km(公里)/m(米)
- 步数：steps/步
- 卡路里：kcal/卡/卡路里
- 次数类：times/次、reps/组

识别规则：
1. 【优先级】时长 > 距离 > 次数 > 无数据
2. 【模糊识别】如果用户说"跑步了"但无数据，默认跑步30分钟
3. 【关键词匹配】优先识别明确运动关键词
4. 【智能推断】"跑了3公里" → {type: "running", amount: 3, unit: "km"}
5. 【单位统一】所有单位转换为标准格式

请以JSON格式返回识别结果：
{
  "activities": [
    {
      "type": "运动类型(英文小写)",
      "amount": 数值,
      "unit": "单位",
      "duration": 时长(分钟,可选),
      "note": "补充说明"
    }
  ],
  "summary": "运动总结(30字以内)",
  "isValid": true/false
}

注意：只返回JSON，不要有其他内容。准确识别运动类型是关键！`

/**
 * 图片运动识别系统提示词（最终优化版）
 */
const IMAGE_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的运动识别助手。请分析用户打卡照片中的运动内容和环境。

请仔细观察图片中的：
1. 运动类型（人在做什么运动）
2. 运动环境（室内/室外、健身房/公园/球场/海边/山间/家中等）
3. 运动强度（轻松/中等/激烈）
4. 可能的运动时长或消耗

支持识别的运动类型：
- 有氧：跑步(running)、走路(walking)、骑行(cycling)、游泳(swimming)、徒步(hiking)、跳绳(ropeSkipping)
- 球类：篮球(basketball)、足球(football)、网球(tennis)、羽毛球(badminton)、乒乓球(pingpong)、排球(volleyball)
- 健身：健身(workout)、瑜伽(yoga)、舞蹈(dance)、攀岩(climbing)、力量训练(fitness)
- 传统：太极(taiji)、八段锦(baduanjin)、气功(qigong)、武术(wushu)

识别规则：
1. 【场景推断】健身房→健身，公园跑道→跑步，球馆→球类运动
2. 【姿态识别】根据人物姿态判断运动类型
3. 【默认时长】无明确时长时：室内30分钟，室外40分钟
4. 【非运动】风景照/美食照/宠物照 → isValid: false

请以JSON格式返回识别结果：
{
  "activities": [
    {
      "type": "运动类型(英文小写)",
      "amount": 估计数值,
      "unit": "单位(minutes)",
      "note": "观察到的运动描述"
    }
  ],
  "summary": "图片运动总结(30字以内)",
  "isValid": true/false
}

注意：只返回JSON，不要有其他内容。优先识别运动场景和人物姿态！`

/**
 * 简化版评分提示词（可选保留用于调试或特殊场景）
 * 当前版本使用本地评分计算，不再需要 LLM 生成评分
 */
const SCORE_SYSTEM_PROMPT = null  // 已废弃，使用本地评分计算

/**
 * 将运动量转换为分钟数（优化版）
 * 增加了 MET 值计算，更精确估算卡路里消耗
 */
function convertToMinutes(activity, weight = 70) {
  const { type, amount, unit, duration } = activity

  if (duration) return duration
  if (!amount) return 0

  const config = SPORT_CONFIG[activity.type] || {}
  const met = config.met || 5  // 默认 MET 值

  switch (unit) {
    case 'minutes':
    case '分':
    case '分钟':
      return amount
    case 'hours':
    case '小时':
      return amount * 60
    case 'km':
    case '公里':
      return type === 'running'
        ? Math.round(amount * 10)
        : type === 'walking'
        ? Math.round(amount * 12)
        : Math.round(amount * 15)
    case 'm':
    case '米':
      const km = amount / 1000
      return type === 'running'
        ? Math.round(km * 10)
        : type === 'walking'
        ? Math.round(km * 12)
        : Math.round(km * 15)
    case 'steps':
    case '步':
      return Math.round(amount / 10000 * 60)
    case 'kcal':
    case '卡':
    case '卡路里':
      return Math.round(amount / (met * weight) * 60)
    case 'times':
    case '次':
      return Math.round(amount * 3)
    case 'reps':
    case '组':
      return Math.round(amount * 2)
    default:
      return amount || 0
  }
}

/**
 * 本地快速运动识别（基于关键词匹配）
 * 用于无 LLM 或 LLM 失败时的兜底方案
 */
function recognizeSportFromText(text) {
  if (!text) return null

  const lowerText = text.toLowerCase()

  // 遍历关键词映射
  for (const [sportType, keywords] of Object.entries(SPORT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        // 尝试提取运动量
        let amount = 0
        let unit = 'minutes'

        // 匹配数字 + 单位
        const numberPattern = /(\d+(?:\.\d+)?)\s*(公里|km|千米|m|米|分钟|分|小时|小时|步|次|组|卡|千卡)?/gi
        let match
        while ((match = numberPattern.exec(text)) !== null) {
          const num = parseFloat(match[1])
          const unitStr = match[2] || ''

          if (unitStr.includes('公') || unitStr.includes('km')) {
            amount = num
            unit = 'km'
            break
          } else if (unitStr.includes('米') || unitStr === 'm') {
            amount = num / 1000
            unit = 'km'
            break
          } else if (unitStr.includes('小')) {
            amount = num * 60
            unit = 'minutes'
            break
          } else if (unitStr.includes('步')) {
            amount = num
            unit = 'steps'
            break
          } else if (num > 0 && num < 500) {
            amount = num
            unit = 'minutes'
          }
        }

        // 默认运动量
        if (!amount) {
          const config = SPORT_CONFIG[sportType]
          amount = config ? config.recommendedMinutes : 30
          unit = 'minutes'
        }

        return {
          activities: [{
            type: sportType,
            amount: amount,
            unit: unit,
            note: `通过关键词"${keyword}"识别`
          }],
          summary: `进行了${SPORT_CONFIG[sportType]?.name || '运动'}`,
          isValid: true
        }
      }
    }
  }

  return null
}

/**
 * 智能解析用户输入
 * 优先使用本地识别，失败则使用 LLM
 */
async function analyzeTextSmart(text) {
  // 先尝试本地快速识别
  const localResult = recognizeSportFromText(text)
  if (localResult && localResult.isValid) {
    console.log('使用本地关键词识别成功')
    return localResult
  }

  // 本地识别失败，尝试 LLM
  try {
    return await analyzeTextContent(text)
  } catch (error) {
    console.error('文字解析失败:', error)
    // 返回兜底结果
    return {
      activities: [],
      summary: '未能识别运动内容',
      isValid: false
    }
  }
}

/**
 * 智能解析图片
 * 带重试机制
 */
async function analyzeImageSmart(imageUrl, retryCount = 2) {
  for (let i = 0; i < retryCount; i++) {
    try {
      return await analyzeImageContent(imageUrl)
    } catch (error) {
      console.error(`图片解析失败 (尝试 ${i + 1}/${retryCount}):`, error)
      if (i === retryCount - 1) {
        // 返回兜底结果
        return {
          activities: [],
          summary: '图片解析失败',
          isValid: false
        }
      }
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

/**
 * 计算运动完成度得分
 */
function calculateActivityScore(activities, totalMinutesFromUser = 0) {
  // 优先使用用户输入的时长
  const totalMinutes = totalMinutesFromUser > 0 ? totalMinutesFromUser : activities.reduce((sum, a) => sum + convertToMinutes(a), 0)

  if (totalMinutes === 0) {
    return 0
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
function calculateAmountScore(activities, totalMinutesFromUser = 0) {
  // 优先使用用户输入的时长
  const totalMinutes = totalMinutesFromUser > 0 ? totalMinutesFromUser : activities.reduce((sum, a) => sum + convertToMinutes(a), 0)

  if (totalMinutes === 0) {
    return 0
  }

  // 如果有用户输入的时长，按默认运动类型计算
  if (totalMinutesFromUser > 0 && (!activities || activities.length === 0)) {
    // 使用默认运动配置计算
    const config = SPORT_CONFIG['fitness'] || { recommendedMinutes: 30, baseScore: 30, maxBonus: 20 }
    const ratio = totalMinutes / config.recommendedMinutes
    let score
    if (ratio < 0.5) {
      score = ratio * config.baseScore
    } else if (ratio >= 1) {
      const bonus = Math.min(config.maxBonus, Math.round((ratio - 1) * 10))
      score = config.baseScore + bonus
    } else {
      score = config.baseScore * ratio
    }
    return Math.round(score)
  }

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
 * 根据打卡内容的完整程度给分：文本、照片、成长墙发布
 */
function calculateCompletenessScore(content) {
  if (!content) {
    return 0
  }

  let score = 0

  // 文本完整度 (最高40分)
  const text = content.text || ''
  if (text.length > 0) {
    if (text.length >= 50) {
      score += 40
    } else if (text.length >= 20) {
      score += 25
    } else if (text.length >= 10) {
      score += 15
    } else {
      score += 10
    }
  }

  // 照片完整度 (最高40分)
  const photos = content.photos || []
  if (photos.length > 0) {
    if (photos.length >= 3) {
      score += 40
    } else if (photos.length >= 2) {
      score += 30
    } else {
      score += 20
    }
  }

  // 成长墙发布标记 (最高20分)
  if (content.isPublishToMoments === true) {
    score += 20
  }

  return Math.min(100, score)
}

/**
 * 计算额外奖励得分（优化版）
 * 包含连续打卡奖励、按时打卡奖励、成长墙发布奖励
 */
function calculateBonusScore(options) {
  const { isPublishToMoments, streakDays = 0, checkinHour = new Date().getHours() } = options
  let bonus = 0

  // 连续打卡奖励
  if (streakDays >= 7) {
    bonus += 10
  } else if (streakDays >= 3) {
    bonus += 5
  }

  // 按时打卡奖励（早上6-9点）
  if (checkinHour >= 6 && checkinHour < 9) {
    bonus += 5
  }

  // 成长墙发布奖励
  if (isPublishToMoments) {
    bonus += 5
  }

  return bonus
}

/**
 * 生成评语（优化版）
 * 根据更多因素生成个性化评语
 */
function generateFeedback(options) {
  const { activities, activityScore, amountScore, completenessScore, content, streakDays = 0, totalMinutes = 0 } = options
  const { categoryId = '', subCategoryId = '' } = content || {}
  const feedbacks = []

  // 判断是运动类还是学习类
  const isStudy = categoryId === 'study'
  const isSports = categoryId === 'sports'
  const categoryName = isStudy ? '学习' : (isSports ? '运动' : '')

  // 未识别到运动但有时长输入
  if (!activities || activities.length === 0) {
    if (totalMinutes > 0) {
      // 根据类别生成评语
      if (isStudy) {
        // 学习类点评
        if (totalMinutes >= 60) {
          feedbacks.push('太棒了！学习超过1小时，专注力非常强！')
        } else if (totalMinutes >= 45) {
          feedbacks.push('学习45分钟以上，效率很高！')
        } else if (totalMinutes >= 30) {
          feedbacks.push('学习半小时，时长达标了！')
        } else if (totalMinutes >= 20) {
          feedbacks.push('学习20分钟以上，继续保持')
        } else {
          feedbacks.push('开始学习就是好样的，建议可以适当延长学习时间')
        }
      } else if (isSports) {
        // 运动类点评
        if (totalMinutes >= 60) {
          feedbacks.push('太棒了！运动时长超过1小时，非常厉害！')
        } else if (totalMinutes >= 45) {
          feedbacks.push('运动45分钟以上，状态很棒！')
        } else if (totalMinutes >= 30) {
          feedbacks.push('运动半小时，时长达标了！')
        } else if (totalMinutes >= 20) {
          feedbacks.push('运动20分钟以上继续保持')
        } else {
          feedbacks.push('开始运动就是好样的，建议可以适当延长时长')
        }
      } else {
        // 默认点评
        if (totalMinutes >= 60) {
          feedbacks.push('太棒了！活动时长超过1小时，非常厉害！')
        } else if (totalMinutes >= 45) {
          feedbacks.push('活动45分钟以上，状态很棒！')
        } else if (totalMinutes >= 30) {
          feedbacks.push('活动半小时，时长达标了！')
        } else {
          feedbacks.push('开始活动就是好样的，继续保持')
        }
      }
    } else {
      if (isStudy) {
        feedbacks.push('未识别到学习内容')
      } else {
        feedbacks.push('未识别到运动内容')
      }
    }
  } else {
    const sportNames = activities.map(a => (SPORT_CONFIG[a.type] && SPORT_CONFIG[a.type].name) || a.type)
    const uniqueSports = [...new Set(sportNames)]

    // 根据运动完成度生成评语
    if (activityScore >= 80) {
      if (isStudy) {
        feedbacks.push(`太棒了！完成了${uniqueSports.join('、')}学习任务`)
      } else {
        feedbacks.push(`太棒了！完成了${uniqueSports.join('、')}运动`)
      }
    } else if (activityScore >= 60) {
      if (isStudy) {
        feedbacks.push(`不错，${uniqueSports.join('、')}学习完成了`)
      } else {
        feedbacks.push(`不错，${uniqueSports.join('、')}运动完成了`)
      }
    } else if (activityScore >= 40) {
      if (isStudy) {
        feedbacks.push(`${uniqueSports.join('、')}学习有进步空间哦`)
      } else {
        feedbacks.push(`${uniqueSports.join('、')}运动有进步空间哦`)
      }
    } else {
      if (isStudy) {
        feedbacks.push('学习时间有点少，建议增加时长')
      } else {
        feedbacks.push('运动量有点少，建议增加时长或强度')
      }
    }

    // 根据运动时长生成评语
    if (totalMinutes >= 60) {
      if (isStudy) {
        feedbacks.push('学习时间非常充足！')
      } else {
        feedbacks.push('运动量非常充足！')
      }
    } else if (totalMinutes >= 30) {
      if (isStudy) {
        feedbacks.push('学习时长达标了')
      } else {
        feedbacks.push('运动时长达标了')
      }
    } else if (totalMinutes < 20) {
      if (isStudy) {
        feedbacks.push('可以尝试延长学习时间')
      } else {
        feedbacks.push('可以尝试延长运动时间')
      }
    }
  }

  // 根据内容完整度生成评语
  if (completenessScore >= 80) {
    feedbacks.push('打卡内容很完整')
  } else if (completenessScore < 50) {
    if (!content.photos || content.photos.length === 0) {
      if (isStudy) {
        feedbacks.push('建议添加学习照片')
      } else {
        feedbacks.push('建议添加运动照片')
      }
    }
    if (!content.text || content.text.trim().length < 10) {
      if (isStudy) {
        feedbacks.push('可以配上学习心得')
      } else {
        feedbacks.push('可以配上运动心得')
      }
    }
  }

  // 成长墙发布
  if (content.isPublishToMoments) {
    feedbacks.push('分享到成长墙正能量满满')
  }

  // 连续打卡
  if (streakDays >= 7) {
    feedbacks.push(`连续打卡${streakDays}天，太厉害了！`)
  } else if (streakDays >= 3) {
    feedbacks.push(`已经连续打卡${streakDays}天，继续保持！`)
  }

  if (feedbacks.length === 0) {
    return isStudy ? '继续保持学习习惯！' : '继续保持运动习惯！'
  }

  return feedbacks.join('，').replace(/。。/g, '。').slice(0, 50) + '！'
}

/**
 * 调用大模型API - 使用微信云开发免鉴权原生集成
 */
async function callLLM(messages) {
  try {
    const model = cloud.ai().createModel('hunyuan-exp')

    const result = await model.generateText({
      model: 'hunyuan-vision-1.5-instruct',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1000
    })

    const content = result.choices[0].message.content

    // 提取JSON
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
 * 调用大模型API - 流式版本
 */
async function* callLLMStream(messages) {
  const model = cloud.ai().createModel('hunyuan-exp')

  const res = await model.streamText({
    data: {
      model: 'hunyuan-vision-1.5-instruct',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1000
    }
  })

  let fullText = ''
  for await (const text of res.textStream) {
    fullText += text
    yield { type: 'text', content: text }
  }

  // 尝试解析JSON
  const jsonMatch = fullText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      yield { type: 'json', content: JSON.parse(jsonMatch[0]) }
    } catch (e) {
      // JSON解析失败，忽略
    }
  }
}

/**
 * 解析文字中的运动内容
 */
async function analyzeTextContent(text) {
  const messages = [
    { role: 'system', content: TEXT_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: `请识别以下文字中的运动内容和运动量：\n\n${text}` }
  ]

  return await callLLM(messages)
}

/**
 * 分析图片中的运动内容
 */
async function analyzeImageContent(imageUrl) {
  const messages = [
    { role: 'system', content: IMAGE_ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请分析这张图片中的运动内容：' },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ]

  return await callLLM(messages)
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

/**
 * 获取用户连续打卡天数
 */
async function getUserStreakDays(openid, groupId) {
  try {
    // 查询最近30天的打卡记录（使用 date 字段，包含补卡）
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(now.getDate() - 30)
    const startDateStr = getDateStr(thirtyDaysAgo)

    const { data: checkins } = await db.collection('checkins')
      .where({
        _openid: openid,
        groupId: groupId,
        date: _.gte(startDateStr)
      })
      .orderBy('date', 'desc')
      .get()

    if (!checkins || checkins.length === 0) {
      return 0
    }

    // 按日期去重（date 字段为 YYYY-MM-DD）
    const dateSet = new Set(checkins.map(c => c.date).filter(Boolean))
    const today = getDateStr(now)
    const yesterday = getDateStr(new Date(now.getTime() - 86400000))

    // 从昨天或今天开始往前统计连续天数
    let streak = 0
    let startDay = dateSet.has(today) ? today : (dateSet.has(yesterday) ? yesterday : null)
    if (!startDay) return 0

    let cur = startDay
    for (let i = 0; i < 30; i++) {
      if (dateSet.has(cur)) {
        streak++
        const d = new Date(cur)
        d.setDate(d.getDate() - 1)
        cur = getDateStr(d)
      } else {
        break
      }
    }

    return streak
  } catch (error) {
    console.error('获取连续打卡天数失败:', error)
    return 0
  }
}

/**
 * 获取用户运动目标
 */
async function getUserGoal(openid, groupId) {
  try {
    const { data: goals } = await db.collection('userGoals')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .limit(1)
      .get()

    if (goals && goals.length > 0) {
      return goals[0]
    }

    // 返回默认目标
    return {
      ...DEFAULT_CONFIG.defaultGoal,
      weeklyMinutes: DEFAULT_CONFIG.defaultGoal.weeklyMinutes,
      weeklyDays: DEFAULT_CONFIG.defaultGoal.weeklyDays,
      dailyMinutes: DEFAULT_CONFIG.defaultGoal.dailyMinutes
    }
  } catch (error) {
    console.error('获取用户目标失败:', error)
    return DEFAULT_CONFIG.defaultGoal
  }
}

/**
 * 设置用户运动目标
 */
async function setUserGoal(openid, groupId, goal) {
  try {
    // 检查是否已存在
    const { data: existing } = await db.collection('userGoals')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .limit(1)
      .get()

    if (existing && existing.length > 0) {
      // 更新
      await db.collection('userGoals')
        .doc(existing[0]._id)
        .update({
          data: {
            ...goal,
            updateTime: new Date()
          }
        })
    } else {
      // 创建
      await db.collection('userGoals')
        .add({
          data: {
            _openid: openid,
            groupId: groupId,
            ...goal,
            createTime: new Date(),
            updateTime: new Date()
          }
        })
    }

    return { success: true }
  } catch (error) {
    console.error('设置用户目标失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 计算目标完成度
 */
async function calculateGoalProgress(openid, groupId, goal) {
  try {
    // 获取本周开始时间
    const now = new Date()
    const dayOfWeek = now.getDay() || 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - dayOfWeek + 1)
    weekStart.setHours(0, 0, 0, 0)

    // 获取本周打卡记录（使用 date 字段以正确包含补卡天数）
    const weekStartStr = getDateStr(weekStart)
    const { data: weekCheckins } = await db.collection('checkins')
      .where({
        _openid: openid,
        groupId: groupId,
        date: _.gte(weekStartStr)
      })
      .get()

    // 计算本周统计数据
    let totalMinutes = 0
    const checkinDays = new Set()

    for (const checkin of weekCheckins || []) {
      totalMinutes += (checkin.score?.totalMinutes ?? checkin.totalMinutes) || 0
      // 使用 date 字段（补卡的实际日期），而非 createTime
      checkinDays.add(checkin.date)
    }

    const weekDays = checkinDays.size
    const weekMinutes = totalMinutes

    // 计算完成度
    const weeklyProgress = Math.min(100, Math.round((weekMinutes / goal.weeklyMinutes) * 100))
    const dailyProgress = Math.min(100, Math.round((totalMinutes / goal.dailyMinutes) * 100))
    const daysProgress = Math.min(100, Math.round((weekDays / goal.weeklyDays) * 100))

    // 综合完成度
    const overallProgress = Math.round((weeklyProgress * 0.5 + daysProgress * 0.5))

    return {
      weeklyMinutes: weekMinutes,
      weeklyDays: weekDays,
      dailyMinutes: Math.round(totalMinutes / Math.max(1, weekDays)),
      weeklyProgress,
      dailyProgress,
      daysProgress,
      overallProgress,
      isGoalAchieved: overallProgress >= 100
    }
  } catch (error) {
    console.error('计算目标进度失败:', error)
    return null
  }
}

/**
 * 获取用户统计报告
 */
async function getUserStats(openid, groupId, period = 'week') {
  try {
    const now = new Date()
    let startDateStr = null

    if (period === 'week') {
      const weekStart = new Date(now)
      const dayOfWeek = now.getDay() || 7
      weekStart.setDate(now.getDate() - dayOfWeek + 1)
      startDateStr = getDateStr(weekStart)
    } else if (period === 'month') {
      const monthStart = new Date(now)
      monthStart.setDate(1)
      startDateStr = getDateStr(monthStart)
    } else if (period === 'year') {
      startDateStr = `${now.getFullYear()}-01-01`
    }

    // 构建查询条件：使用 date 字段以正确包含补卡天数
    const queryWhere = {
      _openid: openid,
      groupId: groupId
    }
    if (startDateStr) {
      queryWhere.date = _.gte(startDateStr)
    }

    // 获取指定期间的打卡记录
    const { data: checkins } = await db.collection('checkins')
      .where(queryWhere)
      .orderBy('date', 'desc')
      .get()

    if (!checkins || checkins.length === 0) {
      return {
        period,
        totalCheckins: 0,
        totalMinutes: 0,
        totalScore: 0,
        avgScore: 0,
        sports: [],
        days: [],
        streak: 0,
        bestStreak: 0
      }
    }

    // 计算统计数据
    let totalMinutes = 0
    let totalScore = 0
    const sportsCount = {}
    const daysSet = new Set()

    for (const checkin of checkins) {
      totalMinutes += (checkin.score?.totalMinutes ?? checkin.totalMinutes) || 0
      totalScore += (checkin.score?.totalScore ?? checkin.totalScore) || 0

      // 使用 date 字段（补卡的实际日期），而非 createTime
      daysSet.add(checkin.date)

      // 统计运动类型
      const sportTypes = checkin.sportTypes || checkin.content?.sportTypes || checkin.score?.sportTypes || []
      for (const sport of sportTypes) {
        sportsCount[sport] = (sportsCount[sport] || 0) + 1
      }
    }

    // 排序运动类型
    const sports = Object.entries(sportsCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))

    // 获取连续打卡和最佳连续
    const { streak, bestStreak } = await calculateStreakInfo(openid, groupId, checkins)

    return {
      period,
      totalCheckins: checkins.length,
      totalMinutes,
      totalScore,
      avgScore: Math.round(totalScore / checkins.length),
      sports,
      days: Array.from(daysSet).length,
      streak,
      bestStreak
    }
  } catch (error) {
    console.error('获取用户统计失败:', error)
    return null
  }
}

/**
 * 计算连续打卡信息
 */
async function calculateStreakInfo(openid, groupId, checkins) {
  if (!checkins || checkins.length === 0) {
    return { streak: 0, bestStreak: 0 }
  }

  // 按日期去重（使用 date 字段，含补卡实际日期）
  const dateSet = new Set()
  for (const checkin of checkins) {
    if (checkin.date) {
      dateSet.add(checkin.date)
    }
  }

  // 降序排列日期字符串（YYYY-MM-DD 可直接字符串排序）
  const sortedDates = Array.from(dateSet).sort((a, b) => b > a ? 1 : -1)

  let currentStreak = 0
  let bestStreak = 0
  let tempStreak = 0
  let prevDate = null

  const today = getDateStr(new Date())
  const yesterday = getDateStr(new Date(Date.now() - 86400000))

  for (const date of sortedDates) {
    if (prevDate === null) {
      tempStreak = 1
      if (date === today || date === yesterday) {
        currentStreak = 1
      }
    } else {
      // YYYY-MM-DD 字符串相差天数计算
      const diffDays = (new Date(prevDate) - new Date(date)) / 86400000

      if (diffDays === 1) {
        tempStreak++
        if (currentStreak > 0) {
          currentStreak++
        }
      } else {
        bestStreak = Math.max(bestStreak, tempStreak)
        tempStreak = 1
        if (currentStreak > 0) {
          currentStreak = 0
        }
      }
    }
    prevDate = date
  }

  bestStreak = Math.max(bestStreak, tempStreak, currentStreak)

  return { streak: currentStreak, bestStreak }
}

/**
 * 成就定义
 */
const ACHIEVEMENTS = {
  // 连续打卡成就
  streak: {
    first: { name: '初出茅庐', desc: '连续打卡3天', days: 3, icon: '🌱' },
    week: { name: '坚持不懈', desc: '连续打卡7天', days: 7, icon: '🌿' },
    halfMonth: { name: '习惯养成', desc: '连续打卡14天', days: 14, icon: '🌳' },
    month: { name: '持之以恒', desc: '连续打卡30天', days: 30, icon: '🏆' },
    quarter: { name: '运动达人', desc: '连续打卡90天', days: 90, icon: '👑' }
  },
  // 运动量成就
  volume: {
    tenHours: { name: '挥汗如雨', desc: '累计运动10小时', minutes: 600, icon: '💦' },
    fiftyHours: { name: '运动健将', desc: '累计运动50小时', minutes: 3000, icon: '🏃' },
    hundredHours: { name: '运动传奇', desc: '累计运动100小时', minutes: 6000, icon: '⭐' }
  },
  // 打卡成就
  checkin: {
    ten: { name: '小试牛刀', desc: '累计打卡10次', count: 10, icon: '🎯' },
    fifty: { name: '运动爱好者', desc: '累计打卡50次', count: 50, icon: '❤️' },
    hundred: { name: '运动达人', desc: '累计打卡100次', count: 100, icon: '🔥' },
    fiveHundred: { name: '运动传奇', desc: '累计打卡500次', count: 500, icon: '💎' }
  },
  // 完美打卡成就
  perfect: {
    ten: { name: '完美主义者', desc: '10次完美打卡(文字+图片)', count: 10, icon: '✨' },
    fifty: { name: '记录达人', desc: '50次完美打卡', count: 50, icon: '📸' }
  }
}

/**
 * 检查并解锁成就
 */
async function checkAchievements(openid, groupId) {
  try {
    // 获取所有打卡记录
    const { data: checkins } = await db.collection('checkins')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .get()

    if (!checkins || checkins.length === 0) {
      return { unlocked: [], new: [] }
    }

    // 获取已解锁成就
    const { data: existingAchievements } = await db.collection('userAchievements')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .get()

    const unlockedIds = new Set(existingAchievements.map(a => a.achievementId))

    // 计算统计数据
    let totalMinutes = 0
    let perfectCount = 0
    let bestStreak = 0

    const { streak } = await calculateStreakInfo(openid, groupId, checkins)

    for (const checkin of checkins) {
      totalMinutes += (checkin.score?.totalMinutes ?? checkin.totalMinutes) || 0
      if (checkin.completenessScore >= 90) {
        perfectCount++
      }
    }

    // 检查新成就
    const newAchievements = []

    // 连续打卡成就
    for (const [key, achievement] of Object.entries(ACHIEVEMENTS.streak)) {
      const id = `streak_${key}`
      if (!unlockedIds.has(id) && streak >= achievement.days) {
        newAchievements.push({ id, ...achievement, type: 'streak' })
      }
    }

    // 运动量成就
    for (const [key, achievement] of Object.entries(ACHIEVEMENTS.volume)) {
      const id = `volume_${key}`
      if (!unlockedIds.has(id) && totalMinutes >= achievement.minutes) {
        newAchievements.push({ id, ...achievement, type: 'volume' })
      }
    }

    // 打卡成就
    for (const [key, achievement] of Object.entries(ACHIEVEMENTS.checkin)) {
      const id = `checkin_${key}`
      if (!unlockedIds.has(id) && checkins.length >= achievement.count) {
        newAchievements.push({ id, ...achievement, type: 'checkin' })
      }
    }

    // 完美打卡成就
    for (const [key, achievement] of Object.entries(ACHIEVEMENTS.perfect)) {
      const id = `perfect_${key}`
      if (!unlockedIds.has(id) && perfectCount >= achievement.count) {
        newAchievements.push({ id, ...achievement, type: 'perfect' })
      }
    }

    // 保存新成就
    for (const achievement of newAchievements) {
      await db.collection('userAchievements').add({
        data: {
          _openid: openid,
          groupId: groupId,
          achievementId: achievement.id,
          type: achievement.type,
          name: achievement.name,
          desc: achievement.desc,
          icon: achievement.icon,
          unlockedAt: new Date()
        }
      })
    }

    // 获取所有已解锁成就
    const { data: allAchievements } = await db.collection('userAchievements')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .get()

    return {
      unlocked: allAchievements || [],
      new: newAchievements
    }
  } catch (error) {
    console.error('检查成就失败:', error)
    return { unlocked: [], new: [] }
  }
}

/**
 * 获取用户成就列表
 */
async function getUserAchievements(openid, groupId) {
  try {
    const { data: achievements } = await db.collection('userAchievements')
      .where({
        _openid: openid,
        groupId: groupId
      })
      .orderBy('unlockedAt', 'desc')
      .get()

    return achievements || []
  } catch (error) {
    console.error('获取成就失败:', error)
    return []
  }
}

/**
 * 统一的评分计算函数
 */
function calculateScores(activities, content, options = {}) {
  const { streakDays = 0, checkinHour = new Date().getHours(), userDurationMinutes = 0 } = options
  const weights = DEFAULT_CONFIG.weights

  // 使用用户输入的时长，如果没有则从活动中计算
  const totalMinutes = userDurationMinutes > 0 ? userDurationMinutes : activities.reduce((sum, a) => sum + convertToMinutes(a), 0)

  // 1. 运动完成度得分
  const activityScore = activities.length > 0 || totalMinutes > 0 ? calculateActivityScore(activities, totalMinutes) : 30

  // 2. 运动量得分
  const amountScore = totalMinutes > 0 ? calculateAmountScore(activities, totalMinutes) : 30

  // 3. 内容完整度得分
  const completenessScore = calculateCompletenessScore(content)

  // 4. 额外奖励得分
  const bonusScore = calculateBonusScore({
    isPublishToMoments: content.isPublishToMoments,
    streakDays,
    checkinHour
  })

  // 计算总分
  const totalScore = Math.min(100, Math.round(
    activityScore * weights.activity +
    amountScore * weights.amount +
    completenessScore * weights.completeness +
    bonusScore * weights.bonus
  ))

  // 计算总运动分钟数（优先使用用户输入的时长）
  const calculatedTotalMinutes = activities.reduce((sum, a) => sum + convertToMinutes(a), 0)
  const finalTotalMinutes = userDurationMinutes > 0 ? userDurationMinutes : calculatedTotalMinutes

  return {
    activityScore,
    amountScore,
    completenessScore,
    bonusScore,
    totalScore,
    totalMinutes: finalTotalMinutes
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 支持多种操作
  const { action = 'score', ...params } = event

  // 路由处理
  switch (action) {
    case 'setGoal':
      // 设置运动目标
      return await handleSetGoal(openid, params)

    case 'getGoal':
      // 获取运动目标
      return await handleGetGoal(openid, params)

    case 'getStats':
      // 获取统计报告
      return await handleGetStats(openid, params)

    case 'getAchievements':
      // 获取成就列表
      return await handleGetAchievements(openid, params)

    case 'checkAchievements':
      // 检查并解锁成就
      return await handleCheckAchievements(openid, params)

    case 'getGroupStats':
      // 获取群组统计
      return await handleGetGroupStats(openid, params)

    case 'getMyRank':
      // 获取我的排名
      return await handleGetMyRank(openid, params)

    case 'score':
    default:
      // 默认：执行打卡评分
      return await handleScore(openid, params, wxContext)
  }
}

/**
 * 处理打卡评分
 */
async function handleScore(openid, params, wxContext) {
  const {
    text,
    photos,
    groupId = '',
    isPublishToMoments = true,
    useLLM = true,
    duration = 0,
    durationUnit = '分钟'
  } = params

  // 将用户输入的时长转换为分钟数
  let totalMinutes = 0
  if (duration && duration > 0) {
    if (durationUnit === '小时') {
      totalMinutes = Math.round(duration * 60)
    } else {
      totalMinutes = Math.round(duration)
    }
  }

  const content = {
    text,
    photos,
    isPublishToMoments,
    categoryId: params.categoryId || '',
    subCategoryId: params.subCategoryId || ''
  }

  const checkinHour = new Date().getHours()

  // 获取用户连续打卡天数
  let streakDays = 0
  if (openid && groupId) {
    streakDays = await getUserStreakDays(openid, groupId)
  }

  // 初始化识别结果
  let textActivities = []
  let imageActivities = []
  let textSummary = ''
  let imageSummary = ''
  let isValid = false
  let analysisMethod = 'none'

  // 如果不使用 LLM，返回基于规则的评分
  if (!useLLM) {
    const userDurationMinutes = totalMinutes
    const scores = calculateScores([], content, { streakDays, checkinHour, userDurationMinutes })

    const feedback = generateFeedback({
      activities: [],
      activityScore: scores.activityScore,
      amountScore: scores.amountScore,
      completenessScore: scores.completenessScore,
      content,
      streakDays,
      totalMinutes: userDurationMinutes
    })

    return {
      success: true,
      data: {
        totalScore: scores.totalScore,
        activityScore: scores.activityScore,
        amountScore: scores.amountScore,
        completenessScore: scores.completenessScore,
        bonusScore: scores.bonusScore,
        streakDays,
        feedback,
        activities: [],
        summary: '打卡成功',
        totalMinutes: 0,
        isValid: false,
        sportTypes: [],
        analysisMethod: 'rule'
      }
    }
  }

  // 1. 解析文字内容（使用智能解析，支持本地兜底）
  if (text && text.trim().length > 0) {
    try {
      const textResult = await analyzeTextSmart(text)

      if (textResult && textResult.activities) {
        textActivities = textResult.activities
        textSummary = textResult.summary || ''
        isValid = textResult.isValid || textActivities.length > 0
        analysisMethod = textResult.analysisMethod || 'llm'
      }
    } catch (error) {
      console.error('文字解析失败:', error)
    }
  }

  // 2. 解析图片内容（使用智能解析，支持重试）
  if (photos && photos.length > 0) {
    try {
      const tempUrls = await getTempFileURL(photos)

      const imageAnalysisPromises = tempUrls.map(async (url) => {
        return await analyzeImageSmart(url)
      })

      const imageResults = await Promise.all(imageAnalysisPromises)

      for (const imageResult of imageResults) {
        if (imageResult && imageResult.activities) {
          imageActivities = imageActivities.concat(imageResult.activities)
          imageSummary += imageResult.summary || ''
          isValid = isValid || imageResult.isValid
        }
      }
    } catch (error) {
      console.error('获取图片临时链接失败:', error)
    }
  }

  // 3. 合并运动识别结果
  const allActivities = [...textActivities, ...imageActivities]
  isValid = isValid || allActivities.length > 0 || totalMinutes > 0

  const summary = [textSummary, imageSummary].filter(Boolean).join('；') || (isValid ? '已完成运动打卡' : '打卡成功')

  // 4. 计算评分（优先使用用户输入的时长，如果没有则使用AI识别的时长）
  const userDurationMinutes = totalMinutes
  const scores = calculateScores(allActivities, content, { streakDays, checkinHour, userDurationMinutes })

  // 5. 生成评语（AI对文字和图片内容的解析点评）
  const feedback = generateFeedback({
    activities: allActivities,
    activityScore: scores.activityScore,
    amountScore: scores.amountScore,
    completenessScore: scores.completenessScore,
    content,
    streakDays,
    totalMinutes: scores.totalMinutes
  })

  // 获取运动类型名称
  const sportTypes = allActivities.map(a => (SPORT_CONFIG[a.type] && SPORT_CONFIG[a.type].name) || a.type || '未知运动')

  // 检查并解锁成就
  let newAchievements = []
  if (openid && groupId) {
    const achievementResult = await checkAchievements(openid, groupId)
    newAchievements = achievementResult.new
  }

  return {
    success: true,
    data: {
      totalScore: scores.totalScore,
      activityScore: scores.activityScore,
      amountScore: scores.amountScore,
      completenessScore: scores.completenessScore,
      bonusScore: scores.bonusScore,
      streakDays,
      feedback,
      activities: allActivities,
      summary,
      totalMinutes: scores.totalMinutes,
      isValid,
      sportTypes: [...new Set(sportTypes)],
      analysisMethod,
      newAchievements  // 新解锁的成就
    }
  }
}

/**
 * 处理设置运动目标
 */
async function handleSetGoal(openid, params) {
  const { groupId = '', weeklyMinutes, weeklyDays, dailyMinutes } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  const goal = {}
  if (weeklyMinutes) goal.weeklyMinutes = weeklyMinutes
  if (weeklyDays) goal.weeklyDays = weeklyDays
  if (dailyMinutes) goal.dailyMinutes = dailyMinutes

  const result = await setUserGoal(openid, groupId, goal)

  // 获取更新后的目标进度
  const progress = await calculateGoalProgress(openid, groupId, goal)

  return {
    success: result.success,
    data: {
      goal,
      progress
    },
    error: result.error
  }
}

/**
 * 处理获取运动目标
 */
async function handleGetGoal(openid, params) {
  const { groupId = '' } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  const goal = await getUserGoal(openid, groupId)
  const progress = await calculateGoalProgress(openid, groupId, goal)

  return {
    success: true,
    data: {
      goal,
      progress
    }
  }
}

/**
 * 处理获取统计报告
 */
async function handleGetStats(openid, params) {
  const { groupId = '', period = 'week' } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  const stats = await getUserStats(openid, groupId, period)

  if (!stats) {
    return { success: false, error: '获取统计失败' }
  }

  return {
    success: true,
    data: stats
  }
}

/**
 * 处理获取成就列表
 */
async function handleGetAchievements(openid, params) {
  const { groupId = '' } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  const achievements = await getUserAchievements(openid, groupId)

  // 获取成就总览
  const allAchievementTypes = [
    ...Object.keys(ACHIEVEMENTS.streak),
    ...Object.keys(ACHIEVEMENTS.volume),
    ...Object.keys(ACHIEVEMENTS.checkin),
    ...Object.keys(ACHIEVEMENTS.perfect)
  ]

  return {
    success: true,
    data: {
      unlocked: achievements,
      total: allAchievementTypes.length,
      unlockedCount: achievements.length,
      progress: Math.round((achievements.length / allAchievementTypes.length) * 100)
    }
  }
}

/**
 * 处理检查成就
 */
async function handleCheckAchievements(openid, params) {
  const { groupId = '' } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  const result = await checkAchievements(openid, groupId)

  return {
    success: true,
    data: result
  }
}

/**
 * 将 Date 对象转为 YYYY-MM-DD 字符串
 */
function getDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 获取群组统计数据（用于排行榜和对比）
 */
async function getGroupStats(groupId, period = 'week') {
  try {
    const now = new Date()
    let startDateStr = null  // null 表示不限制起始日期（总榜）

    if (period === 'day') {
      startDateStr = getDateStr(now)
    } else if (period === 'week') {
      const weekStart = new Date(now)
      const dayOfWeek = now.getDay() || 7
      weekStart.setDate(now.getDate() - dayOfWeek + 1)
      startDateStr = getDateStr(weekStart)
    } else if (period === 'month') {
      const monthStart = new Date(now)
      monthStart.setDate(1)
      startDateStr = getDateStr(monthStart)
    }
    // period === 'all' 时，startDateStr 保持 null，不限制起始日期

    // 获取群组所有成员
    const { data: members } = await db.collection('members')
      .where({
        groupId: groupId,
        status: 'normal'
      })
      .get()

    if (!members || members.length === 0) {
      return { success: false, error: '群组成员为空' }
    }

    // 获取群组成员信息
    const userIds = members.map(m => m.userId).filter(Boolean)
    const userInfoMap = await getUsersInfoMap(userIds)

    // 构建查询条件：使用 date 字段（YYYY-MM-DD）而非 createTime，以正确包含补卡天数
    const queryCondition = {
      userId: _.in(userIds),
      groupId: groupId
    }
    if (startDateStr) {
      queryCondition.date = _.gte(startDateStr)
    }

    // 获取所有成员的打卡记录（按群组过滤）
    const { data: checkins } = await db.collection('checkins')
      .where(queryCondition)
      .get()

    // 计算每个成员的统计数据
    const userStatsMap = {}

    for (const userId of userIds) {
      userStatsMap[userId] = {
        userId,
        nickName: userInfoMap[userId]?.nickName || '未知',
        avatarUrl: userInfoMap[userId]?.avatarUrl || '',
        totalMinutes: 0,
        totalScore: 0,
        checkinDays: new Set(),
        checkinCount: 0,
        streak: 0
      }
    }

    // 统计打卡数据
    for (const checkin of checkins || []) {
      const stats = userStatsMap[checkin.userId]
      if (!stats) continue

      // score 字段是嵌套对象，需要从 checkin.score 中获取
      const checkinMinutes = (checkin.score?.totalMinutes ?? checkin.totalMinutes) || 0
      const checkinScore = (checkin.score?.totalScore ?? checkin.totalScore) || 0

      stats.totalMinutes += checkinMinutes
      stats.totalScore += checkinScore
      stats.checkinCount++

      // 使用 date 字段（补卡的实际日期），而非 createTime（补卡的提交时间）
      stats.checkinDays.add(checkin.date)
    }

    // 转换为数组并计算平均值
    const statsArray = Object.values(userStatsMap).map(stats => ({
      ...stats,
      checkinDays: stats.checkinDays.size,
      avgScore: stats.checkinCount > 0 ? Math.round(stats.totalScore / stats.checkinCount) : 0
    }))

    // 计算群组平均值
    const groupAvg = {
      totalMinutes: Math.round(statsArray.reduce((sum, s) => sum + s.totalMinutes, 0) / statsArray.length),
      checkinDays: Math.round(statsArray.reduce((sum, s) => sum + s.checkinDays, 0) / statsArray.length * 10) / 10,
      avgScore: Math.round(statsArray.reduce((sum, s) => sum + s.avgScore, 0) / statsArray.length)
    }

    // 排序（按多个维度）
    const sortedByMinutes = [...statsArray].sort((a, b) => b.totalMinutes - a.totalMinutes)
    const sortedByDays = [...statsArray].sort((a, b) => b.checkinDays - a.checkinDays)
    const sortedByScore = [...statsArray].sort((a, b) => b.avgScore - a.avgScore)

    // 为每个用户添加排名
    const addRank = (list) => list.map((item, index) => ({
      ...item,
      rank: index + 1
    }))

    return {
      success: true,
      data: {
        period,
        memberCount: members.length,
        groupAvg,
        leaderboard: {
          byMinutes: addRank(sortedByMinutes),
          byDays: addRank(sortedByDays),
          byScore: addRank(sortedByScore)
        }
      }
    }
  } catch (error) {
    console.error('获取群组统计失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 批量获取用户信息
 */
async function getUsersInfoMap(userIds) {
  if (!userIds || userIds.length === 0) return {}

  try {
    const { data: users } = await db.collection('users')
      .where({
        openid: _.in(userIds)
      })
      .get()

    const map = {}
    for (const user of users || []) {
      map[user.openid] = user
    }
    return map
  } catch (error) {
    console.error('获取用户信息失败:', error)
    return {}
  }
}

/**
 * 获取群组排名（我的排名）
 */
async function getMyGroupRank(openid, groupId, period = 'week') {
  try {
    const result = await getGroupStats(groupId, period)

    if (!result.success) {
      return result
    }

    const { leaderboard, groupAvg } = result.data

    // 找到我的各项排名
    const myRank = {
      minutes: leaderboard.byMinutes.find(u => u.userId === openid),
      days: leaderboard.byDays.find(u => u.userId === openid),
      score: leaderboard.byScore.find(u => u.userId === openid)
    }

    // 计算超越比例
    const calcPercentile = (myItem, list) => {
      if (!myItem) return 0
      const total = list.length
      const below = list.filter(u => u.rank > myItem.rank).length
      return Math.round((below / total) * 100)
    }

    const percentiles = {
      minutes: calcPercentile(myRank.minutes, leaderboard.byMinutes),
      days: calcPercentile(myRank.days, leaderboard.byDays),
      score: calcPercentile(myRank.score, leaderboard.byScore)
    }

    return {
      success: true,
      data: {
        period,
        myRank,
        groupAvg,
        percentiles,
        totalMembers: leaderboard.byMinutes.length
      }
    }
  } catch (error) {
    console.error('获取我的排名失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 处理获取群组统计
 */
async function handleGetGroupStats(openid, params) {
  const { groupId = '', period = 'week' } = params

  if (!groupId) {
    return { success: false, error: '缺少群组ID' }
  }

  return await getGroupStats(groupId, period)
}

/**
 * 处理获取我的排名
 */
async function handleGetMyRank(openid, params) {
  const { groupId = '', period = 'week' } = params

  if (!openid) {
    return { success: false, error: '未获取到用户信息' }
  }

  if (!groupId) {
    return { success: false, error: '缺少群组ID' }
  }

  return await getMyGroupRank(openid, groupId, period)
}
