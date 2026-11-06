// js/moments.js — 朋友圈页面逻辑

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

let personaCache = null;

async function loadPersona() {
  const res = await fetch('/api/persona');
  personaCache = await res.json();
}

async function loadBio() {
  const res = await fetch('/api/moments/bio');
  const bio = await res.json();
  const bioText = bio.user_bio || '写点什么当签名……';

  const textDisplay = document.getElementById('bio-text-display');
  const inputEl = document.getElementById('user-bio-input');

  textDisplay.textContent = bioText;
  inputEl.value = bio.user_bio || '';

  document.getElementById('my-name-display').textContent = personaCache?.user_name || '我';
  const avatarPath = personaCache?.user_avatar_path || '';
  const preview = document.getElementById('my-avatar-preview');
  if (avatarPath) {
    preview.src = avatarPath;
  } else {
    preview.replaceWith((() => {
      const div = document.createElement('div');
      div.className = 'avatar avatar-fallback';
      div.style.background = typeof avatarFallbackColor === 'function' ? avatarFallbackColor(personaCache?.user_name) : 'var(--color-primary)';
      div.textContent = (personaCache?.user_name || '?').charAt(0);
      div.id = 'my-avatar-preview';
      return div;
    })());
  }
}

// Bio Click to Edit
const bioDisplayContainer = document.getElementById('bio-display-container');
const bioTextDisplay = document.getElementById('bio-text-display');
const userBioInput = document.getElementById('user-bio-input');

bioTextDisplay.addEventListener('click', () => {
  bioTextDisplay.style.display = 'none';
  userBioInput.style.display = 'block';
  userBioInput.focus();
});

userBioInput.addEventListener('blur', async () => {
  const user_bio = userBioInput.value.trim();
  bioTextDisplay.textContent = user_bio || '写点什么当签名……';
  userBioInput.style.display = 'none';
  bioTextDisplay.style.display = 'block';

  const res = await fetch('/api/moments/bio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_bio }),
  });
  if (res.ok) showToast('签名已保存');
});

userBioInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    userBioInput.blur();
  }
});

// Cover Image Upload (Local Storage for now)
const coverArea = document.getElementById('cover-area');
const coverUploadInput = document.getElementById('cover-upload-input');

const savedCover = localStorage.getItem('wechat_cover_image');
if (savedCover) {
  coverArea.style.backgroundImage = `url('${savedCover}')`;
}

coverArea.addEventListener('click', (e) => {
  // If clicking on avatar or name, don't trigger cover upload
  if (e.target.closest('.moments-user-info') || e.target.closest('.post-camera-btn')) return;
  coverUploadInput.click();
});

coverUploadInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    coverArea.style.backgroundImage = `url('${dataUrl}')`;
    localStorage.setItem('wechat_cover_image', dataUrl);
  };
  reader.readAsDataURL(file);
});

// ========== 图片选择 ==========

const momentImageInput = document.getElementById('moment-image-input');
const momentThumbGrid = document.getElementById('moment-thumb-grid');
let selectedFiles = []; // File 对象数组，发布时清空

momentImageInput.addEventListener('change', () => {
  const files = Array.from(momentImageInput.files || []);
  const remaining = 9 - selectedFiles.length;
  if (files.length > remaining) {
    showToast('最多选9张图片');
    momentImageInput.value = '';
    return;
  }
  files.forEach((f) => {
    if (!f.type.startsWith('image/')) return;
    selectedFiles.push(f);
  });
  momentImageInput.value = '';
  renderThumbGrid();
});

function renderThumbGrid() {
  momentThumbGrid.innerHTML = '';
  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const wrap = document.createElement('div');
    wrap.className = 'wx-photo-wrap';
    const img = document.createElement('img');
    img.src = url;
    const badge = document.createElement('span');
    badge.className = 'wx-photo-badge';
    badge.textContent = i + 1;
    const del = document.createElement('button');
    del.className = 'wx-photo-del';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(url);
      selectedFiles.splice(i, 1);
      renderThumbGrid();
    });
    wrap.appendChild(img);
    wrap.appendChild(badge);
    wrap.appendChild(del);
    momentThumbGrid.appendChild(wrap);
  });
  // 不到9张时在 Grid 末尾追加 + 号格子
  if (selectedFiles.length < 9) {
    const addBtn = document.createElement('div');
    addBtn.className = 'wx-post-add';
    addBtn.id = 'moment-add-img-btn';
    addBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="1.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    addBtn.addEventListener('click', () => momentImageInput.click());
    momentThumbGrid.appendChild(addBtn);
  }
}

// ========== 图片压缩 ==========

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1920;
      let w = img.width, h = img.height;
      if (w <= maxSide && h <= maxSide) {
        resolve(file); // 不需要压缩
        return;
      }
      if (w > h) { h = Math.round(h * (maxSide / w)); w = maxSide; }
      else { w = Math.round(w * (maxSide / h)); h = maxSide; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('图片压缩失败，请重新选择图片')); return; }
        const name = file.name.replace(/\.[^.]+$/, '.jpg');
        resolve(new File([blob], name, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片，请重新选择')); };
    img.src = url;
  });
}

// ========== 发动态弹窗 ==========

const openPostModalBtn = document.getElementById('open-post-modal-btn');
const postModal = document.getElementById('post-modal');
const cancelPostBtn = document.getElementById('cancel-post-btn');
const postMomentBtn = document.getElementById('post-moment-btn');
const newMomentContent = document.getElementById('new-moment-content');

function resetPostModal() {
  newMomentContent.value = '';
  selectedFiles.forEach((f, i) => {
    const imgs = momentThumbGrid.querySelectorAll('img');
    if (imgs[i]) URL.revokeObjectURL(imgs[i].src);
  });
  selectedFiles = [];
  renderThumbGrid();
}

// 点击遮罩关闭
postModal.addEventListener('click', function(e) {
  if (e.target === postModal) { postModal.style.display = 'none'; resetPostModal(); }
});

openPostModalBtn.addEventListener('click', () => {
  resetPostModal();
  postModal.style.display = 'flex';
  newMomentContent.focus();
});

cancelPostBtn.addEventListener('click', () => {
  postModal.style.display = 'none';
  resetPostModal();
});

// Author Name and Avatar
function authorName(author) {
  if (!personaCache) return author === 'user' ? '我' : 'AI';
  return author === 'user' ? personaCache.user_name : personaCache.ai_name;
}

function avatarPathOf(author) {
  if (!personaCache) return '';
  return author === 'user' ? personaCache.user_avatar_path : personaCache.ai_avatar_path;
}

// Formatting time nicely
function formatTime(isoString) {
  if (!isoString) return '刚刚';
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 86400000 * 2) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function renderMoment(m) {
  const likedByUser = m.likes.some((l) => l.author === 'user');
  const likeNames = m.likes.map((l) => authorName(l.author)).join('、');

  const timeText = formatTime(m.created_at || new Date().toISOString());

  return `
    <div class="wechat-moment" data-id="${m.id}">
      <div class="wechat-avatar-wrap">
        ${typeof renderAvatarHtml === 'function' ? renderAvatarHtml(m.owner, avatarPathOf(m.owner), authorName(m.owner)) : ''}
      </div>

      <div class="wechat-moment-main">
        <div class="wechat-moment-header">
          <div class="wechat-author-name">${escapeHtml(authorName(m.owner))}</div>

          ${m.owner === 'user' ? `<div class="wechat-more-menu-wrap">
            <div class="wechat-more-btn" title="更多">···</div>
            <div class="wechat-more-dropdown">
              <div class="wechat-dropdown-item delete-moment-btn" style="color:var(--color-danger); padding:4px 12px; cursor:pointer; font-size:13px; white-space:nowrap;">删除动态</div>
            </div>
          </div>` : ''}
        </div>

        <div class="wechat-moment-content">${escapeHtml(m.content)}</div>
        ${renderImagesGrid(m.image_path)}

        <div class="wechat-moment-footer">
          <div class="wechat-time">${timeText}</div>
          <div class="wechat-action-icons">
            <span class="wechat-icon-btn like-btn ${likedByUser ? 'liked' : ''}" title="${likedByUser ? '取消赞' : '赞'}">
              ${likedByUser
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--color-primary)" stroke="var(--color-primary)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
              }
            </span>
            <span class="wechat-icon-btn comment-btn" title="评论">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </span>
          </div>
        </div>

        ${(m.likes.length > 0 || m.comments.length > 0) ? `
        <div class="wechat-interaction-area">
          ${m.likes.length ? `<div class="wechat-likes ${m.comments.length ? 'has-comments' : ''}"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-primary)" stroke="var(--color-primary)" stroke-width="2" style="vertical-align:-3px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${escapeHtml(likeNames)}</div>` : ''}
          ${m.comments.length ? `
          <div class="wechat-comments">
            ${m.comments.map((c) => `
              <div class="wechat-comment-item">
                <span class="wechat-comment-author">${escapeHtml(authorName(c.author))}</span>：<span class="wechat-comment-text">${escapeHtml(c.content)}</span>
              </div>
            `).join('')}
          </div>
          ` : ''}
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Comment Modal Logic
const commentModal = document.getElementById('comment-modal');
const commentInputField = document.getElementById('comment-input-field');
const submitCommentBtn = document.getElementById('submit-comment-btn');
let currentCommentMomentId = null;

// Close comment modal if clicking outside
commentModal.addEventListener('click', (e) => {
  if (e.target === commentModal) {
    commentModal.style.display = 'none';
    currentCommentMomentId = null;
  }
});

async function submitComment() {
  if (!currentCommentMomentId || submitCommentBtn.disabled) return;
  const content = commentInputField.value.trim();
  if (!content) return;

  submitCommentBtn.disabled = true;
  try {
    const res = await fetch(`/api/moments/${currentCommentMomentId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error((await res.json()).error || '评论失败');
    showToast('已评论');
    commentModal.style.display = 'none';
    commentInputField.value = '';
    loadMoments();
  } catch (err) {
    showToast(err.message);
  } finally {
    submitCommentBtn.disabled = false;
  }
}

submitCommentBtn.addEventListener('click', submitComment);
commentInputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitComment();
  }
});

// 解析 image_path 为图片数组（兼容旧单图字符串和新 JSON 数组）
function parseImagePaths(imagePath) {
  if (!imagePath) return [];
  if (imagePath.startsWith('[')) {
    try { const paths = JSON.parse(imagePath); return Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p) : []; } catch (_) { return []; }
  }
  return [imagePath]; // 旧格式单图
}

function renderImagesGrid(imagePath) {
  const paths = parseImagePaths(imagePath);
  if (paths.length === 0) return '';
  const count = paths.length;
  const html = paths.map((p) =>
    `<img class="grid-img" src="${escapeHtml(p)}" loading="lazy" alt="" data-src="${escapeHtml(p)}" />`
  ).join('');
  return `<div class="moment-images-grid count-${Math.min(count, 9)}">${html}</div>`;
}

// ========== 全屏预览 ==========

const imagePreviewOverlay = document.getElementById('image-preview-overlay');
const imagePreviewImg = document.getElementById('image-preview-img');

imagePreviewOverlay.addEventListener('click', () => {
  imagePreviewOverlay.style.display = 'none';
  imagePreviewImg.src = '';
});

// 委托点击事件：监听所有 .grid-img
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('grid-img')) {
    imagePreviewImg.src = e.target.dataset.src || e.target.src;
    imagePreviewOverlay.style.display = 'flex';
  }
});

// ========== 加载列表 ==========

async function loadMoments() {
  const res = await fetch('/api/moments');
  const data = await res.json();
  const list = document.getElementById('moments-list');
  const moments = data.moments || [];

  if (moments.length === 0) {
    list.innerHTML = '<div style="color:#666;font-size:13px;text-align:center;padding-top:40px;">还没有任何动态</div>';
    return;
  }

  list.innerHTML = moments.map(renderMoment).join('');

  list.querySelectorAll('.wechat-moment').forEach((card) => {
    const id = card.dataset.id;

    // More Menu
    const moreBtn = card.querySelector('.wechat-more-btn');
    const moreDropdown = card.querySelector('.wechat-more-dropdown');

    if (moreBtn && moreDropdown) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // close all other dropdowns
        document.querySelectorAll('.wechat-more-dropdown').forEach(d => {
          if (d !== moreDropdown) d.classList.remove('show');
        });
        moreDropdown.classList.toggle('show');
      });
    }

    const deleteBtn = card.querySelector('.delete-moment-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除这条动态吗？')) {
          moreDropdown.classList.remove('show');
          return;
        }
        try {
          const response = await fetch(`/api/moments/${id}`, { method: 'DELETE' });
          if (!response.ok) throw new Error((await response.json()).error || '删除失败');
          showToast('已删除');
          await loadMoments();
        } catch (error) { showToast(error.message); }
      });
    }

    // Like
    card.querySelector('.like-btn').addEventListener('click', async () => {
      try {
      const response = await fetch(`/api/moments/${id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'user' }),
      });
      if (!response.ok) throw new Error((await response.json()).error || '点赞失败');
      await loadMoments();
      } catch (error) { showToast(error.message); }
    });

    // Comment
    card.querySelector('.comment-btn').addEventListener('click', () => {
      currentCommentMomentId = id;
      commentModal.style.display = 'flex';
      commentInputField.focus();
    });
  });
}

// Global click to close dropdowns
document.addEventListener('click', () => {
  document.querySelectorAll('.wechat-more-dropdown').forEach(d => d.classList.remove('show'));
});

postMomentBtn.addEventListener('click', async () => {
  const content = newMomentContent.value.trim();
  if (!content) { showToast('写点什么再发吧'); return; }

  postMomentBtn.disabled = true;
  postMomentBtn.textContent = '发布中……';
  try {
    // 有图先上传
    let imagePaths = [];
    if (selectedFiles.length > 0) {
      const compressed = await Promise.all(selectedFiles.map(compressImage));
      const formData = new FormData();
      compressed.forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/moments/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('图片上传失败');
      const uploadData = await uploadRes.json();
      imagePaths = uploadData.paths || [];
    }

    const res = await fetch('/api/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, images: imagePaths }),
    });
    if (!res.ok) throw new Error((await res.json()).error || '发布失败');
    resetPostModal();
    postModal.style.display = 'none';
    showToast('已发布');
    loadMoments();
  } catch (err) {
    showToast(err.message);
  } finally {
    postMomentBtn.disabled = false;
    postMomentBtn.textContent = '发布';
  }
});

(async () => {
  await loadPersona();
  await loadBio();
  await loadMoments();
})();
