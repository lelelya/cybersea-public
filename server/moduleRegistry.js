// server/moduleRegistry.js
//
// 附加功能模块的统一注册中心。
// 每个附加功能模块（纪念日、日历、记账本、相册、专属计划、天气提醒、朋友圈……）
// 都是 server/modules/<模块名>/ 下的独立文件夹，对外只暴露 { router, getContextSnippet }。
//
// 新增一个模块时，只需要在下面的 modules 数组里加一行 —— 不需要改动
// server/index.js、server/routes/chat.js 或任何其他现有模块的代码。
//
// 职责边界：这里只负责"附加功能模块"的路由挂载 + AI可见的上下文片段收集，
// 和 memory.js（负责聊天历史上下文）是两件独立的事，互不耦合。

const anniversary = require('./modules/anniversary');
const calendar = require('./modules/calendar');
const ledger = require('./modules/ledger');
const album = require('./modules/album');
const plan = require('./modules/plan');
const weather = require('./modules/weather');
const moments = require('./modules/moments');
const memoryBank = require('./modules/memoryBank');
const letters = require('./modules/letters');
const parallelWorld = require('./modules/parallelWorld');
const voiceCall = require('./modules/voiceCall');
const favorites = require('./modules/favorites');
const stories = require('./modules/stories');
const economy = require('./modules/economy');
const diary = require('./modules/diary');
const books = require('./modules/books');
const annotations = require('./modules/annotations');
const milestones = require('./modules/milestones');

const modules = [
  { mountPath: '/api/anniversary', mod: anniversary },
  { mountPath: '/api/calendar', mod: calendar },
  { mountPath: '/api/ledger', mod: ledger },
  { mountPath: '/api/album', mod: album },
  { mountPath: '/api/plan', mod: plan },
  { mountPath: '/api/weather', mod: weather },
  { mountPath: '/api/moments', mod: moments },
  { mountPath: '/api/memoryBank', mod: memoryBank },
  { mountPath: '/api/letters', mod: letters },
  { mountPath: '/api/parallel-world', mod: parallelWorld },
  { mountPath: '/api/voice-call', mod: voiceCall },
  { mountPath: '/api/favorites', mod: favorites },
  { mountPath: '/api/stories', mod: stories },
  { mountPath: '/api/economy', mod: economy },
  { mountPath: '/api/diary', mod: diary },
  { mountPath: '/api/books', mod: books },
  { mountPath: '/api/annotations', mod: annotations },
  { mountPath: '/api/milestones', mod: milestones },
  // 未来在这里继续追加
];

function mountRoutes(app) {
  modules.forEach(({ mountPath, mod }) => app.use(mountPath, mod.router));
}

/**
 * 启动所有模块各自的后台定时任务（如果该模块定义了 startScheduler）。
 * 不是每个模块都需要定时任务，没有的模块直接跳过。
 */
function startSchedulers() {
  modules.forEach(({ mod }) => {
    if (typeof mod.startScheduler === 'function') {
      mod.startScheduler();
    }
  });
}

/**
 * 汇总所有模块的"AI应该知道的当前状态"文字片段，供拼进system prompt。
 * 单个模块出错不应影响其他模块或聊天核心功能，这里做了容错隔离。
 */
function getAllContextSnippets({ exclude = [] } = {}) {
  return modules
    .filter(({mountPath}) => !exclude.includes(mountPath))
    .map(({ mod }) => {
      try {
        return mod.getContextSnippet();
      } catch (err) {
        console.error('[moduleRegistry] 获取模块上下文片段失败:', err);
        return null;
      }
    })
    .filter((s) => s && s.trim());
}

/**
 * 每次聊天往来（用户发消息、AI回复完成）后调用一次，通知所有定义了 onChatExchange 的模块。
 * 这是给"依附聊天场景触发"的模块用的钩子（比如朋友圈：概率发动态），
 * chat.js 只需要调用这一个通用方法，不需要知道具体是哪些模块在监听。
 * 不等待处理完成（fire-and-forget），避免朋友圈生成动态拖慢聊天响应速度；
 * 单个模块出错不影响聊天主流程或其他模块。
 */
function notifyChatExchange(userMessage) {
  modules.forEach(({ mod }) => {
    if (typeof mod.onChatExchange === 'function') {
      Promise.resolve(mod.onChatExchange(userMessage)).catch((err) => {
        console.error('[moduleRegistry] onChatExchange 处理失败:', err);
      });
    }
  });
}

module.exports = { mountRoutes, startSchedulers, getAllContextSnippets, notifyChatExchange };
