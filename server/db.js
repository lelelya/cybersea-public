// db.js
// 负责SQLite初始化与表结构。所有其他模块通过这里导出的 db 实例读写数据。
//
// 使用 Node.js 内置的 node:sqlite 模块（Node 22.5+ 自带），
// 避免 better-sqlite3 在部分环境（如未安装C++编译工具的Windows）上原生编译失败的问题。

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.CYBERSEA_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const rawDb = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
rawDb.exec('PRAGMA journal_mode = WAL;');

try {
  require('./database/migrate').migrate(rawDb, path.join(DATA_DIR, 'backups'));
} catch (error) {
  rawDb.close();
  throw error;
}

// 薄封装：把 node:sqlite 的 API 抹平成和 better-sqlite3 一致的 db.prepare(sql).get/all/run(...) 用法，
// 这样路由层代码不用关心底层用的是哪个SQLite驱动。
// 同时把 node:sqlite 返回的 [Object: null prototype] 行转换成普通对象，方便 JSON.stringify 等操作。
function toPlainObject(row) {
  return row ? { ...row } : row;
}

function wrapStatement(stmt) {
  return {
    run: (...args) => stmt.run(...args),
    get: (...args) => toPlainObject(stmt.get(...args)),
    all: (...args) => stmt.all(...args).map(toPlainObject),
  };
}

let transactionDepth = 0;
const db = {
  close: () => rawDb.close(),
  prepare: (sql) => wrapStatement(rawDb.prepare(sql)),
  exec: (sql) => rawDb.exec(sql),
  transaction: (fn) => {
    return (items) => {
      const level = transactionDepth++;
      const savepoint = `app_tx_${level}`;
      rawDb.exec(level ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try {
        const result = fn(items);
        if (result && typeof result.then === 'function') throw new Error('数据库事务不能包含异步操作');
        rawDb.exec(level ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (err) {
        rawDb.exec(level ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
        if (level) rawDb.exec(`RELEASE ${savepoint}`);
        throw err;
      } finally {
        transactionDepth--;
      }
    };
  },
};


module.exports = db;
