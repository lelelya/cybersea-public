module.exports = function up(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(persona)').all().map(c => c.name));
  for (const owner of ['ai', 'user']) {
    const column = owner + '_portrait_path';
    if (!columns.has(column)) db.exec(`ALTER TABLE persona ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
};
