// CyberSea 深海粒子动画
// 轻量浮游生物/气泡上升效果，填补页面两侧空白
// 纯装饰，pointer-events: none，不影响交互
(function () {
  var PARTICLE_COUNT = 40;
  var CONTAINER_ID = 'deepsea-particles';

  if (document.getElementById(CONTAINER_ID)) return;

  // 创建容器
  var container = document.createElement('div');
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  // 随机范围
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  // 生成单个粒子
  function createParticle() {
    var p = document.createElement('div');
    p.className = 'dp';

    var size = rand(1, 3.2);
    var opacity = rand(0.12, 0.45);
    var duration = rand(18, 35);       // 秒，飘完整屏
    var delay = rand(0, -duration);     // 负延迟 = 从中间开始
    var left = rand(0, 100);            // 水平位置 (%)
    var sway = rand(4, 14);             // 水平摇摆幅度 (px)

    // 部分粒子带荧光光晕
    var hasGlow = Math.random() < 0.35;
    var glowSize = hasGlow ? rand(3, 7) : 0;
    var glowAlpha = hasGlow ? rand(0.15, 0.4) : 0;

    p.style.cssText = [
      'position:absolute',
      'bottom:-8px',                    // 从底部以下开始
      'left:' + left.toFixed(1) + '%',
      'width:' + size.toFixed(1) + 'px',
      'height:' + size.toFixed(1) + 'px',
      'border-radius:50%',
      'background:rgba(79,217,200,' + opacity.toFixed(2) + ')',
      'box-shadow:' + (hasGlow
        ? '0 0 ' + glowSize.toFixed(0) + 'px rgba(79,217,200,' + glowAlpha.toFixed(2) + ')'
        : 'none'),
      'animation:dp-rise ' + duration.toFixed(1) + 's linear infinite',
      'animation-delay:' + delay.toFixed(1) + 's',
      '--sway:' + sway.toFixed(0) + 'px',
      'will-change:transform,opacity',
      'pointer-events:none'
    ].join(';');

    return p;
  }

  // 生成所有粒子
  var frag = document.createDocumentFragment();
  for (var i = 0; i < PARTICLE_COUNT; i++) {
    frag.appendChild(createParticle());
  }
  container.appendChild(frag);

  // 周期性刷新个别粒子，防止所有粒子逐渐同步
  // （极少数粒子会被随机替换，保持视觉新鲜感）
  setInterval(function () {
    var particles = container.children;
    if (particles.length === 0) return;
    // 随机替换 1 个粒子
    var idx = Math.floor(Math.random() * particles.length);
    var old = particles[idx];
    var neo = createParticle();
    container.replaceChild(neo, old);
  }, 30000); // 每 30 秒换一个
})();
