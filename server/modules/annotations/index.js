// server/modules/annotations/index.js
// 批画模块入口。对外暴露 { router, getContextSnippet }。

const router = require('./routes');

/**
 * 批画不注入 AI 聊天上下文，返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
