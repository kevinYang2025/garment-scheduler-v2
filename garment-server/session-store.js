// [2026-06-18] 用户系统:手写 better-sqlite3 session store
// 复用项目已有的 better-sqlite3,避免引入 connect-sqlite3 的原生 sqlite3 编译
// 接口参考 express-session 的 Store 抽象
// [2026-06-20] 过期时间配置化: env SESSION_EXPIRE_DAYS (默认 7)
const session = require('express-session');

class SqliteStore extends session.Store {
  constructor(db, options = {}) {
    super();
    this.db = db;
    const days = Number(options.expireDays ?? process.env.SESSION_EXPIRE_DAYS ?? 7);
    this.EXPIRE_MS = days * 24 * 60 * 60 * 1000;

    // sessions 表(独立于 business data)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    // 预编译语句
    this.stmtGet = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this.stmtSet = db.prepare(
      'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)'
    );
    this.stmtDestroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.stmtCleanup = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
  }

  get(sid, cb) {
    try {
      const row = this.stmtGet.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this.stmtDestroy.run(sid);
        return cb(null, null);
      }
      const sess = JSON.parse(row.data);
      cb(null, sess);
    } catch (e) {
      cb(e);
    }
  }

  set(sid, sessData, cb) {
    try {
      const expiresAt = Date.now() + this.EXPIRE_MS;
      this.stmtSet.run(sid, JSON.stringify(sessData), expiresAt);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  touch(sid, sessData, cb) {
    try {
      const expiresAt = Date.now() + this.EXPIRE_MS;
      this.stmtTouch.run(expiresAt, sid);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmtDestroy.run(sid);
      cb && cb(null);
    } catch (e) {
      cb && cb(e);
    }
  }

  // 定期清理过期 session(应用启动时调用一次,后续靠惰性删除)
  cleanup() {
    const before = Date.now();
    const r = this.stmtCleanup.run(before);
    return r.changes;
  }
}

module.exports = SqliteStore;
