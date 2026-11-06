// index.js
// Express入口：挂载静态文件与各业务路由，启动服务。

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { createAccessControl } = require('./security/access');
const access = createAccessControl();

require('./db'); // 确保启动时数据库/表已初始化

const chatRoutes = require('./routes/chat');
const messagesRoutes = require('./routes/messages');
const personaRoutes = require('./routes/persona');
const settingsRoutes = require('./routes/settings');
const configRoutes = require('./routes/config');
const uploadRoutes = require('./routes/upload');
const ttsRoutes = require('./routes/tts');
const socialRoutes = require('./routes/social');
const mcpRoutes = require('./routes/mcp');
const bookshelfConfigRoutes = require('./routes/bookshelfConfig');
const sttRoutes = require('./routes/stt');
const { router: proactiveRoutes, onSettingsChanged } = require('./routes/proactive');
const pushRoutes = require('./routes/push');
const proactiveScheduler = require('./modules/proactive/scheduler');
const homeModeRoutes = require('./routes/homeMode');
const stickersRoutes = require('./routes/stickers');
const moduleRegistry = require('./moduleRegistry');
const { initWebSocket } = require('./websocket');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(access.middleware);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use(express.json({ limit: '2mb' }));

// 静态资源：前端页面 + 上传的图片
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/audio', express.static(path.join(__dirname, '..', 'audio')));

// 业务路由
app.use('/api/chat', chatRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/persona', personaRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/bookshelf-config', bookshelfConfigRoutes);
app.use('/api/stt', sttRoutes);
app.use('/api/proactive', proactiveRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/home-mode', homeModeRoutes);
app.use('/api/stickers', stickersRoutes);

// 主动消息：设置变更时重载调度器
onSettingsChanged(() => proactiveScheduler.reload());

// 附加功能模块（纪念日/日历/记账本/相册/专属计划/天气提醒/朋友圈……）统一在这里挂载，
// 新增模块只需要改 moduleRegistry.js，不需要改这个文件。
moduleRegistry.mountRoutes(app);
if (process.env.CYBERSEA_DISABLE_SCHEDULERS !== '1') {
  moduleRegistry.startSchedulers();
  proactiveScheduler.startScheduler();
}

// 统一错误处理（比如multer的文件大小/类型错误）
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 400).json({ error: err.status || err.name === 'MulterError' ? err.message : '请求处理出错', code:err.code });
});

// 创建 HTTP server 并挂载 WebSocket
const server = http.createServer(app);
initWebSocket(server, access.authorizeUpgrade);

server.listen(PORT, HOST, () => {
  console.log(`[启动成功] 服务已运行: http://${HOST}:${server.address().port}`);
});
