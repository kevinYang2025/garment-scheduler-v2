import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
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
  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
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
  app.enableCors({
    origin: (origin, cb) => cb(null, true), // 迁移期全开;生产再收敛
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
  const redisClient = app.get<Redis>(REDIS_CLIENT);
  const sessionSecret =
    process.env.SESSION_SECRET || 'garment-session-dev-secret';
  app.use(buildSessionMiddleware({ secret: sessionSecret, redisClient }));
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