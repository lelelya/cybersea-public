const PROFILE_KEYS = ['我们的关系', '我们的约定', '她的画像 - 关于她', '她的画像 - 心愿与底线', '她的画像 - 情绪与关心', '她的画像 - 最近的状态', '我的画像 - 关于我', '我的画像 - 心愿与底线', '我的画像 - 情感与表达', '我的画像 - 最近的状态'];
const DEFAULTS = { events_auto_enabled: 0, profile_mode: 'off', tool_memory_enabled: 1, protect_imported: 1, message_threshold: 50, profile_min_interval_minutes: 30, state_review_days: 14, timezone: 'Asia/Shanghai', memory_budget_tokens: 6000, recent_budget_tokens: 8000, tool_result_budget_tokens: 3000, context_window_tokens: null, extraction_input_budget_tokens: 8000, extraction_max_tokens: 4096 };
const TABLES = { profile_item: 'memory_profile_items', event: 'memory_events', milestone: 'relationship_milestones' };
function fail(code, message, status = 400, details) { const e = new Error(message); Object.assign(e, { code, status, details }); throw e; }
const hash = value => require('node:crypto').createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const estimate = value => Math.ceil(Array.from(typeof value === 'string' ? value : JSON.stringify(value)).reduce((n,c) => n + (c.charCodeAt(0) > 127 ? 1.4 : 0.35), 0));
function dateValid(value) { try { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value; } catch { return false; } }
function dateInZone(now, zone) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(now); }
module.exports = { PROFILE_KEYS, DEFAULTS, TABLES, fail, hash, parse, estimate, dateValid, dateInZone };
