// 云函数：获取服务器时间
exports.main = async (event, context) => {
  const serverTime = new Date()
  return {
    serverTime: serverTime.toISOString(),
    timestamp: serverTime.getTime(),
    currentMonth: `${serverTime.getFullYear()}-${String(serverTime.getMonth() + 1).padStart(2, '0')}`,
  }
}
