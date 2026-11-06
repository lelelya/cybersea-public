// js/ledger.js — 记账本页面逻辑

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth() + 1;
let viewDate = todayStr();  // 当前查看的日期

function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr() { return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`; }

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// --- 图标配置 ---
const TYPE_CONFIG = {
  expense: [
    { id: 'food', label: '餐饮', icon: '<path d="M4 8Q4 15 9 17v2h6v-2Q20 15 20 8"/><ellipse cx="12" cy="8" rx="8" ry="2"/>' },
    { id: 'transport', label: '交通', icon: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2m14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />' },
    { id: 'shopping', label: '购物', icon: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" />' },
    { id: 'entertainment', label: '娱乐', icon: '<path d="M21 15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM9 12v.01M6 12v.01M15 12v.01M18 12v.01" /><circle cx="15" cy="12" r="1" /><circle cx="18" cy="12" r="1" /><path d="M7.5 10.5v3M6 12h3" />' },
    { id: 'study', label: '学习', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />' },
    { id: 'health', label: '医疗', icon: '<g transform="rotate(30 12 12)"><rect x="7" y="3" width="10" height="18" rx="5"/><path d="M7 12h10"/></g>' },
    { id: 'life', label: '生活', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />' },
    { id: 'gift', label: '礼物', icon: '<polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />' },
    { id: 'other', label: '其他', icon: '<circle cx="12" cy="12" r="10" />' }
  ],
  income: [
    { id: 'salary', label: '工资', icon: '<line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />' },
    { id: 'redpacket', label: '红包', icon: '<rect x="3" y="4" width="18" height="16" rx="2" ry="2" /><path d="M21 8l-9 6-9-6" /><path d="M3 20l6-6" /><path d="M21 20l-6-6" />' },
    { id: 'refund', label: '退款', icon: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />' },
    { id: 'other', label: '其他', icon: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />' }
  ]
};

let currentMainType = 'expense';
let selectedSubType = 'food';

function getIconSvg(type, id) {
  const arr = TYPE_CONFIG[type] || [];
  const cfg = arr.find(c => c.id === id) || arr[arr.length - 1];
  return `<svg viewBox="0 0 24 24">${cfg?.icon || ''}</svg>`;
}

function getIconLabel(type, id) {
  const arr = TYPE_CONFIG[type] || [];
  const cfg = arr.find(c => c.id === id) || arr[arr.length - 1];
  return cfg?.label || '未知';
}

function initTypeGrid() {
  const renderGrid = (typeArray, containerId) => {
    const html = typeArray.map(c => `
      <div class="type-option ${c.id === selectedSubType ? 'selected' : ''}" data-id="${c.id}">
        <div class="type-icon"><svg viewBox="0 0 24 24">${c.icon}</svg></div>
        <div class="type-label">${c.label}</div>
      </div>
    `).join('');
    document.getElementById(containerId).innerHTML = html;
  };

  renderGrid(TYPE_CONFIG.expense, 'expense-types');
  renderGrid(TYPE_CONFIG.income, 'income-types');

  document.getElementById('expense-types').addEventListener('click', (e) => {
    const opt = e.target.closest('.type-option');
    if (opt) {
      document.querySelectorAll('#expense-types .type-option').forEach(el => el.classList.remove('selected'));
      opt.classList.add('selected');
      selectedSubType = opt.dataset.id;
    }
  });

  document.getElementById('income-types').addEventListener('click', (e) => {
    const opt = e.target.closest('.type-option');
    if (opt) {
      document.querySelectorAll('#income-types .type-option').forEach(el => el.classList.remove('selected'));
      opt.classList.add('selected');
      selectedSubType = opt.dataset.id;
    }
  });
}

function initTabs() {
  const tabs = document.querySelectorAll('.type-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMainType = tab.dataset.type;

      if (currentMainType === 'expense') {
        document.getElementById('expense-types').style.display = 'grid';
        document.getElementById('income-types').style.display = 'none';
        selectedSubType = document.querySelector('#expense-types .selected')?.dataset.id || 'food';
      } else {
        document.getElementById('expense-types').style.display = 'none';
        document.getElementById('income-types').style.display = 'grid';
        selectedSubType = document.querySelector('#income-types .selected')?.dataset.id || 'salary';
      }
    });
  });
}

// --- 辅助：渲染单条记账记录 ---
function renderEntryHtml(e) {
  const amt = parseFloat(e.amount) || 0;
  const isIncome = e.type === 'income';

  let subType = e.sub_type || e.subType;
  if (!subType) {
    if (e.note && e.note.includes('饭')) subType = 'food';
    else if (e.note && e.note.includes('车')) subType = 'transport';
    else if (isIncome && e.note && e.note.includes('工资')) subType = 'salary';
    else subType = 'other';
  }

  return `
    <div class="ledger-entry-item" data-id="${e.id}">
      <div class="entry-main">
        <div class="type-icon" style="${isIncome ? 'border-color:var(--color-success); background:rgba(74,222,128,0.1);' : ''}">
          ${getIconSvg(e.type, subType)}
        </div>
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(e.note || getIconLabel(e.type, subType))}</div>
        </div>
        <div class="entry-amount ${isIncome ? 'val-income' : 'val-expense'}">
          ${isIncome ? '+' : '-'}${amt.toFixed(2)}
        </div>
      </div>
      <div class="entry-more-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
      </div>
      <div class="entry-more-dropdown">
        <div class="delete-entry-btn" data-id="${e.id}" style="color:var(--color-danger); padding:6px 12px; cursor:pointer; font-size:13px; white-space:nowrap;">删除记录</div>
      </div>
    </div>
  `;
}

// --- 格式化日期小标题 ---
function formatDateHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}月${day}日 ${dayName}`;
}

// --- 批注图标SVG ---
function annotationIconSvg() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="1.5" fill="none" style="flex-shrink:0;margin-top:2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
}

// --- 自动加载并展示每日批注 ---
async function fetchAndDisplaySummaries(dates) {
  const summaries = await Promise.all(
    dates.map(async (date) => {
      try {
        const res = await fetch(`/api/ledger/summary/${date}`);
        if (!res.ok) return { date, summary: null };
        const data = await res.json();
        return { date, summary: data };
      } catch {
        return { date, summary: null };
      }
    })
  );

  summaries.forEach(({ date, summary }) => {
    const annotationEl = document.querySelector(`.day-annotation[data-date="${date}"]`);
    if (!annotationEl) return;

    if (summary && summary.ai_comment) {
      annotationEl.innerHTML = `
        ${annotationIconSvg()}
        <span>${escapeHtml(summary.ai_comment)}</span>
      `;
      annotationEl.style.display = 'flex';
    }
    // 没有批注就不显示，保持 display:none
  });
}

// --- 绑定每日"让他写批注"按钮 ---
function attachGenButtonHandlers() {
  document.querySelectorAll('.day-gen-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const date = btn.dataset.date;
      btn.disabled = true;
      btn.textContent = '思考中…';

      try {
        const res = await fetch(`/api/ledger/summary/${date}/generate`, { method: 'POST' });
        const summary = await res.json();
        if (!res.ok) throw new Error(summary.error || '生成失败');

        // 更新该天的批注显示
        const annotationEl = document.querySelector(`.day-annotation[data-date="${date}"]`);
        if (annotationEl && summary.ai_comment) {
          annotationEl.innerHTML = `
            ${annotationIconSvg()}
            <span>${escapeHtml(summary.ai_comment)}</span>
          `;
          annotationEl.style.display = 'flex';
        }
        showToast('批注已生成');
      } catch (err) {
        showToast(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '让他写批注';
      }
    });
  });
}

// --- 数据加载（按天分组） ---
async function loadEntries() {
  document.getElementById('month-label').textContent = `${viewYear}年${viewMonth}月`;
  const res = await fetch(`/api/ledger?year=${viewYear}&month=${viewMonth}`);
  const data = await res.json();
  const list = data.entries || [];
  const container = document.getElementById('entry-list');

  let totalIncome = 0;
  let totalExpense = 0;

  if (list.length === 0) {
    container.innerHTML = '<div style="color:var(--color-text-muted);font-size:13px;text-align:center;padding:40px 0;">这个月还没有记账记录</div>';
    document.getElementById('stat-income').textContent = '0.00';
    document.getElementById('stat-expense').textContent = '0.00';
    document.getElementById('stat-balance').textContent = '0.00';
    return;
  }

  // 按日期分组
  const grouped = {};
  list.forEach(e => {
    const amt = parseFloat(e.amount) || 0;
    if (e.type === 'income') totalIncome += amt;
    else totalExpense += amt;

    if (!grouped[e.date]) grouped[e.date] = [];
    grouped[e.date].push(e);
  });

  // 只显示选定日期
  const dates = grouped[viewDate] ? [viewDate] : [];

  // 渲染按天分组
  container.innerHTML = dates.map(date => {
    const entries = grouped[date];

    // 当日合计
    let dayIncome = 0, dayExpense = 0;
    entries.forEach(e => {
      const amt = parseFloat(e.amount) || 0;
      if (e.type === 'income') dayIncome += amt;
      else dayExpense += amt;
    });

    const statsHtml = [];
    if (dayIncome > 0) statsHtml.push(`<span class="val-income">收 ${dayIncome.toFixed(2)}</span>`);
    if (dayExpense > 0) statsHtml.push(`<span class="val-expense">支 ${dayExpense.toFixed(2)}</span>`);

    const entriesHtml = entries.map(renderEntryHtml).join('');

    return `
      <div class="day-group" data-date="${date}">
        <div class="day-header">
          <span class="day-header-date">${formatDateHeader(date)}</span>
          <span class="day-header-stats">${statsHtml.join(' ')}</span>
        </div>
        ${entriesHtml}
        <div class="day-annotation" data-date="${date}" style="display:none;"></div>
        <div class="day-gen-row">
          <button class="day-gen-btn" data-date="${date}">让他写批注</button>
        </div>
      </div>
    `;
  }).join('');

  // 单日视图当天无记录时显示提示
  if (dates.length === 0 && viewDate) {
    container.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;text-align:center;padding:40px 0;">${viewDate} 没有记账记录</div>`;
  }

  // 更新月度统计
  document.getElementById('stat-income').textContent = totalIncome.toFixed(2);
  document.getElementById('stat-expense').textContent = totalExpense.toFixed(2);
  document.getElementById('stat-balance').textContent = (totalIncome - totalExpense).toFixed(2);

  // 绑定更多菜单和删除按钮
  container.querySelectorAll('.entry-more-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const dropdown = btn.nextElementSibling;
      document.querySelectorAll('.entry-more-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('show');
      });
      dropdown.classList.toggle('show');
    });
  });

  container.querySelectorAll('.delete-entry-btn').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('确定删除这条记录吗？')) {
        btn.parentElement.classList.remove('show');
        return;
      }
      const res = await fetch(`/api/ledger/${btn.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { showToast('已删除'); loadEntries(); }
    });
  });

  // 自动加载每日批注
  fetchAndDisplaySummaries(dates);

  // 绑定每日批注生成按钮
  attachGenButtonHandlers();
}

document.addEventListener('click', () => {
  document.querySelectorAll('.entry-more-dropdown').forEach(d => d.classList.remove('show'));
});

document.getElementById('prev-month').addEventListener('click', () => {
  viewMonth -= 1;
  if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
  // 保持同一天号，若超出当月天数则取当月最后一天
  const maxDay = new Date(viewYear, viewMonth, 0).getDate();
  const dayPart = viewDate.split('-')[2];
  const d = Math.min(parseInt(dayPart), maxDay);
  viewDate = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
  syncDayPicker();
  refreshCurrentView();
});

document.getElementById('next-month').addEventListener('click', () => {
  viewMonth += 1;
  if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
  const maxDay = new Date(viewYear, viewMonth, 0).getDate();
  const dayPart = viewDate.split('-')[2];
  const d = Math.min(parseInt(dayPart), maxDay);
  viewDate = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
  syncDayPicker();
  refreshCurrentView();
});

// --- 日期选择器 ---
function syncDayPicker() {
  document.getElementById('day-picker').value = viewDate;
}

function goToDate(dateStr) {
  viewDate = dateStr;
  const [y, m] = dateStr.split('-');
  viewYear = parseInt(y);
  viewMonth = parseInt(m);
  syncDayPicker();
  loadEntries();
}

document.getElementById('prev-day').addEventListener('click', () => {
  const d = new Date(viewDate + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  goToDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
});

document.getElementById('next-day').addEventListener('click', () => {
  const d = new Date(viewDate + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  goToDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
});

document.getElementById('day-picker').addEventListener('change', (e) => {
  const dateStr = e.target.value;
  if (dateStr) goToDate(dateStr);
});

// --- Modal ---
const addModal = document.getElementById('add-modal');
document.getElementById('fab-add-btn').addEventListener('click', () => {
  addModal.style.display = 'flex';
  document.getElementById('new-date').value = todayStr();
});

document.getElementById('close-add-modal').addEventListener('click', () => {
  addModal.style.display = 'none';
});

addModal.addEventListener('click', (e) => {
  if (e.target === addModal) addModal.style.display = 'none';
});

document.getElementById('add-btn').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('new-amount').value);
  const note = document.getElementById('new-note').value.trim();
  const date = document.getElementById('new-date').value.trim() || undefined;

  if (isNaN(amount) || amount <= 0) {
    showToast('请填写有效的金额');
    return;
  }

  const payload = {
    type: currentMainType,
    subType: selectedSubType,
    amount,
    note,
    date
  };

  const res = await fetch('/api/ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    document.getElementById('new-amount').value = '';
    document.getElementById('new-note').value = '';
    showToast('已记录');
    addModal.style.display = 'none';
    loadEntries();
  } else {
    const data = await res.json().catch(() => ({}));
    showToast('添加失败: ' + (data.error || ''));
  }
});

initTypeGrid();
initTabs();
syncDayPicker();

// ========== 账本切换 (我的账本 / 他的账本) ==========
var currentLedgerOwner = 'user';
var currentTab = 'transactions';
var userControls = document.getElementById('user-ledger-controls');
var fabAddBtn = document.getElementById('fab-add-btn');
var monthlyStats = {
  income: document.getElementById('stat-income'),
  expense: document.getElementById('stat-expense'),
  balance: document.getElementById('stat-balance'),
};
var monthLabel = document.getElementById('month-label');
var entryList = document.getElementById('entry-list');
var switchBtn = document.getElementById('ledger-switch-btn');
var tabBtns = document.querySelectorAll('.ledger-tab');
var prevMonthBtn = document.getElementById('prev-month');
var nextMonthBtn = document.getElementById('next-month');

// 保存原始统计标签
var origStatLabels = [];
document.querySelectorAll('.stat-label').forEach(function(el) { origStatLabels.push(el.textContent); });

// 顶栏切换按钮
if (switchBtn) {
  switchBtn.addEventListener('click', function() {
    if (currentLedgerOwner === 'user') {
      switchToAi();
    } else {
      switchToUser();
    }
  });
}

// Tab 切换
tabBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    tabBtns.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    // 礼物清单隐藏日期选择器
    if (currentLedgerOwner === 'user') {
      userControls.style.display = currentTab === 'gifts' ? 'none' : 'flex';
    }
    refreshCurrentView();
  });
});

function switchToAi() {
  currentLedgerOwner = 'ai';
  if (switchBtn) switchBtn.textContent = '我的账本';
  if (userControls) userControls.style.display = 'none';
  if (fabAddBtn) fabAddBtn.style.display = 'none';
  // AI 账本显示月份导航
  if (prevMonthBtn) prevMonthBtn.style.display = '';
  if (nextMonthBtn) nextMonthBtn.style.display = '';
  // 更新标签
  var labels = document.querySelectorAll('.stat-label');
  if (labels[0]) labels[0].textContent = '总收入';
  if (labels[1]) labels[1].textContent = '总支出';
  if (labels[2]) labels[2].textContent = 'AI余额';
  monthLabel.textContent = viewYear + '年' + viewMonth + '月';
  // AI 账本只显示收支明细 tab
  var tabs = document.getElementById('ledger-tabs');
  if (tabs) tabs.style.display = 'flex';
  // 加载余额（不受月份影响）
  fetch('/api/economy/balance')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (monthlyStats.balance) monthlyStats.balance.textContent = (data.balance || 0).toFixed(2);
    }).catch(function(){});
  refreshCurrentView();
}

function switchToUser() {
  currentLedgerOwner = 'user';
  currentTab = 'transactions';
  if (switchBtn) switchBtn.textContent = '他的账本';
  if (userControls) userControls.style.display = '';
  if (fabAddBtn) fabAddBtn.style.display = '';
  if (prevMonthBtn) prevMonthBtn.style.display = '';
  if (nextMonthBtn) nextMonthBtn.style.display = '';
  // 恢复标签
  var labels = document.querySelectorAll('.stat-label');
  for (var i = 0; i < labels.length; i++) {
    if (origStatLabels[i]) labels[i].textContent = origStatLabels[i];
  }
  var tabs = document.getElementById('ledger-tabs');
  if (tabs) tabs.style.display = 'flex';
  tabBtns.forEach(function(b) { b.classList.remove('active'); });
  var firstTab = document.querySelector('.ledger-tab[data-tab="transactions"]');
  if (firstTab) firstTab.classList.add('active');
  loadEntries();
}

function refreshCurrentView() {
  if (currentLedgerOwner === 'ai') {
    var monthPrefix = viewYear + '-' + pad2(viewMonth);
    monthLabel.textContent = viewYear + '年' + viewMonth + '月';
    fetch('/api/economy/history?owner=ai')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var allTransactions = data.transactions || [];
        // 当月过滤
        var transactions = allTransactions.filter(function(t) {
          return (t.created_at || '').startsWith(monthPrefix);
        });
        // 计算月度统计
        var monthIncome = 0, monthExpense = 0;
        transactions.forEach(function(t) {
          var amt = parseFloat(t.amount) || 0;
          if (t.type === 'red_packet' && t.recipient === 'ai') monthIncome += amt;
          if (t.sender === 'ai') monthExpense += amt;
        });
        if (monthlyStats.income) monthlyStats.income.textContent = monthIncome.toFixed(2);
        if (monthlyStats.expense) monthlyStats.expense.textContent = monthExpense.toFixed(2);
        // 余额单独加载，不受月份影响
        if (currentTab === 'gifts') {
          renderGiftList(transactions);
        } else {
          renderAiTransactionList(transactions);
        }
      })
      .catch(function() {
        entryList.innerHTML = '<div style="text-align:center;padding:40px;color:var(--color-text-muted);">加载失败</div>';
      });
  } else {
    if (currentTab === 'gifts') {
      loadGiftList();
    } else {
      loadEntries();
    }
  }
}

// ========== AI 收支明细 ==========
function renderAiTransactionList(transactions) {
  if (!entryList) return;

  // 过滤：只保留红包收支 + AI自己的礼物/外卖支出
  // 用户送AI的礼物/外卖不在收支明细里显示（它们在礼物清单里）
  var filtered = transactions.filter(function(t) {
    if (t.sender === 'ai') return true;           // AI自己的支出
    if (t.type === 'red_packet' && t.recipient === 'ai') return true; // 收到的红包
    return false; // 用户送的礼物/外卖 → 不显示
  });

  if (filtered.length === 0) {
    entryList.innerHTML = '<div style="color:var(--color-text-muted);font-size:13px;text-align:center;padding:40px 0;">这个月还没有记账记录</div>';
    return;
  }

  var totalIncome = 0, totalExpense = 0;
  filtered.forEach(function(t) {
    if (t.type === 'red_packet' && t.recipient === 'ai') totalIncome += t.amount;
    if (t.sender === 'ai') totalExpense += t.amount;
  });
  if (monthlyStats.expense) monthlyStats.expense.textContent = totalIncome.toFixed(2);
  if (monthlyStats.balance) monthlyStats.balance.textContent = totalExpense.toFixed(2);

  var TYPE_ICONS = {
    red_packet: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="#ff9fc0" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M5 9l7 5 7-5"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="#d4a0e8" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    food_delivery: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="#f0c898" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
  };
  var TYPE_LABELS = { red_packet: '红包', gift: '礼物', food_delivery: '外卖' };

  var html = '';
  filtered.forEach(function(t) {
    var isIncome = t.type === 'red_packet' && t.recipient === 'ai';
    var isExpense = t.sender === 'ai';
    var label = TYPE_LABELS[t.type] || t.type;
    var itemName = t.item_name || (t.type === 'red_packet' ? '红包' : '');

    var desc;
    if (isIncome) { desc = '收到' + label; }
    else { desc = t.type === 'red_packet' ? '发送' + label : itemName || label; }

    var amountClass = isIncome ? 'ai-ledger-income' : 'ai-ledger-expense';
    var amountPrefix = isIncome ? '+' : '-';
    var iconBg = isIncome ? 'var(--color-primary-soft)' : 'var(--color-accent-soft)';

    html += '<div class="ai-ledger-row">' +
      '<div class="ai-ledger-item" data-econ-id="' + t.id + '">' +
        '<div class="ai-ledger-icon" style="background:' + iconBg + '">' + (TYPE_ICONS[t.type] || '') + '</div>' +
        '<div class="ai-ledger-info">' +
          '<div class="ai-ledger-type">' + escapeHtml(desc) + '</div>' +
          '<div class="ai-ledger-date">' + (t.created_at || '') + '</div>' +
        '</div>' +
        '<div class="ai-ledger-amount ' + amountClass + '">' + amountPrefix + t.amount.toFixed(2) + '</div>' +
      '</div>' +
      '<button class="ai-item-del-btn">删除</button>' +
    '</div>';
  });

  entryList.innerHTML = html;

  // 点击条目 → 切换删除键；移动端左滑 → 显示删除键
  entryList.querySelectorAll('.ai-ledger-row').forEach(function(row) {
    var item = row.querySelector('.ai-ledger-item');
    var delBtn = row.querySelector('.ai-item-del-btn');
    if (!item || !delBtn) return;

    // 电脑端：点击条目切换删除键
    item.addEventListener('click', function() {
      var isOpen = row.classList.contains('show-del');
      // 关闭其他条目的删除键
      entryList.querySelectorAll('.ai-ledger-row').forEach(function(r) { r.classList.remove('show-del'); });
      if (!isOpen) row.classList.add('show-del');
    });

    // 移动端：左滑显示删除键
    var touchStartX = 0;
    item.addEventListener('touchstart', function(e) {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    item.addEventListener('touchmove', function(e) {
      var dx = touchStartX - e.touches[0].clientX;
      if (dx > 40) {
        entryList.querySelectorAll('.ai-ledger-row').forEach(function(r) { r.classList.remove('show-del'); });
        row.classList.add('show-del');
      }
    }, { passive: true });

    delBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = item.dataset.econId;
      if (!id) return;
      if (!confirm('确定删除这条记录吗？')) return;
      fetch('/api/economy/' + id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            showToast('已删除');
            refreshCurrentView();
            fetch('/api/economy/balance').then(function(r){return r.json();}).then(function(b){
              if (monthlyStats.income) monthlyStats.income.textContent = (b.balance || 0).toFixed(2);
            });
          } else {
            showToast('删除失败');
          }
        }).catch(function() { showToast('删除失败'); });
    });
  });
}

// ========== 礼物清单 ==========
function renderGiftList(transactions) {
  if (!entryList) return;
  // 只显示礼物类型
  var gifts = transactions.filter(function(t) { return t.type === 'gift'; });

  // 我的账本 → 显示我收到的礼物（他送我的 = sender='ai'）
  // 他的账本 → 显示他收到的礼物（我送他的 = sender='user'）
  if (currentLedgerOwner === 'ai') {
    gifts = gifts.filter(function(t) { return t.sender === 'user'; });
  }

  if (gifts.length === 0) {
    entryList.innerHTML = '<div class="gift-empty">还没有礼物记录</div>';
    return;
  }

  // 按日期倒序
  gifts.sort(function(a, b) { return b.created_at.localeCompare(a.created_at); });

  var html = '';
  gifts.forEach(function(g) {
    var giver = g.sender === 'user' ? '我' : '他';
    html += '<div class="gift-list-item" data-id="' + g.id + '">' +
      '<div class="gift-info">' +
        '<div class="gift-item-name">' + escapeHtml(g.item_name || '礼物') + '</div>' +
      '</div>' +
      '<div class="gift-meta">' +
        '<span class="gift-sender">来自' + giver + '</span>' +
        '<span class="gift-date">' + (g.created_at || '') + '</span>' +
      '</div>' +
      '<button class="gift-del-btn" title="删除">×</button>' +
    '</div>';
  });

  entryList.innerHTML = html;
  bindGiftDelete();
}

function bindGiftDelete() {
  document.querySelectorAll('.gift-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var item = btn.closest('.gift-list-item');
      var id = item.dataset.id;
      if (btn.classList.contains('confirming')) {
        fetch('/api/economy/' + id, { method: 'DELETE' })
          .then(function(r) { if (!r.ok) throw new Error('删除失败'); return r.json(); })
          .then(function(data) { if (!data.success) throw new Error('删除失败'); refreshCurrentView(); })
          .catch(function() { showToast('删除失败'); });
      } else {
        btn.classList.add('confirming');
        btn.textContent = '确认删除？';
        setTimeout(function() {
          btn.classList.remove('confirming');
          btn.textContent = '×';
        }, 3000);
      }
    });
  });
}

function loadGiftList() {
  // 我的账本 — 显示当月 AI 送给我的礼物
  var monthPrefix = viewYear + '-' + pad2(viewMonth);
  fetch('/api/economy/history?owner=user')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var transactions = data.transactions || [];
      var gifts = transactions.filter(function(t) {
        return t.type === 'gift' && t.sender === 'ai'
          && (t.created_at || '').startsWith(monthPrefix);
      });
      renderGiftListForUser(gifts);
    })
    .catch(function() {
      entryList.innerHTML = '<div class="gift-empty">加载失败</div>';
    });
}

function renderGiftListForUser(gifts) {
  if (!entryList) return;
  if (gifts.length === 0) {
    entryList.innerHTML = '<div class="gift-empty">还没有礼物记录</div>';
    return;
  }
  gifts.sort(function(a, b) { return b.created_at.localeCompare(a.created_at); });
  var html = '';
  gifts.forEach(function(g) {
    html += '<div class="gift-list-item" data-id="' + g.id + '">' +
      '<div class="gift-info">' +
        '<div class="gift-item-name">' + escapeHtml(g.item_name || '礼物') + '</div>' +
      '</div>' +
      '<div class="gift-meta">' +
        '<span class="gift-sender">来自他</span>' +
        '<span class="gift-date">' + (g.created_at || '') + '</span>' +
      '</div>' +
      '<button class="gift-del-btn" title="删除">×</button>' +
    '</div>';
  });
  entryList.innerHTML = html;
  bindGiftDelete();
}

loadEntries();
