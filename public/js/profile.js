// js/profile.js — 个人主页：inline编辑 + 动态详情 + 头像上传
var params = new URLSearchParams(window.location.search);
var owner = params.get('owner') === 'ai' ? 'ai' : 'user';
var currentProfile = { nickname: '', signature: '' };
var currentAvatarPath = '';

function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ========== 内联编辑辅助 ==========
function makeEditable(el, field) {
  el.addEventListener('click', function() {
    if (el.querySelector('input')) return;
    var input = document.createElement('input');
    input.className = 'profile-inline-input';
    input.value = currentProfile[field] || '';
    input.placeholder = field === 'nickname' ? '昵称' : '签名';
    input.style.fontSize = field === 'nickname' ? '17px' : '13px';
    input.style.fontWeight = field === 'nickname' ? '600' : '400';
    input.style.color = field === 'nickname' ? 'var(--color-text)' : 'rgba(234,241,255,0.55)';
    input.style.width = Math.max(el.offsetWidth, 100) + 'px';
    el.textContent = '';
    el.appendChild(input);
    input.focus();

    async function save() {
      var val = input.value.trim();
      var oldVal = currentProfile[field];
      input.remove();
      currentProfile[field] = val;
      el.textContent = val || (field === 'nickname' ? '（未设置昵称）' : '（还没有个性签名）');

      await fetch('/api/social/profile/' + owner, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: field === 'nickname' ? val : currentProfile.nickname,
          signature: field === 'signature' ? val : currentProfile.signature,
        }),
      });

      // 用户修改自己的资料时通知AI
      if (owner === 'user' && val && val !== oldVal) {
        var label = field === 'nickname' ? '昵称' : '个性签名';
        await fetch('/api/messages/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '[系统通知] 用户修改了自己的' + label + '为「' + val + '」' }),
        });
      }
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  });
}

// ========== 加载主页 ==========
async function load() {
  // 1. 先设置头像（在 fetch 前，确保立即可见可点）
  var avatar = document.getElementById('profile-avatar');
  var avatarContainer = document.getElementById('profile-avatar-container');
  if (avatar && !avatarContainer) {
    var label = document.createElement('label');
    label.id = 'profile-avatar-container';
    label.style.cssText = 'cursor:pointer;flex-shrink:0;';
    label.title = '点击更换头像';
    avatar.parentNode.insertBefore(label, avatar);
    label.appendChild(avatar);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.id = 'profile-avatar-input';
    fileInput.style.display = 'none';
    label.appendChild(fileInput);

    fileInput.addEventListener('change', async function() {
      var file = fileInput.files[0];
      if (!file) return;
      try {
        var fd = new FormData();
        fd.append('file', file);
        var uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
        var uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || '上传失败');
        var payload = {};
        if (owner === 'user') payload.user_avatar_path = uploadData.path;
        else payload.ai_avatar_path = uploadData.path;
        await fetch('/api/persona', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        currentAvatarPath = uploadData.path;
        refreshAvatar(uploadData.path);
        showToast('头像已更新');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  // 2. 加载数据
  try {
    var results = await Promise.all([
      fetch('/api/persona').then(function(r) { return r.json(); }),
      fetch('/api/social/profile/' + owner).then(function(r) { return r.json(); }),
      fetch('/api/moments?owner=' + owner).then(function(r) { return r.json(); }),
    ]);

    var persona = results[0];
    var social = results[1];
    var momentsData = results[2];

    var avatarPath = owner === 'user' ? persona.user_avatar_path : persona.ai_avatar_path;
    currentAvatarPath = avatarPath || '';
    var fallbackName = owner === 'user' ? (persona.user_name || '我') : (persona.ai_name || 'AI');
    var profile = social.profile || {};
    currentProfile.nickname = profile.nickname || fallbackName;
    currentProfile.signature = profile.signature || '';

    // 顶部标题
    var titleEl = document.querySelector('.topbar .title');
    if (titleEl) titleEl.textContent = owner === 'user' ? '我的主页' : '他的主页';

    // 昵称
    var nameEl = document.getElementById('profile-name');
    nameEl.textContent = currentProfile.nickname || '（未设置昵称）';
    nameEl.style.cssText = 'font-size:17px;font-weight:600;padding-top:8px;';
    makeEditable(nameEl, 'nickname');

    // 签名
    var bioEl = document.getElementById('profile-bio-display');
    bioEl.textContent = currentProfile.signature || '（还没有个性签名）';
    bioEl.style.cssText = 'font-size:13px;color:rgba(234,241,255,0.55);padding-top:2px;';
    makeEditable(bioEl, 'signature');

    document.getElementById('profile-bio-edit').style.display = 'none';

    // 3. 更新头像内容（根据加载到的数据）
    var name = currentProfile.nickname || 'AI';
    var av = document.getElementById('profile-avatar');
    if (av && avatarPath) {
      var img = document.createElement('img');
      img.id = 'profile-avatar';
      img.className = 'avatar';
      img.style.cssText = 'width:64px;height:64px;';
      img.src = avatarPath;
      av.replaceWith(img);
    } else if (av && !avatarPath) {
      av.style.background = typeof avatarFallbackColor === 'function' ? avatarFallbackColor(name) : 'var(--color-primary)';
      av.textContent = name.charAt(0);
    }

    // 动态
    renderMoments(momentsData.moments || [], currentProfile.nickname);
  } catch (err) {
    console.error('加载主页失败:', err);
  }
}

// ========== 动态列表 ==========
function momentImagePaths(value) {
  if (!value || typeof value !== 'string') return [];
  if (!value.startsWith('[')) return [value];
  try { const paths = JSON.parse(value); return Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p) : []; }
  catch (_) { return []; }
}

function renderMoments(moments, name) {
  var list = document.getElementById('profile-moments-list');
  if (moments.length === 0) {
    list.innerHTML = '<div class="form-card" style="color:var(--color-text-muted);font-size:13px;">' + escapeHtml(name) + '还没有发过动态</div>';
    return;
  }

  // 用 DOM API 逐个创建卡片，避免 innerHTML + onclick 潜在问题
  list.innerHTML = '';
  moments.forEach(function(m) {
    var d = window.CyberSea.parseTimestamp(m.created_at);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var timeStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

    var card = document.createElement('div');
    card.className = 'form-card profile-moment-item';
    card.style.cssText = 'cursor:pointer;position:relative;z-index:1;';

    var contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'font-size:14px;line-height:1.5;';
    contentDiv.textContent = m.content;
    card.appendChild(contentDiv);

    momentImagePaths(m.image_path).forEach(function(imagePath) {
      var img = document.createElement('img');
      img.src = imagePath;
      img.alt = '';
      img.style.cssText = 'max-width:100%;border-radius:10px;margin-top:8px;display:block;';
      card.appendChild(img);
    });

    var timeDiv = document.createElement('div');
    timeDiv.style.cssText = 'font-size:11px;color:var(--color-text-muted);margin-top:8px;opacity:0.7;';
    timeDiv.textContent = timeStr;
    card.appendChild(timeDiv);

    (function(id) {
      card.addEventListener('click', function(e) {
        console.log('moment card clicked, id=' + id);
        openMomentDetail(id);
      });
    })(m.id);

    list.appendChild(card);
  });

  console.log('renderMoments done, cards:', list.querySelectorAll('.profile-moment-item').length);
}

// ========== 动态详情弹窗 ==========
var currentMomentId = null;

async function openMomentDetail(momentId) {
  currentMomentId = momentId;
  try {
    var res = await fetch('/api/moments/' + momentId);
    var data = await res.json();
    var m = data.moment;
    if (!m) return;

    var body = document.getElementById('moment-detail-body');
    var likes = m.likes || [];
    var comments = m.comments || [];

    var html = '';
    html += '<div class="moment-detail-content">' + escapeHtml(m.content) + '</div>';
    momentImagePaths(m.image_path).forEach(function(imagePath) {
      html += '<img class="moment-detail-img" src="' + escapeHtml(imagePath) + '" alt="" />';
    });
    html += '<div class="moment-detail-time">' + m.created_at + '</div>';

    // 点赞
    var hasLiked = likes.some(function(l) { return l.author === 'user'; });
    html += '<div class="moment-detail-likes">';
    html += '<span>' + likes.length + '</span> 人赞过';
    if (likes.length > 0) {
      html += ' · ' + likes.map(function(l) { return l.author === 'user' ? '你' : 'AI'; }).join('、');
    }
    html += '</div>';

    // 操作按钮
    html += '<div class="moment-detail-actions">';
    html += '<button id="detail-like-btn" class="' + (hasLiked ? 'liked' : '') + '">' + (hasLiked ? '已赞' : '点赞') + '</button>';
    html += '</div>';

    // 评论
    html += '<div class="moment-detail-comments">';
    if (comments.length === 0) {
      html += '<div style="font-size:13px;color:var(--color-text-muted);padding:10px 0;">暂无评论</div>';
    } else {
      comments.forEach(function(c) {
        var cName = c.author === 'user' ? '你' : 'AI';
        html += '<div class="moment-detail-comment">';
        html += '<div class="moment-comment-avatar">' + cName.charAt(0) + '</div>';
        html += '<div class="moment-comment-body">';
        html += '<div class="moment-comment-author">' + cName + '</div>';
        html += '<div class="moment-comment-text">' + escapeHtml(c.content) + '</div>';
        html += '<div class="moment-comment-time">' + c.created_at + '</div>';
        html += '</div></div>';
      });
    }
    html += '</div>';

    // 评论输入
    html += '<div class="moment-detail-compose">';
    html += '<input type="text" id="detail-comment-input" placeholder="写评论..." maxlength="200" />';
    html += '<button id="detail-comment-btn">发送</button>';
    html += '</div>';

    body.innerHTML = html;

    // 事件绑定
    document.getElementById('moment-detail-overlay').classList.add('show');

    // 点赞
    document.getElementById('detail-like-btn').addEventListener('click', async function() {
      if (this.disabled) return;
      this.disabled = true;
      try {
        var response = await fetch('/api/moments/' + momentId + '/like', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:'user'})});
        if (!response.ok) throw new Error((await response.json()).error || '点赞失败');
        await openMomentDetail(momentId);
      } catch (error) { showToast(error.message); }
      finally { this.disabled = false; }
    });

    // 评论
    var commentInput = document.getElementById('detail-comment-input');
    document.getElementById('detail-comment-btn').addEventListener('click', async function() {
      var text = commentInput.value.trim();
      if (!text || this.disabled) return;
      this.disabled = true;
      try {
      var response = await fetch('/api/moments/' + momentId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!response.ok) throw new Error((await response.json()).error || '评论失败');
      await openMomentDetail(momentId);
      } catch (error) { showToast(error.message); }
      finally { this.disabled = false; }
    });
    commentInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('detail-comment-btn').click();
    });
  } catch (err) {
    console.error('加载动态详情失败:', err);
  }
}

// 关闭详情
var detailBackBtn = document.getElementById('moment-detail-back');
if (detailBackBtn) {
  detailBackBtn.addEventListener('click', function() {
    document.getElementById('moment-detail-overlay').classList.remove('show');
  });
}

// 刷新头像显示
function refreshAvatar(path) {
  var wrapper = document.getElementById('profile-avatar-container');
  if (!wrapper) return;

  var old = document.getElementById('profile-avatar');
  if (old) old.remove();

  var name = currentProfile.nickname || 'AI';
  if (path) {
    var img = document.createElement('img');
    img.id = 'profile-avatar';
    img.className = 'avatar';
    img.style.cssText = 'width:64px;height:64px;';
    img.src = path;
    wrapper.appendChild(img);
  } else {
    var div = document.createElement('div');
    div.id = 'profile-avatar';
    div.className = 'avatar avatar-fallback';
    div.style.cssText = 'width:64px;height:64px;font-size:26px;display:flex;align-items:center;justify-content:center;border-radius:50%;';
    div.style.background = typeof avatarFallbackColor === 'function' ? avatarFallbackColor(name) : 'var(--color-primary)';
    div.style.color = '#0d1b3e';
    div.textContent = name.charAt(0);
    wrapper.appendChild(div);
  }
}

load();
