// server/modules/economy/index.js
// 虚拟经济模块：红包/礼物/外卖
// AI 有余额限制，用户无限制。

const db = require('../../db');
const router = require('./routes');

function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
