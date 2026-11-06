const db = require('../../db');
module.exports = function registerTools(register) {
register({
  name: 'query_album_photos',
  description: '查询相册中最近的照片。',
  parameters: {
    type: 'object',
    properties: {
      owner: { type: 'string', enum: ['user', 'ai'], description: 'user=我的相册, ai=他的相册, 不传=全部' },
      recent_count: { type: 'number', description: '最近N张，默认10' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    const limit = Math.min(args.recent_count || 10, 30);
    const SOURCE_LABELS = { drawn: 'AI画的', downloaded: '从网上下载的', kept_from_chat: '从聊天保留的' };
    let rows;
    if (args.owner) {
      rows = db.prepare('SELECT id, owner, caption, source, created_at FROM album_photos WHERE owner = ? ORDER BY created_at DESC LIMIT ?').all(args.owner, limit);
    } else {
      rows = db.prepare('SELECT id, owner, caption, source, created_at FROM album_photos ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    return rows.map((r) => ({
      id: r.id,
      owner: r.owner === 'user' ? '你的相册' : 'AI的相册',
      caption: r.caption || '',
      source: SOURCE_LABELS[r.source] || '',
      created_at: r.created_at,
    }));
  },
});

register({
  name: 'save_album_photo',
  description: '保存一张图片到AI的相册。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '图片的URL或本地路径' },
      source: { type: 'string', enum: ['drawn', 'downloaded', 'kept_from_chat'], description: '来源：drawn=AI画的, downloaded=下载的, kept_from_chat=从聊天保留的' },
      caption: { type: 'string', description: '图片说明/标题，可选' },
    },
    required: ['path', 'source'],
  },
  is_write: true,
  handler(args) {
    const result = db.prepare('INSERT INTO album_photos (owner, path, source, caption) VALUES (?, ?, ?, ?)').run('ai', args.path, args.source, args.caption || '');
    const row = db.prepare('SELECT id, owner, path, source, caption, created_at FROM album_photos WHERE id = ?').get(result.lastInsertRowid);
    return { created: row, message: `已保存图片到AI相册（${args.source}）` };
  },
});

register({
  name: 'send_album_photo',
  description: '从相册中查找一张图片并通过聊天发送给用户。按关键词模糊搜索caption，或按ID精确查找。找到后在回复中用 [image]路径|说明[/image] 的格式展示图片。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词，匹配图片说明' },
      photo_id: { type: 'number', description: '按ID精确查找某张图片' },
    },
    required: [],
  },
  is_write: false,
  handler(args) {
    let photo;
    if (args.photo_id) {
      photo = db.prepare('SELECT id, owner, path, caption, source, created_at FROM album_photos WHERE id = ?').get(args.photo_id);
    } else if (args.keyword) {
      const keyword = `%${args.keyword}%`;
      photo = db.prepare('SELECT id, owner, path, caption, source, created_at FROM album_photos WHERE caption LIKE ? OR source LIKE ? ORDER BY created_at DESC LIMIT 1').get(keyword, keyword);
    } else {
      // 没传参数 → 返回最近一张
      photo = db.prepare('SELECT id, owner, path, caption, source, created_at FROM album_photos ORDER BY created_at DESC LIMIT 1').get();
    }
    if (!photo) return { found: false, message: '相册中没有找到图片' };

    return {
      found: true,
      photo: {
        id: photo.id,
        path: photo.path,
        caption: photo.caption || '',
        source: photo.source || '',
        owner: photo.owner === 'user' ? '对方' : '你',
      },
      instruction: `请在你的回复中用以下格式发送这张图片（不要改路径和说明）：
[image]${photo.path}|${photo.caption || '看看这张照片'}[/image]

图片说明（caption）你可以根据对话语境自然地改写，让它更贴合当前的聊天氛围。`,
    };
  },
});

register({
  name: 'generate_image',
  description: '生成一张自拍或图片。系统会自动从「他拍」相册中获取你的形象参考图，让生成的图片保持你的形象一致。生成后自动存入「自拍」相册，并以 [image]路径|说明[/image] 格式发送给用户。prompt请用英文描述场景、姿势、服装、风格等。',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '英文图片描述，例如 selfie of a young man with silver hair, wearing a black coat, by the seaside at sunset, soft lighting, anime style' },
      caption: { type: 'string', description: '图片的中文说明，用于发给用户时展示' },
    },
    required: ['prompt'],
  },
  is_write: true,
  async handler(args) {
    const db = require('../../db');
    const path = require('path');
    const fs = require('fs');

    // 确保「参考」和「自拍」文件夹存在
    for (const fname of ['他拍', '自拍']) {
      const folder = db.prepare("SELECT id FROM album_folders WHERE owner = 'ai' AND name = ?").get(fname);
      if (!folder) {
        db.prepare("INSERT INTO album_folders (owner, name) VALUES ('ai', ?)").run(fname);
      }
    }
    const refFolder = db.prepare("SELECT id FROM album_folders WHERE owner = 'ai' AND name = ?").get('他拍');
    const selfieFolder = db.prepare("SELECT id FROM album_folders WHERE owner = 'ai' AND name = ?").get('自拍');

    // 获取参考图
    const refPhotos = db.prepare(
      "SELECT path FROM album_photos WHERE owner = 'ai' AND folder_id = ?"
    ).all(refFolder.id);

    const uploadsDir = path.join(__dirname, '..', '..', '..', 'uploads');
    const refPaths = refPhotos.map(p => path.join(uploadsDir, p.path.replace(/^\/uploads\//, ''))).filter(p => {
      try { fs.accessSync(p); return true; } catch (_) { return false; }
    });

    const imageGenClient = require('../../imageGenClient');
    const result = await imageGenClient.generateImage(args.prompt, refPaths);
    if (!result) return { success: false, message: '图片生成失败' };

    // 存入「自拍」相册
    const caption = args.caption || args.prompt;
    db.prepare(
      "INSERT INTO album_photos (owner, folder_id, path, caption, source) VALUES ('ai', ?, ?, ?, 'generated')"
    ).run(selfieFolder.id, result.image_path, caption);

    const photo = db.prepare('SELECT id FROM album_photos WHERE path = ?').get(result.image_path);

    return {
      success: true,
      refCount: refPaths.length,
      photo: {
        id: photo.id,
        path: result.image_path,
        caption,
        source: 'generated',
        owner: '你',
      },
      instruction: `请在你的回复中用以下格式发送这张图片：
[image]${result.image_path}|${caption}[/image]`,
    };
  },
});
};
