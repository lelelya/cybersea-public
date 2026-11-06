// js/imageRecords.js — 聊天图片记录
(function() {

  function showToast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('show'); });
    setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 300); }, 2500);
  }

  var grid = document.getElementById('ir-grid');
  var empty = document.getElementById('ir-empty');
  var preview = document.getElementById('ir-preview');
  var previewImg = document.getElementById('ir-preview-img');
  var previewInfo = document.getElementById('ir-preview-info');
  var previewClose = document.getElementById('ir-preview-close');

  function formatTime(isoStr) {
    var d = window.CyberSea.parseTimestamp(isoStr);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  async function loadImages() {
    try {
      var resp = await fetch('/api/messages?limit=2000');
      var data = await resp.json();
      var messages = data.messages || [];

      var imageMsgs = messages.filter(function(m) {
        return m.type === 'image' && m.image_path;
      });

      if (imageMsgs.length === 0) {
        empty.style.display = '';
        grid.style.display = 'none';
        return;
      }

      empty.style.display = 'none';
      grid.style.display = '';

      var html = '';
      imageMsgs.forEach(function(m) {
        var roleTag = m.role === 'user' ? '你' : 'AI';
        var roleClass = m.role;
        var imgPath = m.image_path;
        var caption = m.content || '';
        var time = formatTime(m.created_at);

        html += '<div class="ir-item" data-path="' + imgPath + '" data-caption="' + caption.replace(/"/g, '&quot;') + '" data-time="' + time + '" data-role="' + roleTag + '">';
        html += '<img src="' + imgPath + '" alt="' + caption + '" loading="lazy" />';
        html += '<div class="ir-role-tag ' + roleClass + '">' + roleTag + '</div>';
        html += '</div>';
      });

      grid.innerHTML = html;

      // 点击预览
      grid.querySelectorAll('.ir-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var path = item.dataset.path;
          var caption = item.dataset.caption;
          var time = item.dataset.time;
          var role = item.dataset.role;
          previewImg.src = path;
          previewInfo.textContent = role + (caption ? ' · ' + caption : '') + ' · ' + time;
          preview.classList.add('show');
        });
      });
    } catch (err) {
      console.error('加载图片失败:', err);
      showToast('图片加载失败，请重试');
      empty.style.display = '';
      grid.style.display = 'none';
    }
  }

  // 关闭预览
  previewClose.addEventListener('click', function() {
    preview.classList.remove('show');
    previewImg.src = '';
  });
  preview.addEventListener('click', function(e) {
    if (e.target === preview) {
      preview.classList.remove('show');
      previewImg.src = '';
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && preview.classList.contains('show')) {
      preview.classList.remove('show');
      previewImg.src = '';
    }
  });

  loadImages();

})();
