// 云函数：用户分销体系 - 邀请码、绑定邀请人、邀请树、奖励
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 邀请码字符集（去掉易混淆 0O1I） */
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_CODE_LEN = 6

/** 奖励配置：一级邀请每人数得积分，二级邀请每人数得积分 */
const REWARD_DIRECT_POINTS = 10
const REWARD_SECOND_POINTS = 3

/** 邀请用户连续打卡里程碑奖励：7 天 / 27 天 */
const STREAK_MILESTONES = [7, 27]
const REWARD_DIRECT_STREAK_7 = 10
const REWARD_SECOND_STREAK_7 = 3
const REWARD_DIRECT_STREAK_27 = 10
const REWARD_SECOND_STREAK_27 = 3

/** 仅新用户可绑定为下级：账号创建时间超过此分钟数视为「已注册用户」，不再绑定 */
const NEW_USER_BIND_WINDOW_MINUTES = 15

/** 生成唯一邀请码 */
async function generateInviteCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    let code = ''
    for (let i = 0; i < INVITE_CODE_LEN; i++) {
      code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)]
    }
    const res = await db.collection('users').where({ inviteCode: code }).count()
    const totalVal = res && (typeof res.total === 'number' ? res.total : (res.data && res.data.total))
    const total = (totalVal !== undefined && totalVal !== null) ? totalVal : 0
    if (total === 0) return code
  }
  return Date.now().toString(36).toUpperCase().slice(-INVITE_CODE_LEN)
}

/**
 * 确保当前用户有邀请码，没有则生成并写入
 */
async function ensureInviteCode(openid) {
  const { data: users } = await db.collection('users').where({ _openid: openid }).get()
  if (!users || users.length === 0) return { success: false, errMsg: '用户不存在' }
  const user = users[0]
  if (user.inviteCode) return { success: true, inviteCode: user.inviteCode }
  const inviteCode = await generateInviteCode()
  await db.collection('users').doc(user._id).update({
    data: { inviteCode, updateTime: new Date() }
  })
  return { success: true, inviteCode }
}

/**
 * 解析用户 createTime（支持云数据库 Date 或 ISO 字符串）
 */
function getCreateTimeMs(createTime) {
  if (!createTime) return null
  if (createTime instanceof Date) return createTime.getTime()
  if (typeof createTime === 'number') return createTime
  if (createTime.$date) return new Date(createTime.$date).getTime()
  return new Date(createTime).getTime()
}

/**
 * 绑定邀请人：仅当当前用户为新用户且尚未绑定、邀请码有效时执行，并发放一级/二级奖励。
 * 若用户之前已登录过（账号创建超过 NEW_USER_BIND_WINDOW_MINUTES），不绑定、不算为下级。
 */
async function bindInvite(openid, inviteCode) {
  if (!inviteCode || typeof inviteCode !== 'string') return { success: false, errMsg: '邀请码无效' }
  const code = String(inviteCode).trim().toUpperCase()
  if (!code) return { success: false, errMsg: '邀请码无效' }

  const { data: meList } = await db.collection('users').where({ _openid: openid }).get()
  if (!meList || meList.length === 0) return { success: false, errMsg: '用户不存在' }
  const me = meList[0]
  if (me.inviterOpenid) return { success: true, alreadyBound: true }

  // 仅新用户可绑定为下级：之前已登录过的用户（账号创建超过窗口时间）不再绑定
  const createdMs = getCreateTimeMs(me.createTime)
  if (createdMs != null) {
    const ageMinutes = (Date.now() - createdMs) / (60 * 1000)
    if (ageMinutes > NEW_USER_BIND_WINDOW_MINUTES) {
      return { success: false, errMsg: '仅新用户可通过邀请码绑定', alreadyRegistered: true }
    }
  }

  const { data: inviterList } = await db.collection('users').where({ inviteCode: code }).get()
  if (!inviterList || inviterList.length === 0) return { success: false, errMsg: '邀请码不存在' }
  const inviter = inviterList[0]
  const inviterOpenid = inviter._openid || inviter.openid
  if (inviterOpenid === openid) return { success: false, errMsg: '不能绑定自己' }

  const now = new Date()
  await db.collection('users').doc(me._id).update({
    data: { inviterOpenid, inviteTime: now, updateTime: now }
  })

  // 一级奖励：给邀请人加积分并记日志
  const inviterPoints = (inviter.referralPoints || 0) + REWARD_DIRECT_POINTS
  await db.collection('users').doc(inviter._id).update({
    data: { referralPoints: inviterPoints, updateTime: now }
  })
  await db.collection('referralRewardLog').add({
    data: {
      receiverOpenid: inviterOpenid,
      type: 'direct',
      inviteeOpenid: openid,
      points: REWARD_DIRECT_POINTS,
      createTime: now
    }
  })

  // 二级奖励：若邀请人也有上级，给上级加积分
  const inviterInviterOpenid = inviter.inviterOpenid
  if (inviterInviterOpenid) {
    const { data: inviterInviterList } = await db.collection('users').where({ _openid: inviterInviterOpenid }).get()
    if (inviterInviterList && inviterInviterList.length > 0) {
      const inviterInviter = inviterInviterList[0]
      const secondPoints = (inviterInviter.referralPoints || 0) + REWARD_SECOND_POINTS
      await db.collection('users').doc(inviterInviter._id).update({
        data: { referralPoints: secondPoints, updateTime: now }
      })
      await db.collection('referralRewardLog').add({
        data: {
          receiverOpenid: inviterInviterOpenid,
          type: 'second',
          inviteeOpenid: openid,
          points: REWARD_SECOND_POINTS,
          createTime: now
        }
      })
    }
  }

  // 确保新用户也有邀请码
  await ensureInviteCode(openid)
  return { success: true, alreadyBound: false }
}

/**
 * 获取我的邀请树：一级直接邀请列表、二级（下级邀请的人）列表
 */
async function getReferralTree(openid) {
  const direct = await db.collection('users')
    .where({ inviterOpenid: openid })
    .field({ _openid: true, nickName: true, avatarUrl: true, inviteTime: true })
    .orderBy('inviteTime', 'desc')
    .get()

  const directList = direct.data || []
  const directOpenids = directList.map(u => u._openid || u.openid).filter(Boolean)
  let secondList = []
  if (directOpenids.length > 0) {
    const second = await db.collection('users')
      .where({ inviterOpenid: _.in(directOpenids) })
      .field({ _openid: true, nickName: true, avatarUrl: true, inviteTime: true, inviterOpenid: true })
      .orderBy('inviteTime', 'desc')
      .get()
    secondList = second.data || []
  }

  return {
    success: true,
    directInvites: directList,
    secondLevelInvites: secondList
  }
}

/**
 * 邀请用户连续打卡 7 天 / 27 天时给邀请人发放里程碑奖励（一级 +10/二级 +3，各仅发一次）
 * 由客户端在 syncCheckinStats 返回 streak 为 7 或 27 时调用，传入刚打卡用户的 openid 与当前连胜天数
 */
async function awardStreakMilestone(inviteeOpenid, streak) {
  if (!inviteeOpenid || !STREAK_MILESTONES.includes(streak)) {
    return { success: false, errMsg: '参数无效' }
  }
  const logTypeDirect = `direct_streak_${streak}`
  const logTypeSecond = `second_streak_${streak}`
  const { total: alreadyAwarded } = await db.collection('referralRewardLog')
    .where({ inviteeOpenid, type: logTypeDirect })
    .count()
  if (alreadyAwarded > 0) {
    return { success: true, alreadyAwarded: true }
  }

  const { data: inviteeList } = await db.collection('users').where({ _openid: inviteeOpenid }).get()
  const invitee = inviteeList && inviteeList[0] ? inviteeList[0] : null
  if (!invitee || !invitee.inviterOpenid) {
    return { success: true, noInviter: true }
  }

  const pointsDirect = streak === 7 ? REWARD_DIRECT_STREAK_7 : REWARD_DIRECT_STREAK_27
  const pointsSecond = streak === 7 ? REWARD_SECOND_STREAK_7 : REWARD_SECOND_STREAK_27
  const now = new Date()

  const inviterOpenid = invitee.inviterOpenid
  const { data: inviterList } = await db.collection('users').where({ _openid: inviterOpenid }).get()
  const inviter = inviterList && inviterList[0] ? inviterList[0] : null
  if (inviter) {
    const inviterPoints = (inviter.referralPoints || 0) + pointsDirect
    await db.collection('users').doc(inviter._id).update({
      data: { referralPoints: inviterPoints, updateTime: now }
    })
    await db.collection('referralRewardLog').add({
      data: {
        receiverOpenid: inviterOpenid,
        type: logTypeDirect,
        inviteeOpenid,
        points: pointsDirect,
        createTime: now
      }
    })
  }

  const inviterInviterOpenid = inviter && inviter.inviterOpenid ? inviter.inviterOpenid : null
  if (inviterInviterOpenid) {
    const { data: inviterInviterList } = await db.collection('users').where({ _openid: inviterInviterOpenid }).get()
    const inviterInviter = inviterInviterList && inviterInviterList[0] ? inviterInviterList[0] : null
    if (inviterInviter) {
      const secondPoints = (inviterInviter.referralPoints || 0) + pointsSecond
      await db.collection('users').doc(inviterInviter._id).update({
        data: { referralPoints: secondPoints, updateTime: now }
      })
      await db.collection('referralRewardLog').add({
        data: {
          receiverOpenid: inviterInviterOpenid,
          type: logTypeSecond,
          inviteeOpenid,
          points: pointsSecond,
          createTime: now
        }
      })
    }
  }

  return { success: true, awarded: true, streak, pointsDirect, pointsSecond }
}

/**
 * 获取我的邀请统计与奖励汇总
 */
async function getReferralStats(openid) {
  const { data: users } = await db.collection('users').where({ _openid: openid }).get()
  const user = users && users[0] ? users[0] : null
  const referralPoints = user && (user.referralPoints != null) ? user.referralPoints : 0

  const directCount = await db.collection('users').where({ inviterOpenid: openid }).count()
  const directIds = (await db.collection('users').where({ inviterOpenid: openid }).field({ _openid: true }).get()).data || []
  const directOpenids = directIds.map(u => u._openid || u.openid).filter(Boolean)
  let secondCount = 0
  if (directOpenids.length > 0) {
    const r = await db.collection('users').where({ inviterOpenid: _.in(directOpenids) }).count()
    secondCount = r.total || 0
  }

  const streakDesc = `；邀请用户连续打卡 7 天再得 ${REWARD_DIRECT_STREAK_7} 积分（二级 ${REWARD_SECOND_STREAK_7}），连续 27 天再得 ${REWARD_DIRECT_STREAK_27} 积分（二级 ${REWARD_SECOND_STREAK_27}）`

  return {
    success: true,
    directCount: directCount.total || 0,
    secondCount,
    referralPoints,
    rewardRules: {
      directPoints: REWARD_DIRECT_POINTS,
      secondPoints: REWARD_SECOND_POINTS,
      desc: `一级邀请每人 +${REWARD_DIRECT_POINTS} 积分，二级邀请每人 +${REWARD_SECOND_POINTS} 积分${streakDesc}`
    }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) return { success: false, errMsg: '未登录' }

  const action = event.action
  if (action === 'ensureInviteCode') {
    return await ensureInviteCode(openid)
  }
  if (action === 'bindInvite') {
    return await bindInvite(openid, event.inviteCode)
  }
  if (action === 'getReferralTree') {
    return await getReferralTree(openid)
  }
  if (action === 'getReferralStats') {
    return await getReferralStats(openid)
  }
  if (action === 'awardStreakMilestone') {
    const inviteeOpenid = event.inviteeOpenid || openid
    const streak = event.streak
    return await awardStreakMilestone(inviteeOpenid, streak)
  }
  return { success: false, errMsg: '未知 action' }
}
