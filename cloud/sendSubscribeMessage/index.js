// 云函数：发送订阅消息
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 参数验证
  if (!event.templateId) {
    return { success: false, error: '缺少模板ID' }
  }

  // 构建消息内容 - 匹配模板字段
  const data = {
    thing2: { value: event.tip || '该打卡啦！坚持就是胜利～' },
    thing3: { value: event.reminder || '今日还没打卡哦，快来记录你的运动吧！' },
    name1: { value: event.reminderName || '打卡助手' }
  }

  try {
    // 发送订阅消息
    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: event.templateId,
      page: event.page || 'pages/index/index',
      data: data,
      miniprogramState: event.miniprogramState || 'formal' // formal:正式版 developer:开发版 trial:体验版
    })

    return {
      success: true,
      result: result
    }
  } catch (err) {
    console.error('send subscribe message error:', err)
    return {
      success: false,
      error: err.message || '发送失败'
    }
  }
}
