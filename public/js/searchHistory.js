// js/searchHistory.js — 聊天记录搜索（服务端 LIKE 查询，全量搜索）
(function() {

  var input = document.getElementById('sh-input');
  var results = document.getElementById('sh-results');

  var EMPTY_HTML = '<div class="sh-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" width="48" height="48" opacity="0.3"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><div style="font-size:15px;">输入关键词搜索聊天记录</div></div>';

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, keyword) {
    if (!keyword) return escapeHtml(text);
    var escaped = escapeHtml(text);
    var kw = escapeHtml(keyword);
    var regex = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(regex, '<span class="sh-highlight">$1</span>');
  }

  async function search(keyword) {
    if (!keyword || !keyword.trim()) {
      results.innerHTML = EMPTY_HTML;
      return;
    }

    try {
      var resp = await fetch('/api/messages/search?q=' + encodeURIComponent(keyword));
      var data = await resp.json();
      var messages = data.messages || [];

      if (messages.length === 0) {
        results.innerHTML = '<div class="sh-empty"><div style="font-size:15px;">未找到包含「' + escapeHtml(keyword) + '」的消息</div></div>';
        return;
      }

      var html = '';
      messages.forEach(function(m) {
        var roleLabel = m.role === 'user' ? '你' : 'AI';
        var roleClass = m.role === 'user' ? 'user' : 'ai';
        var d = window.CyberSea.parseTimestamp(m.created_at);
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var timeStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

        html += '<div class="sh-result-card" data-id="' + m.id + '">';
        html += '<div class="sh-result-role ' + roleClass + '">' + roleLabel + '</div>';
        html += '<div class="sh-result-content">' + highlight(m.content, keyword) + '</div>';
        html += '<div class="sh-result-time">' + timeStr + '</div>';
        if (m.content.length > 200) {
          html += '<span class="sh-result-expand" data-action="expand">展开全文</span>';
        }
        html += '</div>';
      });

      results.innerHTML = html;

      results.querySelectorAll('[data-action="expand"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var card = btn.closest('.sh-result-card');
          var content = card.querySelector('.sh-result-content');
          var isExpanded = content.classList.contains('expanded');
          if (isExpanded) {
            content.classList.remove('expanded');
            btn.textContent = '展开全文';
          } else {
            content.classList.add('expanded');
            btn.textContent = '收起';
          }
        });
      });
    } catch (err) {
      console.error('搜索失败:', err);
      results.innerHTML = '<div class="sh-empty"><div style="font-size:15px;">搜索出错</div></div>';
    }
  }

  var timer = null;
  input.addEventListener('input', function() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() {
      search(input.value);
    }, 300);
  });

})();
