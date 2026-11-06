// server/modules/moments/index.js
// 朋友圈模块入口。对外暴露 { router, getContextSnippet }。
//
// AI 主动发朋友圈不再通过 onChatExchange 随机触发——那会导致"重复发/内容跑偏"。
// 现在发朋友圈由 AI 在聊天里自主调用 post_moment FC 工具完成（与写信 write_letter 一致），
// 该路径自带人设、会写入工具通知和记忆日志，AI 也能"记得"自己发过。

const router = require('./routes');

/**
 * 返回最近几条朋友圈动态概况，供AI在聊天中主动提及你发的内容。
 * 没有任何动态时返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
