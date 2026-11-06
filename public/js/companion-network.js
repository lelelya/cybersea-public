(function () {
  const scene = document.querySelector('.companion-network-scene');
  const network = document.querySelector('.companion-network');
  if (!scene || !network) return;
  const presence = scene.querySelector('.companion-presence');
  let frame = 0;

  function visibleTextRects(element) {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    // Measure the visible text lines, not the container's empty width or clamped lines.
    return [...range.getClientRects()].map(rect => ({
      left: Math.max(rect.left, box.left), top: Math.max(rect.top, box.top),
      right: Math.min(rect.right, box.right), bottom: Math.min(rect.bottom, box.bottom)
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  }

  function draw() {
    frame = 0;
    const nextSpace = Math.ceil(presence.getBoundingClientRect().height + 38) + 'px';
    if (scene.style.getPropertyValue('--presence-space') !== nextSpace) {
      scene.style.setProperty('--presence-space', nextSpace);
    }
    const bounds = scene.getBoundingClientRect();
    function center(selector) {
      const rect = scene.querySelector(selector).getBoundingClientRect();
      return { x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2 };
    }
    const avatar = center('#hub-avatar');
    const profile = center('.companion-profile .companion-node');
    const memory = center('.companion-memory .companion-node');
    const letter = center('.companion-letter .companion-node');
    const world = center('.companion-world .companion-node');
    const middle = { x: window.matchMedia('(max-width: 760px)').matches ? avatar.x : bounds.width * 0.49, y: (profile.y + world.y) / 2 - 5 };
    const xy = point => `${point.x} ${point.y}`;
    const perimeter = `M${xy(avatar)}L${xy(profile)}L${xy(letter)}L${xy(world)}L${xy(memory)}Z`;
    const spokes = [avatar, profile, memory, letter, world].map(point => `M${xy(point)}L${xy(middle)}`).join('');
    const gaps = [...scene.querySelectorAll('#hub-persona-name, .companion-tagline, .companion-entry-label, .companion-entry small')].flatMap(visibleTextRects).map(rect => {
      return `<rect x="${rect.left - bounds.left - 3}" y="${rect.top - bounds.top - 3}" width="${rect.right - rect.left + 6}" height="${rect.bottom - rect.top + 6}" fill="black"/>`;
    }).join('');
    network.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    // All markup below comes from local geometry, never persona or message text.
    network.innerHTML = `<defs><filter id="companion-line-feather" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter><mask id="companion-line-gaps"><rect width="100%" height="100%" fill="white"/><circle cx="${avatar.x}" cy="${avatar.y}" r="50" fill="black"/><g filter="url(#companion-line-feather)">${gaps}</g></mask></defs><g mask="url(#companion-line-gaps)"><path d="${perimeter}"/><path d="${spokes}" opacity=".8"/></g><circle cx="${middle.x}" cy="${middle.y}" r="2"/>`;
    // Feather opacity around text, without blurring the actual outlines or lettering.
    scene.querySelectorAll('.companion-entry').forEach((entry, index) => {
      const icon = entry.querySelector('.companion-entry-icon');
      if (!icon.dataset.outline) icon.dataset.outline = icon.innerHTML;
      const matrix = icon.getScreenCTM();
      if (!matrix) return;
      const inverse = matrix.inverse();
      function local(x, y) {
        const point = icon.createSVGPoint();
        point.x = x; point.y = y;
        return point.matrixTransform(inverse);
      }
      const cutouts = [...entry.querySelectorAll('.companion-entry-label, small')].flatMap(visibleTextRects).map(rect => {
        const start = local(rect.left - 3, rect.top - 2);
        const end = local(rect.right + 3, rect.bottom + 2);
        return `<rect x="${start.x}" y="${start.y}" width="${end.x - start.x}" height="${end.y - start.y}" fill="black" stroke="none"/>`;
      }).join('');
      const mask = 'companion-icon-gap-' + index;
      // Keep the fade about four screen pixels wide at every responsive icon size.
      const blur = 4 / Math.hypot(matrix.a, matrix.b);
      const view = icon.viewBox.baseVal;
      icon.innerHTML = `<defs><filter id="${mask}-feather" filterUnits="userSpaceOnUse" x="${view.x - 100}" y="${view.y - 100}" width="${view.width + 200}" height="${view.height + 200}"><feGaussianBlur stdDeviation="${blur}"/></filter><mask id="${mask}" maskUnits="userSpaceOnUse" x="-1000" y="-1000" width="3000" height="3000"><rect x="-1000" y="-1000" width="3000" height="3000" fill="white" stroke="none"/><g filter="url(#${mask}-feather)">${cutouts}</g></mask></defs><g mask="url(#${mask})">${icon.dataset.outline}</g>`;
    });
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  if ('ResizeObserver' in window) {
    const resize = new ResizeObserver(schedule);
    resize.observe(scene);
    resize.observe(presence);
    scene.querySelectorAll('.companion-entry').forEach(entry => resize.observe(entry));
  }
  // hubs.js may replace the fallback avatar and update names or letter excerpts.
  new MutationObserver(schedule).observe(presence, { childList: true, subtree: true, characterData: true });
  new MutationObserver(schedule).observe(scene.querySelector('#hub-letter-preview'), { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  document.fonts?.ready.then(schedule);
  schedule();
})();

