// js/tts.js — 服务端 TTS 公共工具
// 通话模块和聊天模块共用。挂载为 window.ttsService

(function() {

  /**
   * 调用配置的 TTS API 将文字合成语音
   * @param {string} text 要合成的文字
   * @returns {Promise<Blob>} WAV 音频 Blob
   */
  async function gsvTextToSpeech(text) {
    var resp = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });

    if (!resp.ok) {
      var errText = '';
      try { var err = await resp.json(); errText = err.message || err.detail || ''; } catch (_) {}
      throw new Error('TTS 合成失败' + (errText ? '：' + errText : '（HTTP ' + resp.status + '）'));
    }

    return await resp.blob();
  }

  /**
   * 合成文字并播放，返回 Promise 在播放完成后 resolve
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function gsvSpeak(text) {
    var blob = await gsvTextToSpeech(text);
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    return new Promise(function(resolve, reject) {
      audio.onended = function() {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = function(e) {
        URL.revokeObjectURL(url);
        reject(e);
      };
      audio.play().catch(reject);
    });
  }

  window.ttsService = {
    textToSpeech: gsvTextToSpeech,
    speak: gsvSpeak,
  };

})();
