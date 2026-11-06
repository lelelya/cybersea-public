// js/anniversary.js — 纪念日页面逻辑（v2 毛玻璃卡片版）

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

// ---------- 渲染列表 ----------
async function loadList() {
  const res = await fetch('/api/anniversary');
  const data = await res.json();
  const list = data.anniversaries || [];
  const container = document.getElementById('anniversary-list');

  if (list.length === 0) {
    container.innerHTML = '<div class="anniversary-empty">还没有添加任何纪念日<br><span style="font-size:12px;opacity:0.7;">点击右上角 + 创建第一个吧</span></div>';
    return;
  }

  container.innerHTML = list.map((a, i) => {
    const isFirst = i === 0;
    const hasSubtitle = a.subtitle && a.subtitle.trim();

    return `
      <div class="anniversary-card${isFirst ? ' first-card' : ''}" data-id="${a.id}">
        <button class="card-menu-btn" data-action="menu">···</button>

        <div class="card-dropdown" data-role="dropdown">
          <button data-action="edit">编辑</button>
          <button data-action="delete" class="danger">删除</button>
        </div>

        <div class="days-count">${a.days_passed} 天</div>
        <div class="card-info">
          <span class="info-name">${escapeHtml(a.name)}</span>
          <span class="info-divider"></span>
          <span>${escapeHtml(a.date)}</span>
        </div>

        <div class="card-subtitle-wrap">
          <div class="card-subtitle${hasSubtitle ? '' : ' placeholder'}">${hasSubtitle ? escapeHtml(a.subtitle) : '还没有写副标题...'}</div>
        </div>

        <div class="card-edit-form">
          <input type="text" class="edit-name" value="${escapeHtml(a.name)}" placeholder="名称" />
          <input type="text" class="edit-date" value="${escapeHtml(a.date)}" placeholder="YYYY-MM-DD" />
          <input type="text" class="edit-subtitle" value="${escapeHtml(a.subtitle || '')}" placeholder="副标题（选填）" />
          <div class="edit-actions">
            <button class="btn-secondary btn-sm" data-action="cancel-edit">取消</button>
            <button class="btn-primary btn-sm" data-action="save-edit">保存</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // ---------- 事件绑定 ----------
  bindCardEvents(container);
}

function bindCardEvents(container) {
  container.querySelectorAll('.anniversary-card').forEach((card) => {
    // 卡片主体点击 → 展开/收起（排除编辑模式）
    card.addEventListener('click', (e) => {
      if (card.classList.contains('editing')) return;
      // 不拦截菜单按钮和下拉菜单的点击
      if (e.target.closest('[data-action="menu"]')) return;
      if (e.target.closest('[data-role="dropdown"]')) return;
      card.classList.toggle('expanded');
    });

    // "..." 菜单按钮
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

    // 下拉菜单项
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      enterEditMode(card);
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      if (!confirm('确定删除这个纪念日吗？')) return;
      const id = card.dataset.id;
      const res = await fetch(`/api/anniversary/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('已删除');
        loadList();
      }
    });

    // 编辑模式按钮
    card.querySelector('[data-action="cancel-edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      exitEditMode(card);
    });

    card.querySelector('[data-action="save-edit"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = card.dataset.id;
      const name = card.querySelector('.edit-name').value.trim();
      const date = card.querySelector('.edit-date').value.trim();
      const subtitle = card.querySelector('.edit-subtitle').value.trim();

      if (!name || !date) {
        showToast('名称和日期不能为空');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        showToast('日期格式应为 YYYY-MM-DD');
        return;
      }

      const res = await fetch(`/api/anniversary/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date, subtitle }),
      });
      if (res.ok) {
        showToast('已保存');
        loadList();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('保存失败: ' + (err.error || ''));
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
  card.classList.remove('expanded');
  // 自动聚焦第一个输入框
  setTimeout(() => {
    const firstInput = card.querySelector('.edit-name');
    if (firstInput) firstInput.focus();
  }, 100);
}

function exitEditMode(card) {
  card.classList.remove('editing');
}

// ---------- 新建弹窗 ----------
function initCreateModal() {
  const overlay = document.getElementById('create-modal-overlay');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');
  const nameInput = document.getElementById('modal-name');
  const dateInput = document.getElementById('modal-date');
  const subtitleInput = document.getElementById('modal-subtitle');

  function openModal() {
    nameInput.value = '';
    dateInput.value = '';
    subtitleInput.value = '';
    overlay.style.display = 'flex';
    setTimeout(() => nameInput.focus(), 100);
  }

  function closeModal() {
    overlay.style.display = 'none';
  }

  document.getElementById('add-btn').addEventListener('click', openModal);

  cancelBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const date = dateInput.value.trim();
    const subtitle = subtitleInput.value.trim();

    if (!name || !date) {
      showToast('请填写名称和日期');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showToast('日期格式应为 YYYY-MM-DD');
      return;
    }

    const res = await fetch('/api/anniversary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, date, subtitle }),
    });

    if (res.ok) {
      showToast('已添加');
      closeModal();
      loadList();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('添加失败: ' + (err.error || ''));
    }
  });

  // ESC 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') {
      closeModal();
    }
  });
}

// ---------- 启动 ----------
// 全局点击关闭所有下拉菜单（只注册一次）
document.addEventListener('click', closeAllDropdowns);

initCreateModal();
loadList();
