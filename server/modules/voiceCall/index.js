// server/modules/voiceCall/index.js
// 语音通话模块入口。对外只暴露 { router, getContextSnippet }。

const router = require('./routes');

/**
 * 通话记录属于隐私数据，不注入聊天上下文。
 */
function getContextSnippet() {
  return null;
}

module.exports = {
  router,
  getContextSnippet,
};
