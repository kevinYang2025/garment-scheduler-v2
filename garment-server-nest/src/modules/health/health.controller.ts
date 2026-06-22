import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.config';

/**
 * Phase 1.7 — /health 端点
 *
 * 三个端点:
 *   GET /health       — 服务存活
 *   GET /health/db    — SQLite 可用性 + latency + WAL 状态
 *   GET /health/redis — Redis PING + 版本
 *
 * 用于:
 *   1. Phase 1 验收(对照 §3.1)
 *   2. Docker HEALTHCHECK 探针
 *   3. 监控告警
 */
@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  root() {
    return {
      ok: true,
      service: 'nest',
      version: process.env.npm_package_version || '0.0.1',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      node: process.version,
      port: process.env.PORT || 3002,
    };
  }

  @Get('db')
  async db() {
    const start = Date.now();
    try {
      // SELECT 1 验证连接
      await this.ds.query('SELECT 1 AS ok');
      const latency = Date.now() - start;

      // 检查 WAL 模式(对 Phase 1 关键)
      let journalMode = 'unknown';
      try {
        const wal: any = await this.ds.query('PRAGMA journal_mode');
        journalMode = Array.isArray(wal) ? wal[0]?.journal_mode : wal?.journal_mode;
      } catch {
        // ignore
      }

      return {
        ok: true,
        latency,
        sqlite: this.ds.options.database,
        journalMode,
        driver: this.ds.options.type,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
        latency: Date.now() - start,
      };
    }
  }

  @Get('redis')
  async redisHealth() {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      const info = await this.redis.info('server');
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      return {
        ok: pong === 'PONG',
        pong,
        latency: Date.now() - start,
        version: versionMatch ? versionMatch[1].trim() : 'unknown',
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
        latency: Date.now() - start,
      };
    }
  }
}