# 云数据库集合说明

在微信开发者工具中创建以下集合，并配置权限。

## 用户标识字段：统一使用 _openid

- **查询与写入**：所有「按用户」的查询和写入统一使用 **`_openid`**（微信云开发用户身份字段）。历史字段 `openid`、`userId` 仅作兼容保留，新逻辑不再依赖。
- **数据迁移**：若库中仍有仅含 `openid` 或 `userId`、没有 `_openid` 的旧数据，需执行一次迁移，为这些记录补写 `_openid`。
  - **云函数**：`migrateOpenidToUnderline`
  - **单集合单批**：`{ "collection": "users", "batchSize": 100, "skip": 0 }`，返回 `nextSkip`、`done`，可循环直到 `done: true`。
  - **全量迁移**：`{ "runAll": true, "batchSize": 100 }`，会按批遍历所有相关集合并补写 `_openid`。
  - **试跑（不写库）**：`{ "runAll": true, "dryRun": true }` 可先看会更新多少条。
- **涉及集合**：users、members、checkins、checkinStats、makeupQuota、moments、momentLikes、momentComments、momentAnnotations、suggestions、userTasks、userAchievements、goals、goalRecords、referralRewardLog。

## 1. users（用户）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（统一使用；与权限一致） |
| openid | string | 兼容保留，迁移后与 _openid 同值 |
| nickName | string | 昵称 |
| avatarUrl | string | 头像 URL |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |
| inviterOpenid | string | 可选；邀请人的 _openid（分销一级） |
| inviteCode | string | 可选；本人邀请码，唯一，用于分享给他人 |
| inviteTime | date | 可选；绑定邀请人的时间 |
| referralPoints | number | 可选；累计获得的邀请奖励积分（默认 0） |
| aiReviewQuotaMonth | string | 可选；小勤点评配额所属月份 YYYY-MM，由定时任务与开通会员时写入 |
| aiReviewUsedThisMonth | number | 可选；当月已使用小勤点评次数，每月初由云函数 resetAiReviewQuota 重置，开通/续费会员时重置为 0 |

权限：用户仅可读写自己的记录（_openid == 当前用户）

## 2. groups（组织）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| name | string | 组织名称 2-10 字 |
| inviteCode | string | 邀请码，唯一 |
| creatorId | string | 组长 openid |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：所有用户可读，仅创建者可写

## 3. members（组织成员）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| groupId | string | 组织 _id |
| _openid | string | 用户 openid（统一使用） |
| openid / userId | string | 兼容保留 |
| role | string | admin(组长) / member |
| status | string | normal / removed / quit |
| joinTime | date | 加入时间 |
| updateTime | date | 更新时间 |

权限：同组成员可读，组长可写（移除成员）

## 4. checkins（打卡记录）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（统一使用） |
| openid | string | 兼容保留 |
| groupId | string | 组织 _id |
| date | string | YYYY-MM-DD |
| isMakeup | boolean | 是否补卡 |
| isPublishToMoments | boolean | 是否发表到成长墙（打卡时勾选则 true，补卡为 false） |
| content | object | 可选，打卡内容（文字、图片、时长等） |
| score | object | 可选，评分与 AI 反馈等 |
| createTime | date | 创建时间 |
| updateTime | date | 可选，更新时间 |

每次打卡生成一条记录；统计类数据存于 checkinStats，不在此表冗余。是否发表到成长墙以此字段为准；moments 表为成长墙展示用，可视为非必须的展示层。

索引建议：_openid + date（按用户查某日/最新打卡）

权限：用户仅可读写自己的打卡记录

## 4.1 checkinStats（打卡统计，每用户一条）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（唯一，用于 upsert；统一使用） |
| openid | string | 兼容保留 |
| current_streak | number | 当前连胜天数 |
| last_check_in_date | string | 最后一次打卡日期 YYYY-MM-DD |
| best_streak | number | 历史最佳连胜天数 |
| recorded_days | number | 有记录天数（累计去重打卡天数） |
| slack_days | number | 摸鱼天数（应打卡天数 - 有记录天数） |
| first_check_in_date | string | 首次打卡日期 YYYY-MM-DD |
| updateTime | date | 最后更新时间 |

每次打卡或补卡后由云函数根据 checkins 流水更新本表对应用户的该条记录。查询首页四类统计时直接读本表即可。

索引建议：_openid 唯一索引（按用户查一条）

历史数据迁移：上线后对老用户执行一次回填。
- **一键迁移（推荐）**：云开发控制台 → 云函数 scoreCheckin → 测试，传入 `{ "action": "migrateCheckinStatsRunAll" }`，可加 `"maxRounds": 50`（最多约 5000 条打卡）。返回 `done: true` 表示全部完成；若 `done: false` 可再执行一次。
- **单用户**：`{ "action": "migrateCheckinStats", "openid": "xxx" }`。
- **分批**：`{ "action": "migrateCheckinStatsBatch", "skip": 0, "limit": 100 }`，用返回的 `nextSkip` 继续调用直到 `done: true`。

权限：用户仅可读写自己的记录

## 5. makeupQuota（补卡次数）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（统一使用） |
| openid | string | 兼容保留 |
| month | string | YYYY-MM |
| usedCount | number | 已用次数 0-2 |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：用户仅可读写自己的记录

## 6. moments（成长墙/打卡动态）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 发布者 openid（统一使用） |
| openid | string | 兼容保留 |
| groupId | string | 组织 _id |
| checkinId | string | 关联的打卡记录 _id |
| date | string | 动态日期 YYYY-MM-DD（与打卡日一致，用于日/周/月批注统计） |
| content | object | 成长墙内容 |
| - photos | array | 照片云存储路径列表 |
| - text | string | 文字内容 |
| - sportType | string | 运动类型 |
| - score | number | 评分 |
| - tags | array | 内容标签 |
| dailyAnnotation | string | 日批注：当日数据统计摘要（不走 AI，发表时规则生成） |
| likeCount | number | 点赞数 |
| commentCount | number | 评论数 |
| createTime | date | 创建时间 |

权限：同组成员可读，仅发布者可写

## 6.1 momentAnnotations（周/月/年点评）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（统一使用） |
| openid | string | 兼容保留 |
| type | string | weekly（周点评）/ monthly（月点评）/ yearly（年点评） |
| period | string | 周期：周 YYYY-Www，月 YYYY-MM，年 YYYY |
| content | string | AI 生成的详细点评（周 100～300 字，月 200～400 字，年 300～500 字） |
| contentShort | string | AI 生成的周整体概括（50～80 字，概括本周做了哪些事，用于海报/列表） |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间（更新时写入） |

- **数据基础**：点评以 **checkin（打卡记录）** 为基础计算，不依赖 moments。
- 周点评：上周**每条** checkin 的摘要（大类型/小类型/时长/时间/打卡说明）汇总 → AI 生成详细点评 + 本周整体概括（概括本周做了哪些事）；带周期(period)与创建时间。
- 月点评：上月各周的最后一条周点评(详细) 聚合 → AI 生成详细 + 简要；带周期与创建时间。
- 年点评：上一年各月月点评(详细) 聚合 → AI 生成详细 + 简要；带周期与创建时间。

索引建议：_openid + type + period（唯一），便于按用户按周期查询。

权限：用户仅可读自己的记录；仅云函数可写（用户手动点击生成）

**生成方式**（云函数 `generateMomentAnnotations`，无定时触发器）：
- 用户在小程序「小勤同学点评」页点击「上周 / 上月 / 去年」时调用，传入 `action: "weekly" | "monthly" | "yearly"`。
- **VIP 档位限制**：每月可生成次数按 VIP 等级：普通 5 次、青铜 20 次、白银 40 次、黄金 100 次；开通即拥有额度。
- **次数重置**：每月 1 号 0 点由云函数 `resetAiReviewQuota` 定时任务将全体用户的 `aiReviewUsedThisMonth` 置 0；开设/续费会员时在 `upgradeVip` 中按会员类型重置为 0，当月即享有该档位额度。
- **扣减**：每次成功生成一条点评（周/月/年）即扣减 1 次，写入 `users.aiReviewUsedThisMonth`。
- 点评记录通过 moments 云函数 `getAnnotations` 查询（返回 content、contentShort、createTime 等），详情页展示详细点评，海报/列表使用 contentShort（周为本周整体概括）。

## 7. momentLikes（成长墙点赞）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| momentId | string | 成长墙 _id |
| _openid | string | 点赞用户 openid（统一使用） |
| openid | string | 兼容保留 |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的点赞记录

## 8. momentComments（成长墙评论）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| momentId | string | 成长墙 _id |
| _openid | string | 评论用户 openid（统一使用） |
| openid | string | 兼容保留 |
| content | string | 评论内容 |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的评论记录

## 9. userTasks（用户任务进度）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（索引；统一使用） |
| openid | string | 兼容保留 |
| taskId | string | 任务ID |
| current | number | 当前进度 |
| completed | boolean | 是否完成 |
| claimed | boolean | 是否已领取奖励 |
| completedAt | date | 完成时间 |
| claimedAt | date | 领取时间 |
| createTime | date | 创建时间 |
| updateTime | date | 更新时间 |

权限：用户仅可读写自己的任务进度

## 10. goals（用户目标）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| _openid | string | 用户 openid（索引；统一使用） |
| openid | string | 兼容保留 |
| type | string | 目标类型：checkin/streak/duration/photos/moments |
| period | string | 周期：daily/weekly/monthly |
| target | number | 目标值 |
| title | string | 标题 |
| description | string | 描述 |
| startDate | string | 开始日期 YYYY-MM-DD |
| endDate | string | 结束日期 YYYY-MM-DD |
| reward | object | 奖励配置 { type, value, name } |
| penalty | object | 惩罚配置 { type, value, name } |
| createdAt | date | 创建时间 |
| updatedAt | date | 更新时间 |

权限：用户仅可读写自己的目标

## 11. goalRecords（目标记录）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| goalId | string | 目标 _id |
| _openid | string | 用户 openid（统一使用） |
| openid | string | 兼容保留 |
| period | string | 周期 |
| current | number | 当前进度 |
| processed | boolean | 是否已处理奖励/惩罚 |
| processedAt | date | 处理时间 |
| createTime | date | 创建时间 |

权限：用户仅可读写自己的目标记录

## 12. referralRewardLog（邀请奖励记录）
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| receiverOpenid | string | 获得奖励的用户 _openid |
| type | string | direct（一级邀请）/ second（二级邀请） |
| inviteeOpenid | string | 被邀请人 _openid（触发此次奖励的注册用户） |
| points | number | 本次奖励积分 |
| createTime | date | 创建时间 |

用于记录每次邀请奖励发放，便于对账与展示。权限：仅云函数可写；用户可读自己（receiverOpenid == 当前用户）的记录。
