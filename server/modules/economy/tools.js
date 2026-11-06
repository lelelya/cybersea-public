const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'send_red_packet',
  description: '给用户发一个红包。从虚拟钱包中扣除相应金额。红包金额5-100元为宜。余额不足时无法发送。',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: '红包金额（元）' },
    },
    required: ['amount'],
  },
  is_write: true,
  handler(args) {
    if (typeof args.amount !== 'number' || args.amount <= 0) {
      return { error: '红包金额必须是正数' };
    }
    const bal = db.prepare('SELECT balance FROM ai_balance WHERE id = 1').get();
    if (!bal || bal.balance < args.amount) {
      return { error: `余额不足！当前余额 ${bal ? bal.balance.toFixed(2) : '0.00'} 元，无法发送 ${args.amount} 元的红包。` };
    }
    // 扣款
    db.prepare(
      "UPDATE ai_balance SET balance = balance - ?, updated_at = datetime('now', 'localtime') WHERE id = 1"
    ).run(args.amount);
    // 记录交易
    const econResult = db.prepare(
      'INSERT INTO virtual_economy (type, sender, recipient, item_name, amount) VALUES (?, ?, ?, ?, ?)'
    ).run('red_packet', 'ai', 'user', '红包', args.amount);
    // 插入聊天消息
    const content = JSON.stringify({ item_name: '红包', amount: args.amount, sender: 'ai', recipient: 'user' });
    const msgResult = db.prepare(
      `INSERT INTO messages (role, content, type, memory_origin) VALUES (?, ?, ?, 'tool')`
    ).run('ai', content, 'red_packet');
    return {
      transaction_id: econResult.lastInsertRowid,
      message: `已发送 ${args.amount} 元的红包！余额剩余 ${(bal.balance - args.amount).toFixed(2)} 元。`,
      economy_message: { msg_id: msgResult.lastInsertRowid, type: 'red_packet', content },
    };
  },
});

register({
  name: 'send_gift',
  description: '给用户送一份礼物。从你的虚拟钱包中扣除礼物金额。礼物价格要合理，一般50-200元。余额不足时无法发送。',
  parameters: {
    type: 'object',
    properties: {
      item_name: { type: 'string', description: '礼物名称，如"一束玫瑰花"、"一个手工音乐盒"' },
      amount: { type: 'number', description: '礼物价格（元）' },
    },
    required: ['item_name', 'amount'],
  },
  is_write: true,
  handler(args) {
    if (typeof args.amount !== 'number' || args.amount <= 0) {
      return { error: '礼物价格必须是正数' };
    }
    const itemName = (args.item_name || '').trim();
    if (!itemName) return { error: '礼物名称不能为空' };
    const bal = db.prepare('SELECT balance FROM ai_balance WHERE id = 1').get();
    if (!bal || bal.balance < args.amount) {
      return { error: `余额不足！当前余额 ${bal ? bal.balance.toFixed(2) : '0.00'} 元，无法购买 ${args.amount} 元的礼物。` };
    }
    db.prepare(
      "UPDATE ai_balance SET balance = balance - ?, updated_at = datetime('now', 'localtime') WHERE id = 1"
    ).run(args.amount);
    const econResult = db.prepare(
      'INSERT INTO virtual_economy (type, sender, recipient, item_name, amount) VALUES (?, ?, ?, ?, ?)'
    ).run('gift', 'ai', 'user', itemName, args.amount);
    const content = JSON.stringify({ item_name: itemName, amount: args.amount, sender: 'ai', recipient: 'user' });
    const msgResult = db.prepare(
      `INSERT INTO messages (role, content, type, memory_origin) VALUES (?, ?, ?, 'tool')`
    ).run('ai', content, 'gift');
    return {
      transaction_id: econResult.lastInsertRowid,
      message: `已送出${itemName}（价值${args.amount}元）！余额剩余 ${(bal.balance - args.amount).toFixed(2)} 元。`,
      economy_message: { msg_id: msgResult.lastInsertRowid, type: 'gift', content },
    };
  },
});

register({
  name: 'send_food_delivery',
  description: '给用户点一份外卖。从你的虚拟钱包中扣除相应金额。外卖价格要符合实际（奶茶10-30元、简餐20-50元）。余额不足时无法发送。',
  parameters: {
    type: 'object',
    properties: {
      item_name: { type: 'string', description: '菜品名称，如"一杯珍珠奶茶"、"一份鳗鱼饭"' },
      amount: { type: 'number', description: '外卖价格（元）' },
    },
    required: ['item_name', 'amount'],
  },
  is_write: true,
  handler(args) {
    if (typeof args.amount !== 'number' || args.amount <= 0) {
      return { error: '外卖价格必须是正数' };
    }
    const itemName = (args.item_name || '').trim();
    if (!itemName) return { error: '菜品名称不能为空' };
    const bal = db.prepare('SELECT balance FROM ai_balance WHERE id = 1').get();
    if (!bal || bal.balance < args.amount) {
      return { error: `余额不足！当前余额 ${bal ? bal.balance.toFixed(2) : '0.00'} 元，无法点 ${args.amount} 元的外卖。` };
    }
    db.prepare(
      "UPDATE ai_balance SET balance = balance - ?, updated_at = datetime('now', 'localtime') WHERE id = 1"
    ).run(args.amount);
    const econResult = db.prepare(
      'INSERT INTO virtual_economy (type, sender, recipient, item_name, amount) VALUES (?, ?, ?, ?, ?)'
    ).run('food_delivery', 'ai', 'user', itemName, args.amount);
    const content = JSON.stringify({ item_name: itemName, amount: args.amount, sender: 'ai', recipient: 'user' });
    const msgResult = db.prepare(
      `INSERT INTO messages (role, content, type, memory_origin) VALUES (?, ?, ?, 'tool')`
    ).run('ai', content, 'food_delivery');
    return {
      transaction_id: econResult.lastInsertRowid,
      message: `已点了${itemName}（${args.amount}元）！余额剩余 ${(bal.balance - args.amount).toFixed(2)} 元。`,
      economy_message: { msg_id: msgResult.lastInsertRowid, type: 'food_delivery', content },
    };
  },
});
};
