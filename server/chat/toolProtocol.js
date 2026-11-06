// Keep business tools independent of the provider's tool-call wire format.
function modernMessages(messages) {
  let previousCall;
  return messages.map((message, index) => {
    if (message.role === 'assistant' && message.function_call) {
      previousCall = `call_${index}`;
      return {role:'assistant', content:message.content ?? null, tool_calls:[{id:previousCall,type:'function',function:message.function_call}]};
    }
    if (message.role === 'function') {
      if (!previousCall) throw new Error('工具结果缺少对应的调用');
      return {role:'tool', tool_call_id:previousCall, content:message.content};
    }
    return message;
  });
}
function unsupportedTools(status, text) {
  return [400,404,422].includes(status) && /(?:unknown|unrecognized|unsupported|not supported|not allowed|(?:does|do|can|will)(?:\s+not|n't)\s+support)[^\n]{0,100}\btools\b|\btools\b[^\n]{0,100}(?:unknown|unsupported|not supported|not allowed)/i.test(text);
}
module.exports = {modernMessages, unsupportedTools};
