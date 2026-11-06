// books-reader.js — 导入书阅读器逻辑
(function() {
function showToast(msg) { window.CyberSea.toast(msg); }

const pageInner = document.getElementById('book-page-inner');
const pageIndicator = document.getElementById('page-indicator');
const prevBtn = document.getElementById('page-prev');
const nextBtn = document.getElementById('page-next');
const titleEl = document.getElementById('reader-book-title');

const urlParams = new URLSearchParams(window.location.search);
const bookId = urlParams.get('id');

let pages = [];
let currentPage = 0;
let bookTitle = '';

// ===== 分页 =====
function paginate(text) {
  const WORDS_PER_PAGE = 250;
  const result = [];
  let remaining = text || '';

  while (remaining.length > 0) {
    if (remaining.length <= WORDS_PER_PAGE) {
      result.push(remaining);
      break;
    }
    // 在250字附近找最佳断点
    let cutAt = WORDS_PER_PAGE;
    const searchRange = 60;
    const chunk = remaining.slice(WORDS_PER_PAGE, WORDS_PER_PAGE + searchRange);
    const breakMatch = chunk.match(/[。\n！？」\.\!\?]/);
    if (breakMatch) {
      cutAt = WORDS_PER_PAGE + breakMatch.index + 1;
    }
    result.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  return result;
}

// ===== 渲染当前页（带批画标记） =====
async function renderPage() {
  if (pages.length === 0) {
    pageInner.innerHTML = '<p style="color:#999;text-indent:0;">暂无内容</p>';
    return;
  }

  const pageText = pages[currentPage];

  // 加载批画
  const annotations = await loadAnnotations('book', bookId);

  // 应用标记
  let html = pageText
    .split('\n')
    .filter(line => line.trim())
    .map(line => `<p>${applyAnnotationMarks(line, annotations)}</p>`)
    .join('');

  pageInner.innerHTML = html;
  pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= pages.length - 1;

  // 绑定标记hover
  bindAnnotationHover(pageInner);
}

// ===== 页面导航 =====
prevBtn.addEventListener('click', () => {
  if (currentPage > 0) { currentPage--; renderPage(); }
});
nextBtn.addEventListener('click', () => {
  if (currentPage < pages.length - 1) { currentPage++; renderPage(); }
});

// 键盘翻页
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { prevBtn.click(); }
  if (e.key === 'ArrowRight') { nextBtn.click(); }
});

// 触摸滑动
let touchStartX = 0;
document.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 60) {
    if (dx > 0) prevBtn.click();
    else nextBtn.click();
  }
});

// ===== 加载书籍 =====
async function loadBook() {
  if (!bookId) {
    titleEl.textContent = '未指定书籍';
    pageInner.innerHTML = '<p style="color:#999;text-indent:0;">缺少书籍ID参数</p>';
    return;
  }
  try {
    const resp = await fetch(`/api/books/${bookId}`);
    const data = await resp.json();
    if (!data.book) throw new Error('书不存在');
    bookTitle = data.book.title;
    titleEl.textContent = bookTitle;
    pages = paginate(data.book.content || '');
    renderPage();
  } catch (err) {
    console.error(err);
    showToast('书籍加载失败');
    titleEl.textContent = '加载失败';
    pageInner.innerHTML = '<p style="color:#999;text-indent:0;">加载书籍失败</p>';
  }
}

loadBook();
})();
