// 云函数：生成小程序码并上传到云存储，返回 fileID
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function sanitizeScene(raw) {
  if (!raw || typeof raw !== 'string') return 'from=share'
  // 只保留合法字符，并截断到 32
  const cleaned = raw.replace(/[^A-Za-z0-9!#$&'()*+,/:;=?@\-._~]/g, '').slice(0, 32)
  return cleaned.length >= 1 ? cleaned : 'from=share'
}

exports.main = async (event, context) => {
  const page = event.page || 'pages/index/index'
  const scene = sanitizeScene(event.scene)
  // 传 skipUnlimited: true 可跳过 getUnlimited（测试环境正式版未发布时用）
  const skipUnlimited = event.skipUnlimited === true

  console.log('[getQrCode] 参数:', { page, rawScene: event.scene, scene, skipUnlimited })

  // 每种 scene 存储到独立路径，避免覆盖
  const safeScene = scene.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24)
  const cloudPath = `qrcodes/qr_${safeScene}.png`

  let buffer = null

  // ── 优先：getUnlimited（圆形小程序码，无数量限制）────────────────────
  // 注意：getUnlimited 要求小程序已发布正式版，测试阶段会报 41030
  if (!skipUnlimited) {
    try {
      const qrRes = await cloud.openapi.wxacode.getUnlimited({
        scene,
        page,
        width: 280,
        autoColor: false,
        lineColor: { r: 0, g: 0, b: 0 },
        isHyaline: false
      })
      if (qrRes && qrRes.buffer) {
        buffer = qrRes.buffer
        console.log('[getQrCode] getUnlimited 成功')
      }
    } catch (e1) {
      console.warn('[getQrCode] getUnlimited 失败，降级到 createWXAQRCode:', e1.message || e1)
    }
  }

  // ── 降级：createWXAQRCode（方形二维码，最多 10 万个）────────────────
  if (!buffer) {
    try {
      const path = (`${page}?${scene}`).slice(0, 128)
      const qrRes2 = await cloud.openapi.wxacode.createWXAQRCode({
        path,
        width: 280
      })
      if (qrRes2 && qrRes2.buffer) {
        buffer = qrRes2.buffer
        console.log('[getQrCode] createWXAQRCode 成功')
      }
    } catch (e2) {
      console.error('[getQrCode] createWXAQRCode 也失败:', e2.message || e2)
      return { success: false, error: e2.message || String(e2) }
    }
  }

  if (!buffer) {
    return { success: false, error: '生成二维码失败：返回数据为空' }
  }

  // ── 上传到云存储（同名覆盖，起缓存作用）────────────────────────────
  try {
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    })
    return { success: true, fileID: uploadRes.fileID }
  } catch (e) {
    console.error('[getQrCode] 上传失败:', e)
    return { success: false, error: e.message || String(e) }
  }
}
