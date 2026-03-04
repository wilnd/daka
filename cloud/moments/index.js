const cloud = require('wx-server-sdk')
cloud.init()

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const currentUserId = wxContext.OPENID  // 当前登录用户，用于点赞、评论等操作
  // 从 event 中解构 userId（这是传入的目标用户，用于获取指定用户的朋友圈等）
  const { action, groupId, momentId, limit = 20, lastId, content, userId: targetUserId } = event

  const pickUserInfo = (u) => {
    if (!u) return undefined
    return {
      _id: u._id,
      nickName: u.nickName,
      avatarUrl: u.avatarUrl
    }
  }

  // 兼容老数据：users 可能只有系统字段 _openid，没有自定义 openid
  const getUsersByIds = async (ids) => {
    const list = [...new Set((ids || []).filter(Boolean))]
    const map = new Map()
    if (list.length === 0) return map

    const users = []
    try {
      const res1 = await db.collection('users')
        .where({ openid: _.in(list) })
        .get()
      users.push(...(res1.data || []))
    } catch (e) {
      // ignore
    }
    try {
      const res2 = await db.collection('users')
        .where({ _openid: _.in(list) })
        .get()
      users.push(...(res2.data || []))
    } catch (e) {
      // ignore
    }

    for (const u of users) {
      const key = u.openid || u._openid
      if (!key) continue
      // 如果同一个 key 出现两份，优先选择带 openid 的那份
      if (!map.has(key) || (u.openid && !map.get(key)?.openid)) {
        map.set(key, u)
      }
    }
    return map
  }

  try {
    switch (action) {
      case 'getMoments': {
        // 获取用户在某个群组的朋友圈列表（带发布者信息）
        let query = db.collection('moments')
          .where({ groupId })
          .orderBy('createTime', 'desc')
          .limit(limit)

        if (lastId) {
          try {
            const lastMoment = await db.collection('moments').doc(lastId).get()
            if (lastMoment.data) {
              query = db.collection('moments')
                .where({
                  groupId,
                  createTime: _.lt(lastMoment.data.createTime)
                })
                .orderBy('createTime', 'desc')
                .limit(limit)
            }
          } catch (e) {
            // lastId 不存在：按第一页逻辑返回即可
          }
        }

        const { data: moments } = await query.get()
        if (moments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取群组信息
        const { data: group } = await db.collection('groups').doc(groupId).get()
        const groupName = group?.name || ''

        // 获取当前用户对每条朋友圈的点赞状态
        const { data: likes } = await db.collection('momentLikes')
          .where({ 
            momentId: _.in(moments.map(m => m._id)),
            userId: currentUserId
          })
          .get()

        const likedSet = new Set(likes.map(l => l.momentId))

        // 获取每条朋友圈的评论
        const { data: allComments } = await db.collection('momentComments')
          .where({ 
            momentId: _.in(moments.map(m => m._id))
          })
          .get()

        // 获取发布者/评论者信息（兼容 openid 与 _openid）
        const momentUserIds = [...new Set(moments.map(m => m.userId))]
        const commentUserIds = [...new Set(allComments.map(c => c.userId))]
        const userMap = await getUsersByIds([...momentUserIds, ...commentUserIds])

        const result = moments.map(moment => {
          const userInfo = userMap.get(moment.userId)
          const momentComments = allComments
            .filter(c => c.momentId === moment._id)
            .map(c => ({
              ...c,
              userInfo: pickUserInfo(userMap.get(c.userId))
            }))

          return {
            ...moment,
            groupName,
            userInfo: pickUserInfo(userInfo),
            isLiked: likedSet.has(moment._id),
            comments: momentComments
          }
        })

        return { success: true, data: result }
      }

      case 'like': {
        // 点赞朋友圈
        const { data: existing } = await db.collection('momentLikes')
          .where({ momentId, userId: currentUserId })
          .get()

        if (existing.length > 0) {
          return { success: false, msg: '已点赞' }
        }

        await db.collection('momentLikes').add({
          data: { momentId, userId: currentUserId, createTime: db.serverDate() }
        })

        // 更新点赞数
        try {
          await db.collection('moments').doc(momentId).update({
            data: { likeCount: _.inc(1) }
          })
        } catch (e) {
          // 动态不存在或计数字段异常时忽略（点赞记录已写入）
        }

        return { success: true }
      }

      case 'unlike': {
        // 取消点赞
        const { data: existing } = await db.collection('momentLikes')
          .where({ momentId, userId: currentUserId })
          .get()

        if (existing.length === 0) {
          return { success: false, msg: '未点赞' }
        }

        await db.collection('momentLikes').doc(existing[0]._id).remove()

        // 更新点赞数
        try {
          await db.collection('moments').doc(momentId).update({
            data: { likeCount: _.inc(-1) }
          })
        } catch (e) {
          // ignore
        }

        return { success: true }
      }

      case 'comment': {
        // 评论朋友圈
        if (!momentId) {
          return { success: false, msg: '参数错误：缺少momentId' }
        }
        if (!content || content.trim().length === 0) {
          return { success: false, msg: '评论内容不能为空' }
        }

        if (content.length > 200) {
          return { success: false, msg: '评论内容不能超过200字' }
        }

        // 先校验动态是否存在，避免写入评论后更新计数时报错
        let momentExists = true
        try {
          const { data: moment } = await db.collection('moments').doc(momentId).get()
          if (!moment) momentExists = false
        } catch (e) {
          momentExists = false
        }
        if (!momentExists) {
          return { success: false, msg: '动态不存在或已删除' }
        }

        const { _id } = await db.collection('momentComments').add({
          data: {
            momentId,
            userId: currentUserId,
            content: content.trim(),
            createTime: db.serverDate()
          }
        })

        // 更新评论数
        await db.collection('moments').doc(momentId).update({
          data: { commentCount: _.inc(1) }
        })
        .catch(async () => {
          // 兼容历史数据：commentCount 可能是 null/非数字，inc 会失败
          await db.collection('moments').doc(momentId).update({
            data: { commentCount: 1 }
          })
        })

        // 获取评论者信息
        const commentUserMap = await getUsersByIds([currentUserId])
        const commentUser = commentUserMap.get(currentUserId)

        return {
          success: true,
          data: {
            _id,
            momentId,
            userId: currentUserId,
            content: content.trim(),
            userInfo: pickUserInfo(commentUser)
          }
        }
      }

      case 'deleteComment': {
        // 删除评论
        const commentId = event.commentId || momentId
        if (!commentId) return { success: false, msg: '参数错误：缺少commentId' }
        let commentRes
        try {
          commentRes = await db.collection('momentComments').doc(commentId).get()
        } catch (e) {
          return { success: false, msg: '评论不存在' }
        }
        const comment = commentRes.data

        if (!comment) {
          return { success: false, msg: '评论不存在' }
        }

        if (comment.userId !== currentUserId) {
          return { success: false, msg: '只能删除自己的评论' }
        }

        await db.collection('momentComments').doc(commentId).remove()

        // 更新评论数
        try {
          await db.collection('moments').doc(comment.momentId).update({
            data: { commentCount: _.inc(-1) }
          })
        } catch (e) {
          // ignore
        }

        return { success: true }
      }

      case 'getComments': {
        // 获取朋友圈的评论列表
        const { data: comments } = await db.collection('momentComments')
          .where({ momentId })
          .orderBy('createTime', 'asc')
          .get()

        if (comments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取评论者信息
        const userIds = [...new Set(comments.map(c => c.userId))]
        const userMap = await getUsersByIds(userIds)

        const result = comments.map(c => ({
          ...c,
          userInfo: pickUserInfo(userMap.get(c.userId))
        }))

        return { success: true, data: result }
      }

      case 'getAllMoments': {
        // 获取用户在所有群组的朋友圈列表（首页展示）
        const { data: members } = await db.collection('members')
          .where({ userId: currentUserId, status: 'normal' })
          .get()

        if (members.length === 0) {
          return { success: true, data: [] }
        }

        const groupIds = members.map(m => m.groupId)

        let query = db.collection('moments')
          .where({ groupId: _.in(groupIds) })
          .orderBy('createTime', 'desc')
          .limit(limit)

        if (lastId) {
          try {
            const lastMoment = await db.collection('moments').doc(lastId).get()
            if (lastMoment.data) {
              query = db.collection('moments')
                .where({
                  groupId: _.in(groupIds),
                  createTime: _.lt(lastMoment.data.createTime)
                })
                .orderBy('createTime', 'desc')
                .limit(limit)
            }
          } catch (e) {
            // lastId 不存在：按第一页逻辑返回即可
          }
        }

        const { data: moments } = await query.get()
        if (moments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取发布者信息
        const userIds = [...new Set(moments.map(m => m.userId))]
        const userMap = await getUsersByIds(userIds)

        // 获取群组信息
        const { data: groups } = await db.collection('groups')
          .where({ _id: _.in(groupIds) })
          .get()

        const groupMap = new Map()
        for (const group of groups) {
          groupMap.set(group._id, group)
        }

        // 获取当前用户对每条朋友圈的点赞状态
        const { data: likes } = await db.collection('momentLikes')
          .where({ 
            momentId: _.in(moments.map(m => m._id)),
            userId: currentUserId
          })
          .get()

        const likedSet = new Set(likes.map(l => l.momentId))

        const result = moments.map(moment => {
          const userInfo = userMap.get(moment.userId)
          const groupInfo = groupMap.get(moment.groupId)

          return {
            ...moment,
            groupName: groupInfo?.name || '',
            userInfo: pickUserInfo(userInfo),
            isLiked: likedSet.has(moment._id)
          }
        })

        return { success: true, data: result }
      }

      case 'getUserInfo': {
        // 获取指定用户的信息
        if (!targetUserId) {
          return { success: false, msg: '参数错误：缺少userId' }
        }

        const userMap = await getUsersByIds([targetUserId])
        const user = userMap.get(targetUserId)

        if (!user) {
          return { success: false, msg: '用户不存在' }
        }

        return { success: true, data: pickUserInfo(user) }
      }

      case 'getUserMoments': {
        // 获取指定用户的朋友圈列表（不限制群组）
        if (!targetUserId) {
          return { success: false, msg: '参数错误：缺少userId' }
        }

        // 获取用户所属的所有群组
        const { data: members } = await db.collection('members')
          .where({ userId: targetUserId, status: 'normal' })
          .get()

        let groupIds = members.map(m => m.groupId)
        // 如果用户不属于任何群组，尝试从 moments 表直接查询
        if (groupIds.length === 0) {
          const { data: userMoments } = await db.collection('moments')
            .where({ userId: targetUserId })
            .get()
          groupIds = [...new Set(userMoments.map(m => m.groupId))]
        }

        let query = db.collection('moments')
          .where({ 
            userId: targetUserId,
            ...(groupIds.length > 0 ? { groupId: _.in(groupIds) } : {})
          })
          .orderBy('createTime', 'desc')
          .limit(limit)

        if (lastId) {
          try {
            const lastMoment = await db.collection('moments').doc(lastId).get()
            if (lastMoment.data) {
              query = db.collection('moments')
                .where({
                  userId: targetUserId,
                  ...(groupIds.length > 0 ? { groupId: _.in(groupIds) } : {}),
                  createTime: _.lt(lastMoment.data.createTime)
                })
                .orderBy('createTime', 'desc')
                .limit(limit)
            }
          } catch (e) {
            // lastId 不存在：按第一页逻辑返回即可
          }
        }

        const { data: moments } = await query.get()
        if (moments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取当前用户对每条朋友圈的点赞状态
        const { data: likes } = await db.collection('momentLikes')
          .where({ 
            momentId: _.in(moments.map(m => m._id)),
            userId: currentUserId
          })
          .get()

        const likedSet = new Set(likes.map(l => l.momentId))

        // 获取每条朋友圈的评论
        const { data: allComments } = await db.collection('momentComments')
          .where({ 
            momentId: _.in(moments.map(m => m._id))
          })
          .get()

        // 获取评论者信息
        const commentUserIds = [...new Set(allComments.map(c => c.userId))]
        const commentUserMap = await getUsersByIds(commentUserIds)

        // 获取群组信息
        const { data: groups } = await db.collection('groups')
          .where({ _id: _.in(groupIds) })
          .get()

        const groupMap = new Map()
        for (const group of groups) {
          groupMap.set(group._id, group)
        }

        // 获取用户信息（发布者）
        const userMap = await getUsersByIds([targetUserId])
        const userInfo = userMap.get(targetUserId)

        const result = moments.map(moment => {
          const momentComments = allComments
            .filter(c => c.momentId === moment._id)
            .map(c => ({
              ...c,
              userInfo: pickUserInfo(commentUserMap.get(c.userId))
            }))

          return {
            ...moment,
            groupName: groupMap.get(moment.groupId)?.name || '',
            userInfo: pickUserInfo(userInfo),
            isLiked: likedSet.has(moment._id),
            comments: momentComments
          }
        })

        return { success: true, data: result }
      }

      default:
        return { success: false, msg: '未知操作' }
    }
  } catch (error) {
    console.error('moments cloud function error:', error)
    return { success: false, msg: error.message }
  }
}
