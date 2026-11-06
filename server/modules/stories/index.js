// server/modules/stories/index.js
// 睡前故事模块入口。对外暴露 { router, getContextSnippet }，供 moduleRegistry 统一接入。

const router = require('./routes');

/**
 * 故事内容不需要注入 AI 聊天上下文，返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
