// server/modules/favorites/index.js
// 收藏模块入口。对外暴露 { router, getContextSnippet }，供 moduleRegistry 统一接入。

const router = require('./routes');

/**
 * 收藏内容不需要注入 AI 聊天上下文，返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
