// js/album.js — 相册页面逻辑
// 「我的相册」和「他的相册」调用同一套API，只是 owner 参数不同，两个分区数据完全独立。
// 视图分两层：文件夹网格列表 -> 点开某个文件夹 -> 该文件夹内的照片九宫格。

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

let currentOwner = 'user';
let currentFolder = { user: null, ai: null }; // { id, name } | null

document.getElementById('tab-user').addEventListener('click', () => switchOwner('user'));
document.getElementById('tab-ai').addEventListener('click', () => switchOwner('ai'));

function switchOwner(owner) {
  currentOwner = owner;
  document.getElementById('tab-user').classList.toggle('active', owner === 'user');
  document.getElementById('tab-ai').classList.toggle('active', owner === 'ai');
  document.getElementById('user-panel').style.display = owner === 'user' ? 'block' : 'none';
  document.getElementById('ai-panel').style.display = owner === 'ai' ? 'block' : 'none';
  showListView(owner);
  loadFolders(owner);
}

function showListView(owner) {
  document.getElementById(`${owner}-list-view`).style.display = 'block';
  document.getElementById(`${owner}-folder-view`).style.display = 'none';
  currentFolder[owner] = null;
}

function showFolderView(owner, folder) {
  currentFolder[owner] = folder;
  document.getElementById(`${owner}-list-view`).style.display = 'none';
  document.getElementById(`${owner}-folder-view`).style.display = 'block';
  document.getElementById(`${owner}-folder-title`).textContent = folder ? folder.name : '未分类照片';

  // "编辑/删除" 按钮只在有选中具体文件夹时显示
  const editBtn = document.getElementById(`${owner}-edit-folder-btn`);
  const deleteBtn = document.getElementById(`${owner}-delete-folder-btn`);
  if (editBtn) editBtn.style.display = folder ? 'block' : 'none';
  if (deleteBtn) deleteBtn.style.display = folder ? 'block' : 'none';

  loadPhotos(owner);
}

// ---------------- 文件夹列表（网格卡片，封面取文件夹里第一张照片） ----------------

async function loadFolders(owner) {
  const res = await fetch(`/api/album/folders?owner=${owner}`);
  const data = await res.json();
  const folders = data.folders || [];

  const grid = document.getElementById(`${owner}-folder-grid`);
  const empty = document.getElementById(`${owner}-folder-empty`);

  if (folders.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  // 先占位渲染，再异步补上每个文件夹的封面图+张数
  grid.innerHTML = folders.map((f) => `
    <div class="folder-card" data-id="${f.id}" data-name="${escapeHtml(f.name)}">
      <div class="folder-card-cover" id="folder-cover-${owner}-${f.id}">${folderPlaceholderIcon()}</div>
      <div class="folder-card-name">${escapeHtml(f.name)}</div>
      <div class="folder-card-count" id="folder-count-${owner}-${f.id}">…</div>
    </div>
  `).join('');

  grid.querySelectorAll('.folder-card').forEach((card) => {
    card.addEventListener('click', () => {
      showFolderView(owner, { id: card.dataset.id, name: card.dataset.name });
    });
  });

  folders.forEach((f) => fillFolderCover(owner, f.id));
}

function folderPlaceholderIcon() {
  return `
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    </svg>
  `;
}

async function fillFolderCover(owner, folderId) {
  const res = await fetch(`/api/album/photos?owner=${owner}&folder_id=${folderId}`);
  const data = await res.json();
  const photos = data.photos || [];

  const countEl = document.getElementById(`folder-count-${owner}-${folderId}`);
  if (countEl) countEl.textContent = `${photos.length} 张照片`;

  if (photos.length > 0) {
    const coverEl = document.getElementById(`folder-cover-${owner}-${folderId}`);
    if (coverEl) coverEl.innerHTML = `<img src="${photos[0].path}" alt="" />`;
  }
}

// ---------------- 文件夹内照片 ----------------

async function loadPhotos(owner) {
  const folder = currentFolder[owner];
  const url = folder
    ? `/api/album/photos?owner=${owner}&folder_id=${folder.id}`
    : `/api/album/photos?owner=${owner}`;

  const res = await fetch(url);
  const data = await res.json();
  const grid = document.getElementById(owner === 'user' ? 'user-photo-grid' : 'ai-photo-grid');
  const photos = data.photos || [];

  if (photos.length === 0) {
    grid.innerHTML = '<div class="memory-hint">还没有照片</div>';
    return;
  }

  grid.innerHTML = photos.map((p) => `
    <div class="photo-card" data-id="${p.id}">
      <img src="${p.path}" alt="" />
      ${p.caption ? `<div class="photo-caption">${escapeHtml(p.caption)}</div>` : ''}
      <button class="photo-delete" data-id="${p.id}">删除</button>
    </div>
  `).join('');

  grid.querySelectorAll('.photo-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/album/photos/${btn.dataset.id}`, { method: 'DELETE' });
      showToast('已删除');
      loadPhotos(owner);
    });
  });
}

// ---------------- 返回文件夹列表 ----------------

document.getElementById('user-back-btn').addEventListener('click', () => {
  showListView('user');
  loadFolders('user');
});
document.getElementById('ai-back-btn').addEventListener('click', () => {
  showListView('ai');
  loadFolders('ai');
});

document.getElementById('user-delete-folder-btn').addEventListener('click', () => deleteFolder('user'));
document.getElementById('ai-delete-folder-btn').addEventListener('click', () => deleteFolder('ai'));
document.getElementById('user-edit-folder-btn').addEventListener('click', () => openRenameFolderModal('user'));
document.getElementById('ai-edit-folder-btn').addEventListener('click', () => openRenameFolderModal('ai'));

async function deleteFolder(owner) {
  const folder = currentFolder[owner];
  if (!folder) return;
  if (!confirm('确定删除该相册吗？\n注意：相册内的照片会被移出，而不是被删除（它们会变成未分类照片）。')) return;

  const res = await fetch(`/api/album/folders/${folder.id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('相册已删除');
    showListView(owner);
    loadFolders(owner);
  } else {
    showToast('删除失败');
  }
}

// ---------------- 新建/重命名相册弹窗 ----------------

let folderModalOwner = 'user';
let folderModalMode = 'create'; // 'create' | 'rename'

function openFolderModal(owner) {
  folderModalOwner = owner;
  folderModalMode = 'create';
  document.getElementById('folder-modal-title').textContent = '新建相册';
  document.getElementById('folder-modal-confirm').textContent = '创建';
  document.getElementById('folder-modal-input').value = '';
  document.getElementById('folder-modal-overlay').style.display = 'flex';
  document.getElementById('folder-modal-input').focus();
}

function openRenameFolderModal(owner) {
  const folder = currentFolder[owner];
  if (!folder) return;
  folderModalOwner = owner;
  folderModalMode = 'rename';
  document.getElementById('folder-modal-title').textContent = '重命名相册';
  document.getElementById('folder-modal-confirm').textContent = '保存';
  document.getElementById('folder-modal-input').value = folder.name;
  document.getElementById('folder-modal-overlay').style.display = 'flex';
  document.getElementById('folder-modal-input').focus();
}

function closeFolderModal() {
  document.getElementById('folder-modal-overlay').style.display = 'none';
}

document.getElementById('user-add-folder-btn').addEventListener('click', () => openFolderModal('user'));
document.getElementById('ai-add-folder-btn').addEventListener('click', () => openFolderModal('ai'));
document.getElementById('folder-modal-cancel').addEventListener('click', closeFolderModal);
document.getElementById('folder-modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'folder-modal-overlay') closeFolderModal();
});

document.getElementById('folder-modal-confirm').addEventListener('click', async () => {
  const name = document.getElementById('folder-modal-input').value.trim();
  if (!name) { showToast('请输入相册名称'); return; }

  if (folderModalMode === 'create') {
    await fetch('/api/album/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: folderModalOwner, name }),
    });
    showToast('已新建相册');
    closeFolderModal();
    loadFolders(folderModalOwner);
  } else if (folderModalMode === 'rename') {
    const folder = currentFolder[folderModalOwner];
    await fetch(`/api/album/folders/${folder.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    showToast('已重命名相册');
    folder.name = name; // 更新当前状态
    document.getElementById(`${folderModalOwner}-folder-title`).textContent = name;
    closeFolderModal();
  }
});

document.getElementById('folder-modal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('folder-modal-confirm').click();
});

// ---------------- 上传（仅限"我的相册"文件夹内） ----------------

const userUploadZone = document.getElementById('user-upload-zone');
const userUploadInput = document.getElementById('user-upload-input');

userUploadZone.addEventListener('click', () => userUploadInput.click());

userUploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  userUploadZone.classList.add('dragover');
});
userUploadZone.addEventListener('dragleave', () => {
  userUploadZone.classList.remove('dragover');
});
userUploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  userUploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) uploadUserPhoto(file);
});

userUploadInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadUserPhoto(file);
  e.target.value = '';
});

async function uploadUserPhoto(file) {
  const folder = currentFolder.user;

  const formData = new FormData();
  formData.append('file', file);
  if (folder) formData.append('folder_id', folder.id);

  try {
    const res = await fetch('/api/album/photos/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    showToast('已上传');
    loadPhotos('user');
  } catch (err) {
    showToast(err.message);
  }
}

switchOwner('user');
