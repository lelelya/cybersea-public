// server/modules/books/index.js
// 书架（导入书）模块入口。对外暴露 { router, getContextSnippet }。

const router = require('./routes');

/**
 * 导入书不注入 AI 聊天上下文，返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
