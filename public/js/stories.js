// js/stories.js — 睡前故事页面逻辑

// ========== 工具函数 ==========
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

// ========== 状态 ==========
var currentStory = null;
var allStories = [];       // 全部故事列表（用于连续阅读）
var storyPageStarts = [];  // 每个故事在合并后的起始页码
var currentPage = 0;
var totalPages = 0;
var pages = [];
var currentAudio = null;
var currentPlayingStoryId = null;
var PAGE_SIZE = 250;
var isNewStory = false;
var newStoryId = null;        // 自动保存后获得的真实 ID
var newStorySaveTimeout = null;
var newStoryTitle = '';
var newStoryDirty = false;
var newStorySavePromise = null;

// ========== 故事列表 ==========
async function loadStories() {
  try {
    var res = await fetch('/api/stories');
    var data = await res.json();
    var stories = data.items || [];

    // 并行获取每个故事的页数
    var storiesWithPages = await Promise.all(stories.map(async function(s) {
      try {
        var detailRes = await fetch('/api/stories/' + s.id);
        var detailData = await detailRes.json();
        if (detailData.item && detailData.item.content) {
          s.pageCount = Math.max(1, Math.ceil(detailData.item.content.length / PAGE_SIZE));
        } else {
          s.pageCount = 1;
        }
      } catch (_) { s.pageCount = 1; }
      return s;
    }));

    renderStoryList(storiesWithPages);
  } catch (err) {
    showToast('加载故事列表失败');
  }
}

function renderStoryList(stories) {
  var container = document.getElementById('stories-toc-list');
  if (!container) return;

  if (stories.length === 0) {
    container.innerHTML = '<div class="toc-empty">还没有故事<br>点击下方按钮创建第一个睡前故事</div>';
    return;
  }

  var pageOffset = 0;
  container.innerHTML = stories.map(function(s, idx) {
    var num = String(idx + 1).padStart(2, '0');
    var startPage = pageOffset + 1;
    var endPage = pageOffset + s.pageCount;
    pageOffset = endPage;
    var pageLabel = s.pageCount > 1 ? startPage + '~' + endPage : String(startPage);
    return '<div class="toc-row" data-id="' + s.id + '">' +
      '<span class="toc-num">' + num + '</span>' +
      '<span class="toc-title-text">' + escapeHtml(s.title) + '</span>' +
      '<span class="toc-dots"></span>' +
      '<span class="toc-chapter">' + pageLabel + '</span>' +
      '<span class="toc-actions">' +
        '<button class="toc-act-btn danger story-delete-btn" data-id="' + s.id + '" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</span>' +
    '</div>';
  }).join('');

  bindListEvents(stories);
}

function bindListEvents(stories) {
  // 点击目录行 → 打开阅读器
  document.querySelectorAll('.toc-row').forEach(function(el) {
    el.addEventListener('click', function(e) {
      // 不拦截按钮点击
      if (e.target.closest('button')) return;
      var id = el.dataset.id;
      var story = null;
      for (var i = 0; i < stories.length; i++) {
        if (String(stories[i].id) === String(id)) { story = stories[i]; break; }
      }
      if (story) openReader(story);
    });
  });

  // 删除按钮
  document.querySelectorAll('.story-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var id = btn.dataset.id;
      if (!confirm('确定删除这个故事吗？')) return;
      try {
        await fetch('/api/stories/' + id, { method: 'DELETE' });
        showToast('已删除');
        loadStories();
      } catch (err) {
        showToast('删除失败');
      }
    });
  });
}

function formatTime(dateStr) {
  var d = new Date(dateStr);
  var now = new Date();
  var pad2 = function(n) { return String(n).padStart(2, '0'); };
  var timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return '今天 ' + timeStr;
  var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + timeStr;
  if (d.getFullYear() === now.getFullYear())
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
}

// ========== TTS 播放 ==========
async function toggleStoryAudio(storyId, audioPath) {
  // 如果正在播放同一个，暂停
  if (currentPlayingStoryId === storyId && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentPlayingStoryId = null;
    updatePlayBtnIcon();
    return;
  }

  // 如果正在播放别的，先停掉
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  // 没有音频路径 → 生成
  if (!audioPath) {
    var btn = document.getElementById('reader-play-btn');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    btn.disabled = true;
    try {
      var res = await fetch('/api/stories/' + storyId + '/tts', { method: 'POST' });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      audioPath = data.audio_path;
      btn.dataset.audio = audioPath;
    } catch (err) {
      showToast('朗读生成失败: ' + err.message);
      btn.disabled = false;
      updatePlayBtnIcon();
      return;
    }
    btn.disabled = false;
  }

  // 播放
  currentAudio = new Audio(audioPath);
  currentPlayingStoryId = storyId;
  updatePlayBtnIcon();

  currentAudio.onended = function() {
    currentAudio = null;
    currentPlayingStoryId = null;
    updatePlayBtnIcon();
  };

  currentAudio.onerror = function() {
    currentAudio = null;
    currentPlayingStoryId = null;
    updatePlayBtnIcon();
    showToast('播放失败');
  };

  try {
    await currentAudio.play();
  } catch (err) {
    currentAudio = null;
    currentPlayingStoryId = null;
    updatePlayBtnIcon();
  }
}

// ========== 阅读器 ==========
async function openReader(story) {
  // 加载全部故事
  try {
    var listRes = await fetch('/api/stories');
    var listData = await listRes.json();
    allStories = listData.items || [];

    // 并行获取所有故事完整内容
    var details = await Promise.all(allStories.map(function(s) {
      return fetch('/api/stories/' + s.id).then(function(r) { return r.json(); });
    }));

    // 每个故事单独分页，确保新故事总是另起一页
    storyPageStarts = [];
    pages = [];
    var pageOffset = 0;

    for (var i = 0; i < details.length; i++) {
      var item = details[i].item;
      if (!item || !item.content) continue;
      storyPageStarts.push({ id: item.id, title: item.title, startPage: pageOffset });
      var storyPages = paginate(item.content, PAGE_SIZE);
      for (var j = 0; j < storyPages.length; j++) {
        pages.push(storyPages[j]);
      }
      pageOffset += storyPages.length;
    }

    totalPages = pages.length;

    currentStory = story;
  } catch (err) {
    showToast('加载故事失败');
    return;
  }

  // 跳到点击的故事起始页
  currentPage = 0;
  for (var i = 0; i < storyPageStarts.length; i++) {
    if (String(storyPageStarts[i].id) === String(story.id)) {
      currentPage = storyPageStarts[i].startPage;
      break;
    }
  }

  // 切换到阅读器视图
  document.getElementById('stories-list-view').style.display = 'none';
  document.getElementById('reader-view').classList.add('show');
  updateReaderTitle();
  document.getElementById('stories-title').textContent = '睡前故事';

  renderPage();
  updatePageNav();

  // 触摸滑动支持
  var touchStartX = 0;
  var bookPage = document.getElementById('book-page');
  bookPage.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  bookPage.addEventListener('touchend', function(e) {
    var diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) nextPage();
      else prevPage();
    }
  });
}

// 根据当前页码更新阅读器标题和朗读按钮
function updateReaderTitle() {
  if (isNewStory) { document.getElementById('reader-play-btn').style.display = 'none'; return; }
  var titleEl = document.getElementById('reader-story-title');
  if (!titleEl || storyPageStarts.length === 0) return;

  // 找到当前页属于哪个故事
  var currentStoryTitle = '';
  var currentStoryId = null;
  for (var i = storyPageStarts.length - 1; i >= 0; i--) {
    if (currentPage >= storyPageStarts[i].startPage) {
      currentStoryTitle = storyPageStarts[i].title;
      currentStoryId = storyPageStarts[i].id;
      currentStory = storyPageStarts[i];
      break;
    }
  }
  titleEl.textContent = currentStoryTitle || '';

  // 朗读按钮：仅在第一页显示
  var playBtn = document.getElementById('reader-play-btn');
  if (!playBtn) return;
  var storyStartPage = -1;
  for (var j = 0; j < storyPageStarts.length; j++) {
    if (String(storyPageStarts[j].id) === String(currentStoryId)) {
      storyStartPage = storyPageStarts[j].startPage;
      break;
    }
  }
  if (currentPage === storyStartPage && currentStoryId) {
    playBtn.style.display = 'flex';
    playBtn.dataset.storyId = currentStoryId;
    fetch('/api/stories/' + currentStoryId).then(function(r) { return r.json(); }).then(function(d) {
      if (d.item) { playBtn.dataset.audio = d.item.audio_path || ''; updatePlayBtnIcon(); }
    }).catch(function() {});
  } else {
    playBtn.style.display = 'none';
  }
}

// 更新朗读按钮图标
function updatePlayBtnIcon() {
  var btn = document.getElementById('reader-play-btn');
  if (!btn) return;
  var isPlaying = currentPlayingStoryId === parseInt(btn.dataset.storyId) && currentAudio && !currentAudio.paused;
  var hasAudio = !!btn.dataset.audio;
  if (isPlaying) {
    btn.style.color = 'rgba(79,217,200,0.9)';
    btn.style.borderColor = 'rgba(79,217,200,0.6)';
    btn.style.background = 'rgba(79,217,200,0.2)';
  } else {
    btn.style.color = 'rgba(255,255,255,0.5)';
    btn.style.borderColor = 'rgba(255,255,255,0.15)';
    btn.style.background = 'rgba(10,22,40,0.85)';
  }
}

// 绑定朗读按钮事件
document.getElementById('reader-play-btn').addEventListener('click', function() {
  var btn = this;
  var storyId = parseInt(btn.dataset.storyId);
  var audioPath = btn.dataset.audio;
  toggleStoryAudio(storyId, audioPath);
});

async function switchToList() {
  clearTimeout(newStorySaveTimeout);
  if (isNewStory && !await autoSaveNewStory()) return;
  isNewStory = false;
  newStoryId = null;
  document.getElementById('reader-play-btn').style.display = 'none';
  document.getElementById('stories-list-view').style.display = '';
  document.getElementById('reader-view').classList.remove('show');
  document.getElementById('stories-title').textContent = '睡前故事';
  currentStory = null;
  allStories = [];
  storyPageStarts = [];
  pages = [];
  currentPage = 0;
  await loadStories();
}

function paginate(text, size) {
  var result = [];
  var i = 0;
  while (i < text.length) {
    var end = Math.min(i + size, text.length);
    if (end < text.length) {
      // 尽量在句号、换行处断页
      var searchEnd = end;
      var breakPos = -1;
      for (var j = end; j > i + Math.floor(size / 2); j--) {
        var ch = text[j];
        if (ch === '。' || ch === '\n' || ch === '！' || ch === '？' || ch === '」') {
          breakPos = j + 1;
          break;
        }
      }
      if (breakPos > 0) end = breakPos;
    }
    result.push(text.slice(i, end).trim());
    i = end;
  }
  return result;
}

function renderPage() {
  if (isNewStory) {
    renderNewStoryPage();
    return;
  }

  var inner = document.getElementById('book-page-inner');
  var pageText = pages[currentPage] || '';

  // 加载批画并渲染
  if (currentStory && currentStory.id) {
    loadAnnotations('story', String(currentStory.id)).then(function(anns) {
      renderPageWithAnnotations(inner, pageText, anns);
    }).catch(function() {
      // 降级：无批画渲染
      renderPagePlain(inner, pageText);
    });
  } else {
    renderPagePlain(inner, pageText);
  }
}

function renderPagePlain(inner, pageText) {
  var paragraphs = pageText.split('\n').filter(function(p) { return p.trim(); });
  inner.innerHTML = paragraphs.map(function(p) {
    return '<p>' + escapeHtml(p.trim()) + '</p>';
  }).join('');
}

function renderPageWithAnnotations(inner, pageText, annotations) {
  var lines = pageText.split('\n').filter(function(p) { return p.trim(); });
  inner.innerHTML = lines.map(function(line) {
    var marked = applyAnnotationMarks(line, annotations);
    return '<p>' + marked + '</p>';
  }).join('');

  // 绑定hover
  bindAnnotationHover(inner);
}

// 初始化批画工具条
function initStoryAnnotationToolbar() {
  var inner = document.getElementById('book-page-inner');
  if (!inner || !currentStory) return;

  initAnnotationToolbar(inner, {
    sourceType: 'story',
    sourceId: String(currentStory.id),
    annotator: 'user',
    onAnnotationChange: function() { renderPage(); },
  });
}

// 重写 openReader 包装批画初始化
var origOpenReader = openReader;
openReader = function(story) {
  origOpenReader(story);
  setTimeout(function() {
    if (currentStory) initStoryAnnotationToolbar();
  }, 500);
};

function updatePageNav() {
  document.getElementById('page-nav').style.display = '';
  if (isNewStory) {
    document.getElementById('page-indicator').textContent = '第 ' + (currentPage + 1) + ' 页';
    document.getElementById('page-prev').disabled = currentPage <= 0;
    document.getElementById('page-next').disabled = false; // 永远可点（自动加新页）
    return;
  }
  document.getElementById('page-indicator').textContent = (currentPage + 1) + ' / ' + totalPages;
  document.getElementById('page-prev').disabled = currentPage <= 0;
  document.getElementById('page-next').disabled = currentPage >= totalPages - 1;
}

function prevPage() {
  if (currentPage > 0) {
    if (isNewStory) flushNewStoryPage();
    currentPage--;
    renderPage();
    updatePageNav();
    if (!isNewStory) updateReaderTitle();
    setTimeout(function() {
      if (currentStory && !isNewStory) initStoryAnnotationToolbar();
    }, 200);
  }
}

function nextPage() {
  if (isNewStory) {
    flushNewStoryPage();
    if (currentPage >= pages.length - 1) {
      pages.push('');
      totalPages = pages.length;
    }
    currentPage++;
    renderPage();
    updatePageNav();
  } else if (currentPage < totalPages - 1) {
    currentPage++;
    renderPage();
    updatePageNav();
    updateReaderTitle();
    setTimeout(function() {
      if (currentStory) initStoryAnnotationToolbar();
    }, 200);
  }
}

// ========== 新建故事（阅读器内联编辑） ==========
document.getElementById('add-story-btn').addEventListener('click', startNewStory);

async function startNewStory() {
  clearTimeout(newStorySaveTimeout);
  allStories = [];
  storyPageStarts = [];
  pages = [''];
  totalPages = 1;
  currentPage = 0;
  newStoryTitle = '';
  newStoryDirty = false;
  isNewStory = true;
  currentStory = { id: '__new__', title: '新建故事' };

  // 切换视图
  newStoryId = null;
  document.getElementById('stories-list-view').style.display = 'none';
  document.getElementById('reader-view').classList.add('show');
  document.getElementById('reader-story-title').textContent = '新建故事';
  document.getElementById('stories-title').textContent = '睡前故事';

  renderPage();
  updatePageNav();
}

function flushNewStoryPage() {
  // 把当前编辑内容写回 pages[currentPage]
  var titleEl = document.getElementById('new-story-title');
  var bodyEl = document.getElementById('new-story-body');
  if (!bodyEl) return;
  var bodyText = (bodyEl.innerText || '').trim();
  if (titleEl) newStoryTitle = (titleEl.innerText || '').trim();
  pages[currentPage] = bodyText;
}

function renderNewStoryPage() {
  var inner = document.getElementById('book-page-inner');
  var pageText = pages[currentPage] || '';

  if (currentPage === 0) {
    // 第一页：标题 + 正文
    var titleText = newStoryTitle;
    var bodyText = pageText;
    inner.innerHTML =
      '<div class="new-story-title" id="new-story-title" contenteditable="true">' + escapeHtml(titleText) + '</div>' +
      '<div class="new-story-body" id="new-story-body" contenteditable="true">' + escapeHtml(bodyText) + '</div>';
  } else {
    // 后续页：只有正文
    inner.innerHTML =
      '<div class="new-story-body" id="new-story-body" contenteditable="true">' + escapeHtml(pageText) + '</div>';
  }

  // 自动保存：输入后 1.5 秒防抖
  var titleEl = document.getElementById('new-story-title');
  var bodyEl = document.getElementById('new-story-body');
  var scheduleSave = function() {
    newStoryDirty = true;
    clearTimeout(newStorySaveTimeout);
    newStorySaveTimeout = setTimeout(autoSaveNewStory, 1500);
  };
  if (titleEl) titleEl.addEventListener('input', scheduleSave);
  if (bodyEl) {
    bodyEl.addEventListener('input', scheduleSave);
    bodyEl.focus();
  }
}

async function autoSaveNewStory() {
  if (newStorySavePromise) {
    var saved = await newStorySavePromise;
    return saved && newStoryDirty ? autoSaveNewStory() : saved;
  }
  if (!isNewStory || !newStoryDirty) return true;
  flushNewStoryPage();
  var title = newStoryTitle;
  var content = pages.join('\n---PAGE---\n');

  // 标题和正文都为空则跳过
  if (!title && !pages.some(function(p) { return p.trim(); })) return true;
  title = title || '未命名';
  newStoryDirty = false;
  newStorySavePromise = (async function() {
   try {
    if (newStoryId) {
      var updated = await fetch('/api/stories/' + newStoryId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, content: content }),
      });
      if (!updated.ok) throw new Error((await updated.json()).error || '更新失败');
    } else {
      var res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, content: content }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '创建失败');
      var data = await res.json();
      newStoryId = data.item.id;
      for (var i = 0; i < storyPageStarts.length; i++) {
        if (storyPageStarts[i].id === '__new__') {
          storyPageStarts[i].id = String(newStoryId);
          break;
        }
      }
      currentStory = { id: newStoryId, title: title };
    }
    showToast('已自动保存');
    return true;
  } catch (err) {
    newStoryDirty = true;
    showToast('保存失败: ' + err.message);
    return false;
  }
  })();
  try { return await newStorySavePromise; }
  finally { newStorySavePromise = null; }
}

// ========== 阅读器返回 ==========
document.getElementById('reader-back-btn').addEventListener('click', switchToList);

// ========== 翻页按钮 ==========
document.getElementById('page-prev').addEventListener('click', prevPage);
document.getElementById('page-next').addEventListener('click', nextPage);

// 键盘翻页
document.addEventListener('keydown', function(e) {
  if (!currentStory) return;
  // 新建模式下，如果焦点在编辑区内则不拦截键盘
  if (isNewStory && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    var active = document.activeElement;
    if (active && (active.id === 'new-story-title' || active.id === 'new-story-body')) return;
  }
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
});

// ========== 初始化 ==========
loadStories();
