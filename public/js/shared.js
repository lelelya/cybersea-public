(function () {
  async function requestJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('读取失败 (' + response.status + ')');
    return response.json();
  }
  function toast(message, options = {}) {
    const existing = options.id && document.getElementById(options.id);
    if (options.id && !existing) return;
    const element = existing || document.createElement('div');
    element.className = 'toast';
    element.textContent = message;
    if (!existing) document.body.appendChild(element);
    requestAnimationFrame(() => element.classList.add('show'));
    clearTimeout(element._toastTimer);
    element._toastTimer = setTimeout(() => {
      element.classList.remove('show');
      if (!existing) setTimeout(() => element.remove(), 300);
    }, options.duration || 2500);
  }
  function parseTimestamp(value) { return new Date(typeof value==='string'?value.replace(/^(\d{4}-\d{2}-\d{2}) /,'$1T'):value); }
  window.CyberSea = Object.assign(window.CyberSea || {}, { requestJson, toast, parseTimestamp });
})();
