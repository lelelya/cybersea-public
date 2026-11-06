// server/modules/album/index.js
// 相册模块入口。对外只暴露 { router, getContextSnippet }。

const db = require('../../db');
const router = require('./routes');

const SOURCE_LABELS = {
  drawn: 'AI自己画的',
  downloaded: '从网上下载的',
  kept_from_chat: '从聊天中保留的',
};

/**
 * 返回相册（我的相册 + 他的相册）的概况，供AI在聊天中主动聊起照片内容。
 * 只列最近若干张，避免system prompt过长。
 * 完全没有照片时返回 null。
 */
function getContextSnippet() {
  return null;
}

module.exports = { router, getContextSnippet };
