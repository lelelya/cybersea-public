// js/avatar.js
// 共享的头像渲染小工具，供聊天页/朋友圈页/主页共用。
// 没有上传头像时用"名字首字 + 固定底色"兜底，保证任何情况下都"看得到"头像，而不是空白。
// 同时提供"点击头像跳转到该角色主页(profile.html)"的统一行为。

/**
 * 返回头像的HTML片段。owner: 'user' | 'ai'。
 * avatarPath 为空时用兜底样式（黑底白字首字），不会显示空白图片。
 * clickable=true 时包一层可点击的容器，点击跳转到 profile.html?owner=xxx。
 */
function renderAvatarHtml(owner, avatarPath, name, clickable = true) {
  const inner = avatarPath
    ? `<img class="avatar" src="${avatarPath}" alt="" />`
    : `<div class="avatar avatar-fallback" style="background:#1a1a2e;color:#eaf1ff;">${escapeHtmlForAvatar(name).charAt(0) || '?'}</div>`;

  if (!clickable) return inner;
  return `<span class="avatar-link" data-owner="${owner}" title="查看${escapeHtmlForAvatar(name)}的主页">${inner}</span>`;
}

function escapeHtmlForAvatar(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 事件委托：任何页面只要引入这个文件，点击 .avatar-link 就会自动跳转到主页
document.addEventListener('click', (e) => {
  const link = e.target.closest('.avatar-link');
  if (!link) return;
  const owner = link.dataset.owner;
  if (owner) window.location.href = `profile.html?owner=${owner}`;
});
