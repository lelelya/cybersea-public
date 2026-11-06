// js/persona.js — 角色设定页（v6 学生证，铅笔按钮切换编辑）

const FIELDS = ['name', 'gender', 'height', 'age', 'birthday'];
const OWNERS = ['ai', 'user'];

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
}

let current = {};
let saving = false;

async function load() {
  const res = await fetch('/api/persona');
  current = await res.json();

  OWNERS.forEach(owner => {
    FIELDS.forEach(field => {
      const val = current[owner + '_' + field] || '';
      const display = document.getElementById(owner + '_' + field + '_display');
      const input = document.getElementById(owner + '_' + field);
      if (display) display.textContent = val || '—';
      if (input) input.value = val;
    });
  });

  // 外貌 textarea
  document.getElementById('ai_appearance').value = current.ai_appearance || '';
  document.getElementById('user_appearance').value = current.user_appearance || '';

  setupToggle('ai');
  setupToggle('user');
  setupPortrait('ai');
  setupPortrait('user');

  // 铅笔按钮点击 → 进入编辑模式
  document.querySelectorAll('.id-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.id-field-row');
      const display = row.querySelector('.id-field-display');
      const input = row.querySelector('.id-field-input');
      enterEdit(row, display, input);
    });
  });

  // 点击空白处 → 退出所有编辑并保存
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.id-field-row')) {
      exitAllEdits();
    }
  });

  // 外貌 textarea blur 自动保存
  document.querySelectorAll('.id-appearance-textarea').forEach(el => {
    el.addEventListener('blur', autoSave);
  });
}

function enterEdit(row, display, input) {
  display.style.display = 'none';
  input.style.display = '';
  input.focus();
  input.select();

  // blur 时退出编辑
  input.addEventListener('blur', () => {
    display.textContent = input.value || '—';
    display.style.display = '';
    input.style.display = 'none';
    autoSave();
  }, { once: true });

  // Enter 键退出
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  }, { once: true });
}

function exitAllEdits() {
  document.querySelectorAll('.id-field-input:not([style*="display: none"])').forEach(input => {
    const row = input.closest('.id-field-row');
    const display = row.querySelector('.id-field-display');
    display.textContent = input.value || '—';
    display.style.display = '';
    input.style.display = 'none';
  });
  autoSave();
}

function renderPortrait(owner) {
  const img = document.getElementById(owner + '-portrait-img');
  const placeholder = document.getElementById(owner + '-portrait-placeholder');
  const src = current[owner + '_portrait_path'] || img.dataset.defaultSrc || '';
  if (src && img.getAttribute('src') !== src) img.src = src;
  img.hidden = !src || !img.complete || !img.naturalWidth;
  placeholder.hidden = !img.hidden;
  img.closest('.id-card').classList.toggle('has-portrait', !img.hidden);
}

function setupPortrait(owner) {
  const picker = document.getElementById(owner + '-portrait-picker');
  const input = document.getElementById(owner + '-portrait-input');
  const img = document.getElementById(owner + '-portrait-img');
  img.addEventListener('load', () => renderPortrait(owner));
  img.addEventListener('error', () => renderPortrait(owner));
  picker.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
      if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
      picker.disabled = true;
      picker.setAttribute('aria-busy', 'true');
      const preview = URL.createObjectURL(file);
      try {
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = resolve;
          image.onerror = () => reject(new Error('图片无法读取，请重新选择'));
          image.src = preview;
        });
      } finally { URL.revokeObjectURL(preview); }
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/persona/' + owner + '/portrait', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '上传失败');
      current[owner + '_portrait_path'] = data.path;
      renderPortrait(owner);
      showToast('立绘已保存');
    } catch (err) { showToast(err.message || '立绘上传失败'); }
    finally {
      picker.disabled = false;
      picker.removeAttribute('aria-busy');
      input.value = '';
    }
  });
  renderPortrait(owner);
}

/* Keep the appearance editor independent of the image picker. */
function setupToggle(owner) {
  const btn = document.getElementById(owner + '-toggle');
  const picker = document.getElementById(owner + '-portrait-picker');
  const panel = document.getElementById(owner + '-appearance-panel');
  if (!btn || !panel) return;
  let showingAppearance = false;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showingAppearance = !showingAppearance;
    picker.hidden = showingAppearance;
    panel.style.display = showingAppearance ? 'flex' : 'none';
    btn.style.background = showingAppearance ? 'var(--color-primary-soft)' : '';
    btn.setAttribute('aria-pressed', String(showingAppearance));
  });
}



// ── 自动保存 ──

async function autoSave() {
  if (saving) return;

  const payload = {
    ai_name: getVal('ai_name'),
    ai_gender: getVal('ai_gender'),
    ai_height: getVal('ai_height'),
    ai_age: getVal('ai_age'),
    ai_birthday: getVal('ai_birthday'),
    ai_appearance: document.getElementById('ai_appearance').value,
    user_name: getVal('user_name'),
    user_gender: getVal('user_gender'),
    user_height: getVal('user_height'),
    user_age: getVal('user_age'),
    user_birthday: getVal('user_birthday'),
    user_appearance: document.getElementById('user_appearance').value,
    ai_avatar_path: current.ai_avatar_path,
    user_avatar_path: current.user_avatar_path,
  };

  saving = true;
  try {
    const res = await fetch('/api/persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast('保存失败: ' + (data.error || ''));
    }
  } catch (err) {
    showToast('保存失败: ' + err.message);
  } finally {
    saving = false;
  }
}

function getVal(id) {
  const input = document.getElementById(id);
  const display = document.getElementById(id + '_display');
  if (input && input.style.display !== 'none') return input.value;
  if (display) return display.textContent === '—' ? '' : display.textContent;
  return '';
}

// ========== 固定设定 ==========

let fixedSettings = [];

function parseFixedSettings(raw) {
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function renderFixedSettings() {
  var list = document.getElementById('fixed-settings-list');
  if (!list) return;
  list.innerHTML = fixedSettings.map(function(text, idx) {
    return '<div class="fixed-item" data-idx="' + idx + '" style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;">' +
      '<textarea class="fixed-text" placeholder="补充设定..." style="flex:1;font-size:15px;background:none;border:none;border-bottom:1px solid var(--color-border);color:var(--color-text);padding:4px 2px;outline:none;resize:none;overflow:hidden;line-height:1.5;font-family:inherit;transition:border-color 0.2s;" onfocus="this.style.borderBottomColor=\'var(--color-primary)\'" onblur="this.style.borderBottomColor=\'var(--color-border)\'" rows="1">' + escapeHtml(text || '') + '</textarea>' +
      '<button class="fixed-del-btn" style="background:none;border:none;color:var(--color-text-muted);cursor:pointer;padding:2px 2px;flex-shrink:0;opacity:0;transition:opacity 0.15s;margin-top:4px;">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.fixed-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.parentElement.dataset.idx);
      fixedSettings.splice(idx, 1);
      saveFixedSettings();
      renderFixedSettings();
    });
  });

  list.querySelectorAll('.fixed-text').forEach(function(textarea) {
    // 自动调整高度
    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
    textarea.addEventListener('input', autoResize);
    // 初始调整
    setTimeout(autoResize, 0);

    textarea.addEventListener('blur', function() {
      var idx = parseInt(textarea.parentElement.dataset.idx);
      fixedSettings[idx] = textarea.value.trim();
      saveFixedSettings();
    });
  });
}

async function saveFixedSettings() {
  try {
    await fetch('/api/persona', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed_settings: JSON.stringify(fixedSettings) }),
    });
  } catch (_) {}
}

document.getElementById('add-fixed-btn').addEventListener('click', function() {
  fixedSettings.push('');
  renderFixedSettings();
  // 聚焦新添加的输入框
  var inputs = document.querySelectorAll('.fixed-text');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// 初始化
fixedSettings = parseFixedSettings(current.fixed_settings);
renderFixedSettings();

// 在 load() 之后刷新固定设定
var origLoad = load;
load = async function() {
  await origLoad();
  fixedSettings = parseFixedSettings(current.fixed_settings);
  renderFixedSettings();
};

load();
