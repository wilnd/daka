// 云函数：返回服务器当前时间（用于补卡等需要防篡改月份的场景）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const currentMonth = `${y}-${m < 10 ? '0' + m : m}`
  return { currentMonth }
}
