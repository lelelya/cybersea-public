// routes/push.js
// Web Push 通知：VAPID 公钥分发 + 订阅管理

const express = require('express');
const db = require('../db');
const router = express.Router();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';

// GET /api/push/vapid-key → 返回公钥
router.get('/vapid-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID 密钥未配置' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe → 存储订阅
router.post('/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: '缺少订阅信息' });
    }

    // 检查是否已存在相同 endpoint
    const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    if (existing) {
      // 更新密钥
      db.prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE endpoint = ?')
        .run(keys.p256dh, keys.auth, endpoint);
    } else {
      db.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)')
        .run(endpoint, keys.p256dh, keys.auth);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[push] subscribe 失败:', err.message);
    res.status(500).json({ error: '订阅失败' });
  }
});

// DELETE /api/push/subscribe → 取消订阅
router.delete('/subscribe', (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    } else {
      // 没有 endpoint 就全删（清理所有订阅）
      db.prepare('DELETE FROM push_subscriptions').run();
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[push] unsubscribe 失败:', err.message);
    res.status(500).json({ error: '取消订阅失败' });
  }
});

module.exports = router;
