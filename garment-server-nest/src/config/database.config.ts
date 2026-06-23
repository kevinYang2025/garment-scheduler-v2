import { DataSourceOptions } from 'typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';
import { OperationLog } from '../entity/operation-log.entity';
import { User } from '../entity/user.entity';
import { Style } from '../entity/style.entity';
import { SnakeCaseNamingStrategy } from './snake-case.strategy';

/**
 * Phase 1.3 — TypeORM + SQLite WAL 配置
 *
 * 关键约束(参考 架构与重构方案.md §8.1):
 *   - synchronize: false (严禁,会丢数据)
 *   - WAL 模式 + busy_timeout=5000(双进程并发写)
 *   - 复用 garment-server/data.sqlite(同库共享)
 */
export const databaseConfig = (): TypeOrmModuleOptions => {
  // 数据库路径:默认与 garment-server 同级共享 data.sqlite
  // __dirname 在 src/config/(开发) 或 dist/config/(编译产物) 都向上 3 层到项目根
  // 通过环境变量 DB_PATH 覆盖(测试场景用 :memory:)
  const dbPath =
    process.env.DB_PATH ||
    path.resolve(__dirname, '../../../garment-server/data.sqlite');

  const isMemory = dbPath === ':memory:';

  const options: DataSourceOptions = {
    type: 'better-sqlite3',
    database: dbPath,
    // 关键:禁用 auto-sync,避免破坏现有 Express 已建表
    synchronize: false,
    // 关键:必须手动日志显示
    logging: process.env.DB_LOG === 'true' ? 'all' : ['error', 'warn'],
    // better-sqlite3 同步驱动,无 busyErrorRetry(WAL + busy_timeout=5000 已经处理并发)
    // 初始化时执行 PRAGMA
    prepareDatabase: (db) => {
      if (!isMemory) {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
      } else {
        // 内存库不需要 WAL,但 foreign_keys 仍开
        db.pragma('foreign_keys = ON');
      }
    },
    // Phase 2 起按 entity 引入;Phase 1 先空数组(只验连接)
    entities: [OperationLog, User, Style],
    // 强制 snake_case 列名,与 garment-server/db.js schema 严格一致
    namingStrategy: new SnakeCaseNamingStrategy(),
    // Phase 5 起开 migrations
    migrations: [],
    migrationsRun: false,
  };

  return options;
};