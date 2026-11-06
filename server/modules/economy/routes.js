// server/modules/economy/routes.js
// 虚拟经济 API：用户发送红包/礼物/外卖，查询余额和交易历史

const express = require('express');
const db = require('../../db');

const router = express.Router();

// POST /api/economy/send — 用户发送红包/礼物/外卖
router.post('/send', (req, res) => {
  try {
    const { type, item_name, amount } = req.body || {};

    if (!type || !['red_packet', 'gift', 'food_delivery'].includes(type)) {
      return res.status(400).json({ error: 'type 必须是 red_packet / gift / food_delivery' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'amount 必须是正数' });
    }
    const itemName = (item_name || '').trim();
    if (type !== 'red_packet' && !itemName) {
      return res.status(400).json({ error: '礼物/外卖需要填写物品名称' });
    }

    // 记录交易
    const econResult = db.prepare(
      'INSERT INTO virtual_economy (type, sender, recipient, item_name, amount) VALUES (?, ?, ?, ?, ?)'
    ).run(type, 'user', 'ai', itemName, amount);

    // 红包：增加 AI 余额
    if (type === 'red_packet') {
      db.prepare(
        "UPDATE ai_balance SET balance = balance + ?, updated_at = datetime('now', 'localtime') WHERE id = 1"
      ).run(amount);
    }

    // 插入聊天消息（特殊类型气泡）
    const content = JSON.stringify({
      item_name: itemName || '红包',
      amount,
      sender: 'user',
      recipient: 'ai',
    });
    const msgResult = db.prepare(
      `INSERT INTO messages (role, content, type, memory_origin) VALUES (?, ?, ?, 'tool')`
    ).run('user', content, type);

    const transaction = db.prepare('SELECT * FROM virtual_economy WHERE id = ?').get(econResult.lastInsertRowid);

    res.json({
      transaction,
      message: {
        id: msgResult.lastInsertRowid,
        role: 'user',
        type,
        content,
      },
    });
  } catch (err) {
    console.error('[economy] send 失败:', err.message);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  }
});

// GET /api/economy/balance — 获取 AI 余额
router.get('/balance', (req, res) => {
  try {
    const bal = db.prepare('SELECT balance FROM ai_balance WHERE id = 1').get();
    res.json({ balance: bal ? bal.balance : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/economy/:id — 删除交易记录（AI 账本用）
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: '无效ID' });
    const row = db.prepare('SELECT * FROM virtual_economy WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    // 删除交易记录
    db.prepare('DELETE FROM virtual_economy WHERE id = ?').run(id);
    // 更新 AI 余额：红包收入扣回，AI 支出返还
    if (row.type === 'red_packet' && row.recipient === 'ai') {
      db.prepare("UPDATE ai_balance SET balance = MAX(0, balance - ?), updated_at = datetime('now', 'localtime') WHERE id = 1").run(row.amount);
    } else if (row.sender === 'ai') {
      db.prepare("UPDATE ai_balance SET balance = balance + ?, updated_at = datetime('now', 'localtime') WHERE id = 1").run(row.amount);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/economy/history?owner=user|ai — 获取交易历史
router.get('/history', (req, res) => {
  try {
    const { owner } = req.query;
    let rows;
    if (owner === 'ai') {
      rows = db.prepare(
        "SELECT * FROM virtual_economy WHERE sender = 'ai' OR recipient = 'ai' ORDER BY created_at DESC LIMIT 200"
      ).all();
    } else if (owner === 'user') {
      rows = db.prepare(
        "SELECT * FROM virtual_economy WHERE sender = 'user' OR recipient = 'user' ORDER BY created_at DESC LIMIT 200"
      ).all();
    } else {
      rows = db.prepare(
        'SELECT * FROM virtual_economy ORDER BY created_at DESC LIMIT 200'
      ).all();
    }
    res.json({ transactions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
