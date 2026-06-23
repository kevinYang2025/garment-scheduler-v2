import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

/**
 * Phase 11 Code Review Fix #7 — 公共 SqliteConnection provider
 *
 * 问题:
 *   - main-plan / warehouse / actual service 各自 new Database() 连接
 *   - 三处重复 dbPath 解析 + 三个 pragma 配置
 *   - 缺 foreign_keys pragma,未来加 FK 约束会失效
 *
 * 解决:
 *   - 提供 createSqliteConnection() 工厂,所有 service 共享一致的 pragma 配置
 *   - Phase 11 时间紧迫,先抽 helper(暂不抽 NestJS @Injectable provider)
 *   - 后续 Phase 11.5 可重构成 @Global SqliteConnectionProvider
 */

export interface SqliteConnectionOptions {
  /** WAL busy_timeout(默认 5000ms) */
  busyTimeoutMs?: number;
  /** 是否启用 FK 约束(默认 true) */
  foreignKeys?: boolean;
}

/**
 * 创建 better-sqlite3 连接,配置 WAL + busy_timeout + FK + path 容错解析
 *
 * @param envDbPath env DB_PATH(测试场景,如 :memory:)
 */
export function createSqliteConnection(
  envDbPath: string | undefined = process.env.DB_PATH,
  opts: SqliteConnectionOptions = {},
): Database.Database {
  const { busyTimeoutMs = 5000, foreignKeys = true } = opts;

  const dbPath = envDbPath || resolveDbPath();
  const isMemory = dbPath === ':memory:';

  const db = new Database(dbPath);

  if (!isMemory) {
    db.pragma('journal_mode = WAL');
    db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  }

  if (foreignKeys && !isMemory) {
    db.pragma('foreign_keys = ON');
  }

  return db;
}

/**
 * 解析 SQLite 数据库路径(向上找 sibling garment-server/data.sqlite)
 * 与 Phase 5 main-plan.service.ts 的 resolveDbPath 一致
 */
export function resolveDbPath(): string {
  const candidates = [
    path.resolve(process.cwd(), '../garment-server/data.sqlite'),
    path.resolve(process.cwd(), 'garment-server/data.sqlite'),
    path.resolve(__dirname, '../../../garment-server/data.sqlite'),
    path.resolve(__dirname, '../../../../garment-server/data.sqlite'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}