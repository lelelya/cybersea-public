const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'initiate_call',
  description: '主动打电话给用户。接通后会进行语音通话，第一句话会被播放给用户听。',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '打电话的原因。接通后这会作为你开口说的第一句话播放给用户。要口语化自然，像真的拨通电话一样。例如"喂，是我。突然想听听你的声音。"' },
    },
    required: ['reason'],
  },
  is_write: true,
  handler(args) {
    // 通过 WebSocket 向来电通知
    const { getWsClient } = require('../../websocket');
    const ws = getWsClient('user');
    if (ws && ws.readyState === 1) {
      const firstMessage = args.reason || '喂，是我。想你了，给你打个电话。';
      try {
        ws.send(JSON.stringify({ type: 'incoming_call', firstMessage }));
        return {
          available: true,
          reason: args.reason || '',
          message: '已向用户发起通话邀请，等待用户接听。',
        };
      } catch (err) {
        return { available: false, reason: args.reason || '', message: '发起通话失败：' + err.message };
      }
    }
    return {
      available: false,
      reason: args.reason || '',
      message: '用户当前不在线，无法发起通话。可以等用户在的时候再打，或者发消息/写信。',
    };
  },
});
};
