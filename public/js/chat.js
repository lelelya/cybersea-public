// js/chat.js — 聊天页交互逻辑（v2: 支持文字/语音/图片消息）

let persona = null;
let appConfig = null;
let oldestLoadedId = null;
let lastMessageTime = null;
let mcpServersCache = null;
let mcpServersCacheTime = 0;
const MCP_CACHE_TTL = 30000; // 30 seconds

// ========== 回家模式状态 ==========
let inHomeMode = false;
let homeEnvDescription = '';  // 当前环境描写文字
let lastHomeEnvMsgId = null;  // 最近一条环境描写消息的ID，用于替换

// ========== 收藏状态缓存 ==========
let favoritedMessageIds = new Set();

// ========== 回家模式：辅助函数 ==========
function addHomeModeFields(body) {
  if (inHomeMode) {
    body.home_mode = true;
    body.home_env = homeEnvDescription;
  }
  return body;
}

async function loadFavoritedIds() {
  try {
    const res = await fetch('/api/favorites');
    const data = await res.json();
    favoritedMessageIds = new Set((data.items || []).map(function(f) { return String(f.message_id); }));
  } catch (_) { /* 非关键功能，静默失败 */ }
}

// ========== 工具调用通知 ==========
const TOOL_NOTIFICATION_TEXT = {
  write_letter: '他给你写了一封信',
  reply_letter: '他给你写了一封信',
  post_moment: '他发了一条朋友圈',
  update_profile: '他更新了个人资料',
  send_red_packet: '他给你发了一个红包',
  send_gift: '他给你送了一份礼物',
  send_food_delivery: '他给你点了一份外卖',
};

const TOOL_NOTIFICATION_COLOR = {
  write_letter: 'var(--color-primary)',
  reply_letter: 'var(--color-primary)',
  post_moment: 'var(--color-success)',
  update_profile: 'var(--color-gold)',
  send_red_packet: '#f44336',
  send_gift: 'var(--color-accent)',
  send_food_delivery: '#ff9800',
};

const SILENT_TOOLS = new Set([
  'query_memory_events',
  'query_memory_profile',
  'initiate_call',
  'start_call',
  'end_call',
  'send_red_packet',
  'send_gift',
  'send_food_delivery',
]);

function renderToolNotification(toolName) {
  const container = document.getElementById('chat-container');
  const text = TOOL_NOTIFICATION_TEXT[toolName] || '他使用了' + toolName;
  const color = TOOL_NOTIFICATION_COLOR[toolName] || 'var(--color-text-muted)';

  const el = document.createElement('div');
  el.className = 'tool-notification';
  el.style.color = color;
  el.textContent = text;
  container.appendChild(el);
}

function renderToolNotifications(toolCalls) {
  if (!toolCalls || !Array.isArray(toolCalls)) return;
  toolCalls.forEach(function (name) {
    if (!SILENT_TOOLS.has(name)) {
      renderToolNotification(name);
    }
  });
}

// ========== 时间戳分割线 ==========
function formatTimeDivider(dateStr) {
  const msgDate = new Date(dateStr);
  const now = new Date();
  const hours = String(msgDate.getHours()).padStart(2, '0');
  const minutes = String(msgDate.getMinutes()).padStart(2, '0');
  const timeStr = hours + ':' + minutes;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
  const diffMs = today - msgDay;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return timeStr;
  } else if (diffDays === 1) {
    return '昨天 ' + timeStr;
  } else if (msgDate.getFullYear() === now.getFullYear()) {
    return (msgDate.getMonth() + 1) + '月' + msgDate.getDate() + '日 ' + timeStr;
  } else {
    return msgDate.getFullYear() + '年' + (msgDate.getMonth() + 1) + '月' + msgDate.getDate() + '日 ' + timeStr;
  }
}

function maybeInsertTimeDivider(msgCreatedAt) {
  if (!msgCreatedAt) return;
  var msgTime = new Date(msgCreatedAt).getTime();
  if (isNaN(msgTime)) return;

  if (lastMessageTime !== null && (msgTime - lastMessageTime) < 5 * 60 * 1000) {
    lastMessageTime = msgTime;
    return;
  }

  var container = document.getElementById('chat-container');
  var el = document.createElement('div');
  el.className = 'time-divider';
  el.textContent = formatTimeDivider(msgCreatedAt);
  container.appendChild(el);

  lastMessageTime = msgTime;
}

// ========== 回家模式：分隔线与环境描写渲染 ==========

function renderModeDivider(action, userName, aiName) {
  var container = document.getElementById('chat-container');
  var el = document.createElement('div');
  el.className = 'mode-divider' + (action === 'home_enter' ? ' home-enter' : '');
  if (action === 'home_enter') {
    el.textContent = '回到了 ' + userName + ' 和 ' + aiName + ' 的家';
  } else {
    el.textContent = '离开了 ' + userName + ' 和 ' + aiName + ' 的家';
  }
  container.appendChild(el);
  return el;
}

function renderHomeEnvDesc(envDesc) {
  var container = document.getElementById('chat-container');
  var el = document.createElement('div');
  el.className = 'home-env-desc';
  el.textContent = envDesc;
  el.title = '点击编辑家的基本情况';
  el.addEventListener('click', openHomeDescEditor);
  container.appendChild(el);
  homeEnvDescription = envDesc;
  return el;
}

// ========== 回家模式：切换逻辑 ==========

let homeModeSwitching = false;

async function toggleHomeMode() {
  if (homeModeSwitching) return; // 防止快速点击
  homeModeSwitching = true;
  try {
    if (inHomeMode) {
      await leaveHomeMode();
    } else {
      await enterHomeMode();
    }
  } finally {
    homeModeSwitching = false;
  }
}

async function enterHomeMode() {
  var btn = document.getElementById('home-mode-btn');
  btn.classList.add('active');
  disableSend(true);
  try {
    var res = await fetch('/api/home-mode/enter', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '进入回家模式失败');

    renderModeDivider('home_enter', data.user_name, data.ai_name);
    renderHomeEnvDesc(data.environment_description);

    inHomeMode = true;
    updateStickerButtonMode();
  } catch (err) {
    btn.classList.remove('active');
    showToast('回家失败: ' + err.message);
  } finally {
    disableSend(false);
  }
}

async function leaveHomeMode() {
  var btn = document.getElementById('home-mode-btn');
  btn.classList.remove('active');
  disableSend(true);
  try {
    var res = await fetch('/api/home-mode/leave', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || '离开失败');

    renderModeDivider('home_leave', data.user_name, data.ai_name);

    inHomeMode = false;
    homeEnvDescription = '';
    lastHomeEnvMsgId = null;
    updateStickerButtonMode();
  } catch (err) {
    btn.classList.add('active');
    showToast('操作失败: ' + err.message);
  } finally {
    disableSend(false);
  }
}

// ========== 家设定编辑弹窗 ==========

function openHomeDescEditor() {
  var modal = document.getElementById('home-desc-modal');
  var input = document.getElementById('home-desc-input');
  var cancelBtn = document.getElementById('home-desc-cancel');
  var saveBtn = document.getElementById('home-desc-save');

  // 加载当前家描述
  fetch('/api/home-mode/description')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      input.value = data.home_description || '';
    })
    .catch(function() {});

  modal.style.display = 'flex';

  function close() {
    modal.style.display = 'none';
    cancelBtn.removeEventListener('click', close);
    saveBtn.removeEventListener('click', doSave);
    modal.removeEventListener('click', onOverlayClick);
  }

  function doSave() {
    var desc = input.value.trim();
    close();
    saveHomeDescription(desc);
  }

  function onOverlayClick(e) {
    if (e.target === modal) close();
  }

  cancelBtn.addEventListener('click', close);
  saveBtn.addEventListener('click', doSave);
  modal.addEventListener('click', onOverlayClick);
}

async function saveHomeDescription(desc) {
  try {
    // 更新家描述
    await fetch('/api/home-mode/description', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home_description: desc }),
    });

    if (inHomeMode) {
      // 重新生成环境描写
      var res = await fetch('/api/home-mode/regenerate-env', { method: 'POST' });
      var data = await res.json();
      if (data.environment_description) {
        // 删除旧的环境描写DOM元素
        var oldEnvDesc = document.querySelector('.home-env-desc');
        if (oldEnvDesc) oldEnvDesc.remove();

        // 插入新的
        renderHomeEnvDesc(data.environment_description);
        showToast('环境描写已刷新');
      }
    } else {
      showToast('家已布置好');
    }
  } catch (err) {
    showToast('保存失败: ' + err.message);
  }
}

// ========== 表情包 ==========
let stickers = [];
let stickerFileToUpload = null;

async function loadStickers() {
  try {
    var res = await fetch('/api/stickers');
    var data = await res.json();
    stickers = data.stickers || [];
    renderStickerGrid();
  } catch (_) {}
}

function renderStickerGrid() {
  var grid = document.getElementById('sticker-grid');
  if (!grid) return;
  grid.innerHTML = '';

  stickers.forEach(function(s) {
    var item = document.createElement('div');
    item.className = 'sticker-item';
    item.title = s.name;
    item.innerHTML =
      '<img src="' + escapeHtml(s.path) + '" alt="' + escapeHtml(s.name) + '" loading="lazy" />' +
      '<span class="sticker-name">' + escapeHtml(s.name) + '</span>' +
      '<button class="sticker-delete" data-id="' + s.id + '">✕</button>';
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('sticker-delete')) return;
      handleStickerClick(s);
    });
    var delBtn = item.querySelector('.sticker-delete');
    delBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      handleStickerDelete(s.id);
    });
    grid.appendChild(item);
  });

  // + 添加按钮
  var addItem = document.createElement('div');
  addItem.className = 'sticker-item sticker-add';
  addItem.title = '添加表情';
  addItem.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  addItem.addEventListener('click', handleStickerAddClick);
  grid.appendChild(addItem);
}

function handleStickerClick(sticker) {
  var input = document.getElementById('msg-input');
  var marker = '[sticker:' + sticker.name + ']';
  var cursor = input.selectionStart || input.value.length;
  var before = input.value.substring(0, cursor);
  // 在相邻文字间添加空格
  if (before.length > 0 && !/\s$/.test(before)) marker = ' ' + marker;
  var after = input.value.substring(cursor);
  if (after.length > 0 && !/^\s/.test(after)) marker = marker + ' ';
  input.value = before + marker + after;
  input.focus();
  input.selectionStart = input.selectionEnd = cursor + marker.length;
  closeStickerPanel();
}

function handleStickerAddClick() {
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
  fileInput.addEventListener('change', function() {
    if (fileInput.files.length > 0) {
      stickerFileToUpload = fileInput.files[0];
      showStickerNameModal();
    }
  });
  fileInput.click();
}

function showStickerNameModal() {
  var modal = document.getElementById('sticker-name-modal');
  var input = document.getElementById('sticker-name-input');
  var cancelBtn = document.getElementById('sticker-name-cancel');
  var confirmBtn = document.getElementById('sticker-name-confirm');
  input.value = '';
  input.focus();
  modal.style.display = 'flex';

  function close() {
    modal.style.display = 'none';
    stickerFileToUpload = null;
    cancelBtn.removeEventListener('click', close);
    confirmBtn.removeEventListener('click', doUpload);
    modal.removeEventListener('click', onOverlayClick);
  }

  function doUpload() {
    var name = input.value.trim();
    if (!name) { showToast('请输入表情名'); return; }
    close();
    uploadSticker(name);
  }

  function onOverlayClick(e) {
    if (e.target === modal) close();
  }

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', doUpload);
  modal.addEventListener('click', onOverlayClick);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doUpload();
  });
}

async function uploadSticker(name) {
  if (!stickerFileToUpload) return;
  var formData = new FormData();
  formData.append('image', stickerFileToUpload);
  formData.append('name', name);

  try {
    var res = await fetch('/api/stickers', { method: 'POST', body: formData });
    if (!res.ok) {
      var errData = await res.json();
      throw new Error(errData.error || '上传失败');
    }
    var sticker = await res.json();
    stickers.push(sticker);
    renderStickerGrid();
    showToast('表情已添加');
  } catch (err) {
    showToast('添加失败: ' + err.message);
  }
  stickerFileToUpload = null;
}

async function handleStickerDelete(id) {
  if (!confirm('确定删除这个表情？')) return;
  try {
    await fetch('/api/stickers/' + id, { method: 'DELETE' });
    stickers = stickers.filter(function(s) { return s.id !== id; });
    renderStickerGrid();
    showToast('已删除');
  } catch (err) {
    showToast('删除失败');
  }
}

function openStickerPanel() {
  var panel = document.getElementById('sticker-panel');
  if (!panel) return;
  var isOpen = panel.classList.contains('show');

  // 关闭加号面板（去动画，避免输入框跳动）
  var plusPanel = document.getElementById('plus-panel');
  if (plusPanel && plusPanel.classList.contains('show')) {
    plusPanel.style.transition = 'none';
    plusPanel.classList.remove('show');
    plusPanel.offsetHeight;
    plusPanel.style.transition = '';
  }

  if (isOpen) {
    panel.classList.remove('show');
  } else {
    panel.classList.add('show');
    loadStickers();
  }
}

function closeStickerPanel() {
  var panel = document.getElementById('sticker-panel');
  if (panel) panel.classList.remove('show');
}

function renderStickerBubble(msg) {
  var src = msg.image_path || '';
  var name = msg.content || '表情';
  return '<div class="bubble sticker-bubble" data-role="sticker-bubble">' +
    (src ? '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(name) + '" loading="lazy" />' : '<span>[' + escapeHtml(name) + ']</span>') +
    '</div>';
}

// 更新表情按钮的图标和行为（线上😊 vs 回家✱）
function updateStickerButtonMode() {
  var btn = document.getElementById('sticker-btn');
  if (!btn) return;
  if (inHomeMode) {
    btn.title = '插入动作';
    btn.innerHTML = '<span style="font-size:20px;line-height:1;font-weight:700;">*</span>';
    btn.onclick = insertActionAsterisks;
  } else {
    btn.title = '表情包';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';
    btn.onclick = openStickerPanel;
  }
}

function insertActionAsterisks() {
  var input = document.getElementById('msg-input');
  var cursor = input.selectionStart || input.value.length;
  var text = input.value;
  var before = text.substring(0, cursor);
  var after = text.substring(cursor);
  // 在已有文字间插入时自动加空格
  var prefix = (before.length > 0 && !/\s$/.test(before)) ? ' ' : '';
  var suffix = (after.length > 0 && !/^\s/.test(after)) ? ' ' : '';
  input.value = before + prefix + '**' + suffix + after;
  var newCursor = cursor + prefix.length + 1;
  input.selectionStart = input.selectionEnd = newCursor;
  input.focus();
}

// ========== Toast ==========
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 把 *动作描写* 转成斜体半透明 HTML，其余文字正常转义
function renderActionText(content) {
  // 先把内容按 *...* 分割，分别处理
  var parts = content.split(/(\*[^*]+\*)/g);
  return parts.map(function(part) {
    var m = part.match(/^\*([^*]+)\*$/);
    if (m) {
      return '<i class="action-text">' + escapeHtml(m[1]) + '</i>';
    }
    return escapeHtml(part);
  }).join('');
}

// ========== 消息渲染 ==========
function renderMessage(msg, prepend = false) {
  const container = document.getElementById('chat-container');
  const row = document.createElement('div');

  const msgType = msg.type || 'text';

  // 模式切换分隔线
  if (msgType === 'mode_switch') {
    try {
      var switchData = JSON.parse(msg.content);
      var divider = renderModeDivider(switchData.action, switchData.user_name, switchData.ai_name);
      if (switchData.action === 'home_enter') {
        inHomeMode = true;
      } else {
        inHomeMode = false;
      }
      if (msg.id) divider.dataset.id = msg.id;
      return divider;
    } catch (_) {
      // 解析失败，当作普通系统消息
    }
  }

  // 环境描写
  if (msgType === 'home_env') {
    var envEl = renderHomeEnvDesc(msg.content);
    if (msg.id) { envEl.dataset.id = msg.id; lastHomeEnvMsgId = msg.id; }
    return envEl;
  }

  // 工具通知：居中半透明小字，不是气泡（不参与编辑/删除、不渲染头像）
  if (msgType === 'tool_notification') {
    const text = TOOL_NOTIFICATION_TEXT[msg.content] || '他使用了' + msg.content;
    const color = TOOL_NOTIFICATION_COLOR[msg.content] || 'var(--color-text-muted)';
    row.className = 'tool-notification';
    if (msg.id) row.dataset.id = msg.id;
    row.style.color = color;
    row.textContent = text;
    if (prepend) {
      container.insertBefore(row, container.firstChild);
    } else {
      container.appendChild(row);
      container.scrollTop = container.scrollHeight;
    }
    return row;
  }

  row.className = `msg-row ${msg.role === 'user' ? 'user' : 'ai'}`;
  if (msg.id) row.dataset.id = msg.id;

  const owner = msg.role === 'user' ? 'user' : 'ai';
  const avatarSrc = msg.role === 'user'
    ? (persona?.user_avatar_path || '')
    : (persona?.ai_avatar_path || '');
  const name = msg.role === 'user' ? (persona?.user_name || '我') : (persona?.ai_name || 'AI');

  let bubbleHtml = '';
  if (msgType === 'sticker') {
    bubbleHtml = renderStickerBubble(msg);
    row.classList.add('has-sticker');
  } else if (msgType === 'red_packet') {
    bubbleHtml = renderRedPacketBubble(msg);
  } else if (msgType === 'gift') {
    bubbleHtml = renderGiftBubble(msg);
  } else if (msgType === 'food_delivery') {
    bubbleHtml = renderFoodDeliveryBubble(msg);
  } else if (msgType === 'voice') {
    bubbleHtml = renderVoiceBubble(msg);
  } else if (msgType === 'image') {
    bubbleHtml = renderImageBubble(msg);
    row.classList.add('has-image');
  } else if (msgType === 'text' && (msg.content || '').startsWith('[通话]')) {
    bubbleHtml = renderCallBubble(msg);
  } else {
    bubbleHtml = '<div class="bubble" data-role="bubble">' + renderActionText(msg.content || '') + '</div>';
  }

  row.innerHTML = `
    ${renderAvatarHtml(owner, avatarSrc, name)}
    <div class="bubble-wrap">
      <div class="msg-name">${escapeHtml(name)}</div>
      ${bubbleHtml}
    </div>
  `;

  // 经济卡片：点击展开删除按钮（不可编辑）
  if (msgType === 'sticker') {
    // 表情消息：只支持删除，不可编辑
    attachMediaBubbleEvents(row, msgType);
  } else if (msgType === 'red_packet' || msgType === 'gift' || msgType === 'food_delivery') {
    attachEconomyBubbleEvents(row);
  } else if (msgType === 'text' && (msg.content || '').startsWith('[通话]')) {
    attachCallBubbleEvents(row);
  } else if (msgType === 'text') {
    attachBubbleEvents(row);
  } else {
    attachMediaBubbleEvents(row, msgType);
  }

  if (prepend) {
    container.insertBefore(row, container.firstChild);
  } else {
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  return row;
}

// ========== 语音气泡 ==========
function renderVoiceBubble(msg) {
  const duration = msg.duration || 0;
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}″`;
  const transcript = msg.transcript || msg.content || '';
  const audioSrc = msg.voice_path || '';

  return `
    <div class="bubble voice-bubble" data-role="voice-bubble" data-audio-url="${escapeHtml(audioSrc)}" data-transcript="${escapeHtml(transcript)}">
      <button class="voice-play-btn" title="播放">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div class="voice-wave">
        <span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span>
      </div>
      <span class="voice-duration">${timeStr}</span>
    </div>`;
}

// ========== 通话气泡 ==========
function renderCallBubble(msg) {
  var content = msg.content || '';
  // 格式: [通话] 通话时长 03:35 | /uploads/xxx.webm
  //       [通话] 未接通
  var parts = content.split('|').map(function(s) { return s.trim(); });
  var header = parts[0]; // [通话] 通话时长 03:35
  var audioPath = parts[1] || '';
  var durationText = header.replace('[通话]', '').trim();
  var isMissed = durationText === '未接通' || durationText === '未接来电';

  var phoneIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

  var missedClass = isMissed ? ' missed' : '';
  return '<div class="bubble call-bubble' + missedClass + '">' +
    '<span class="call-bubble-icon">' + phoneIcon + '</span>' +
    '<span class="call-bubble-text' + missedClass + '">' + escapeHtml(durationText) + '</span>' +
    '</div>';
}

// ========== 图片气泡 ==========
function renderImageBubble(msg) {
  const src = msg.image_path || '';
  const caption = msg.content || '';
  return `
    <div class="bubble image-bubble" data-role="image-bubble">
      ${src ? `<img src="${escapeHtml(src)}" class="chat-image" loading="lazy" alt="聊天图片" />` : '<div class="image-placeholder">图片</div>'}
      ${caption ? `<div class="image-caption">${escapeHtml(caption)}</div>` : ''}
    </div>`;
}

// ========== 轻量图片查看器 ==========
let lightboxEl = null;
function showLightbox(src) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'chat-lightbox';
    lightboxEl.innerHTML = '<img src="" alt="查看大图" />';
    lightboxEl.addEventListener('click', () => { lightboxEl.classList.remove('show'); });
    document.body.appendChild(lightboxEl);
  }
  lightboxEl.querySelector('img').src = src;
  lightboxEl.classList.add('show');
}

// ========== 右键/长按上下文菜单 ==========
let contextMenuEl = null;
let contextMenuTargetRow = null;

function ensureContextMenu() {
  if (contextMenuEl) return;
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'msg-context-menu';
  contextMenuEl.innerHTML =
    '<button class="msg-context-item" data-action="favorite">' +
      '<span class="msg-context-icon">⭐</span>' +
      '<span>收藏</span>' +
    '</button>' +
    '<button class="msg-context-item" data-action="copy">' +
      '<span class="msg-context-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg></span>' +
      '<span>复制</span>' +
    '</button>';
  document.body.appendChild(contextMenuEl);

  contextMenuEl.addEventListener('click', async function(e) {
    var btn = e.target.closest('.msg-context-item');
    if (!btn) return;
    var action = btn.dataset.action;
    var row = contextMenuTargetRow;
    hideContextMenu();

    if (action === 'copy') {
      var bubble = row.querySelector('.bubble[data-role="bubble"]');
      if (!bubble) bubble = row.querySelector('.voice-bubble');
      if (bubble) {
        var text = bubble.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          showToast('已复制');
        } catch (_) {
          showToast('复制失败');
        }
      }
    } else if (action === 'favorite' || action === 'unfavorite') {
      var msgId = row.dataset.id;
      if (!msgId) { showToast('消息未同步'); return; }
      if (action === 'unfavorite') {
        unfavoriteMessage(msgId, row);
      } else {
        favoriteMessage(msgId, row);
      }
    }
  });
}

function showContextMenu(x, y, row) {
  ensureContextMenu();
  contextMenuTargetRow = row;
  var msgId = row.dataset.id;

  var favBtn = contextMenuEl.querySelector('[data-action="favorite"]');
  var isFav = msgId && favoritedMessageIds.has(String(msgId));
  favBtn.dataset.action = isFav ? 'unfavorite' : 'favorite';
  favBtn.querySelector('span:last-child').textContent = isFav ? '取消收藏' : '收藏';

  var copyBtn = contextMenuEl.querySelector('[data-action="copy"]');
  var isImage = row.classList.contains('has-image') || row.querySelector('.image-bubble');
  copyBtn.style.display = isImage ? 'none' : '';

  contextMenuEl.classList.add('show');
  var rect = contextMenuEl.getBoundingClientRect();
  var left = x;
  var top = y;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  contextMenuEl.style.left = left + 'px';
  contextMenuEl.style.top = top + 'px';
}

function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.classList.remove('show');
  contextMenuTargetRow = null;
}

// 全局点击关闭上下文菜单
document.addEventListener('click', function(e) {
  if (contextMenuEl && !e.target.closest('.msg-context-menu') && !e.target.closest('.modal-overlay')) {
    hideContextMenu();
  }
});

// ========== 收藏/取消收藏 ==========

async function favoriteMessage(msgId, row) {
  var tag = await showTagInputDialog();
  if (tag === null) return; // 用户取消

  try {
    var body = { messageId: parseInt(msgId) };
    if (tag) body.tag = tag;
    var res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        showToast('已收藏过该消息');
        favoritedMessageIds.add(String(msgId));
        return;
      }
      throw new Error(data.error || '收藏失败');
    }
    favoritedMessageIds.add(String(msgId));
    showToast('已收藏');
  } catch (err) {
    showToast(err.message);
  }
}

async function unfavoriteMessage(msgId, row) {
  try {
    var res = await fetch('/api/favorites');
    var data = await res.json();
    var favs = data.items || [];
    var fav = null;
    for (var i = 0; i < favs.length; i++) {
      if (String(favs[i].message_id) === String(msgId)) { fav = favs[i]; break; }
    }
    if (!fav) { showToast('未找到收藏记录'); return; }
    await fetch('/api/favorites/' + fav.id, { method: 'DELETE' });
    favoritedMessageIds.delete(String(msgId));
    showToast('已取消收藏');
  } catch (err) {
    showToast('取消收藏失败');
  }
}

// ========== 标签输入对话框 ==========
function showTagInputDialog() {
  return new Promise(async function(resolve) {
    var existingTags = [];
    try {
      var res = await fetch('/api/favorites/tags');
      var data = await res.json();
      existingTags = data.tags || [];
    } catch (_) {}

    var chipsHtml = '';
    if (existingTags.length) {
      chipsHtml = '<div class="fav-tag-chips">' +
        existingTags.map(function(t) {
          return '<span class="fav-tag-chip" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
        }).join('') +
        '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10000';
    overlay.innerHTML =
      '<div class="modal-card" style="width:300px;">' +
        '<div class="modal-title">添加标签（可选）</div>' +
        chipsHtml +
        '<input class="modal-input" id="fav-tag-input" placeholder="输入标签，如：重要、有趣" maxlength="20" />' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost btn-ghost-sm" id="fav-tag-skip">跳过</button>' +
          '<button class="btn-ghost btn-ghost-sm" id="fav-tag-confirm" style="color:var(--color-primary);">确认</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#fav-tag-input');
    var done = function(tag) {
      overlay.remove();
      resolve(tag);
    };

    overlay.addEventListener('click', function(e) { if (e.target === overlay) done(null); });
    overlay.querySelector('#fav-tag-skip').addEventListener('click', function() { done(''); });
    overlay.querySelector('#fav-tag-confirm').addEventListener('click', function() {
      done(input.value.trim() || '');
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') done(input.value.trim() || '');
      if (e.key === 'Escape') done(null);
    });

    // 点击已有标签填入输入框
    overlay.querySelectorAll('.fav-tag-chip').forEach(function(chip) {
      chip.addEventListener('click', function() { input.value = chip.dataset.tag; });
    });

    input.focus();
  });
}

// ========== 主动消息渲染（WebSocket 推送） ==========
function renderProactiveMessage(message) {
  maybeInsertTimeDivider(new Date().toISOString());
  renderAiReply(message, null);
}

// 挂载到全局供 index.html 调用
window.renderProactiveMessage = renderProactiveMessage;

// TTS 是否配置（页面加载时异步获取）
let ttsConfigured = false;
(async function checkTts() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    ttsConfigured = !!(s.tts_api_url);
  } catch (_) {}
})();

// ========== AI 回复渲染（检测 [voice] 标记） ==========
function renderAiReply(replyText, msgId) {
  // 1. 检测 [voice] 前缀（未配置 TTS 时忽略，当普通文字处理）
  const voiceMatch = replyText.match(/^\[voice\]\s*/i);
  const isVoice = ttsConfigured && !!voiceMatch;
  const bodyText = voiceMatch ? replyText.slice(voiceMatch[0].length).trim() : replyText;

  // 2. 检测 [image] 标签
  const imgRegex = /\[image\](.+?)\|(.+?)\[\/image\]/gi;
  const imgMatches = [...bodyText.matchAll(imgRegex)];
  const hasImages = imgMatches.length > 0;

  // 3. 既无 [voice] 也无 [image] → 普通文字
  if (!isVoice && !hasImages) {
    const row = renderMessage({ id: msgId, role: 'ai', content: replyText, type: 'text' });
    attachTTSButton(row);
    return row;
  }

  const rows = [];

  // 4. 去掉 [image] 标签后的纯文字（语音用、或文字气泡用）
  const cleanText = bodyText.replace(imgRegex, '').trim();

  if (isVoice) {
    // 语音气泡（TTS 只读 cleanText，不含图片标签）
    const duration = Math.max(1, Math.round(cleanText.length / 4));
    const voiceRow = renderMessage({
      id: hasImages ? null : msgId, role: 'ai', type: 'voice',
      content: cleanText, duration: duration, transcript: cleanText,
    });
    const playBtn = voiceRow.querySelector('.voice-play-btn');
    const voiceBubble = voiceRow.querySelector('.voice-bubble');
    if (playBtn && voiceBubble) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTTSPlayback(voiceBubble, playBtn, cleanText);
      });
    }
    rows.push(voiceRow);
  } else if (cleanText) {
    // 非语音、有文字 → 文字气泡
    const textRow = renderMessage({ id: null, role: 'ai', content: cleanText, type: 'text' });
    attachTTSButton(textRow);
    rows.push(textRow);
  }

  // 5. 渲染图片气泡
  if (hasImages) {
    imgMatches.forEach((match, idx) => {
      const imgPath = match[1].trim();
      const caption = match[2].trim();
      const isLast = idx === imgMatches.length - 1;
      const imgRow = renderMessage({
        id: isLast ? msgId : null,
        role: 'ai', type: 'image',
        content: caption, image_path: imgPath,
      });
      rows.push(imgRow);
    });
  }

  // 6. 如果没有任何行（边界情况），退化为文字
  if (rows.length === 0) {
    const fallback = renderMessage({ id: msgId, role: 'ai', content: replyText, type: 'text' });
    attachTTSButton(fallback);
    return fallback;
  }

  return rows[rows.length - 1];
}

// ========== TTS 播放控制（切换播放/暂停图标） ==========
async function toggleTTSPlayback(bubble, playBtn, text) {
  // 正在播放 → 停止
  if (ttsSpeaking) {
    window.speechSynthesis.cancel();
    ttsSpeaking = false;
    bubble.classList.remove('playing');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    return;
  }

  // 尝试服务端 TTS 缓存（首次播放时生成音频文件，之后直接复用）
  const row = bubble.closest('.msg-row');
  const msgId = row ? row.dataset.id : null;
  if (msgId) {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, message_id: parseInt(msgId, 10) }),
      });
      if (res.ok) {
        const data = await res.json();
        // 更新气泡的音频URL，后续播放直接走缓存
        bubble.dataset.audioUrl = data.voice_path;
        // 按录音消息的播放逻辑处理
        const audio = new Audio(data.voice_path);
        bubble.classList.add('playing');
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        audio.onended = () => {
          bubble.classList.remove('playing');
          playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        };
        audio.onerror = () => {
          bubble.classList.remove('playing');
          playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        };
        audio.play().catch(() => {
          bubble.classList.remove('playing');
          playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        });
        return;
      }
    } catch (_) { /* 服务端TTS不可用，降级到浏览器合成 */ }
  }

  // 降级：浏览器 SpeechSynthesis（TTS 未接入时的临时方案）
  bubble.classList.add('playing');
  playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  playTTS(text, () => {
    bubble.classList.remove('playing');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
  });
}

// ========== 语音/图片气泡事件（播放/查看大图 + 转文字/删除） ==========
function attachMediaBubbleEvents(row, msgType) {
  // 播放 / 查看大图
  if (msgType === 'voice') {
    const playBtn = row.querySelector('.voice-play-btn');
    const voiceBubble = row.querySelector('.voice-bubble');
    if (playBtn && voiceBubble) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleVoicePlayback(voiceBubble, playBtn);
      });
    }
  }
  if (msgType === 'image') {
    const img = row.querySelector('.chat-image');
    if (img) {
      img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        showLightbox(img.src);
      });
    }
  }

  // 点击气泡弹出操作条（语音有"转文字"+"删除"，图片只有"删除"）
  const bubble = row.querySelector(msgType === 'voice' ? '.voice-bubble' : '.image-bubble');
  if (!bubble) return;

  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    const already = row.querySelector('.msg-action-bar');
    document.querySelectorAll('.msg-action-bar').forEach((bar) => bar.remove());
    if (already) return;

    const bar = document.createElement('div');
    bar.className = 'msg-action-bar';

    if (msgType === 'voice') {
      // 检查当前是否已展开转文字
      const expanded = row.querySelector('.voice-transcript-expanded');
      bar.innerHTML = `
        <button class="msg-transcribe-btn">${expanded ? '取消' : '转文字'}</button>
        <button class="msg-delete-btn">删除</button>
      `;
    } else {
      bar.innerHTML = '<button class="msg-delete-btn">删除</button>';
    }

    row.querySelector('.bubble-wrap').appendChild(bar);

    bar.querySelector('.msg-delete-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteMessage(row);
    });

    if (msgType === 'voice') {
      bar.querySelector('.msg-transcribe-btn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleTranscript(row);
        bar.remove();
      });
    }
  });

  // 右键菜单
  bubble.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    hideContextMenu();
    showContextMenu(e.clientX, e.clientY, row);
  });

  // 移动端长按菜单
  var longPressTimer;
  bubble.addEventListener('touchstart', function(e) {
    longPressTimer = setTimeout(function() {
      var touch = e.touches[0];
      showContextMenu(touch.clientX, touch.clientY, row);
    }, 500);
  }, { passive: true });
  bubble.addEventListener('touchend', function() { clearTimeout(longPressTimer); });
  bubble.addEventListener('touchmove', function() { clearTimeout(longPressTimer); });
}

// ========== 语音转文字：展开/收起 ==========
function toggleTranscript(row) {
  const existing = row.querySelector('.voice-transcript-expanded');
  if (existing) {
    existing.remove();
    return;
  }

  // 展开：在语音气泡下方显示转文字内容
  const voiceBubble = row.querySelector('.voice-bubble');
  const stored = voiceBubble ? voiceBubble.dataset.transcript : '';

  const transcriptDiv = document.createElement('div');
  transcriptDiv.className = 'voice-transcript-expanded';

  if (stored) {
    transcriptDiv.textContent = stored;
  } else {
    // DOM中没有 → 异步从服务器加载
    transcriptDiv.className += ' loading';
    transcriptDiv.textContent = '转文字中...';
    const msgId = row.dataset.id;
    fetch(`/api/messages?limit=200`)
      .then((r) => r.json())
      .then((data) => {
        const msgs = data.messages || [];
        const found = msgs.find((m) => String(m.id) === String(msgId));
        const t = (found && (found.transcript || found.content)) || '暂无转文字内容';
        transcriptDiv.textContent = t;
        transcriptDiv.classList.remove('loading');
        // 缓存到DOM，下次不用再请求
        if (voiceBubble) voiceBubble.dataset.transcript = t;
      })
      .catch(() => {
        transcriptDiv.textContent = '暂无转文字内容';
        transcriptDiv.classList.remove('loading');
      });
  }

  if (voiceBubble) {
    voiceBubble.after(transcriptDiv);
  } else {
    row.querySelector('.bubble-wrap').appendChild(transcriptDiv);
  }
}

// ========== 语音播放 ==========
let currentAudio = null;
function toggleVoicePlayback(bubble, playBtn) {
  const audioUrl = bubble.dataset.audioUrl;
  // 没有音频URL → 尝试 TTS（AI语音回复）
  if (!audioUrl) {
    const text = bubble.dataset.transcript || '';
    if (text) {
      toggleTTSPlayback(bubble, playBtn, text);
    } else {
      showToast('音频暂不可用');
    }
    return;
  }
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio = null;
    bubble.classList.remove('playing');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    return;
  }
  const audio = new Audio(audioUrl);
  currentAudio = audio;
  bubble.classList.add('playing');
  playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  audio.onended = () => {
    bubble.classList.remove('playing');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    currentAudio = null;
  };
  audio.play().catch(() => {
    showToast('播放失败');
    bubble.classList.remove('playing');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
  });
}

// ========== 经济卡片事件（仅删除） ==========
function attachEconomyBubbleEvents(row) {
  var bubble = row.querySelector('.red-packet-bubble, .gift-bubble, .food-bubble');
  if (!bubble) return;

  bubble.addEventListener('click', function(e) {
    e.stopPropagation();
    var already = row.querySelector('.msg-action-bar');
    document.querySelectorAll('.msg-action-bar').forEach(function(bar) { bar.remove(); });
    if (already) return;

    var bar = document.createElement('div');
    bar.className = 'msg-action-bar';
    bar.innerHTML = '<button class="msg-delete-btn">删除</button>';
    row.querySelector('.bubble-wrap').appendChild(bar);

    bar.querySelector('.msg-delete-btn').addEventListener('click', function(ev) {
      ev.stopPropagation();
      deleteMessage(row);
    });
  });

  // 右键菜单
  bubble.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    hideContextMenu();
    showContextMenu(e.clientX, e.clientY, row);
  });

  // 移动端长按菜单
  var longPressTimer;
  bubble.addEventListener('touchstart', function(e) {
    longPressTimer = setTimeout(function() {
      var touch = e.touches[0];
      showContextMenu(touch.clientX, touch.clientY, row);
    }, 500);
  }, { passive: true });
  bubble.addEventListener('touchend', function() { clearTimeout(longPressTimer); });
  bubble.addEventListener('touchmove', function() { clearTimeout(longPressTimer); });
}

// ========== 通话气泡事件（仅删除） ==========
function attachCallBubbleEvents(row) {
  var bubble = row.querySelector('.call-bubble');
  if (!bubble) return;

  bubble.addEventListener('click', function(e) {
    e.stopPropagation();
    var already = row.querySelector('.msg-action-bar');
    document.querySelectorAll('.msg-action-bar').forEach(function(bar) { bar.remove(); });
    if (already) return;

    var bar = document.createElement('div');
    bar.className = 'msg-action-bar';
    bar.innerHTML = '<button class="msg-delete-btn">删除</button>';
    row.querySelector('.bubble-wrap').appendChild(bar);

    bar.querySelector('.msg-delete-btn').addEventListener('click', function(ev) {
      ev.stopPropagation();
      deleteMessage(row);
    });
  });

  // 右键菜单
  bubble.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    hideContextMenu();
    showContextMenu(e.clientX, e.clientY, row);
  });

  // 移动端长按菜单
  var longPressTimer;
  bubble.addEventListener('touchstart', function(e) {
    longPressTimer = setTimeout(function() {
      var touch = e.touches[0];
      showContextMenu(touch.clientX, touch.clientY, row);
    }, 500);
  }, { passive: true });
  bubble.addEventListener('touchend', function() { clearTimeout(longPressTimer); });
  bubble.addEventListener('touchmove', function() { clearTimeout(longPressTimer); });
}

// ========== 文字气泡事件（编辑/删除 + 右键/长按菜单） ==========
function attachBubbleEvents(row) {
  const bubble = row.querySelector('.bubble');
  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    const already = row.querySelector('.msg-action-bar');
    document.querySelectorAll('.msg-action-bar').forEach((bar) => bar.remove());
    if (already) return;

    const bar = document.createElement('div');
    bar.className = 'msg-action-bar';
    bar.innerHTML = `
      <button class="msg-edit-btn">编辑</button>
      <button class="msg-delete-btn">删除</button>
    `;
    row.querySelector('.bubble-wrap').appendChild(bar);

    bar.querySelector('.msg-edit-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      startEditMessage(row);
    });
    bar.querySelector('.msg-delete-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteMessage(row);
    });
  });

  // 右键菜单
  bubble.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    hideContextMenu();
    showContextMenu(e.clientX, e.clientY, row);
  });

  // 移动端长按菜单
  var longPressTimer;
  bubble.addEventListener('touchstart', function(e) {
    longPressTimer = setTimeout(function() {
      var touch = e.touches[0];
      showContextMenu(touch.clientX, touch.clientY, row);
    }, 500);
  }, { passive: true });
  bubble.addEventListener('touchend', function() { clearTimeout(longPressTimer); });
  bubble.addEventListener('touchmove', function() { clearTimeout(longPressTimer); });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.msg-action-bar')) return;
  if (e.target.closest('.msg-edit-textarea')) return;
  document.querySelectorAll('.msg-action-bar').forEach((bar) => bar.remove());
});

function startEditMessage(row) {
  const id = row.dataset.id;
  if (!id) { showToast('这条消息还没同步完成，请稍后再试'); return; }

  const bubble = row.querySelector('.bubble');
  const original = bubble.textContent;

  const textarea = document.createElement('textarea');
  textarea.className = 'msg-edit-textarea';
  textarea.value = original;
  bubble.replaceWith(textarea);
  textarea.focus();

  const bar = row.querySelector('.msg-action-bar');
  bar.innerHTML = `
    <button class="msg-save-btn">保存</button>
    <button class="msg-cancel-btn">取消</button>
  `;

  const restore = (content) => {
    const newBubble = document.createElement('div');
    newBubble.className = 'bubble';
    newBubble.dataset.role = 'bubble';
    newBubble.textContent = content;
    textarea.replaceWith(newBubble);
    attachBubbleEvents(row);
    bar.remove();
  };

  bar.querySelector('.msg-cancel-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    restore(original);
  });

  bar.querySelector('.msg-save-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newContent = textarea.value.trim();
    if (!newContent) { showToast('消息内容不能为空'); return; }

    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      restore(newContent);
      showToast('已保存');
    } catch (err) {
      showToast(err.message);
    }
  });
}

async function deleteMessage(row) {
  const id = row.dataset.id;
  if (!id) { showToast('这条消息还没同步完成，请稍后再试'); return; }
  if (!confirm('确定删除这条消息吗？')) return;

  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || '删除失败');
    row.remove();
    showToast('已删除');
  } catch (err) {
    showToast(err.message);
  }
}

// ========== 语音录制 ==========
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let recognition = null;
let currentTranscript = '';

function isRecording() {
  return mediaRecorder && mediaRecorder.state === 'recording';
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // 停止所有音轨
      stream.getTracks().forEach((t) => t.stop());
      // 停止语音识别
      if (recognition) {
        recognition.stop();
        recognition = null;
      }

      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const duration = (Date.now() - recordingStartTime) / 1000;

      // SenseVoice STT：优先使用服务端识别
      var sttText = '';
      var sttEmotion = null;
      try {
        var sttForm = new FormData();
        sttForm.append('audio', audioBlob, 'recording.webm');
        var sttResp = await fetch('/api/stt', { method: 'POST', body: sttForm });
        if (sttResp.ok) {
          var sttData = await sttResp.json();
          sttText = sttData.text || '';
          sttEmotion = sttData.emotion || null;
        }
      } catch (_) { /* SenseVoice 不可用时降级 */ }

      // 构建消息文本：SenseVoice 优先，浏览器语音识别兜底
      var rawText = sttText || currentTranscript.trim();
      var transcript = rawText;
      var message = rawText || '（语音消息）';
      // 如果有非 NEUTRAL 的情绪，给 AI 加情绪标签（仅用作 AI 上下文，不显示）
      if (sttEmotion && rawText) {
        message = '[用户语气：' + sttEmotion + '] ' + rawText;
      }

      // 音频 blob → 纯 base64（arrayBuffer 逐字节编码，避免 readAsDataURL 的不确定性）
      const audioBuf = await audioBlob.arrayBuffer();
      const audioBytes = new Uint8Array(audioBuf);
      let binaryStr = '';
      const CHUNK = 8192;
      for (let i = 0; i < audioBytes.length; i += CHUNK) {
        binaryStr += String.fromCharCode.apply(null, audioBytes.subarray(i, i + CHUNK));
      }
      const audioBase64 = btoa(binaryStr);

      // 先渲染气泡（用临时 blob URL 做即时预览）
      const audioUrl = URL.createObjectURL(audioBlob);

      maybeInsertTimeDivider(new Date().toISOString());
      const userRow = renderMessage({
        role: 'user',
        type: 'voice',
        content: message,
        duration: duration,
        transcript: transcript,
      });
      const voiceBubble = userRow.querySelector('.voice-bubble');
      if (voiceBubble) voiceBubble.dataset.audioUrl = audioUrl;

      // 调用API，上传音频base64
      const mcpPromise = getMcpServers();
      disableSend(true);
      try {
        const mcpServers = await mcpPromise;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addHomeModeFields({
            message: message,
            type: 'voice',
            duration: duration,
            audio_data: audioBase64,
            mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
          })),
        });
        const data = await res.json();
        if (!res.ok) { if(data.user_message_id)userRow.dataset.id=data.user_message_id;else userRow.remove(); throw new Error(data.error || '请求失败'); }
        if (data.user_message_id) userRow.dataset.id = data.user_message_id;
        // 用服务器返回的持久化路径替换临时 blob URL
        if (data.voice_path && voiceBubble) {
          voiceBubble.dataset.audioUrl = data.voice_path;
        }
        renderToolNotifications(data.tool_calls);
  renderToolWarnings(data.warnings);
        renderAiReply(data.reply, data.ai_message_id);
      } catch (err) {
        showToast('发送失败: ' + err.message);
      } finally {
        disableSend(false);
      }
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();

    // 开始语音识别
    startSpeechRecognition();

    // 更新UI
    updateRecordingUI(true);
    startRecordingTimer();
  } catch (err) {
    console.error('录音失败:', err);
    showToast('无法访问麦克风，请检查浏览器权限');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    updateRecordingUI(false);
    stopRecordingTimer();
  }
}

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log('浏览器不支持语音识别');
    return;
  }
  try {
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          final += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      if (final) currentTranscript += final;
      // 在录音条上显示实时识别结果
      const hint = document.querySelector('.recording-hint');
      if (hint) hint.textContent = currentTranscript + interim || '正在聆听...';
    };

    recognition.onerror = (event) => {
      console.log('语音识别错误:', event.error);
    };

    recognition.start();
  } catch (err) {
    console.error('语音识别启动失败:', err);
    showToast('语音识别不可用，请使用文字输入');
  }
}

function startRecordingTimer() {
  const timerEl = document.getElementById('recording-timer');
  recordingTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  }, 200);
}

function stopRecordingTimer() {
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
}

function updateRecordingUI(active) {
  const bar = document.getElementById('recording-bar');
  const micBtn = document.getElementById('mic-btn');
  if (active) {
    bar.style.display = 'flex';
    micBtn.classList.add('recording');
    currentTranscript = '';
    document.getElementById('recording-timer').textContent = '0:00';
    document.querySelector('.recording-hint').textContent = '正在聆听...';
  } else {
    bar.style.display = 'none';
    micBtn.classList.remove('recording');
  }
}

// ========== TTS 语音合成（GPT-SoVITS 优先，浏览器 SpeechSynthesis 降级） ==========
let ttsSpeaking = false;
async function playTTS(text, onEnd) {
  // 优先使用 GPT-SoVITS
  if (window.ttsService && window.ttsService.speak) {
    try {
      await window.ttsService.speak(text);
      if (onEnd) onEnd();
      return;
    } catch (err) {
      console.warn('GPT-SoVITS TTS 失败，降级到浏览器合成:', err.message);
    }
  }

  // 降级：浏览器 SpeechSynthesis
  const synth = window.speechSynthesis;
  if (!synth) {
    if (onEnd) onEnd();
    return;
  }
  if (ttsSpeaking) {
    synth.cancel();
    ttsSpeaking = false;
    if (onEnd) onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  const voices = synth.getVoices();
  const zhVoice = voices.find((v) => v.lang.startsWith('zh-CN') || v.lang.startsWith('zh-TW') || v.lang.startsWith('zh'));
  if (zhVoice) utterance.voice = zhVoice;
  ttsSpeaking = true;
  utterance.onend = () => { ttsSpeaking = false; if (onEnd) onEnd(); };
  utterance.onerror = () => { ttsSpeaking = false; if (onEnd) onEnd(); };
  synth.speak(utterance);
}
// 预加载语音列表（浏览器异步加载）
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
}

// AI回复气泡末尾加TTS播放按钮
function attachTTSButton(row) {
  if (row.dataset.ttsAttached) return;
  row.dataset.ttsAttached = '1';

  const bubbleWrap = row.querySelector('.bubble-wrap');
  if (!bubbleWrap) return;

  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'tts-play-btn';
  ttsBtn.title = '播放语音';
  ttsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/>
    </svg>`;
  ttsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = row.querySelector('.bubble')?.textContent || '';
    playTTS(text);
  });

  // 放在气泡右下角
  bubbleWrap.appendChild(ttsBtn);
}

// ========== 图片发送 ==========
function triggerImagePick() {
  document.getElementById('img-file-input').click();
}

async function handleImagePicked(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result;
    const textAfter = document.getElementById('msg-input').value.trim();
    document.getElementById('msg-input').value = '';

    // 先渲染图片气泡（无说明文字）
    maybeInsertTimeDivider(new Date().toISOString());
    const imgRow = renderMessage({
      role: 'user',
      type: 'image',
      content: '',
      image_path: base64,
    });

    const mcpPromise = getMcpServers();
    disableSend(true);

    try {
      const mcpServers = await mcpPromise;
      // 发送图片（不带说明）
      const imgRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addHomeModeFields({
          message: '',
          type: 'image',
          image_data: base64,
          mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
        })),
      });
      const imgData = await imgRes.json();
      if (!imgRes.ok) { if(imgData.user_message_id)imgRow.dataset.id=imgData.user_message_id;else imgRow.remove(); throw new Error(imgData.error || '请求失败'); }
      if (imgData.user_message_id) imgRow.dataset.id = imgData.user_message_id;
      renderToolNotifications(imgData.tool_calls);
      renderToolWarnings(imgData.warnings);
      renderAiReply(imgData.reply, imgData.ai_message_id);
      renderEconomyItems(imgData.economy_messages);

      // 如果有附带文字，再发送一条单独的文字消息
      if (textAfter) {
        maybeInsertTimeDivider(new Date().toISOString());
        var textRow = renderMessage({ role: 'user', type: 'text', content: textAfter });
        var textRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addHomeModeFields({
            message: textAfter,
            type: 'text',
            mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
          })),
        });
        var textData = await textRes.json();
        if (textData.user_message_id) textRow.dataset.id = textData.user_message_id;
        renderToolNotifications(textData.tool_calls);
        renderAiReply(textData.reply, textData.ai_message_id);
        renderEconomyItems(textData.economy_messages);
      }
    } catch (err) {
      showToast('发送失败: ' + err.message);
    } finally {
      disableSend(false);
    }
  };
  reader.readAsDataURL(file);
}

// ========== MCP 服务器配置获取（缓存30秒）==========
async function getMcpServers() {
  const now = Date.now();
  if (mcpServersCache && (now - mcpServersCacheTime) < MCP_CACHE_TTL) {
    return mcpServersCache;
  }
  try {
    const res = await fetch('/api/mcp/servers');
    const data = await res.json();
    const enabled = (data.servers || []).filter(s => s.enabled);
    mcpServersCache = enabled;
    mcpServersCacheTime = now;
    return enabled;
  } catch (err) {
    console.warn('Failed to fetch MCP server list:', err);
    return mcpServersCache || [];
  }
}

// ========== 发送文字消息 ==========
// 解析输入文本中的 [sticker:name] 和普通文字，返回 chunks
function parseInputChunks(text) {
  var chunks = [];
  var stickerRegex = /\[sticker:([^\]]+)\]/g;
  var lastIndex = 0;
  var match;
  while ((match = stickerRegex.exec(text)) !== null) {
    // 前面的文字
    var textBefore = text.substring(lastIndex, match.index).trim();
    if (textBefore) chunks.push({ type: 'text', content: textBefore });
    // 表情
    chunks.push({ type: 'sticker', name: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  // 剩余文字
  var textAfter = text.substring(lastIndex).trim();
  if (textAfter) chunks.push({ type: 'text', content: textAfter });
  // 如果没有任何匹配，且没有文字，回退为普通文字
  if (chunks.length === 0) chunks.push({ type: 'text', content: text });
  return chunks;
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  if (isRecording()) return;

  // 关闭面板
  closeStickerPanel();
  var plusPanel = document.getElementById('plus-panel');
  if (plusPanel) plusPanel.classList.remove('show');

  var chunks = parseInputChunks(text);
  input.value = '';
  disableSend(true);
  maybeInsertTimeDivider(new Date().toISOString());

  var mcpServers = [];
  try {
    var mcpData = await getMcpServers();
    mcpServers = mcpData.length > 0 ? mcpData : [];
  } catch (_) {}

  for (var ci = 0; ci < chunks.length; ci++) {
    var chunk = chunks[ci];
    var isLastChunk = (ci === chunks.length - 1);
    try {
      if (chunk.type === 'sticker') {
        await sendStickerChunk(chunk.name, mcpServers);
      } else {
        await sendTextChunk(chunk.content, mcpServers, isLastChunk);
      }
    } catch (err) {
      showToast('发送失败: ' + err.message);
    }
  }

  disableSend(false);
}

async function sendStickerChunk(name, mcpServers) {
  // 从缓存中查找表情路径
  var sticker = null;
  for (var i = 0; i < stickers.length; i++) {
    if (stickers[i].name === name) { sticker = stickers[i]; break; }
  }
  var stickerPath = sticker ? sticker.path : '';

  var userRow = renderMessage({ role: 'user', content: name, type: 'sticker', image_path: stickerPath });

  var res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(addHomeModeFields({
      message: name,
      type: 'sticker',
      sticker_path: stickerPath,
      mcpServers: mcpServers,
    })),
  });
  var data = await res.json();
  if (!res.ok) { if(data.user_message_id)userRow.dataset.id=data.user_message_id;else userRow.remove(); throw new Error(data.error || '请求失败'); }
  if (data.user_message_id) userRow.dataset.id = data.user_message_id;
  // 更新图片路径
  if (data.sticker_path && stickerPath !== data.sticker_path) {
    var img = userRow.querySelector('.sticker-bubble img');
    if (img) img.src = data.sticker_path;
  }
  renderToolNotifications(data.tool_calls);
  renderToolWarnings(data.warnings);
  renderAiReply(data.reply, data.ai_message_id);
  renderEconomyItems(data.economy_messages);
}

function renderToolWarnings(warnings) {
  for (const warning of warnings || []) if (warning.code === 'TOOL_LIMIT_REACHED') {
    const count = (warning.skipped || []).length;
    showToast(count ? '本轮工具达到上限，'+count+' 项操作未执行，请核对结果' : '本轮工具达到上限，请核对已执行的操作');
  }
}

async function sendTextChunk(text, mcpServers, isLast) {
  var userRow = renderMessage({ role: 'user', content: text, type: 'text' });

  var res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(addHomeModeFields({
      message: text,
      type: 'text',
      mcpServers: mcpServers,
    })),
  });
  var data = await res.json();
  if (!res.ok) {
    if (data.user_message_id) userRow.dataset.id = data.user_message_id;
    else userRow.remove();
    if (!data.partial_actions) document.getElementById('msg-input').value = text;
    throw new Error((data.partial_actions ? '部分操作可能已完成，请先核对。' : '') + (data.error || '请求失败'));
  }
  if (data.user_message_id) userRow.dataset.id = data.user_message_id;
  renderToolNotifications(data.tool_calls);
  renderToolWarnings(data.warnings);
  renderAiReply(data.reply, data.ai_message_id);
  renderEconomyItems(data.economy_messages);
}

function disableSend(disabled) {
  document.getElementById('send-btn').disabled = disabled;
}

// ========== 消息列表加载 ==========
async function loadInitial() {
  const [personaRes, configRes, messagesRes] = await Promise.all([
    fetch('/api/persona').then((r) => r.json()),
    fetch('/api/config').then((r) => r.json()),
    fetch('/api/messages?limit=50').then((r) => r.json()),
    loadFavoritedIds(),
  ]);

  persona = personaRes;
  appConfig = configRes;
  var titleSpan = document.getElementById('chat-title-text');
  if (titleSpan) titleSpan.textContent = persona.ai_name || '聊天';
  if (appConfig.background_path) {
    document.body.style.backgroundImage = `url('${appConfig.background_path}')`;
  }

  const messages = messagesRes.messages || [];

  // 根据最后一条 mode_switch 消息恢复模式状态
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'mode_switch') {
      try {
        var switchData = JSON.parse(messages[i].content);
        inHomeMode = (switchData.action === 'home_enter');
      } catch (_) {}
      break;
    }
  }
  // 恢复环境描写
  for (var i2 = messages.length - 1; i2 >= 0; i2--) {
    if (messages[i2].type === 'home_env') {
      homeEnvDescription = messages[i2].content || '';
      lastHomeEnvMsgId = messages[i2].id;
      break;
    }
  }
  if (inHomeMode) {
    var btn = document.getElementById('home-mode-btn');
    if (btn) btn.classList.add('active');
  }
  // 初始化表情按钮状态
  updateStickerButtonMode();

  messages.forEach((m) => {
    maybeInsertTimeDivider(m.created_at);
    let row;
    var isEconType = m.type === 'red_packet' || m.type === 'gift' || m.type === 'food_delivery';
    if (m.role === 'ai' && !isEconType) {
      // AI消息统一走 renderAiReply，自动处理 [voice]/[image] 标记
      row = renderAiReply(m.content, m.id);
    } else {
      row = renderMessage(m);
    }
    // 给未加TTS按钮的AI文字气泡补上
    if (m.role === 'ai' && (m.type || 'text') === 'text' && !row.dataset.ttsAttached) {
      attachTTSButton(row);
    }
  });
  if (messages.length > 0) oldestLoadedId = messages[0].id;

  // 从收藏页跳转过来时，滚动到目标消息
  if (window.location.hash && window.location.hash.startsWith('#msg-')) {
    var targetId = window.location.hash.replace('#msg-', '');
    setTimeout(function() {
      var targetRow = document.querySelector('.msg-row[data-id="' + targetId + '"]');
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.style.outline = '2px solid var(--color-gold)';
        targetRow.style.outlineOffset = '2px';
        targetRow.style.borderRadius = '4px';
        setTimeout(function() { targetRow.style.outline = ''; targetRow.style.outlineOffset = ''; targetRow.style.borderRadius = ''; }, 2500);
      }
    }, 300);
  }
}

// ========== 事件绑定 ==========
var homeModeBtn = document.getElementById('home-mode-btn');
if (homeModeBtn) {
  homeModeBtn.addEventListener('click', toggleHomeMode);
}
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isRecording()) sendMessage();
  }
});

// 导出（如果页面上有 export-link 元素）
var exportLink = document.getElementById('export-link');
if (exportLink) {
  exportLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/api/messages/export';
  });
}

// 麦克风按钮：点击开始/结束录音
document.getElementById('mic-btn').addEventListener('click', () => {
  if (isRecording()) {
    stopRecording();
  } else {
    startRecording();
  }
});

// 图片按钮（入口已移至加号面板，此处保留空值保护以防元素不存在）
var imgBtn = document.getElementById('img-btn');
if (imgBtn) imgBtn.addEventListener('click', triggerImagePick);
document.getElementById('img-file-input').addEventListener('change', (e) => {
  handleImagePicked(e.target.files[0]);
  e.target.value = ''; // 允许重复选同一文件
});

// ========== 聊天顶部名称 ==========
async function loadChatTitle() {
  const titleEl = document.getElementById('chat-title-text');
  if (!titleEl) return;

  try {
    // 并行获取 AI 社交资料和备注
    const [profileRes, remarkRes] = await Promise.all([
      fetch('/api/social/profile/ai'),
      fetch('/api/social/ai-remark'),
    ]);
    const profileData = await profileRes.json();
    const remarkData = await remarkRes.json();

    const aiNickname = (profileData.profile && profileData.profile.nickname) || '';
    const remark = remarkData.remark || '';

    if (remark) {
      titleEl.textContent = remark;
      titleEl.title = aiNickname ? 'AI 昵称：' + aiNickname : '';
    } else if (aiNickname) {
      titleEl.textContent = aiNickname;
      titleEl.title = '';
    }
    // 如果都没设，保持默认 "聊天"
  } catch (err) {
    console.error('加载聊天标题失败:', err);
    showToast('聊天标题加载失败');
  }
}

// 备注内联编辑
(function() {
  var pencilBtn = document.getElementById('chat-remark-btn');
  var titleSpan = document.getElementById('chat-title-text');
  var titleDiv = document.getElementById('chat-title');
  if (!pencilBtn || !titleSpan || !titleDiv) return;

  var input = null;

  function startEdit() {
    var currentText = titleSpan.textContent;
    if (currentText === '聊天') currentText = '';

    input = document.createElement('input');
    input.type = 'text';
    input.id = 'chat-remark-input';
    input.value = currentText;
    input.placeholder = '备注名';
    input.maxLength = 20;

    titleSpan.style.display = 'none';
    titleDiv.insertBefore(input, pencilBtn);
    input.focus();
  }

  async function saveEdit() {
    if (!input) return;
    var remark = input.value.trim();
    input.remove();
    input = null;
    titleSpan.style.display = '';

    // 1. 先保存备注，并确认成功后才继续通知 AI
    let saveOk = false;
    try {
      const saveRes = await fetch('/api/social/ai-remark', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: remark }),
        keepalive: true,
      });
      saveOk = saveRes.ok;
    } catch (err) {
      // 页面跳转等场景请求被中断，视为保存失败
      saveOk = false;
    }

    if (!saveOk) {
      // 保存失败就不通知 AI，避免"AI 知道改了备注、界面却没存下来"的割裂
      showToast('备注保存失败，请重试');
      return;
    }

    // 2. 保存成功后才通知 AI
    if (remark) {
      await fetch('/api/messages/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '[系统通知] 用户给你设了新备注：「' + remark + '」' }),
        keepalive: true,
      });
    } else {
      await fetch('/api/messages/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '[系统通知] 用户删除了你的备注' }),
        keepalive: true,
      });
    }

    loadChatTitle();
  }

  pencilBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (input) return;
    startEdit();
  });

  document.addEventListener('click', function(e) {
    if (input && !e.target.closest('#chat-title')) {
      saveEdit();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (input && e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
  });
  // 手机端键盘"完成"触发 blur，补上保存
  titleDiv.addEventListener('blur', function(e) {
    if (input && e.target === input) {
      setTimeout(function() { if (input) saveEdit(); }, 100);
    }
  }, true);
})();

// ========== WebSocket 来电监听 ==========

window.wsClient.on('incoming_call', function(msg) {
  if (window.triggerIncomingCall) {
    window.triggerIncomingCall(msg.firstMessage || '');
  } else {
    // 如果当前页面没有 triggerIncomingCall（不在 voiceCall 页面），
    // 导航到 voiceCall 页面并触发来电
    window.open('/voiceCall.html#incoming=' + encodeURIComponent(msg.firstMessage || ''), '_self');
  }
});

// ========== 收藏页面入口 ==========
var favPageBtn = document.getElementById('fav-page-btn');
if (favPageBtn) {
  favPageBtn.addEventListener('click', function() {
    window.location.href = 'favorites.html';
  });
}

// ========== 加号面板 (Plus Panel) ==========
(function() {
  var plusBtn = document.getElementById('plus-btn');
  var panel = document.getElementById('plus-panel');
  if (!plusBtn || !panel) return;

  function openPanel() {
    // 从表情面板切换过来时，去掉动画避免输入框跳动
    var stickerPanel = document.getElementById('sticker-panel');
    if (stickerPanel && stickerPanel.classList.contains('show')) {
      panel.style.transition = 'none';
    }
    closeStickerPanel();
    panel.classList.add('show');
    if (panel.style.transition === 'none') {
      panel.offsetHeight; // 强制回流
      panel.style.transition = '';
    }
  }

  function closePanel() {
    panel.classList.remove('show');
  }

  plusBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (panel.classList.contains('show')) {
      closePanel();
    } else {
      openPanel();
    }
  });

  // 点击面板外的聊天区域关闭面板
  document.getElementById('chat-container').addEventListener('click', function() {
    if (panel.classList.contains('show')) closePanel();
    closeStickerPanel();
  });

  panel.addEventListener('click', function(e) {
    var item = e.target.closest('.plus-item');
    if (!item) return;
    var action = item.dataset.action;
    closePanel();

    switch (action) {
      case 'image':
        triggerImagePick();
        break;
      case 'voice_call':
        window.location.href = 'voiceCall.html#dial';
        break;
      case 'red_packet':
        showEconomyDialog('red_packet', '发红包');
        break;
      case 'gift':
        showEconomyDialog('gift', '送礼物');
        break;
      case 'food_delivery':
        showEconomyDialog('food_delivery', '点外卖');
        break;
      case 'favorites':
        window.location.href = 'favorites.html';
        break;
    }
  });
})();

// ========== 经济弹窗 ==========
function showEconomyDialog(type, title) {
  var existing = document.querySelector('.econ-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'econ-modal-overlay';

  var card = document.createElement('div');
  card.className = 'econ-modal-card';

  var titleEl = document.createElement('div');
  titleEl.className = 'econ-modal-title';
  titleEl.textContent = title;

  card.appendChild(titleEl);

  // 物品名输入（红包不需要）
  if (type !== 'red_packet') {
    var nameField = document.createElement('div');
    nameField.className = 'econ-modal-field';
    var nameLabel = document.createElement('label');
    nameLabel.textContent = type === 'gift' ? '礼物名称' : '菜品名称';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = type === 'gift' ? '如：一束玫瑰花' : '如：一杯珍珠奶茶';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    card.appendChild(nameField);
  }

  // 金额输入
  var amountField = document.createElement('div');
  amountField.className = 'econ-modal-field';
  var amountLabel = document.createElement('label');
  amountLabel.textContent = type === 'red_packet' ? '红包金额（元）' : '价格（元）';
  var amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.min = '0.01';
  amountInput.step = '0.01';
  amountInput.placeholder = type === 'red_packet' ? '如：6.66' : '如：25.00';
  amountField.appendChild(amountLabel);
  amountField.appendChild(amountInput);
  card.appendChild(amountField);

  // 按钮
  var actions = document.createElement('div');
  actions.className = 'econ-modal-actions';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'econ-btn-cancel';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', function() { overlay.remove(); });

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'econ-btn-confirm';
  confirmBtn.textContent = '发送';
  confirmBtn.addEventListener('click', function() {
    var amount = parseFloat(amountInput.value);
    if (isNaN(amount) || amount <= 0) {
      showToast('请输入有效金额');
      return;
    }
    var itemName = '';
    if (type !== 'red_packet') {
      itemName = (card.querySelector('input[type="text"]') || {}).value || '';
      if (!itemName.trim()) {
        showToast('请输入' + (type === 'gift' ? '礼物名称' : '菜品名称'));
        return;
      }
    }
    overlay.remove();
    sendEconomyItem(type, amount, itemName.trim());
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // 自动聚焦
  var firstInput = type !== 'red_packet'
    ? card.querySelector('input[type="text"]')
    : amountInput;
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);

  // 回车确认
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmBtn.click();
  });

  // 点击遮罩关闭
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

// ========== 发送经济物品 ==========
async function sendEconomyItem(type, amount, itemName) {
  maybeInsertTimeDivider(new Date().toISOString());

  // 乐观渲染用户侧气泡
  var content = JSON.stringify({ item_name: itemName || '红包', amount: amount, sender: 'user', recipient: 'ai' });
  var row = renderMessage({
    role: 'user',
    type: type,
    content: content,
  });

  disableSend(true);
  try {
    // 1. 记录交易
    var econRes = await fetch('/api/economy/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, item_name: itemName || '红包', amount: amount }),
    });
    var econData = await econRes.json();
    if (!econRes.ok) throw new Error(econData.error || '发送失败');
    if (econData.message && econData.message.id) row.dataset.id = econData.message.id;

    // 2. 触发 AI 回复
    var displayText = '';
    if (type === 'red_packet') {
      displayText = '我发了一个' + amount + '元的红包给你';
    } else if (type === 'gift') {
      displayText = '我送了一份' + itemName + '给你（价值' + amount + '元）';
    } else {
      displayText = '我给你点了一份' + itemName + '（价值' + amount + '元）';
    }

    var mcpServers = await getMcpServers();
    var chatRes = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addHomeModeFields({
        message: displayText,
        type: 'text',
        hidden_mode: true,
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
      })),
    });
    var chatData = await chatRes.json();
    if (!chatRes.ok) throw new Error(chatData.error || '请求失败');

    renderToolNotifications(chatData.tool_calls);
    renderAiReply(chatData.reply, chatData.ai_message_id);
    renderEconomyItems(chatData.economy_messages);
  } catch (err) {
    showToast('发送失败: ' + err.message);
  } finally {
    disableSend(false);
  }
}

// ========== 经济气泡渲染 ==========
function parseEconContent(content) {
  try { return JSON.parse(content); } catch (_) { return {}; }
}

function renderRedPacketBubble(msg) {
  var data = parseEconContent(msg.content || '{}');
  var amount = data.amount || 0;
  return '<div class="bubble red-packet-bubble">' +
    '<div class="rp-icon">' +
      '<svg viewBox="0 0 24 24" width="34" height="34" stroke="#ff9fc0" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="5" y="4" width="14" height="18" rx="2"/>' +
        '<path d="M5 9l7 5 7-5"/>' +
      '</svg>' +
    '</div>' +
    '<div class="rp-amount">' + escapeHtml(amount.toFixed(2)) + '元</div>' +
    '<div class="rp-label">红包</div>' +
    '</div>';
}

function renderGiftBubble(msg) {
  var data = parseEconContent(msg.content || '{}');
  return '<div class="bubble gift-bubble">' +
    '<div class="gift-icon">' +
      '<svg viewBox="0 0 24 24" width="34" height="34" stroke="#d4a0e8" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="20 12 20 22 4 22 4 12"/>' +
        '<rect x="2" y="7" width="20" height="5"/>' +
        '<line x1="12" y1="22" x2="12" y2="7"/>' +
        '<path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>' +
        '<path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' +
      '</svg>' +
    '</div>' +
    '<div class="gift-name">' + escapeHtml(data.item_name || '礼物') + '</div>' +
    '<div class="gift-price">' + escapeHtml((data.amount || 0).toFixed(2)) + '元</div>' +
    '</div>';
}

function renderFoodDeliveryBubble(msg) {
  var data = parseEconContent(msg.content || '{}');
  return '<div class="bubble food-bubble">' +
    '<div class="food-icon">' +
      '<svg viewBox="0 0 24 24" width="34" height="34" stroke="#f0c898" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/>' +
        '<path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>' +
        '<line x1="6" y1="1" x2="6" y2="4"/>' +
        '<line x1="10" y1="1" x2="10" y2="4"/>' +
        '<line x1="14" y1="1" x2="14" y2="4"/>' +
      '</svg>' +
    '</div>' +
    '<div class="food-name">' + escapeHtml(data.item_name || '外卖') + '</div>' +
    '<div class="food-price">' + escapeHtml((data.amount || 0).toFixed(2)) + '元</div>' +
    '</div>';
}

function renderEconomyItems(economyMessages) {
  if (!economyMessages || !Array.isArray(economyMessages)) return;
  economyMessages.forEach(function(item) {
    maybeInsertTimeDivider(new Date().toISOString());
    renderMessage({
      id: item.msg_id,
      role: 'ai',
      type: item.type,
      content: item.content,
    });
  });
}

loadChatTitle();
loadInitial().catch(function(err) {
  console.error('聊天初始化失败:', err);
  showToast('加载失败，请刷新页面重试');
});
