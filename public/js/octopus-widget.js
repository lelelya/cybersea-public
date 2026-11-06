// CyberSea 像素小章鱼组件 v2
// - 支持鼠标/触摸拖动挪位置，位置记住（localStorage）
// - 点击弹出浮动菜单气泡（天气设置 / 导出记录）
// - 区分拖拽与点击：移动超过 5px 算拖拽，否则算点击
(function () {
  var SVG_MARKUP = [
    '<svg viewBox="0 0 32 32" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">',
      '<g fill="var(--color-primary)">',
        '<rect x="10" y="6" width="12" height="2"/>',
        '<rect x="8" y="8" width="16" height="2"/>',
        '<rect x="6" y="10" width="20" height="10"/>',
        '<rect x="8" y="20" width="16" height="2"/>',
      '</g>',
      '<g fill="var(--color-text-on-primary)">',
        '<rect x="11" y="13" width="3" height="3"/>',
        '<rect x="18" y="13" width="3" height="3"/>',
      '</g>',
      '<g fill="#ffffff" opacity="0.8">',
        '<rect x="12" y="14" width="1" height="1"/>',
        '<rect x="19" y="14" width="1" height="1"/>',
      '</g>',
      '<g class="octopus-tentacle" fill="var(--color-primary)">',
        '<rect x="6" y="20" width="3" height="6"/><rect x="5" y="26" width="3" height="2"/>',
      '</g>',
      '<g class="octopus-tentacle" fill="var(--color-primary)">',
        '<rect x="10" y="20" width="3" height="7"/><rect x="9" y="27" width="3" height="2"/>',
      '</g>',
      '<g class="octopus-tentacle" fill="var(--color-primary)">',
        '<rect x="14" y="20" width="4" height="8"/>',
      '</g>',
      '<g class="octopus-tentacle" fill="var(--color-primary)">',
        '<rect x="19" y="20" width="3" height="7"/><rect x="20" y="27" width="3" height="2"/>',
      '</g>',
      '<g class="octopus-tentacle" fill="var(--color-primary)">',
        '<rect x="23" y="20" width="3" height="6"/><rect x="24" y="26" width="3" height="2"/>',
      '</g>',
    '</svg>'
  ].join('');

  var STORAGE_KEY = 'cybersea_octopus_pos';
  var DRAG_THRESHOLD = 5; // 移动超过5px算拖拽

  function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

  function applyPosition(widget, left, top) {
    var w = widget.offsetWidth || 64;
    var h = widget.offsetHeight || 64;
    left = clamp(left, 0, window.innerWidth - w);
    top = clamp(top, 0, window.innerHeight - h);
    widget.style.left = left + 'px';
    widget.style.top = top + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  // ========== 浮动菜单气泡 ==========
  var bubble = null;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.id = 'octopus-bubble';
    bubble.className = 'octopus-bubble';
    bubble.innerHTML = [
      '<button class="octopus-bubble-item" data-action="weather">',
        '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">',
          '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>',
        '</svg>',
        '<span>天气设置</span>',
      '</button>',
      '<button class="octopus-bubble-item" data-action="export">',
        '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">',
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>',
          '<polyline points="7 10 12 15 17 10"></polyline>',
          '<line x1="12" y1="15" x2="12" y2="3"></line>',
        '</svg>',
        '<span>导出记录</span>',
      '</button>',
    ].join('');
    document.body.appendChild(bubble);

    // 点击气泡选项
    bubble.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      closeBubble();
      if (action === 'weather') openWeatherModal();
      else if (action === 'export') triggerExport();
    });

    return bubble;
  }

  function positionBubble(octopus) {
    var b = ensureBubble();
    var oRect = octopus.getBoundingClientRect();
    var bWidth = 160; // bubble approx width
    var bHeight = 88; // bubble approx height
    var gap = 8;

    // 默认在章鱼上方
    var left = oRect.left + oRect.width / 2 - bWidth / 2;
    var top = oRect.top - bHeight - gap;

    // 智能避让屏幕边缘
    if (top < 8) {
      // 上方不够 → 放下方
      top = oRect.bottom + gap;
    }
    if (left < 8) {
      left = 8;
    } else if (left + bWidth > window.innerWidth - 8) {
      left = window.innerWidth - bWidth - 8;
    }

    b.style.left = left + 'px';
    b.style.top = top + 'px';
    b.classList.add('show');
  }

  function closeBubble() {
    if (bubble) bubble.classList.remove('show');
  }

  function toggleBubble(octopus) {
    var b = ensureBubble();
    if (b.classList.contains('show')) {
      closeBubble();
    } else {
      positionBubble(octopus);
    }
  }

  // 点击气泡外部关闭
  document.addEventListener('click', function(e) {
    if (bubble && bubble.classList.contains('show')) {
      var octopus = document.getElementById('octopus-widget');
      if (!bubble.contains(e.target) && !(octopus && octopus.contains(e.target))) {
        closeBubble();
      }
    }
  });

  // ========== 天气 SVG 图标（单线条荧光青风格） ==========
  var WEATHER_ICONS = {
    sunny: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<circle cx="32" cy="32" r="12"/>',
        '<line x1="32" y1="4"  x2="32" y2="12"/>',
        '<line x1="32" y1="52" x2="32" y2="60"/>',
        '<line x1="4"  y1="32" x2="12" y2="32"/>',
        '<line x1="52" y1="32" x2="60" y2="32"/>',
        '<line x1="12" y1="12" x2="18" y2="18"/>',
        '<line x1="46" y1="46" x2="52" y2="52"/>',
        '<line x1="52" y1="12" x2="46" y2="18"/>',
        '<line x1="12" y1="52" x2="18" y2="46"/>',
      '</svg>'
    ].join(''),
    cloudy: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M16 42c-6 0-10-4-10-9s4-9 9-9c1-6 6-10 12-10 5 0 9 3 11 7 1 0 2-1 3-1 5 0 9 4 9 9s-4 9-9 9H16z"/>',
      '</svg>'
    ].join(''),
    overcast: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M12 40c-5 0-8-3-8-7s3-7 7-7c1-5 5-9 10-9 4 0 7 2 9 5l2-1c4 0 7 3 7 7s-3 7-7 7H12z"/>',
        '<path d="M8 46h48c4 0 6-2 6-5s-2-5-5-5" opacity="0.6"/>',
      '</svg>'
    ].join(''),
    rainy: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M16 30c-6 0-10-4-10-9s4-9 9-9c1-6 6-10 12-10 5 0 9 3 11 7 1 0 2-1 3-1 5 0 9 4 9 9s-4 9-9 9H16z"/>',
        '<line x1="16" y1="34" x2="14" y2="42"/>',
        '<line x1="24" y1="34" x2="22" y2="42"/>',
        '<line x1="32" y1="34" x2="30" y2="42"/>',
        '<line x1="40" y1="34" x2="38" y2="42"/>',
      '</svg>'
    ].join(''),
    snowy: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M16 28c-6 0-10-4-10-9s4-9 9-9c1-6 6-10 12-10 5 0 9 3 11 7 1 0 2-1 3-1 5 0 9 4 9 9s-4 9-9 9H16z"/>',
        '<circle cx="16" cy="38" r="2" fill="var(--color-primary)" stroke="none"/>',
        '<circle cx="26" cy="42" r="2" fill="var(--color-primary)" stroke="none"/>',
        '<circle cx="36" cy="38" r="2" fill="var(--color-primary)" stroke="none"/>',
        '<circle cx="46" cy="42" r="2" fill="var(--color-primary)" stroke="none"/>',
      '</svg>'
    ].join(''),
    haze: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<line x1="8"  y1="20" x2="56" y2="20"/>',
        '<line x1="12" y1="28" x2="52" y2="28"/>',
        '<line x1="8"  y1="36" x2="56" y2="36"/>',
        '<line x1="16" y1="44" x2="48" y2="44"/>',
      '</svg>'
    ].join(''),
    thunderstorm: [
      '<svg viewBox="0 0 64 64" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M14 28c-5 0-8-3-8-7s3-7 7-7c1-5 4-9 9-9 3 0 6 2 8 4l2-1c3 0 6 3 6 6s-3 6-6 6H14z"/>',
        '<polygon points="28,34 24,46 28,46 22,58 38,40 32,40 36,34" fill="var(--color-primary)" stroke="none" opacity="0.8"/>',
      '</svg>'
    ].join(''),
  };

  function weatherIcon(type) {
    return WEATHER_ICONS[type] || WEATHER_ICONS.cloudy;
  }

  // 根据天气类型返回卡片氛围类名
  function weatherAtmosphereClass(type) {
    var map = {
      sunny: 'atmo-sunny',
      cloudy: 'atmo-cloudy',
      overcast: 'atmo-overcast',
      rainy: 'atmo-rainy',
      snowy: 'atmo-snowy',
      haze: 'atmo-haze',
      thunderstorm: 'atmo-thunderstorm',
    };
    return map[type] || '';
  }

  // ========== 天气弹窗（深海主题 · 精致版） ==========
  var weatherModal = null;
  var weatherCityName = ''; // 当前已保存的城市名

  function ensureWeatherModal() {
    if (weatherModal) return weatherModal;

    weatherModal = document.createElement('div');
    weatherModal.id = 'octopus-weather-modal';
    weatherModal.className = 'octopus-modal-overlay';
    weatherModal.innerHTML = [
      '<div class="octopus-modal-card" id="w-card">',
        // 顶部：城市名 + 编辑按钮
        '<div class="weather-header">',
          '<span class="weather-city-name" id="w-city-name">--</span>',
          '<button class="weather-edit-btn" id="w-edit-btn" title="修改城市">',
            '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">',
              '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
              '<path d="m15 5 4 4"/>',
            '</svg>',
          '</button>',
        '</div>',
        // 城市输入行（默认隐藏）
        '<div class="weather-city-input-row" id="w-city-row">',
          '<input type="text" id="w-city-input" class="weather-city-input" placeholder="输入城市名，回车确认" />',
        '</div>',
        // 天气主体
        '<div class="weather-main" id="w-main">',
          '<div class="weather-icon-wrap" id="w-icon"></div>',
          '<span class="weather-condition" id="w-condition">加载中...</span>',
          '<span class="weather-temp" id="w-temp"></span>',
          '<span class="weather-wind" id="w-wind"></span>',
        '</div>',
        // 底部：含蓄的提醒按钮
        '<div class="weather-footer">',
          '<button class="weather-reminder-btn" id="w-reminder-btn" title="让他看看天气">',
            '<span>让他看看天气</span>',
          '</button>',
        '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(weatherModal);

    // -- 事件绑定 --
    var cityNameEl = document.getElementById('w-city-name');
    var editBtn = document.getElementById('w-edit-btn');
    var cityRow = document.getElementById('w-city-row');
    var cityInput = document.getElementById('w-city-input');
    var reminderBtn = document.getElementById('w-reminder-btn');

    // 点击铅笔图标 → 展开/收起输入框
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (cityRow.classList.contains('show')) {
        cityRow.classList.remove('show');
      } else {
        cityRow.classList.add('show');
        cityInput.value = weatherCityName;
        setTimeout(function(){ cityInput.focus(); }, 100);
      }
    });

    // 回车保存城市
    cityInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var city = cityInput.value.trim();
        if (!city) return;
        saveCityAndRefresh(city, cityNameEl, cityRow);
      }
      if (e.key === 'Escape') {
        cityRow.classList.remove('show');
      }
    });

    // 失焦自动保存
    cityInput.addEventListener('blur', function() {
      var city = cityInput.value.trim();
      if (city && city !== weatherCityName) {
        saveCityAndRefresh(city, cityNameEl, cityRow);
      } else {
        cityRow.classList.remove('show');
      }
    });

    // 手动提醒
    reminderBtn.addEventListener('click', function() {
      renderWeatherState({ loading: true, reminderLoading: true });
      fetch('/api/weather/trigger-reminder', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { renderWeatherState({ error: d.error }); }
          else {
            var iconEl = document.getElementById('w-icon');
            if (iconEl) iconEl.innerHTML = [
              '<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
                '<circle cx="32" cy="20" r="4"/>',
                '<path d="M20 56c0-8 5-14 12-14s12 6 12 14"/>',
                '<line x1="16" y1="44" x2="48" y2="44"/>',
              '</svg>'
            ].join('');
            updateWeatherTexts('已发送，去聊天页看看吧~', '', '');
          }
        })
        .catch(function() { renderWeatherState({ error: '触发失败' }); });
    });

    // 点击遮罩关闭
    weatherModal.addEventListener('click', function(e) {
      if (e.target === weatherModal) closeWeatherModal();
    });

    return weatherModal;
  }

  /** 更新天气各文本字段 */
  function updateWeatherTexts(condition, temp, wind) {
    var condEl = document.getElementById('w-condition');
    var tempEl = document.getElementById('w-temp');
    var windEl = document.getElementById('w-wind');
    if (condEl) { condEl.innerText = condition || ''; condEl.textContent = condition || ''; }
    if (tempEl) { tempEl.innerText = temp || ''; tempEl.textContent = temp || ''; }
    if (windEl) { windEl.innerText = wind || ''; windEl.textContent = wind || ''; }
  }

  /** 统一渲染天气状态 */
  function renderWeatherState(state) {
    var iconEl = document.getElementById('w-icon');
    var cardEl = document.getElementById('w-card');

    // 清除氛围类
    if (cardEl) {
      cardEl.className = cardEl.className.replace(/atmo-\w+/g, '').replace(/\s+/g, ' ').trim();
    }

    if (state.loading) {
      if (iconEl) iconEl.innerHTML = '';
      updateWeatherTexts(state.reminderLoading ? '生成中...' : '查询中...', '', '');
      return;
    }
    if (state.error) {
      if (iconEl) iconEl.innerHTML = '';
      updateWeatherTexts(state.error, '', '');
      return;
    }
    if (state.noCity) {
      if (iconEl) iconEl.innerHTML = '';
      updateWeatherTexts('点击 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> 设置城市', '', '');
      return;
    }

    // 正常天气数据
    if (iconEl) iconEl.innerHTML = weatherIcon(state.type);
    updateWeatherTexts(state.desc, state.temp, state.wind);
    if (cardEl && state.type) {
      cardEl.classList.add(weatherAtmosphereClass(state.type));
    }
  }

  /** 保存城市 → 重新查询天气 → 更新UI */
  function saveCityAndRefresh(city, cityNameEl, cityRow) {
    renderWeatherState({ loading: true });
    fetch('/api/weather/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: city })
    }).then(function(r) {
      if (!r.ok) throw new Error('保存失败');
      weatherCityName = city;
      cityNameEl.textContent = city;
      cityRow.classList.remove('show');
      return fetch('/api/weather/today');
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) throw new Error(d.error);
      var w = d.weather;
      renderWeatherState({ type: w.type, desc: w.desc, temp: w.temp, wind: w.wind });
    })
    .catch(function(err) {
      renderWeatherState({ error: err.message });
    });
  }

  function openWeatherModal() {
    var m = ensureWeatherModal();
    m.style.display = 'flex';

    var cityNameEl = document.getElementById('w-city-name');

    renderWeatherState({ loading: true });

    // 加载城市配置 + 自动查询天气
    fetch('/api/weather/config').then(function(r) { return r.json(); }).then(function(d) {
      weatherCityName = d.city || '';
      if (weatherCityName) {
        cityNameEl.textContent = weatherCityName;
        return fetch('/api/weather/today');
      } else {
        cityNameEl.textContent = '未设置';
        throw new Error('no_city');
      }
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) throw new Error(d.error);
      var w = d.weather;
      renderWeatherState({ type: w.type, desc: w.desc, temp: w.temp, wind: w.wind });
    })
    .catch(function(err) {
      if (err.message === 'no_city') {
        renderWeatherState({ noCity: true });
      } else {
        renderWeatherState({ error: err.message });
      }
    });
  }

  function closeWeatherModal() {
    if (weatherModal) weatherModal.style.display = 'none';
    var row = document.getElementById('w-city-row');
    if (row) row.classList.remove('show');
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && weatherModal && weatherModal.style.display === 'flex') {
      closeWeatherModal();
    }
  });

  // ========== 导出记录 ==========
  function triggerExport() {
    var a = document.createElement('a');
    a.href = '/api/messages/export';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ========== 轻量 Toast（不依赖页面 toast） ==========
  function showOctopusToast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:200;',
      'background:var(--color-surface-translucent-strong);backdrop-filter:blur(12px);',
      'border:1px solid var(--color-border-glow);border-radius:20px;',
      'padding:8px 24px;color:var(--color-text);font-size:13px;font-family:inherit;',
      'pointer-events:none;transition:opacity 0.3s ease;'
    ].join('');
    document.body.appendChild(el);
    setTimeout(function(){ el.style.opacity = '0'; }, 1800);
    setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 2200);
  }

  // ========== 拖拽 + 点击识别 ==========
  function makeDraggable(widget) {
    var dragging = false;
    var moved = false;
    var startX, startY, startLeft, startTop;

    function onPointerDown(e) {
      dragging = true;
      moved = false;
      widget.classList.add('dragging');
      var point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      var rect = widget.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
    }

    function onPointerMove(e) {
      if (!dragging) return;
      var point = e.touches ? e.touches[0] : e;
      var dx = point.clientX - startX;
      var dy = point.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        moved = true;
      }
      if (moved) {
        applyPosition(widget, startLeft + dx, startTop + dy);
      }
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      widget.classList.remove('dragging');

      if (moved) {
        // 拖拽 → 保存位置
        var rect = widget.getBoundingClientRect();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
        } catch (err) {}
      } else {
        // 没有移动 → 点击 → 切换菜单
        toggleBubble(widget);
      }
    }

    widget.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    widget.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  }

  function initOctopus() {
    if (document.getElementById('octopus-widget')) return;
    var widget = document.createElement('div');
    widget.id = 'octopus-widget';
    widget.setAttribute('aria-hidden', 'true');
    widget.innerHTML = SVG_MARKUP;
    document.body.appendChild(widget);

    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        applyPosition(widget, saved.left, saved.top);
      }
    } catch (err) {}

    makeDraggable(widget);

    window.addEventListener('resize', function () {
      var rect = widget.getBoundingClientRect();
      if (rect.left || rect.top) applyPosition(widget, rect.left, rect.top);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOctopus);
  } else {
    initOctopus();
  }
})();
