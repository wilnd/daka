const cloud = require('wx-server-sdk')
cloud.init()

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const userId = wxContext.OPENID
  const { action, groupId, momentId, limit = 20, lastId, content } = event

  try {
    switch (action) {
      case 'getMoments': {
        // 获取用户在某个群组的朋友圈列表（带发布者信息）
        let query = db.collection('moments')
          .where({ groupId })
          .orderBy('createTime', 'desc')
          .limit(limit)

        if (lastId) {
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
        }

        const { data: moments } = await query.get()
        if (moments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取发布者信息
        const userIds = [...new Set(moments.map(m => m.userId))]
        const { data: users } = await db.collection('users')
          .where({ _id: _.in(userIds) })
          .get()

        const userMap = new Map()
        for (const user of users) {
          userMap.set(user._id, user)
        }

        // 获取群组信息
        const { data: group } = await db.collection('groups').doc(groupId).get()
        const groupName = group?.name || ''

        // 获取当前用户对每条朋友圈的点赞状态
        const { data: likes } = await db.collection('momentLikes')
          .where({ 
            momentId: _.in(moments.map(m => m._id)),
            userId 
          })
          .get()

        const likedSet = new Set(likes.map(l => l.momentId))

        // 获取每条朋友圈的评论
        const { data: allComments } = await db.collection('momentComments')
          .where({ 
            momentId: _.in(moments.map(m => m._id))
          })
          .get()

        const commentUserIds = [...new Set(allComments.map(c => c.userId))]
        const { data: commentUsers } = await db.collection('users')
          .where({ _id: _.in(commentUserIds) })
          .get()

        const commentUserMap = new Map()
        for (const user of commentUsers) {
          commentUserMap.set(user._id, user)
        }

        const result = moments.map(moment => {
          const userInfo = userMap.get(moment.userId)
          const momentComments = allComments
            .filter(c => c.momentId === moment._id)
            .map(c => ({
              ...c,
              userInfo: commentUserMap.get(c.userId)
            }))

          return {
            ...moment,
            groupName,
            userInfo: userInfo ? {
              _id: userInfo._id,
              nickName: userInfo.nickName,
              avatarUrl: userInfo.avatarUrl
            } : undefined,
            isLiked: likedSet.has(moment._id),
            comments: momentComments
          }
        })

        return { success: true, data: result }
      }

      case 'like': {
        // 点赞朋友圈
        const { data: existing } = await db.collection('momentLikes')
          .where({ momentId, userId })
          .get()

        if (existing.length > 0) {
          return { success: false, msg: '已点赞' }
        }

        await db.collection('momentLikes').add({
          data: { momentId, userId, createTime: db.serverDate() }
        })

        // 更新点赞数
        const { data: moment } = await db.collection('moments').doc(momentId).get()
        if (moment) {
          await db.collection('moments').doc(momentId).update({
            data: { likeCount: moment.likeCount + 1 }
          })
        }

        return { success: true }
      }

      case 'unlike': {
        // 取消点赞
        const { data: existing } = await db.collection('momentLikes')
          .where({ momentId, userId })
          .get()

        if (existing.length === 0) {
          return { success: false, msg: '未点赞' }
        }

        await db.collection('momentLikes').doc(existing[0]._id).remove()

        // 更新点赞数
        const { data: moment } = await db.collection('moments').doc(momentId).get()
        if (moment) {
          const newCount = Math.max(0, moment.likeCount - 1)
          await db.collection('moments').doc(momentId).update({
            data: { likeCount: newCount }
          })
        }

        return { success: true }
      }

      case 'comment': {
        // 评论朋友圈
        if (!content || content.trim().length === 0) {
          return { success: false, msg: '评论内容不能为空' }
        }

        if (content.length > 200) {
          return { success: false, msg: '评论内容不能超过200字' }
        }

        const { _id } = await db.collection('momentComments').add({
          data: { 
            momentId, 
            userId, 
            content: content.trim(), 
            createTime: db.serverDate() 
          }
        })

        // 更新评论数
        const { data: moment } = await db.collection('moments').doc(momentId).get()
        if (moment) {
          await db.collection('moments').doc(momentId).update({
            data: { commentCount: moment.commentCount + 1 }
          })
        }

        // 获取评论者信息
        const { data: commentUser } = await db.collection('users').doc(userId).get()

        return { 
          success: true, 
          data: { 
            _id, 
            momentId, 
            userId, 
            content: content.trim(), 
            userInfo: commentUser ? {
              _id: commentUser._id,
              nickName: commentUser.nickName,
              avatarUrl: commentUser.avatarUrl
            } : undefined
          }
        }
      }

      case 'deleteComment': {
        // 删除评论
        const { data: comment } = await db.collection('momentComments').doc(momentId).get()
        
        if (!comment) {
          return { success: false, msg: '评论不存在' }
        }

        if (comment.userId !== userId) {
          return { success: false, msg: '只能删除自己的评论' }
        }

        await db.collection('momentComments').doc(momentId).remove()

        // 更新评论数
        const { data: moment } = await db.collection('moments').doc(comment.momentId).get()
        if (moment) {
          const newCount = Math.max(0, moment.commentCount - 1)
          await db.collection('moments').doc(comment.momentId).update({
            data: { commentCount: newCount }
          })
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
        const { data: users } = await db.collection('users')
          .where({ _id: _.in(userIds) })
          .get()

        const userMap = new Map()
        for (const user of users) {
          userMap.set(user._id, user)
        }

        const result = comments.map(c => ({
          ...c,
          userInfo: userMap.get(c.userId)
        }))

        return { success: true, data: result }
      }

      case 'getAllMoments': {
        // 获取用户在所有群组的朋友圈列表（首页展示）
        const { data: members } = await db.collection('members')
          .where({ userId, status: 'normal' })
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
        }

        const { data: moments } = await query.get()
        if (moments.length === 0) {
          return { success: true, data: [] }
        }

        // 获取发布者信息
        const userIds = [...new Set(moments.map(m => m.userId))]
        const { data: users } = await db.collection('users')
          .where({ _id: _.in(userIds) })
          .get()

        const userMap = new Map()
        for (const user of users) {
          userMap.set(user._id, user)
        }

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
            userId 
          })
          .get()

        const likedSet = new Set(likes.map(l => l.momentId))

        const result = moments.map(moment => {
          const userInfo = userMap.get(moment.userId)
          const groupInfo = groupMap.get(moment.groupId)

          return {
            ...moment,
            groupName: groupInfo?.name || '',
            userInfo: userInfo ? {
              _id: userInfo._id,
              nickName: userInfo.nickName,
              avatarUrl: userInfo.avatarUrl
            } : undefined,
            isLiked: likedSet.has(moment._id)
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
