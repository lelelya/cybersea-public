const fs = require('node:fs');
const path = require('node:path');

function backupDatabase(db, directory, label = 'manual') {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}-${require('node:crypto').randomBytes(3).toString('hex')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function migrate(db, backupDirectory, migrations = [{ version: 1, name: 'baseline', up: require('./migrations/001-baseline') }, { version: 2, name: 'memory-v2', up: require('./migrations/002-memory-v2') }, { version: 3, name: 'persona-portraits', up: require('./migrations/003-persona-portraits') }]) {
  const hasVersion = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  const applied = new Set(hasVersion ? db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version) : []);
  const pending = migrations.filter(m => !applied.has(m.version));
  if (!pending.length) return;
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (existing.length && backupDirectory) backupDatabase(db, backupDirectory, 'before-migration');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const migration of pending) {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
module.exports = { migrate, backupDatabase };
