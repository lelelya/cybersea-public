// js/plan.js — 专属计划页面逻辑（v2 深海手帐本风格）

let currentCategory = 'mine';

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

// ---------- Tab 切换 ----------
document.querySelectorAll('.plan-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.plan-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    loadPlans(currentCategory);
  });
});

// ---------- 渲染单条计划 ----------
function renderPlanRow(plan, category) {
  let checkboxHtml = '';
  if (category === 'mine') {
    checkboxHtml = `<input type="checkbox" class="plan-check" data-checker="user" ${plan.user_checked ? 'checked' : ''} />`;
  } else if (category === 'his') {
    checkboxHtml = `<input type="checkbox" class="plan-check" data-checker="ai" ${plan.ai_checked ? 'checked' : ''} />`;
  } else {
    // shared: two checkboxes
    checkboxHtml = `
      <input type="checkbox" class="plan-check" data-checker="user" title="我已打钩" ${plan.user_checked ? 'checked' : ''} />
      <input type="checkbox" class="plan-check" data-checker="ai" title="AI已打钩" ${plan.ai_checked ? 'checked' : ''} />
    `;
  }

  let followupHtml = '';
  if (plan.done) {
    if (category === 'mine') {
      followupHtml = `
        <input type="text" class="result-input" placeholder="你的结果" value="${escapeHtml(plan.result || '')}" />
        <input type="text" class="comment-input" placeholder="AI的评语" value="${escapeHtml(plan.comment || '')}" />
      `;
    } else if (category === 'his') {
      followupHtml = `
        <input type="text" class="result-input" placeholder="AI的结果" value="${escapeHtml(plan.result || '')}" />
        <input type="text" class="comment-input" placeholder="你的评语" value="${escapeHtml(plan.comment || '')}" />
      `;
    } else {
      followupHtml = `
        <div class="plan-followup-shared">
          <input type="text" class="user-reflection-input" placeholder="你的感想" value="${escapeHtml(plan.user_reflection || '')}" />
          <input type="text" class="ai-reflection-input" placeholder="AI的感想" value="${escapeHtml(plan.ai_reflection || '')}" />
        </div>
      `;
    }
  }

  const deleteSvg = `
    <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`;

  return `
    <div class="plan-row-wrap${plan.done ? ' done-row expanded' : ''}" data-id="${plan.id}">
      <div class="plan-row${plan.done ? ' done' : ''}">
        ${checkboxHtml}
        <span class="plan-text">${escapeHtml(plan.content)}</span>
        <span class="plan-author">由${plan.created_by === 'user' ? '你' : 'AI'}创建</span>
        <button class="plan-delete" title="删除">${deleteSvg}</button>
      </div>
      ${plan.done ? `
      <div class="plan-followup">
        ${followupHtml}
        <button class="btn-secondary btn-sm save-followup-btn">保存</button>
      </div>` : ''}
    </div>
  `;
}

// ---------- 加载计划列表 ----------
async function loadPlans(category) {
  const container = document.getElementById('plan-content');
  const res = await fetch(`/api/plan?category=${category}`);
  const data = await res.json();
  const plans = data.plans || [];

  if (plans.length === 0) {
    const labels = { mine: '我的计划', his: '他的计划', shared: '共同计划' };
    container.innerHTML = `<div class="plan-empty">还没有${labels[category] || ''}<br><span style="font-size:12px;">点击右下角 + 添加第一条吧</span></div>`;
    return;
  }

  container.innerHTML = plans.map((p) => renderPlanRow(p, category)).join('');

  // 绑定事件
  bindRowEvents(container, category);
}

function bindRowEvents(container, category) {
  container.querySelectorAll('.plan-row-wrap').forEach((wrap) => {
    const id = wrap.dataset.id;
    const row = wrap.querySelector('.plan-row');

    // 点击行 → 展开/收起跟进区（仅已完成）
    row.addEventListener('click', (e) => {
      // 不拦截 checkbox 和 delete 按钮
      if (e.target.closest('.plan-check')) return;
      if (e.target.closest('.plan-delete')) return;
      if (e.target.closest('input[type="text"]')) return;
      if (e.target.closest('.save-followup-btn')) return;
      if (wrap.classList.contains('done-row')) {
        wrap.classList.toggle('expanded');
      }
    });

    // 复选框
    wrap.querySelectorAll('.plan-check').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const res = await fetch(`/api/plan/${id}/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checker: cb.dataset.checker, checked: cb.checked }),
        });
        if (res.ok) {
          const updated = await res.json();
          // 他的计划：AI打钩完成 → 自动生成AI结果
          // 共同计划：任意一方打钩且已完成 → 自动生成AI感想
          if (updated.done && (category === 'his' || category === 'shared')) {
            showToast('AI正在生成...');
            const aiRes = await fetch(`/api/plan/${id}/ai-fill`, { method: 'POST' });
            if (!aiRes.ok) {
              const aiErr = await aiRes.json().catch(() => ({}));
              showToast(aiErr.error || 'AI生成失败');
            }
          }
          loadPlans(category);
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || '操作失败');
          cb.checked = !cb.checked;
        }
      });
    });

    // 删除按钮
    wrap.querySelector('.plan-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除这条计划吗？')) return;
      await fetch(`/api/plan/${id}`, { method: 'DELETE' });
      showToast('已删除');
      loadPlans(category);
    });

    // 跟进区保存
    const saveBtn = wrap.querySelector('.save-followup-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const payload = {};
        const resultInput = wrap.querySelector('.result-input');
        const commentInput = wrap.querySelector('.comment-input');
        const userReflectionInput = wrap.querySelector('.user-reflection-input');
        const aiReflectionInput = wrap.querySelector('.ai-reflection-input');
        if (resultInput) payload.result = resultInput.value;
        if (commentInput) payload.comment = commentInput.value;
        if (userReflectionInput) payload.user_reflection = userReflectionInput.value;
        if (aiReflectionInput) payload.ai_reflection = aiReflectionInput.value;

        const res = await fetch(`/api/plan/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          // 我的计划：保存结果后自动触发生成AI评语
          if (category === 'mine') {
            showToast('AI正在生成评语...');
            const aiRes = await fetch(`/api/plan/${id}/ai-fill`, { method: 'POST' });
            if (!aiRes.ok) {
              const aiErr = await aiRes.json().catch(() => ({}));
              showToast(aiErr.error || 'AI评语生成失败');
            } else {
              showToast('已保存，AI评语已生成');
            }
          } else {
            showToast('已保存');
          }
          loadPlans(category);
        } else {
          showToast('保存失败');
        }
      });
    }
  });
}

// ---------- 创建弹窗 ----------
function initCreateModal() {
  const overlay = document.getElementById('create-modal-overlay');
  const cancelBtn = document.getElementById('modal-cancel');
  const confirmBtn = document.getElementById('modal-confirm');
  const contentInput = document.getElementById('modal-content');
  const categorySelect = document.getElementById('modal-category');
  const creatorSelect = document.getElementById('modal-creator');

  function openModal() {
    contentInput.value = '';
    categorySelect.value = currentCategory;
    creatorSelect.value = 'user';
    overlay.style.display = 'flex';
    setTimeout(() => contentInput.focus(), 100);
  }

  function closeModal() {
    overlay.style.display = 'none';
  }

  document.getElementById('fab-btn').addEventListener('click', openModal);

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  confirmBtn.addEventListener('click', async () => {
    const content = contentInput.value.trim();
    if (!content) { showToast('请输入计划内容'); return; }

    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: categorySelect.value,
        content,
        created_by: creatorSelect.value,
      }),
    });

    if (res.ok) {
      showToast('已添加');
      closeModal();
      // 如果弹窗中选的分类与当前不同，切换 Tab
      if (categorySelect.value !== currentCategory) {
        currentCategory = categorySelect.value;
        document.querySelectorAll('.plan-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.category === currentCategory);
        });
      }
      loadPlans(currentCategory);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('添加失败: ' + (err.error || ''));
    }
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') {
      closeModal();
    }
  });
}

// ---------- 启动 ----------
initCreateModal();
loadPlans('mine');
