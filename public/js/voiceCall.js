// js/voiceCall.js — 语音通话模块前端逻辑
(function() {

  // ============ 状态 ============
  const state = {
    view: 'history',
    callPhase: 'dial',
    callStartTime: null,
    timerInterval: null,
    elapsedSeconds: 0,
    // 全程录音
    isRecording: true,
    mediaRecorder: null,
    audioChunks: [],
    // 白噪音
    noisePlayers: {},
    audioContext: null,
    dialTimer: null,
    // 麦克风
    micMuted: false,
    micStream: null,
    // VAD 语音活动检测
    vadListening: false,
    vadChunks: [],
    vadRecorder: null,
    vadStream: null,
    vadSilenceTimer: null,
    vadSilenceThreshold: 1500,  // 停顿超过1.5秒认为说完
    // 对话记录（仅后台暂存，用于写入记忆库）
    conversationRounds: [],
    isAIProcessing: false,
    // 角色
    aiName: '他',
    aiAvatarPath: '',
    // 来电相关
    isIncoming: false,
    incomingFirstMessage: '',
    // 文字输入
    textInputExpanded: false,
    currentTtsAudio: null,  // 当前正在播放的TTS音频元素
    isTextProcessing: false,  // AI 正在处理文字输入
    isAIResponding: false,  // AI 正在回复中（收到chunk到end之间）
  };

  // ============ DOM 引用 ============
  function $(id) { return document.getElementById(id); }

  const dom = {
    historyView: $('vc-history-view'),
    historyContainer: $('vc-history-container'),
    empty: $('vc-empty'),
    callScreen: $('vc-call-screen'),
    dialingView: $('vc-dialing-view'),
    inCallView: $('vc-in-call-view'),
    timer: $('vc-timer'),
    callContent: $('vc-call-content'),
    avatarArea: $('vc-avatar-area'),
    avatarWrap: $('vc-avatar-wrap'),
    avatarRipple: $('vc-avatar-ripple'),
    avatarPlaceholder: $('vc-avatar-placeholder'),
    avatarImg: $('vc-avatar-img'),
    avatarName: $('vc-avatar-name'),
    micBtn: $('vc-mic-btn'),
    noiseIconBtn: $('vc-noise-icon-btn'),
    noiseOverlay: $('vc-noise-overlay'),
    hangup: $('vc-hangup'),
    dialBtn: $('vc-dial-btn'),
    cancelDial: $('vc-cancel-dial'),
    incomingScreen: $('vc-incoming-screen'),
    incomingAvatarPlaceholder: $('vc-incoming-avatar-placeholder'),
    incomingAvatarImg: $('vc-incoming-avatar-img'),
    incomingName: $('vc-incoming-name'),
    acceptBtn: $('vc-accept-btn'),
    rejectBtn: $('vc-reject-btn'),
    toast: $('toast'),
    callMessages: $('vc-call-messages'),
    textInputRow: $('vc-text-input-row'),
    textInput: $('vc-text-input'),
    collapseInputBtn: $('vc-collapse-input-btn'),
    sendTextBtn: $('vc-send-text-btn'),
    keyboardBtn: $('vc-keyboard-btn'),
  };

  // ============ Toast ============
  function showToast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    setTimeout(function() { dom.toast.classList.remove('show'); }, 2000);
  }

  // ============ 视图切换 ============
  function showView(view) {
    state.view = view;
    if (view === 'history') {
      dom.historyView.style.display = '';
      dom.callScreen.classList.remove('active');
      dom.dialingView.style.display = '';
      dom.inCallView.classList.remove('active');
      dom.noiseOverlay.classList.remove('show');
      dom.noiseIconBtn.classList.remove('open');
    } else {
      dom.historyView.style.display = 'none';
      dom.callScreen.classList.add('active');
    }
  }

  function showCallPhase(phase) {
    state.callPhase = phase;
    if (phase === 'dial') {
      dom.dialingView.style.display = '';
      dom.inCallView.classList.remove('active');
    } else {
      dom.dialingView.style.display = 'none';
      dom.inCallView.classList.add('active');
    }
  }

  // ============ 角色信息加载 ============
  async function loadPersona() {
    try {
      var resp = await fetch('/api/persona');
      var data = await resp.json();
      state.aiName = (data.persona && data.persona.ai_name) || '他';
      state.aiAvatarPath = (data.persona && data.persona.ai_avatar_path) || '';
    } catch (e) {
      state.aiName = '他';
      state.aiAvatarPath = '';
    }
  }

  function applyPersona() {
    dom.avatarName.textContent = state.aiName;
    if (state.aiAvatarPath) {
      dom.avatarImg.src = state.aiAvatarPath;
      dom.avatarImg.style.display = '';
      dom.avatarPlaceholder.style.display = 'none';
    } else {
      dom.avatarImg.style.display = 'none';
      dom.avatarPlaceholder.style.display = '';
    }
  }

  // ============ 计时器 ============
  function formatTime(secs) {
    var m = String(Math.floor(secs / 60)).padStart(2, '0');
    var s = String(secs % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function startTimer() {
    state.callStartTime = Date.now();
    state.elapsedSeconds = 0;
    dom.timer.textContent = '00:00';
    state.timerInterval = setInterval(function() {
      state.elapsedSeconds = Math.floor((Date.now() - state.callStartTime) / 1000);
      dom.timer.textContent = formatTime(state.elapsedSeconds);
    }, 200);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    state.elapsedSeconds = Math.floor((Date.now() - state.callStartTime) / 1000);
  }

  // ============ 白噪音 ============
  function initAudioContext() {
    if (!state.audioContext) {
      try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('AudioContext 不可用:', e);
      }
    }
    return state.audioContext;
  }

  function loadNoiseAudio(type, callback) {
    var player = state.noisePlayers[type];
    if (!player) {
      player = { buffer: null, source: null, gain: null, playing: false, volume: 0.5, loaded: false };
      state.noisePlayers[type] = player;
    }
    if (player.loaded) { if (callback) callback(true); return; }
    var ctx = initAudioContext();
    if (!ctx) { if (callback) callback(false); return; }
    fetch('/audio/' + type + '.wav')
      .then(function(resp) { if (!resp.ok) throw new Error('File not found'); return resp.arrayBuffer(); })
      .then(function(buf) { return ctx.decodeAudioData(buf); })
      .then(function(audioBuffer) {
        player.buffer = audioBuffer;
        player.gain = ctx.createGain();
        player.gain.gain.value = player.volume;
        player.gain.connect(ctx.destination);
        player.loaded = true;
        if (callback) callback(true);
      })
      .catch(function(err) {
        console.warn('白噪音文件加载失败 ' + type + '.wav:', err.message);
        player.loaded = false;
        if (callback) callback(false);
      });
  }

  function playNoise(type) {
    var player = state.noisePlayers[type];
    var ctx = state.audioContext;
    if (!player || !player.buffer || !ctx) return;
    stopNoiseSource(player);
    player.source = ctx.createBufferSource();
    player.source.buffer = player.buffer;
    player.source.loop = true;
    player.source.connect(player.gain);
    player.source.start(0);
    player.playing = true;
  }

  function stopNoiseSource(player) {
    if (player && player.source) {
      try { player.source.stop(); } catch (e) {}
      player.source = null;
    }
  }

  function stopNoise(type) {
    var player = state.noisePlayers[type];
    if (!player) return;
    stopNoiseSource(player);
    player.playing = false;
  }

  function setNoiseVolume(type, volume) {
    var player = state.noisePlayers[type];
    if (!player) return;
    player.volume = volume;
    if (player.gain) { player.gain.gain.value = volume; }
  }

  function stopAllNoise() {
    ['rain', 'ocean', 'wind'].forEach(function(type) {
      stopNoise(type);
      var toggle = document.querySelector('.vc-noise-toggle[data-noise="' + type + '"]');
      if (toggle) toggle.classList.remove('on');
    });
  }

  function setupNoiseToggles() {
    document.querySelectorAll('.vc-noise-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = btn.dataset.noise;
        var player = state.noisePlayers[type];
        if (!player || !player.loaded) {
          btn.disabled = true;
          loadNoiseAudio(type, function(success) {
            btn.disabled = false;
            if (!success) {
              showToast((type === 'rain' ? '雨声' : type === 'ocean' ? '海浪' : '风声') + '音频文件未找到');
              return;
            }
            toggleNoise(type, btn);
          });
        } else {
          toggleNoise(type, btn);
        }
      });
    });

    document.querySelectorAll('.vc-noise-volume').forEach(function(slider) {
      slider.addEventListener('input', function() {
        var type = slider.dataset.noise;
        setNoiseVolume(type, parseInt(slider.value) / 100);
      });
    });
  }

  function toggleNoise(type, btn) {
    var player = state.noisePlayers[type];
    if (!player) return;
    if (player.playing) { stopNoise(type); btn.classList.remove('on'); }
    else { playNoise(type); btn.classList.add('on'); }
  }

  // ============ 白噪音面板开关 ============
  function setupNoisePanel() {
    dom.noiseIconBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = dom.noiseOverlay.classList.contains('show');
      if (isOpen) {
        dom.noiseOverlay.classList.remove('show');
        dom.noiseIconBtn.classList.remove('open');
      } else {
        dom.noiseOverlay.classList.add('show');
        dom.noiseIconBtn.classList.add('open');
      }
    });
    // 点击通话界面其他地方关闭面板
    dom.callScreen.addEventListener('click', function(e) {
      if (!e.target.closest('.vc-noise-overlay') && !e.target.closest('.vc-noise-icon-btn')) {
        dom.noiseOverlay.classList.remove('show');
        dom.noiseIconBtn.classList.remove('open');
      }
    });
  }

  // ============ 全程录音 ============
  function startFullRecording() {
    state.audioChunks = [];
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function(stream) {
        var mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        state.mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType,
          audioBitsPerSecond: 32000,
        });
        state.mediaRecorder.ondataavailable = function(e) {
          if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
        };
        state.mediaRecorder.onerror = function(e) { console.error('全程录音错误:', e); };
        state.mediaRecorder.start(1000);
      })
      .catch(function(err) {
        console.error('麦克风访问失败:', err);
        state.isRecording = false;
        showToast('无法访问麦克风，请检查浏览器权限');
      });
  }

  function stopFullRecording() {
    return new Promise(function(resolve) {
      if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
        resolve(null); return;
      }
      state.mediaRecorder.onstop = function() {
        if (state.mediaRecorder.stream) {
          state.mediaRecorder.stream.getTracks().forEach(function(t) { t.stop(); });
        }
        resolve(state.audioChunks.length > 0 ? new Blob(state.audioChunks, { type: 'audio/webm' }) : null);
      };
      state.mediaRecorder.stop();
    });
  }

  // ============ VAD 语音活动检测（占位：简单音量阈值） ============
  function startVAD() {
    if (state.vadListening) return;
    state.vadChunks = [];
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function(stream) {
        state.vadStream = stream;
        var ctx = initAudioContext();
        if (!ctx) return;

        var source = ctx.createMediaStreamSource(stream);
        var analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        var dataArray = new Uint8Array(analyser.frequencyBinCount);

        var isSpeaking = false;
        var silenceStart = 0;
        var SPEECH_THRESHOLD = 30; // 音量阈值（占位值，后续可调）

        // 用于录制当前语音片段的 recorder
        var segRecorder = null;
        var segChunks = [];

        var mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';

        function startSegment() {
          segChunks = [];
          try {
            segRecorder = new MediaRecorder(stream, { mimeType: mimeType, audioBitsPerSecond: 32000 });
            segRecorder.ondataavailable = function(e) {
              if (e.data && e.data.size > 0) segChunks.push(e.data);
            };
            segRecorder.start(100);
          } catch(e) { segRecorder = null; }
        }

        function stopSegment() {
          return new Promise(function(resolve) {
            if (!segRecorder || segRecorder.state === 'inactive') { resolve(null); return; }
            segRecorder.onstop = function() {
              resolve(segChunks.length > 0 ? new Blob(segChunks, { type: 'audio/webm' }) : null);
            };
            segRecorder.stop();
          });
        }

        function check() {
          if (!state.vadListening) {
            if (segRecorder && segRecorder.state !== 'inactive') segRecorder.stop();
            return;
          }
          if (state.micMuted || state.isAIProcessing) {
            requestAnimationFrame(check);
            return;
          }

          analyser.getByteFrequencyData(dataArray);
          var sum = 0;
          for (var i = 0; i < dataArray.length; i++) { sum += dataArray[i]; }
          var avg = sum / dataArray.length;

          if (avg > SPEECH_THRESHOLD && !isSpeaking) {
            // 开始说话
            isSpeaking = true;
            if (state.vadSilenceTimer) { clearTimeout(state.vadSilenceTimer); state.vadSilenceTimer = null; }
            startSegment();
          } else if (avg > SPEECH_THRESHOLD && isSpeaking) {
            // 持续说话中，重置静音计时
            if (state.vadSilenceTimer) { clearTimeout(state.vadSilenceTimer); state.vadSilenceTimer = null; }
          } else if (avg <= SPEECH_THRESHOLD && isSpeaking) {
            // 声音降下来了，开始计时
            if (!state.vadSilenceTimer) {
              silenceStart = Date.now();
              state.vadSilenceTimer = setTimeout(async function() {
                // 停顿超时，认为说完了一句话
                isSpeaking = false;
                state.vadSilenceTimer = null;
                var blob = await stopSegment();
                if (blob) {
                  processUserSpeech(blob);
                }
              }, state.vadSilenceThreshold);
            }
          }

          requestAnimationFrame(check);
        }

        state.vadListening = true;
        check();
      })
      .catch(function(err) {
        console.error('VAD 麦克风访问失败:', err);
        showToast('麦克风访问失败');
      });
  }

  function stopVAD() {
    state.vadListening = false;
    if (state.vadSilenceTimer) { clearTimeout(state.vadSilenceTimer); state.vadSilenceTimer = null; }
    if (state.vadStream) {
      state.vadStream.getTracks().forEach(function(t) { t.stop(); });
      state.vadStream = null;
    }
  }

  // ============ STT 语音识别（SenseVoice） ============

  var EMOTION_MAP = { HAPPY:'开心', SAD:'低落', ANGRY:'生气', FEARFUL:'紧张', DISGUSTED:'反感', SURPRISED:'惊讶' };

  async function speechToText(audioBlob) {
    try {
      var form = new FormData();
      form.append('audio', audioBlob, 'recording.webm');
      var resp = await fetch('/api/stt', { method: 'POST', body: form });
      if (!resp.ok) throw new Error('STT 请求失败');
      var data = await resp.json();
      var text = data.text || '';
      var emotion = data.emotion || null;
      // 有情绪时加标签
      if (emotion && text) {
        text = '[用户语气：' + emotion + '] ' + text;
      }
      return text;
    } catch (err) {
      console.error('[voiceCall] STT 识别失败，使用占位:', err.message);
      return '（语音消息）';
    }
  }

  // ============ AI 对话（真实API调用） ============

  // AI 回复通过 WebSocket（call_message → call_response_chunk → call_response_end）
  // 不再需要 HTTP getAIResponse。后端 websocket.js 处理 AI 调用和 TTS。

  // ============ TTS 播放（可中断） ============

  function stopCurrentTTS() {
    if (state.currentTtsAudio) {
      try { state.currentTtsAudio.pause(); } catch (_) {}
      if (state.currentTtsAudio.src) {
        URL.revokeObjectURL(state.currentTtsAudio.src);
      }
      state.currentTtsAudio = null;
    }
  }

  async function playTTS(text) {
    stopCurrentTTS();
    if (!window.ttsService || !window.ttsService.textToSpeech) {
      console.warn('ttsService 未加载，跳过 TTS');
      return;
    }
    try {
      var blob = await window.ttsService.textToSpeech(text);
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      state.currentTtsAudio = audio;
      return new Promise(function(resolve) {
        audio.onended = function() {
          URL.revokeObjectURL(url);
          if (state.currentTtsAudio === audio) state.currentTtsAudio = null;
          resolve();
        };
        audio.onerror = function() {
          URL.revokeObjectURL(url);
          if (state.currentTtsAudio === audio) state.currentTtsAudio = null;
          resolve();
        };
        audio.play().catch(function() {
          if (state.currentTtsAudio === audio) state.currentTtsAudio = null;
          resolve();
        });
      });
    } catch (err) {
      console.error('TTS 播放失败:', err.message);
    }
  }

  // ============ AI 说话动画 ============
  function setAISpeaking(speaking) {
    if (speaking) {
      dom.avatarRipple.classList.add('active');
    } else {
      dom.avatarRipple.classList.remove('active');
    }
  }

  // ============ 处理用户语音（VAD 触发） ============
  async function processUserSpeech(audioBlob) {
    if (state.isAIProcessing || state.isTextProcessing) return;
    state.isAIProcessing = true;

    // 1. STT：语音转文字（占位，待接入STT接口）
    var userText = await speechToText(audioBlob);

    // 2. 显示用户语音文字
    addCallBubble(userText, 'user');

    // 打断当前 AI 回复（如果有）
    stopCurrentTTS();
    if (state.isAIResponding) {
      window.wsClient.send({ type: 'call_interrupt' });
      state.isAIResponding = false;
    }

    // 3. 通过 WebSocket 发送（AI + TTS 由后端处理，流式返回）
    setAISpeaking(true);
    var sent = window.wsClient.send({ type: 'call_message', text: userText, session_id:String(state.callStartTime),turn_id:crypto.randomUUID() });
    if (!sent) {
      addCallBubble('（连接中断，请稍后重试）', 'ai');
      setAISpeaking(false);
      state.isAIProcessing = false;
      return;
    }
    // call_response_end 中完成后续处理（setAISpeaking(false), 存对话轮次）
  }

  // ============ 文字输入功能 ============

  function addCallBubble(text, role) {
    var div = document.createElement('div');
    div.className = 'vc-call-bubble ' + role;
    div.textContent = text;
    dom.callMessages.appendChild(div);
    // 自动滚动到底部
    dom.callMessages.scrollTop = dom.callMessages.scrollHeight;
    // 有消息时缩小头像
    updateAvatarCompact();
  }

  function clearCallMessages() {
    dom.callMessages.innerHTML = '';
    updateAvatarCompact();
  }

  function updateAvatarCompact() {
    var hasMessages = dom.callMessages.children.length > 0;
    if (hasMessages) {
      dom.avatarArea.classList.add('compact');
      dom.callContent.classList.add('has-messages');
    } else {
      dom.avatarArea.classList.remove('compact');
      dom.callContent.classList.remove('has-messages');
    }
  }

  function toggleTextInput(show) {
    if (show === undefined) show = !state.textInputExpanded;
    state.textInputExpanded = show;
    if (show) {
      dom.textInputRow.classList.add('expanded');
      dom.keyboardBtn.classList.add('active');
      dom.textInput.focus();
    } else {
      dom.textInputRow.classList.remove('expanded');
      dom.keyboardBtn.classList.remove('active');
      dom.textInput.blur();
    }
  }

  async function sendTextMessage() {
    var text = dom.textInput.value.trim();
    if (!text || state.isTextProcessing || state.isAIProcessing) return;

    // 打断当前 AI 回复
    stopCurrentTTS();
    setAISpeaking(false);

    // 如果 AI 正在回复中，先发 interrupt
    if (state.isAIResponding) {
      window.wsClient.send({ type: 'call_interrupt' });
      state.isAIResponding = false;
    }

    state.isTextProcessing = true;
    dom.sendTextBtn.disabled = true;

    // 显示用户消息
    addCallBubble(text, 'user');
    dom.textInput.value = '';

    // 通过 WebSocket 发送给后端（AI + TTS 由后端处理）
    var sent = window.wsClient.send({ type: 'call_message', text: text, session_id:String(state.callStartTime),turn_id:crypto.randomUUID() });
    if (!sent) {
      addCallBubble('（连接中断，请稍后重试）', 'ai');
      state.isTextProcessing = false;
      dom.sendTextBtn.disabled = false;
      return;
    }

    // 后续：call_response_start → call_response_chunk 流式更新 → call_response_end 完成

    state.isTextProcessing = false;
    dom.sendTextBtn.disabled = false;
    if (state.textInputExpanded) dom.textInput.focus();
  }

  // ============ 麦克风静音 ============
  function setMicMuted(muted) {
    state.micMuted = muted;
    if (muted) {
      dom.micBtn.classList.add('muted');
      dom.micBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    } else {
      dom.micBtn.classList.remove('muted');
      dom.micBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
    }
  }

  // ============ 来电功能 ============

  /**
   * 触发AI来电（框架预留，后续AI通过Function Calling调用）
   * @param {string} firstMessage AI想说的第一句话
   */
  window.triggerIncomingCall = async function(firstMessage) {
    await loadPersona();
    state.isIncoming = true;
    state.incomingFirstMessage = firstMessage || '';

    // 设置来电界面头像和名字
    if (state.aiAvatarPath) {
      dom.incomingAvatarImg.src = state.aiAvatarPath;
      dom.incomingAvatarImg.style.display = '';
      dom.incomingAvatarPlaceholder.style.display = 'none';
    } else {
      dom.incomingAvatarImg.style.display = 'none';
      dom.incomingAvatarPlaceholder.style.display = '';
    }
    dom.incomingName.textContent = state.aiName;
    dom.incomingScreen.classList.add('active');
  };

  function closeIncomingScreen() {
    dom.incomingScreen.classList.remove('active');
  }

  async function acceptIncomingCall() {
    closeIncomingScreen();
    // 直接进入通话界面
    showView('call');
    showCallPhase('in-call');
    state.conversationRounds = [];
    state.micMuted = false;
    state.isAIProcessing = false;
    state.isTextProcessing = false;
    setMicMuted(false);
    toggleTextInput(false);
    clearCallMessages();
    applyPersona();
    ['rain', 'ocean', 'wind'].forEach(function(type) { loadNoiseAudio(type); });
    if (state.isRecording) startFullRecording();
    startTimer();

    // 通知后端已接听
    window.wsClient.send({ type: 'call_accept' });

    // AI先说第一句话
    if (state.incomingFirstMessage) {
      setAISpeaking(true);
      var isVoice = /^\[voice\]\s*/i.test(state.incomingFirstMessage);
      var cleanText = isVoice ? state.incomingFirstMessage.replace(/^\[voice\]\s*/i, '') : state.incomingFirstMessage;
      addCallBubble(cleanText, 'ai');
      await playTTS(cleanText);
      setAISpeaking(false);
      // 保存AI的第一句话到对话记录
      state.conversationRounds.push({ user: '', ai: cleanText });
    }

    // 启动VAD，开始正常对话
    if (!state.micMuted) startVAD();
  }

  function rejectIncomingCall() {
    closeIncomingScreen();
    state.isIncoming = false;
    // 通过 WS 通知后端已拒接
    window.wsClient.send({ type: 'call_reject' });
    // 在聊天中插入未接来电气泡
    insertCallBubble('', true);
    showToast('已拒绝来电');
  }

  // ============ 上传 & 保存 ============

  // WS 通话模式下无录音文件，直接保存记录
  async function saveCallRecordNoUpload(audioPath) {
    try {
      await fetch('/api/voice-call/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: new Date(state.callStartTime || Date.now()).toISOString(),
          duration_seconds: state.elapsedSeconds || 0,
          audio_path: audioPath || '',
        }),
      });
    } catch (err) { console.error('保存通话记录失败:', err); }
  }
  async function uploadRecording(blob) {
    if (!blob) return '';
    var formData = new FormData();
    formData.append('recording', blob, 'call_recording.webm');
    try {
      var resp = await fetch('/api/voice-call/upload-recording', { method: 'POST', body: formData });
      var data = await resp.json();
      return data.path || '';
    } catch (err) {
      console.error('录音上传失败:', err);
      showToast('录音上传失败');
      return '';
    }
  }

  async function saveCallRecord(audioPath) {
    try {
      await fetch('/api/voice-call/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: new Date(state.callStartTime).toISOString(),
          duration_seconds: state.elapsedSeconds,
          audio_path: audioPath,
        }),
      });
    } catch (err) { console.error('保存通话记录失败:', err); }
  }

  async function insertCallBubble(audioPath, missed) {
    try {
      await fetch('/api/voice-call/call-bubble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: new Date((state.callStartTime || Date.now())).toISOString(),
          duration_seconds: state.elapsedSeconds || 0,
          audio_path: audioPath || '',
          incoming: state.isIncoming,
          missed: !!missed,
        }),
      });
    } catch (err) { console.error('插入通话气泡失败:', err); }
  }

  async function saveCallTranscript() {
    if (state.conversationRounds.length === 0) return;
    try {
      await fetch('/api/voice-call/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: new Date(state.callStartTime).toISOString(),
          duration_seconds: state.elapsedSeconds,
          rounds: state.conversationRounds,
          session_id: String(state.callStartTime),
        }),
      });
    } catch (err) { console.error('保存通话文字记录失败:', err); }
  }

  // ============ 挂断 ============
  async function hangup() {
    stopTimer();
    if (state.dialTimer) { clearTimeout(state.dialTimer); state.dialTimer = null; }
    stopAllNoise();
    stopVAD();
    stopCurrentTTS();
    setAISpeaking(false);
    state.isAIResponding = false;
    toggleTextInput(false);
    clearCallMessages();

    // 通知后端通话已结束
    window.wsClient.send({ type: 'call_end' });

    var audioBlob = null;
    if (state.isRecording) {
      audioBlob = await stopFullRecording();
    } else {
      await stopFullRecording();
    }

    var audioPath = '';
    if (audioBlob) audioPath = await uploadRecording(audioBlob);

    await saveCallRecord(audioPath);
    await saveCallTranscript();
    await insertCallBubble(audioPath, false);

    state.isIncoming = false;
    state.incomingFirstMessage = '';

    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
    }
    state.noisePlayers = {};
    state.conversationRounds = [];

    showView('history');
    loadHistory();
  }

  // ============ 通话流程 ============
  async function startCall() {
    showView('call');
    showCallPhase('dial');
    state.conversationRounds = [];
    state.micMuted = false;
    state.isAIProcessing = false;
    state.isTextProcessing = false;
    state.isIncoming = false;
    state.incomingFirstMessage = '';
    setMicMuted(false);
    toggleTextInput(false);
    clearCallMessages();

    // 加载角色信息
    await loadPersona();
    applyPersona();

    // 预加载白噪音
    ['rain', 'ocean', 'wind'].forEach(function(type) { loadNoiseAudio(type); });

    // 启动全程录音
    if (state.isRecording) startFullRecording();

    // 通过 WebSocket 发起通话（后端回复 call_connected 后进入通话）
    var sent = window.wsClient.send({ type: 'call_start' });
    if (!sent) {
      showToast('连接中断，请刷新页面后重试');
      cancelCall();
    }
  }

  function cancelCall() {
    if (state.dialTimer) { clearTimeout(state.dialTimer); state.dialTimer = null; }
    stopVAD();
    stopCurrentTTS();
    setAISpeaking(false);
    toggleTextInput(false);
    clearCallMessages();
    window.wsClient.send({ type: 'call_end' });
    stopFullRecording().then(function() {
      stopAllNoise();
      if (state.audioContext) { state.audioContext.close(); state.audioContext = null; }
      state.noisePlayers = {};
      state.conversationRounds = [];
      showView('history');
    });
  }

  // ============ 通话历史 ============
  function formatDuration(secs) {
    if (!secs || secs === 0) return '0秒';
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    if (m > 0) return m + '分' + s + '秒';
    return s + '秒';
  }

  function formatDateTime(isoStr) {
    var d = new Date(isoStr);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  async function loadHistory() {
    try {
      var resp = await fetch('/api/voice-call/history');
      var data = await resp.json();
      renderHistory(data.calls || []);
    } catch (err) {
      console.error('加载通话记录失败:', err);
      renderHistory([]);
    }
  }

  function renderHistory(calls) {
    if (calls.length === 0) {
      dom.empty.style.display = '';
      dom.historyContainer.innerHTML = '';
      dom.historyContainer.appendChild(dom.empty);
      return;
    }
    dom.empty.style.display = 'none';
    var html = '<div class="vc-timeline">';
    calls.forEach(function(call) {
      var hasAudio = call.audio_path && call.audio_path.trim();
      html += '<div class="vc-record" data-id="' + call.id + '">';
      html += '<div class="vc-record-header">';
      html += '<div class="vc-record-info">';
      html += '<span class="vc-record-time">' + formatDateTime(call.started_at) + '</span>';
      html += '<button class="vc-delete-btn" data-action="delete">删除</button>';
      html += '</div>';
      html += '<div class="vc-record-right">';
      html += '<span class="vc-record-duration">' + formatDuration(call.duration_seconds) + '</span>';
      if (hasAudio) {
        html += '<button class="vc-play-btn" data-action="play" data-path="' + call.audio_path + '">';
        html += '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21"></polygon></svg>';
        html += '</button>';
      } else {
        html += '<span style="font-size:11px;color:var(--color-text-muted);opacity:0.5;">未录音</span>';
      }
      html += '</div>';
      html += '</div>';
      html += '<div class="vc-audio-player" data-player="true"><audio controls preload="none" src="' + (hasAudio ? call.audio_path : '') + '"></audio></div>';
      html += '</div>';
    });
    html += '</div>';
    dom.historyContainer.innerHTML = html;
    bindHistoryEvents();
  }

  function bindHistoryEvents() {
    dom.historyContainer.querySelectorAll('.vc-play-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var record = btn.closest('.vc-record');
        var player = record.querySelector('[data-player]');
        var audio = player.querySelector('audio');
        var isShowing = player.classList.contains('show');
        dom.historyContainer.querySelectorAll('.vc-audio-player.show').forEach(function(p) {
          var a = p.querySelector('audio');
          if (a && a !== audio) { a.pause(); }
          p.classList.remove('show');
        });
        if (!isShowing) {
          player.classList.add('show');
          audio.play().catch(function() {});
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        } else {
          audio.pause();
          player.classList.remove('show');
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21"></polygon></svg>';
        }
      });
    });
    dom.historyContainer.querySelectorAll('[data-player] audio').forEach(function(audio) {
      audio.addEventListener('ended', function() {
        var player = audio.closest('[data-player]');
        player.classList.remove('show');
        var btn = player.closest('.vc-record').querySelector('.vc-play-btn');
        if (btn) {
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21"></polygon></svg>';
        }
      });
    });
    dom.historyContainer.querySelectorAll('.vc-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.closest('.vc-record').dataset.id;
        if (confirm('确定删除这条通话记录吗？')) {
          fetch('/api/voice-call/history/' + id, { method: 'DELETE' })
            .then(function() { loadHistory(); })
            .catch(function(err) { console.error('删除失败:', err); showToast('删除失败'); });
        }
      });
    });
  }

  // ============ 事件绑定 ============
  function bindEvents() {
    if (dom.dialBtn) dom.dialBtn.addEventListener('click', startCall);
    dom.cancelDial.addEventListener('click', cancelCall);
    dom.hangup.addEventListener('click', hangup);
    dom.acceptBtn.addEventListener('click', acceptIncomingCall);
    dom.rejectBtn.addEventListener('click', rejectIncomingCall);

    // 麦克风静音开关
    dom.micBtn.addEventListener('click', function() {
      state.micMuted = !state.micMuted;
      setMicMuted(state.micMuted);
      if (state.micMuted) {
        showToast('麦克风已静音');
      } else {
        showToast('麦克风已开启');
        // 重新启动 VAD
        if (state.callPhase === 'in-call' && !state.vadListening) {
          startVAD();
        }
      }
    });

    // 键盘按钮：展开/收起文字输入
    dom.keyboardBtn.addEventListener('click', function() {
      toggleTextInput(!state.textInputExpanded);
    });

    // 收起按钮
    dom.collapseInputBtn.addEventListener('click', function() {
      toggleTextInput(false);
    });

    // 发送按钮
    dom.sendTextBtn.addEventListener('click', function() {
      sendTextMessage();
    });

    // 回车发送
    dom.textInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextMessage();
      }
    });

    // 白噪音面板
    setupNoisePanel();
    setupNoiseToggles();

    // URL hash #dial 自动触发拨号
    if (window.location.hash === '#dial') {
      history.replaceState(null, '', window.location.pathname);
      setTimeout(startCall, 300);
    }

    // URL hash #incoming=... 自动触发来电
    if (window.location.hash.startsWith('#incoming=')) {
      var msg = decodeURIComponent(window.location.hash.slice('#incoming='.length));
      history.replaceState(null, '', window.location.pathname);
      setTimeout(function() { window.triggerIncomingCall(msg); }, 300);
    }

    // ========== WebSocket 消息处理 ==========

    // 来电通知
    window.wsClient.on('incoming_call', function(msg) {
      window.triggerIncomingCall(msg.firstMessage || '');
    });

    // 通话已建立
    window.wsClient.on('call_connected', function() {
      if (state.callPhase === 'dial') {
        showCallPhase('in-call');
        startTimer();
        if (!state.micMuted) startVAD();
      }
    });

    // AI 开始回复
    window.wsClient.on('call_response_start', function() {
      state.isAIResponding = true;
    });

    // 流式 AI 回复
    var streamBubble = null;
    window.wsClient.on('call_response_chunk', function(msg) {
      if (!streamBubble) {
        setAISpeaking(true);
        state.isAIResponding = true;
        streamBubble = document.createElement('div');
        streamBubble.className = 'vc-call-bubble ai';
        dom.callMessages.appendChild(streamBubble);
      }
      streamBubble.textContent = (streamBubble.textContent || '') + msg.text;
      dom.callMessages.scrollTop = dom.callMessages.scrollHeight;
      updateAvatarCompact();
    });

    // AI 回复完成
    window.wsClient.on('call_response_end', function(msg) {
      setAISpeaking(false);
      state.isAIResponding = false;
      var fullText = msg.fullText || '';

      // 有流式气泡则更新为最终文本，否则新建
      if (streamBubble) {
        streamBubble.textContent = fullText;
        streamBubble = null;
      } else if (fullText) {
        addCallBubble(fullText, 'ai');
      }

      // 播放 TTS（被中断且无内容时跳过）
      if (msg.audioUrl) {
        stopCurrentTTS();
        var audio = new Audio(msg.audioUrl);
        state.currentTtsAudio = audio;
        audio.play().catch(function() {
          if (state.currentTtsAudio === audio) state.currentTtsAudio = null;
        });
        audio.onended = function() {
          if (state.currentTtsAudio === audio) state.currentTtsAudio = null;
        };
      }

      // 暂存对话轮次（从用户消息气泡里取最后一条，空内容跳过）
      if (fullText.trim()) {
        var userBubbles = dom.callMessages.querySelectorAll('.vc-call-bubble.user');
        var lastUserText = userBubbles.length > 0 ? userBubbles[userBubbles.length - 1].textContent : '';
        state.conversationRounds.push({
          user: lastUserText,
          ai: fullText,
        });
      }

      state.isAIProcessing = false;
      state.isTextProcessing = false;
      dom.sendTextBtn.disabled = false;
    });

    // 通话结束
    window.wsClient.on('call_ended', function(msg) {
      if (state.callPhase !== 'in-call') return;
      stopTimer();
      stopAllNoise();
      stopVAD();
      stopCurrentTTS();
      setAISpeaking(false);
      state.isAIResponding = false;
      streamBubble = null;

      // 保存通话记录（无录音的简版，WS 通话没有全程录音）
      var audioPath = '';
      var now = Date.now();
      saveCallRecordNoUpload(audioPath);
      saveCallTranscript();
      insertCallBubble(audioPath, msg.reason === 'rejected');

      state.isIncoming = false;
      state.incomingFirstMessage = '';

      if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
      }
      state.noisePlayers = {};
      state.conversationRounds = [];

      showView('history');
      loadHistory();
    });

    // 页面卸载前清理
    window.addEventListener('beforeunload', function() {
      stopTimer();
      stopAllNoise();
      stopVAD();
      stopCurrentTTS();
      if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
      if (state.audioContext) state.audioContext.close();
    });
  }

  // ============ 初始化 ============
  function init() {
    loadHistory();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
