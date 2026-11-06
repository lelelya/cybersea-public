// js/bgm-player.js
// 深海唱片机：右下角黑胶唱片 + BGM 播放控制
// 页面切换时从 sessionStorage 恢复，<head> 中同步执行使间隙最小化
(function () {
  function _bgmToast(msg) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 300); }, 2500);
}

var BGM_PATH = 'audio/bgm.mp3';
  var STORAGE_KEY = 'cybersea_bgm';
  var audio = null;
  var disc = null;
  var playing = false;

  // ==== 第一步：同步恢复音频（在 DOM 构建之前） ====

  var saved = null;
  var wasPlaying = false;
  try {
    var raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) { saved = JSON.parse(raw); wasPlaying = !!(saved && saved.playing); }
  } catch (_) {}

  audio = new Audio();
  audio.preload = 'none';
  audio.src = BGM_PATH;
  audio.loop = true;
  audio.volume = (saved && saved.volume) ? saved.volume : 0.35;
  if (saved && saved.time) {
    try { audio.currentTime = saved.time; } catch (_) {}
  }

  if (saved && saved.playing) {
    // 尝试自动恢复（桌面端可能成功，移动端会被浏览器拦截）
    audio.play().then(function () {
      playing = true;
    }).catch(function () {
      playing = false;
      // 移动端被拦截：在用户首次点击页面时恢复播放
      var resumeOnce = function () {
        if (playing) { document.removeEventListener('click', resumeOnce); return; }
        audio.play().then(function () {
          playing = true;
          if (disc) disc.classList.add('spinning');
        }).catch(function () {});
        document.removeEventListener('click', resumeOnce);
      };
      document.addEventListener('click', resumeOnce, { once: false });
    });
  }

  // 定时保存进度
  setInterval(function () {
    if (!playing) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        playing: true,
        time: audio.currentTime || 0,
        volume: audio.volume,
      }));
    } catch (_) {}
  }, 500);

  // 页面离开时保存
  window.addEventListener('beforeunload', function () {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        playing: playing,
        time: audio.currentTime || 0,
        volume: audio.volume,
      }));
    } catch (_) {}
  });

  window.addEventListener('pagehide', function () {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        playing: playing,
        time: audio.currentTime || 0,
        volume: audio.volume,
      }));
    } catch (_) {}
  });

  // ==== 第二步：DOM 就绪后创建唱片 UI ====

  function createDisc() {
    if (disc) return;
    disc = document.createElement('div');
    disc.id = 'vinyl-disc';
    disc.title = '点击播放 / 暂停 BGM';
    disc.innerHTML = '<div class="vinyl-label"></div>';
    document.body.appendChild(disc);

    if (playing || wasPlaying) disc.classList.add('spinning');

    disc.addEventListener('click', function () {
      if (playing) {
        audio.pause();
        playing = false;
        disc.classList.remove('spinning');
      } else {
        audio.play().then(function () {
          playing = true;
          disc.classList.add('spinning');
        }).catch(function (err) {
          console.error('[BGM] 播放失败:', err.message);
          _bgmToast('请将自备音乐放入 public/audio/bgm.mp3');
        });
      }
    });
  }

  // 更新唱片旋转状态
  audio.addEventListener('play', function () {
    playing = true;
    if (disc) disc.classList.add('spinning');
  });
  audio.addEventListener('pause', function () {
    playing = false;
    if (disc) disc.classList.remove('spinning');
  });
  audio.addEventListener('ended', function () {
    playing = false;
    if (disc) disc.classList.remove('spinning');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDisc);
  } else {
    createDisc();
  }
})();
