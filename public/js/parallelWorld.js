// js/parallelWorld.js — 平行世界（乙女向文字冒险游戏）
// 所有前端逻辑：存档管理、游戏界面渲染、API交互、剧情推进

(function() {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  let currentView = 'list';     // 'list' | 'game'
  let currentSaveId = null;
  let currentSaveData = null;
  let isLoading = false;

  // ============================================================
  // DOM refs
  // ============================================================
  const $listView = document.getElementById('pw-list-view');
  const $gameView = document.getElementById('pw-game-view');
  const $saveList = document.getElementById('pw-save-list');
  const $empty = document.getElementById('pw-empty');
  const $gameArea = document.getElementById('pw-game-area');
  const $choicePanel = document.getElementById('pw-choice-panel');
  const $options = document.getElementById('pw-options');
  const $freeInput = document.getElementById('pw-free-input');
  const $freeSend = document.getElementById('pw-free-send');
  const $title = document.getElementById('pw-title');
  const $newBtn = document.getElementById('pw-new-btn');
  const $backBtn = document.getElementById('pw-back-btn');
  const $endBtn = document.getElementById('pw-end-btn');
  const $newModalOverlay = document.getElementById('pw-new-modal-overlay');
  const $endingOverlay = document.getElementById('pw-ending-overlay');
  const $endingName = document.getElementById('pw-ending-name');
  const $toast = document.getElementById('toast');

  // ============================================================
  // Utilities
  // ============================================================
  function showToast(msg, duration) {
    duration = duration || 2500;
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout($toast._timeout);
    $toast._timeout = setTimeout(function() {
      $toast.classList.remove('show');
    }, duration);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    var resp = await fetch('/api/parallel-world' + path, opts);
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  // ============================================================
  // View Switching
  // ============================================================
  function showListView() {
    currentView = 'list';
    currentSaveId = null;
    currentSaveData = null;
    $listView.classList.add('active');
    $gameView.classList.remove('active');
    $title.textContent = '平行世界';
    $newBtn.style.display = '';
    $backBtn.style.display = 'none';
    $endBtn.style.display = 'none';
    loadSaves();
  }

  function showGameView() {
    currentView = 'game';
    $listView.classList.remove('active');
    $gameView.classList.add('active');
    $newBtn.style.display = 'none';
    $backBtn.style.display = '';
    $endBtn.style.display = '';
  }

  // ============================================================
  // Save List
  // ============================================================
  async function loadSaves() {
    try {
      var data = await api('GET', '');
      if (data.saves && data.saves.length > 0) {
        renderSaveList(data.saves);
      } else {
        $saveList.innerHTML = '';
        $empty.style.display = 'flex';
        $saveList.style.display = 'none';
      }
    } catch (err) {
      showToast('加载存档失败: ' + err.message);
    }
  }

  function renderSaveList(saves) {
    $empty.style.display = 'none';
    $saveList.style.display = 'flex';
    var html = '';
    saves.forEach(function(s) {
      var statusClass = s.status === 'ongoing' ? 'ongoing' : 'ended';
      var statusLabel = s.status === 'ongoing' ? '进行中' : '已完结';
      var worldLabel = escapeHtml(s.world_label || '未命名世界');
      var aiName = escapeHtml(s.ai_name || '他');
      var preview = escapeHtml(s.preview || '');
      var nodeCount = s.node_count || 0;
      var updatedAt = s.updated_at || s.created_at || '';

      html += '<div class="pw-save-card" data-save-id="' + s.id + '">';
      html += '<div class="pw-save-card-header">';
      html += '<span class="pw-save-world" data-save-id="' + s.id + '" title="点击重命名">' + worldLabel + '</span>';
      html += '<span class="pw-save-status ' + statusClass + '">' + statusLabel + '</span>';
      html += '</div>';
      html += '<div class="pw-save-chars">' + aiName + ' · ' + nodeCount + ' 段剧情</div>';
      if (preview) {
        html += '<div class="pw-save-preview">"' + preview + '"</div>';
      }
      html += '<div class="pw-save-meta">' + updatedAt + '</div>';
      html += '<div class="pw-save-actions">';
      html += '<button class="btn-primary pw-continue-btn" data-save-id="' + s.id + '">' + (s.status === 'ongoing' ? '继续冒险' : '回放剧情') + '</button>';
      html += '<button class="btn-secondary pw-delete-btn" data-save-id="' + s.id + '">删除</button>';
      html += '</div>';
      html += '</div>';
    });

    $saveList.innerHTML = html;

    // 事件委托
    $saveList.querySelectorAll('.pw-save-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        // 如果点击的是按钮，不触发卡片点击
        if (e.target.tagName === 'BUTTON') return;
        var saveId = parseInt(card.dataset.saveId);
        enterGame(saveId);
      });
    });

    $saveList.querySelectorAll('.pw-continue-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var saveId = parseInt(btn.dataset.saveId);
        enterGame(saveId);
      });
    });

    $saveList.querySelectorAll('.pw-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var saveId = parseInt(btn.dataset.saveId);
        deleteSave(saveId);
      });
    });

    // 标题点击重命名
    $saveList.querySelectorAll('.pw-save-world').forEach(function(span) {
      span.addEventListener('click', function(e) {
        e.stopPropagation();
        var saveId = parseInt(span.dataset.saveId);
        var oldText = span.textContent;
        span.contentEditable = 'true';
        span.focus();
        // 选中全部文字
        var range = document.createRange();
        range.selectNodeContents(span);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        function finish() {
          span.contentEditable = 'false';
          span.removeEventListener('blur', finish);
          span.removeEventListener('keydown', onKey);
          var newTitle = span.textContent.trim();
          if (newTitle !== oldText) {
            api('PATCH', '/' + saveId, { title: newTitle }).catch(function(){});
          }
        }
        function onKey(e) {
          if (e.key === 'Enter') { e.preventDefault(); finish(); }
          if (e.key === 'Escape') { span.textContent = oldText; finish(); }
        }
        span.addEventListener('blur', finish);
        span.addEventListener('keydown', onKey);
      });
    });
  }

  async function deleteSave(saveId) {
    if (!confirm('确定要删除这个存档吗？所有剧情进度将被永久删除。')) return;
    try {
      await api('DELETE', '/' + saveId);
      showToast('存档已删除');
      loadSaves();
    } catch (err) {
      showToast('删除失败: ' + err.message);
    }
  }

  // ============================================================
  // Enter Game
  // ============================================================
  async function enterGame(saveId) {
    currentSaveId = saveId;
    showGameView();
    $gameArea.innerHTML = '';
    $choicePanel.style.display = 'none';
    $endBtn.style.display = '';
    $title.textContent = '平行世界';

    try {
      var data = await api('GET', '/' + saveId);
      currentSaveData = data.save;
      var nodes = data.nodes || [];

      // 更新标题
      var aiChar = {};
      try { aiChar = JSON.parse(data.save.ai_character || '{}'); } catch (_) {}
      $title.textContent = aiChar.name || '平行世界';

      // 渲染所有已有节点
      nodes.forEach(function(node) {
        appendStoryNode(node, false);
      });

      // 判断状态
      if (data.save.status === 'ended') {
        // 已完结：显示结局信息，隐藏选项面板
        $choicePanel.style.display = 'none';
        $endBtn.style.display = 'none';
        showEndingInfo(data.save.ending_name || '结局');
      } else if (nodes.length === 0) {
        // 新建存档，还没有节点（不应该发生，因为创建时就生成了第一段）
        // 但以防万一
        advanceStory(null, null);
      } else {
        // 进行中：显示最新节点的选项
        var lastNode = nodes[nodes.length - 1];
        showOptions(lastNode);
      }

      // 滚动到底部
      scrollToBottom();
    } catch (err) {
      showToast('加载剧情失败: ' + err.message);
      showListView();
    }
  }

  // ============================================================
  // Render Story Node
  // ============================================================
  function appendStoryNode(node, animate) {
    if (animate === undefined) animate = true;

    var block = document.createElement('div');
    block.className = 'pw-story-block';
    if (animate) {
      block.style.animation = 'pwFadeIn 0.4s ease';
    }

    var html = '';

    // 旁白/环境描写
    if (node.narration && node.narration.trim()) {
      html += '<div class="pw-narration">' + escapeHtml(node.narration).replace(/\n/g, '<br>') + '</div>';
    }

    // 他的言行
    if (node.his_words && node.his_words.trim()) {
      html += '<div class="pw-his-words">' + escapeHtml(node.his_words).replace(/\n/g, '<br>') + '</div>';
    }

    // 关于我的描写
    if (node.my_description && node.my_description.trim()) {
      html += '<div class="pw-my-desc">' + escapeHtml(node.my_description).replace(/\n/g, '<br>') + '</div>';
    }

    // 用户选择回显
    if (node.user_choice || node.user_free_input) {
      var choiceText = node.user_free_input || node.user_choice;
      html += '<div style="text-align:right;font-size:12px;color:var(--color-text-muted);opacity:0.5;margin-top:8px;">→ ' + escapeHtml(choiceText) + '</div>';
    }

    html += '<hr class="pw-separator">';

    if (!html.trim()) {
      html = '<div class="pw-narration" style="opacity:0.7;">（剧情继续...）</div><hr class="pw-separator">';
    }

    block.innerHTML = html;
    $gameArea.appendChild(block);
  }

  function showOptions(node) {
    var opts = [];
    try {
      if (Array.isArray(node.options)) {
        opts = node.options;
      } else if (typeof node.options_json === 'string') {
        opts = JSON.parse(node.options_json);
      }
    } catch (_) {
      opts = [];
    }

    if (opts.length === 0) {
      $choicePanel.style.display = 'none';
      return;
    }

    $choicePanel.style.display = 'flex';
    $options.innerHTML = '';

    opts.forEach(function(opt, idx) {
      var label = typeof opt === 'string' ? opt : (opt.label || ('选项 ' + (idx + 1)));
      var btn = document.createElement('button');
      btn.className = 'pw-option-btn';
      btn.textContent = label;
      btn.addEventListener('click', function() {
        if (isLoading) return;
        advanceStory(label, null);
      });
      $options.appendChild(btn);
    });
  }

  // ============================================================
  // Advance Story
  // ============================================================
  async function advanceStory(choice, freeInput) {
    if (isLoading) return;
    isLoading = true;

    // 禁用所有选项按钮
    disableOptions(true);

    // 显示打字指示器
    var typingEl = showTyping();

    // 隐藏选项面板
    $choicePanel.style.display = 'none';

    try {
      var body = {};
      if (freeInput) {
        body.free_input = freeInput;
      } else if (choice) {
        body.choice = choice;
      }

      var data = await api('POST', '/' + currentSaveId + '/advance', body);

      // 移除打字指示器
      hideTyping(typingEl);

      // 追加新节点
      var node = data.node;
      appendStoryNode(node, true);

      // 处理结局
      if (data.is_ending) {
        $choicePanel.style.display = 'none';
        $endBtn.style.display = 'none';
        showEndingInfo(data.ending_name || '结局');

        // 更新存档状态
        if (currentSaveData) {
          currentSaveData.status = 'ended';
          currentSaveData.ending_name = data.ending_name;
        }
      } else {
        // 显示新选项
        showOptions(node);
        $endBtn.style.display = '';
      }

      scrollToBottom();
    } catch (err) {
      hideTyping(typingEl);
      showToast('剧情推进失败: ' + err.message);
      $choicePanel.style.display = 'flex';
    } finally {
      isLoading = false;
      disableOptions(false);
    }
  }

  // ============================================================
  // End Story
  // ============================================================
  async function forceEndStory() {
    if (isLoading) return;
    if (!confirm('确定要结束当前剧情吗？AI将基于当前进度收束并给出结局。')) return;

    isLoading = true;
    disableOptions(true);
    $choicePanel.style.display = 'none';
    $endBtn.style.display = 'none';

    var typingEl = showTyping();

    try {
      var data = await api('POST', '/' + currentSaveId + '/end');

      hideTyping(typingEl);

      var node = data.node;
      appendStoryNode(node, true);

      showEndingInfo(data.ending_name || '结局');

      if (currentSaveData) {
        currentSaveData.status = 'ended';
        currentSaveData.ending_name = data.ending_name;
      }

      scrollToBottom();
    } catch (err) {
      hideTyping(typingEl);
      showToast('结束剧情失败: ' + err.message);
      $endBtn.style.display = '';
    } finally {
      isLoading = false;
      disableOptions(false);
    }
  }

  // ============================================================
  // Ending
  // ============================================================
  function showEndingInfo(endingName) {
    $endingName.textContent = endingName || '结局';
    $endingOverlay.style.display = 'flex';
  }

  // ============================================================
  // Typing Indicator
  // ============================================================
  function showTyping() {
    var el = document.createElement('div');
    el.className = 'pw-typing';
    el.innerHTML = '<div class="pw-typing-dot"></div><div class="pw-typing-dot"></div><div class="pw-typing-dot"></div>';
    el.style.padding = '12px 16px';
    $gameArea.appendChild(el);
    scrollToBottom();
    return el;
  }

  function hideTyping(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function disableOptions(disabled) {
    $options.querySelectorAll('.pw-option-btn').forEach(function(btn) {
      btn.disabled = disabled;
      btn.style.opacity = disabled ? '0.5' : '1';
    });
    $freeInput.disabled = disabled;
    $freeSend.disabled = disabled;
  }

  // ============================================================
  // New Story Modal
  // ============================================================
  function showNewModal() {
    $newModalOverlay.style.display = 'flex';
    // 加载 persona 头像（和聊天界面一致）
    fetch('/api/persona').then(r => r.json()).then(p => {
      var myAvatar = document.getElementById('pw-my-avatar');
      var hisAvatar = document.getElementById('pw-his-avatar');
      if (myAvatar) myAvatar.innerHTML = renderAvatarHtml('user', p.user_avatar_path || '', p.user_name || '我', false);
      if (hisAvatar) hisAvatar.innerHTML = renderAvatarHtml('ai', p.ai_avatar_path || '', p.ai_name || '他', false);
    }).catch(() => {});
  }

  function hideNewModal() {
    $newModalOverlay.style.display = 'none';
    // 清空表单
    ['pw-new-title', 'pw-new-world', 'pw-new-my-desc', 'pw-new-his-desc', 'pw-new-opening', 'pw-new-past', 'pw-new-relation'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
  }

  async function submitNewStory() {
    var title = document.getElementById('pw-new-title').value.trim();
    var worldDesc = document.getElementById('pw-new-world').value.trim();
    var myDesc = document.getElementById('pw-new-my-desc').value.trim();
    var hisDesc = document.getElementById('pw-new-his-desc').value.trim();
    var openingSituation = document.getElementById('pw-new-opening').value.trim();
    var relationLabel = document.getElementById('pw-new-relation').value.trim();
    var pastExperience = document.getElementById('pw-new-past').value.trim();

    // 基本验证
    if (!worldDesc) {
      showToast('请填写世界观设定');
      return;
    }
    if (!myDesc) {
      showToast('请填写你的身份描述');
      return;
    }
    if (!hisDesc) {
      showToast('请填写他的身份描述');
      return;
    }

    hideNewModal();

    // 显示加载状态
    showToast('正在生成剧情...');

    try {
      var data = await api('POST', '', {
        title: title,
        world_setting: { description: worldDesc },
        user_character: { description: myDesc },
        ai_character: { description: hisDesc },
        opening_situation: openingSituation,
        relationship_label: relationLabel,
        past_experience: pastExperience,
      });

      currentSaveId = data.save.id;
      currentSaveData = data.save;

      showGameView();
      $gameArea.innerHTML = '';
      $choicePanel.style.display = 'none';

      $title.textContent = '平行世界';

      // 渲染第一段剧情
      if (data.node) {
        appendStoryNode(data.node, true);
        showOptions(data.node);
      }

      scrollToBottom();
      showToast('故事开始！');
    } catch (err) {
      showToast('创建剧情失败: ' + err.message);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================
  function scrollToBottom() {
    setTimeout(function() {
      $gameArea.scrollTop = $gameArea.scrollHeight;
    }, 50);
  }

  // ============================================================
  // Event Listeners
  // ============================================================
  $newBtn.addEventListener('click', showNewModal);
  $backBtn.addEventListener('click', showListView);

  document.getElementById('pw-new-cancel').addEventListener('click', hideNewModal);
  document.getElementById('pw-new-submit').addEventListener('click', submitNewStory);

  $newModalOverlay.addEventListener('click', function(e) {
    if (e.target === $newModalOverlay) hideNewModal();
  });

  $endBtn.addEventListener('click', forceEndStory);

  document.getElementById('pw-ending-ok').addEventListener('click', function() {
    $endingOverlay.style.display = 'none';
    showListView();
  });

  $freeSend.addEventListener('click', function() {
    var text = $freeInput.value.trim();
    if (!text) return;
    $freeInput.value = '';
    advanceStory(null, text);
  });

  $freeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = $freeInput.value.trim();
      if (!text) return;
      $freeInput.value = '';
      advanceStory(null, text);
    }
  });

  // ESC 关闭弹窗
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if ($newModalOverlay.style.display === 'flex') {
        hideNewModal();
      }
    }
  });

  // ============================================================
  // Init
  // ============================================================
  function init() {
    loadSaves();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
