(function () {
  const getData = window.CyberSea.requestJson;

  async function loadLife() {
    const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    const weekdayLabel = new Date().toLocaleDateString('zh-CN', { weekday: 'long' });
    document.getElementById('hub-date').textContent = todayLabel + ' · ' + weekdayLabel;
    const results = await Promise.allSettled([
      getData('/api/plan'),
      getData('/api/anniversary')
    ]);
    const planLabel = document.getElementById('life-plan-detail');
    if (results[0].status === 'fulfilled') {
      const plans = (results[0].value.plans || []).filter(plan => !plan.done);
      planLabel.textContent = plans.length ? `还有 ${plans.length} 项计划待完成` : '我的、他的与共同计划';
    } else {
      planLabel.textContent = '打开查看计划与完成情况';
    }
    const anniversaryLabel = document.getElementById('life-anniversary-detail');
    if (results[1].status === 'fulfilled') {
      const anniversaries = results[1].value.anniversaries || [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const upcoming = anniversaries.map(item => {
        const parts = String(item.date).split('-').map(Number);
        if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
        let date = new Date(today.getFullYear(), parts[1] - 1, parts[2]);
        if (date < today) date = new Date(today.getFullYear() + 1, parts[1] - 1, parts[2]);
        return { name: item.name, days: Math.round((date - today) / 86400000) };
      }).filter(Boolean).sort((first, second) => first.days - second.days)[0];
      anniversaryLabel.textContent = upcoming ? `${upcoming.name} · ${upcoming.days ? '还有 ' + upcoming.days + ' 天' : '就是今天'}` : '那些重要的日子';
    } else {
      anniversaryLabel.textContent = '打开查看纪念日';
    }
  }

  async function loadCompanion() {
    const results = await Promise.allSettled([getData('/api/persona'), getData('/api/letters?author=ai')]);
    const name = document.getElementById('hub-persona-name');
    if (results[0].status === 'fulfilled') {
      const persona = results[0].value;
      name.textContent = persona.ai_name || '你的陪伴角色';
      const avatar = document.getElementById('hub-avatar');
      avatar.textContent = (persona.ai_name || '♡').slice(0, 1);
      if (persona.ai_avatar_path) {
        const avatarUrl = new URL(persona.ai_avatar_path, location.href);
        if (avatarUrl.protocol === 'https:' || avatarUrl.protocol === 'http:') {
          const image = document.createElement('img');
          image.className = 'hub-avatar';
          image.id = 'hub-avatar';
          image.alt = '';
          image.src = avatarUrl.href;
          image.addEventListener('error', () => image.replaceWith(avatar));
          avatar.replaceWith(image);
        }
      }
    } else {
      name.textContent = '角色暂时未能加载';
    }
    if (results[1].status === 'fulfilled') {
      const letter = (results[1].value.letters || []).find(item => item.content);
      if (letter) {
        const preview = String(letter.content).replace(/\s+/g, ' ').trim();
        document.getElementById('hub-letter-preview').textContent = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;
      }
    }
  }

  if (document.body.dataset.hub === 'life') loadLife();
  if (document.body.dataset.hub === 'companion') loadCompanion();
})();
