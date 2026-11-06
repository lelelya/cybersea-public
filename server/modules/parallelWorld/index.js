// server/modules/parallelWorld/index.js
// 平行世界模块入口。对外只暴露 { router, getContextSnippet }，供 moduleRegistry 统一接入。
//
// 模块隔离：getContextSnippet 返回 null，剧情内容不写入聊天的记忆库，
// 不影响聊天的上下文。AI 在聊天中不会主动提起剧情内容。

const router = require('./routes');

function getContextSnippet() {
  // 剧情内容不暴露给聊天上下文 —— 模块完全独立
  return null;
}

module.exports = { router, getContextSnippet };
