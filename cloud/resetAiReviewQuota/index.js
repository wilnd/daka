/**
 * 云函数：每月 1 号 0 点重置小勤点评次数
 * 定时触发器：0 0 0 1 * * *（每月第一天 00:00:00 执行）
 * 将 users 表中所有用户的 aiReviewUsedThisMonth 置为 0，aiReviewQuotaMonth 置为当月 YYYY-MM
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/** 当前月 YYYY-MM */
function getCurrentMonthStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

exports.main = async (event, context) => {
  if (event.triggerType !== 'timer') {
    return { success: false, error: '仅支持定时触发' }
  }

  const monthStr = getCurrentMonthStr()
  const batchSize = 100
  let skip = 0
  let totalUpdated = 0

  try {
    while (true) {
      const { data: users } = await db.collection('users').skip(skip).limit(batchSize).get()
      if (!users || users.length === 0) break

      await Promise.all(
        users.map((u) =>
          db.collection('users').doc(u._id).update({
            data: {
              aiReviewUsedThisMonth: 0,
              aiReviewQuotaMonth: monthStr
            }
          })
        )
      )
      totalUpdated += users.length
      skip += users.length
      if (users.length < batchSize) break
    }

    console.log(`[resetAiReviewQuota] 本月 ${monthStr} 已重置 ${totalUpdated} 名用户的小勤点评次数`)
    return { success: true, month: monthStr, totalUpdated }
  } catch (e) {
    console.error('[resetAiReviewQuota] 执行失败', e)
    return { success: false, error: e.message }
  }
}
