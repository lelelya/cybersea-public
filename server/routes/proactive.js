// routes/proactive.js
// 主动消息系统：设置 API + 触发器

const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/proactive/settings
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM proactive_settings WHERE id = 1').get();
    res.json(settings || {});
  } catch (err) {
    console.error('[proactive] GET settings 失败:', err.message);
    res.status(500).json({ error: '读取设置失败' });
  }
});

// PUT /api/proactive/settings
router.put('/settings', (req, res) => {
  try {
    const fields = [
      'enabled', 'morning_enabled', 'morning_start', 'morning_end',
      'night_enabled', 'night_start', 'night_end',
      'check_interval', 'dnd_start', 'dnd_end', 'max_daily',
    ];

    const sets = [];
    const vals = {};

    for (const field of fields) {
      if (req.body && req.body[field] !== undefined) {
        sets.push(`${field} = @${field}`);
        vals[field] = req.body[field];
      }
    }

    if (sets.length > 0) {
      db.prepare(
        `UPDATE proactive_settings SET ${sets.join(', ')} WHERE id = 1`
      ).run(vals);
    }

    // 返回更新后的设置
    const updated = db.prepare('SELECT * FROM proactive_settings WHERE id = 1').get();
    res.json(updated || {});

    // 通知调度器重载设置（通过设置全局标记）
    if (typeof reloadProactiveSettings === 'function') {
      reloadProactiveSettings();
    }
  } catch (err) {
    console.error('[proactive] PUT settings 失败:', err.message);
    res.status(500).json({ error: '更新设置失败' });
  }
});

// 让 scheduler 可以注册重载回调
let reloadCallback = null;
function onSettingsChanged(cb) {
  reloadCallback = cb;
}
function reloadProactiveSettings() {
  if (reloadCallback) reloadCallback();
}

module.exports = { router, onSettingsChanged };
