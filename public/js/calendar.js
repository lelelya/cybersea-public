// calendar.js — 日历模块（日程+待办）
(function() {
var currentView = 'day';
var currentDate = new Date();
var weekStart = null;
var viewMonth = null;
var allEvents = [];
var allTodos = [];

function showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function dateStr(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

// ===== Tab 切换 =====
document.getElementById('cal-tabs').addEventListener('click', function(e) {
  var tab = e.target.closest('.cal-tab');
  if (!tab) return;
  document.querySelectorAll('.cal-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');
  currentView = tab.dataset.view;
  render();
});

// ===== 加载数据 =====
async function loadEvents(start, end) {
  try {
    var res = await fetch('/api/calendar/events?start=' + start + '&end=' + end);
    var data = await res.json();
    allEvents = data.events || [];
  } catch (e) { console.error(e); showToast('日程加载失败，请重试'); allEvents = []; }
}
async function loadTodos(dueBefore) {
  try {
    var url = '/api/calendar/todos';
    if (dueBefore) url += '?due_before=' + dueBefore;
    var res = await fetch(url);
    var data = await res.json();
    allTodos = data.todos || [];
  } catch (e) { console.error(e); showToast('待办加载失败，请重试'); allTodos = []; }
}

// ===== 获取周一 =====
function getMonday(d) {
  var day = d.getDay();
  var diff = d.getDate() - day + (day === 0 ? -6 : 1);
  var m = new Date(d); m.setDate(diff); m.setHours(0,0,0,0); return m;
}

// ===== 渲染入口 =====
function render() {
  if (currentView === 'day') renderDay();
  else if (currentView === 'week') renderWeek();
  else renderMonth();
}

async function renderDay() {
  var dStr = dateStr(currentDate);
  await Promise.all([loadEvents(dStr, dStr), loadTodos(dStr)]);

  var dow = ['日','一','二','三','四','五','六'][currentDate.getDay()];
  var html = '<div class="cal-header">' +
    '<button class="cal-header-btn" id="day-prev">&lt;</button>' +
    '<span class="cal-header-date">' + dStr + ' 星期' + dow + '</span>' +
    '<button class="cal-header-btn" id="day-next">&gt;</button>' +
    '</div>' +
    '<div class="day-layout">' +
      '<div class="day-timeline">' + renderEventList(allEvents) + '</div>' +
      '<div class="day-todos">' + renderTodoList(filterTodosForDate(currentDate)) + '</div>' +
    '</div>';
  document.getElementById('cal-content').innerHTML = html;
  bindDayNav();
  bindEvents();
  bindTodos();
}

function renderEventList(events) {
  if (!events.length) return '<div class="event-empty">暂无日程</div>';
  return events.map(function(e) {
    var time = e.start_time ? (e.start_time + (e.end_time ? ' ~ ' + e.end_time : '')) : '全天';
    return '<div class="event-item" data-id="' + e.id + '">' +
      '<div class="event-time">' + time + '</div>' +
      '<div class="event-title">' + escHtml(e.title) + '</div>' +
      (e.note ? '<div class="event-note">' + escHtml(e.note) + '</div>' : '') +
    '</div>';
  }).join('');
}

function renderTodoList(todos) {
  var html = '<div class="todo-section-title">待办</div>';
  todos.forEach(function(t) {
    var dateLabel = formatTodoDateRange(t);
    html += '<div class="todo-item' + (t.completed ? ' done' : '') + '" data-id="' + t.id + '">' +
      '<div class="todo-check">✓</div>' +
      '<span class="todo-title">' + escHtml(t.title) + (dateLabel ? '<span class="todo-date-range">' + dateLabel + '</span>' : '') + '</span>' +
      '<button class="todo-del">×</button>' +
    '</div>';
  });
  html += '<div class="todo-add-row">' +
    '<input class="todo-add-input" id="todo-add-input" placeholder="+ 添加待办" maxlength="100" />' +
    '<input class="todo-add-date" id="todo-add-start" type="date" title="开始日期（可选）" />' +
    '<input class="todo-add-date" id="todo-add-due" type="date" title="截止日期（可选）" />' +
    '<button class="todo-add-btn" id="todo-add-btn">添加</button>' +
  '</div>';
  return html;
}

function filterTodosForDate(date) {
  var ds = dateStr(date);
  return allTodos.filter(function(t) {
    if (t.completed) return false;
    // 无日期的通用待办：始终显示
    if (!t.start_date && !t.due_date) return true;
    if (t.due_date === ds) return true;
    if (t.start_date && t.start_date <= ds && t.due_date && t.due_date >= ds) return true;
    if (t.start_date && t.start_date <= ds && !t.due_date) return true;
    return false;
  });
}

// ===== 周视图 =====
async function renderWeek() {
  weekStart = getMonday(currentDate);
  var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
  await Promise.all([loadEvents(dateStr(weekStart), dateStr(weekEnd)), loadTodos(dateStr(weekEnd))]);

  var weekLabel = dateStr(weekStart) + ' ~ ' + dateStr(weekEnd);
  var html = '<div class="cal-header">' +
    '<button class="cal-header-btn" id="week-prev">&lt;</button>' +
    '<span class="cal-header-date">' + weekLabel + '</span>' +
    '<button class="cal-header-btn" id="week-next">&gt;</button>' +
    '</div>' +
    '<div class="week-grid">';
  var dayLabels = ['一','二','三','四','五','六','日'];
  var todayStr_ = dateStr(new Date());
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart); d.setDate(d.getDate()+i);
    var ds = dateStr(d);
    var isToday = ds === todayStr_;
    html += '<div class="week-col' + (isToday ? ' today' : '') + '" data-date="' + ds + '">' +
      '<div class="week-day-label">' + dayLabels[i] + '</div>' +
      '<div class="week-day-num">' + d.getDate() + '</div>';
    var dayEvents = allEvents.filter(function(e) { return e.date === ds; });
    dayEvents.forEach(function(e) {
      var time = e.start_time || '';
      html += '<div class="week-event" data-id="' + e.id + '">' + (time ? time + ' ' : '') + escHtml(e.title) + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="todo-section">' + renderTodoList(filterTodosForWeek()) + '</div>';
  document.getElementById('cal-content').innerHTML = html;
  bindWeekNav();
  bindEvents();
  bindTodos();
}

function filterTodosForWeek() {
  if (!weekStart) return [];
  var ws = dateStr(weekStart);
  var we = new Date(weekStart); we.setDate(we.getDate()+6); var weStr = dateStr(we);
  return allTodos.filter(function(t) {
    if (t.completed) return false;
    // 无日期的通用待办：始终显示
    if (!t.start_date && !t.due_date) return true;
    if (t.due_date && t.due_date >= ws && t.due_date <= weStr) return true;
    if (t.start_date && t.start_date <= weStr && (!t.due_date || t.due_date >= ws)) return true;
    return false;
  });
}

// ===== 月视图 =====
async function renderMonth() {
  var y = currentDate.getFullYear();
  var m = currentDate.getMonth() + 1;
  var monthStart = new Date(y, m-1, 1);
  var monthEnd = new Date(y, m, 0);
  await Promise.all([loadEvents(dateStr(monthStart), dateStr(monthEnd)), loadTodos(dateStr(monthEnd))]);

  var html = '<div class="cal-header">' +
    '<button class="cal-header-btn" id="month-prev">&lt;</button>' +
    '<span class="cal-header-date">' + y + '年 ' + m + '月</span>' +
    '<button class="cal-header-btn" id="month-next">&gt;</button>' +
    '</div>';

  // 星期头
  var dayLabels = ['日','一','二','三','四','五','六'];
  html += '<div class="month-grid">';
  dayLabels.forEach(function(l) { html += '<div class="month-weekday">' + l + '</div>'; });

  // 填充
  var firstDow = monthStart.getDay();
  var totalDays = monthEnd.getDate();
  var todayStr_ = dateStr(new Date());

  // 上月尾
  var prevMonthEnd = new Date(y, m-1, 0).getDate();
  for (var i = firstDow - 1; i >= 0; i--) {
    html += '<div class="month-cell other-month">' + (prevMonthEnd - i) + '</div>';
  }

  for (var d = 1; d <= totalDays; d++) {
    var ds = y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = ds === todayStr_;
    html += '<div class="month-cell' + (isToday ? ' today' : '') + '" data-date="' + ds + '">' + d + '</div>';
  }

  // 下月头
  var remaining = 7 - ((firstDow + totalDays) % 7);
  if (remaining < 7) {
    for (var j = 1; j <= remaining; j++) {
      html += '<div class="month-cell other-month">' + j + '</div>';
    }
  }
  html += '</div>';

  html += '<div class="todo-section">' + renderTodoList(filterTodosForMonth()) + '</div>';
  document.getElementById('cal-content').innerHTML = html;
  bindMonthNav();
  bindTodos();

  // 点击日期跳转周视图
  document.querySelectorAll('.month-cell:not(.other-month)').forEach(function(cell) {
    cell.addEventListener('click', function() {
      var parts = cell.dataset.date.split('-');
      currentDate = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
      currentView = 'week';
      document.querySelectorAll('.cal-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelector('.cal-tab[data-view="week"]').classList.add('active');
      renderWeek();
    });
  });
}

function filterTodosForMonth() {
  var y = currentDate.getFullYear();
  var m = currentDate.getMonth() + 1;
  return allTodos.filter(function(t) {
    if (t.completed) return false;
    // 无日期的通用待办：始终显示
    if (!t.start_date && !t.due_date) return true;
    if (t.due_date && t.due_date.startsWith(y + '-' + String(m).padStart(2,'0'))) return true;
    if (t.start_date && t.start_date <= (y + '-' + String(m).padStart(2,'0') + '-31')) return true;
    return false;
  });
}

// ===== 导航 =====
function bindDayNav() {
  document.getElementById('day-prev').addEventListener('click', function() { currentDate.setDate(currentDate.getDate()-1); renderDay(); });
  document.getElementById('day-next').addEventListener('click', function() { currentDate.setDate(currentDate.getDate()+1); renderDay(); });
}
function bindWeekNav() {
  document.getElementById('week-prev').addEventListener('click', function() { currentDate.setDate(currentDate.getDate()-7); renderWeek(); });
  document.getElementById('week-next').addEventListener('click', function() { currentDate.setDate(currentDate.getDate()+7); renderWeek(); });
}
function bindMonthNav() {
  document.getElementById('month-prev').addEventListener('click', function() { currentDate.setMonth(currentDate.getMonth()-1); renderMonth(); });
  document.getElementById('month-next').addEventListener('click', function() { currentDate.setMonth(currentDate.getMonth()+1); renderMonth(); });
}

// ===== 事件点击 → 详情面板 =====
function bindEvents() {
  document.querySelectorAll('.event-item, .week-event').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = parseInt(el.dataset.id);
      var evt = allEvents.find(function(x) { return x.id === id; });
      if (evt) showDetail(evt);
    });
  });
}

// ===== 详情面板 =====
var editingEvent = null;
function showDetail(evt) {
  editingEvent = evt;
  var panel = document.getElementById('detail-panel');
  var time = evt.start_time ? (evt.start_time + (evt.end_time ? ' ~ ' + evt.end_time : '')) : '全天';
  panel.innerHTML =
    '<div class="detail-field"><div class="detail-label">标题</div><div class="detail-value" id="det-title">' + escHtml(evt.title) + '</div></div>' +
    '<div class="detail-field"><div class="detail-label">日期</div><div class="detail-value" id="det-date">' + evt.date + '</div></div>' +
    '<div class="detail-field"><div class="detail-label">时间</div><div class="detail-value" id="det-time">' + time + '</div></div>' +
    (evt.note ? '<div class="detail-field"><div class="detail-label">备注</div><div class="detail-value">' + escHtml(evt.note) + '</div></div>' : '') +
    '<div class="detail-actions">' +
      '<button class="detail-btn" id="det-edit">编辑</button>' +
      '<button class="detail-btn danger" id="det-delete">删除</button>' +
    '</div>';
  panel.classList.add('show');
  document.getElementById('detail-overlay').classList.add('show');

  document.getElementById('det-edit').addEventListener('click', function() { showEditForm(evt); });
  document.getElementById('det-delete').addEventListener('click', async function() {
    if (!confirm('确定删除「' + evt.title + '」？')) return;
    await fetch('/api/calendar/events/' + evt.id, { method: 'DELETE' });
    hideDetail(); render();
  });
}

function showEditForm(evt) {
  var panel = document.getElementById('detail-panel');
  panel.innerHTML =
    '<div class="detail-field"><div class="detail-label">标题</div><input class="detail-input" id="edit-title" value="' + escAttr(evt.title) + '" maxlength="100" /></div>' +
    '<div class="detail-field"><div class="detail-label">日期</div><input class="detail-input" id="edit-date" type="date" value="' + evt.date + '" /></div>' +
    '<div class="detail-field"><div class="detail-label">开始时间</div><input class="detail-input" id="edit-start" type="time" value="' + (evt.start_time || '') + '" /></div>' +
    '<div class="detail-field"><div class="detail-label">结束时间</div><input class="detail-input" id="edit-end" type="time" value="' + (evt.end_time || '') + '" /></div>' +
    '<div class="detail-field"><div class="detail-label">备注</div><input class="detail-input" id="edit-note" value="' + escAttr(evt.note || '') + '" maxlength="200" /></div>' +
    '<div class="detail-field"><div class="toggle-row"><span class="detail-label">提醒</span>' +
      '<label class="toggle-sw"><input type="checkbox" id="edit-remind" ' + (evt.remind ? 'checked' : '') + ' /><span class="tslider"></span></label>' +
      '<span style="font-size:11px;color:var(--color-text-muted);">（提醒功能即将上线）</span></div></div>' +
    '<div class="detail-actions">' +
      '<button class="detail-btn" id="edit-cancel">取消</button>' +
      '<button class="detail-btn primary" id="edit-save">保存</button>' +
    '</div>';

  document.getElementById('edit-cancel').addEventListener('click', function() { showDetail(evt); });
  document.getElementById('edit-save').addEventListener('click', async function() {
    var body = {
      title: document.getElementById('edit-title').value.trim(),
      date: document.getElementById('edit-date').value,
      start_time: document.getElementById('edit-start').value || '',
      end_time: document.getElementById('edit-end').value || '',
      note: document.getElementById('edit-note').value.trim(),
      remind: document.getElementById('edit-remind').checked ? 1 : 0,
    };
    if (!body.title || !body.date) { showToast('标题和日期必填'); return; }
    await fetch('/api/calendar/events/' + evt.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    hideDetail(); render();
  });
}

function hideDetail() {
  document.getElementById('detail-panel').classList.remove('show');
  document.getElementById('detail-overlay').classList.remove('show');
  editingEvent = null;
}
document.getElementById('detail-overlay').addEventListener('click', hideDetail);

// ===== 新建事件（空白区域点击或+按钮）=====
document.getElementById('add-event-btn').addEventListener('click', function() {
  showNewEventForm();
});

function showNewEventForm(prefillDate, prefillTime) {
  var d = prefillDate || dateStr(currentView === 'week' ? weekStart || currentDate : currentDate);
  var panel = document.getElementById('detail-panel');
  panel.innerHTML =
    '<div class="detail-field"><div class="detail-label">标题</div><input class="detail-input" id="new-title" placeholder="日程标题" maxlength="100" /></div>' +
    '<div class="detail-field"><div class="detail-label">日期</div><input class="detail-input" id="new-date" type="date" value="' + d + '" /></div>' +
    '<div class="detail-field"><div class="detail-label">开始时间</div><input class="detail-input" id="new-start" type="time" value="' + (prefillTime || '') + '" /></div>' +
    '<div class="detail-field"><div class="detail-label">结束时间</div><input class="detail-input" id="new-end" type="time" /></div>' +
    '<div class="detail-field"><div class="detail-label">备注</div><input class="detail-input" id="new-note" placeholder="可选" maxlength="200" /></div>' +
    '<div class="detail-field"><div class="toggle-row"><span class="detail-label">提醒</span>' +
      '<label class="toggle-sw"><input type="checkbox" id="new-remind" /><span class="tslider"></span></label>' +
      '<span style="font-size:11px;color:var(--color-text-muted);">（提醒功能即将上线）</span></div></div>' +
    '<div class="detail-actions">' +
      '<button class="detail-btn" id="new-cancel">取消</button>' +
      '<button class="detail-btn primary" id="new-save">创建</button>' +
    '</div>';
  panel.classList.add('show');
  document.getElementById('detail-overlay').classList.add('show');

  document.getElementById('new-cancel').addEventListener('click', hideDetail);
  document.getElementById('new-save').addEventListener('click', async function() {
    var body = {
      title: document.getElementById('new-title').value.trim(),
      date: document.getElementById('new-date').value,
      start_time: document.getElementById('new-start').value || '',
      end_time: document.getElementById('new-end').value || '',
      note: document.getElementById('new-note').value.trim(),
      remind: document.getElementById('new-remind').checked ? 1 : 0,
    };
    if (!body.title || !body.date) { showToast('标题和日期必填'); return; }
    await fetch('/api/calendar/events', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    hideDetail(); render();
  });
}

// 日/周视图点击空白区域新建
document.getElementById('cal-scene').addEventListener('click', function(e) {
  if (e.target.closest('.event-item') || e.target.closest('.week-event') || e.target.closest('.todo-item') ||
      e.target.closest('button') || e.target.closest('input') || e.target.closest('.detail-panel') ||
      e.target.closest('.todo-section') || e.target.closest('.todo-add-row') ||
      e.target.closest('.day-todos')) return;
  if (currentView === 'day') showNewEventForm(dateStr(currentDate));
  else if (currentView === 'week') {
    var col = e.target.closest('.week-col');
    if (col) showNewEventForm(col.dataset.date);
  }
});

// ===== Todo 交互 =====
function bindTodos() {
  // 勾选/取消
  document.querySelectorAll('.todo-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('button') || e.target.closest('input')) return;
      var id = parseInt(item.dataset.id);
      var todo = allTodos.find(function(t) { return t.id === id; });
      if (!todo) return;
      var newCompleted = todo.completed ? 0 : 1;
      fetch('/api/calendar/todos/' + id, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ completed: newCompleted }),
      }).then(function() { render(); });
    });
  });

  // 删除
  document.querySelectorAll('.todo-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = parseInt(btn.parentElement.dataset.id);
      fetch('/api/calendar/todos/' + id, { method: 'DELETE' }).then(function() { render(); });
    });
  });

  // 添加
  var addBtn = document.getElementById('todo-add-btn');
  var addInput = document.getElementById('todo-add-input');
  if (!addBtn || !addInput) return;
  addBtn.addEventListener('click', function() {
    var title = addInput.value.trim();
    if (!title) return;
    var startDate = document.getElementById('todo-add-start');
    var dueDate = document.getElementById('todo-add-due');
    fetch('/api/calendar/todos', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        title: title,
        start_date: (startDate && startDate.value) ? startDate.value : null,
        due_date: (dueDate && dueDate.value) ? dueDate.value : null,
      }),
    }).then(function() { render(); });
  });
  addInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addBtn.click(); });
}

function formatTodoDateRange(t) {
  if (t.start_date && t.due_date && t.start_date !== t.due_date) {
    return shortDate(t.start_date) + ' ~ ' + shortDate(t.due_date);
  }
  if (t.due_date) return '截止 ' + shortDate(t.due_date);
  if (t.start_date) return '从 ' + shortDate(t.start_date);
  return '';
}
function shortDate(ds) {
  var parts = ds.split('-');
  return parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

// ===== 工具 =====
function escHtml(s) { return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ===== 初始化 =====
renderDay();
})();
