// llmClient.js
// 封装"OpenAI兼容格式"的API调用。读取settings表里保存的url/key/model/参数。

const db = require('./db');
const {modernMessages, unsupportedTools} = require('./chat/toolProtocol');
const legacyEndpoints = new Set();

/**
 * 调用配置好的OpenAI兼容API。
 *
 * @param {Array<{role: string, content: string}>} messages 完整消息数组（含system）
 * @param {Array<object>} [functions] 可选，OpenAI function calling 的函数定义列表。
 *   传入后启用工具调用，优先使用新版 tools，返回值类型变为对象。
 * @param {object} [opts] 可选参数
 * @param {number} [opts.maxTokensOverride] 强制指定 max_tokens，覆盖用户设置（写信等场景需要更大输出）
 * @returns {Promise<string|{content: string|null, function_call: object|null, tool_calls?: Array<object>}>}
 *   - 不传 functions：返回 AI 回复文本（向后兼容）
 *   - 传入 functions：返回文本、旧式 function_call 或新版 tool_calls
 */
async function chatCompletionDetailed(messages, functions, opts = {}) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

  if (!settings || !settings.api_base_url || !settings.api_key || !settings.model) {
    throw new Error('尚未配置API信息，请先前往"设置"页面填写 API地址/密钥/模型');
  }

  const url = settings.api_base_url.replace(/\/+$/, '') + '/chat/completions';

  const maxTokens = opts.maxTokensOverride ?? settings.max_tokens;

  const payload = {
    model: settings.model,
    messages,
    temperature: opts.temperatureOverride ?? settings.temperature,
    max_tokens: maxTokens,
  };

  const hasTools = functions && functions.length > 0;
  const endpointKey = `${url}\n${settings.model}`;
  payload.messages = legacyEndpoints.has(endpointKey) ? messages : modernMessages(messages);
  function useLegacyTools() {
    payload.messages = messages;
    delete payload.tools; delete payload.tool_choice; delete payload.parallel_tool_calls;
    payload.functions = functions; payload.function_call = 'auto';
  }
  if (hasTools) {
    if (legacyEndpoints.has(endpointKey)) useLegacyTools();
    else {
      payload.messages = modernMessages(messages);
      payload.tools = functions.map(fn => ({type:'function', function:fn}));
      payload.tool_choice = 'auto';
    }
  }

  const request = () => fetch(url, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify(payload),
  });
  let resp = await request();
  if (!resp.ok && hasTools && payload.tools) {
    const text = await resp.text().catch(() => '');
    if (!unsupportedTools(resp.status, text)) throw new Error(`API调用失败 (${resp.status}): ${text.slice(0, 500)}`);
    useLegacyTools();
    resp = await request();
    if (resp.ok) legacyEndpoints.add(endpointKey);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API调用失败 (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = await resp.json();
  const choice = data?.choices?.[0];
  const msg = choice?.message;
  if (['length','content_filter'].includes(choice?.finish_reason)) {
    const truncated = choice.finish_reason === 'length';
    throw Object.assign(new Error(truncated ? '模型输出被截断，请增加输出长度后重试' : '模型未能提供完整回复，请调整内容后重试'), {code:truncated?'MODEL_TRUNCATED':'MODEL_FILTERED',status:502});
  }

  if (!msg) {
    throw new Error('API返回内容格式异常，未找到 choices[0].message');
  }

  if (!msg.content && !msg.function_call && !msg.tool_calls?.length) {
    throw new Error('API返回内容格式异常，未找到 choices[0].message.content');
  }
  return { content: msg.content || null, function_call: msg.function_call || null, tool_calls:msg.tool_calls || null, finish_reason: choice.finish_reason, usage: data.usage };
}

async function chatCompletion(messages, functions, opts = {}) {
  const result = await chatCompletionDetailed(messages, functions, opts);
  return functions ? {content:result.content,function_call:result.function_call,...(result.tool_calls?.length?{tool_calls:result.tool_calls}:{})} : result.content;
}

/**
 * 流式调用 OpenAI 兼容 API，通过回调推送每个文本片段。
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {Array<object>} [functions] 可选，function calling 函数定义
 * @param {(chunk: string) => void} onChunk 每收到一个文本片段时回调
 * @param {object} [opts] 可选参数
 * @param {number} [opts.maxTokensOverride] 强制指定 max_tokens
 * @param {AbortSignal} [opts.signal] 可中断的 AbortSignal
 * @returns {Promise<string>} 完整的 AI 回复文本
 */
async function chatCompletionStream(messages, functions, onChunk, opts = {}) {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

  if (!settings || !settings.api_base_url || !settings.api_key || !settings.model) {
    throw new Error('尚未配置API信息，请先前往"设置"页面填写 API地址/密钥/模型');
  }

  const url = settings.api_base_url.replace(/\/+$/, '') + '/chat/completions';
  const maxTokens = opts.maxTokensOverride ?? settings.max_tokens;

  const payload = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  if (functions && functions.length > 0) {
    payload.functions = functions;
    payload.function_call = 'auto';
  }

  const fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify(payload),
  };
  if (opts.signal) fetchOpts.signal = opts.signal;

  const resp = await fetch(url, fetchOpts);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API调用失败 (${resp.status}): ${text.slice(0, 500)}`);
  }

  // 逐行解析 SSE 流
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    if (opts.signal && opts.signal.aborted) {
      reader.cancel();
      return fullContent; // 返回已收到的部分内容
    }
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // 保留最后一个可能不完整的行
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta;
        if (delta && delta.content) {
          fullContent += delta.content;
          onChunk(delta.content);
        }
      } catch (_) {
        // 跳过解析失败的行（可能是注释或其他格式）
      }
    }
  }

  return fullContent;
}

module.exports = { chatCompletion, chatCompletionDetailed, chatCompletionStream };
