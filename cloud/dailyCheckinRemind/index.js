// 云函数：每日打卡提醒定时触发器
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 订阅消息模板ID
const TEMPLATE_ID = process.env.SUBSCRIBE_TEMPLATE_ID || 'Onu-1essigRNJuZ8K0a_WdBq7qR5ktHKxST6F0fCDuQ'

// 所有可选提醒时间段（每30分钟一个）
const REMIND_TIME_SLOTS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30'
]

exports.main = async (event, context) => {
  // 只有定时触发器调用时才执行
  if (event.triggerType !== 'timer') {
    return { success: false, error: '仅支持定时触发' }
  }

  const now = new Date()
  const currentHour = String(now.getHours()).padStart(2, '0')
  const currentMinute = String(now.getMinutes()).padStart(2, '0')
  const currentTime = `${currentHour}:${currentMinute}`

  // 将当前时间对齐到30分钟区间（如 21:05 -> 21:00, 21:35 -> 21:30）
  const currentSlot = getTimeSlot(currentTime)

  console.log(`开始每日打卡提醒任务... 当前时间: ${currentTime}, 时间段: ${currentSlot}`)

  // 获取今天的日期
  const today = getTodayStr()

  try {
    // 获取所有开启了订阅提醒的用户
    const { data: users } = await db.collection('users').where({
      subscribeRemindEnabled: true
    }).get()

    if (users.length === 0) {
      console.log('没有开启订阅提醒的用户')
      return { success: true, message: '没有需要提醒的用户' }
    }

    console.log(`找到 ${users.length} 个开启订阅提醒的用户`)

    let successCount = 0
    let failCount = 0
    let skipCount = 0

    // 对每个用户发送提醒
    for (const user of users) {
      try {
        // 获取用户的提醒时间设置
        const userRemindTime = user.remindTime || '21:00'

        // 将用户提醒时间对齐到30分钟区间
        const userSlot = getTimeSlot(userRemindTime)

        // 检查当前时间段是否匹配用户的提醒时间段
        if (currentSlot !== userSlot) {
          console.log(`用户 ${user.openid} 提醒时间段未到 (${userRemindTime} -> ${userSlot})，当前 ${currentSlot}，跳过`)
          continue
        }

        // 检查是否已经发送过提醒（避免重复发送）
        const { data: existingReminds } = await db.collection('dailyReminds').where({
          openid: user.openid,
          date: today
        }).get()

        if (existingReminds.length > 0) {
          console.log(`用户 ${user.openid} 今日已发送过提醒，跳过`)
          continue
        }

        // 检查用户今日是否已打卡
        const { data: checkins } = await db.collection('checkins').where({
          openid: user.openid,
          date: today
        }).get()

        if (checkins.length > 0) {
          console.log(`用户 ${user.openid} 今日已打卡，跳过提醒`)
          // 记录已发送
          await db.collection('dailyReminds').add({
            data: {
              openid: user.openid,
              date: today,
              sent: false,
              reason: 'already_checked_in',
              createTime: new Date()
            }
          })
          skipCount++
          continue
        }

        // 获取用户所在的组织
        const { data: members } = await db.collection('members').where({
          openid: user.openid,
          status: 'normal'
        }).get()

        let groupName = '运动打卡'
        if (members.length > 0) {
          const { data: groups } = await db.collection('groups').where({
            _id: members[0].groupId
          }).get()
          if (groups.length > 0) {
            groupName = groups[0].name
          }
        }

        // 调用发送订阅消息云函数
        const result = await cloud.callFunction({
          name: 'sendSubscribeMessage',
          data: {
            templateId: TEMPLATE_ID,
            tip: `${groupName}提醒`,
            reminder: '今日还没打卡哦，快来记录你的运动吧！',
            reminderName: '打卡助手'
          }
        })

        // 记录发送结果
        await db.collection('dailyReminds').add({
          data: {
            openid: user.openid,
            date: today,
            sent: (result.result && result.result.success) || false,
            createTime: new Date()
          }
        })

        if (result.result && result.result.success) {
          successCount++
          console.log(`用户 ${user.openid} 提醒发送成功`)
        } else {
          failCount++
          console.log(`用户 ${user.openid} 提醒发送失败:`, (result.result && result.result.error))
        }

      } catch (e) {
        failCount++
        console.error(`处理用户 ${user.openid} 时出错:`, e)
      }
    }

    console.log(`每日打卡提醒任务完成: 成功 ${successCount}, 失败 ${failCount}, 跳过 ${skipCount}`)

    return {
      success: true,
      successCount,
      failCount,
      skipCount,
      currentTime
    }

  } catch (e) {
    console.error('每日打卡提醒任务出错:', e)
    return {
      success: false,
      error: e.message || '任务执行失败'
    }
  }
}

// 获取今日日期 YYYY-MM-DD
function getTodayStr() {
  const d = new Date()
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 将时间对齐到30分钟区间（如 21:05 -> 21:00, 21:35 -> 21:30）
function getTimeSlot(timeStr) {
  const [hour, minute] = timeStr.split(':').map(Number)
  // 将分钟数向下取整到最近的30分钟
  const alignedMinute = minute < 30 ? '00' : '30'
  return `${String(hour).padStart(2, '0')}:${alignedMinute}`
}
