// js/letters.js — 信件页面逻辑（深海信封 + 信纸质感）

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ========== 状态 ==========
let currentFilter = 'all';
let currentStationery = 'deep-blue';
let replyTargetId = null;
let persona = null;

// ========== API 函数 ==========
async function fetchLetters(filter) {
  const params = filter && filter !== 'all' ? `?author=${filter}` : '';
  const res = await fetch(`/api/letters${params}`);
  const data = await res.json();
  return data.letters || [];
}

async function fetchThread(letterId) {
  const res = await fetch(`/api/letters/${letterId}/thread`);
  const data = await res.json();
  return data;
}

async function createLetter(data) {
  const res = await fetch('/api/letters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '发送失败');
  }
  return res.json();
}

async function replyToLetter(letterId, data) {
  const res = await fetch(`/api/letters/${letterId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '回复失败');
  }
  return res.json();
}

async function updateLetter(letterId, data) {
  const res = await fetch(`/api/letters/${letterId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '保存失败');
  }
  return res.json();
}

async function deleteLetter(letterId) {
  const res = await fetch(`/api/letters/${letterId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '删除失败');
  }
}

async function markAsRead(letterId, letterIds) {
  const res = await fetch(`/api/letters/${letterId}/read`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({letter_ids:letterIds}) });
  if (!res.ok) throw new Error('未能保存已读状态');
}

// ========== 信封颜色常量 ==========
const ENV_COLORS = {
  ai:   { hex: '#5b9eff', css: '#5b9eff' },
  user: { hex: '#ff7eb3', css: '#ff7eb3' },
};

// ========== 渲染信封列表 ==========
async function loadLetters() {
  const letters = await fetchLetters(currentFilter);
  const container = document.getElementById('letters-list');

  if (letters.length === 0) {
    const filterLabel = currentFilter === 'ai' ? 'TA还没给你写过信' : currentFilter === 'user' ? '你还没写过信' : '还没有任何信件';
    const subHint = currentFilter === 'all' ? '点击右上角写第一封信吧' : '';
    container.innerHTML = `<div class="letters-empty">${filterLabel}${subHint ? `<br><span style="font-size:12px;opacity:0.7;">${subHint}</span>` : ''}</div>`;
    return;
  }

  if (currentFilter === 'ai' || currentFilter === 'user') {
    // 分类视图：每封信两列网格排列
    container.innerHTML = `
      <div class="letters-grid">
        ${letters.map((l) => renderEnvelopeCard(l)).join('')}
      </div>
    `;
  } else {
    // 全部视图：有回信成对占整行，无回信两列网格排列
    let html = '<div class="letters-grid-2col">';
    let pairIdx = 0;
    for (const l of letters) {
      if (l.reply) {
        html += renderPairCard(l, l.reply, pairIdx++);
      } else {
        html += renderEnvelopeCard(l);
      }
    }
    html += '</div>';
    container.innerHTML = html;
  }

  bindEnvelopeEvents(container);
}

function renderEnvelopeCard(l) {
  const isAi = l.author === 'ai';
  const authorLabel = isAi ? `from ${persona?.ai_name || 'AI'}` : `from ${persona?.user_name || '我'}`;
  const authorClass = isAi ? 'author-ai' : 'author-user';
  const authorColorClass = isAi ? 'ai' : 'user';
  const isUnread = !l.is_read || l.has_unread_replies;
  const unreadClass = isUnread ? ' unread' : '';
  const preview = (l.content || '').replace(/\n/g, ' ').slice(0, 80);

  return `
    <div class="letter-envelope${unreadClass} ${authorClass}" data-id="${l.id}" data-author="${l.author}">
      <button class="card-menu-btn" data-action="menu">···</button>
      <div class="card-dropdown" data-role="dropdown">
        <button data-action="edit">编辑</button>
        <button data-action="delete" class="danger">删除</button>
      </div>

      <div class="letter-envelope-flap"><svg viewBox="0 0 260 44" preserveAspectRatio="none"><polygon points="0,0 130,44 260,0" fill="none" stroke="rgba(234,241,255,0.12)" stroke-width="1"/></svg></div>
      ${isUnread ? '<div class="unread-dot"></div>' : ''}
      <div class="letter-envelope-body">
        <div class="letter-envelope-author ${authorColorClass}">${escapeHtml(authorLabel)}</div>
        <div class="letter-envelope-title">${escapeHtml(l.title || '(无标题)')}</div>
        <div class="letter-envelope-preview">${escapeHtml(preview)}</div>
        <div class="letter-envelope-meta">
          <span>${escapeHtml(l.created_at)}</span>
        </div>
      </div>

      <div class="card-edit-form">
        <input type="text" class="edit-title" value="${escapeHtml(l.title || '')}" placeholder="标题（选填）" maxlength="100" />
        <textarea class="edit-content" placeholder="信件内容">${escapeHtml(l.content)}</textarea>
        <div class="edit-actions">
          <button class="btn-secondary btn-sm" data-action="cancel-edit">取消</button>
          <button class="btn-primary btn-sm" data-action="save-edit">保存</button>
        </div>
      </div>
    </div>
  `;
}

function renderPairCard(root, reply, pairIdx) {
  const leftIsAi   = root.author === 'ai';
  const rightIsAi  = reply.author === 'ai';
  const leftColor  = ENV_COLORS[root.author].hex;
  const rightColor = ENV_COLORS[reply.author].hex;
  const leftCss    = ENV_COLORS[root.author].css;
  const rightCss   = ENV_COLORS[reply.author].css;
  const gradId     = 'hg' + root.id;

  function cardHTML(l, isAi, colorCss) {
    const authorLabel = isAi ? (persona?.ai_name || 'AI') : (persona?.user_name || '我');
    const preview = (l.content || '').replace(/\n/g, ' ').slice(0, 50);
    const authorCls = isAi ? 'author-ai' : 'author-user';
    return `
      <div class="letter-envelope${!l.is_read || l.has_unread_replies ? ' unread' : ''} ${authorCls}" data-id="${l.id}" data-author="${l.author}">
        <button class="card-menu-btn" data-action="menu">···</button>
        <div class="card-dropdown" data-role="dropdown">
          <button data-action="edit">编辑</button>
          <button data-action="delete" class="danger">删除</button>
        </div>
        <div class="letter-envelope-flap"><svg viewBox="0 0 260 44" preserveAspectRatio="none"><polygon points="0,0 130,44 260,0" fill="none" stroke="rgba(234,241,255,0.12)" stroke-width="1"/></svg></div>
        ${!l.is_read || l.has_unread_replies ? '<div class="unread-dot"></div>' : ''}
        <div class="letter-envelope-body">
          <div class="letter-envelope-author" style="color:${colorCss}">${escapeHtml(authorLabel)}</div>
          <div class="letter-envelope-title">${escapeHtml(l.title || '(无标题)')}</div>
          <div class="letter-envelope-preview">${escapeHtml(preview)}</div>
          <div class="letter-envelope-meta">
            <span>${escapeHtml(l.created_at)}</span>
          </div>
        </div>
        <div class="card-edit-form">
          <input type="text" class="edit-title" value="${escapeHtml(l.title || '')}" placeholder="标题（选填）" maxlength="100" />
          <textarea class="edit-content" placeholder="信件内容">${escapeHtml(l.content)}</textarea>
          <div class="edit-actions">
            <button class="btn-secondary btn-sm" data-action="cancel-edit">取消</button>
            <button class="btn-primary btn-sm" data-action="save-edit">保存</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="letter-pair" data-root-id="${root.id}" data-reply-id="${reply.id}">
      ${cardHTML(root, leftIsAi, leftCss)}
      <div class="letter-pair-connector">
        <div class="letter-pair-line" style="background: ${leftColor};"></div>
        <svg class="letter-pair-heart" viewBox="1 1 22 22" width="20" height="20">
          <defs>
            <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="${leftColor}"/>
              <stop offset="49%" stop-color="${leftColor}"/>
              <stop offset="51%" stop-color="${rightColor}"/>
              <stop offset="100%" stop-color="${rightColor}"/>
            </linearGradient>
          </defs>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                fill="none" stroke="url(#${gradId})" stroke-width="1.2"/>
        </svg>
        <div class="letter-pair-line" style="background: ${rightColor};"></div>
      </div>
      ${cardHTML(reply, rightIsAi, rightCss)}
    </div>
  `;
}

function bindEnvelopeEvents(container) {
  container.querySelectorAll('.letter-envelope').forEach((card) => {
    // 卡片主体点击 → 打开信件详情（排除编辑模式和菜单操作）
    card.addEventListener('click', (e) => {
      if (card.classList.contains('editing')) return;
      if (e.target.closest('[data-action="menu"]')) return;
      if (e.target.closest('[data-role="dropdown"]')) return;
      if (e.target.closest('.card-edit-form')) return;
      const id = card.dataset.id;
      openLetterDetail(id);
    });

    // "···" 菜单按钮
    const menuBtn = card.querySelector('[data-action="menu"]');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = card.querySelector('[data-role="dropdown"]');
      const isOpen = dropdown.classList.contains('show');
      closeAllDropdowns();
      if (!isOpen) {
        dropdown.classList.add('show');
      }
    });

    // 编辑
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      enterEditMode(card);
    });

    // 删除
    card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      if (!confirm('确定删除这封信吗？')) return;
      const id = card.dataset.id;
      try {
        await deleteLetter(id);
        showToast('已删除');
        loadLetters();
      } catch (err) {
        showToast(err.message);
      }
    });

    // 取消编辑
    card.querySelector('[data-action="cancel-edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      exitEditMode(card);
    });

    // 保存编辑
    card.querySelector('[data-action="save-edit"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = card.dataset.id;
      const title = card.querySelector('.edit-title').value.trim();
      const content = card.querySelector('.edit-content').value.trim();

      if (!content) {
        showToast('信件内容不能为空');
        return;
      }

      try {
        await updateLetter(id, { title, content });
        showToast('已保存');
        loadLetters();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.card-dropdown.show').forEach((dd) => {
    dd.classList.remove('show');
  });
}

function enterEditMode(card) {
  card.classList.add('editing');
  const firstInput = card.querySelector('.edit-title');
  if (firstInput) firstInput.focus();
}

function exitEditMode(card) {
  card.classList.remove('editing');
}

// 全局点击关闭所有下拉菜单
document.addEventListener('click', closeAllDropdowns);

// ========== 信件详情弹窗（翻转卡片） ==========
// 将文本按字符数分页
function splitTextToPages(text, charsPerPage) {
  const pages = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cut = charsPerPage;
    if (remaining.length > cut) {
      // 尽量在句号、换行处断页
      const slice = remaining.slice(0, cut);
      const brk = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('，'));
      if (brk > cut * 0.6) cut = brk + 1;
    }
    pages.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return pages.length > 0 ? pages : [''];
}

async function openLetterDetail(letterId) {
  const data = await fetchThread(letterId);
  const thread = data.thread || [];
  if (thread.length === 0) return;

  const letter = thread.find((l) => l.id == letterId) || thread[0];
  const stationery = letter.stationery || 'deep-blue';

  // 每页约 500 字符（15px 字体，约 31 字/行 × 16 行）
  const CHARS_PER_PAGE = 480;
  let allPages = [];

  thread.forEach((l) => {
    const pages = splitTextToPages(l.content, CHARS_PER_PAGE);
    pages.forEach((p) => {
      allPages.push({ content: p, letter: l });
    });
  });

  if (allPages.length === 0) allPages = [{ content: '', letter: thread[0] }];

  let currentPage = 0;
  const overlay = document.getElementById('letter-detail-overlay');
  const detail = document.getElementById('letter-detail');

  function renderPage(idx) {
    const pg = allPages[idx];
    const l = pg.letter;
    const isAi = l.author === 'ai';
    const authorLabel = isAi ? (persona?.ai_name || 'AI') : (persona?.user_name || '我');

    let headerHtml = '';
    if (idx === 0) {
      headerHtml = `<div class="letter-paper-header">
        <span class="letter-author" style="color:${isAi ? '#5b9eff' : 'var(--color-accent)'}">${escapeHtml(authorLabel)}</span>
        <span class="letter-date">${escapeHtml(l.created_at)}</span>
      </div>
      ${l.title ? `<div class="letter-paper-title">${escapeHtml(l.title)}</div>` : ''}`;
    }

    return `
      <div class="envelope-detail open" id="envelope-detail">
        <div class="envelope-detail-flap"></div>
        <div class="envelope-detail-body">
          <div class="letter-paper stationery-${escapeHtml(stationery)}">
            <div class="letter-paper-pages">
              ${headerHtml}
              <div class="letter-paper-content">${escapeHtml(pg.content)}</div>
            </div>
          </div>
        </div>
        <div class="letter-detail-nav">
          <button class="pager-btn" id="ld-prev" ${idx === 0 ? 'style="opacity:0.3"' : ''}>‹ 上一页</button>
          <span class="letter-page-info">第${idx + 1}页 / 共${allPages.length}页</span>
          <button class="pager-btn" id="ld-next" ${idx >= allPages.length - 1 ? 'style="opacity:0.3"' : ''}>下一页 ›</button>
        </div>
      </div>
    `;
  }

  detail.innerHTML = renderPage(currentPage);

  detail.addEventListener('click', (e) => {
    if (e.target.id === 'ld-next' && currentPage < allPages.length - 1) {
      currentPage++;
      detail.innerHTML = renderPage(currentPage);
    } else if (e.target.id === 'ld-prev' && currentPage > 0) {
      currentPage--;
      detail.innerHTML = renderPage(currentPage);
    }
  });

  overlay.style.display = 'flex';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none'; };
  try {
    await markAsRead(letterId, thread.map(letter => letter.id));
    await loadLetters();
  } catch (err) { showToast(err.message); }
}

function renderLetterPaper(l, isFirst, stationery) {
  const isAi = l.author === 'ai';
  const authorLabel = isAi ? (persona?.ai_name || 'AI') : (persona?.user_name || '我');

  return `
    <div class="letter-paper stationery-${escapeHtml(stationery)}" style="${isFirst ? '' : 'margin-top:14px;'}">
      <div class="letter-paper-header">
        <span class="letter-author" style="color:${isAi ? '#5b9eff' : 'var(--color-accent)'}">${escapeHtml(authorLabel)}</span>
        <span class="letter-date">${escapeHtml(l.created_at)}</span>
      </div>
      ${l.title ? `<div class="letter-paper-title">${escapeHtml(l.title)}</div>` : ''}
      <div class="letter-paper-content">${escapeHtml(l.content)}</div>
    </div>
  `;
}

// ========== 写信菜单 ==========
const addBtn = document.getElementById('add-btn');
const writeMenu = document.getElementById('write-menu');

addBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  writeMenu.style.display = writeMenu.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => { writeMenu.style.display = 'none'; });

writeMenu.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  writeMenu.style.display = 'none';
  if (action === 'new') {
    openWriteModal(false, null, '');
  } else if (action === 'reply') {
    openReplyPicker();
  }
});

// ========== 回信目标选取 ==========
async function openReplyPicker() {
  const overlay = document.getElementById('reply-pick-overlay');
  const listEl = document.getElementById('reply-pick-list');

  // 加载未回复的AI来信
  const letters = await fetchLetters('all');
  const unreplied = letters.filter(l => l.author === 'ai' && !l.reply);

  if (unreplied.length === 0) {
    listEl.innerHTML = '<div class="reply-pick-empty">没有待回复的信件</div>';
  } else {
    listEl.innerHTML = unreplied.map(l => {
      const title = l.title || '(无标题)';
      const preview = (l.content || '').slice(0, 60) + ((l.content || '').length > 60 ? '...' : '');
      const date = l.created_at ? l.created_at.slice(0, 10) : '';
      return `<div class="reply-pick-item" data-id="${l.id}" data-title="${escapeHtml(title)}">
        <div class="rp-title">${escapeHtml(title)}</div>
        <div class="rp-meta">${date} · ${escapeHtml(preview)}</div>
      </div>`;
    }).join('');
  }

  overlay.style.display = 'flex';

  // 点击选中
  listEl.querySelectorAll('.reply-pick-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id);
      const title = item.dataset.title;
      replyTargetId = id;
      overlay.style.display = 'none';
      openWriteModal(true, id, 'Re: ' + title);
    });
  });
}

document.getElementById('reply-pick-cancel').addEventListener('click', () => {
  document.getElementById('reply-pick-overlay').style.display = 'none';
});
document.getElementById('reply-pick-overlay').addEventListener('click', function(e) {
  if (e.target === this) { this.style.display = 'none'; }
});

// ========== 写信弹窗 ==========
function openWriteModal(isReply, targetId, defaultTitle) {
  const overlay = document.getElementById('write-modal-overlay');
  const titleEl = document.getElementById('write-modal-title');
  const titleInput = document.getElementById('write-title');
  const contentInput = document.getElementById('write-content');

  titleEl.textContent = isReply ? '回复信件' : '给他写信';
  titleInput.value = defaultTitle || '';
  contentInput.value = '';
  currentStationery = 'deep-blue';
  replyTargetId = targetId || null;

  document.querySelectorAll('#stationery-picker .stationery-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.key === 'deep-blue');
  });
  updateWriteAreaStyle();

  overlay.style.display = 'flex';
  writePages = ['']; writeCurPage = 0;
  document.getElementById('write-title').style.visibility = 'visible';
  showCurrentPage();
  setTimeout(() => contentInput.focus(), 150);
}

// ========== 翻页器 ==========
let writePages = [''];
let writeCurPage = 0;
const txtEl = document.getElementById('write-content');
const pagerEl = document.getElementById('write-pager');
const pageInfo = document.getElementById('page-info');

function showCurrentPage() {
  txtEl.value = writePages[writeCurPage] || '';
  pageInfo.textContent = `第${writeCurPage + 1}页 / 共${writePages.length}页`;
  pagerEl.style.visibility = 'visible';
  const titleEl = document.getElementById('write-title');
  titleEl.style.visibility = writeCurPage === 0 ? 'visible' : 'hidden';
}

txtEl.addEventListener('input', function() {
  writePages[writeCurPage] = this.value;
  if (this.scrollHeight > this.clientHeight + 4 && writeCurPage === writePages.length - 1) {
    // 找到溢出前的最后一个换行，把溢出内容移到新页
    const text = this.value;
    const lines = text.split('\n');
    // 二分找可见行数
    const pageH = this.clientHeight;
    const lineH = 30; // 行高
    const maxLines = Math.floor((pageH - 40) / lineH); // 减 padding
    let keep = '', overflow = '';
    if (lines.length > maxLines) {
      keep = lines.slice(0, maxLines).join('\n');
      overflow = lines.slice(maxLines).join('\n');
    } else {
      // 超长行导致的溢出，在接近溢出处截断
      const visibleChars = maxLines * 31; // ~31字/行
      keep = text.slice(0, visibleChars);
      overflow = text.slice(visibleChars);
    }
    writePages[writeCurPage] = keep;
    writePages.push(overflow);
    writeCurPage++;
    showCurrentPage();
  }
});

function goPage(dir) {
  writePages[writeCurPage] = txtEl.value;
  writeCurPage = Math.max(0, Math.min(writePages.length - 1, writeCurPage + dir));
  // 清理尾部空页
  while (writePages.length > 1 && !writePages[writePages.length - 1].trim()) writePages.pop();
  if (writeCurPage >= writePages.length) writeCurPage = writePages.length - 1;
  showCurrentPage();
}

document.getElementById('page-prev').addEventListener('click', () => goPage(-1));
document.getElementById('page-next').addEventListener('click', () => {
  if (writeCurPage >= writePages.length - 1) writePages.push('');
  goPage(1);
});

function closeWriteModal() {
  document.getElementById('write-modal-overlay').style.display = 'none';
  replyTargetId = null;
}

function updateWriteAreaStyle() {
  const modal = document.getElementById('write-modal-card');
  // 移除旧信纸样式
  modal.classList.remove('stationery-deep-blue', 'stationery-starry-abyss');
  // 添加新信纸样式
  modal.classList.add(`stationery-${currentStationery}`);
}

// ========== 发送信件 ==========
async function sendLetter() {
  const title = document.getElementById('write-title').value.trim();
  writePages[writeCurPage] = document.getElementById('write-content').value;
  const content = writePages.map(p => p || '').join('').trim();

  if (!content) {
    showToast('请写下信件内容');
    return;
  }

  try {
    if (replyTargetId) {
      await replyToLetter(replyTargetId, {
        author: 'user',
        content,
        stationery: currentStationery,
        title: title || undefined,
      });
      showToast('回信已发送');
    } else {
      await createLetter({
        author: 'user',
        title,
        content,
        stationery: currentStationery,
      });
      showToast('信件已发送');
    }
    closeWriteModal();
    loadLetters();
  } catch (err) {
    showToast(err.message);
  }
}

// ========== 筛选标签 ==========
function initFilterTabs() {
  const tabs = document.querySelectorAll('.letters-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      loadLetters();
    });
  });
}

// ========== 信纸选择器 ==========
function initStationeryPicker() {
  const picker = document.getElementById('stationery-picker');
  picker.querySelectorAll('.stationery-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.stationery-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentStationery = btn.dataset.key;
      updateWriteAreaStyle();
    });
  });
}

// ========== 事件绑定 ==========
function init() {
  // 写信弹窗
  document.getElementById('write-cancel').addEventListener('click', closeWriteModal);
  document.getElementById('write-send').addEventListener('click', sendLetter);

  // 点击遮罩关闭写信弹窗
  document.getElementById('write-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.target.closest('.modal-overlay')) closeWriteModal();
  });

  // ESC 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const writeOverlay = document.getElementById('write-modal-overlay');
      const detailOverlay = document.getElementById('letter-detail-overlay');
      if (writeOverlay.style.display === 'flex') closeWriteModal();
      if (detailOverlay.style.display === 'flex') detailOverlay.style.display = 'none';
    }
  });

  initFilterTabs();
  initStationeryPicker();

  // 加载角色信息
  fetch('/api/persona').then((r) => r.json()).then((p) => {
    persona = p;
    loadLetters();
  }).catch(() => {
    loadLetters();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
