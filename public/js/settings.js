// js/settings.js — 设置页逻辑（Tab式布局：模型 / 外观 / MCP）

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ========== Tab切换 ==========

const tabs = document.querySelectorAll('.settings-tab');
const tabContents = document.querySelectorAll('.settings-tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    tabContents.forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + target).classList.add('active');

    // 切换到MCP时刷新列表
    if (target === 'mcp') loadMcpServers();
  });
});

// ========== 模型Tab ==========

async function loadModelSettings() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  document.getElementById('api_base_url').value = s.api_base_url || '';
  document.getElementById('api_key').value = s.api_key || '';
  document.getElementById('model').value = s.model || '';

  const temp = s.temperature ?? 0.8;
  document.getElementById('temperature').value = temp;
  document.getElementById('temp-value').textContent = temp;

  const tokens = s.max_tokens ?? 4096;
  document.getElementById('max_tokens').value = tokens;
  document.getElementById('tokens-value').textContent = tokens;

  // 视觉模型配置
  document.getElementById('vision_api_base_url').value = s.vision_api_base_url || '';
  document.getElementById('vision_api_key').value = s.vision_api_key || '';
  document.getElementById('vision_model').value = s.vision_model || '';

  // 生图模型配置
  document.getElementById('image_gen_api_base_url').value = s.image_gen_api_base_url || '';
  document.getElementById('image_gen_api_key').value = s.image_gen_api_key || '';
  document.getElementById('image_gen_model').value = s.image_gen_model || '';

  // TTS 配置
  document.getElementById('tts_api_url').value = s.tts_api_url || '';
  document.getElementById('tts_api_key').value = s.tts_api_key || '';
}

// Slider联动数字显示
document.getElementById('temperature').addEventListener('input', (e) => {
  document.getElementById('temp-value').textContent = parseFloat(e.target.value).toFixed(1);
});

document.getElementById('max_tokens').addEventListener('input', (e) => {
  document.getElementById('tokens-value').textContent = e.target.value;
});

// 保存模型设置
document.getElementById('save-model-btn').addEventListener('click', async () => {
  const payload = {
    api_base_url: document.getElementById('api_base_url').value.trim(),
    api_key: document.getElementById('api_key').value.trim(),
    model: document.getElementById('model').value.trim(),
    temperature: parseFloat(document.getElementById('temperature').value),
    max_tokens: parseInt(document.getElementById('max_tokens').value, 10),
  };

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    showToast('模型设置已保存');
  } else {
    showToast('保存失败');
  }
});

// 保存视觉设置
document.getElementById('save-vision-btn').addEventListener('click', async () => {
  const payload = {
    vision_api_base_url: document.getElementById('vision_api_base_url').value.trim(),
    vision_api_key: document.getElementById('vision_api_key').value.trim(),
    vision_model: document.getElementById('vision_model').value.trim(),
  };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  showToast(res.ok ? '视觉设置已保存' : '保存失败');
});

// 保存生图设置
document.getElementById('save-image-gen-btn').addEventListener('click', async () => {
  const payload = {
    image_gen_api_base_url: document.getElementById('image_gen_api_base_url').value.trim(),
    image_gen_api_key: document.getElementById('image_gen_api_key').value.trim(),
    image_gen_model: document.getElementById('image_gen_model').value.trim(),
  };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  showToast(res.ok ? '生图设置已保存' : '保存失败');
});

// 保存 TTS 设置
document.getElementById('save-tts-btn').addEventListener('click', async () => {
  const payload = {
    tts_api_url: document.getElementById('tts_api_url').value.trim(),
    tts_api_key: document.getElementById('tts_api_key').value.trim(),
  };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  showToast(res.ok ? 'TTS 设置已保存' : '保存失败');
});

// ========== 外观Tab ==========

document.getElementById('bg-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error || '上传失败');

    const cfgRes = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ background_path: uploadData.path }),
    });
    if (!cfgRes.ok) throw new Error('背景保存失败');

    showToast('背景已更新，返回聊天页查看');
  } catch (err) {
    showToast(err.message);
  }
});

// ========== 书架背景配置 ==========

const BS_BG_FIELDS = [
  { inputId: 'bs-page-bg-input', clearId: 'bs-page-bg-clear', key: 'bookshelf_page_bg' },
  { inputId: 'bs-diary-user-bg-input', clearId: 'bs-diary-user-bg-clear', key: 'bookshelf_card_diary_user_bg' },
  { inputId: 'bs-diary-ai-bg-input', clearId: 'bs-diary-ai-bg-clear', key: 'bookshelf_card_diary_ai_bg' },
  { inputId: 'bs-stories-bg-input', clearId: 'bs-stories-bg-clear', key: 'bookshelf_card_stories_bg' },
  { inputId: 'bs-books-bg-input', clearId: 'bs-books-bg-clear', key: 'bookshelf_card_books_bg' },
];

BS_BG_FIELDS.forEach(({ inputId, clearId, key }) => {
  const inputEl = document.getElementById(inputId);
  const clearEl = document.getElementById(clearId);
  if (!inputEl || !clearEl) return;

  inputEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || '上传失败');

      const body = {};
      body[key] = uploadData.path;
      const cfgRes = await fetch('/api/bookshelf-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!cfgRes.ok) throw new Error('保存失败');
      showToast('书架背景已更新');
    } catch (err) {
      showToast(err.message);
    }
  });

  clearEl.addEventListener('click', async () => {
    try {
      const body = {};
      body[key] = '';
      const cfgRes = await fetch('/api/bookshelf-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!cfgRes.ok) throw new Error('清除失败');
      inputEl.value = '';
      showToast('已清除');
    } catch (err) {
      showToast(err.message);
    }
  });
});

// ========== MCP Tab ==========

let mcpServers = [];
let openAccordionId = null;

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadMcpServers() {
  try {
    const res = await fetch('/api/mcp/servers');
    const data = await res.json();
    const globalEnabled = !!data.global_enabled;
    document.getElementById('mcp-global-enabled').checked = globalEnabled;
    document.getElementById('mcp-global-label').textContent = globalEnabled ? '已启用' : '接入AI对话API后开启';
    mcpServers = data.servers || [];
    renderMcpAccordion();
  } catch (err) {
    console.error('加载MCP配置失败', err);
  }
}

function renderMcpAccordion() {
  const container = document.getElementById('mcp-accordion');
  const wasOpen = openAccordionId;

  if (!mcpServers.length) {
    container.innerHTML = '<div class="mcp-empty-state">尚未配置MCP服务器</div>';
    openAccordionId = null;
    return;
  }

  container.innerHTML = mcpServers.map(s => {
    const isOpen = s.id === openAccordionId;
    const headers = typeof s.headers === 'object' ? s.headers : {};
    const headerEntries = Object.entries(headers);
    const hasTools = false; // 未连接状态
    const isNew = !s.id; // id 为临时负数表示新建中的条目

    return `
    <div class="mcp-accordion-item${isOpen ? ' open' : ''}" data-id="${s.id}">
      <div class="mcp-accordion-header" data-action="toggle" data-id="${s.id}">
        <span class="mcp-status-dot${s.enabled ? ' active' : ''}"></span>
        <span class="mcp-accordion-name">${escHtml(s.name || '未命名')}</span>
        <label class="toggle-switch toggle-sm" data-action="toggle-enabled" data-id="${s.id}" style="margin-left:auto;">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <span class="mcp-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </span>
      </div>
      <div class="mcp-accordion-body">
        <div class="mcp-accordion-body-inner">
          <div class="form-field" style="margin-bottom:0;">
            <label>服务器名称</label>
            <input type="text" class="settings-input mcp-field-name" value="${escHtml(s.name || '')}" placeholder="例如：大富翁游戏" />
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label>URL地址</label>
            <input type="url" class="settings-input mcp-field-url" value="${escHtml(s.url || '')}" placeholder="http://localhost:8080/sse" />
          </div>
          <div>
            <div class="mcp-headers-label">Headers</div>
            <div class="mcp-headers-editor" data-id="${s.id}">
              ${headerEntries.map(([k, v], i) => `
              <div class="mcp-header-row">
                <input type="text" class="mcp-header-key" value="${escHtml(k)}" placeholder="Key" />
                <input type="text" class="mcp-header-value" value="${escHtml(v)}" placeholder="Value" />
                <button class="mcp-header-remove" title="移除">&times;</button>
              </div>
              `).join('')}
            </div>
            <button class="mcp-header-add-row" data-id="${s.id}" style="margin-top:4px;">+ 添加Header</button>
          </div>
          <div class="mcp-tools-section">
            <div class="mcp-tools-label">Tools</div>
            <div class="mcp-tools-value">${hasTools ? '' : '未获取（连接MCP Server后自动获取）'}</div>
          </div>
          <div class="mcp-item-actions">
            <button class="mcp-delete-btn-text" data-action="delete" data-id="${s.id}">删除</button>
            <button class="btn-primary" data-action="save" data-id="${s.id}">保存</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // 绑定事件
  bindAccordionEvents();
}

function bindAccordionEvents() {
  const container = document.getElementById('mcp-accordion');

  // Toggle 展开/收起（header 点击，排除开关和按钮）
  container.querySelectorAll('[data-action="toggle"]').forEach(header => {
    header.addEventListener('click', (e) => {
      // 如果点击的是toggle开关内部元素，不触发展开
      if (e.target.closest('[data-action="toggle-enabled"]')) return;
      const id = header.dataset.id;
      toggleAccordion(id);
    });
  });

  // 单条启用/禁用开关（自动保存）
  container.querySelectorAll('[data-action="toggle-enabled"]').forEach(label => {
    label.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = label.dataset.id;
      const checkbox = label.querySelector('input[type="checkbox"]');
      const enabled = checkbox.checked;
      try {
        await fetch(`/api/mcp/servers/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
        });
        // 更新状态圆点
        const item = container.querySelector(`.mcp-accordion-item[data-id="${id}"]`);
        const dot = item.querySelector('.mcp-status-dot');
        if (dot) {
          dot.classList.toggle('active', enabled);
        }
        // 更新本地数据
        const server = mcpServers.find(s => String(s.id) === String(id));
        if (server) server.enabled = enabled ? 1 : 0;
        showToast(enabled ? '已启用' : '已禁用');
      } catch (err) {
        showToast('操作失败');
        checkbox.checked = !enabled;
      }
    });
  });

  // 保存按钮
  container.querySelectorAll('[data-action="save"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await saveMcpServer(id);
    });
  });

  // 删除按钮（二次确认）
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.classList.contains('confirming')) {
        await deleteMcpServer(id);
      } else {
        btn.classList.add('confirming');
        btn.textContent = '确认删除？';
        // 3秒后自动恢复
        setTimeout(() => {
          btn.classList.remove('confirming');
          btn.textContent = '删除';
        }, 3000);
      }
    });
  });

  // 添加Header行
  container.querySelectorAll('.mcp-header-add-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const editor = container.querySelector(`.mcp-headers-editor[data-id="${id}"]`);
      const row = document.createElement('div');
      row.className = 'mcp-header-row';
      row.innerHTML = `
        <input type="text" class="mcp-header-key" placeholder="Key" />
        <input type="text" class="mcp-header-value" placeholder="Value" />
        <button class="mcp-header-remove" title="移除">&times;</button>
      `;
      editor.appendChild(row);
      row.querySelector('.mcp-header-remove').addEventListener('click', () => row.remove());
    });
  });

  // 移除Header行（已有行的删除按钮）
  container.querySelectorAll('.mcp-header-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.closest('.mcp-header-row').remove();
    });
  });
}

function toggleAccordion(id) {
  const container = document.getElementById('mcp-accordion');
  const current = container.querySelector(`.mcp-accordion-item.open`);

  if (current && current.dataset.id === String(id)) {
    // 收起当前
    current.classList.remove('open');
    openAccordionId = null;
  } else {
    // 收起之前展开的
    if (current) current.classList.remove('open');
    // 展开新的
    const target = container.querySelector(`.mcp-accordion-item[data-id="${id}"]`);
    if (target) {
      target.classList.add('open');
      openAccordionId = id;
    }
  }
}

async function saveMcpServer(id) {
  const container = document.getElementById('mcp-accordion');
  const item = container.querySelector(`.mcp-accordion-item[data-id="${id}"]`);
  if (!item) return;

  const name = item.querySelector('.mcp-field-name').value.trim();
  const url = item.querySelector('.mcp-field-url').value.trim();

  if (!name) {
    showToast('请输入服务器名称');
    return;
  }

  // 收集 headers
  const headers = {};
  const editor = item.querySelector(`.mcp-headers-editor[data-id="${id}"]`);
  if (editor) {
    editor.querySelectorAll('.mcp-header-row').forEach(row => {
      const key = row.querySelector('.mcp-header-key').value.trim();
      const val = row.querySelector('.mcp-header-value').value.trim();
      if (key) headers[key] = val;
    });
  }

  try {
    let res;
    if (String(id).startsWith('new_')) {
      // 新建
      res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, headers }),
      });
    } else {
      // 更新
      res = await fetch(`/api/mcp/servers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, headers }),
      });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast('保存失败: ' + (data.error || ''));
      return;
    }

    showToast('已保存');
    openAccordionId = null;
    loadMcpServers();
  } catch (err) {
    showToast('保存失败');
  }
}

async function deleteMcpServer(id) {
  try {
    const res = await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('删除失败');
      return;
    }
    showToast('已删除');
    openAccordionId = null;
    loadMcpServers();
  } catch (err) {
    showToast('删除失败');
  }
}

// 添加按钮：在列表末尾插入新条目（内联展开）
document.getElementById('mcp-add-btn').addEventListener('click', () => {
  // 生成临时ID
  const tempId = 'new_' + Date.now();
  // 如果已有未保存的新条目，先移除
  const existing = document.getElementById('mcp-accordion').querySelector('[data-id^="new_"]');
  if (existing) existing.remove();

  // 插入空白条目到 mcpServers 列表末尾并重新渲染
  mcpServers.push({
    id: tempId,
    name: '',
    url: '',
    description: '',
    enabled: 0,
    headers: {},
  });
  openAccordionId = tempId;
  renderMcpAccordion();

  // 聚焦名称输入框
  setTimeout(() => {
    const input = document.querySelector(`.mcp-accordion-item[data-id="${tempId}"] .mcp-field-name`);
    if (input) input.focus();
  }, 100);
});

// 全局开关
document.getElementById('mcp-global-enabled').addEventListener('change', async (e) => {
  const global_enabled = e.target.checked;
  try {
    await fetch('/api/mcp/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global_enabled: global_enabled ? 1 : 0 }),
    });
    document.getElementById('mcp-global-label').textContent = global_enabled ? '已启用' : '接入AI对话API后开启';
    showToast(global_enabled ? 'MCP已全局启用' : 'MCP已全局关闭');
  } catch (err) {
    showToast('操作失败');
    e.target.checked = !global_enabled;
  }
});

// ========== 消息推送 Tab ==========

var pushElements = {};

function initPushElements() {
  pushElements = {
    enabled: document.getElementById('push-enabled'),
    interval: document.getElementById('push-interval'),
    intervalValue: document.getElementById('push-interval-value'),
    maxDaily: document.getElementById('push-max-daily'),
    morningEnabled: document.getElementById('push-morning-enabled'),
    morningStart: document.getElementById('push-morning-start'),
    morningEnd: document.getElementById('push-morning-end'),
    nightEnabled: document.getElementById('push-night-enabled'),
    nightStart: document.getElementById('push-night-start'),
    nightEnd: document.getElementById('push-night-end'),
    dndStart: document.getElementById('push-dnd-start'),
    dndEnd: document.getElementById('push-dnd-end'),
    subscribeBtn: document.getElementById('push-subscribe-btn'),
    unsubscribeBtn: document.getElementById('push-unsubscribe-btn'),
  };
}

async function loadPushSettings() {
  try {
    var resp = await fetch('/api/proactive/settings');
    var s = await resp.json();
    if (!s || !s.id) return; // 还没初始化

    pushElements.enabled.checked = !!s.enabled;
    pushElements.interval.value = s.check_interval || 30;
    pushElements.intervalValue.textContent = s.check_interval || 30;
    pushElements.maxDaily.value = s.max_daily || 5;
    pushElements.morningEnabled.checked = !!s.morning_enabled;
    pushElements.morningStart.value = s.morning_start || '07:00';
    pushElements.morningEnd.value = s.morning_end || '09:00';
    pushElements.nightEnabled.checked = !!s.night_enabled;
    pushElements.nightStart.value = s.night_start || '22:00';
    pushElements.nightEnd.value = s.night_end || '23:30';
    pushElements.dndStart.value = s.dnd_start || '01:00';
    pushElements.dndEnd.value = s.dnd_end || '07:00';
  } catch (err) {
    console.error('加载推送设置失败:', err);
  }
}

function collectPushSettings() {
  return {
    enabled: pushElements.enabled.checked ? 1 : 0,
    check_interval: parseInt(pushElements.interval.value) || 30,
    max_daily: parseInt(pushElements.maxDaily.value) || 5,
    morning_enabled: pushElements.morningEnabled.checked ? 1 : 0,
    morning_start: pushElements.morningStart.value,
    morning_end: pushElements.morningEnd.value,
    night_enabled: pushElements.nightEnabled.checked ? 1 : 0,
    night_start: pushElements.nightStart.value,
    night_end: pushElements.nightEnd.value,
    dnd_start: pushElements.dndStart.value,
    dnd_end: pushElements.dndEnd.value,
  };
}

async function savePushSettings() {
  try {
    var body = collectPushSettings();
    var resp = await fetch('/api/proactive/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error('保存失败');
    showToast('推送设置已保存');
  } catch (err) {
    console.error('保存推送设置失败:', err);
    showToast('保存失败');
  }
}

// 自动保存：任一控件变化时保存
function bindPushAutoSave() {
  [
    'enabled', 'morningEnabled', 'nightEnabled',
    'morningStart', 'morningEnd', 'nightStart', 'nightEnd',
    'dndStart', 'dndEnd', 'maxDaily',
  ].forEach(function(key) {
    var el = pushElements[key];
    if (!el) return;
    el.addEventListener('change', savePushSettings);
  });

  // 间隔滑块
  if (pushElements.interval) {
    pushElements.interval.addEventListener('input', function() {
      pushElements.intervalValue.textContent = this.value;
    });
    pushElements.interval.addEventListener('change', savePushSettings);
  }
}

// ── Web Push 订阅 ──

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    var reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (err) {
    console.error('SW 注册失败:', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  try {
    var reg = await registerServiceWorker();
    if (!reg) { showToast('浏览器不支持通知'); return; }

    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('需要允许通知权限'); return; }

    // 获取 VAPID 公钥
    var keyResp = await fetch('/api/push/vapid-key');
    if (!keyResp.ok) { showToast('获取推送密钥失败'); return; }
    var keyData = await keyResp.json();

    var subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    });

    var subObj = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subObj),
    });

    showToast('浏览器通知已开启');
    pushElements.subscribeBtn.style.display = 'none';
    pushElements.unsubscribeBtn.style.display = '';
  } catch (err) {
    console.error('订阅推送失败:', err);
    showToast('开启通知失败');
  }
}

async function unsubscribeFromPush() {
  try {
    var reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
    }
    showToast('浏览器通知已关闭');
    pushElements.subscribeBtn.style.display = '';
    pushElements.unsubscribeBtn.style.display = 'none';
  } catch (err) {
    console.error('取消订阅失败:', err);
  }
}

async function checkSubscriptionStatus() {
  try {
    var reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    var sub = await reg.pushManager.getSubscription();
    if (sub) {
      // 已订阅
      if (Notification.permission === 'granted') {
        pushElements.subscribeBtn.style.display = 'none';
        pushElements.unsubscribeBtn.style.display = '';
      }
    }
  } catch (_) {}
}

// ========== 初始化 ==========
initPushElements();
loadPushSettings();
bindPushAutoSave();
checkSubscriptionStatus();

if (pushElements.subscribeBtn) {
  pushElements.subscribeBtn.addEventListener('click', subscribeToPush);
}
if (pushElements.unsubscribeBtn) {
  pushElements.unsubscribeBtn.addEventListener('click', unsubscribeFromPush);
}

loadModelSettings();
