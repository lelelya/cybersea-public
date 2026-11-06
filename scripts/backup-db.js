require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { backupDatabase } = require('../server/database/migrate');
const dataDir = process.env.CYBERSEA_DATA_DIR || path.join(__dirname, '..', 'data');
const source = path.join(dataDir, 'app.db');
if (!fs.existsSync(source)) throw new Error('数据库不存在，未创建空数据库');
const db = new DatabaseSync(source, { readOnly: true });
try { console.log(backupDatabase(db, path.join(dataDir, 'backups'))); } finally { db.close(); }
