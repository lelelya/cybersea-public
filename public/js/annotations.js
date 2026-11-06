// annotations.js — 共享批画组件
// 被 diary.html, stories.html, books.html 复用
// 提供：浮动工具条、标记渲染、标记hover/click

function _annotToast(msg) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 300); }, 2500);
}

/**
 * 加载某页面的批画列表
 * @param {string} sourceType — 'diary_user' | 'diary_ai' | 'story' | 'book'
 * @param {string} sourceId
 * @returns {Promise<Array>}
 */
async function loadAnnotations(sourceType, sourceId) {
  try {
    const resp = await fetch(`/api/annotations?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`);
    const data = await resp.json();
    return data.annotations || [];
  } catch (err) {
    console.error('[annotations] 加载失败:', err);
    _annotToast('批画数据加载失败');
    return [];
  }
}

/**
 * 在文本中应用批画标记
 * @param {string} text — 原始文本
 * @param {Array} annotations — 批画列表
 * @returns {string} — 带标记HTML
 */
function applyAnnotationMarks(text, annotations) {
  if (!annotations || annotations.length === 0) return text;

  // 按文本长度降序排序，优先匹配长文本
  const sorted = [...annotations].sort((a, b) => b.selected_text.length - a.selected_text.length);

  // 已替换的位置集合，避免嵌套
  const replaced = new Set();

  let result = text;
  for (const ann of sorted) {
    if (replaced.has(ann.selected_text)) continue;
    const idx = result.indexOf(ann.selected_text);
    if (idx === -1) continue;

    const markClass = ann.mark_type === 'circle' ? 'annot-mark-circle' :
                      ann.mark_type === 'wavy' ? 'annot-mark-wavy' :
                      ann.mark_type === 'double_line' ? 'annot-mark-double_line' : 'annot-mark-single_line';
    const noteAttr = ann.note ? ` data-note="${escapeAttr(ann.note)}"` : '';
    const replacement = `<span class="${markClass}"${noteAttr} data-ann-id="${ann.id}">${ann.selected_text}</span>`;

    result = result.replace(ann.selected_text, replacement);
    replaced.add(ann.selected_text);
  }

  return result;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 绑定标记hover事件（移动端用click）
 * @param {HTMLElement} container
 */
function bindAnnotationHover(container) {
  const marks = container.querySelectorAll('[class^="annot-mark-"]');
  marks.forEach(mark => {
    // 移动端点击显示
    mark.addEventListener('click', function(e) {
      const note = this.dataset.note;
      if (note) {
        e.stopPropagation();
        const existing = document.querySelector('.annot-note-popup');
        if (existing) existing.remove();
        if (this._noteVisible) {
          this._noteVisible = false;
          return;
        }
        this._noteVisible = true;
        const popup = document.createElement('div');
        popup.className = 'annot-note-popup';
        popup.textContent = note;
        popup.style.cssText = `
          position:fixed; z-index:9999;
          background:rgba(12,18,34,0.95); backdrop-filter:blur(12px);
          color:#eaf1ff; padding:8px 14px; border-radius:10px;
          font-size:13px; max-width:250px; border:1px solid rgba(160,200,255,0.3);
          box-shadow:0 4px 20px rgba(0,0,0,0.5);
          pointer-events:none;
        `;
        const rect = this.getBoundingClientRect();
        popup.style.left = Math.min(rect.left, window.innerWidth - 270) + 'px';
        popup.style.top = (rect.bottom + 6) + 'px';
        document.body.appendChild(popup);
        setTimeout(() => {
          if (popup.parentNode) popup.remove();
          this._noteVisible = false;
        }, 3000);
      }
    });
  });
}

/**
 * 初始化浮动批画工具条（文本选择监听）
 * @param {HTMLElement} textContainer — 文本容器
 * @param {object} opts
 * @param {string} opts.sourceType
 * @param {string} opts.sourceId
 * @param {string} opts.annotator — 'user' | 'ai'
 */
function initAnnotationToolbar(textContainer, opts) {
  const toolbar = document.getElementById('annot-toolbar');
  if (!toolbar || !textContainer) return;

  const noteWrap = document.getElementById('annot-note-wrap');
  const noteInput = document.getElementById('annot-note-input');
  const noteConfirm = document.getElementById('annot-note-confirm');

  let pendingMarkType = null;
  let selectedText = '';

  function hideToolbar() {
    toolbar.classList.remove('show');
    noteWrap.style.display = 'none';
    pendingMarkType = null;
    selectedText = '';
  }

  document.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      if (!text || text.length < 2) {
        // 点击toolbar外部时关闭
        if (!toolbar.contains(e.target)) hideToolbar();
        return;
      }
      // 检查选区是否在容器内
      if (!textContainer.contains(sel.anchorNode)) return;

      selectedText = text;
      pendingMarkType = null;
      noteWrap.style.display = 'none';
      noteInput.value = '';

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // 移动端在选区上方，桌面端在下方
      const top = window.innerWidth < 600
        ? Math.max(rect.top - 50, 10)
        : Math.min(rect.bottom + 8, window.innerHeight - 50);

      toolbar.style.left = Math.max(10, Math.min(rect.left + (rect.width - 280) / 2, window.innerWidth - 300)) + 'px';
      toolbar.style.top = top + 'px';
      toolbar.classList.add('show');
    }, 10);
  });

  // 工具栏按钮
  toolbar.querySelectorAll('.annot-toolbar-btn[data-mark]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingMarkType = btn.dataset.mark;
      noteWrap.style.display = 'flex';
      noteInput.focus();
    });
  });

  // 确认批注
  noteConfirm.addEventListener('click', async () => {
    if (!pendingMarkType || !selectedText) return;
    const note = noteInput.value.trim();

    try {
      await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: opts.sourceType,
          source_id: opts.sourceId,
          annotator: opts.annotator,
          selected_text: selectedText,
          mark_type: pendingMarkType,
          note: note || '',
        }),
      });
    } catch (err) {
      console.error('[annotations] 创建失败:', err);
      _annotToast('批画创建失败');
    }

    hideToolbar();
    // 重新渲染
    if (opts.onAnnotationChange) opts.onAnnotationChange();
  });

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!toolbar.contains(e.target) && !textContainer.contains(e.target)) {
      hideToolbar();
    }
  });

  // 移动端触摸
  document.addEventListener('touchend', (e) => {
    if (!toolbar.contains(e.target) && !textContainer.contains(e.target)) {
      setTimeout(hideToolbar, 200);
    }
  });

  // 窗口滚动时关闭
  window.addEventListener('scroll', hideToolbar, { passive: true });
}
