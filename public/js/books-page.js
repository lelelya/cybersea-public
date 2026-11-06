// books-page.js — 一起读书页面逻辑
(function() {

function showToast(msg) { window.CyberSea.toast(msg, { id: "toast", duration: 2000 }); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ===== 状态 =====
var currentBook = null;
var currentPage = 0;
var totalPages = 0;
var pages = [];
var PAGE_SIZE = 250;

// ===== 加载书籍列表 =====
async function loadBooks() {
  try {
    var res = await fetch('/api/books');
    var data = await res.json();
    renderBookList(data.books || []);
  } catch (err) {
    showToast('加载书籍列表失败');
  }
}

function renderBookList(books) {
  var container = document.getElementById('books-list-view');
  if (!books.length) {
    container.innerHTML = '<div class="book-empty">还没有导入的书籍<br><span style="font-size:13px;opacity:0.6;">点击右上角"添加书籍"来导入第一本书</span></div>';
    return;
  }

  container.className = 'book-grid';
  container.innerHTML = books.map(function(b) {
    var contentLength = Number(b.content_length || 0);
    var hasContent = contentLength > 0;
    return '<div class="book-card" draggable="true" data-id="' + b.id + '">' +
      '<div class="book-cover" data-id="' + b.id + '">' +
        '<div class="book-cover-inner">' +
          '<span class="book-cover-title" data-id="' + b.id + '" title="修改书名">' + escapeHtml(b.title) + '</span>' +
          '<span class="book-cover-meta">' + (hasContent ? contentLength + ' 字' : '空书') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="book-card-actions">' +
        '<button class="book-card-act book-edit-btn" data-id="' + b.id + '" title="修改书名"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg></button>' +
      '</div>' +
      '<div style="text-align:center;margin-top:4px;">' +
        '<button class="book-card-act danger book-delete-btn" data-id="' + b.id + '" style="font-size:12px;">删除</button>' +
      '</div>' +
    '</div>';
  }).join('');

  bindListEvents(books);
  initDragSort(books);

  // 编辑按钮
  document.querySelectorAll('.book-edit-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var titleEl = document.querySelector('.book-cover-title[data-id="' + btn.dataset.id + '"]');
      if (titleEl) startEditTitle(titleEl);
    });
  });
}

// ===== 移动端：点击封面先显示操作按钮，再点打开 =====
var touchActiveCard = null;
document.addEventListener('click', function(e) {
  var card = e.target.closest('.book-card');
  if (!card) { touchActiveCard = null; return; }
  // 如果点了按钮，不处理
  if (e.target.closest('button') || e.target.closest('input')) return;

  // 桌面端 hover 能显示按钮，不拦截
  if (window.matchMedia('(hover: hover)').matches) return;

  // 移动端：第一次点显示按钮，第二次打开
  if (touchActiveCard === card) {
    touchActiveCard = null;
    var cover = card.querySelector('.book-cover');
    if (cover) cover.click();
  } else {
    e.preventDefault();
    e.stopPropagation();
    touchActiveCard = card;
    card.classList.add('touch-active');
    setTimeout(function() { card.classList.remove('touch-active'); }, 2000);
  }
}, true);

// ===== 拖拽排序 =====
function initDragSort(books) {
  var grid = document.getElementById('books-list-view');
  if (!grid) return;

  var dragging = null;

  grid.addEventListener('dragstart', function(e) {
    dragging = e.target.closest('.book-card');
    if (!dragging) return;
    dragging.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', function() {
    if (dragging) dragging.classList.remove('dragging');
    dragging = null;
    saveOrder();
  });

  grid.addEventListener('dragover', function(e) {
    e.preventDefault();
    if (!dragging) return;
    var target = e.target.closest('.book-card');
    if (!target || target === dragging) return;
    var cards = Array.from(grid.querySelectorAll('.book-card'));
    var fromIdx = cards.indexOf(dragging);
    var toIdx = cards.indexOf(target);
    if (fromIdx < toIdx) {
      grid.insertBefore(dragging, target.nextSibling);
    } else {
      grid.insertBefore(dragging, target);
    }
  });

  async function saveOrder() {
    var cards = Array.from(grid.querySelectorAll('.book-card'));
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].dataset.id;
      try {
        await fetch('/api/books/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sort_order: i }),
        });
      } catch (e) { console.error(e); showToast('排序保存失败'); }
    }
  }
}

// ===== 编辑书名 =====
function startEditTitle(titleEl) {
  var bookId = titleEl.dataset.id;
  var origTitle = titleEl.textContent;
  var input = document.createElement('input');
  input.className = 'book-cover-title-input';
  input.value = origTitle;
  input.maxLength = 50;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  function save() {
    var newTitle = input.value.trim() || origTitle;
    var span = document.createElement('span');
    span.className = 'book-cover-title';
    span.dataset.id = bookId;
    span.title = '修改书名';
    span.textContent = newTitle;
    input.replaceWith(span);

    if (newTitle !== origTitle) {
      fetch('/api/books/' + bookId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      }).catch(function(e) { console.error(e); showToast('重命名失败'); });
    }
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { input.blur(); }
    if (ev.key === 'Escape') { input.value = origTitle; input.blur(); }
  });
}

// 桌面端双击编辑
document.addEventListener('dblclick', function(e) {
  var titleEl = e.target.closest('.book-cover-title');
  if (!titleEl) return;
  e.stopPropagation();
  startEditTitle(titleEl);
});

function bindListEvents(books) {
  // 点击书籍封面 → 阅读
  document.querySelectorAll('.book-cover').forEach(function(el) {
    el.addEventListener('click', function() {
      var id = el.dataset.id;
      var book = books.find(function(b) { return String(b.id) === String(id); });
      if (book) openReader(book);
    });
  });

  // 删除按钮
  document.querySelectorAll('.book-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = btn.dataset.id;
      var book = books.find(function(b) { return String(b.id) === String(id); });
      if (!confirm('确定删除《' + (book ? book.title : '') + '》吗？')) return;
      fetch('/api/books/' + id, { method: 'DELETE' }).then(function() {
        showToast('已删除');
        loadBooks();
      }).catch(function() { showToast('删除失败'); });
    });
  });
}

// ===== 添加书籍 =====
document.getElementById('add-book-btn').addEventListener('click', function() {
  document.getElementById('book-title-input').value = '';
  document.getElementById('book-file-input').value = '';
  document.getElementById('add-book-modal').style.display = 'flex';
});

document.getElementById('add-book-cancel').addEventListener('click', function() {
  document.getElementById('add-book-modal').style.display = 'none';
});

document.getElementById('add-book-confirm').addEventListener('click', async function() {
  var title = document.getElementById('book-title-input').value.trim();
  if (!title) { showToast('请输入书名'); return; }

  try {
    var res = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title }),
    });
    if (!res.ok) throw new Error((await res.json()).error || '创建失败');
    var data = await res.json();
    var bookId = data.book.id;

    // 如果有选择文件，导入
    var fileInput = document.getElementById('book-file-input');
    var file = fileInput.files[0];
    if (file) {
      var formData = new FormData();
      formData.append('file', file);
      await fetch('/api/books/' + bookId + '/import', { method: 'POST', body: formData });
    }

    document.getElementById('add-book-modal').style.display = 'none';
    showToast('已添加《' + title + '》');
    loadBooks();
  } catch (err) { showToast(err.message); }
});

document.getElementById('add-book-modal').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});

// ===== 阅读器 =====
function paginate(text, size) {
  var result = [];
  var i = 0;
  while (i < text.length) {
    var end = Math.min(i + size, text.length);
    if (end < text.length) {
      for (var j = end; j > i + Math.floor(size / 2); j--) {
        var ch = text[j];
        if (ch === '。' || ch === '\n' || ch === '！' || ch === '？' || ch === '」') {
          end = j + 1; break;
        }
      }
    }
    result.push(text.slice(i, end).trim());
    i = end;
  }
  return result;
}

async function openReader(book) {
  try {
    var res = await fetch('/api/books/' + book.id);
    var data = await res.json();
    currentBook = data.book;
  } catch (err) { showToast('加载失败'); return; }

  // 空书：显示导入界面
  if (!currentBook || !currentBook.content) {
    showEmptyBookReader(currentBook);
    return;
  }

  pages = paginate(currentBook.content, PAGE_SIZE);
  totalPages = pages.length;
  currentPage = 0;

  document.getElementById('books-list-view').style.display = 'none';
  document.getElementById('add-book-btn').style.display = 'none';
  document.getElementById('reader-view').classList.add('show');
  document.getElementById('reader-book-title').textContent = currentBook.title;
  document.getElementById('books-title').textContent = currentBook.title;

  renderPage();
  updatePageNav();

  // 触摸滑动
  var touchStartX = 0;
  var bookPage = document.getElementById('book-page');
  bookPage.addEventListener('touchstart', function(e) { touchStartX = e.touches[0].clientX; }, { passive: true });
  bookPage.addEventListener('touchend', function(e) {
    var diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) { if (diff > 0) nextPage(); else prevPage(); }
  });
}

function showEmptyBookReader(book) {
  document.getElementById('books-list-view').style.display = 'none';
  document.getElementById('add-book-btn').style.display = 'none';
  document.getElementById('reader-view').classList.add('show');
  document.getElementById('reader-book-title').textContent = book.title;
  document.getElementById('books-title').textContent = book.title;

  var inner = document.getElementById('book-page-inner');
  inner.innerHTML = '<div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,0.5);">' +
    '<p style="font-size:15px;margin-bottom:16px;">这本书还没有内容</p>' +
    '<button id="reader-import-btn" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);padding:8px 24px;border-radius:20px;cursor:pointer;font-size:14px;font-family:var(--font-family);"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导入 txt 文件</button>' +
    '<input type="file" id="reader-import-input" accept=".txt" style="display:none;">' +
    '</div>';

  document.getElementById('page-indicator').textContent = '空';
  document.getElementById('page-prev').disabled = true;
  document.getElementById('page-next').disabled = true;

  document.getElementById('reader-import-btn').addEventListener('click', function() {
    document.getElementById('reader-import-input').click();
  });

  document.getElementById('reader-import-input').addEventListener('change', async function() {
    var file = this.files[0];
    if (!file) return;
    var formData = new FormData();
    formData.append('file', file);
    try {
      var res = await fetch('/api/books/' + book.id + '/import', { method: 'POST', body: formData });
      if (!res.ok) throw new Error((await res.json()).error || '导入失败');
      showToast('导入成功');
      switchToList();
      loadBooks();
    } catch (err) { showToast(err.message); }
  });
}

function switchToList() {
  document.getElementById('books-list-view').style.display = '';
  document.getElementById('books-list-view').className = 'book-grid';
  document.getElementById('add-book-btn').style.display = '';
  document.getElementById('reader-view').classList.remove('show');
  document.getElementById('books-title').textContent = '一起读书';
  currentBook = null; pages = []; currentPage = 0;
}

function renderPage() {
  var inner = document.getElementById('book-page-inner');
  var pageText = pages[currentPage] || '';
  if (currentBook && currentBook.id) {
    loadAnnotations('book', String(currentBook.id)).then(function(anns) {
      var lines = pageText.split('\n').filter(function(p) { return p.trim(); });
      inner.innerHTML = lines.map(function(line) {
        return '<p>' + applyAnnotationMarks(line, anns) + '</p>';
      }).join('');
      bindAnnotationHover(inner);
    }).catch(function() {
      inner.innerHTML = pageText.split('\n').filter(function(p) { return p.trim(); }).map(function(p) {
        return '<p>' + escapeHtml(p.trim()) + '</p>';
      }).join('');
    });
  } else {
    inner.innerHTML = pageText.split('\n').filter(function(p) { return p.trim(); }).map(function(p) {
      return '<p>' + escapeHtml(p.trim()) + '</p>';
    }).join('');
  }
}

function updatePageNav() {
  document.getElementById('page-indicator').textContent = (currentPage + 1) + ' / ' + totalPages;
  document.getElementById('page-prev').disabled = currentPage <= 0;
  document.getElementById('page-next').disabled = currentPage >= totalPages - 1;
}

function prevPage() {
  if (currentPage > 0) { currentPage--; renderPage(); updatePageNav(); }
}
function nextPage() {
  if (currentPage < totalPages - 1) { currentPage++; renderPage(); updatePageNav(); }
}

// ===== 批画 =====
function initBookAnnotationToolbar() {
  var inner = document.getElementById('book-page-inner');
  if (!inner || !currentBook) return;
  initAnnotationToolbar(inner, {
    sourceType: 'book',
    sourceId: String(currentBook.id),
    annotator: 'user',
    onAnnotationChange: function() { renderPage(); },
  });
}

// 打开阅读器后初始化批画
var origOpenReader = openReader;
openReader = function(book) {
  origOpenReader(book);
  setTimeout(function() { if (currentBook) initBookAnnotationToolbar(); }, 500);
};
var origPrevPage = prevPage;
prevPage = function() { origPrevPage(); setTimeout(function() { if (currentBook) initBookAnnotationToolbar(); }, 200); };
var origNextPage = nextPage;
nextPage = function() { origNextPage(); setTimeout(function() { if (currentBook) initBookAnnotationToolbar(); }, 200); };

// ===== 事件绑定 =====
document.getElementById('reader-back-btn').addEventListener('click', switchToList);
document.getElementById('page-prev').addEventListener('click', prevPage);
document.getElementById('page-next').addEventListener('click', nextPage);
document.addEventListener('keydown', function(e) {
  if (!currentBook) return;
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
});

// ===== 初始化 =====
loadBooks();

})();
