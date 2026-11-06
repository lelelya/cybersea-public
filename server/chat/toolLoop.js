const { chatCompletion } = require('../llmClient');
const functionCalling = require('../modules/functionCalling');
const mcpClient = require('../mcpClient');
const MAX_FUNCTION_TURNS = 8;

async function runToolLoop(apiMessages, mcpTools = [], dependencies = {}) {
  const complete = dependencies.chatCompletion || chatCompletion;
  const tools = dependencies.functionCalling || functionCalling;
  const mcp = dependencies.mcpClient || mcpClient;
  // 3. Function calling 循环
  const localFunctions = tools.getDefinitions();
  const functions = [...localFunctions, ...mcpTools];
  const writeCalls = []; // 收集本次对话中的写入操作
  const economyMessages = []; // 收集AI触发的经济消息（红包/礼物/外卖气泡）
  let aiReply = '';
  let turnCount = 0;
  const toolCalls = [];
  let letterWriteTriggered = false; // 检测到写信工具调用后，后续请求用4096
  const skippedToolCalls = [];

  while (turnCount < MAX_FUNCTION_TURNS) {
    // 默认使用用户设置的 max_tokens；一旦本轮实际触发了写信工具，
    // 后续轮次固定用4096确保回复完整
    const chatOpts = letterWriteTriggered ? { maxTokensOverride: 4096 } : {};
    const settings = dependencies.memorySettings || require('../modules/memoryBank/service').getMemoryService().settings();
    const fitted = require('../modules/memoryBank/context').fitToolMessages(apiMessages, functions, {hardWindow:settings.context_window_tokens,outputReserve:chatOpts.maxTokensOverride||4096,resultBudget:settings.tool_result_budget_tokens});
    const result = await complete(fitted, functions, chatOpts);

    const requestedCalls = result.tool_calls?.length ? result.tool_calls.map(call => call.function) : result.function_call ? [result.function_call] : [];
    if (requestedCalls.length) {
      for (const fc of requestedCalls) {
        if (turnCount >= MAX_FUNCTION_TURNS) {
          skippedToolCalls.push(fc.name);
          apiMessages.push({role:'assistant',content:null,function_call:{name:fc.name,arguments:fc.arguments}});
          apiMessages.push({role:'function',name:fc.name,content:JSON.stringify({error:'工具调用达到本轮上限，此操作未执行'})});
          continue;
        }
        // AI 要调用函数
        toolCalls.push(fc.name);

        // 检测到实际写信/回信调用 → 后续轮次使用4096
        if (fc.name === 'write_letter' || fc.name === 'reply_letter') {
          letterWriteTriggered = true;
        }

        // 判断是 MCP 工具还是本地工具
        let fnResult;
        if (fc.name.startsWith('mcp_')) {
          try {
            fnResult = await mcp.callTool(fc.name, fc.arguments);
          } catch (err) {
            fnResult = { error: err.message, is_write: false, fn_name: fc.name };
          }
        } else {
          fnResult = await tools.execute(fc.name, fc.arguments, {...dependencies.executionContext,iteration:turnCount});
        }

        // 收集本轮已确认的写入操作
        if (fnResult.is_write && !fnResult.error && !fnResult.result?.error && fnResult.result?.success !== false) {
          writeCalls.push({
            fn_name: fnResult.fn_name,
            fn_args: fnResult.fn_args,
            result: fnResult.result,
          });
        }

        // 收集AI触发的经济消息（红包/礼物/外卖气泡）
        if (fnResult.result && fnResult.result.economy_message) {
          economyMessages.push(fnResult.result.economy_message);
        }

        // 将函数调用和结果追加到消息历史
        apiMessages.push({
          role: 'assistant',
          content: null,
          function_call: { name: fc.name, arguments: fc.arguments },
        });
        apiMessages.push({
          role: 'function',
          name: fc.name,
          content: JSON.stringify(fnResult.result || fnResult.error || '完成'),
        });

        turnCount++;
      }
      continue;
    }

    // AI 返回了普通文本
    if (result.content) {
      aiReply = result.content;
      break;
    }

    // 既无 function_call 也无 content（不应出现）
    break;
  }

  if (!aiReply && turnCount >= MAX_FUNCTION_TURNS) {
    apiMessages.push({role:'system',content:'本轮工具调用预算已用完。请仅根据已有结果简短总结，明确说明未执行的操作，不再调用工具。'});
    try {
      const final = await complete(apiMessages, [], {});
      aiReply = final.content || '';
    } catch (_) { /* Already executed actions must remain visible to the user. */ }
    if (!aiReply) aiReply = `本轮已执行 ${turnCount} 次工具调用，达到上限。${skippedToolCalls.length ? '剩余 '+skippedToolCalls.length+' 项操作未执行，请核对后另行处理。' : '请核对已执行的操作结果，再继续对话。'}`;
  }
  if (!aiReply) {
    aiReply = '（我暂时无法回应，请稍后再试）';
  }


  return { aiReply, toolCalls, writeCalls, economyMessages, warnings:turnCount>=MAX_FUNCTION_TURNS?[{code:'TOOL_LIMIT_REACHED',skipped:skippedToolCalls}]:[] };
}
module.exports = { runToolLoop };
