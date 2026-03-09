/**
 * 数据迁移云函数：将各集合中的 openid / userId 统一为 _openid
 *
 * 使用方式（云开发控制台 → 云函数 → migrateOpenidToUnderline → 测试）：
 * - 迁移单个集合：{ "collection": "users", "batchSize": 100, "skip": 0 }
 * - 迁移所有集合：{ "runAll": true, "batchSize": 100 }
 * - 仅统计待迁移数量：{ "dryRun": true }
 *
 * 会为每条「有 openid 或 userId 且没有 _openid」的记录写入 _openid = openid || userId，不删除原字段。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 需要迁移的集合及用于填充 _openid 的字段（按优先级） */
const COLLECTIONS = [
  { name: 'users', idFields: ['openid'] },
  { name: 'members', idFields: ['openid', 'userId'] },
  { name: 'checkins', idFields: ['openid'] },
  { name: 'checkinStats', idFields: ['openid'] },
  { name: 'makeupQuota', idFields: ['openid'] },
  { name: 'moments', idFields: ['openid'] },
  { name: 'momentLikes', idFields: ['openid'] },
  { name: 'momentComments', idFields: ['openid'] },
  { name: 'momentAnnotations', idFields: ['openid'] },
  { name: 'suggestions', idFields: ['openid'] },
  { name: 'userTasks', idFields: ['openid'] },
  { name: 'userAchievements', idFields: ['openid'] },
  { name: 'goals', idFields: ['openid'] },
  { name: 'goalRecords', idFields: ['openid'] }
]

const DEFAULT_BATCH = 100
const MAX_BATCH = 500

/**
 * 对单个集合做一批迁移：拉取 skip 起 batchSize 条，对需要补 _openid 的文档执行 update
 */
async function migrateCollectionBatch(collectionName, idFields, options = {}) {
  const { batchSize = DEFAULT_BATCH, skip = 0, dryRun = false } = options
  const size = Math.min(Math.max(1, batchSize), MAX_BATCH)
  const col = db.collection(collectionName)

  const { data: list } = await col.orderBy('_id', 'asc').skip(skip).limit(size).get()
  if (!list || list.length === 0) {
    return { updated: 0, nextSkip: skip, done: true }
  }

  let updated = 0
  for (const doc of list) {
    const hasUnderline = doc._openid != null && doc._openid !== ''
    if (hasUnderline) continue

    let value = null
    for (const field of idFields) {
      const v = doc[field]
      if (v != null && typeof v === 'string' && v !== '') {
        value = v
        break
      }
    }
    if (!value) continue

    if (!dryRun) {
      try {
        await col.doc(doc._id).update({
          data: { _openid: value }
        })
        updated++
      } catch (e) {
        console.error(`migrateOpenidToUnderline update ${collectionName} ${doc._id}`, e)
      }
    } else {
      updated++
    }
  }

  const done = list.length < size
  return { updated, nextSkip: skip + list.length, done }
}

/**
 * 对单个集合全量迁移（循环 batch 直到 done）
 */
async function migrateCollection(collectionName, idFields, options = {}) {
  const { batchSize = DEFAULT_BATCH, dryRun = false, maxRounds = 1000 } = options
  let totalUpdated = 0
  let skip = 0
  let rounds = 0

  while (rounds < maxRounds) {
    const result = await migrateCollectionBatch(collectionName, idFields, {
      batchSize,
      skip,
      dryRun
    })
    totalUpdated += result.updated
    if (result.done) {
      return { collection: collectionName, totalUpdated, rounds: rounds + 1 }
    }
    skip = result.nextSkip
    rounds++
  }

  return { collection: collectionName, totalUpdated, rounds, truncated: true }
}

exports.main = async (event) => {
  const {
    collection: singleCollection,
    runAll,
    batchSize = DEFAULT_BATCH,
    skip = 0,
    dryRun = false,
    maxRounds = 1000
  } = event || {}

  const options = { batchSize, dryRun, maxRounds }

  try {
    if (singleCollection) {
      const meta = COLLECTIONS.find(c => c.name === singleCollection)
      if (!meta) {
        return { success: false, error: `未知集合: ${singleCollection}` }
      }
      const result = await migrateCollectionBatch(meta.name, meta.idFields, {
        batchSize,
        skip,
        dryRun
      })
      return {
        success: true,
        collection: singleCollection,
        dryRun: !!dryRun,
        ...result
      }
    }

    if (runAll) {
      const results = []
      for (const meta of COLLECTIONS) {
        const result = await migrateCollection(meta.name, meta.idFields, options)
        results.push(result)
      }
      const totalUpdated = results.reduce((sum, r) => sum + r.totalUpdated, 0)
      return {
        success: true,
        dryRun: !!dryRun,
        totalUpdated,
        details: results
      }
    }

    return {
      success: false,
      error: '请指定 collection（单集合单批）或 runAll: true（全量迁移）',
      usage: {
        single: { collection: 'users', batchSize: 100, skip: 0, dryRun: false },
        all: { runAll: true, batchSize: 100, dryRun: false, maxRounds: 1000 }
      }
    }
  } catch (e) {
    console.error('migrateOpenidToUnderline error', e)
    return { success: false, error: e.message || '迁移失败' }
  }
}
