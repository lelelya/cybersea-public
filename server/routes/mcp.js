// routes/mcp.js
// MCP Server配置管理（纯配置CRUD，暂不实际连接）

const express = require('express');
const db = require('../db');

const router = express.Router();

// 获取所有MCP Server + 全局开关状态
router.get('/servers', (req, res) => {
  const servers = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all();
  const config = db.prepare('SELECT global_enabled FROM mcp_config WHERE id = 1').get();
  // 将 headers JSON 字符串解析为对象返回给前端
  const parsed = servers.map(s => ({
    ...s,
    headers: safeParseJSON(s.headers || '{}', {}),
  }));
  res.json({
    servers: parsed,
    global_enabled: config ? !!config.global_enabled : false,
  });
});

// 新增一条MCP Server
router.post('/servers', (req, res) => {
  const { name, url, description, headers } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '名称不能为空' });
  }

  const headersStr = JSON.stringify(headers || {});

  const result = db.prepare(
    'INSERT INTO mcp_servers (name, url, description, headers) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), (url || '').trim(), (description || '').trim(), headersStr);

  const created = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(result.lastInsertRowid);
  created.headers = safeParseJSON(created.headers || '{}', {});
  res.json(created);
});

// 更新某条MCP Server
router.put('/servers/:id', (req, res) => {
  const { id } = req.params;
  const { name, url, description, enabled, headers } = req.body || {};

  const existing = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '记录不存在' });
  }

  db.prepare(
    `UPDATE mcp_servers SET
      name = COALESCE(@name, name),
      url = COALESCE(@url, url),
      description = COALESCE(@description, description),
      enabled = COALESCE(@enabled, enabled),
      headers = COALESCE(@headers, headers)
    WHERE id = @id`
  ).run({
    name: name ?? null,
    url: url ?? null,
    description: description ?? null,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : null,
    headers: headers !== undefined ? JSON.stringify(headers) : null,
    id: Number(id),
  });

  const updated = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  updated.headers = safeParseJSON(updated.headers || '{}', {});
  res.json(updated);
});

// 删除某条MCP Server
router.delete('/servers/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: '记录不存在' });
  }

  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(Number(id));
  res.json({ success: true });
});

// 更新全局开关
router.put('/config', (req, res) => {
  const { global_enabled } = req.body || {};
  db.prepare(
    'UPDATE mcp_config SET global_enabled = COALESCE(@global_enabled, global_enabled) WHERE id = 1'
  ).run({ global_enabled: global_enabled !== undefined ? (global_enabled ? 1 : 0) : null });

  const config = db.prepare('SELECT global_enabled FROM mcp_config WHERE id = 1').get();
  res.json(config);
});

function safeParseJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

module.exports = router;
