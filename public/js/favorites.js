// js/favorites.js — 收藏页面逻辑

// ========== 工具函数 ==========
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

// ========== 语音播放状态 ==========
var currentAudio = null;
var currentPlayBtn = null;

function toggleVoicePlayback(audioUrl, playBtn, playerEl) {
  // 如果正在播放同一个音频 → 暂停
  if (currentAudio && !currentAudio.paused && currentPlayBtn === playBtn) {
    currentAudio.pause();
    currentAudio = null;
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    if (playerEl) playerEl.classList.remove('playing');
    currentPlayBtn = null;
    return;
  }

  // 停止之前的音频
  if (currentAudio) {
    currentAudio.pause();
    if (currentPlayBtn) {
      currentPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    }
    if (playerEl) playerEl.classList.remove('playing');
    currentAudio = null;
  }

  if (!audioUrl) return;

  var audio = new Audio(audioUrl);
  currentAudio = audio;
  currentPlayBtn = playBtn;

  playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  if (playerEl) playerEl.classList.add('playing');

  audio.onended = function() {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    if (playerEl) playerEl.classList.remove('playing');
    currentAudio = null;
    currentPlayBtn = null;
  };

  audio.onerror = function() {
    showToast('播放失败');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    if (playerEl) playerEl.classList.remove('playing');
    currentAudio = null;
    currentPlayBtn = null;
  };

  audio.play().catch(function() {
    showToast('播放失败');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    if (playerEl) playerEl.classList.remove('playing');
    currentAudio = null;
    currentPlayBtn = null;
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ========== 状态 ==========
var allFavorites = [];
var activeTag = '';

// ========== 加载收藏列表 ==========
async function loadFavorites(tag) {
  try {
    var url = tag ? '/api/favorites?tag=' + encodeURIComponent(tag) : '/api/favorites';
    var res = await fetch(url);
    var data = await res.json();
    allFavorites = data.items || [];
    renderFavorites();
  } catch (err) {
    showToast('加载收藏失败');
  }
}

// ========== 渲染收藏列表 ==========
function renderFavorites() {
  var container = document.getElementById('fav-list');
  if (allFavorites.length === 0) {
    container.innerHTML = '<div class="fav-empty">还没有收藏的消息<br>在聊天中右键或长按消息可以收藏</div>';
    return;
  }
  container.innerHTML = allFavorites.map(function(f) { return renderFavCard(f); }).join('');
  attachCardEvents();
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '0″';
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m > 0 ? m + ':' + String(s).padStart(2, '0') : s + '″';
}

function formatTime(dateStr) {
  var d = new Date(dateStr);
  var now = new Date();
  var pad2 = function(n) { return String(n).padStart(2, '0'); };
  var timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  if (d.toDateString() === now.toDateString()) return '今天 ' + timeStr;
  var yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + timeStr;
  if (d.getFullYear() === now.getFullYear())
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
}

function renderFavCard(f) {
  var timeStr = formatTime(f.created_at);
  var sender = f.role === 'user' ? '我' : 'AI';
  var senderClass = f.role === 'user' ? 'user' : 'ai';
  var tagHtml = f.tag ? '<span class="fav-card-tag">' + escapeHtml(f.tag) + '</span>' : '';

  var contentHtml = '';
  if (f.type === 'image') {
    contentHtml = f.image_path
      ? '<div class="fav-card-image"><img src="' + escapeHtml(f.image_path) + '" loading="lazy" alt="图片" /></div>'
      : '<div class="fav-card-image placeholder">图片</div>';
  } else if (f.type === 'voice') {
    var voiceLabel = f.duration ? formatDuration(f.duration) : '语音消息';
    var voiceHtml = '';
    if (f.voice_path) {
      voiceHtml = '<span class="fav-voice-player" data-audio-url="' + escapeHtml(f.voice_path) + '">' +
        '<button class="voice-play-btn fav-voice-play-btn" title="播放">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>' +
        '</button>' +
        '<span class="fav-voice-label">' + escapeHtml(voiceLabel) + '</span>' +
      '</span>';
    } else {
      voiceHtml = '<span class="fav-voice-player no-audio"><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>' + escapeHtml(voiceLabel) + '</span></span>';
    }
    contentHtml = '<div class="fav-card-voice">' +
      voiceHtml +
      (f.transcript ? '<div class="fav-voice-transcript">' + escapeHtml(f.transcript) + '</div>' : '') +
      '</div>';
  } else {
    contentHtml = '<div class="fav-card-text">' + escapeHtml(f.content || '') + '</div>';
  }

  return '<div class="settings-card fav-card" data-id="' + f.id + '" data-msg-id="' + f.message_id + '">' +
    contentHtml +
    '<div class="fav-card-meta">' +
      '<span class="fav-card-sender ' + senderClass + '">' + sender + '</span>' +
      '<span class="fav-card-time">' + timeStr + '</span>' +
      tagHtml +
    '</div>' +
    '<div class="fav-card-actions">' +
      '<button class="btn-ghost btn-ghost-sm fav-unfav-btn" data-id="' + f.id + '">取消收藏</button>' +
      '<button class="btn-ghost btn-ghost-sm fav-edit-tag-btn" data-id="' + f.id + '">修改标签</button>' +
    '</div>' +
  '</div>';
}

// ========== 卡片事件 ==========
function attachCardEvents() {
  // 取消收藏
  document.querySelectorAll('.fav-unfav-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = btn.dataset.id;
      try {
        await fetch('/api/favorites/' + id, { method: 'DELETE' });
        showToast('已取消收藏');
        loadFavorites(activeTag);
        loadTags();
      } catch (err) {
        showToast('取消收藏失败');
      }
    });
  });

  // 修改标签
  document.querySelectorAll('.fav-edit-tag-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openTagEditModal(btn.dataset.id);
    });
  });

  // 语音播放
  document.querySelectorAll('.fav-voice-play-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var player = btn.closest('.fav-voice-player');
      var audioUrl = player ? player.dataset.audioUrl : '';
      if (!audioUrl) return;
      toggleVoicePlayback(audioUrl, btn, player);
    });
  });

  // 点击卡片跳转聊天定位
  document.querySelectorAll('.fav-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var msgId = card.dataset.msgId;
      window.location.href = 'index.html#msg-' + msgId;
    });
  });
}

// ========== 标签筛选栏 ==========
function loadTags() {
  fetch('/api/favorites/tags')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var bar = document.getElementById('fav-tag-bar');
      var tags = data.tags || [];
      var tagButtons = tags.map(function(t) {
        return '<button class="fav-tag-filter" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
      }).join('');
      bar.innerHTML = '<button class="fav-tag-filter active" data-tag="">全部</button>' + tagButtons;

      bar.querySelectorAll('.fav-tag-filter').forEach(function(btn) {
        btn.addEventListener('click', function() {
          bar.querySelectorAll('.fav-tag-filter').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          activeTag = btn.dataset.tag;
          loadFavorites(activeTag);
        });
      });
    })
    .catch(function() { /* 非关键 */ });
}

// ========== 修改标签弹窗 ==========
function openTagEditModal(favId) {
  var fav = null;
  for (var i = 0; i < allFavorites.length; i++) {
    if (String(allFavorites[i].id) === String(favId)) { fav = allFavorites[i]; break; }
  }
  if (!fav) return;

  var modal = document.getElementById('fav-tag-modal');
  var input = document.getElementById('fav-tag-modal-input');
  input.value = fav.tag || '';
  modal.style.display = 'flex';

  function save() {
    var newTag = input.value.trim();
    fetch('/api/favorites/' + favId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: newTag || null }),
    }).then(function() {
      modal.style.display = 'none';
      showToast('标签已更新');
      loadFavorites(activeTag);
      loadTags();
    }).catch(function() {
      showToast('更新标签失败');
    });
  }

  function close() { modal.style.display = 'none'; }

  document.getElementById('fav-tag-modal-save').onclick = save;
  document.getElementById('fav-tag-modal-cancel').onclick = close;
  modal.onclick = function(e) { if (e.target === modal) close(); };
  input.onkeydown = function(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') close();
  };
  input.focus();
}

// ========== 初始化 ==========
loadTags();
loadFavorites('');
