// bookshelf.js — 书架卡片网格逻辑
(function() {

function showToast(msg) { window.CyberSea.toast(msg); }

// ===== 工具函数 =====
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== 日记状态检查 =====
async function checkDiaryStatus() {
  const today = todayStr();

  // 我的日记
  try {
    const userResp = await fetch(`/api/diary?owner=user&date=${today}`);
    const userData = await userResp.json();
    const userStatus = document.getElementById('status-diary-user');
    if (userStatus) {
      if (userData.diary && userData.diary.content) {
        userStatus.textContent = '今日已记';
        userStatus.className = 'bs-card-status written';
      } else {
        userStatus.textContent = '今日未记';
        userStatus.className = 'bs-card-status not-written';
      }
    }
  } catch (e) {
    console.error(e);
    showToast('日记状态加载失败');
    const el = document.getElementById('status-diary-user');
    if (el) { el.textContent = ''; }
  }

  // 他的日记
  try {
    const aiResp = await fetch(`/api/diary?owner=ai&date=${today}`);
    const aiData = await aiResp.json();
    const aiStatus = document.getElementById('status-diary-ai');
    if (aiStatus) {
      if (aiData.diary && aiData.diary.content) {
        aiStatus.textContent = '今日已生成';
        aiStatus.className = 'bs-card-status written';
      } else {
        aiStatus.textContent = '尚未生成';
        aiStatus.className = 'bs-card-status not-written';
      }
    }
  } catch (e) {
    console.error(e);
    showToast('日记状态加载失败');
    const el = document.getElementById('status-diary-ai');
    if (el) { el.textContent = ''; }
  }
}

// ===== 背景配置加载 =====
async function loadBackgrounds() {
  try {
    const resp = await fetch('/api/bookshelf-config');
    const cfg = await resp.json();

    // 页面整体背景 → 放到 body 上
    if (cfg.bookshelf_page_bg) {
      document.body.style.setProperty('--bs-page-bg', `url(${cfg.bookshelf_page_bg})`);
      document.body.classList.add('bs-has-page-bg');
    }

    // 各卡片背景
    applyCardBg('card-bg-diary-user', cfg.bookshelf_card_diary_user_bg, 'card-diary-user');
    applyCardBg('card-bg-diary-ai', cfg.bookshelf_card_diary_ai_bg, 'card-diary-ai');
    applyCardBg('card-bg-stories', cfg.bookshelf_card_stories_bg, 'card-stories');
    applyCardBg('card-bg-books', cfg.bookshelf_card_books_bg, 'card-books');
  } catch (_) {
    // 静默降级，使用默认深海背景
  }
}

function applyCardBg(bgElemId, bgPath, cardId) {
  if (!bgPath) return;
  const bgEl = document.getElementById(bgElemId);
  const cardEl = document.getElementById(cardId);
  if (bgEl && cardEl) {
    bgEl.style.backgroundImage = `url(${bgPath})`;
    cardEl.classList.add('has-card-bg');
  }
}

// ===== 卡片点击 =====
document.querySelectorAll('.bs-card[data-link]').forEach(card => {
  card.addEventListener('click', () => {
    const link = card.dataset.link;
    if (link) window.location.href = link;
  });
});

// ===== 初始化 =====
checkDiaryStatus();
loadBackgrounds();

})();
