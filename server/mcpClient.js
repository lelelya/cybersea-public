// mcpClient.js
// MCP (Model Context Protocol) client — SSE transport + JSON-RPC
//
// Manages persistent SSE connections to remote MCP servers,
// discovers their tools (prefixed as mcp_{server}_{tool}),
// and dispatches tool calls during the Function Calling loop.
//
// Zero new dependencies — uses only Node.js >=22 built-ins:
//   fetch, ReadableStream, TextDecoder, AbortController, crypto

const { randomUUID } = require('crypto');

// ── Module State ─────────────────────────────────────────────────
/** @type {Map<string, {url:string, headers:object, serverName:string, postUrl:string, reader:ReadableStreamDefaultReader|null, abortController:AbortController, tools:Map<string,{rawName:string,definition:object}>, pendingRequests:Map<string,{resolve:Function,reject:Function,timer:NodeJS.Timeout}>, status:'connecting'|'connected'|'failed', reconnectAttempts:number}>} */
const connections = new Map();

/** @type {Map<string, {url:string, rawName:string}>} prefixedName → server info */
const toolToServer = new Map();

const CONNECT_TIMEOUT = 30000;
const CALL_TIMEOUT = 30000;
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 1;

// Track sanitized name collisions across one getConnectedTools() call
const usedPrefixes = new Map();

// ── Helpers ──────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const originalSignal = options.signal;
  if (originalSignal) {
    originalSignal.addEventListener('abort', () => controller.abort(),
      { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveUrl(postUrl, baseUrl) {
  try {
    return new URL(postUrl, baseUrl).href;
  } catch (_) {
    if (/^https?:\/\//i.test(postUrl)) return postUrl;
    const base = new URL(baseUrl);
    const origin = `${base.protocol}//${base.host}`;
    return postUrl.startsWith('/') ? origin + postUrl : origin + '/' + postUrl;
  }
}

function sanitizeServerName(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    || 'mcp';

  const count = usedPrefixes.get(base) || 0;
  if (count > 0) {
    usedPrefixes.set(base, count + 1);
    return `${base}_${count + 1}`;
  }
  usedPrefixes.set(base, 1);
  return base;
}

// ── SSE Parser ───────────────────────────────────────────────────
async function* parseSSE(reader, signal) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal.aborted) return;
    let done, value;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    }
    if (done) return;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const raw of events) {
      if (!raw.trim()) continue;
      const parsed = {};
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) {
          parsed.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const val = line.slice(5).trim();
          parsed.data = parsed.data ? parsed.data + '\n' + val : val;
        }
        // lines starting with ':' are SSE comments (heartbeats)
      }
      if (parsed.data !== undefined) yield parsed;
    }
  }
}

// ── Connection Lifecycle ─────────────────────────────────────────
function disconnect(url) {
  const conn = connections.get(url);
  if (!conn) return;

  try { conn.abortController.abort(); } catch (_) { /* ok */ }
  try { conn.reader?.cancel(); } catch (_) { /* ok */ }

  for (const [, { reject: rej, timer }] of conn.pendingRequests) {
    clearTimeout(timer);
    rej(new Error('MCP server disconnected'));
  }
  conn.pendingRequests.clear();

  // Remove tools from global registry
  for (const name of conn.tools.keys()) {
    toolToServer.delete(name);
  }

  connections.delete(url);
}

async function connectToServer(url, headers) {
  const existing = connections.get(url);
  if (existing) {
    const sameHeaders =
      JSON.stringify(existing.headers || {}) ===
      JSON.stringify(headers || {});
    if (sameHeaders && existing.status === 'connected' && existing.postUrl) {
      return existing.postUrl;
    }
    disconnect(url);
  }

  const abortController = new AbortController();
  const conn = {
    url,
    headers: headers || {},
    serverName: '',
    postUrl: null,
    reader: null,
    abortController,
    tools: new Map(),
    pendingRequests: new Map(),
    status: 'connecting',
    reconnectAttempts: 0,
  };

  const fetchHeaders = {
    Accept: 'text/event-stream',
    ...(headers || {}),
  };

  const resp = await fetchWithTimeout(url, {
    headers: fetchHeaders,
    signal: abortController.signal,
  }, CONNECT_TIMEOUT);

  if (!resp.ok) {
    throw new Error(`SSE connection failed: HTTP ${resp.status}`);
  }

  conn.reader = resp.body.getReader();

  // Wait for the 'endpoint' event (with its own timeout)
  const endpointPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('No endpoint event received within timeout'));
    }, CONNECT_TIMEOUT);

    (async () => {
      try {
        for await (const ev of parseSSE(conn.reader, abortController.signal)) {
          if (ev.event === 'endpoint') {
            clearTimeout(timer);
            resolve(ev.data);
            return;
          }
        }
        clearTimeout(timer);
        reject(new Error('SSE stream ended without endpoint event'));
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });

  let postUrl;
  try {
    postUrl = await endpointPromise;
  } catch (err) {
    conn.status = 'failed';
    try { conn.reader?.cancel(); } catch (_) { /* ok */ }
    try { abortController.abort(); } catch (_) { /* ok */ }
    throw err;
  }

  conn.postUrl = resolveUrl(postUrl, url);
  conn.status = 'connected';
  conn.reconnectAttempts = 0;
  connections.set(url, conn);

  // Start background read loop (fire-and-forget)
  readLoop(conn).catch((err) => {
    console.warn(`[MCP] Read loop error for ${url}:`, err.message);
  });

  return conn.postUrl;
}

// ── Background Read Loop ─────────────────────────────────────────
async function readLoop(conn) {
  try {
    for await (const ev of parseSSE(conn.reader, conn.abortController.signal)) {
      if (ev.data === undefined) continue; // heartbeat

      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        continue; // non-JSON event, skip
      }

      if (msg.id && conn.pendingRequests.has(msg.id)) {
        const entry = conn.pendingRequests.get(msg.id);
        clearTimeout(entry.timer);
        conn.pendingRequests.delete(msg.id);

        if (msg.error) {
          entry.reject(
            new Error(msg.error.message || JSON.stringify(msg.error))
          );
        } else {
          entry.resolve(msg.result);
        }
      }
      // Notifications (no id field) are silently ignored
    }
  } catch (err) {
    if (conn.abortController.signal.aborted) return;

    // Attempt one reconnect
    if (conn.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      conn.reconnectAttempts++;
      console.warn(
        `[MCP] SSE stream lost for ${conn.url}, ` +
        `reconnecting (${conn.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
      );
      await sleep(RECONNECT_DELAY);

      try {
        const oldTools = new Map(conn.tools);
        await connectToServer(conn.url, conn.headers);
        const newConn = connections.get(conn.url);
        if (newConn && newConn.status === 'connected') {
          // Restore tool registry entries (they were cleared in disconnect)
          for (const [name, info] of oldTools) {
            toolToServer.set(name, info);
            newConn.tools.set(name, info);
          }
        }
      } catch (reconnectErr) {
        console.warn(`[MCP] Reconnect failed for ${conn.url}: ${reconnectErr.message}`);
        conn.status = 'failed';
        // Reject remaining pending requests
        for (const [, entry] of conn.pendingRequests) {
          clearTimeout(entry.timer);
          entry.reject(new Error('MCP connection lost'));
        }
        conn.pendingRequests.clear();
      }
    } else {
      console.warn(
        `[MCP] Max reconnect attempts reached for ${conn.url}, marking as failed`
      );
      conn.status = 'failed';
      for (const [, entry] of conn.pendingRequests) {
        clearTimeout(entry.timer);
        entry.reject(new Error('MCP connection lost'));
      }
      conn.pendingRequests.clear();
    }
  }
}

// ── JSON-RPC ─────────────────────────────────────────────────────
async function sendJsonRpc(conn, method, params) {
  const id = randomUUID();
  const payload = { jsonrpc: '2.0', method, params, id };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pendingRequests.delete(id);
      reject(new Error('MCP tool call timeout'));
    }, CALL_TIMEOUT);

    conn.pendingRequests.set(id, { resolve, reject, timer });

    const headers = {
      'Content-Type': 'application/json',
      ...(conn.headers || {}),
    };

    fetch(conn.postUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
      .then(async (resp) => {
        // Some MCP servers return the result directly in the POST response
        const ct = resp.headers.get('content-type') || '';
        if (resp.ok && ct.includes('application/json')) {
          try {
            const data = await resp.json();
            if (data.id === id && conn.pendingRequests.has(id)) {
              clearTimeout(timer);
              conn.pendingRequests.delete(id);
              if (data.error) {
                reject(
                  new Error(data.error.message || JSON.stringify(data.error))
                );
              } else {
                resolve(data.result);
              }
              return;
            }
          } catch (_) {
            // Not valid JSON or not matching id — fall through to SSE path
          }
        }

        if (!resp.ok) {
          clearTimeout(timer);
          conn.pendingRequests.delete(id);
          reject(new Error(`MCP POST failed: HTTP ${resp.status}`));
        }
        // Otherwise, response will arrive via the SSE readLoop
      })
      .catch((err) => {
        if (conn.pendingRequests.has(id)) {
          clearTimeout(timer);
          conn.pendingRequests.delete(id);
          reject(err);
        }
      });
  });
}

// ── Tool Discovery ──────────────────────────────────────────────
async function discoverTools(url, headers, serverName) {
  const postUrl = await connectToServer(url, headers);
  const conn = connections.get(url);
  if (!conn) throw new Error('Connection lost after connect');

  // Use cached tools if already discovered
  if (conn.status === 'connected' && conn.tools.size > 0) {
    const definitions = [];
    for (const [prefixedName, info] of conn.tools) {
      definitions.push({ ...info.definition, name: prefixedName });
    }
    return { tools: conn.tools, definitions };
  }

  const result = await sendJsonRpc(conn, 'tools/list', {});
  const rawTools = result?.tools || [];

  const prefix = sanitizeServerName(serverName);
  conn.serverName = prefix;

  const tools = new Map();
  const definitions = [];

  for (const tool of rawTools) {
    const prefixedName = `mcp_${prefix}_${tool.name}`;

    const definition = {
      name: prefixedName,
      description: `[MCP:${serverName}] ${tool.description || ''}`,
      parameters: tool.inputSchema || {
        type: 'object',
        properties: {},
      },
    };

    tools.set(prefixedName, { rawName: tool.name, definition });
    definitions.push(definition);
  }

  // Store in connection
  conn.tools = tools;

  // Register in global tool-to-server map
  for (const [name, info] of tools) {
    toolToServer.set(name, { url, rawName: info.rawName });
  }

  return { tools, definitions };
}

// ── Tool Calling ─────────────────────────────────────────────────
async function callTool(prefixedName, args) {
  const info = toolToServer.get(prefixedName);
  if (!info) {
    return {
      error: `Unknown MCP tool: ${prefixedName}`,
      is_write: false,
      fn_name: prefixedName,
    };
  }

  const conn = connections.get(info.url);
  if (!conn || conn.status !== 'connected') {
    return {
      error: `MCP server not connected: ${info.url}`,
      is_write: false,
      fn_name: prefixedName,
    };
  }

  try {
    // Parse JSON string args from OpenAI function_call
    let parsedArgs = args;
    if (typeof args === 'string') {
      try {
        parsedArgs = JSON.parse(args);
      } catch (_) {
        // If not valid JSON, pass the raw string
      }
    }

    const result = await sendJsonRpc(conn, 'tools/call', {
      name: info.rawName,
      arguments: parsedArgs,
    });

    // Extract human-readable text from MCP result
    let textResult = '';
    if (result?.content && Array.isArray(result.content)) {
      const textParts = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text);
      textResult = textParts.join('\n');
      if (!textResult && result.content.length > 0) {
        textResult = JSON.stringify(result.content);
      }
    } else if (typeof result === 'string') {
      textResult = result;
    } else {
      textResult = JSON.stringify(result);
    }

    return {
      result: textResult || '完成',
      is_write: false,
      fn_name: prefixedName,
      fn_args: parsedArgs,
    };
  } catch (err) {
    return {
      error: err.message,
      is_write: false,
      fn_name: prefixedName,
    };
  }
}

// ── Main Orchestrator ────────────────────────────────────────────
async function getConnectedTools(mcpServers) {
  // Reset prefix collision tracker for this call
  usedPrefixes.clear();

  if (!mcpServers || !Array.isArray(mcpServers) || mcpServers.length === 0) {
    return { tools: [], toolMap: new Map() };
  }

  const enabledServers = mcpServers.filter(
    (s) => s.enabled && s.url && String(s.url).trim()
  );

  if (enabledServers.length === 0) {
    return { tools: [], toolMap: new Map() };
  }

  const allDefinitions = [];
  const allToolMap = new Map();

  for (const server of enabledServers) {
    try {
      const { tools, definitions } = await discoverTools(
        String(server.url).trim(),
        server.headers || {},
        server.name || 'unnamed'
      );
      allDefinitions.push(...definitions);
      for (const [name, info] of tools) {
        allToolMap.set(name, info);
      }
    } catch (err) {
      console.warn(
        `[MCP] Skipping server "${server.name}" at ${server.url}: ${err.message}`
      );
      // Continue with remaining servers
    }
  }

  return { tools: allDefinitions, toolMap: allToolMap };
}

function disconnectAll() {
  for (const url of connections.keys()) {
    disconnect(url);
  }
  toolToServer.clear();
  usedPrefixes.clear();
}

// ── Cleanup on process exit ──────────────────────────────────────
process.on('exit', () => {
  disconnectAll();
});

// ── Exports ──────────────────────────────────────────────────────
module.exports = {
  getConnectedTools,
  callTool,
  disconnectAll,
};
