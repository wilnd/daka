# 云数据库集合说明

在微信开发者工具中创建以下集合，并配置权限。

## 1. users（用户）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| openid | string | 微信 openid，通过云函数获取 |
| nickName | string | 昵称 |
| avatarUrl | string | 头像 URL |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：用户仅可读写自己的记录（openid == 当前用户）

## 2. groups（小组）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| name | string | 小组名称 2-10 字 |
| inviteCode | string | 邀请码，唯一 |
| creatorId | string | 组长 openid |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：所有用户可读，仅创建者可写

## 3. members（小组成员）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| groupId | string | 小组 _id |
| userId | string | 用户 openid |
| role | string | admin(组长) / member |
| status | string | normal / removed / quit |
| joinTime | date | 加入时间 |
| updateTime | date | 更新时间 |

权限：同组成员可读，组长可写（移除成员）

## 4. checkins（打卡记录）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| userId | string | 用户 openid |
| groupId | string | 小组 _id |
| date | string | YYYY-MM-DD |
| isMakeup | boolean | 是否补卡 |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的打卡记录

## 5. makeupQuota（补卡次数）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| userId | string | 用户 openid |
| month | string | YYYY-MM |
| usedCount | number | 已用次数 0-2 |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：用户仅可读写自己的记录

## 6. moments（成长墙）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| userId | string | 发布者 openid |
| groupId | string | 小组 _id |
| checkinId | string | 关联的打卡记录 _id |
| content | object | 成长墙内容 |
| - photos | array | 照片云存储路径列表 |
| - text | string | 文字内容 |
| - sportType | string | 运动类型 |
| - score | number | 评分 |
| - tags | array | 内容标签 |
| likeCount | number | 点赞数 |
| commentCount | number | 评论数 |
| createTime | date | 创建时间 |

权限：同组成员可读，仅发布者可写

## 7. momentLikes（成长墙点赞）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| momentId | string | 成长墙 _id |
| userId | string | 点赞用户 openid |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的点赞记录

## 8. momentComments（成长墙评论）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| momentId | string | 成长墙 _id |
| userId | string | 评论用户 openid |
| content | string | 评论内容 |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的评论记录
