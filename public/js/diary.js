// diary.js — 日记页面逻辑（v3 固定纸张 + 翻页）
(function() {
const urlParams = new URLSearchParams(window.location.search);
const owner = urlParams.get('owner') || 'user';
const isAI = owner === 'ai';
const PAGE_SEP = '\n---PAGE---\n';

const dateDisplay = document.getElementById('date-display');
const diaryContent = document.getElementById('diary-content');
const toast = document.getElementById('toast');
const pagePrev = document.getElementById('page-prev');
const pageNext = document.getElementById('page-next');
const pageInfo = document.getElementById('page-info');
const pageNav = document.getElementById('diary-page-nav');

let currentDate = new Date();
let currentDiary = null;
let pages = [''];
let currentPage = 0;
let saveTimeout = null;

// ===== Toast =====
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===== 日期格式化 =====
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const w = weekdays[date.getDay()];
  return `${y}年${m}月${d}日 星期${w}`;
}

function dateToStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function updateDateDisplay() {
  dateDisplay.textContent = formatDate(currentDate);
}

// ===== 页码导航 =====
function updatePageNav() {
  pageInfo.textContent = `第 ${currentPage + 1} / ${pages.length} 页`;
  pagePrev.disabled = currentPage === 0;
  // 下一页永远可点（点了自动加新页）
}

pagePrev.addEventListener('click', () => {
  if (currentPage > 0) {
    autoSave();
    currentPage--;
    renderCurrentPage();
    updatePageNav();
  }
});

pageNext.addEventListener('click', () => {
  autoSave();
  if (currentPage < pages.length - 1) {
    currentPage++;
  } else if (!isAI) {
    // 用户日记：最后一页再点加新页
    pages.push('');
    currentPage++;
  }
  // AI 日记在最后一页点下一页无反应
  renderCurrentPage();
  updatePageNav();
});

// ===== 日期导航 =====
document.getElementById('date-prev').addEventListener('click', () => {
  autoSave();
  pages = [''];
  currentPage = 0;
  currentDate.setDate(currentDate.getDate() - 1);
  updateDateDisplay();
  loadDiary();
});

document.getElementById('date-next').addEventListener('click', () => {
  autoSave();
  pages = [''];
  currentPage = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(currentDate);
  next.setDate(next.getDate() + 1);
  if (next > today) return;
  currentDate = next;
  updateDateDisplay();
  loadDiary();
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.isContentEditable) return;
  if (e.key === 'ArrowLeft') document.getElementById('date-prev').click();
  if (e.key === 'ArrowRight') document.getElementById('date-next').click();
});

// ===== 加载日记 =====
async function loadDiary() {
  const dateStr = dateToStr(currentDate);
  const sourceType = isAI ? 'diary_ai' : 'diary_user';

  try {
    const resp = await fetch(`/api/diary?owner=${owner}&date=${dateStr}`);
    const data = await resp.json();
    currentDiary = data.diary;

    if (currentDiary && currentDiary.content) {
      pages = currentDiary.content.split(PAGE_SEP);
      if (pages.length === 0) pages = [''];
    } else {
      pages = [''];
    }
    currentPage = 0;

    const annotations = await loadAnnotations(sourceType, dateStr);
    renderDiary(annotations);
    updatePageNav();

    pageNav.style.display = 'flex';
  } catch (err) {
    console.error('[diary] 加载失败:', err);
    diaryContent.innerHTML = '<div class="diary-placeholder">加载失败</div>';
  }
}

// ===== 渲染 =====
function renderDiary(annotations) {
  if (isAI) {
    renderAiDiary(annotations);
  } else {
    renderCurrentPage();
  }
}

function renderAiDiary(annotations) {
  if (!currentDiary || !currentDiary.content) {
    diaryContent.innerHTML = '<div class="diary-placeholder">今天的日记还没写好～<br><span style="font-size:13px;opacity:0.6;">AI会在每日凌晨自动写日记</span></div>';
    pageNav.style.display = 'none';
    return;
  }

  pageNav.style.display = 'flex';
  const content = pages[currentPage] || '';
  const weather = (currentPage === 0 && currentDiary.weather) ? currentDiary.weather : '';
  const markedContent = applyAnnotationMarks(content, annotations);

  diaryContent.innerHTML = `
    ${weather ? `<div class="diary-weather"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> ${escapeHtml(weather)}</div>` : ''}
    <div class="diary-text">${markedContent}</div>
  `;

  const textEl = diaryContent.querySelector('.diary-text');
  if (textEl) bindAnnotationHover(textEl);
}

function renderCurrentPage() {
  const content = pages[currentPage] || '';
  diaryContent.innerHTML = `
    <div class="diary-text" id="diary-text-content" contenteditable="true">${content}</div>
  `;

  const textEl = document.getElementById('diary-text-content');

  textEl.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSave(), 1500);
  });

  textEl.addEventListener('blur', () => {
    clearTimeout(saveTimeout);
    autoSave();
  });

  textEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      clearTimeout(saveTimeout);
      autoSave();
    }
  });
}

// ===== 自动保存 =====
async function autoSave() {
  if (isAI) return;
  const textEl = document.getElementById('diary-text-content');
  if (!textEl) return;

  // 保存当前页内容
  pages[currentPage] = (textEl.innerText || '').trim();

  // 清除末尾空页
  while (pages.length > 1 && pages[pages.length - 1] === '') {
    pages.pop();
  }

  const newContent = pages.join(PAGE_SEP);
  const oldContent = (currentDiary && currentDiary.content) ? currentDiary.content : '';

  if (newContent === oldContent) return;

  const dateStr = dateToStr(currentDate);
  try {
    const resp = await fetch('/api/diary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'user', date: dateStr, content: newContent }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showToast(err.error || '保存失败');
      return;
    }
    currentDiary = { content: newContent };
    updatePageNav();
  } catch (err) {
    showToast('保存失败');
  }
}

// ===== 批画 =====
function initDiaryAnnotations() {
  const textEl = document.getElementById('diary-text-content');
  if (!textEl || isAI) return;
  const dateStr = dateToStr(currentDate);
  const sourceType = isAI ? 'diary_ai' : 'diary_user';

  initAnnotationToolbar(textEl, {
    sourceType: sourceType,
    sourceId: dateStr,
    annotator: 'user',
    onAnnotationChange: () => loadDiary(),
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== 初始化 =====
updateDateDisplay();
loadDiary().then(() => {
  setTimeout(initDiaryAnnotations, 500);
});

const origRender = renderDiary;
renderDiary = function(annotations) {
  origRender(annotations);
  setTimeout(initDiaryAnnotations, 100);
};

})();
