import session from 'express-session';
import Database from 'better-sqlite3';

/**
 * Phase 1 fallback — SqliteSessionStore
 *
 * 仅在无 Redis 资源时使用(参考 架构与重构方案.md §8 R2 第 2 条 "无 Redis 资源时退回 file-store")。
 * 与 garment-server/session-store.js 完全兼容(同一 sessions 表 schema),实现跨进程 session 共享。
 *
 * Phase 2 起迁到 Redis(connect-redis),本类删除或归档到 common/auth/legacy/。
 *
 * Schema:
 *   CREATE TABLE sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)
 *   CREATE INDEX idx_sessions_expires ON sessions(expires_at)
 *
 * 与 garment-server/session-store.js 100% 兼容(同样的字段、同样的过期逻辑)。
 */

interface SqliteSessionData {
  cookie: {
    expires?: Date | null;
    originalMaxAge?: number;
    httpOnly?: boolean;
    path?: string;
    secure?: boolean;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
  };
  user?: any;
  [key: string]: any;
}

export class SqliteSessionStore extends session.Store {
  private db: Database.Database;
  private stmtGet: Database.Statement;
  private stmtSet: Database.Statement;
  private stmtDestroy: Database.Statement;
  private stmtTouch: Database.Statement;

  constructor(db: Database.Database, options: { expireDays?: number } = {}) {
    super();
    this.db = db;

    // sessions 表 schema(与 garment-server/session-store.js 完全一致)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    this.stmtGet = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this.stmtSet = db.prepare(
      'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)',
    );
    this.stmtDestroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');

    this.expireDays = options.expireDays ?? 7;
  }

  private expireDays: number;

  // ── express-session Store 接口实现 ──

  get(sid: string, callback: (err?: any, session?: any) => void): void {
    try {
      const row = this.stmtGet.get(sid) as { data: string; expires_at: number } | undefined;
      if (!row) return callback();

      if (row.expires_at < Date.now()) {
        // 已过期,清理
        this.stmtDestroy.run(sid);
        return callback();
      }

      const sessionData = JSON.parse(row.data) as SqliteSessionData;
      callback(null, sessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sessionData: any, callback?: (err?: any) => void): void {
    try {
      const expiresAt = Date.now() + this.expireDays * 24 * 60 * 60 * 1000;
      const data = JSON.stringify(sessionData);
      this.stmtSet.run(sid, data, expiresAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.stmtDestroy.run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: any, callback?: (err?: any) => void): void {
    try {
      const maxAge = sessionData?.cookie?.originalMaxAge;
      const expiresAt = maxAge ? Date.now() + maxAge : Date.now() + this.expireDays * 24 * 60 * 60 * 1000;
      this.stmtTouch.run(expiresAt, sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}