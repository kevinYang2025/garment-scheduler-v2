import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import RedisStore from 'connect-redis';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { buildValidationPipe } from './common/pipe/validation.pipe';
import { LoggingInterceptor } from './common/interceptor/logging.interceptor';
import { SnakeCaseResponseInterceptor } from './common/interceptor/snake-case.interceptor';
import { buildSessionMiddleware } from './config/session.config';
import { REDIS_CLIENT } from './config/redis.config';

/**
 * Phase 1 — bootstrap 入口
 *
 * 关键装配(参考 §3.1):
 *   1. 监听 3002(与 garment-server/3001 共存)
 *   2. CORS 开 credentials(cookie 跨端口)
 *   3. 全局 ValidationPipe(§3.4 whitelist + implicit conversion)
 *   4. 全局 HttpExceptionFilter(§3.5 占位)
 *   5. express-session + connect-redis(§8 R2)
 *   6. Socket.IO Redis Adapter(§8 R5)
 */
class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisSessionStore: any;
  private sessionSecret: string;

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);

    // 同时初始化 Redis session store(给 socket.io handshake 用)
    const sessionClient = new Redis(url);
    this.redisSessionStore = new RedisStore({
      client: sessionClient,
      prefix: 'sess:',
      ttl: 7 * 24 * 60 * 60,
    });
    this.sessionSecret = process.env.SESSION_SECRET || 'garment-session-dev-secret';
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);

    // 让 socket.io handshake 也走 express-session(共享 Redis session)
    // 否则 socket.handshake.session.user 是 undefined
    // 与 garment-server/server.js io.engine.use(session(...)) 一致
    const session = require('express-session');
    server.engine.use(
      session({
        store: this.redisSessionStore,
        secret: this.sessionSecret,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      }),
    );

    server.adapter(this.adapterConstructor);
    return server;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const port = Number(process.env.PORT) || 3002;

  // ── CORS(必须 credentials: true,否则 cookie 跨端口丢)──
  // Fix #A(2026-06-23,独立安全审查):
  //   之前 origin: (origin, cb) => cb(null, true) 反射任何 Origin,配合 credentials:true
  //   等于允许 evil.com 跨源读取认证响应(CSRF + 数据外泄)。
  //   现在白名单从环境变量读,未设置则只允许 localhost(开发安全)。
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      // 同源请求(origin === undefined)直接通过(curl/Postman/SSR)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // 拒绝未在白名单的 origin(NestJS 会回 403 + 不带 CORS 头)
      cb(new Error(`CORS blocked: origin ${origin} not in whitelist`), false);
    },
    credentials: true,
  });

  // ── 全局 ValidationPipe(§3.4)──
  app.useGlobalPipes(buildValidationPipe());

  // ── 全局 HttpException Filter(§3.5 占位)──
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── 全局 Logging Interceptor(§3 Phase 2.3)──
  app.useGlobalInterceptors(new LoggingInterceptor());
  // SnakeCaseResponseInterceptor 不全局挂,在需要的 controller 用 @UseInterceptors 启用
  // (避免影响错误响应/health 端点等)

  // ── express-session + Redis store(§8 R2)──
  // Fix #B(2026-06-23,独立安全审查):
  //   之前硬编码 fallback 'garment-session-dev-secret' → 运维忘设 env 时被已知 secret 签名
  //   现在强制要求 NODE_ENV=production 时 SESSION_SECRET 必须设(否则启动失败)
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[FATAL] SESSION_SECRET 必须设置(NODE_ENV=production)。已知 default 会让攻击者伪造任意 session。',
    );
  }
  if (!sessionSecret) {
    logger.warn('[SECURITY] SESSION_SECRET 未设置,使用开发默认值(仅 NODE_ENV=development 允许)');
  }
  const redisClient = app.get<Redis>(REDIS_CLIENT);
  app.use(
    buildSessionMiddleware({
      secret: sessionSecret || 'garment-session-dev-secret',
      redisClient,
    }),
  );
  logger.log('session middleware mounted (Redis store)');

  // ── Socket.IO Redis Adapter(§8 R5)──
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  logger.log('Socket.IO Redis adapter mounted');

  await app.listen(port);
  logger.log(`🟢 NestJS listening on http://localhost:${port}`);
  logger.log(`   /health      — liveness`);
  logger.log(`   /health/db   — SQLite + WAL check`);
  logger.log(`   /health/redis — Redis PING check`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});