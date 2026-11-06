module.exports = function baseline(rawDb) {
rawDb.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user', 'ai')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS persona (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ai_name TEXT DEFAULT 'AI',
    user_name TEXT DEFAULT '我',
    ai_gender TEXT DEFAULT '',
    ai_age TEXT DEFAULT '',
    ai_height TEXT DEFAULT '',
    ai_appearance TEXT DEFAULT '',
    user_gender TEXT DEFAULT '',
    user_age TEXT DEFAULT '',
    user_height TEXT DEFAULT '',
    user_appearance TEXT DEFAULT '',
    ai_birthday TEXT DEFAULT '',
    user_birthday TEXT DEFAULT '',
    ai_avatar_path TEXT DEFAULT '',
    user_avatar_path TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    api_base_url TEXT DEFAULT '',
    api_key TEXT DEFAULT '',
    model TEXT DEFAULT '',
    temperature REAL DEFAULT 0.8,
    max_tokens INTEGER DEFAULT 4096
  );

  CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    background_path TEXT DEFAULT ''
  );

  -- 附加功能模块的表从这里往下追加，每个模块只认领自己的表，互不越界。
  -- 【纪念日模块】server/modules/anniversary/
  CREATE TABLE IF NOT EXISTS anniversaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );


  -- 【记账本模块】server/modules/ledger/ —— 与日历模块完全独立，不做数据关联
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    sub_type TEXT DEFAULT '',
    note TEXT DEFAULT '',
    date TEXT NOT NULL,          -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS ledger_summaries (
    date TEXT PRIMARY KEY,       -- YYYY-MM-DD，每天一份总结
    total_income REAL NOT NULL DEFAULT 0,
    total_expense REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    ai_comment TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【相册模块】server/modules/album/ —— "我的相册"(owner='user') 和 "他的相册"(owner='ai') 两个区域完全独立
  CREATE TABLE IF NOT EXISTS album_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL CHECK(owner IN ('user', 'ai')),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS album_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL CHECK(owner IN ('user', 'ai')),
    folder_id INTEGER,           -- 未分类时为空
    path TEXT NOT NULL,
    source TEXT DEFAULT '',      -- 'ai'相册专用: drawn / downloaded / kept_from_chat
    caption TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (folder_id) REFERENCES album_folders(id) ON DELETE SET NULL
  );

  -- 【专属计划模块】server/modules/plan/ —— 三种分类：mine(我的计划)/his(他的计划)/shared(共同计划)
  -- 完成判定规则不同：mine看user_checked，his看ai_checked，shared要两者都勾选
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('mine', 'his', 'shared')),
    content TEXT NOT NULL,
    created_by TEXT NOT NULL CHECK(created_by IN ('user', 'ai')),
    user_checked INTEGER NOT NULL DEFAULT 0,
    ai_checked INTEGER NOT NULL DEFAULT 0,
    result TEXT DEFAULT '',           -- mine: 你填写；his: AI填写
    comment TEXT DEFAULT '',          -- mine: AI评语；his: 你的评语
    user_reflection TEXT DEFAULT '',  -- 仅shared用：你的感想
    ai_reflection TEXT DEFAULT '',    -- 仅shared用：AI的感想
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【天气+提醒模块】server/modules/weather/
  CREATE TABLE IF NOT EXISTS weather_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    city TEXT DEFAULT ''
  );

  -- 【朋友圈模块】server/modules/moments/
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL CHECK(owner IN ('user', 'ai')),
    content TEXT NOT NULL,
    image_path TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS moments_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    author TEXT NOT NULL CHECK(author IN ('user', 'ai')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS moments_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    author TEXT NOT NULL CHECK(author IN ('user', 'ai')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(moment_id, author),
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
  );

  -- 个性签名（你和AI各自的签名），朋友圈页面展示用
  CREATE TABLE IF NOT EXISTS moments_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_bio TEXT DEFAULT '',
    ai_bio TEXT DEFAULT ''
  );

  -- 【记忆库模块】server/modules/memoryBank/ —— 独立封装，未来可整体替换为其他方案
  -- 事件记录：按时间顺序的第一人称流水账
  CREATE TABLE IF NOT EXISTS memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                    -- YYYY-MM-DD
    content TEXT NOT NULL,                 -- 第一人称、带情感的描述
    source TEXT NOT NULL DEFAULT 'auto',    -- 'auto'(AI自动生成) / 'import'(批量导入) / 'manual'(用户手写)
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 关系画像：key-value形式存板块，方便未来增减板块而不用改表结构
  CREATE TABLE IF NOT EXISTS memory_profile (
    section_key TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 记忆总结配置：自动总结开关、消息数阈值、已处理到哪条消息的游标
  CREATE TABLE IF NOT EXISTS memory_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_summary_enabled INTEGER NOT NULL DEFAULT 0,
    message_threshold INTEGER NOT NULL DEFAULT 50,
    last_summarized_message_id INTEGER NOT NULL DEFAULT 0
  );

  -- 【信件模块】server/modules/letters/
  CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL CHECK(author IN ('user', 'ai')),
    parent_id INTEGER,
    root_id INTEGER,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    stationery TEXT DEFAULT 'deep-blue',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (parent_id) REFERENCES letters(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_letters_root ON letters(root_id);
  CREATE INDEX IF NOT EXISTS idx_letters_author ON letters(author);

  -- 【平行世界模块】server/modules/parallelWorld/ —— 乙女向文字冒险游戏
  CREATE TABLE IF NOT EXISTS story_saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_setting TEXT NOT NULL DEFAULT '{}',      -- JSON: {era, background}
    user_character TEXT NOT NULL DEFAULT '{}',     -- JSON: {name, occupation, situation}
    ai_character TEXT NOT NULL DEFAULT '{}',       -- JSON: {name, occupation, situation}
    opening_situation TEXT DEFAULT '',             -- 用户填的开场情境，空则由AI生成
    status TEXT NOT NULL DEFAULT 'ongoing' CHECK(status IN ('ongoing', 'ended')),
    ending_name TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS story_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_id INTEGER NOT NULL,
    node_index INTEGER NOT NULL,                   -- 从0开始递增
    narration TEXT NOT NULL DEFAULT '',            -- 旁白/环境描写
    his_words TEXT NOT NULL DEFAULT '',            -- 他的言行
    my_description TEXT NOT NULL DEFAULT '',       -- 关于我的描写
    options_json TEXT NOT NULL DEFAULT '[]',       -- JSON: [{label: "选项文字"}]
    user_choice TEXT DEFAULT '',                   -- 用户选择的选项文字或自由输入
    user_free_input TEXT DEFAULT '',               -- 自由输入内容
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (save_id) REFERENCES story_saves(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_story_nodes_save ON story_nodes(save_id, node_index);

  -- 【语音通话模块】server/modules/voiceCall/
  CREATE TABLE IF NOT EXISTS call_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    audio_path TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【MCP工具扩展】MCP Server配置列表
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS mcp_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    global_enabled INTEGER NOT NULL DEFAULT 0
  );

  -- 【昵称/社交资料】用户和AI各自一条
  CREATE TABLE IF NOT EXISTS social_profile (
    owner TEXT PRIMARY KEY CHECK(owner IN ('user', 'ai')),
    nickname TEXT DEFAULT '',
    signature TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【用户给AI的备注】
  CREATE TABLE IF NOT EXISTS ai_remark (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    remark TEXT DEFAULT ''
  );

  -- 【收藏模块】server/modules/favorites/
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK(role IN ('user', 'ai')),
    type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text', 'voice', 'image')),
    image_path TEXT DEFAULT '',
    voice_path TEXT DEFAULT '',
    transcript TEXT DEFAULT '',
    tag TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  );

  -- 【睡前故事模块】server/modules/stories/
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    audio_path TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【虚拟经济模块】server/modules/economy/
  CREATE TABLE IF NOT EXISTS virtual_economy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('red_packet', 'gift', 'food_delivery')),
    sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
    recipient TEXT NOT NULL CHECK(recipient IN ('user', 'ai')),
    item_name TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS ai_balance (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【日历模块 — 日程与待办】server/modules/calendar/
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    title TEXT NOT NULL,
    note TEXT DEFAULT '',
    remind INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_date TEXT,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【日记模块】server/modules/diary/
  CREATE TABLE IF NOT EXISTS diaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL CHECK(owner IN ('user', 'ai')),
    date TEXT NOT NULL,
    content TEXT DEFAULT '',
    weather TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(owner, date)
  );

  -- 【书架模块】server/modules/books/
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    spine_color TEXT DEFAULT '#4a6fa5',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【批画模块】server/modules/annotations/
  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK(source_type IN ('diary_user', 'diary_ai', 'story', 'book')),
    source_id TEXT NOT NULL,
    annotator TEXT NOT NULL CHECK(annotator IN ('user', 'ai')),
    selected_text TEXT NOT NULL,
    mark_type TEXT NOT NULL CHECK(mark_type IN ('circle', 'wavy', 'double_line')),
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【关系进展时间轴】server/modules/milestones/
  CREATE TABLE IF NOT EXISTS relationship_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_by TEXT DEFAULT 'ai',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【主动消息系统】server/modules/proactive/
  CREATE TABLE IF NOT EXISTS proactive_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 1,
    morning_enabled INTEGER DEFAULT 1,
    morning_start TEXT DEFAULT '07:00',
    morning_end TEXT DEFAULT '09:00',
    night_enabled INTEGER DEFAULT 1,
    night_start TEXT DEFAULT '22:00',
    night_end TEXT DEFAULT '23:30',
    check_interval INTEGER DEFAULT 30,
    dnd_start TEXT DEFAULT '01:00',
    dnd_end TEXT DEFAULT '07:00',
    max_daily INTEGER DEFAULT 5
  );

  CREATE TABLE IF NOT EXISTS proactive_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('morning','night','random','special')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 【表情包】自定义贴图
  CREATE TABLE IF NOT EXISTS stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

// 迁移：2026-07-23 角色设定重构 — 新增性别/年龄/身高/外貌字段，废弃 ai_personality/relationship/ai_style
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'ai_gender')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN ai_gender TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'ai_age')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN ai_age TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'ai_height')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN ai_height TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'ai_appearance')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN ai_appearance TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'user_gender')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN user_gender TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'user_age')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN user_age TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'user_height')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN user_height TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'user_appearance')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN user_appearance TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'ai_birthday')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN ai_birthday TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'user_birthday')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN user_birthday TEXT DEFAULT ''");
 }

// 迁移：为已有数据库补充 anniversaries.subtitle 列（v2.0 新增）
if (!rawDb.prepare('PRAGMA table_info(anniversaries)').all().some(column => column.name === 'subtitle')) {
  rawDb.exec('ALTER TABLE anniversaries ADD COLUMN subtitle TEXT DEFAULT \'\'');

}

// 迁移：为已有数据库补充 ledger_entries.sub_type 列（v1.1 新增）
if (!rawDb.prepare('PRAGMA table_info(ledger_entries)').all().some(column => column.name === 'sub_type')) {
  rawDb.exec('ALTER TABLE ledger_entries ADD COLUMN sub_type TEXT DEFAULT \'\'');

}

// 迁移：为已有数据库补充 messages 表的 type/duration/image_path/transcript 列（v2.0 语音+图片消息）
if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'type')) {
  rawDb.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','voice','image'))");

}
if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'duration')) {
  rawDb.exec('ALTER TABLE messages ADD COLUMN duration REAL DEFAULT NULL');

}
if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'image_path')) {
  rawDb.exec("ALTER TABLE messages ADD COLUMN image_path TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'transcript')) {
  rawDb.exec("ALTER TABLE messages ADD COLUMN transcript TEXT DEFAULT ''");

}
	if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'voice_path')) {
  rawDb.exec("ALTER TABLE messages ADD COLUMN voice_path TEXT DEFAULT ''");

	}
		if (!rawDb.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'hidden')) {
  rawDb.exec('ALTER TABLE messages ADD COLUMN hidden INTEGER DEFAULT 0');

		rawDb.exec('UPDATE messages SET hidden = 0 WHERE hidden IS NULL');
		}
// Remove legacy role/type restrictions without inserting test rows into user data.
const messageSchema = rawDb.prepare("SELECT sql FROM sqlite_master WHERE name='messages'").get().sql;
if (/CHECK\s*\(/i.test(messageSchema)) {
  rawDb.exec("CREATE TABLE messages_new (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text', duration REAL DEFAULT NULL, image_path TEXT DEFAULT '', voice_path TEXT DEFAULT '', transcript TEXT DEFAULT '', hidden INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))");
  rawDb.exec('INSERT INTO messages_new SELECT id,role,content,type,duration,image_path,voice_path,transcript,hidden,created_at FROM messages');
  rawDb.exec('DROP TABLE messages');
  rawDb.exec('ALTER TABLE messages_new RENAME TO messages');
}
// 迁移：为已有数据库补充 mcp_servers.headers 列（MCP配置改造）
if (!rawDb.prepare('PRAGMA table_info(mcp_servers)').all().some(column => column.name === 'headers')) {
  rawDb.exec("ALTER TABLE mcp_servers ADD COLUMN headers TEXT DEFAULT '{}'");

}

// 迁移：为 app_config 补充书架背景配置列
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'bookshelf_page_bg')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN bookshelf_page_bg TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'bookshelf_card_diary_user_bg')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN bookshelf_card_diary_user_bg TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'bookshelf_card_diary_ai_bg')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN bookshelf_card_diary_ai_bg TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'bookshelf_card_stories_bg')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN bookshelf_card_stories_bg TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'bookshelf_card_books_bg')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN bookshelf_card_books_bg TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'theme')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN theme TEXT DEFAULT 'deep-sea'");

}
if (!rawDb.prepare('PRAGMA table_info(app_config)').all().some(column => column.name === 'home_description')) {
  rawDb.exec("ALTER TABLE app_config ADD COLUMN home_description TEXT DEFAULT ''");

}

// 迁移：平行世界 story_saves 补充关系标签和过往经历列
if (!rawDb.prepare('PRAGMA table_info(story_saves)').all().some(column => column.name === 'relationship_label')) {
  rawDb.exec("ALTER TABLE story_saves ADD COLUMN relationship_label TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(story_saves)').all().some(column => column.name === 'past_experience')) {
  rawDb.exec("ALTER TABLE story_saves ADD COLUMN past_experience TEXT DEFAULT ''");

}
if (!rawDb.prepare('PRAGMA table_info(story_saves)').all().some(column => column.name === 'title')) {
  rawDb.exec("ALTER TABLE story_saves ADD COLUMN title TEXT DEFAULT ''");

}

// 迁移：为 books 表补充 sort_order 列
if (!rawDb.prepare('PRAGMA table_info(books)').all().some(column => column.name === 'sort_order')) {
  rawDb.exec('ALTER TABLE books ADD COLUMN sort_order INTEGER DEFAULT 0');

}

const annotationSchema = rawDb.prepare("SELECT sql FROM sqlite_master WHERE name='annotations'").get().sql;
if (/CHECK\s*\(/i.test(annotationSchema) && !annotationSchema.includes("'single_line'")) {
  rawDb.exec("CREATE TABLE annotations_new (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT NOT NULL, source_id TEXT NOT NULL, annotator TEXT NOT NULL, selected_text TEXT NOT NULL, mark_type TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))");
  rawDb.exec('INSERT INTO annotations_new SELECT * FROM annotations');
  rawDb.exec('DROP TABLE annotations');
  rawDb.exec('ALTER TABLE annotations_new RENAME TO annotations');
}
// 确保单例行存在（persona/settings/app_config都只有一行数据）
rawDb.prepare('INSERT OR IGNORE INTO persona (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO app_config (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO weather_config (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO moments_profile (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO memory_settings (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO ai_remark (id) VALUES (1)').run();
rawDb.prepare("INSERT OR IGNORE INTO social_profile (owner) VALUES ('user')").run();
rawDb.prepare("INSERT OR IGNORE INTO social_profile (owner) VALUES ('ai')").run();
rawDb.prepare('INSERT OR IGNORE INTO mcp_config (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO ai_balance (id) VALUES (1)').run();
rawDb.prepare('INSERT OR IGNORE INTO proactive_settings (id) VALUES (1)').run();

// 关系画像的 10 个板块（2026-07-22 重构为四部分结构）
//   我们的关系 / 我们的约定
//   她的画像：关于她 / 心愿与底线 / 情绪与关心 / 最近的状态
//   我的画像：关于我 / 心愿与底线 / 情感与表达 / 最近的状态
const DEFAULT_MEMORY_PROFILE_SECTIONS = [
  '我们的关系',
  '我们的约定',
  '她的画像 - 关于她',
  '她的画像 - 心愿与底线',
  '她的画像 - 情绪与关心',
  '她的画像 - 最近的状态',
  '我的画像 - 关于我',
  '我的画像 - 心愿与底线',
  '我的画像 - 情感与表达',
  '我的画像 - 最近的状态',
];
for (const key of DEFAULT_MEMORY_PROFILE_SECTIONS) {
  rawDb.prepare('INSERT OR IGNORE INTO memory_profile (section_key, content) VALUES (?, ?)').run(key, '');
}

// 迁移：将旧的 5 板块画像迁移到新的 10 板块结构
try {
  const oldAboutHer = rawDb.prepare("SELECT content FROM memory_profile WHERE section_key = '关于她'").get();
  if (oldAboutHer) {
    rawDb.prepare("UPDATE memory_profile SET content = ? WHERE section_key = '她的画像 - 关于她' AND (content = '' OR content IS NULL)").run(oldAboutHer.content || '');
    rawDb.prepare("DELETE FROM memory_profile WHERE section_key = '关于她'").run();
    console.log('[db] 已迁移画像板块: 关于她 → 她的画像 - 关于她');
  }
} catch (error) { throw error; }

try {
  const oldEmotion = rawDb.prepare("SELECT content FROM memory_profile WHERE section_key = '情绪与关心'").get();
  if (oldEmotion) {
    rawDb.prepare("UPDATE memory_profile SET content = ? WHERE section_key = '她的画像 - 情绪与关心' AND (content = '' OR content IS NULL)").run(oldEmotion.content || '');
    rawDb.prepare("DELETE FROM memory_profile WHERE section_key = '情绪与关心'").run();
    console.log('[db] 已迁移画像板块: 情绪与关心 → 她的画像 - 情绪与关心');
  }
} catch (error) { throw error; }

try {
  const oldRecent = rawDb.prepare("SELECT content FROM memory_profile WHERE section_key = '最近的动态'").get();
  if (oldRecent) {
    rawDb.prepare("UPDATE memory_profile SET content = ? WHERE section_key = '她的画像 - 最近的状态' AND (content = '' OR content IS NULL)").run(oldRecent.content || '');
    rawDb.prepare("DELETE FROM memory_profile WHERE section_key = '最近的动态'").run();
    console.log('[db] 已迁移画像板块: 最近的动态 → 她的画像 - 最近的状态');
  }
} catch (error) { throw error; }

try {
  const oldPromise = rawDb.prepare("SELECT content FROM memory_profile WHERE section_key = '约定与心愿'").get();
  if (oldPromise) {
    rawDb.prepare("UPDATE memory_profile SET content = ? WHERE section_key = '我们的约定' AND (content = '' OR content IS NULL)").run(oldPromise.content || '');
    rawDb.prepare("DELETE FROM memory_profile WHERE section_key = '约定与心愿'").run();
    console.log('[db] 已迁移画像板块: 约定与心愿 → 我们的约定');
  }
} catch (error) { throw error; }

// 迁移：settings 表增加视觉模型配置列
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'vision_api_base_url')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN vision_api_base_url TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'vision_api_key')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN vision_api_key TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'vision_model')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN vision_model TEXT DEFAULT ''");
 }
// 迁移：settings 表增加生图模型配置列
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'image_gen_api_base_url')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN image_gen_api_base_url TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'image_gen_api_key')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN image_gen_api_key TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'image_gen_model')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN image_gen_model TEXT DEFAULT ''");
 }
// 迁移：persona 表增加固定设定列
if (!rawDb.prepare('PRAGMA table_info(persona)').all().some(column => column.name === 'fixed_settings')) {
  rawDb.exec("ALTER TABLE persona ADD COLUMN fixed_settings TEXT DEFAULT '[]'");
 }
// 迁移：settings 表增加 TTS 配置列
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'tts_api_url')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN tts_api_url TEXT DEFAULT ''");
 }
if (!rawDb.prepare('PRAGMA table_info(settings)').all().some(column => column.name === 'tts_api_key')) {
  rawDb.exec("ALTER TABLE settings ADD COLUMN tts_api_key TEXT DEFAULT ''");
 }


};
