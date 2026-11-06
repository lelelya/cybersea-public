(function () {
  const sections = [
    { href: 'index.html', label: '聊天', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z', pages: ['index.html', 'favorites.html', 'voiceCall.html', 'searchHistory.html', 'imageRecords.html'] },
    { href: 'moments.html', label: '动态', icon: 'M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM12 6v15M8 10h8M4 14c0 4 3.5 6 8 7 4.5-1 8-3 8-7M4 14l-1 3m1-3 3 1M20 14l1 3m-1-3-3 1', pages: ['moments.html', 'profile.html'] },
    { href: 'life.html', label: '生活', icon: 'M3 10 12 3l9 7v11H3ZM9 21v-8h6v8', pages: ['life.html', 'calendar.html', 'plan.html', 'ledger.html', 'anniversary.html', 'album.html', 'bookshelf.html', 'books.html', 'stories.html', 'diary.html'] },
    { href: 'companion.html', label: '陪伴', icon: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z', pages: ['companion.html', 'persona.html', 'memoryBank.html', 'letters.html', 'parallelWorld.html'] },
    { href: 'settings.html', label: '设置', icon: 'M19.24 11.05L21.42 13.24L20.78 15.64L17.79 16.44L16.44 17.79L15.64 20.78L13.24 21.42L11.05 19.24L9.21 18.74L6.22 19.54L4.46 17.78L5.26 14.79L4.76 12.95L2.58 10.76L3.22 8.36L6.21 7.56L7.56 6.21L8.36 3.22L10.76 2.58L12.95 4.76L14.79 5.26L17.78 4.46L19.54 6.22L18.74 9.21ZM15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0Z', pages: ['settings.html'] }
  ];
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  const currentSection = sections.find(section => section.pages.includes(currentFile));

  function getProfileReturnUrl() {
    if (!document.referrer) return 'moments.html';
    try {
      const previousUrl = new URL(document.referrer);
      const previousFile = previousUrl.pathname.split('/').pop() || 'index.html';
      if (previousUrl.origin === location.origin && previousFile !== currentFile && sections.some(section => section.pages.includes(previousFile))) {
        return previousUrl.pathname + previousUrl.search + previousUrl.hash;
      }
    } catch {}
    return 'moments.html';
  }

  function initHeader() {
    document.getElementById('nav-drawer')?.remove();
    document.getElementById('drawer-overlay')?.remove();
    const menuButton = document.getElementById('menu-btn');
    if (!menuButton || !currentSection) return;
    if (currentFile === currentSection.href) {
      const spacer = document.createElement('span');
      spacer.className = 'nav-header-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      menuButton.replaceWith(spacer);
      return;
    }
    const link = document.createElement('a');
    link.className = 'nav-back';
    link.href = currentFile === 'profile.html' ? getProfileReturnUrl() : currentSection.href;
    link.setAttribute('aria-label', currentFile === 'profile.html' ? '返回上一页' : '返回' + currentSection.label);
    link.title = link.getAttribute('aria-label');
    link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
    menuButton.replaceWith(link);
  }

  function normalizeHeader() {
    document.querySelectorAll('body > .topbar, .reader-topbar').forEach(header => {
      if (header.classList.contains('app-header')) return;
      const title = header.querySelector('.title, .reader-title');
      if (!title) return;
      title.classList.add('title');
      const children = Array.from(header.children);
      const titleIndex = children.indexOf(title);
      const left = document.createElement('div');
      const right = document.createElement('div');
      left.className = 'app-header-left';
      right.className = 'app-header-right';
      children.slice(0, titleIndex).forEach(child => left.appendChild(child));
      children.slice(titleIndex + 1).forEach(child => right.appendChild(child));
      header.classList.add('topbar', 'app-header');
      header.setAttribute('role', 'banner');
      header.replaceChildren(left, title, right);
      // Long story actions need their own row, so the title stays centered.
      if (currentFile === 'parallelWorld.html' && header.parentElement === document.body) {
        const toolbar = document.createElement('div');
        toolbar.className = 'page-toolbar story-toolbar';
        while (right.firstChild) toolbar.appendChild(right.firstChild);
        header.after(toolbar);
      }
    });
  }

  function initBottomTabs() {
    if (!currentSection || document.querySelector('.bottom-tabs')) return;
    const nav = document.createElement('nav');
    nav.className = 'bottom-tabs';
    nav.setAttribute('aria-label', '主导航');
    sections.forEach(section => {
      const link = document.createElement('a');
      link.href = section.href;
      link.className = 'bottom-tab';
      if (section === currentSection) {
        link.classList.add('active');
        link.setAttribute('aria-current', section.href === currentFile ? 'page' : 'true');
      }
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + section.icon + '"/></svg><span>' + section.label + '</span>';
      nav.appendChild(link);
    });
    document.body.classList.add('with-bottom-tabs');
    document.body.appendChild(nav);
    if (currentFile === 'index.html') {
      document.addEventListener('focusin', event => {
        if (event.target.matches('textarea, input:not([type="checkbox"]):not([type="file"])')) nav.hidden = true;
      });
      document.addEventListener('focusout', () => {
        requestAnimationFrame(() => { nav.hidden = document.activeElement.matches('textarea, input:not([type="checkbox"]):not([type="file"])'); });
      });
    }
  }

  function initNav() {
    if (currentSection) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'css/navigation.css?v=5';
      const designSystem = document.querySelector('link[href*="css/design-system.css"]');
      document.head.insertBefore(stylesheet, designSystem);
    }
    initHeader();
    normalizeHeader();
    initBottomTabs();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();

