// js/wsClient.js — WebSocket 客户端
// 页面加载时自动建立 WS 连接，支持断线重连与消息分发。
// 挂载为 window.wsClient

(function() {

  const WS_PATH = '/ws';
  const RECONNECT_BASE = 1000;   // 首次重连间隔 1s
  const RECONNECT_MAX = 30000;   // 最大重连间隔 30s

  var ws = null;
  var handlers = {};              // { type: [fn1, fn2, ...] }
  var reconnectTimer = null;
  var reconnectDelay = RECONNECT_BASE;
  var intentionalClose = false;

  // ========== 在线感知 ==========

  function sendVisibility() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'visibility', visible: !document.hidden }));
    }
  }

  document.addEventListener('visibilitychange', sendVisibility);

  // ========== 连接 ==========

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    intentionalClose = false;

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + window.location.host + WS_PATH;

    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[wsClient] 创建 WebSocket 失败:', err.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = function() {
      console.log('[wsClient] 已连接');
      reconnectDelay = RECONNECT_BASE;
      // 发送认证
      ws.send(JSON.stringify({ type: 'auth', peerId: 'user' }));
      // 上报当前可见性
      sendVisibility();
    };

    ws.onmessage = function(event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!msg || !msg.type) return;

      // 分发到注册的处理器
      var fns = handlers[msg.type];
      if (fns && fns.length > 0) {
        fns.slice().forEach(function(fn) { fn(msg); });
      }
    };

    ws.onclose = function(event) {
      console.log('[wsClient] 连接关闭:', event.code, event.reason);
      ws = null;
      if (!intentionalClose) scheduleReconnect();
    };

    ws.onerror = function(err) {
      console.error('[wsClient] 连接错误');
      // onclose 会在 onerror 之后触发，所以重连逻辑放在 onclose
    };
  }

  function disconnect() {
    intentionalClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      try { ws.close(1000, 'client disconnect'); } catch (_) {}
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log('[wsClient] 将在', reconnectDelay / 1000, '秒后重连');
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    }, reconnectDelay);
  }

  // ========== 公共 API ==========

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    console.warn('[wsClient] 未连接，无法发送消息');
    return false;
  }

  function on(type, fn) {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(fn);
  }

  function off(type, fn) {
    if (!handlers[type]) return;
    handlers[type] = handlers[type].filter(function(f) { return f !== fn; });
  }

  function isConnected() {
    return !!(ws && ws.readyState === WebSocket.OPEN);
  }

  // ========== 全局挂载 ==========

  window.wsClient = {
    connect: connect,
    disconnect: disconnect,
    send: send,
    on: on,
    off: off,
    isConnected: isConnected,
  };

  // ========== 自动连接 ==========

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { connect(); });
  } else {
    connect();
  }

  // 页面卸载时关闭
  window.addEventListener('beforeunload', function() {
    disconnect();
  });

})();
