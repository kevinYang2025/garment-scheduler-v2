import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import type { RequestHandler } from 'express';

/**
 * Phase 1.5 — Session store 配置
 *
 * 关键(参考 §8 R2):
 *   - 必须用 Redis store(否则 3001/3002 双进程 session 不共享,鉴权崩溃)
 *   - cookie secure:false(内网 HTTP)
 *   - key 前缀 sess:,TTL 跟随 cookie maxAge
 *
 * 与 garment-server/server.js 共用同一 Redis 实例 + 同一 cookie name,
 * 实现跨进程 session 共享。
 */

export interface SessionOptions {
  secret: string;
  redisClient: Redis;
  cookieMaxAgeMs?: number; // 默认 24h
}

export function buildSessionMiddleware(opts: SessionOptions): RequestHandler {
  const store = new RedisStore({
    client: opts.redisClient,
    prefix: 'sess:',
    ttl: Math.floor((opts.cookieMaxAgeMs ?? 24 * 60 * 60 * 1000) / 1000),
  });

  return session({
    store,
    // 与 garment-server/server.js 完全一致,确保 cookie 互通
    name: 'connect.sid',
    secret: opts.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // 内网 HTTP
      maxAge: opts.cookieMaxAgeMs ?? 24 * 60 * 60 * 1000,
    },
  });
}