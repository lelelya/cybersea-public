const crypto = require('node:crypto');

function createAccessControl(env = process.env) {
  const username = env.CYBERSEA_AUTH_USER || '';
  const password = env.CYBERSEA_AUTH_PASSWORD || '';
  if (Boolean(username) !== Boolean(password)) throw new Error('请同时配置 CYBERSEA_AUTH_USER 和 CYBERSEA_AUTH_PASSWORD');
  const enabled = Boolean(username && password);
  function authorized(request) {
    if (!enabled) return true;
    const header = request.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    const actual = Buffer.from(header.slice(6), 'base64');
    const expected = Buffer.from(`${username}:${password}`);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  function middleware(req, res, next) {
    if (!authorized(req)) {
      res.set('WWW-Authenticate', 'Basic realm="CyberSea", charset="UTF-8"');
      return res.status(401).send('请登录 CyberSea');
    }
    // Browser requests that carry an Origin must originate from this same host.
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).send('不允许跨站请求');
      } catch { return res.status(403).send('无效的 Origin'); }
    }
    next();
  }
  function authorizeUpgrade(req) {
    if (!authorized(req)) return false;
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  }
  return { enabled, middleware, authorizeUpgrade };
}
module.exports = { createAccessControl };
