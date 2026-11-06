(function () {
  const get = window.CyberSea.requestJson;
  const byId = id => document.getElementById(id);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let events = [];
  let eventsLoaded = false;
  function renderCalendar() {
    const now = new Date(), today = dateKey(now);
    byId('hub-date').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + ' · ' + now.toLocaleDateString('zh-CN', { weekday: 'long' });
    byId('life-day').textContent = String(now.getDate()).padStart(2, '0');
    byId('life-weekday').textContent = now.toLocaleDateString('zh-CN', { weekday: 'long' });
    if (!eventsLoaded) return;
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const ongoing = events.find(e => e.date === today && e.start_time && e.end_time && e.start_time <= clock && e.end_time > clock)
      || events.find(e => e.date === today && !e.start_time);
    const next = ongoing || events.find(e => e.date > today || (e.date === today && e.start_time >= clock));
    byId('life-event-state').textContent = ongoing ? '正在进行' : '接下来';
    byId('life-event-title').textContent = next ? next.title : '暂无即将到来的日程';
    byId('life-event-time').textContent = next ? `${next.date === today ? '今天' : next.date} · ${next.start_time ? next.start_time + (next.end_time ? ' — ' + next.end_time : '') : '全天'}` : '打开日历，安排下一次相伴';
  }
  function anniversary(data) {
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const upcoming = (data.anniversaries || []).flatMap(item => {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(item.date));
      if (!parts) return [];
      const month = +parts[2], day = +parts[3];
      for (let year = Math.max(today.getFullYear(), +parts[1]); year <= Math.max(today.getFullYear(), +parts[1]) + 8; year++) {
        const date = new Date(year, month - 1, day);
        if (date.getMonth() === month - 1 && date.getDate() === day && date >= today) {
          return [{ name: item.name, days: Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000) }];
        }
      }
      return [];
    }).sort((a, b) => a.days - b.days)[0];
    byId('life-anniversary-detail').textContent = upcoming ? upcoming.name : '那些重要的日子，值得被记住';
    byId('life-anniversary-count').textContent = upcoming ? (upcoming.days ? `还有 ${upcoming.days} 天` : '就是今天') : '';
  }
  function plans(data) {
    const list = byId('life-plan-list');
    list.replaceChildren();
    // The existing API returns plans by creation time descending, across all owners.
    for (const plan of (data.plans || []).slice(0, 3)) {
      const li = document.createElement('li'), content = document.createElement('span'), owner = document.createElement('span');
      content.className = 'life-plan-content' + (plan.done ? ' life-plan-done' : '');
      content.textContent = plan.content;
      owner.className = 'life-plan-owner'; owner.textContent = { mine: '我的', his: '他的', shared: '共同' }[plan.category] || '';
      li.append(content, owner); list.append(li);
    }
    if (!list.children.length) { const li = document.createElement('li'); li.className = 'life-empty'; li.textContent = '还没有计划，慢慢安排想做的事'; list.append(li); }
  }
  function ledger(data) {
    const today = dateKey(new Date()), totals = { income: 0, expense: 0 };
    let count = 0;
    for (const entry of data.entries || []) {
      if (entry.date !== today || !Object.hasOwn(totals, entry.type) || !Number.isFinite(Number(entry.amount))) continue;
      totals[entry.type] += Math.round(Number(entry.amount) * 100); count++;
    }
    const money = cents => '¥ ' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    byId('life-income').textContent = money(totals.income); byId('life-expense').textContent = money(totals.expense);
    byId('life-ledger-note').textContent = count ? `今天记录了 ${count} 笔收支` : '今天还没有收支记录';
  }
  async function photo() {
    byId('life-photo').classList.remove('has-photo');
    byId('life-photo').querySelectorAll('img').forEach(img => img.remove());
    byId('life-photo-status').hidden = false;
    byId('life-photo-status').textContent = '正在读取照片…';
    const results = await Promise.allSettled([get('/api/album/photos?owner=user'), get('/api/album/photos?owner=ai')]);
    const photos = results.flatMap(result => result.status === 'fulfilled' ? result.value.photos || [] : [])
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.id) - Number(a.id));
    const latest = photos[0], status = byId('life-photo-status');
    if (!latest) { status.textContent = results.every(r => r.status === 'fulfilled') ? '留住值得回看的瞬间' : '照片暂未能加载'; return; }
    let url;
    try { url = new URL(latest.path, location.href); } catch { status.textContent = '照片暂未能加载'; return; }
    if (!['http:', 'https:'].includes(url.protocol)) { status.textContent = '照片暂未能加载'; return; }
    const img = document.createElement('img'); img.alt = latest.caption || '最近保存的照片'; img.decoding = 'async';
    img.addEventListener('load', () => { byId('life-photo').classList.add('has-photo'); status.hidden = true; });
    img.addEventListener('error', () => { img.remove(); byId('life-photo').classList.remove('has-photo'); status.hidden = false; status.textContent = '照片暂未能加载'; });
    img.src = url.href; byId('life-photo').append(img);
  }
  function load(url, render, fallback) { return get(url).then(render).catch(fallback); }
  async function refresh() {
    const now = new Date(), today = dateKey(now);
    renderCalendar();
    await Promise.allSettled([
      load('/api/anniversary', anniversary, () => { byId('life-anniversary-detail').textContent = '打开查看纪念日'; byId('life-anniversary-count').textContent = ''; }),
      load('/api/plan', plans, () => { byId('life-plan-list').textContent = '计划暂未能加载，打开查看'; }),
      load(`/api/calendar/events?start=${today}&end=9999-12-31`, data => {
        events = (data.events || []).slice().sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || ''))); eventsLoaded = true; renderCalendar();
      }, () => { eventsLoaded = false; byId('life-event-title').textContent = '日程暂未能加载'; byId('life-event-time').textContent = '打开日历查看'; }),
      load(`/api/ledger?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, ledger, () => { byId('life-income').textContent = '—'; byId('life-expense').textContent = '—'; byId('life-ledger-note').textContent = '收支暂未能加载，打开查看'; }),
      photo()
    ]);
    // Each refresh replaces the previous image, without accumulating hidden photos.
    const images = byId('life-photo').querySelectorAll('img');
    [...images].slice(0, -1).forEach(img => img.remove());
  }
  refresh();
  // Recalculate event status while open, and fetch fresh summaries on returning.
  let lastDay = dateKey(new Date());
  setInterval(() => {
    if (document.hidden) return;
    const today = dateKey(new Date());
    if (lastDay !== today) { lastDay = today; refresh(); } else renderCalendar();
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
